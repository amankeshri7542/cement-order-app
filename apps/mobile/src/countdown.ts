// A wait counted from a fixed moment, so it stays right when the phone sleeps or the app goes to
// the background. Plain logic with no React Native imports, so it is unit-tested under Node
// (test/countdown.test.mjs).

/** How long a customer waits before another sign-in code can be asked for. */
export const resendSeconds = 30;

/** Whole seconds left until `deadline` (a time in ms); 0 once it has passed. */
export const secondsLeft = (deadline: number, now: number) =>
  Math.max(0, Math.ceil((deadline - now) / 1000));
