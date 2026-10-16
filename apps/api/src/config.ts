import { z } from 'zod';
import { compareVersions } from '@shiv/shared';
export const configSchema = z.object({
  // Required: production guards (secure cookies, staff credentials, runtime role) key off it, so
  // a deploy that forgets it must fail to start rather than run as development.
  NODE_ENV: z.enum(['development', 'test', 'production']),
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
  ASSISTANT_PROVIDER: z.enum(['fallback', 'openai', 'simulation']).default('fallback'),
  ASSISTANT_OPENAI_API_KEY: z.string().min(1).optional(),
  ASSISTANT_MODEL: z
    .string()
    .regex(/^[a-zA-Z0-9._-]{1,100}$/)
    .optional(),
  ASSISTANT_INPUT_MICRO_USD_PER_MILLION: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000_000)
    .optional(),
  ASSISTANT_OUTPUT_MICRO_USD_PER_MILLION: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000_000)
    .optional(),
  ASSISTANT_DAILY_BUDGET_MICRO_USD: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000_000)
    .default(1_000_000),
  ASSISTANT_REQUESTS_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(30),
  ASSISTANT_REQUESTS_PER_DAY: z.coerce.number().int().min(1).max(100000).default(500),
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
  // Owner alerts. WhatsApp stays on the fake provider (logs only) until Meta approves the
  // business number and its message templates; customer updates are opt-in for the shop.
  WHATSAPP_PROVIDER: z.enum(['fake', 'meta']).default('fake'),
  WHATSAPP_ACCESS_TOKEN: z.string().min(20).optional(),
  WHATSAPP_PHONE_NUMBER_ID: z
    .string()
    .regex(/^\d{5,30}$/)
    .optional(),
  WHATSAPP_TEMPLATE_LANGUAGE: z.enum(['hi', 'en']).default('hi'),
  // Meta retires Graph API versions about two years after release; keep this current.
  WHATSAPP_API_VERSION: z
    .string()
    .regex(/^v\d{2,3}\.0$/)
    .default('v23.0'),
  WHATSAPP_DAILY_LIMIT: z.coerce.number().int().min(1).max(100000).default(200),
  WHATSAPP_CUSTOMER_UPDATES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Web Push for the installed owner desk (generate once: npx web-push generate-vapid-keys).
  WEB_PUSH_PUBLIC_KEY: z.string().min(40).max(200).optional(),
  WEB_PUSH_PRIVATE_KEY: z.string().min(20).max(200).optional(),
  WEB_PUSH_SUBJECT: z
    .string()
    .regex(/^(mailto:|https:\/\/)/)
    .default('mailto:owner@example.invalid'),
  // App versions below the minimum must update before use; below latest see a gentle prompt.
  ANDROID_MINIMUM_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default('1.0.0'),
  ANDROID_LATEST_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default('1.0.0'),
  ANDROID_STORE_URL: z
    .url()
    .startsWith('https://')
    .default('https://play.google.com/store/apps/details?id=in.shivcement.store'),
  // Open public live-update streams (/events). Pages fall back to refreshing on focus when refused.
  EVENT_STREAMS_PER_IP: z.coerce.number().int().min(1).max(10000).default(20),
  EVENT_STREAMS_TOTAL: z.coerce.number().int().min(1).max(100000).default(2000),
});
export type Config = z.infer<typeof configSchema>;
function testDatabase(url: string) {
  try {
    return new URL(url).pathname.endsWith('_test');
  } catch {
    return false;
  }
}
let config: Config | undefined;
/** Tests that change environment settings re-read them; the running API never calls this. */
export function resetConfigForTests() {
  config = undefined;
}
export function getConfig(): Config {
  if (config) return config;
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      `Invalid configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  const candidate = parsed.data;
  // Test mode lifts request limits and silences logs; it must only ever touch a throwaway database.
  if (candidate.NODE_ENV === 'test' && !testDatabase(candidate.DATABASE_URL))
    throw new Error('NODE_ENV=test requires a DATABASE_URL whose database name ends in _test');
  // A minimum above the latest version would block every install, including the newest.
  if (compareVersions(candidate.ANDROID_MINIMUM_VERSION, candidate.ANDROID_LATEST_VERSION) > 0)
    throw new Error('ANDROID_MINIMUM_VERSION cannot be above ANDROID_LATEST_VERSION');
  if (
    candidate.WHATSAPP_PROVIDER === 'meta' &&
    !(candidate.WHATSAPP_ACCESS_TOKEN && candidate.WHATSAPP_PHONE_NUMBER_ID)
  )
    throw new Error('WhatsApp needs its access token and phone number ID');
  if (Boolean(candidate.WEB_PUSH_PUBLIC_KEY) !== Boolean(candidate.WEB_PUSH_PRIVATE_KEY))
    throw new Error('Web Push needs both its public and private key');
  if (candidate.NODE_ENV === 'production' && candidate.ASSISTANT_PROVIDER === 'simulation')
    throw new Error('Assistant simulation is forbidden in production');
  if (
    candidate.ASSISTANT_PROVIDER === 'openai' &&
    !(
      candidate.ASSISTANT_OPENAI_API_KEY &&
      candidate.ASSISTANT_MODEL &&
      candidate.ASSISTANT_INPUT_MICRO_USD_PER_MILLION &&
      candidate.ASSISTANT_OUTPUT_MICRO_USD_PER_MILLION
    )
  )
    throw new Error('Assistant requires its own credentials, model and approved token prices');
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
      /development|change-me|replace|example|placeholder/i.test(candidate.OTP_HASH_SECRET))
  )
    throw new Error('Production requires real OTP, HTTPS origins, and a unique OTP hash secret');
  // Mock OTP displays codes on screen; it must never sit behind a proxy or tunnel.
  if (candidate.OTP_PROVIDER === 'mock' && candidate.TRUST_PROXY_HOPS > 0)
    throw new Error('Mock OTP cannot run behind a trusted proxy (TRUST_PROXY_HOPS must be 0)');
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
