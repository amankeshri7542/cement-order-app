import { createApp } from './app';
import { getConfig } from './config';
void createApp()
  .then((app) =>
    app.listen(getConfig().PORT, getConfig().OTP_PROVIDER === 'mock' ? '127.0.0.1' : '0.0.0.0'),
  )
  .catch(() => {
    console.error('API startup failed. Check environment configuration and database connectivity.');
    process.exitCode = 1;
  });
