// The thin agent. It knows the fixed reads and no accounting: it fetches, gzips, queues and uploads,
// and the server parses, checks and keeps every watermark. It holds no port open and asks Tally one
// thing at a time. Its log holds ids and counts only, never a name or an amount.
import { gzipSync } from 'node:zlib';
import { rm } from 'node:fs/promises';
import { ApiError } from './api-client.mjs';
import { BadJob, buildCompanyList, buildRead } from './templates.mjs';
import { endsCleanly, TallyError } from './tally-client.mjs';

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const COUNT_TRIES = 3;
const READ_TRIES = 3;
const HOLD_AFTER_TIMEOUTS_MS = 10 * 60000;
const MAX_UPLOAD_BACKOFF_MS = 15 * 60000;
const LICENCE_EVERY_MS = 30 * 60000;
const has = (body, text) =>
  body.includes(Buffer.from(text, 'utf16le')) || body.includes(Buffer.from(text, 'utf8'));
const packSmall = (body) => gzipSync(body).toString('base64');
const istDay = (ms) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);
const inShopHours = (ms) => {
  const hour = new Date(ms + 5.5 * 3600000).getUTCHours();
  return hour >= 8 && hour < 20;
};

export class Agent {
  constructor({
    tally,
    api,
    spool,
    platform,
    version,
    updater = null,
    log = () => {},
    now = Date.now,
    sleep = sleepFor,
    retryWaitMs = 5000,
  }) {
    Object.assign(this, {
      tally,
      api,
      spool,
      platform,
      version,
      updater,
      log,
      now,
      sleep,
      retryWaitMs,
    });
    this.config = { heartbeatSec: 60, probeSec: 120, dailyCapMb: 200 };
    this.lastBeatAt = 0;
    this.lastProbeAt = 0;
    this.lastLicenceAt = 0;
    this.paused = false;
    this.running = null;
    this.holdUntil = 0;
    this.uploadFailures = 0;
    this.uploadHoldUntil = 0;
    this.stopped = null;
    this.lastState = 'OK';
    this.lastSlowMs = 0;
  }

  /** Reads Tally's marks and version, untouched. Which state that means is mostly the server's call. */
  async probe(woke = false) {
    try {
      const companies = await this.tally.small(buildRead('companies'));
      const probe = { companies: packSmall(companies.body) };
      let slowest = companies.tookMs;
      // Plan 09's budget when idle is one request every two minutes. The marks are that request; the
      // licence is asked for now and then, and after any sleep, which is when it tends to change.
      if (woke || this.now() - this.lastLicenceAt >= LICENCE_EVERY_MS) {
        const licence = await this.tally.small(buildRead('licence'));
        probe.licence = packSmall(licence.body);
        this.lastLicenceAt = this.now();
        slowest = Math.max(slowest, licence.tookMs);
      }
      if (!has(companies.body, '<F01>')) {
        const list = await this.tally.small(buildCompanyList());
        probe.list = packSmall(list.body);
      }
      this.lastSlowMs = slowest;
      return { state: 'OK', probe };
    } catch (error) {
      if (!(error instanceof TallyError)) throw error;
      if (error.code === 'CLOSED') {
        // Nothing on the port. If Tally itself is running, the port setting is what is off.
        const running = await this.platform.tallyRunning().catch(() => false);
        return { state: running ? 'PORT_OFF' : 'TALLY_CLOSED' };
      }
      return { state: error.code === 'BUSY' ? 'BUSY' : 'BAD_ANSWER' };
    }
  }

  /** One heartbeat: says who it is, asks what to do next. Never throws for a network blip. */
  async beat() {
    const now = this.now();
    const woke = this.lastBeatAt > 0 && now - this.lastBeatAt > 3 * this.config.heartbeatSec * 1000;
    this.lastBeatAt = now;
    let state = this.lastState;
    let probe;
    if (this.paused) state = 'PAUSED';
    else if (await this.spool.full()) state = 'SPOOL_FULL';
    else if (!this.running && (woke || now - this.lastProbeAt >= this.config.probeSec * 1000)) {
      this.lastProbeAt = now;
      const seen = await this.probe(woke);
      state = seen.state;
      probe = seen.probe;
    }
    this.lastState = state === 'PAUSED' ? this.lastState : state;
    const caps = {
      ...(await this.platform.caps(this.spool).catch(() => ({}))),
      ...(this.lastSlowMs ? { slowMs: this.lastSlowMs } : {}),
      ...(this.updater?.failedVersion ? { updateFailed: this.updater.failedVersion() } : {}),
    };
    let reply;
    try {
      reply = await this.api.heartbeat({
        state,
        version: this.version,
        os: this.platform.osText(),
        woke,
        caps,
        ...(probe ? { probe } : {}),
      });
    } catch (error) {
      if (await this.fatal(error)) return null;
      this.log('heartbeat_failed', { code: error.code ?? 'NETWORK' });
      return null;
    }
    this.updater?.markHealthy?.();
    this.config = { ...this.config, ...reply.config };
    const wasPaused = this.paused;
    this.paused = Boolean(reply.paused);
    // Told to stop: forget the wait, so the next read after "resume" is immediate.
    if (wasPaused && !this.paused) this.lastProbeAt = 0;
    return reply;
  }

  /** A revoked PC stops for good and leaves nothing behind. */
  async fatal(error) {
    if (!(error instanceof ApiError) || error.code !== 'BRIDGE_REVOKED') return false;
    this.stopped = 'REVOKED';
    this.log('revoked', {});
    await this.spool.wipe().catch(() => undefined);
    return true;
  }

  async tick() {
    if (this.stopped) return null;
    const reply = await this.beat();
    if (!reply || this.stopped) return reply;
    if (!this.paused && !this.running && this.now() >= this.holdUntil) {
      await this.resumeUploads();
      if (reply.job && !this.stopped) await this.runJob(reply.job);
    }
    if (reply.update && !this.running && !this.stopped && this.updater)
      await this.updater.take(reply.update.version, this.api);
    return reply;
  }

  /** Runs until told otherwise. The heartbeat keeps its rhythm while a long job reads. */
  async loop() {
    await this.spool.ready();
    while (!this.stopped) {
      const reply = await this.beat();
      if (!reply || this.stopped) {
        await this.sleep(this.config.heartbeatSec * 1000);
        continue;
      }
      if (!this.paused && !this.running && this.now() >= this.holdUntil) {
        this.running = (async () => {
          await this.resumeUploads();
          if (reply.job && !this.stopped) await this.runJob(reply.job);
          if (reply.update && !this.stopped && this.updater)
            await this.updater.take(reply.update.version, this.api);
        })()
          .catch((error) => this.log('job_error', { code: error.code ?? 'AGENT_ERROR' }))
          .finally(() => {
            this.running = null;
          });
      }
      await this.sleep(this.config.heartbeatSec * 1000);
    }
    return this.stopped;
  }

  /** Whatever the last run left behind goes first: a finished read must not be asked for again. */
  async resumeUploads() {
    const stale = this.now() - 7 * 86400000;
    await this.spool.sweepOrphans(this.now() - 86400000);
    for (const manifest of await this.spool.pending()) {
      if (manifest.startedAt && manifest.startedAt < stale) {
        await this.spool.remove(manifest.id);
        continue;
      }
      if (manifest.complete) await this.upload(manifest);
    }
  }

  async pace(tookMs) {
    if (!inShopHours(this.api.serverNow())) return;
    // Three times the last request in shop hours, so the accountant's typing always comes first.
    await this.sleep(Math.min(3 * tookMs, 5 * 60000));
  }

  async readCount(spec) {
    const { body } = await this.tally.small(buildRead(spec.read, spec.params, { count: true }));
    return body;
  }

  /** One read, whole: counted before and after, cut-offs retried, then into parts on disk. */
  async readOne(job, index, spec, manifest) {
    const temp = this.spool.tempFile(job.id, index);
    let last = null;
    let timeouts = 0;
    for (let attempt = 0; attempt < READ_TRIES + COUNT_TRIES; attempt++) {
      if (attempt) await this.sleep(this.retryWaitMs);
      try {
        const before = spec.count ? await this.readCount(spec) : null;
        const answer = await this.tally.toFile(buildRead(spec.read, spec.params), temp);
        if (!endsCleanly(answer.tail)) {
          last = 'CUT_OFF';
          if (attempt + 1 >= READ_TRIES) break;
          continue;
        }
        const after = spec.count ? await this.readCount(spec) : null;
        // Asked again until two answers agree. Which number it is, is for the server to read.
        if (before && !before.equals(after)) {
          last = 'COUNT_UNSTABLE';
          continue;
        }
        const { parts, bytes } = await this.spool.split(manifest, temp);
        await rm(temp, { force: true });
        return {
          index,
          parts,
          bytes,
          tookMs: answer.tookMs,
          readAt: Math.round(this.api.serverNow()),
          ...(before ? { counts: [packSmall(before), packSmall(after)] } : {}),
        };
      } catch (error) {
        if (!(error instanceof TallyError)) throw error;
        if (error.code === 'BUSY') {
          last = 'BUSY';
          // Three timeouts stop the job for 10 minutes. A Tally restart often cures this.
          if (++timeouts >= 3) {
            this.holdUntil = this.now() + HOLD_AFTER_TIMEOUTS_MS;
            break;
          }
          continue;
        }
        last =
          error.code === 'CLOSED'
            ? 'TALLY_CLOSED'
            : error.code === 'TOO_BIG'
              ? 'TOO_BIG'
              : 'BAD_ANSWER';
        break;
      }
    }
    await rm(temp, { force: true });
    throw Object.assign(new Error(last ?? 'BAD_ANSWER'), { readFailed: last ?? 'BAD_ANSWER' });
  }

  async runJob(job) {
    const log = { job: job.id, kind: job.kind };
    let manifest;
    try {
      // Everything is checked before Tally hears anything, so a bad job asks Tally nothing at all.
      for (const spec of job.reads)
        buildRead(spec.read, spec.params, { count: Boolean(spec.count) });
      manifest = await this.spool.open(job);
      manifest.startedAt ??= this.now();
      for (const [index, spec] of job.reads.entries()) {
        if (manifest.reads[index]) continue;
        if (this.paused || this.stopped) return false;
        if (await this.spool.full())
          throw Object.assign(new Error('SPOOL_FULL'), { readFailed: 'SPOOL_FULL' });
        const entry = await this.readOne(job, index, spec, manifest);
        manifest.reads[index] = entry;
        await this.spool.save(manifest);
        await this.pace(entry.tookMs);
      }
      if (!manifest.marksAfter) {
        const { body } = await this.tally.small(buildRead('companies'));
        manifest.marksAfter = packSmall(body);
      }
      manifest.complete = true;
      await this.spool.save(manifest);
      this.log('read_done', { ...log, reads: job.reads.length });
      // Working, not idle: the next heartbeat asks for the next job rather than waiting two minutes.
      this.lastProbeAt = 0;
    } catch (error) {
      const failed =
        error instanceof BadJob
          ? 'BAD_JOB'
          : error.readFailed
            ? error.readFailed
            : error instanceof TallyError
              ? error.code === 'BUSY'
                ? 'BUSY'
                : 'TALLY_CLOSED'
              : 'AGENT_ERROR';
      this.log('read_failed', { ...log, code: failed });
      await this.spool.remove(job.id).catch(() => undefined);
      await this.report(job.id, { error: failed });
      return false;
    }
    return this.upload(manifest);
  }

  async report(jobId, body) {
    try {
      return await this.api.finish(jobId, body);
    } catch (error) {
      if (!(await this.fatal(error))) this.log('report_failed', { code: error.code ?? 'NETWORK' });
      return null;
    }
  }

  overDailyCap(bytes) {
    const day = istDay(this.api.serverNow());
    const state = this.api.state;
    if (state.uploadDay !== day) {
      state.uploadDay = day;
      state.uploadedToday = 0;
    }
    return state.uploadedToday + bytes > this.config.dailyCapMb * 1024 * 1024;
  }

  /** One part at a time, deleted only after the server's reply. Backs off to 15 minutes when down. */
  async upload(manifest) {
    if (this.now() < this.uploadHoldUntil) return false;
    try {
      for (let again = 0; again < 2; again++) {
        for (const read of Object.values(manifest.reads)) {
          for (const { seq } of read.parts) {
            if (manifest.uploaded[seq]) continue;
            const bytes = await this.spool.part(manifest.id, seq);
            if (this.overDailyCap(bytes.length)) {
              this.log('daily_cap', { job: manifest.id });
              return false;
            }
            await this.api.chunk(manifest.id, seq, bytes);
            this.api.state.uploadedToday += bytes.length;
            manifest.uploaded[seq] = true;
            await this.spool.save(manifest);
          }
        }
        try {
          await this.api.finish(manifest.id, {
            reads: Object.values(manifest.reads),
            marksAfter: manifest.marksAfter,
          });
          break;
        } catch (error) {
          // The server lost a part or never got it: send those again, once.
          const missing = error.body?.error?.details?.missing;
          if (error.code !== 'BRIDGE_PARTS_MISSING' || !missing || again) throw error;
          for (const seq of missing) delete manifest.uploaded[seq];
        }
      }
      await this.spool.remove(manifest.id);
      this.uploadFailures = 0;
      this.log('uploaded', { job: manifest.id, parts: Object.keys(manifest.uploaded).length });
      return true;
    } catch (error) {
      if (await this.fatal(error)) return false;
      if (
        error instanceof ApiError &&
        (error.status === 404 || error.code === 'BRIDGE_JOB_CLOSED')
      ) {
        // The server has moved on, and Tally still holds the truth. Nothing here is worth keeping.
        await this.spool.remove(manifest.id);
        return false;
      }
      this.uploadFailures++;
      this.uploadHoldUntil =
        this.now() + Math.min(MAX_UPLOAD_BACKOFF_MS, 15000 * 2 ** this.uploadFailures);
      this.log('upload_failed', { job: manifest.id, code: error.code ?? 'NETWORK' });
      return false;
    }
  }
}
