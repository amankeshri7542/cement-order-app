import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, sign, verify } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, beforeEach, describe, test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { addLedger, FakeTally, makeCompany, receipt, sale } from '../fake/fake-tally.mjs';
import { Agent } from '../src/agent.mjs';
import {
  ApiError,
  BridgeApi,
  checkedBase,
  loadIdentity,
  newIdentity,
  publicKeyOf,
  saveIdentity,
} from '../src/api-client.mjs';
import {
  flatRows,
  main as checkMain,
  makeProbes,
  productName,
  renderReport,
  runCheck,
} from '../src/check.mjs';
import { EXIT_STOPPED, EXIT_UPDATE_READY, launch, nextRun } from '../src/launcher.mjs';
import { fileVersion } from '../src/pe-version.mjs';
import { cli } from '../src/main.mjs';
import { Spool } from '../src/spool.mjs';
import { endsCleanly, TallyClient } from '../src/tally-client.mjs';
import {
  assertReadOnly,
  BadJob,
  buildCompanyList,
  buildRead,
  encodeRequest,
  readNames,
} from '../src/templates.mjs';
import { checkRelease, compareVersions, Updater, UpdateRefused } from '../src/update.mjs';
import { AGENT_VERSION } from '../src/version.mjs';
import { makeRelease } from '../tools/sign-release.mjs';

const folders = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'shiv-bridge-'));
  folders.push(dir);
  return dir;
};
after(() => {
  for (const dir of folders) rmSync(dir, { recursive: true, force: true });
});
const base = { company: 'Bench Traders', fromDate: '1-Apr-2026', toDate: '5-Nov-2026' };
const everyRead = {
  companies: {},
  licence: {},
  groups: base,
  parties: { ...base, group: 'Sundry Debtors' },
  voucherTypes: base,
  stockItems: base,
  godowns: base,
  vouchers: { ...base, after: '10', upto: '20', types: ['Sales', 'GST Sale'] },
  voucherLines: { ...base, dayFrom: '20260401', dayTo: '20260430', types: ['Sales'] },
  voucherStock: { ...base, after: '10', upto: '20', types: ['Sales'] },
  voucherSweep: { ...base, dayFrom: '20260401', dayTo: '20260430' },
};

describe('the fixed reads: plan 09 section 7', () => {
  test('there are exactly the listed reads, each an Export', () => {
    assert.deepEqual([...readNames].sort(), Object.keys(everyRead).sort());
    for (const [name, params] of Object.entries(everyRead)) {
      for (const count of [false, true]) {
        const text = buildRead(name, params, { count });
        assert.equal(assertReadOnly(text), text);
        assert.match(text, /<TALLYREQUEST>Export<\/TALLYREQUEST>/);
      }
    }
    assert.match(buildCompanyList(), /<ID>List of Companies<\/ID>/);
    assertReadOnly(buildCompanyList());
  });
  test('company reads name no company; every other read does', () => {
    assert.doesNotMatch(buildRead('companies'), /SVCURRENTCOMPANY/);
    assert.match(buildRead('groups', base), /<SVCURRENTCOMPANY>Bench Traders<\/SVCURRENTCOMPANY>/);
    assert.throws(() => buildRead('groups', {}), BadJob);
  });
  test('the formulas are the ones in the plan', () => {
    const delta = buildRead('vouchers', everyRead.vouchers);
    assert.match(delta, /\$AlterId &gt; 10 AND \$AlterId &lt;= 20/);
    assert.match(delta, /<FILTER>ShivDelta,ShivTypes<\/FILTER>/);
    assert.match(delta, /\$VoucherTypeName = "Sales" OR \$VoucherTypeName = "GST Sale"/);
    const day = buildRead('voucherSweep', everyRead.voucherSweep);
    assert.match(day, /&gt;= 20260401 AND .*&lt;= 20260430/);
    assert.match(buildRead('parties', everyRead.parties), /<CHILDOF>Sundry Debtors<\/CHILDOF>/);
    assert.match(
      buildRead('voucherLines', everyRead.voucherLines),
      /<REPEAT>ShivL2 : AllLedgerEntries<\/REPEAT>/,
    );
    assert.match(
      buildRead('voucherStock', everyRead.voucherStock),
      /<REPEAT>ShivL2 : AllInventoryEntries<\/REPEAT>/,
    );
  });
  test('a count asks for one number from the same collection', () => {
    const text = buildRead('vouchers', everyRead.vouchers, { count: true });
    assert.match(text, /\$\$NumItems:ShivC/);
    assert.match(text, /<FILTER>ShivDelta,ShivTypes<\/FILTER>/);
    assert.doesNotMatch(text, /<REPEAT>/);
  });
  test('a request goes as UTF-16 little-endian, so Devanagari names survive', () => {
    const bytes = encodeRequest(buildRead('groups', { ...base, company: 'शिव ट्रेडर्स' }));
    assert.match(bytes.toString('utf16le'), /शिव ट्रेडर्स/);
  });
});

describe('what a hacked server can send', () => {
  test('a read that is not on the list is refused', () => {
    for (const name of ['import', 'Vouchers', '__proto__', 'constructor', 'toString', ''])
      assert.throws(() => buildRead(name, base), BadJob, name);
  });
  test('a company name cannot break out of its tag', () => {
    const text = buildRead('groups', { ...base, company: '</SVCURRENTCOMPANY><TDL>evil</TDL>' });
    assert.doesNotMatch(text, /<TDL>evil/);
    assert.match(text, /&lt;\/SVCURRENTCOMPANY&gt;/);
  });
  test('a voucher type cannot break out of the formula', () => {
    assert.throws(
      () =>
        buildRead('vouchers', {
          ...base,
          after: '1',
          upto: '2',
          types: ['Sales" OR $$CmpLoad:"x'],
        }),
      BadJob,
    );
    const text = buildRead('vouchers', { ...base, after: '1', upto: '2', types: ['A<B'] });
    assert.match(text, /"A&lt;B"/);
  });
  test('numbers and dates must be numbers and dates', () => {
    assert.throws(() => buildRead('vouchers', { ...base, after: '1 OR 1', upto: '2' }), BadJob);
    assert.throws(() => buildRead('vouchers', { ...base, after: '1', upto: '2;' }), BadJob);
    assert.throws(() => buildRead('vouchers', { ...base, dayFrom: '2026', dayTo: 'x' }), BadJob);
    assert.throws(() => buildRead('groups', { ...base, toDate: '$$Now' }), BadJob);
    assert.throws(
      () => buildRead('parties', { ...base, group: 'Sundry Debtors</CHILDOF>' }),
      BadJob,
    );
    assert.throws(() => buildRead('parties', { ...base, group: 'Primary' }), BadJob);
  });
  test('control characters cannot hide in a company name', () => {
    assert.throws(() => buildRead('groups', { ...base, company: 'Bench\u0000Traders' }), BadJob);
  });
});

describe('no write path of any kind', () => {
  const sources = ['src', 'fake', 'packaging', 'tools'].flatMap((dir) => {
    const path = new URL(`../${dir}/`, import.meta.url).pathname;
    return existsSync(path) ? readdirSync(path).map((name) => join(path, name)) : [];
  });
  test('a write cannot pass the last gate, whoever asks', () => {
    for (const text of [
      '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST><TYPE>Data</TYPE><ID>Vouchers</ID></HEADER></ENVELOPE>',
      '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST></HEADER><BODY><TALLYMESSAGE><VOUCHER ACTION="Create"/></TALLYMESSAGE></BODY></ENVELOPE>',
      '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST></HEADER><IMPORTDATA/></ENVELOPE>',
      'anything else at all',
    ])
      assert.throws(() => encodeRequest(text), BadJob);
  });
  test('the client cannot send what the gate refuses', async () => {
    const tally = new FakeTally();
    const port = await tally.listen();
    const client = new TallyClient({ port });
    await assert.rejects(
      client.small('<ENVELOPE><HEADER><TALLYREQUEST>Import</TALLYREQUEST></HEADER></ENVELOPE>'),
      BadJob,
    );
    assert.equal(tally.requests.length, 0);
    await tally.close();
  });
  test('no program file names Tally’s write words, except the gate that refuses them', () => {
    for (const path of sources) {
      if (statSync(path).isDirectory()) continue;
      if (path.endsWith('fake-tally.mjs')) continue;
      const text = readFileSync(path, 'utf8');
      const lines = text
        .split('\n')
        .filter(
          (line) => !/assertReadOnly|<TALLYMESSAGE|TALLYMESSAGE|write path|A write/.test(line),
        );
      assert.doesNotMatch(
        lines.join('\n'),
        /TALLYREQUEST>Import|ACTION="|REMOTEID|<IMPORTDATA/,
        path,
      );
    }
  });
  test('the program binds no listening port: there is no server in it', () => {
    for (const path of sources) {
      if (statSync(path).isDirectory() || path.endsWith('fake-tally.mjs')) continue;
      const text = readFileSync(path, 'utf8');
      assert.doesNotMatch(text, /createServer|\.listen\(/, path);
    }
  });
  test('Tally is only ever reached on this PC’s own loopback address', () => {
    const text = readFileSync(new URL('../src/tally-client.mjs', import.meta.url), 'utf8');
    assert.match(text, /const LOOPBACK = '127\.0\.0\.1'/);
    assert.equal([...text.matchAll(/host: /g)].length, 2);
    assert.equal([...text.matchAll(/host: LOOPBACK/g)].length, 2);
  });
});

describe('the Tally client against every bad day', () => {
  let tally;
  afterEach(async () => {
    await tally?.close().catch(() => undefined);
    tally = null;
  });
  test('Tally closed: the connection is refused, and it says so', async () => {
    tally = new FakeTally();
    const port = await tally.listen();
    await tally.close();
    tally = null;
    await assert.rejects(
      new TallyClient({ port }).small(buildRead('companies')),
      (error) => error.code === 'CLOSED',
    );
  });
  test('a sleeping or jammed Tally: stops waiting and says busy', async () => {
    tally = new FakeTally({ quirks: { hang: true } });
    const port = await tally.listen();
    const client = new TallyClient({ port, idleMs: 100, requestMs: 400 });
    await assert.rejects(client.small(buildRead('companies')), (error) => error.code === 'BUSY');
  });
  test('an answer that never ends stops at the cap', async () => {
    tally = new FakeTally({ quirks: { huge: 50 * 1024 * 1024 } });
    const port = await tally.listen();
    const client = new TallyClient({ port, maxBytes: 200 * 1024, idleMs: 2000 });
    const path = join(tempDir(), 'answer');
    await assert.rejects(
      client.toFile(buildRead('companies'), path),
      (error) => error.code === 'TOO_BIG',
    );
    assert.ok(statSync(path).size < 1024 * 1024);
  });
  test('a server error is not an answer', async () => {
    tally = new FakeTally({ quirks: { status500: true } });
    const port = await tally.listen();
    await assert.rejects(
      new TallyClient({ port }).small(buildRead('companies')),
      (error) => error.code === 'BAD_STATUS',
    );
  });
  test('one request at a time, always, in the order asked', async () => {
    tally = new FakeTally();
    const port = await tally.listen();
    const client = new TallyClient({ port });
    await Promise.all([
      client.small(buildRead('companies')),
      client.small(buildRead('licence')),
      client.small(buildRead('companies')),
    ]);
    assert.equal(tally.requests.length, 3);
    assert.match(tally.requests[1].body, /ProdInfo/);
    assert.ok(tally.requests.every((row) => row.utf16));
  });
  test('it refuses a port that is not a port', () => {
    assert.throws(() => new TallyClient({ port: 99999 }));
    assert.throws(() => new TallyClient({ port: '9000; rm' }));
  });
  test('endsCleanly reads both encodings, and a cut answer is not clean', () => {
    const utf16 = (text) => Buffer.from(text, 'utf16le');
    assert.ok(endsCleanly(utf16('<F01>a</F01>\n</ENVELOPE>\r\n')));
    assert.ok(endsCleanly(Buffer.from('<F01>a</F01></ENVELOPE>\n')));
    assert.ok(!endsCleanly(utf16('<F01>a</F01>\n</ENVEL')));
    assert.ok(!endsCleanly(Buffer.from('<F01>a</F01>')));
    assert.ok(!endsCleanly(Buffer.alloc(0)));
  });
});

/** A pretend server for the agent: records what it was sent and answers as the real one does. */
function fakeApi(overrides = {}) {
  const calls = { heartbeats: [], chunks: new Map(), finishes: [] };
  const api = {
    state: {},
    serverNow: () => Date.parse('2026-11-05T17:00:00Z'), // after shop hours: no pacing waits
    async heartbeat(body) {
      calls.heartbeats.push(body);
      return overrides.heartbeat
        ? overrides.heartbeat(body, calls)
        : { config: {}, paused: false, job: null };
    },
    async chunk(id, seq, bytes) {
      if (overrides.chunk) await overrides.chunk(id, seq, bytes, calls);
      calls.chunks.set(`${id}:${seq}`, bytes);
    },
    async finish(id, body) {
      if (overrides.finish) await overrides.finish(id, body, calls);
      calls.finishes.push({ id, body });
      return { status: 'UPLOADED' };
    },
  };
  return { api, calls };
}
const platform = (running = false) => ({
  osText: () => 'Test Windows x64',
  tallyRunning: async () => running,
  caps: async () => ({ diskFreeMb: 1000 }),
});
function makeAgent(tallyPort, api, extra = {}) {
  const spool = new Spool(join(tempDir(), 'spool'));
  return new Agent({
    tally: new TallyClient({ port: tallyPort, idleMs: 200, requestMs: 1000 }),
    api,
    spool,
    platform: platform(extra.running),
    version: '1.0.0',
    sleep: async () => {},
    retryWaitMs: 0,
    ...extra,
  });
}
const job = (reads) => ({ id: 'job_abcdef1', kind: 'MASTERS', reads });
const unpack = (base64) => gunzipSync(Buffer.from(base64, 'base64')).toString('utf16le');

describe('the agent', () => {
  let tally;
  beforeEach(async () => {
    tally = new FakeTally();
    await tally.listen();
  });
  afterEach(async () => {
    await tally.close().catch(() => undefined);
  });

  test('sends Tally’s marks and version untouched in its heartbeat', async () => {
    const { api, calls } = fakeApi();
    const agent = makeAgent(tally.port, api);
    await agent.beat();
    const sent = calls.heartbeats[0];
    assert.equal(sent.state, 'OK');
    assert.match(unpack(sent.probe.companies), /Bench Traders/);
    assert.match(unpack(sent.probe.licence), /TallyPrime 7\.1/);
    assert.equal(sent.probe.list, undefined);
  });
  test('reads marks at most every two minutes, and only marks', async () => {
    const { api } = fakeApi();
    let clock = 1000000;
    const agent = makeAgent(tally.port, api, { now: () => clock });
    await agent.beat();
    const after = tally.requests.length;
    clock += 60000;
    await agent.beat();
    assert.equal(tally.requests.length, after);
    clock += 61000;
    await agent.beat();
    // One request every two minutes when idle: the marks. The licence comes round less often.
    assert.equal(tally.requests.length, after + 1);
    assert.ok(tally.requests.every((row) => /<TYPE>Company<\/TYPE>/.test(row.body)));
    assert.doesNotMatch(tally.requests.at(-1).body, /ProdInfo/);
    clock += 31 * 60000;
    await agent.beat();
    assert.match(tally.requests.at(-1).body, /ProdInfo/);
  });
  test('no company open: falls back to Tally’s own list', async () => {
    tally.quirks.emptyCompanies = true;
    const { api, calls } = fakeApi();
    await makeAgent(tally.port, api).beat();
    assert.match(
      gunzipSync(Buffer.from(calls.heartbeats[0].probe.list, 'base64')).toString('utf16le'),
      /COMPANY NAME="Bench Traders"/,
    );
  });
  test('Tally closed and the port off are told apart by whether it is running', async () => {
    await tally.close();
    const closed = fakeApi();
    await makeAgent(tally.port, closed.api, { running: false }).beat();
    assert.equal(closed.calls.heartbeats[0].state, 'TALLY_CLOSED');
    assert.equal(closed.calls.heartbeats[0].probe, undefined);
    const off = fakeApi();
    await makeAgent(tally.port, off.api, { running: true }).beat();
    assert.equal(off.calls.heartbeats[0].state, 'PORT_OFF');
  });
  test('a jammed Tally reports busy and keeps its heartbeat', async () => {
    tally.quirks.hang = true;
    const { api, calls } = fakeApi();
    await makeAgent(tally.port, api).beat();
    assert.equal(calls.heartbeats[0].state, 'BUSY');
  });
  test('told to stop, it asks Tally nothing at all', async () => {
    let paused = true;
    const { api, calls } = fakeApi({
      heartbeat: () => ({
        config: {},
        paused,
        job: paused ? job([{ read: 'groups', params: base }]) : null,
      }),
    });
    const agent = makeAgent(tally.port, api);
    agent.paused = true;
    await agent.tick();
    assert.equal(tally.requests.length, 0);
    assert.equal(calls.heartbeats[0].state, 'PAUSED');
    paused = false;
    await agent.tick();
    await agent.tick();
    assert.ok(tally.requests.length > 0);
  });
  test('a job: reads, counts, gzips, uploads, deletes only after the server’s reply', async () => {
    const { api, calls } = fakeApi();
    const agent = makeAgent(tally.port, api);
    await agent.spool.ready();
    await agent.runJob(
      job([
        { read: 'groups', count: true, params: base },
        { read: 'godowns', params: base },
      ]),
    );
    const finish = calls.finishes[0];
    assert.equal(finish.body.reads.length, 2);
    assert.equal(finish.body.reads[0].counts.length, 2);
    assert.equal(finish.body.reads[1].counts, undefined);
    const first = calls.chunks.get(`job_abcdef1:${finish.body.reads[0].parts[0].seq}`);
    assert.match(gunzipSync(first).toString('utf16le'), /Sundry Debtors/);
    assert.ok(finish.body.marksAfter);
    assert.equal(
      finish.body.reads[0].parts[0].sha256,
      createHash('sha256').update(first).digest('hex'),
    );
    assert.deepEqual(await agent.spool.pending(), []);
  });
  test('a lost connection keeps the parts; the next run sends only what is left, and reads nothing again', async () => {
    let fail = true;
    const { api, calls } = fakeApi({
      chunk: async () => {
        if (fail) throw new TypeError('fetch failed');
      },
    });
    const spool = new Spool(join(tempDir(), 'spool'));
    const agent = makeAgent(tally.port, api, { spool });
    await spool.ready();
    await agent.runJob(job([{ read: 'groups', params: base }]));
    assert.equal(calls.finishes.length, 0);
    assert.equal((await spool.pending()).length, 1);
    const asked = tally.requests.length;
    // Power cut: a new process, the same spool.
    fail = false;
    const again = makeAgent(tally.port, api, { spool });
    await again.resumeUploads();
    assert.equal(calls.finishes.length, 1);
    assert.equal(tally.requests.length, asked);
    assert.deepEqual(await spool.pending(), []);
  });
  test('a part the server lost is sent again', async () => {
    let tries = 0;
    const { api, calls } = fakeApi({
      finish: async (_id, body) => {
        if (!tries++)
          throw new ApiError(409, 'BRIDGE_PARTS_MISSING', {
            error: { details: { missing: [body.reads[0].parts[0].seq] } },
          });
      },
    });
    const agent = makeAgent(tally.port, api);
    await agent.spool.ready();
    await agent.runJob(job([{ read: 'groups', params: base }]));
    assert.equal(calls.finishes.length, 1);
    assert.equal(tries, 2);
  });
  test('backs off when the server is down, up to fifteen minutes', async () => {
    let clock = 1000;
    const { api } = fakeApi({
      chunk: async () => {
        throw new TypeError('fetch failed');
      },
    });
    const agent = makeAgent(tally.port, api, { now: () => clock });
    await agent.spool.ready();
    await agent.runJob(job([{ read: 'groups', params: base }]));
    assert.equal(agent.uploadHoldUntil, clock + 30000);
    agent.uploadFailures = 20;
    agent.uploadHoldUntil = 0;
    await agent.resumeUploads();
    assert.equal(agent.uploadHoldUntil, clock + 15 * 60000);
  });
  test('a server that has moved on means the spool is simply dropped', async () => {
    const { api } = fakeApi({
      finish: async () => {
        throw new ApiError(409, 'BRIDGE_JOB_CLOSED', null);
      },
    });
    const agent = makeAgent(tally.port, api);
    await agent.spool.ready();
    await agent.runJob(job([{ read: 'groups', params: base }]));
    assert.deepEqual(await agent.spool.pending(), []);
  });
  test('a revoked PC stops for good and wipes what it holds', async () => {
    const { api } = fakeApi({
      heartbeat: () => {
        throw new ApiError(401, 'BRIDGE_REVOKED', null);
      },
    });
    const agent = makeAgent(tally.port, api);
    await agent.spool.ready();
    const dir = agent.spool.jobDir('job_leftover');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'part-0.gz'), 'x');
    await agent.tick();
    assert.equal(agent.stopped, 'REVOKED');
    assert.deepEqual(readdirSync(agent.spool.dir), []);
    const asked = tally.requests.length;
    await agent.tick();
    assert.equal(tally.requests.length, asked);
  });
  test('a bad job reaches Tally not at all, and is reported', async () => {
    const { api, calls } = fakeApi();
    const agent = makeAgent(tally.port, api);
    await agent.spool.ready();
    const asked = tally.requests.length;
    await agent.runJob(job([{ read: 'writeEverything', params: base }]));
    assert.equal(calls.finishes[0].body.error, 'BAD_JOB');
    assert.equal(tally.requests.length, asked);
  });
  test('a job id that is a path is refused, and writes nothing outside the spool', async () => {
    const { api, calls } = fakeApi();
    const agent = makeAgent(tally.port, api);
    await agent.spool.ready();
    await agent.runJob({
      id: '../../../evil',
      kind: 'MASTERS',
      reads: [{ read: 'groups', params: base }],
    });
    assert.equal(calls.finishes[0].body.error, 'AGENT_ERROR');
    assert.deepEqual(readdirSync(agent.spool.dir), []);
  });
  test('a job that is nonsense is refused without a crash', async () => {
    const { api, calls } = fakeApi();
    const agent = makeAgent(tally.port, api);
    await agent.spool.ready();
    await agent.runJob({ id: 'job_abcdef1', kind: 'MASTERS', reads: 'all of it' });
    assert.equal(calls.finishes[0].body.error, 'BAD_JOB');
    assert.equal(tally.requests.length, 0);
  });
  test('a cut-off answer is asked again, then reported', async () => {
    tally.quirks.cutOff = true;
    const { api, calls } = fakeApi();
    const agent = makeAgent(tally.port, api);
    await agent.spool.ready();
    await agent.runJob(job([{ read: 'groups', params: base }]));
    assert.equal(calls.finishes[0].body.error, 'CUT_OFF');
    assert.equal(tally.requests.length, 3);
  });
  test('a count that keeps moving is reported, not guessed at', async () => {
    const { api, calls } = fakeApi();
    const agent = makeAgent(tally.port, api);
    await agent.spool.ready();
    const company = tally.companies[0];
    let n = 0;
    const realSmall = agent.tally.small.bind(agent.tally);
    agent.tally.small = async (xml, max) => {
      if (xml.includes('$$NumItems'))
        company.groups.push({ guid: `g${n++}`, alterId: 1n, name: `G${n}`, parent: '' });
      return realSmall(xml, max);
    };
    await agent.runJob(job([{ read: 'groups', count: true, params: base }]));
    assert.equal(calls.finishes[0].body.error, 'COUNT_UNSTABLE');
  });
  test('three timeouts stop the job for ten minutes', async () => {
    const { api, calls } = fakeApi();
    let clock = 5000;
    const agent = makeAgent(tally.port, api, { now: () => clock });
    await agent.spool.ready();
    tally.quirks.hang = true;
    await agent.runJob(job([{ read: 'groups', params: base }]));
    assert.equal(calls.finishes[0].body.error, 'BUSY');
    assert.equal(agent.holdUntil, clock + 10 * 60000);
  });
  test('a big answer comes apart into parts of at most 512 KB, and goes back together', async () => {
    const company = makeCompany();
    tally.companies = [company];
    for (let index = 0; index < 60000; index++)
      company.godowns.push({
        guid: `g-${index}-${createHash('sha1').update(String(index)).digest('hex')}`,
        name: `Godown ${index}`,
        parent: '',
      });
    const { api, calls } = fakeApi();
    const agent = makeAgent(tally.port, api);
    await agent.spool.ready();
    agent.tally.idleMs = 5000;
    agent.tally.requestMs = 20000;
    await agent.runJob(job([{ read: 'godowns', params: base }]));
    const parts = calls.finishes[0].body.reads[0].parts;
    assert.ok(parts.length >= 1);
    let joined = Buffer.alloc(0);
    for (const part of parts) {
      const bytes = calls.chunks.get(`job_abcdef1:${part.seq}`);
      assert.ok(bytes.length <= 512 * 1024);
      joined = Buffer.concat([joined, gunzipSync(bytes)]);
    }
    assert.equal(joined.length, calls.finishes[0].body.reads[0].bytes);
    assert.match(joined.toString('utf16le'), /Godown 59999/);
  });
  test('Devanagari names travel untouched', async () => {
    tally.companies = [makeCompany({ name: 'शिव ट्रेडर्स' })];
    const { api, calls } = fakeApi();
    const agent = makeAgent(tally.port, api);
    await agent.spool.ready();
    await agent.beat();
    assert.match(unpack(calls.heartbeats[0].probe.companies), /शिव ट्रेडर्स/);
    await agent.runJob(job([{ read: 'groups', params: { ...base, company: 'शिव ट्रेडर्स' } }]));
    assert.equal(calls.finishes[0].body.error, undefined);
  });
  test('the daily cap holds uploads, and they go tomorrow', async () => {
    const { api, calls } = fakeApi();
    const agent = makeAgent(tally.port, api);
    agent.config.dailyCapMb = 0;
    await agent.spool.ready();
    await agent.runJob(job([{ read: 'groups', params: base }]));
    assert.equal(calls.finishes.length, 0);
    assert.equal((await agent.spool.pending()).length, 1);
    agent.config.dailyCapMb = 200;
    await agent.resumeUploads();
    assert.equal(calls.finishes.length, 1);
  });
  test('what it logs holds ids and counts only', async () => {
    const lines = [];
    tally.companies[0].name = 'Bench Traders';
    addLedger(tally.companies[0], {
      guid: 'led-1',
      name: 'SECRET PARTY NAME',
      mobile: '9876500000',
    });
    const { api } = fakeApi();
    const agent = makeAgent(tally.port, api, {
      log: (event, fields) => lines.push(JSON.stringify({ event, ...fields })),
    });
    await agent.spool.ready();
    await agent.runJob(job([{ read: 'parties', params: { ...base, group: 'Sundry Debtors' } }]));
    const text = lines.join('\n');
    assert.ok(lines.length > 0);
    assert.doesNotMatch(text, /SECRET PARTY|9876500000|Bench Traders/);
  });
  test('it notices having been asleep and says so', async () => {
    const { api, calls } = fakeApi();
    let clock = 1000000;
    const agent = makeAgent(tally.port, api, { now: () => clock });
    await agent.beat();
    assert.equal(calls.heartbeats[0].woke, false);
    clock += 8 * 3600000;
    await agent.beat();
    assert.equal(calls.heartbeats[1].woke, true);
  });
});

describe('the signed call', () => {
  const pc = generateKeyPairSync('ed25519');
  const reply = (status, body, headers = {}) =>
    new globalThis.Response(JSON.stringify(body), { status, headers });
  const make = (fetchImpl, state = { deviceId: 'dev1' }, extra = {}) =>
    new BridgeApi({
      base: 'https://api.example',
      privateKey: pc.privateKey,
      state,
      saveState: async () => undefined,
      fetchImpl,
      ...extra,
    });
  test('signs method, path, time, number and the body’s hash', async () => {
    let seen;
    const api = make(async (url, init) => {
      seen = { url, init };
      return reply(201, { ok: true });
    });
    await api.heartbeat({ state: 'OK' });
    const headers = seen.init.headers;
    assert.equal(seen.url, 'https://api.example/api/v1/bridge/heartbeat');
    assert.equal(seen.init.redirect, 'error');
    const digest = createHash('sha256').update(seen.init.body).digest('hex');
    assert.equal(headers['X-Bridge-Body-Sha256'], digest);
    const message = [
      'POST',
      '/api/v1/bridge/heartbeat',
      headers['X-Bridge-Time'],
      headers['X-Bridge-Seq'],
      digest,
    ].join('\n');
    assert.ok(
      verify(
        null,
        Buffer.from(message),
        pc.publicKey,
        Buffer.from(headers['X-Bridge-Signature'], 'base64'),
      ),
    );
  });
  test('each call has a higher number, even if the file holding the last one is lost', async () => {
    const seqs = [];
    const api = make(async (_url, init) => {
      seqs.push(Number(init.headers['X-Bridge-Seq']));
      return reply(201, {});
    });
    await api.heartbeat({});
    await api.heartbeat({});
    assert.ok(seqs[1] > seqs[0]);
    // A new process with the file gone. It starts again from the clock, a moment later.
    await new Promise((resolve) => setTimeout(resolve, 5));
    api.state.seq = 0;
    await api.heartbeat({});
    assert.ok(seqs[2] > seqs[1]);
  });
  test('a wrong clock puts itself right from the reply, once', async () => {
    let calls = 0;
    const real = Date.now();
    const api = make(
      async (_url, init) => {
        calls++;
        if (Math.abs(Number(init.headers['X-Bridge-Time']) - real) > 60000)
          return reply(
            401,
            { error: { code: 'BRIDGE_CLOCK' } },
            { 'x-bridge-server-time': String(real) },
          );
        return reply(201, { ok: true }, { 'x-bridge-server-time': String(real) });
      },
      { deviceId: 'dev1' },
      { now: () => real - 3 * 86400000 },
    );
    assert.deepEqual(await api.heartbeat({}), { ok: true });
    assert.equal(calls, 2);
    assert.ok(Math.abs(api.serverNow() - real) < 1000);
  });
  test('a counter behind the server’s catches up from the reply', async () => {
    let calls = 0;
    const lastSeq = Date.now() * 2000;
    const api = make(async (_url, init) => {
      calls++;
      if (Number(init.headers['X-Bridge-Seq']) <= lastSeq)
        return reply(409, {
          error: { code: 'BRIDGE_REPLAY', details: { lastSeq: String(lastSeq) } },
        });
      return reply(201, { ok: true });
    });
    assert.deepEqual(await api.heartbeat({}), { ok: true });
    assert.equal(calls, 2);
  });
  test('a server that keeps refusing is an error, not an endless loop', async () => {
    let calls = 0;
    const api = make(async () => {
      calls++;
      return reply(401, { error: { code: 'BRIDGE_CLOCK' } });
    });
    await assert.rejects(api.heartbeat({}), (error) => error.code === 'BRIDGE_CLOCK');
    assert.equal(calls, 3);
  });
  test('a reply that is not JSON is an error with its status, not a crash', async () => {
    const api = make(
      async () => new globalThis.Response('<html>Bad gateway</html>', { status: 502 }),
    );
    await assert.rejects(api.heartbeat({}), (error) => error.code === 'HTTP_502');
  });
  test('the identity file is made once, and kept', async () => {
    const dir = tempDir();
    const first = publicKeyOf(await loadIdentity(dir));
    assert.equal(publicKeyOf(await loadIdentity(dir)), first);
    assert.equal(statSync(join(dir, 'identity.pem')).mode & 0o077, 0);
    await saveIdentity(dir, newIdentity());
    assert.notEqual(publicKeyOf(await loadIdentity(dir)), first);
  });
});

describe('the command line', () => {
  test('without a code and an address it says how, and changes nothing', async () => {
    const dataDir = tempDir();
    const env = { SHIV_BRIDGE_DATA: dataDir };
    assert.equal(await cli(['pair'], env), 2);
    assert.equal(await cli(['pair', '123'], env), 2);
    assert.equal(await cli(['pair', '12345678'], env), 2);
    assert.equal(await cli(['nonsense'], env), 2);
    assert.ok(!existsSync(join(dataDir, 'identity.pem')));
  });
  test('run before pairing says so', async () => {
    assert.equal(await cli(['run'], { SHIV_BRIDGE_DATA: tempDir() }), 2);
  });
  test('plain http is refused, and the old key is kept until the server takes a new one', async () => {
    const dataDir = tempDir();
    const before = publicKeyOf(await loadIdentity(dataDir));
    await assert.rejects(
      cli(['pair', '12345678', '--api', 'http://api.example'], { SHIV_BRIDGE_DATA: dataDir }),
      /https/,
    );
    assert.equal(publicKeyOf(await loadIdentity(dataDir)), before);
    assert.ok(!existsSync(join(dataDir, 'config.json')));
  });
});

describe('the API address', () => {
  test('only https, and never a password in it', () => {
    assert.equal(checkedBase('https://api.example/x'), 'https://api.example');
    assert.throws(() => checkedBase('http://api.example'));
    assert.throws(() => checkedBase('http://127.0.0.1:4000'));
    assert.equal(
      checkedBase('http://127.0.0.1:4000', { allowLoopbackHttp: true }),
      'http://127.0.0.1:4000',
    );
    assert.throws(() => checkedBase('http://api.example', { allowLoopbackHttp: true }));
    assert.throws(() => checkedBase('https://u:p@api.example'));
    assert.throws(() => checkedBase('ftp://api.example'));
  });
  test('a public key is the public half', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    assert.equal(
      publicKeyOf(privateKey),
      publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    );
  });
});

describe('signed updates', () => {
  const pair = generateKeyPairSync('ed25519');
  const publicKeyPem = pair.publicKey.export({ format: 'pem', type: 'spki' });
  const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
  function release(
    version = '1.1.0',
    files = { 'main.mjs': 'export {};\n' },
    key = pair.privateKey,
    manifestVersion = version,
  ) {
    const encoded = Object.fromEntries(
      Object.entries(files).map(([name, text]) => [name, Buffer.from(text).toString('base64')]),
    );
    const manifest = JSON.stringify({
      version: manifestVersion,
      files: Object.fromEntries(
        Object.entries(files).map(([name, text]) => [name, sha(Buffer.from(text))]),
      ),
    });
    return {
      version,
      manifest,
      signature: sign(null, Buffer.from(manifest), key).toString('base64'),
      files: encoded,
    };
  }
  const check = (made, version = '1.1.0', currentVersion = '1.0.0') =>
    checkRelease({ release: made, version, currentVersion, publicKeyPem });
  const refused = (fn, why) =>
    assert.throws(fn, (error) => error instanceof UpdateRefused && error.message === why);

  test('a properly signed newer release passes', () => {
    assert.equal(check(release()).size, 1);
  });
  test('signed by another key: refused', () => {
    const stranger = generateKeyPairSync('ed25519');
    refused(() => check(release('1.1.0', undefined, stranger.privateKey)), 'BAD_SIGNATURE');
  });
  test('a file changed after signing: refused', () => {
    const made = release();
    made.files['main.mjs'] = Buffer.from('process.exit(1)').toString('base64');
    refused(() => check(made), 'FILE_CHANGED');
  });
  test('a file added after signing: refused', () => {
    const made = release();
    made.files['extra.mjs'] = Buffer.from('x').toString('base64');
    refused(() => check(made), 'FILES_DIFFER');
  });
  test('an old release, even properly signed: refused', () => {
    refused(() => check(release('0.9.0'), '0.9.0'), 'NOT_NEWER');
    refused(() => check(release('1.0.0'), '1.0.0'), 'NOT_NEWER');
  });
  test('the manifest’s version must be the one asked for', () => {
    refused(() => check(release('1.1.0', undefined, pair.privateKey, '9.9.9')), 'WRONG_VERSION');
  });
  test('a file name cannot climb out of its folder', () => {
    refused(
      () => check(release('1.1.0', { 'main.mjs': 'x', '../../evil.mjs': 'y' })),
      'BAD_FILE_NAME',
    );
  });
  test('with no key on the PC, nothing updates', () => {
    assert.throws(
      () =>
        checkRelease({
          release: release(),
          version: '1.1.0',
          currentVersion: '1.0.0',
          publicKeyPem: null,
        }),
      (error) => error.message === 'NO_KEY',
    );
  });
  test('versions compare as numbers', () => {
    assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
    assert.ok(compareVersions('1.0.0', '1.0.1') < 0);
    assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
  });
  test('the updater unpacks a good one and hands over; a bad one once, then never again', async () => {
    const dataDir = tempDir();
    let ready = 0;
    const updater = new Updater({
      dataDir,
      currentVersion: '1.0.0',
      publicKeyPem,
      onReady: () => ready++,
    });
    assert.equal(await updater.take('1.1.0', { release: async () => release() }), true);
    assert.equal(ready, 1);
    assert.equal(JSON.parse(readFileSync(join(dataDir, 'pending.json'), 'utf8')).version, '1.1.0');
    assert.ok(existsSync(join(dataDir, 'versions', '1.1.0', 'main.mjs')));
    let asked = 0;
    const bad = new Updater({ dataDir: tempDir(), currentVersion: '1.0.0', publicKeyPem });
    const api = {
      release: async () => {
        asked++;
        const made = release();
        made.signature = release('1.2.0').signature;
        return made;
      },
    };
    assert.equal(await bad.take('1.1.0', api), false);
    assert.equal(await bad.take('1.1.0', api), false);
    assert.equal(asked, 1);
  });
  test('a bad version that never reports healthy is rolled back after three tries', async () => {
    const dataDir = tempDir();
    mkdirSync(join(dataDir, 'versions', '1.1.0'), { recursive: true });
    writeFileSync(join(dataDir, 'pending.json'), JSON.stringify({ version: '1.1.0' }));
    const ran = [];
    const { state } = await launch({
      dataDir,
      waitMs: 0,
      maxRuns: 5,
      runner: async (_dir, version) => {
        ran.push(version);
        return 1;
      },
    });
    assert.deepEqual(ran, ['1.1.0', '1.1.0', '1.1.0', 'base', 'base']);
    assert.equal(state.current, 'base');
    assert.equal(readFileSync(join(dataDir, 'update-failed.txt'), 'utf8'), '1.1.0');
    assert.ok(!existsSync(join(dataDir, 'versions', '1.1.0')));
  });
  test('a good version is kept, and becomes the one to run', async () => {
    const dataDir = tempDir();
    writeFileSync(join(dataDir, 'pending.json'), JSON.stringify({ version: '1.1.0' }));
    const ran = [];
    const { state } = await launch({
      dataDir,
      waitMs: 0,
      maxRuns: 3,
      runner: async (dir, version) => {
        ran.push(version);
        if (version === '1.1.0') writeFileSync(join(dir, 'healthy-1.1.0'), '');
        return version === '1.1.0' ? EXIT_UPDATE_READY : 1;
      },
    });
    assert.deepEqual(ran, ['1.1.0', '1.1.0', '1.1.0']);
    assert.equal(state.current, '1.1.0');
  });
  test('revoked means stopped: the launcher does not bring it back', async () => {
    const dataDir = tempDir();
    let runs = 0;
    const result = await launch({
      dataDir,
      waitMs: 0,
      maxRuns: 5,
      runner: async () => {
        runs++;
        return EXIT_STOPPED;
      },
    });
    assert.equal(result.stopped, true);
    assert.equal(runs, 1);
  });
  test('the release tool signs what the program will accept, and only for the version it says', () => {
    const made = makeRelease({
      version: AGENT_VERSION,
      keyPem: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }),
      sourceDir: new URL('../src/', import.meta.url).pathname,
    });
    const files = checkRelease({
      release: made,
      version: AGENT_VERSION,
      currentVersion: '0.0.1',
      publicKeyPem,
    });
    assert.ok(files.has('main.mjs'));
    assert.ok(files.has('launcher.mjs'));
    assert.throws(() =>
      makeRelease({
        version: '9.9.9',
        keyPem: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }),
        sourceDir: new URL('../src/', import.meta.url).pathname,
      }),
    );
  });
  test('with real processes: a version that crashes goes, and the old one comes back', async () => {
    const dataDir = tempDir();
    const version = join(dataDir, 'versions', '1.1.0');
    mkdirSync(version, { recursive: true });
    writeFileSync(join(version, 'main.mjs'), 'process.exit(1);\n');
    writeFileSync(join(dataDir, 'pending.json'), JSON.stringify({ version: '1.1.0' }));
    const { state } = await launch({ dataDir, waitMs: 0, maxRuns: 4 });
    assert.equal(state.current, 'base');
    assert.equal(state.pending, null);
    assert.equal(readFileSync(join(dataDir, 'update-failed.txt'), 'utf8'), '1.1.0');
    assert.ok(!existsSync(version));
  });
  test('nextRun with nothing pending runs what it has', () => {
    assert.equal(nextRun({ current: 'base', pending: null }).run, 'base');
  });
});

/** A tiny but real program file with a version resource, as a linker would lay it out. */
function peWithVersion(major, minor, patch, build) {
  const sectionAt = 0x400;
  const rva = 0x1000;
  const resource = Buffer.alloc(0x200);
  const directory = (at, id, target) => {
    resource.writeUInt16LE(1, at + 14); // one id entry
    resource.writeUInt32LE(id, at + 16);
    resource.writeUInt32LE(target, at + 20);
  };
  directory(0x00, 16, 0x80000018); // type: RT_VERSION
  directory(0x18, 1, 0x80000030); // name: 1
  directory(0x30, 1033, 0x48); // language
  resource.writeUInt32LE(rva + 0x60, 0x48); // data rva
  resource.writeUInt32LE(0x80, 0x4c); // data size
  resource.writeUInt32LE(0xfeef04bd, 0x60 + 40);
  resource.writeUInt32LE((major << 16) | minor, 0x60 + 48);
  resource.writeUInt32LE((patch << 16) | build, 0x60 + 52);
  const head = Buffer.alloc(sectionAt);
  head.write('MZ', 0, 'ascii');
  head.writeUInt32LE(0x80, 0x3c);
  head.write('PE\0\0', 0x80, 'ascii');
  head.writeUInt16LE(1, 0x80 + 6); // one section
  head.writeUInt16LE(240, 0x80 + 20); // optional header size
  head.writeUInt16LE(0x20b, 0x80 + 24); // PE32+
  head.writeUInt32LE(rva, 0x80 + 24 + 112 + 16); // resource directory rva
  const section = 0x80 + 24 + 240;
  head.writeUInt32LE(resource.length, section + 8);
  head.writeUInt32LE(rva, section + 12);
  head.writeUInt32LE(resource.length, section + 16);
  head.writeUInt32LE(sectionAt, section + 20);
  return Buffer.concat([head, resource]);
}

describe('reading tally.exe’s version', () => {
  test('from the file alone', async () => {
    const path = join(tempDir(), 'tally.exe');
    writeFileSync(path, peWithVersion(7, 1, 0, 42));
    assert.equal(await fileVersion(path), '7.1.0.42');
  });
  test('not a program, or no such file: nothing, and no crash', async () => {
    const path = join(tempDir(), 'note.txt');
    writeFileSync(path, 'hello');
    assert.equal(await fileVersion(path), null);
    assert.equal(await fileVersion(join(tempDir(), 'missing.exe')), null);
  });
  test('a program with its tables cut off: nothing, and no crash', async () => {
    const path = join(tempDir(), 'tally.exe');
    writeFileSync(path, peWithVersion(7, 1, 0, 42).subarray(0, 0x100));
    assert.equal(await fileVersion(path), null);
  });
});

describe('the check tool', () => {
  const probes = (extra = {}) => ({
    pc: async () => ({
      windows: 'Windows 10 Pro',
      arch: 'x64',
      ramGb: 8,
      freeDiskGb: 100,
      antivirus: 'Test Antivirus',
      sleepAfterMinutes: 30,
      clockSeconds: 2,
      tls: 'ok',
    }),
    tallyFile: async () => ({
      running: true,
      found: true,
      folder: 'C:\\TallyPrime',
      version: '7.1.0.0',
      iniPort: null,
      dataPathSet: true,
    }),
    lanAddresses: () => [],
    ...extra,
  });
  const quick = { months: 2, pauseMs: 0, today: new Date('2026-11-05T06:00:00Z') };
  let tally;
  afterEach(async () => {
    await tally?.close().catch(() => undefined);
    tally = null;
  });
  const shopWorld = () => {
    const company = makeCompany();
    addLedger(company, {
      guid: 'd1',
      name: 'SECRET PARTY ONE',
      mobile: '9876500001',
      billWise: true,
    });
    addLedger(company, { guid: 'd2', name: 'राम सीमेंट', mobile: '', billWise: false });
    addLedger(company, { guid: 'c1', name: 'SECRET SUPPLIER', class: 'CREDITOR' });
    sale(company, {
      guid: 'v1',
      date: '2026-11-01',
      party: 'SECRET PARTY ONE',
      paise: 12345678n,
      type: 'GST Sale',
    });
    sale(company, { guid: 'v2', date: '2026-10-05', party: 'राम सीमेंट', paise: 55500n });
    receipt(company, { guid: 'v3', date: '2026-11-02', party: 'SECRET PARTY ONE', paise: 100000n });
    return company;
  };

  test('Tally open: names it, sizes it, and says the bridge can run', async () => {
    tally = new FakeTally({ companies: [shopWorld()] });
    const port = await tally.listen();
    const report = await runCheck({ ports: [port], probes: probes(), ...quick });
    assert.match(
      report.sentence,
      /^TallyPrime 7\.1 Silver, licensed, 1 company open, about 3 vouchers this year, bridge can run\.$/,
    );
    const shape = report.shape[0];
    assert.equal(shape.debtors, 2);
    assert.equal(shape.creditors, 1);
    assert.equal(shape.mobilePercent, 50);
    assert.equal(shape.billWisePercent, 50);
    assert.deepEqual(shape.customTypes, ['GST Sale']);
    assert.equal(shape.carriesStockLines, true);
    assert.equal(shape.months[0].counts.Sales, 1);
    assert.equal(shape.months[0].counts.Receipt, 1);
  });
  test('its report holds no party name, amount or phone number', async () => {
    tally = new FakeTally({ companies: [shopWorld()] });
    const port = await tally.listen();
    const html = renderReport(await runCheck({ ports: [port], probes: probes(), ...quick }));
    assert.match(html, /Bench Traders/);
    for (const secret of ['SECRET', 'राम', '9876500001', '123456', '1,23', '555.00', '1000.00'])
      assert.ok(!html.includes(secret), secret);
  });
  test('its report shows a hostile company name as plain text', async () => {
    tally = new FakeTally({ companies: [makeCompany({ name: '<script>alert(1)</script>' })] });
    const port = await tally.listen();
    const html = renderReport(await runCheck({ ports: [port], probes: probes(), ...quick }));
    assert.ok(!html.includes('<script>alert'));
    assert.ok(html.includes('&lt;script&gt;'));
  });
  test('it only ever asks: every request is an Export, and the marks do not move', async () => {
    tally = new FakeTally({ companies: [shopWorld()] });
    const port = await tally.listen();
    const report = await runCheck({ ports: [port], probes: probes(), ...quick });
    assert.equal(report.proof.moved, false);
    assert.equal(tally.writeAttempts ?? 0, 0);
    assert.ok(tally.requests.length > 10);
    assert.ok(
      tally.requests.every((row) => row.body.includes('<TALLYREQUEST>Export</TALLYREQUEST>')),
    );
  });
  test('the accountant working during the check is said plainly', async () => {
    const company = shopWorld();
    tally = new FakeTally({ companies: [company] });
    const port = await tally.listen();
    const realRender = tally.render.bind(tally);
    let moved = 0;
    tally.render = (body, quirks) => {
      if (body.includes('voucherTypes') || (body.includes('<TYPE>VoucherType') && !moved++))
        company.altVchId += 1n;
      return realRender(body, quirks);
    };
    const report = await runCheck({ ports: [port], probes: probes(), ...quick });
    assert.equal(report.proof.moved, true);
    assert.match(renderReport(report), /the accountant was working/);
  });
  test('Tally closed or the port off: still useful, says how to turn it on, changes nothing', async () => {
    const report = await runCheck({
      ports: [1],
      probes: probes({
        tallyFile: async () => ({
          running: false,
          found: true,
          folder: 'C:\\TallyPrime',
          version: '7.1.0.0',
          iniPort: null,
          dataPathSet: false,
        }),
      }),
      ...quick,
    });
    assert.match(
      report.sentence,
      /Bridge cannot run yet: the Tally port is off or Tally is closed\./,
    );
    const html = renderReport(report);
    assert.match(html, /F1 &gt; Settings &gt; Connectivity/);
    assert.match(html, /F12 &gt; Advanced Configuration/);
    assert.match(html, /file version 7\.1\.0\.0/);
  });
  test('no company open: says so, with what Tally knows of', async () => {
    tally = new FakeTally({ companies: [], listed: ['Bench Traders'], quirks: {} });
    const port = await tally.listen();
    const report = await runCheck({ ports: [port], probes: probes(), ...quick });
    assert.match(report.sentence, /no company is open/);
    assert.equal(report.listedOnly, 1);
    assert.equal(report.canRun, false);
  });
  test('two companies: sizes both', async () => {
    tally = new FakeTally({
      companies: [shopWorld(), makeCompany({ guid: 'co-2', name: 'Bench Traders Dukaan 2' })],
    });
    const port = await tally.listen();
    const report = await runCheck({ ports: [port], probes: probes(), ...quick });
    assert.match(report.sentence, /2 companies open/);
    assert.equal(report.shape.length, 2);
  });
  test('a jammed Tally: stops asking at the stage it was on, and says so', async () => {
    tally = new FakeTally({ companies: [shopWorld()], quirks: { hang: true } });
    const port = await tally.listen();
    const report = await runCheck({
      ports: [port],
      probes: probes(),
      clientFor: (p) => new TallyClient({ port: p, idleMs: 100, requestMs: 300 }),
      ...quick,
    });
    assert.equal(report.stoppedEarly.stage, 'identity');
    assert.equal(report.stoppedEarly.why, 'BUSY');
  });
  test('educational mode stops the green light', async () => {
    tally = new FakeTally({
      companies: [shopWorld()],
      product: { educational: true, licensed: false },
    });
    const port = await tally.listen();
    const report = await runCheck({ ports: [port], probes: probes(), ...quick });
    assert.match(report.sentence, /educational mode/);
    assert.equal(report.canRun, false);
  });
  test('ERP 9 is named as ERP 9', () => {
    assert.equal(
      productName({ bare: 'Tally.ERP 9 Server is Running', release: '' }).family,
      'erp9',
    );
    assert.equal(productName({ exeVersion: '6.6.3.0' }).label, 'Tally, file version 6.6.3.0');
  });
  test('a port open to other PCs is reported', async () => {
    tally = new FakeTally({ companies: [shopWorld()] });
    const port = await tally.listen();
    const report = await runCheck({
      ports: [port],
      probes: probes({ lanAddresses: () => ['127.0.0.1'] }),
      ...quick,
    });
    assert.equal(report.exposure.openToLan, true);
    assert.match(renderReport(report), /the accountant decides on a firewall rule/);
  });
  test('the command writes one page to Documents, and makes the folder if it is not there', async () => {
    const home = tempDir();
    assert.equal(await checkMain([], { USERPROFILE: home }, { ports: [1], pauseMs: 0 }), 0);
    const pages = readdirSync(join(home, 'Documents'));
    assert.equal(pages.length, 1);
    assert.match(pages[0], /^ShivTallyCheck-.*\.html$/);
    assert.match(readFileSync(join(home, 'Documents', pages[0]), 'utf8'), /Tally check/);
  });
  test('the clock and the secure connection are checked against our server, when given', async () => {
    const seen = [];
    const probe = makeProbes({ run: async () => null, paths: { documents: tempDir() } });
    const pc = await probe.pc('https://api.example', async (url) => {
      seen.push(url);
      return new globalThis.Response(JSON.stringify({ serverNow: new Date().toISOString() }));
    });
    assert.deepEqual(seen, ['https://api.example/api/v1/bridge/time']);
    assert.equal(pc.tls, 'ok');
    assert.ok(Math.abs(pc.clockSeconds) < 5);
    const failed = await probe.pc('https://api.example', async () => {
      throw new TypeError('certificate has expired');
    });
    assert.equal(failed.tls, 'failed');
  });
  test('garbled answers give no rows and no crash', () => {
    assert.deepEqual(flatRows(Buffer.from('<ENVELOPE><F02')), []);
    assert.deepEqual(flatRows(Buffer.from('<!DOCTYPE x><ENVELOPE><F01>a</F01></ENVELOPE>')), []);
  });
  test('real probes read a tally folder, and never write', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'tally.exe'), peWithVersion(6, 6, 3, 0));
    writeFileSync(join(dir, 'tally.ini'), 'Data=C:\\Data\nServerPort=9005\n');
    const before = readFileSync(join(dir, 'tally.ini'), 'utf8');
    const probe = makeProbes({
      run: async () => null,
      paths: { tallyFolders: [dir], documents: dir },
    });
    const seen = await probe.tallyFile();
    assert.equal(seen.version, '6.6.3.0');
    assert.equal(seen.iniPort, 9005);
    assert.equal(seen.dataPathSet, true);
    assert.equal(readFileSync(join(dir, 'tally.ini'), 'utf8'), before);
    const pc = await probe.pc(null);
    assert.equal(pc.antivirus, 'could not read');
    assert.equal(pc.tls, 'not tried');
  });
});

describe('the spool', () => {
  test('refuses a job id that is a path', () => {
    const spool = new Spool(tempDir());
    assert.throws(() => spool.jobDir('../../etc'));
    assert.throws(() => spool.jobDir('a/b'));
  });
  test('says when it is full, so fetching pauses', async () => {
    const dir = tempDir();
    const spool = new Spool(dir, { capBytes: 10 });
    assert.equal(await spool.full(), false);
    mkdirSync(join(dir, 'job_abcdef1'));
    writeFileSync(join(dir, 'job_abcdef1', 'part-0.gz'), 'x'.repeat(20));
    assert.equal(await spool.full(), true);
  });
  test('an agent with a full spool says so and asks Tally nothing', async () => {
    const tally = new FakeTally();
    await tally.listen();
    const dir = tempDir();
    const spool = new Spool(dir, { capBytes: 1 });
    mkdirSync(join(dir, 'job_abcdef1'));
    writeFileSync(join(dir, 'job_abcdef1', 'part-0.gz'), 'xx');
    const { api, calls } = fakeApi();
    const agent = makeAgent(tally.port, api, { spool });
    await agent.beat();
    assert.equal(calls.heartbeats[0].state, 'SPOOL_FULL');
    assert.equal(tally.requests.length, 0);
    await tally.close();
  });
  test('an answer the power cut off is cleared out, so it can never fill the disk', async () => {
    const dir = tempDir();
    const spool = new Spool(dir);
    mkdirSync(join(dir, 'job_orphan1'));
    writeFileSync(join(dir, 'job_orphan1', 'answer-0.tmp'), 'x');
    mkdirSync(join(dir, 'job_kept001'));
    writeFileSync(join(dir, 'job_kept001', 'manifest.json'), '{}');
    await spool.sweepOrphans(Date.now() + 1000);
    assert.deepEqual(readdirSync(dir), ['job_kept001']);
  });
  test('a half-written manifest does not stop the others', async () => {
    const dir = tempDir();
    const spool = new Spool(dir);
    mkdirSync(join(dir, 'job_broken1'));
    writeFileSync(join(dir, 'job_broken1', 'manifest.json'), '{half');
    mkdirSync(join(dir, 'job_good001'));
    writeFileSync(
      join(dir, 'job_good001', 'manifest.json'),
      JSON.stringify({ id: 'job_good001', reads: {}, uploaded: {} }),
    );
    assert.deepEqual(
      (await spool.pending()).map((row) => row.id),
      ['job_good001'],
    );
  });
});
