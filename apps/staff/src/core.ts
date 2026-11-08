import Constants from 'expo-constants';
import { useSyncExternalStore } from 'react';
import { createApi, ApiError, isNetworkError, requestTimeoutMs, type Tokens } from './logic/api';
import {
  betterFix,
  fixWaitMs,
  linkProofToSign,
  linkVerifyToSign,
  locationFields,
  punchBody,
  punchToSign,
  type Fix,
  type FixState,
  type LocationStatus,
  type PunchCapture,
  type PunchKind,
} from './logic/capture';
import type { Today } from './logic/hazri';
import { linkStage, revokedScreen, type LinkState } from './logic/link';
import {
  createQueue,
  type QueueEntry,
  type QueuePhoto,
  type SendReply,
  type Verdict,
} from './logic/queue';
import { serverNow, syncClock, type ClockBase } from './logic/time';
import {
  cachePrefix,
  clockKey,
  cutOffKey,
  languageKey,
  queueKey,
  wipeEverything,
} from './logic/wipe';
import { readLanguage } from '@shiv/i18n';
import { firstLanguage, makeTr, type Language, type Tr } from './logic/words';
import { bootCount, modelInfo, mono, publicKey, signText } from './platform/device';
import { watchLocation, readLocationOnce } from './platform/location';
import { deleteAllPhotos, deletePhoto, keepPhoto, uploadPhoto } from './platform/photos';
import { deleteSecret, getSecret, setSecret } from './platform/secure';
import { clearAllExceptSurvivors, readJson, removeItem, writeJson } from './platform/storage';

export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
const appVersion = Constants.expoConfig?.version ?? '0';
const secretKey = 'staff_session';

export type Stage =
  | 'BOOT'
  | 'NUMBER'
  | 'CODE'
  | 'YOURS'
  | 'NOTICE'
  | 'WAITING'
  | 'NEW_PHONE'
  | 'REFUSED'
  | 'CUT_OFF'
  | 'READY';

export type AppState = {
  stage: Stage;
  language: Language;
  tr: Tr;
  phone: string;
  reason: string;
  devCode: string;
  link: LinkState | null;
  today: Today | null;
  clock: ClockBase | null;
  offline: boolean;
  entries: QueueEntry[];
  failures: { id: string; kind: string; code: string }[];
  /** A scan that was answered after the screen moved on, shown over whatever is open. */
  lateAnswer: { body: unknown; refused?: string } | null;
  fix: { status: LocationStatus; has: boolean };
};

let state: AppState = {
  stage: 'BOOT',
  language: firstLanguage,
  tr: makeTr(firstLanguage),
  phone: '',
  reason: '',
  devCode: '',
  link: null,
  today: null,
  clock: null,
  offline: false,
  entries: [],
  failures: [],
  lateAnswer: null,
  fix: { status: 'OK', has: false },
};
const listeners = new Set<() => void>();
function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}
export const useApp = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
export const getApp = () => state;

// ---- Session ------------------------------------------------------------------------------------
let tokens: (Tokens & { userId: string }) | null = null;
async function saveTokens(next: Tokens & { userId: string }) {
  tokens = next;
  await setSecret(secretKey, JSON.stringify(next));
}
async function forgetTokens() {
  tokens = null;
  await deleteSecret(secretKey);
}

export const api = createApi({
  baseUrl: API_URL,
  fetch: (url, init) => fetch(url, init),
  getTokens: () => tokens,
  // A renewal answered after a wipe must not bring the session back.
  setTokens: async (pair) => {
    if (tokens) await saveTokens({ ...pair, userId: tokens.userId });
  },
  sign: signText,
  onRevoked: () => cutOff(),
  onSignedOut: async () => {
    await forgetTokens();
    set({ stage: 'NUMBER', link: null });
  },
});

// ---- The queue ----------------------------------------------------------------------------------
const watchers = new Map<string, (reply: SendReply, verdict: Verdict) => void>();
const replyOf = (error: unknown): SendReply => {
  if (error instanceof ApiError)
    return {
      ok: false,
      code: error.code,
      ...(error.status === undefined ? {} : { status: error.status }),
    };
  return { ok: false, code: 'NETWORK' };
};
const queue = createQueue({
  load: () => readJson(queueKey),
  save: (saved) => writeJson(queueKey, saved),
  async send(entry, body) {
    try {
      const reply = await api.request<unknown>(entry.method, entry.path, body);
      noteOnline(true);
      return { ok: true, body: reply };
    } catch (error) {
      if (isNetworkError(error)) noteOnline(false);
      return replyOf(error);
    }
  },
  upload: uploadEvidence,
  async prepare(entry, age) {
    if (entry.kind === 'punch') {
      const body = punchBody(entry.body as unknown as PunchCapture, age);
      return { ...body, signature: await signText(punchToSign(body)) };
    }
    return entry.claimsAge ? { ...entry.body, claimedAgeMs: age } : entry.body;
  },
  deletePhoto,
  mono,
  boot: bootCount,
  now: mono,
  onChange: () =>
    set({
      entries: queue.entries(),
      failures: queue.failures().map(({ id, kind, code }) => ({ id, kind, code })),
    }),
  onResult(entry, reply, verdict) {
    const watcher = watchers.get(entry.id);
    if (watcher) {
      watcher(reply, verdict);
      return;
    }
    // Answered with nobody waiting on this screen: a scan's answer is still shown.
    if (entry.kind !== 'punch') return;
    if (reply.ok) set({ lateAnswer: { body: reply.body } });
    else if (verdict === 'failed') {
      void queue.dismiss(entry.id);
      set({ lateAnswer: { body: null, refused: reply.code } });
    }
  },
  onStop(reason) {
    if (reason === 'notice') set({ stage: 'NOTICE' });
    if (reason === 'notlinked') void refreshLink();
  },
});

async function uploadEvidence(photo: QueuePhoto) {
  const query = `kind=${photo.kind}${photo.locationId ? `&locationId=${encodeURIComponent(photo.locationId)}` : ''}`;
  const url = `${API_URL}/staff/evidence?${query}`;
  const attempt = async () => {
    const timer = new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error('timeout')), 60000),
    );
    return Promise.race([uploadPhoto(url, tokens?.access ?? '', photo.uri), timer]);
  };
  try {
    let reply = await attempt();
    if (reply.status === 401) {
      const code = parseCode(reply.body);
      if (code === 'DEVICE_REVOKED') {
        await cutOff();
        return { ok: false as const, code, status: 401 };
      }
      await api.renew();
      reply = await attempt();
    }
    if (reply.status >= 200 && reply.status < 300)
      return { ok: true as const, id: (JSON.parse(reply.body) as { id: string }).id };
    return {
      ok: false as const,
      code: parseCode(reply.body) ?? `HTTP_${reply.status}`,
      status: reply.status,
    };
  } catch (error) {
    if (error instanceof ApiError)
      return {
        ok: false as const,
        code: error.code,
        ...(error.status === undefined ? {} : { status: error.status }),
      };
    return { ok: false as const, code: 'NETWORK' };
  }
}
const parseCode = (body: string) => {
  try {
    return (JSON.parse(body) as { error?: { code?: string } }).error?.code;
  } catch {
    return undefined;
  }
};
export const newId = () =>
  // Hermes has no crypto.randomUUID. These only need to be unique, since the server ties each one
  // to its person and its record: guessing one gets nobody anything.
  globalThis.crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 3) | 8).toString(16);
  });
export const flush = () => queue.flush();
export const dismissFailure = (id: string) => queue.dismiss(id);
export const clearLateAnswer = () => set({ lateAnswer: null });

export type StepResult =
  | { how: 'sent'; reply: unknown }
  | { how: 'saved'; why: 'offline' | 'slow' }
  | { how: 'refused'; code: string }
  | { how: 'notSaved' };
/** Saves a step on the phone, sends it, and says within 8 seconds where it stands. */
export async function runStep(
  entry: Omit<QueueEntry, 'mono' | 'boot' | 'carriedMs' | 'rebooted' | 'userId'>,
  options: { waitMs?: number; keepWatching?: (result: StepResult) => void } = {},
): Promise<StepResult> {
  const saved = await queue.add({ ...entry, userId: tokens?.userId ?? '' });
  if (!saved) {
    // The phone could not keep it, so it must go now or it is lost, and the person is told.
    const result = await waitFor(entry.id, options.waitMs ?? 8000);
    if (result.how === 'saved') {
      await queue.remove(entry.id);
      return { how: 'notSaved' };
    }
    return result;
  }
  return waitFor(entry.id, options.waitMs ?? 8000, options.keepWatching);
}
function waitFor(
  id: string,
  waitMs: number,
  keepWatching?: (result: StepResult) => void,
): Promise<StepResult> {
  return new Promise((resolve) => {
    let told = false;
    const finish = (result: StepResult) => {
      if (told) {
        // The first answer was "saved", and this is what happened in the end.
        if (result.how === 'saved') return;
        watchers.delete(id);
        keepWatching?.(result);
        return;
      }
      told = true;
      clearTimeout(timer);
      if (!keepWatching || result.how !== 'saved') watchers.delete(id);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ how: 'saved', why: 'slow' }), waitMs);
    watchers.set(id, (reply, verdict) => {
      if (reply.ok || verdict === 'done')
        finish({ how: 'sent', reply: reply.ok ? reply.body : null });
      else if (verdict === 'failed') {
        void queue.dismiss(id);
        finish({ how: 'refused', code: reply.code });
      } else finish({ how: 'saved', why: 'offline' });
    });
    void queue.flush().then(() => {
      // Held behind an earlier one that cannot go yet.
      if (!told && queue.entries().some((row) => row.id === id))
        finish({ how: 'saved', why: 'offline' });
    });
  });
}
export const stopWatching = (id: string) => watchers.delete(id);

let backgroundTimer: ReturnType<typeof setInterval> | null = null;
/** Keeps trying while the app is open. There is no sending with the app closed. */
export function startSender() {
  if (backgroundTimer) return;
  let ticks = 0;
  backgroundTimer = setInterval(() => {
    if (state.stage !== 'READY') return;
    ticks++;
    if (queue.entries().length) void queue.flush();
    // Ask soon when the signal is gone, and once a minute anyway: a phone cut off while it sits
    // open must find out and wipe, with nobody touching it.
    else if (state.offline || ticks % 4 === 0) void refreshToday().catch(() => {});
  }, 15000);
}
export function noteOnline(online: boolean) {
  if (state.offline === !online) return;
  set({ offline: !online });
  if (online && queue.entries().length && state.stage === 'READY') void queue.flush();
}

// ---- Cached reads -------------------------------------------------------------------------------
export const cacheKey = (name: string) => `${cachePrefix}${tokens?.userId ?? 'none'}:${name}`;
export async function readCache<T>(name: string) {
  return readJson<T>(cacheKey(name));
}
/** Nothing is kept for nobody: a reply that lands after a wipe is dropped, not written back. */
export async function writeCache(name: string, value: unknown) {
  if (!tokens) return;
  await writeJson(cacheKey(name), value).catch(() => {});
}
/** The last copy now, then a fresh one. With no signal the last copy simply stays. */
export async function fetchFresh<T, K = T>(
  name: string,
  path: string,
  keep: (reply: T) => K = (reply) => reply as unknown as K,
): Promise<{ value: K | null; fresh: boolean; error?: ApiError }> {
  const asked = tokens?.userId;
  try {
    const reply = await api.request<T>('GET', path);
    noteOnline(true);
    if (tokens?.userId !== asked) return { value: null, fresh: false };
    const value = keep(reply);
    await writeCache(name, value);
    return { value, fresh: true };
  } catch (error) {
    if (isNetworkError(error)) noteOnline(false);
    return {
      value: await readCache<K>(name),
      fresh: false,
      ...(error instanceof ApiError ? { error } : {}),
    };
  }
}

// ---- Sign-in and linking ------------------------------------------------------------------------
/** Everything that goes when the server says this phone is no longer linked. */
let wiping = false;
async function cutOff() {
  if (wiping || state.stage === 'CUT_OFF' || state.stage === 'REFUSED') return;
  wiping = true;
  const waiting =
    state.link?.device.status === 'PENDING' ||
    state.stage === 'WAITING' ||
    state.stage === 'NEW_PHONE';
  const kind = revokedScreen(waiting);
  watchers.clear();
  await wipeEverything(
    {
      stopQueue: () => queue.wipe(),
      deleteTokens: forgetTokens,
      deleteCaches: clearAllExceptSurvivors,
      deleteQueue: () => removeItem(queueKey),
      deletePhotos: deleteAllPhotos,
      markCutOff: (mark) => writeJson(cutOffKey, mark),
    },
    kind,
  );
  set({
    stage: kind,
    link: null,
    today: null,
    clock: null,
    entries: [],
    failures: [],
    lateAnswer: null,
    phone: '',
    reason: '',
    devCode: '',
  });
  wiping = false;
}
/** A person starting again on a phone that was cut off. */
export async function startAgain() {
  await removeItem(cutOffKey);
  queue.reopen();
  set({ stage: 'NUMBER' });
}
export function setReason(reason: string) {
  set({ reason });
}
export function backToNumber() {
  set({ stage: 'NUMBER', devCode: '' });
}
export async function requestCode(phone: string) {
  const reply = await api.request<{ devCode?: string }>(
    'POST',
    'auth/otp/request',
    { phone },
    { auth: false },
  );
  set({ phone, devCode: reply.devCode ?? '', stage: 'CODE' });
}
export async function verifyCode(code: string) {
  const phone = state.phone;
  const { model, sdk } = modelInfo();
  const reply = await api.request<{
    accessToken: string;
    refreshToken: string;
    device: { id: string; status: string };
    user: { id: string; name: string };
  }>(
    'POST',
    'staff-auth/verify',
    {
      phone,
      code,
      publicKey: await publicKey(),
      signature: await signText(linkVerifyToSign(phone, code)),
      model,
      sdk,
      ...(state.reason ? { reason: state.reason } : {}),
    },
    { auth: false },
  );
  // Someone else's cached work must never show for this person.
  const before = await readJson<string>('staff:lastUser');
  if (before && before !== reply.user.id) {
    queue.wipe();
    await clearAllExceptSurvivors();
    queue.reopen();
  }
  await saveTokens({
    access: reply.accessToken,
    refresh: reply.refreshToken,
    userId: reply.user.id,
  });
  await writeJson('staff:lastUser', reply.user.id).catch(() => {});
  set({ stage: reply.device.status === 'ACTIVE' ? 'NOTICE' : 'YOURS', devCode: '' });
  if (reply.device.status === 'ACTIVE') await refreshLink();
}
export async function refreshLink() {
  const link = await api.request<LinkState>('GET', 'staff/me/link');
  noteOnline(true);
  const next = linkStage(link);
  set({ link, stage: next });
  if (next === 'READY') await afterReady();
  return link;
}
async function afterReady() {
  await queue.load();
  await refreshToday().catch(() => {});
  void queue.flush();
}
export async function acceptNotice() {
  const version = state.link?.noticeVersion ?? state.today?.noticeVersion;
  let noticeVersion = version;
  if (!noticeVersion) noticeVersion = (await refreshLink()).noticeVersion;
  await api.request('POST', 'staff/me/notice', { version: noticeVersion });
  await refreshLink();
}
export function yoursSeen() {
  void refreshLink().catch(() => set({ stage: 'NOTICE' }));
}
export async function proveQr(qr: string) {
  await api.request('POST', 'staff/devices/qr-proof', {
    qr,
    signature: await signText(linkProofToSign(qr)),
  });
  await refreshLink();
}
export async function reportLost() {
  return api.request<{ ok: boolean; cutOff: boolean }>('POST', 'staff/devices/lost', {});
}

// ---- Today ---------------------------------------------------------------------------------------
export async function refreshToday() {
  const before = mono();
  const asked = tokens?.userId;
  try {
    const today = await api.request<Today>('GET', 'staff/me/today');
    if (!tokens || tokens.userId !== asked) return today;
    const clock = syncClock(today.serverNow, before, mono(), bootCount());
    if (clock) await writeJson(clockKey, clock).catch(() => {});
    await writeCache('today', today);
    noteOnline(true);
    set({
      today,
      ...(clock ? { clock } : {}),
      // A notice raised by a later version comes back round here.
      ...(today.noticeAccepted ? {} : { stage: 'NOTICE' as Stage }),
    });
    return today;
  } catch (error) {
    if (isNetworkError(error)) noteOnline(false);
    throw error;
  }
}
export const now = () => serverNow(state.clock, mono(), bootCount());

export async function setLanguage(language: Language) {
  set({ language, tr: makeTr(language) });
  await writeJson(languageKey, language).catch(() => {});
}

export async function boot() {
  // Saved before plan v4 B2, 'hi' meant Hinglish. Until the staff app rebuild (G1) adds Hindi, it
  // writes only 'hinglish' or 'en', so an old 'hi' here is always Hinglish.
  const stored = await readJson<string>(languageKey);
  const language = stored == null ? firstLanguage : readLanguage(stored, true);
  set({ language, tr: makeTr(language) });
  const mark = await readJson<'CUT_OFF' | 'REFUSED'>(cutOffKey);
  if (mark) {
    queue.wipe();
    set({ stage: mark });
    return;
  }
  const saved = await getSecret(secretKey).catch(() => null);
  if (saved) {
    try {
      tokens = JSON.parse(saved) as Tokens & { userId: string };
    } catch {
      tokens = null;
    }
  }
  if (!tokens) {
    set({ stage: 'NUMBER' });
    return;
  }
  await queue.load();
  const clock = await readJson<ClockBase>(clockKey);
  const today = await readCache<Today>('today');
  set({ ...(clock ? { clock } : {}), ...(today ? { today } : {}) });
  try {
    await refreshLink();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status === undefined) {
      noteOnline(false);
      // No signal at start: the last known day, with a saved scan allowed.
      set({ stage: today ? 'READY' : 'WAITING' });
      return;
    }
    if (state.stage === 'BOOT') set({ stage: 'NUMBER' });
  }
}

// ---- Location -----------------------------------------------------------------------------------
type Tracked = { fix: Fix; at: number; accuracyM: number | null };
let looking = 0;
let stopWatch: (() => void) | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
let lookingSince = 0;
let tracked: Tracked | null = null;
let seenMock = false;
let lastStatus: LocationStatus = 'OK';
const fixMaxAgeMs = 120000;
function onFix(next: FixState) {
  lastStatus = next.status;
  if (next.fix) {
    const at = mono();
    if (next.fix.mocked) seenMock = true;
    const row = { fix: next.fix, at, accuracyM: next.fix.accuracyM };
    tracked = tracked && at - tracked.at > 60000 ? row : betterFix(tracked, row);
  }
  if (state.fix.status !== next.status || state.fix.has !== Boolean(tracked))
    set({ fix: { status: next.status, has: Boolean(tracked) } });
}
/** Looks quietly while the hazri screen is open. Stops soon after it closes. */
export function startLooking() {
  looking++;
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }
  if (stopWatch || looking > 1) return () => stopLooking();
  lookingSince = mono();
  seenMock = false;
  void watchLocation(onFix)
    .then((stop) => {
      if (looking > 0) stopWatch = stop;
      else stop();
    })
    .catch(() => onFix({ status: 'NO_FIX', fix: null }));
  return () => stopLooking();
}
/** Back from Settings: the switch may have changed, so ask again. */
export function lookAgain() {
  if (!looking) return;
  stopWatch?.();
  stopWatch = null;
  lookingSince = mono();
  void watchLocation(onFix)
    .then((stop) => {
      if (looking > 0) stopWatch = stop;
      else stop();
    })
    .catch(() => onFix({ status: 'NO_FIX', fix: null }));
}
function stopLooking() {
  looking = Math.max(0, looking - 1);
  if (looking) return;
  stopTimer = setTimeout(() => {
    stopWatch?.();
    stopWatch = null;
    tracked = null;
  }, 1500);
}
function currentFix(): FixState {
  const fresh = tracked && mono() - tracked.at <= fixMaxAgeMs ? tracked.fix : null;
  return {
    status: lastStatus,
    fix: fresh ? { ...fresh, mocked: fresh.mocked || seenMock } : null,
  };
}
/** The best position so far, waiting only for the rest of the 8 second look. */
export async function fixForScan(): Promise<FixState> {
  const started = mono();
  const limit = fixWaitMs(started - lookingSince);
  while (!currentFix().fix && lastStatus !== 'DENIED' && lastStatus !== 'GPS_OFF') {
    if (mono() - started >= limit) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return currentFix();
}
export const readFixForStep = async () => {
  const fields = locationFields(
    await readLocationOnce(5000).catch(() => ({ status: 'NO_FIX' as const, fix: null })),
  );
  return fields.lat !== undefined
    ? { lat: fields.lat, lng: fields.lng, accuracyM: fields.accuracyM }
    : {};
};

// ---- Scans ---------------------------------------------------------------------------------------
export function punchEntry(captureId: string, qr: string, kind: PunchKind, fix: FixState) {
  const capture: PunchCapture = {
    captureId,
    qr,
    kind,
    bootCount: bootCount(),
    appVersion,
    ...locationFields(fix),
  };
  return {
    id: captureId,
    kind: 'punch' as const,
    method: 'POST' as const,
    path: 'attendance/punch',
    body: capture as unknown as Record<string, unknown>,
    claimsAge: true,
  };
}
export { keepPhoto, requestTimeoutMs };
