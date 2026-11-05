import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { getConfig } from '../config';
import { fail, safeEqual } from '../http';
import { buttonMeaning } from './replies';

export type WaEvent =
  | {
      kind: 'inbound';
      wamid: string;
      phone: string | null;
      bsuid: string | null;
      profileName: string;
      type: string;
      text: string | null;
      sentAt: Date;
    }
  | {
      kind: 'echo';
      wamid: string;
      phone: string | null;
      bsuid: string | null;
      type: string;
      sentAt: Date;
    }
  | { kind: 'edit'; wamid: string; text: string | null }
  | { kind: 'revoke'; wamid: string }
  | { kind: 'status'; wamid: string; status: string; code: number | null }
  | { kind: 'account'; event: string };

type Headers = Record<string, string | string[] | undefined>;
const header = (headers: Headers, name: string) => {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? '';
};
const hmac = (secret: string, data: Buffer | string) =>
  createHmac('sha256', secret).update(data).digest('hex');
// A signed request older than this is a replay, even with a good signature.
const signatureMaxAgeSeconds = 300;

/** Whether this request really came from the partner. Checked on the raw bytes, before parsing. */
export function verifyWebhook(raw: Buffer, headers: Headers, nowMs = Date.now()) {
  const c = getConfig();
  if (c.WA_WEBHOOK_PROVIDER === 'meta')
    return safeEqual(
      header(headers, 'x-hub-signature-256'),
      `sha256=${hmac(c.WHATSAPP_APP_SECRET!, raw)}`,
    );
  if (c.WA_WEBHOOK_PROVIDER === 'd360')
    return safeEqual(header(headers, 'x-shiv-webhook-secret'), c.WHATSAPP_WEBHOOK_SECRET!);
  if (c.WA_WEBHOOK_PROVIDER === 'ycloud') {
    const parts = header(headers, 'ycloud-signature').match(/^t=(\d{1,12}),s=([0-9a-f]{64})$/);
    if (!parts) return false;
    if (Math.abs(nowMs / 1000 - Number(parts[1])) > signatureMaxAgeSeconds) return false;
    return safeEqual(parts[2]!, hmac(c.WHATSAPP_WEBHOOK_SECRET!, `${parts[1]}.${raw.toString()}`));
  }
  return false;
}

const digits = (value: unknown) => (typeof value === 'string' ? value.replace(/\D/g, '') : '');
const phoneOf = (value: unknown) => {
  const number = digits(value);
  return number.length >= 10 && number.length <= 15 ? `+${number}` : null;
};
const secondsDate = (value: unknown) => {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
};
const isoDate = (value: unknown) => {
  const date = new Date(typeof value === 'string' ? value : NaN);
  return Number.isFinite(date.getTime()) ? date : new Date();
};
const wamidSchema = z.string().min(1).max(200);
const textBody = (message: { text?: { body?: unknown } | undefined }) =>
  typeof message.text?.body === 'string' ? message.text.body : null;
const buttonSchema = z
  .object({
    interactive: z
      .object({ button_reply: z.object({ id: z.string().max(100) }).optional() })
      .optional(),
    button: z.object({ payload: z.string().max(100) }).optional(),
  })
  .passthrough();
/** A tapped button, as the fixed words it stands for. An id we never sent reads as nothing. */
const tappedWords = (message: unknown) => {
  const parsed = buttonSchema.safeParse(message);
  if (!parsed.success) return null;
  const id = parsed.data.interactive?.button_reply?.id ?? parsed.data.button?.payload;
  return id ? buttonMeaning(id) : null;
};
const isTap = (type: string) => type === 'interactive' || type === 'button';
const statusSchema = z
  .object({
    id: wamidSchema,
    status: z.string().max(30),
    errors: z.array(z.object({ code: z.coerce.number().optional() }).passthrough()).optional(),
  })
  .passthrough();

const metaMessage = z
  .object({
    id: wamidSchema,
    from: z.string().optional(),
    to: z.string().optional(),
    from_user_id: z.string().max(200).optional(),
    to_user_id: z.string().max(200).optional(),
    timestamp: z.unknown().optional(),
    type: z.string().max(40),
    text: z.object({ body: z.unknown() }).partial().optional(),
    edit: z
      .object({
        original_message_id: wamidSchema,
        message: z
          .object({ text: z.object({ body: z.unknown() }).partial().optional() })
          .partial()
          .optional(),
      })
      .optional(),
    revoke: z.object({ original_message_id: wamidSchema }).optional(),
  })
  .passthrough();
const metaBody = z.object({
  entry: z.array(
    z.object({
      changes: z.array(z.object({ field: z.string(), value: z.record(z.string(), z.unknown()) })),
    }),
  ),
});
const metaContact = z
  .object({
    wa_id: z.string().optional(),
    user_id: z.string().max(200).optional(),
    profile: z.object({ name: z.string() }).partial().optional(),
  })
  .passthrough();

function parseMeta(body: unknown): WaEvent[] {
  const c = getConfig();
  const parsed = metaBody.safeParse(body);
  if (!parsed.success) fail('INVALID_BODY', 'This webhook body is not understood.');
  const events: WaEvent[] = [];
  for (const entry of parsed.data.entry)
    for (const { field, value } of entry.changes) {
      if (field === 'account_update') {
        events.push({ kind: 'account', event: String(value.event ?? '').slice(0, 60) });
        continue;
      }
      if (field !== 'messages' && field !== 'smb_message_echoes') continue;
      // A leaked secret should still not let anyone write into another number's desk.
      const metadata = (value.metadata ?? {}) as { phone_number_id?: unknown };
      if (String(metadata.phone_number_id ?? '') !== c.WHATSAPP_PHONE_NUMBER_ID)
        fail('FORBIDDEN', 'This webhook is for another number.', 403);
      if (field === 'messages' && Array.isArray(value.statuses))
        for (const item of value.statuses) {
          const status = statusSchema.safeParse(item);
          if (status.success)
            events.push({
              kind: 'status',
              wamid: status.data.id,
              status: status.data.status,
              code: status.data.errors?.[0]?.code ?? null,
            });
        }
      const list = field === 'messages' ? value.messages : value.message_echoes;
      if (!Array.isArray(list)) continue;
      const contacts = z.array(metaContact).safeParse(value.contacts ?? []);
      for (const item of list) {
        const message = metaMessage.safeParse(item);
        // One odd message must not make the partner retry the whole delivery for a week.
        if (!message.success) continue;
        events.push(...metaEvent(message.data, field, contacts.success ? contacts.data : []));
      }
    }
  return events;
}
function metaEvent(
  message: z.infer<typeof metaMessage>,
  field: string,
  contacts: z.infer<typeof metaContact>[],
): WaEvent[] {
  if (message.type === 'revoke')
    return message.revoke ? [{ kind: 'revoke', wamid: message.revoke.original_message_id }] : [];
  if (message.type === 'edit')
    return message.edit
      ? [
          {
            kind: 'edit',
            wamid: message.edit.original_message_id,
            text:
              typeof message.edit.message?.text?.body === 'string'
                ? message.edit.message.text.body
                : null,
          },
        ]
      : [];
  if (field === 'smb_message_echoes')
    return [
      {
        kind: 'echo',
        wamid: message.id,
        phone: phoneOf(message.to),
        bsuid: message.to_user_id ?? null,
        type: message.type,
        sentAt: secondsDate(message.timestamp),
      },
    ];
  const contact = contacts.find((row) => row.wa_id && row.wa_id === message.from);
  return [
    {
      kind: 'inbound',
      wamid: message.id,
      phone: phoneOf(message.from),
      bsuid: message.from_user_id ?? contact?.user_id ?? contacts[0]?.user_id ?? null,
      profileName: contact?.profile?.name ?? '',
      type: isTap(message.type) ? 'button' : message.type,
      text: isTap(message.type) ? tappedWords(message) : textBody(message),
      sentAt: secondsDate(message.timestamp),
    },
  ];
}

const ycloudMessage = z
  .object({
    wamid: wamidSchema,
    from: z.string().optional(),
    to: z.string().optional(),
    toUserId: z.string().max(200).optional(),
    fromUserId: z.string().max(200).optional(),
    type: z.string().max(40),
    sendTime: z.unknown().optional(),
    text: z.object({ body: z.unknown() }).partial().optional(),
    customerProfile: z.object({ name: z.string() }).partial().optional(),
  })
  .passthrough();
const ycloudBody = z
  .object({
    type: z.string().max(100),
    whatsappInboundMessage: z.unknown().optional(),
    whatsappMessage: z.unknown().optional(),
  })
  .passthrough();

const ycloudStatus = z
  .object({
    wamid: wamidSchema,
    status: z.string().max(30),
    errorCode: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

/** YCloud's shape, from its published examples. Not yet checked against a real delivery. */
function parseYcloud(body: unknown): WaEvent[] {
  const c = getConfig();
  const parsed = ycloudBody.safeParse(body);
  if (!parsed.success) fail('INVALID_BODY', 'This webhook body is not understood.');
  const own = digits(c.WA_BUSINESS_PHONE);
  if (parsed.data.type === 'whatsapp.inbound_message.received') {
    const message = ycloudMessage.safeParse(parsed.data.whatsappInboundMessage);
    if (!message.success) return [];
    if (digits(message.data.to) !== own)
      fail('FORBIDDEN', 'This webhook is for another number.', 403);
    if (message.data.type === 'edit' || message.data.type === 'revoke') {
      const changed = metaMessage.safeParse({
        ...message.data,
        id: message.data.wamid,
        timestamp: 0,
      });
      return changed.success ? metaEvent(changed.data, 'messages', []) : [];
    }
    return [
      {
        kind: 'inbound',
        wamid: message.data.wamid,
        phone: phoneOf(message.data.from),
        bsuid: message.data.fromUserId ?? null,
        profileName: message.data.customerProfile?.name ?? '',
        type: isTap(message.data.type) ? 'button' : message.data.type,
        text: isTap(message.data.type) ? tappedWords(message.data) : textBody(message.data),
        sentAt: isoDate(message.data.sendTime),
      },
    ];
  }
  if (parsed.data.type === 'whatsapp.smb.message.echoes') {
    const message = ycloudMessage.safeParse(parsed.data.whatsappMessage);
    if (!message.success) return [];
    if (digits(message.data.from) !== own)
      fail('FORBIDDEN', 'This webhook is for another number.', 403);
    return [
      {
        kind: 'echo',
        wamid: message.data.wamid,
        phone: phoneOf(message.data.to),
        bsuid: message.data.toUserId ?? null,
        type: message.data.type,
        sentAt: isoDate(message.data.sendTime),
      },
    ];
  }
  if (parsed.data.type === 'whatsapp.message.updated') {
    const message = ycloudStatus.safeParse(parsed.data.whatsappMessage);
    if (!message.success) return [];
    return [
      {
        kind: 'status',
        wamid: message.data.wamid,
        status: message.data.status,
        code: message.data.errorCode ? Number(message.data.errorCode) || null : null,
      },
    ];
  }
  if (parsed.data.type.startsWith('whatsapp.business_account.'))
    return [{ kind: 'account', event: parsed.data.type.slice(0, 60) }];
  return [];
}

export function parseWebhook(raw: Buffer): WaEvent[] {
  let body: unknown;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    fail('INVALID_BODY', 'This webhook body is not understood.');
  }
  return getConfig().WA_WEBHOOK_PROVIDER === 'ycloud' ? parseYcloud(body) : parseMeta(body);
}
