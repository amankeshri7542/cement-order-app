import type { Bulk } from '../bulk';
import { istInstant } from '../calendar';
import type { SeedContext } from '../context';
import type { Rng } from '../rng';
import type { SeedProduct } from './catalogue';
import type { WaOrder } from './business';
import type { SeedCustomer } from './people';

const MINUTE = 60_000;

/** How a customer might write the same order. Hinglish, short, the way people type. */
function orderText(rng: Rng, lines: WaOrder['lines'], area: string) {
  const greet = rng.pick(['Bhaiya', 'Namaste', 'Sir', 'Bhai ji', '']);
  const parts = lines.map((l) => {
    const unit = l.unit === 'bag' ? 'bori' : l.unit === 'trolley' ? 'trolley' : l.unit;
    return `${l.quantity} ${unit} ${l.name}`;
  });
  const when = rng.pick(['aaj', 'kal subah', 'jaldi', 'kal']);
  return `${greet} ${parts.join(', ')} ${area} bhej dijiye ${when}`.replace(/\s+/g, ' ').trim();
}

/**
 * A thread for each customer who orders on WhatsApp. Each WhatsApp order gets the customer's
 * message and a confirmed card that points at it. A few cards from today are still open, so
 * the WhatsApp page has work waiting.
 */
export async function seedWhatsApp(
  ctx: SeedContext,
  bulk: Bulk,
  rng: Rng,
  input: {
    orders: readonly WaOrder[];
    products: readonly SeedProduct[];
    customers: readonly SeedCustomer[];
    now: Date;
  },
) {
  const threads = new Map<string, { id: string; last: Date; created: Date }>();
  let messages = 0;
  const threadFor = (c: SeedCustomer, at: Date) => {
    const t = threads.get(c.id) ?? { id: `demo-wt-${c.id}`, last: at, created: at };
    if (at > t.last) t.last = at;
    if (at < t.created) t.created = at;
    threads.set(c.id, t);
    return t.id;
  };
  const cards: Record<string, unknown>[] = [];
  const say = async (threadId: string, text: string, at: Date, state: string) => {
    const wamid = `demo.wamid.${++messages}`;
    await bulk.add('WaMessage', {
      id: `demo-wm-${messages}`,
      wamid,
      threadId,
      direction: 'IN',
      type: 'text',
      text,
      state,
      sentAt: at,
      receivedAt: at,
    });
    return wamid;
  };
  const line = (l: WaOrder['lines'][number]) => ({
    rawText: `${l.quantity} ${l.unit} ${l.name}`,
    productId: l.productId,
    productName: l.name,
    quantity: l.quantity,
    unitWord: l.unit,
    candidates: 1,
  });

  // Threads are written before their messages, so collect first.
  const sent: { order: WaOrder; at: Date; text: string; threadId: string }[] = [];
  for (const order of input.orders) {
    const at = new Date(order.at.getTime() - rng.int(2, 20) * MINUTE);
    sent.push({
      order,
      at,
      text: orderText(rng, order.lines, order.area),
      threadId: threadFor(order.customer, at),
    });
  }
  // Today's open cards: messages that came in this afternoon and wait for a person.
  const waiting = input.customers.filter((c) => c.kind !== 'house').slice(0, 400);
  const openCount = Math.min(waiting.length, rng.int(4, 9));
  const open: {
    c: SeedCustomer;
    at: Date;
    text: string;
    threadId: string;
    lines: WaOrder['lines'];
  }[] = [];
  // A thread holds at most one open card (a partial unique index), so each card is a new person.
  const picked = new Set<string>();
  for (let i = 0; i < openCount; i++) {
    const c = rng.pick(waiting);
    if (picked.has(c.id)) continue;
    picked.add(c.id);
    const at = new Date(
      Math.min(input.now.getTime() - rng.int(5, 200) * MINUTE, input.now.getTime()),
    );
    if (at < istInstant(ctx.today, 8, 0)) continue;
    const p = rng.pick(input.products);
    const lines = [
      { productId: p.id, name: p.name, quantity: rng.int(p.qty[0], p.qty[1]), unit: p.unit },
    ];
    open.push({ c, at, text: orderText(rng, lines, c.area), threadId: threadFor(c, at), lines });
  }

  const byId = new Map(input.customers.map((c) => [c.id, c]));
  for (const [customerId, t] of threads) {
    const c = byId.get(customerId)!;
    await bulk.add('WaThread', {
      id: t.id,
      contactKey: c.phone,
      phone: c.phone,
      profileName: c.name.split(' ')[0],
      savedName: c.name,
      userId: c.id,
      aiMode: 'AUTO',
      lastInboundAt: t.last,
      language: 'hinglish',
      createdAt: t.created,
      updatedAt: t.last,
    });
  }
  for (const s of sent) {
    const wamid = await say(s.threadId, s.text, s.at, 'READ');
    cards.push({
      id: `demo-wd-${s.order.orderId}`,
      threadId: s.threadId,
      source: 'WHATSAPP',
      status: 'CONFIRMED',
      locationId: s.order.shop,
      orderedByName: s.order.customer.name,
      orderedByPhone: s.order.customer.phone,
      originalText: s.text,
      lines: s.order.lines.map(line),
      placeText: s.order.area,
      pincode: s.order.pincode,
      fulfilment: 'DELIVERY',
      reader: 'rules',
      messageIds: [wamid],
      orderId: s.order.orderId,
      decidedById: s.order.decidedById,
      decidedAt: s.order.at,
      createdAt: s.at,
      updatedAt: s.order.at,
    });
  }
  for (const [i, o] of open.entries()) {
    const wamid = await say(o.threadId, o.text, o.at, 'RECEIVED');
    cards.push({
      id: `demo-wd-open-${i + 1}`,
      threadId: o.threadId,
      source: 'WHATSAPP',
      status: 'OPEN',
      locationId: o.c.shop,
      orderedByName: o.c.name,
      orderedByPhone: o.c.phone,
      originalText: o.text,
      lines: o.lines.map(line),
      placeText: o.c.area,
      pincode: o.c.pincode,
      fulfilment: 'DELIVERY',
      reader: 'rules',
      messageIds: [wamid],
      orderId: null,
      decidedById: null,
      decidedAt: null,
      createdAt: o.at,
      updatedAt: o.at,
    });
  }
  await bulk.addAll('WaDraft', cards);
  return { threads: threads.size, cards: cards.length };
}
