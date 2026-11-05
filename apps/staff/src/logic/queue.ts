/**
 * Work saved on the phone until it reaches the server: a scan, or a driver's or stock keeper's
 * step. It is saved before anything is sent, sent in order, and each entry carries the key that
 * makes a repeat harmless. A lost reply or a closed app can therefore never do a thing twice.
 */
export type QueueKind =
  | 'punch'
  | 'problem'
  | 'load'
  | 'receipt'
  | 'damage'
  | 'countLine'
  | 'countSubmit'
  | 'transfer'
  | 'tripStart'
  | 'delivered'
  | 'stopProblem'
  | 'handover'
  | 'payAck';
export type EvidenceKind = 'ATTENDANCE_PHOTO' | 'KANTA_SLIP' | 'DAMAGE_PHOTO' | 'DELIVERY_PHOTO';
export type QueuePhoto = {
  uri: string;
  kind: EvidenceKind;
  locationId?: string | undefined;
  /** Merged in if the photo itself is refused for good, so the step is not lost with it. */
  fallback?: Record<string, unknown> | undefined;
};
export type QueueEntry = {
  id: string;
  kind: QueueKind;
  method: 'POST' | 'PUT';
  path: string;
  body: Record<string, unknown>;
  userId: string;
  photo?: QueuePhoto | undefined;
  /** Whether claimedAgeMs goes with it. */
  claimsAge: boolean;
  /** Where the boot clock stood when carriedMs was last worked out. */
  mono: number;
  boot: number;
  /** How long it has been waiting so far. */
  carriedMs: number;
  rebooted: boolean;
  /** Set once, for a line that later saves replace (one count line, one box). */
  replaceKey?: string | undefined;
};
export type QueueFailure = {
  id: string;
  kind: QueueKind;
  code: string;
  path: string;
  at: number;
};

/** After this, the server's rules read a scan as carried offline. */
export const offlineAfterMs = 120_000;
export const maxClaimedAgeMs = 14 * 86400000;

/**
 * Brings an entry's age up to date. With no reboot the boot clock is exact. After a reboot it is
 * only a floor, so it is marked and always counts as carried offline, for a person to look at.
 */
export function rebase(entry: QueueEntry, mono: number, boot: number): QueueEntry {
  if (boot === entry.boot && mono >= entry.mono)
    return { ...entry, carriedMs: entry.carriedMs + (mono - entry.mono), mono };
  return {
    ...entry,
    carriedMs: Math.max(entry.carriedMs + Math.max(mono, 0), offlineAfterMs + 1),
    mono,
    boot,
    rebooted: true,
  };
}
export const claimedAge = (entry: QueueEntry) =>
  Math.min(Math.max(Math.round(entry.carriedMs), 0), maxClaimedAgeMs);

export type Verdict = 'done' | 'retry' | 'failed' | 'revoked' | 'signin' | 'notice' | 'notlinked';
/** A repeat that finds its work already done is success, not a failure to report. */
const alreadyDone: Partial<Record<QueueKind, string[]>> = {
  transfer: ['TRANSFER_DONE'],
  countSubmit: ['COUNT_NOT_OPEN'],
};
/** What to do with an answer. Anything that might pass on a later try stays on the phone. */
export function verdictFor(kind: QueueKind, code: string, status?: number): Verdict {
  if (code === 'DEVICE_REVOKED') return 'revoked';
  if (code === 'NOTICE_NEEDED') return 'notice';
  if (code === 'NOT_LINKED') return 'notlinked';
  if (status === 401) return 'signin';
  if (status === undefined || status >= 500 || status === 429 || status === 408) return 'retry';
  if (alreadyDone[kind]?.includes(code)) return 'done';
  return 'failed';
}

export type SendReply = { ok: true; body: unknown } | { ok: false; code: string; status?: number };
export type QueueDeps = {
  load(): Promise<{ entries: QueueEntry[]; failures: QueueFailure[] } | null>;
  save(state: { entries: QueueEntry[]; failures: QueueFailure[] }): Promise<void>;
  send(entry: QueueEntry, body: Record<string, unknown>): Promise<SendReply>;
  upload(
    photo: QueuePhoto,
  ): Promise<{ ok: true; id: string } | { ok: false; code: string; status?: number }>;
  /** Fills in what can only be worked out at sending, such as a scan's age and signature. */
  prepare(entry: QueueEntry, age: number): Promise<Record<string, unknown>>;
  deletePhoto(uri: string): Promise<void>;
  mono(): number;
  boot(): number;
  now(): number;
  onChange?(): void;
  onResult?(entry: QueueEntry, reply: SendReply, verdict: Verdict): void;
  /** Stopped for a reason a person must act on. */
  onStop?(reason: 'signin' | 'notice' | 'notlinked' | 'revoked'): void;
};

export function createQueue(deps: QueueDeps) {
  let entries: QueueEntry[] = [];
  let failures: QueueFailure[] = [];
  let running: Promise<void> | null = null;
  let again = false;
  let wiped = false;
  let loading: Promise<void> | null = null;

  const persist = async () => {
    deps.onChange?.();
    if (!wiped) await deps.save({ entries, failures });
  };

  /** Read once. Nothing may be added or saved before this, or older work would be written over. */
  function load() {
    loading ??= (async () => {
      const saved = await deps.load().catch(() => null);
      if (wiped) return;
      entries = saved?.entries ?? [];
      failures = saved?.failures ?? [];
      deps.onChange?.();
    })();
    return loading;
  }

  /** Saved before it is sent. False means the phone could not save it, and nobody is told it did. */
  async function add(
    entry: Omit<QueueEntry, 'mono' | 'boot' | 'carriedMs' | 'rebooted'>,
  ): Promise<boolean> {
    await load();
    const full: QueueEntry = {
      ...entry,
      mono: deps.mono(),
      boot: deps.boot(),
      carriedMs: 0,
      rebooted: false,
    };
    // The newest figure for a count line replaces an older one still waiting.
    const replaced = entry.replaceKey
      ? entries.findIndex((row) => row.replaceKey === entry.replaceKey)
      : -1;
    if (replaced >= 0) entries = entries.map((row, index) => (index === replaced ? full : row));
    else if (!entries.some((row) => row.id === entry.id)) entries = [...entries, full];
    try {
      await persist();
      return true;
    } catch {
      deps.onChange?.();
      return false;
    }
  }

  async function remove(id: string) {
    const row = entries.find((entry) => entry.id === id);
    entries = entries.filter((entry) => entry.id !== id);
    await persist().catch(() => {});
    if (row?.photo) await deps.deletePhoto(row.photo.uri).catch(() => {});
  }

  /** Sends one, and says whether the next may follow. */
  async function sendOne(start: QueueEntry): Promise<boolean> {
    let entry = rebase(start, deps.mono(), deps.boot());
    entries = entries.map((row) => (row.id === entry.id ? entry : row));
    const stop = (verdict: Verdict, reply: SendReply) => {
      deps.onResult?.(entry, reply, verdict);
      if (verdict === 'retry') return false;
      deps.onStop?.(verdict as 'signin' | 'notice' | 'notlinked' | 'revoked');
      return false;
    };
    await persist().catch(() => {});
    if (entry.photo && entry.body.evidenceId === undefined) {
      const uploaded = await deps.upload(entry.photo);
      if (wiped) return false;
      if (uploaded.ok) entry = { ...entry, body: { ...entry.body, evidenceId: uploaded.id } };
      else {
        const verdict = verdictFor(entry.kind, uploaded.code, uploaded.status);
        if (verdict !== 'failed')
          return stop(verdict === 'done' ? 'retry' : verdict, {
            ok: false,
            code: uploaded.code,
            ...(uploaded.status === undefined ? {} : { status: uploaded.status }),
          });
        // A photo refused for good should not take the step down with it.
        const { photo, ...rest } = entry;
        entry = { ...rest, body: { ...entry.body, ...(photo?.fallback ?? {}) } };
        if (photo) await deps.deletePhoto(photo.uri).catch(() => {});
      }
      entries = entries.map((row) => (row.id === entry.id ? entry : row));
      await persist().catch(() => {});
    }
    let body: Record<string, unknown>;
    try {
      body = await deps.prepare(entry, claimedAge(entry));
    } catch {
      return stop('retry', { ok: false, code: 'NOT_PREPARED' });
    }
    const reply = await deps.send(entry, body);
    if (wiped) return false;
    if (reply.ok) {
      await remove(entry.id);
      deps.onResult?.(entry, reply, 'done');
      return true;
    }
    const verdict = verdictFor(entry.kind, reply.code, reply.status);
    if (verdict === 'done') {
      await remove(entry.id);
      deps.onResult?.(entry, reply, 'done');
      return true;
    }
    if (verdict === 'failed') {
      failures = [
        ...failures,
        { id: entry.id, kind: entry.kind, code: reply.code, path: entry.path, at: deps.now() },
      ];
      await remove(entry.id);
      deps.onResult?.(entry, reply, 'failed');
      return true;
    }
    return stop(verdict, reply);
  }

  async function drain() {
    await load();
    do {
      again = false;
      for (const entry of [...entries]) {
        if (wiped) return;
        if (!entries.some((row) => row.id === entry.id)) continue;
        const current = entries.find((row) => row.id === entry.id)!;
        if (!(await sendOne(current))) return;
      }
    } while (again && !wiped);
  }

  /** One sender at a time. Asking while one is running makes it look again when it ends. */
  function flush() {
    if (running) {
      again = true;
      return running;
    }
    running = drain().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    load,
    add,
    flush,
    /** A failed entry has been read by a person. */
    async dismiss(id: string) {
      failures = failures.filter((row) => row.id !== id);
      await persist().catch(() => {});
    },
    /** Forgets something never saved to the phone, when sending it also failed. */
    remove,
    entries: () => entries,
    failures: () => failures,
    pendingFor: (userId: string) => entries.filter((row) => row.userId === userId),
    /** After a cut-off nothing may be sent, and nothing may be written back. */
    wipe() {
      wiped = true;
      entries = [];
      failures = [];
      deps.onChange?.();
    },
    /** Ready for a phone linked again after a cut-off. */
    reopen() {
      wiped = false;
      loading = null;
      entries = [];
      failures = [];
    },
  };
}
export type Queue = ReturnType<typeof createQueue>;
