// Web build: no vibration motor (see feedback.native.ts). Tests count these.
export function confirmHaptic() {
  const host = globalThis as unknown as { __staffHaptics?: number };
  host.__staffHaptics = (host.__staffHaptics ?? 0) + 1;
}
