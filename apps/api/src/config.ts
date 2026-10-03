import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:8081'),
  OTP_PROVIDER: z.enum(['mock', 'twilio']).default('mock'),
  OTP_HASH_SECRET: z.string().min(32),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  R2_ENDPOINT: z.url().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_PUBLIC_URL: z.url().optional(),
  GOOGLE_VISION_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  RATE_OPENAI_MODEL: z.string().max(200).optional(),
  RATE_SOURCE_BUCKET: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
});
export type Config = z.infer<typeof schema>;
let config: Config;
export function getConfig(): Config {
  if (config) return config;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      `Invalid configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  config = parsed.data;
  if (
    config.NODE_ENV === 'production' &&
    (config.OTP_PROVIDER === 'mock' ||
      config.CORS_ORIGINS.split(',').some((o) => !o.startsWith('https://')) ||
      /development|change-me/.test(config.OTP_HASH_SECRET))
  )
    throw new Error('Production requires real OTP, HTTPS origins, and a unique OTP hash secret');
  if (
    config.OTP_PROVIDER === 'twilio' &&
    !(config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_VERIFY_SERVICE_SID)
  )
    throw new Error('Twilio Verify configuration is incomplete');
  return config;
}
export const onlineReady = () => {
  const c = getConfig();
  return Boolean(c.RAZORPAY_KEY_ID && c.RAZORPAY_KEY_SECRET && c.RAZORPAY_WEBHOOK_SECRET);
};
