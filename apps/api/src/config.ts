import { z } from 'zod';
export const configSchema = z.object({
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
  DEMAND_PAUSED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  OTP_PAUSED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  EXTRACTION_PAUSED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  UPLOADS_PAUSED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  PENDING_COD_CUSTOMER: z.coerce.number().int().min(1).max(2000000000).default(3),
  PENDING_COD_STORE: z.coerce.number().int().min(1).max(2000000000).default(25),
  PENDING_COD_CUSTOMER_PAISE: z.coerce.number().int().min(1).max(2000000000).default(10000000),
  PENDING_COD_STORE_PAISE: z.coerce.number().int().min(1).max(2000000000).default(100000000),
  PENDING_QUOTES_CUSTOMER: z.coerce.number().int().min(1).max(2000000000).default(3),
  PENDING_QUOTES_STORE: z.coerce.number().int().min(1).max(2000000000).default(30),
  ORDERS_PER_ACCOUNT_HOUR: z.coerce.number().int().min(1).max(2000000000).default(10),
  QUOTES_PER_ACCOUNT_HOUR: z.coerce.number().int().min(1).max(2000000000).default(10),
  DEMAND_PER_DAY: z.coerce.number().int().min(1).max(2000000000).default(500),
  OTP_SENDS_PER_DAY: z.coerce.number().int().min(1).max(2000000000).default(200),
  OTP_CHECKS_PER_DAY: z.coerce.number().int().min(1).max(2000000000).default(1000),
  EXTRACTIONS_PER_DAY: z.coerce.number().int().min(1).max(2000000000).default(50),
  PENDING_COD_STOCK_PERCENT: z.coerce.number().int().min(1).max(100).default(50),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
});
export type Config = z.infer<typeof configSchema>;
let config: Config;
export function getConfig(): Config {
  if (config) return config;
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      `Invalid configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  const candidate = parsed.data;
  for (const origin of candidate.CORS_ORIGINS.split(',')) {
    const u = new URL(origin);
    if (
      u.origin !== origin ||
      !['https:', 'http:'].includes(u.protocol) ||
      u.username ||
      u.password
    )
      throw new Error('CORS_ORIGINS must contain exact canonical origins without paths');
  }
  if (candidate.NODE_ENV === 'production' && candidate.R2_ENDPOINT) {
    const endpoint = new URL(candidate.R2_ENDPOINT);
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      throw new Error(
        'Production object storage requires HTTPS without embedded credentials or query tokens',
      );
  }
  if (candidate.NODE_ENV === 'production' && candidate.R2_PUBLIC_URL) {
    const asset = new URL(candidate.R2_PUBLIC_URL);
    if (
      asset.protocol !== 'https:' ||
      asset.pathname !== '/' ||
      asset.search ||
      asset.hash ||
      asset.username ||
      asset.password ||
      candidate.CORS_ORIGINS.split(',').includes(asset.origin)
    )
      throw new Error('Public assets require a separate HTTPS origin');
  }
  if (
    candidate.NODE_ENV === 'production' &&
    (candidate.OTP_PROVIDER === 'mock' ||
      candidate.CORS_ORIGINS.split(',').some((o) => !o.startsWith('https://')) ||
      /development|change-me/.test(candidate.OTP_HASH_SECRET))
  )
    throw new Error('Production requires real OTP, HTTPS origins, and a unique OTP hash secret');
  if (
    candidate.OTP_PROVIDER === 'twilio' &&
    !(
      candidate.TWILIO_ACCOUNT_SID &&
      candidate.TWILIO_AUTH_TOKEN &&
      candidate.TWILIO_VERIFY_SERVICE_SID
    )
  )
    throw new Error('Twilio Verify configuration is incomplete');
  config = candidate;
  return config;
}
export const onlineReady = () => {
  const c = getConfig();
  return Boolean(c.RAZORPAY_KEY_ID && c.RAZORPAY_KEY_SECRET && c.RAZORPAY_WEBHOOK_SECRET);
};
