import EventSource from 'react-native-sse';
import { advisorDeviceHeader, type AdvisorEvent, type AdvisorTurnView } from '@shiv/shared';
import {
  applyEvent,
  finishTurn,
  newTurnId,
  parseEvent,
  startTurn,
  type AskTurn,
} from '../logic/ask-core';
import { createStore } from '../logic/store-core';
import { API_URL, api, authHeader } from './api';
import { readSaved, writeSaved } from './saved';

// The conversation stays in memory while the app runs and goes on sign-out. Nothing saves it on the
// phone; only an anonymous device id is kept, for the daily question limit.
export const askStore = createStore<{ turns: AskTurn[]; draft: string; busy: boolean }>({
  turns: [],
  draft: '',
  busy: false,
});

const deviceKey = 'shiv_ask_device_v1';
let device: Promise<string> | null = null;
/** An anonymous token the server signs, for the daily question limit. No name or number with it. */
function deviceId() {
  device ??= readSaved<string>(deviceKey)
    .then(async (saved) => {
      if (typeof saved === 'string' && /^adv1\.[A-Za-z0-9_.-]{8,200}$/.test(saved)) return saved;
      const { deviceToken } = await api<{ deviceToken: string }>('/advisor/device', 'POST', {});
      await writeSaved(deviceKey, deviceToken).catch(() => {});
      return deviceToken;
    })
    .catch((error) => {
      device = null;
      throw error;
    });
  return device;
}

const eventTypes = [
  'status',
  'route',
  'products',
  'delivery',
  'estimate',
  'text',
  'cite',
  'followups',
  'replace',
  'done',
] as const;
/** The server's hard stop is 25 s; past this the phone stops waiting on a silent stream. */
const silentAfterMs = 40000;

function update(clientTurnId: string, change: (turn: AskTurn) => AskTurn) {
  askStore.set((old) => ({
    ...old,
    turns: old.turns.map((turn) => (turn.clientTurnId === clientTurnId ? change(turn) : turn)),
  }));
}

let source: EventSource<(typeof eventTypes)[number]> | null = null;

/** Sends one question, sentence by sentence. A drop gets the rest with no second charge. */
export async function ask(question: string, productId?: string) {
  const text = question.trim().slice(0, 600);
  if (!text || askStore.get().busy) return;
  const clientTurnId = newTurnId();
  askStore.set((old) => ({
    turns: [...old.turns, startTurn(clientTurnId, text)].slice(-12),
    draft: '',
    busy: true,
  }));
  const body = {
    clientTurnId,
    text,
    channel: 'APP',
    languageHint: 'en',
    ...(productId ? { productId } : {}),
  };
  let token: string;
  try {
    token = await deviceId();
  } catch {
    update(clientTurnId, (turn) => ({ ...turn, status: 'failed' }));
    askStore.patch({ busy: false });
    return;
  }
  stream(clientTurnId, body, {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    [advisorDeviceHeader]: token,
    ...authHeader(),
  });
}

function stream(clientTurnId: string, body: object, headers: Record<string, string>) {
  let finished = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const live = new EventSource<(typeof eventTypes)[number]>(`${API_URL}/advisor/turns`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    // Never sent again by the library: a retry here must be ours, with the same id.
    pollingInterval: 0,
    timeout: silentAfterMs + 5000,
  });
  source = live;
  const stop = () => {
    clearTimeout(watchdog);
    finished = true;
    live.removeAllEventListeners();
    live.close();
    if (source === live) source = null;
  };
  const alive = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => lost(), silentAfterMs);
  };
  const lost = () => {
    if (finished) return;
    stop();
    void recover(clientTurnId, body, headers);
  };
  alive();
  for (const type of eventTypes)
    live.addEventListener(type, (message) => {
      if (finished) return;
      alive();
      const event = parseEvent(type, (message as { data?: string | null }).data);
      if (!event) return;
      update(clientTurnId, (turn) => applyEvent(turn, event as AdvisorEvent));
      if (event.type === 'done') {
        stop();
        askStore.patch({ busy: false });
      }
    });
  live.addEventListener('error', () => lost());
}

/** "Connection lost. Getting the rest…" The same id cannot run or charge twice on the server. */
async function recover(clientTurnId: string, body: object, headers: Record<string, string>) {
  update(clientTurnId, (turn) => ({ ...turn, status: 'lost' }));
  const turn = askStore.get().turns.find((item) => item.clientTurnId === clientTurnId);
  try {
    const view = turn?.turnId
      ? await requestJson<AdvisorTurnView>(`/advisor/turns/${turn.turnId}`, 'GET', headers)
      : await requestJson<AdvisorTurnView>('/advisor/turns', 'POST', headers, body);
    update(clientTurnId, (old) => finishTurn(old, view));
  } catch (error) {
    // A device token the server no longer accepts is asked for again next time.
    if (error instanceof Error && /^4(00|01|03)$/.test(error.message)) {
      device = null;
      void writeSaved(deviceKey, null).catch(() => {});
    }
    update(clientTurnId, (old) => ({ ...old, status: 'failed' }));
  } finally {
    askStore.patch({ busy: false });
  }
}

async function requestJson<T>(
  path: string,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body?: object,
) {
  const { Accept: _stream, ...plain } = headers;
  const response = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'omit',
    headers: { ...plain, Accept: 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as T;
}

/** "Cancel" stays while waiting. The question comes back to the box. */
export function cancelAsk() {
  const turns = askStore.get().turns;
  const last = turns.at(-1);
  source?.removeAllEventListeners();
  source?.close();
  source = null;
  if (last?.turnId)
    void deviceId().then((id) =>
      fetch(`${API_URL}/advisor/turns/${last.turnId}/cancel`, {
        method: 'POST',
        credentials: 'omit',
        headers: { [advisorDeviceHeader]: id, ...authHeader() },
      }).catch(() => {}),
    );
  askStore.set({ turns: turns.slice(0, -1), draft: last?.question ?? '', busy: false });
}

/** "This helped" and "Not right", with a reason from the fixed list. */
export async function sendFeedback(
  turn: AskTurn,
  value: 'HELPED' | 'NOT_RIGHT',
  reason?: 'WRONG' | 'DID_NOT_ANSWER' | 'HARD_TO_UNDERSTAND' | 'OFFENSIVE',
) {
  if (!turn.turnId) return;
  update(turn.clientTurnId, (old) => ({ ...old, feedback: value }));
  const id = await deviceId();
  await fetch(`${API_URL}/advisor/turns/${turn.turnId}/feedback`, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', [advisorDeviceHeader]: id, ...authHeader() },
    body: JSON.stringify({ value, ...(reason ? { reason } : {}) }),
  }).catch(() => {});
}

export const setAskDraft = (draft: string) => askStore.patch({ draft: draft.slice(0, 600) });
export function forgetConversation() {
  source?.removeAllEventListeners();
  source?.close();
  source = null;
  const had = askStore.get().turns.length > 0;
  askStore.set({ turns: [], draft: '', busy: false });
  // It goes on the server too, so the next person on this phone starts clean.
  if (had)
    void deviceId()
      .then((token) =>
        fetch(`${API_URL}/advisor/conversations/current`, {
          method: 'DELETE',
          credentials: 'omit',
          headers: { [advisorDeviceHeader]: token },
        }),
      )
      .catch(() => {});
}
export const readGuide = <T>(slug: string) => api<T>(`/guide/${encodeURIComponent(slug)}`);
