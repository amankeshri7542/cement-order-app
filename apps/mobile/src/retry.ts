// Retries a read that failed on the network. Plain logic with no React Native imports, so it is
// unit-tested under Node (test/retry.test.mjs).

/** Waits between tries: a weak 4G signal usually comes back within a few seconds. */
export const retryDelays = [1000, 2000, 4000] as const;

/**
 * Runs `attempt`, and runs it again after each delay while `retryable` says the failure may pass.
 * Nothing waits when `online()` says the phone has no network at all: the caller shows what it
 * saved and the retry happens when the connection returns.
 */
export async function withRetry<T>(
  attempt: () => Promise<T>,
  options: {
    retryable: (error: unknown) => boolean;
    delays?: readonly number[];
    online?: () => boolean;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<T> {
  const delays = options.delays ?? retryDelays;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  for (let tries = 0; ; tries++) {
    try {
      return await attempt();
    } catch (error) {
      const wait = delays[tries];
      if (wait === undefined || !options.retryable(error) || options.online?.() === false)
        throw error;
      await sleep(wait);
    }
  }
}
