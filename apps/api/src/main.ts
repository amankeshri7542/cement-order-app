import { createApp } from './app';
import { getConfig } from './config';
import { safeMessage, shutdown } from './lifecycle';

const log = (event: string, details: Record<string, unknown>) =>
  console.log(JSON.stringify({ event, ...details, timestamp: new Date().toISOString() }));

async function main() {
  const app = await createApp();
  const c = getConfig();
  // Mock OTP never listens beyond this computer.
  await app.listen(c.PORT, c.OTP_PROVIDER === 'mock' ? '127.0.0.1' : '0.0.0.0');
  log('API_STARTED', {
    port: c.PORT,
    nodeEnv: c.NODE_ENV,
    otpProvider: c.OTP_PROVIDER,
    assistantProvider: c.ASSISTANT_PROVIDER,
    release: process.env.RELEASE_SHA?.slice(0, 40) || 'unset',
  });
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      log('API_STOPPING', { signal });
      // 8s drain fits Docker's default 10s stop timeout; longer platform windows also work.
      void shutdown(app, 8000)
        .then(() => {
          log('API_STOPPED', { signal });
          process.exit(0);
        })
        .catch((error: unknown) => {
          console.error(JSON.stringify({ event: 'API_STOP_FAILED', reason: safeMessage(error) }));
          process.exit(1);
        });
    });
}

main().catch((error: unknown) => {
  // Configuration errors name the invalid variables, never their values.
  console.error(
    JSON.stringify({
      event: 'API_STARTUP_FAILED',
      reason: safeMessage(error),
      hint: 'Check environment configuration and database connectivity.',
      timestamp: new Date().toISOString(),
    }),
  );
  process.exitCode = 1;
});
