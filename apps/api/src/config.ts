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
  // Hosted demo with fake data only: lets mock OTP run in production behind the host's proxy.
  DEMO_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // The one database demo mode may run against, so a copied setting cannot open a real one.
  DEMO_DATABASE_HOST: z.string().optional(),
  // all: one process does both. web: serves requests only. worker: background work only.
  SHIV_ROLE: z.enum(['all', 'web', 'worker']).default('all'),
  // Staff sign-in code while DEMO_MODE is on; it is never shown on screen.
  DEMO_STAFF_CODE: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  CREDIT_OVERRIDE_PHONE: z.union([z.literal(''), z.string().regex(/^\+91[6-9]\d{9}$/)]).default(''),
  STAFF_PASSPHRASE_REQUIRED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  OWNER_SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  OTP_HASH_SECRET: z.string().min(32),
  // Shop codes, sealed positions and phone renewals. Falls back to OTP_HASH_SECRET if not set.
  STAFF_SECRET: z.string().min(32).optional(),
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
  // Ask, the AI advisor. Off by default: with no provider, no key or ASK_ENABLED off, nothing calls a
  // model and customers get fixed text and the checked guide.
  ADVISOR_PROVIDER: z.enum(['fallback', 'anthropic', 'simulation']).default('fallback'),
  // Its own key, in its own workspace with a spend limit, so the provider is the last net.
  ADVISOR_ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ADVISOR_MODEL_TRIAGE: z
    .string()
    .regex(/^[a-zA-Z0-9._-]{1,100}$/)
    .default('claude-haiku-5-5'),
  ADVISOR_MODEL_ANSWER: z
    .string()
    .regex(/^[a-zA-Z0-9._-]{1,100}$/)
    .default('claude-haiku-5-5'),
  // Haiku 5.5 for prompts under 100,000 tokens, ours always are. In micro dollars per million tokens.
  ADVISOR_INPUT_MICRO_USD_PER_MILLION: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000_000)
    .default(100_000),
  ADVISOR_OUTPUT_MICRO_USD_PER_MILLION: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000_000)
    .default(500_000),
  ADVISOR_CACHE_WRITE_MICRO_USD_PER_MILLION: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000_000)
    .default(125_000),
  ADVISOR_CACHE_READ_MICRO_USD_PER_MILLION: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000_000)
    .default(10_000),
  // Decision 54: rupees 10 a day and rupees 300 a month, at 95 to the dollar (decision 32).
  ADVISOR_DAILY_BUDGET_MICRO_USD: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000_000)
    .default(105_263),
  ADVISOR_MONTHLY_BUDGET_MICRO_USD: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000_000)
    .default(3_157_894),
  // Decision 54: questions that reach a model. Fixed text does not count.
  ADVISOR_QUESTIONS_PER_DEVICE_DAY: z.coerce.number().int().min(1).max(100000).default(5),
  ADVISOR_QUESTIONS_PER_ACCOUNT_DAY: z.coerce.number().int().min(1).max(100000).default(10),
  ADVISOR_QUESTIONS_PER_IP_DAY: z.coerce.number().int().min(1).max(100000).default(20),
  // The hard floor under every turn, so nobody can fill the database with fixed answers.
  ADVISOR_TURNS_PER_IP_HOUR: z.coerce.number().int().min(1).max(100000).default(120),
  ADVISOR_TURNS_PER_DEVICE_DAY: z.coerce.number().int().min(1).max(100000).default(60),
  ADVISOR_TURNS_PER_DAY: z.coerce.number().int().min(1).max(1000000).default(1500),
  ADVISOR_TURNS_PER_CONVERSATION: z.coerce.number().int().min(1).max(1000).default(16),
  ADVISOR_DEVICES_PER_IP_DAY: z.coerce.number().int().min(1).max(100000).default(30),
  ADVISOR_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(8),
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
  // The shop's WhatsApp. Off refuses the webhook. Shadow reads and sends nothing. Reply lets the
  // sender run, and even then nobody hears anything until an owner moves the stage up on the desk.
  WA_MODE: z.enum(['off', 'shadow', 'reply']).default('off'),
  // Who carries replies. Off means nothing can leave, whatever else is set.
  WA_REPLY_PROVIDER: z.enum(['off', 'fake', 'meta', 'd360', 'ycloud']).default('off'),
  WA_REPLY_API_KEY: z.string().min(16).optional(),
  // Named in the first notice to every customer.
  WA_PRIVACY_URL: z.url().startsWith('https://').optional(),
  // Set only once each is really in place: the readiness check reads these.
  WA_SECOND_NUMBER: z
    .string()
    .regex(/^\+\d{10,15}$/)
    .optional(),
  WA_APPEAL_ROUTE: z.string().trim().min(3).max(200).optional(),
  WA_TEMPLATES_APPROVED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  WA_REPLY_TEMPLATE_LANGUAGE: z
    .string()
    .regex(/^[a-z]{2}(_[A-Z]{2})?$/)
    .default('en_IN'),
  // Counted per answer to a message, not per bubble. These also stop a loop with another bot.
  WA_REPLIES_PER_THREAD_HOUR: z.coerce.number().int().min(1).max(100).default(3),
  WA_REPLIES_PER_THREAD_DAY: z.coerce.number().int().min(1).max(500).default(8),
  // An answer later than this is a stranger's voice in an old chat, so it stays unsaid.
  WA_REPLY_MAX_AGE_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  // Past this from one number in an hour, words are not kept or read.
  WA_THREAD_MESSAGES_PER_HOUR: z.coerce.number().int().min(1).max(10000).default(60),
  WA_PASTES_PER_HOUR: z.coerce.number().int().min(1).max(10000).default(60),
  WA_WEBHOOK_PROVIDER: z.enum(['meta', 'd360', 'ycloud']).optional(),
  // Named on the privacy page, so it must be set before any customer's words arrive.
  WA_PARTNER_NAME: z.string().trim().min(2).max(60).optional(),
  WA_BUSINESS_PHONE: z
    .string()
    .regex(/^\+\d{10,15}$/)
    .optional(),
  WHATSAPP_APP_SECRET: z.string().min(16).optional(),
  WHATSAPP_WEBHOOK_SECRET: z.string().min(16).optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().min(16).max(200).optional(),
  WA_READER_PROVIDER: z.enum(['off', 'fake', 'gemini']).default('off'),
  WA_READER_MODEL: z.string().min(3).max(100).optional(),
  GEMINI_API_KEY: z.string().min(16).optional(),
  // Google's free tier may use what it reads to improve its products, which Meta's terms forbid.
  WA_READER_PAID_KEY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  WA_READER_INPUT_MICRO_USD_PER_MILLION: z.coerce.number().int().min(1).max(100000000).optional(),
  WA_READER_OUTPUT_MICRO_USD_PER_MILLION: z.coerce.number().int().min(1).max(100000000).optional(),
  // About 500 rupees at 95 to the dollar. Past it, a person reads the original words.
  WA_READER_MONTHLY_BUDGET_MICRO_USD: z.coerce
    .number()
    .int()
    .min(1000)
    .max(100000000)
    .default(5200000),
  WA_READER_CALLS_PER_THREAD_HOUR: z.coerce.number().int().min(1).max(1000).default(12),
  WA_READER_CALLS_PER_THREAD_DAY: z.coerce.number().int().min(1).max(10000).default(40),
  WA_BURST_WAIT_SECONDS: z.coerce.number().int().min(0).max(120).default(8),
  // Decision 10: stored words stay short-lived while reading silently.
  WA_TEXT_RETENTION_DAYS: z.coerce.number().int().min(1).max(400).default(30),
  // A sample until the family gives their figure.
  WA_BIG_ORDER_PAISE: z.coerce.number().int().min(1).max(2000000000).default(15000000),
  // Web Push for the installed owner desk (generate once: npx web-push generate-vapid-keys).
  WEB_PUSH_PUBLIC_KEY: z.string().min(40).max(200).optional(),
  WEB_PUSH_PRIVATE_KEY: z.string().min(20).max(200).optional(),
  WEB_PUSH_SUBJECT: z
    .string()
    .regex(/^(mailto:|https:\/\/)/)
    .default('mailto:owner@example.invalid'),
  // Ask stays hidden in the app and on the website until the advisor has passed its safety test.
  ASK_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // The website's awards page, once real certificates are up. Unset keeps the link hidden.
  AWARDS_URL: z.url().startsWith('https://').optional(),
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
  if (candidate.WA_MODE !== 'off') {
    if (!candidate.WA_PARTNER_NAME || !candidate.WA_WEBHOOK_PROVIDER)
      throw new Error('WhatsApp reading needs its partner named and its webhook provider set');
    const missing =
      candidate.WA_WEBHOOK_PROVIDER === 'meta'
        ? !(
            candidate.WHATSAPP_APP_SECRET &&
            candidate.WHATSAPP_VERIFY_TOKEN &&
            candidate.WHATSAPP_PHONE_NUMBER_ID
          )
        : candidate.WA_WEBHOOK_PROVIDER === 'd360'
          ? !(candidate.WHATSAPP_WEBHOOK_SECRET && candidate.WHATSAPP_PHONE_NUMBER_ID)
          : !(candidate.WHATSAPP_WEBHOOK_SECRET && candidate.WA_BUSINESS_PHONE);
    if (missing) throw new Error('WhatsApp reading needs its webhook secret and own number');
  }
  if (candidate.WA_MODE === 'reply') {
    if (candidate.WA_REPLY_PROVIDER === 'off')
      throw new Error('WA_MODE=reply needs WA_REPLY_PROVIDER');
    if (!candidate.WA_PRIVACY_URL) throw new Error('WA_MODE=reply needs WA_PRIVACY_URL');
  }
  if (candidate.NODE_ENV === 'production' && candidate.WA_REPLY_PROVIDER === 'fake')
    throw new Error('The fake WhatsApp sender is forbidden in production');
  if (
    (candidate.WA_REPLY_PROVIDER === 'meta' &&
      !(candidate.WHATSAPP_ACCESS_TOKEN && candidate.WHATSAPP_PHONE_NUMBER_ID)) ||
    (candidate.WA_REPLY_PROVIDER === 'd360' && !candidate.WA_REPLY_API_KEY) ||
    (candidate.WA_REPLY_PROVIDER === 'ycloud' &&
      !(candidate.WA_REPLY_API_KEY && candidate.WA_BUSINESS_PHONE))
  )
    throw new Error('The WhatsApp sender needs its key and own number');
  if (candidate.NODE_ENV === 'production' && candidate.WA_READER_PROVIDER === 'fake')
    throw new Error('The fake WhatsApp reader is forbidden in production');
  if (
    candidate.WA_READER_PROVIDER === 'gemini' &&
    !(
      candidate.GEMINI_API_KEY &&
      candidate.WA_READER_MODEL &&
      candidate.WA_READER_PAID_KEY &&
      candidate.WA_READER_INPUT_MICRO_USD_PER_MILLION &&
      candidate.WA_READER_OUTPUT_MICRO_USD_PER_MILLION
    )
  )
    throw new Error('The WhatsApp reader needs a paid key, a pinned model and approved prices');
  if (Boolean(candidate.WEB_PUSH_PUBLIC_KEY) !== Boolean(candidate.WEB_PUSH_PRIVATE_KEY))
    throw new Error('Web Push needs both its public and private key');
  if (candidate.NODE_ENV === 'production' && candidate.ADVISOR_PROVIDER === 'simulation')
    throw new Error('Advisor simulation is forbidden in production');
  if (candidate.ADVISOR_PROVIDER === 'anthropic' && !candidate.ADVISOR_ANTHROPIC_API_KEY)
    throw new Error('The advisor needs its own Anthropic key');
  // A demo holds fake data and is open to anyone, so it must not spend real money.
  if (candidate.DEMO_MODE && candidate.ADVISOR_PROVIDER === 'anthropic')
    throw new Error('DEMO_MODE forbids a paid advisor');
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
    ((candidate.OTP_PROVIDER === 'mock' && !candidate.DEMO_MODE) ||
      candidate.CORS_ORIGINS.split(',').some((o) => !o.startsWith('https://')) ||
      /development|change-me|replace|example|placeholder/i.test(candidate.OTP_HASH_SECRET))
  )
    throw new Error('Production requires real OTP, HTTPS origins, and a unique OTP hash secret');
  // Mock OTP displays codes on screen; it must never sit behind a proxy or tunnel.
  if (candidate.OTP_PROVIDER === 'mock' && !candidate.DEMO_MODE && candidate.TRUST_PROXY_HOPS > 0)
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
  // Demo mode exposes sign-in codes, so it must never hold real payments, messages or SMS.
  if (
    candidate.DEMO_MODE &&
    (candidate.OTP_PROVIDER !== 'mock' ||
      !candidate.DEMO_STAFF_CODE ||
      candidate.RAZORPAY_KEY_ID ||
      candidate.RAZORPAY_KEY_SECRET ||
      candidate.RAZORPAY_WEBHOOK_SECRET ||
      candidate.WHATSAPP_PROVIDER === 'meta' ||
      candidate.WA_MODE !== 'off' ||
      candidate.WA_REPLY_PROVIDER !== 'off')
  )
    throw new Error(
      'DEMO_MODE requires mock OTP and DEMO_STAFF_CODE, and forbids Razorpay and real WhatsApp',
    );
  if (
    candidate.DEMO_MODE &&
    new URL(candidate.DATABASE_URL).hostname !== candidate.DEMO_DATABASE_HOST
  )
    throw new Error('DEMO_MODE requires DEMO_DATABASE_HOST to name the database it runs against');
  config = candidate;
  return config;
}
export const onlineReady = () => {
  const c = getConfig();
  return Boolean(c.RAZORPAY_KEY_ID && c.RAZORPAY_KEY_SECRET && c.RAZORPAY_WEBHOOK_SECRET);
};
