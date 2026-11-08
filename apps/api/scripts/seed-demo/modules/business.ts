import type { Bulk } from '../bulk';
import { addDays, busyness, dayRange, istInstant } from '../calendar';
import { PLACES, type SeedContext } from '../context';
import type { Rng } from '../rng';
import type { SeedProduct } from './catalogue';
import type { SeedCustomer, SeedStaff } from './people';
import { GODOWNS, SHOPS, godownFor } from './places';
import type { DrawerPayout } from './salary';

/** Orders per size over the whole history (platform section 4.2). */
const ORDER_TARGET = { small: 3000, medium: 25000, large: 400000 } as const;
const MINUTE = 60_000;

type Source = 'APP' | 'PHONE' | 'WALK_IN' | 'WHATSAPP';
type Status =
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED';

/** A WhatsApp order, for the WhatsApp module to give a thread, messages and a card. */
export type WaOrder = {
  orderId: string;
  customer: SeedCustomer;
  shop: string;
  at: Date;
  lines: { productId: string; name: string; quantity: number; unit: string }[];
  decidedById: string;
  pincode: string;
  area: string;
};

type Event = { at: Date; seq: number; run: () => Promise<void> };

export type BusinessResult = {
  totals: Map<string, { balance: number; lastOrderAt: Date | null }>;
  waOrders: WaOrder[];
  levels: Map<string, number>;
  orders: number;
};

/**
 * The shop's history, day by day in time order: orders from every door with their full status
 * trail, stock out and back in (purchases at the godown, transfers to the shops), udhaar sales and
 * payments, counter sales, small expenses and the evening galla close. Every balance column is the
 * running sum of the rows before it, exactly as the API keeps it.
 */
export async function seedBusiness(
  ctx: SeedContext,
  bulk: Bulk,
  rng: Rng,
  input: {
    products: readonly SeedProduct[];
    customers: readonly SeedCustomer[];
    staff: readonly SeedStaff[];
    payouts: readonly DrawerPayout[];
    now: Date;
  },
): Promise<BusinessResult> {
  const { products, customers, staff, now } = input;
  const days = dayRange(ctx.firstDay, ctx.today);
  const queue = new Map<string, Event[]>();
  let seq = 0;
  const dayOf = (at: Date) => new Date(at.getTime() + 330 * MINUTE).toISOString().slice(0, 10);
  const schedule = (at: Date, run: () => Promise<void>) => {
    if (at > now) return;
    const day = dayOf(at);
    const list = queue.get(day) ?? [];
    list.push({ at, seq: seq++, run });
    queue.set(day, list);
  };
  /** Work happens 08:00 to 19:50; anything later moves to the next morning. */
  const working = (at: Date) => {
    const day = dayOf(at);
    const open = istInstant(day, 8, 0);
    const shut = istInstant(day, 19, 50);
    if (at < open) return new Date(open.getTime() + rng.int(0, 40) * MINUTE);
    if (at > shut) return istInstant(addDays(day, 1), 9, rng.int(0, 50));
    return at;
  };

  const byRole = (role: SeedStaff['role'], shop: string | null) =>
    staff
      .filter((s) => s.role === role && (shop === null || s.locationId === shop))
      .map((s) => s.id);
  const cashier = (shop: string) => byRole('CASHIER', shop)[0] ?? ctx.actors.owner;
  const drivers = (shop: string) => {
    const list = byRole('DRIVER', shop);
    return list.length ? list : [ctx.actors.owner];
  };
  const keeper = (loc: string) => byRole('STOCK_KEEPER', loc)[0] ?? cashier(PLACES.shopA);

  // ---- Stock -------------------------------------------------------------------------------
  const levels = new Map<string, number>();
  const key = (productId: string, loc: string) => `${productId}|${loc}`;
  const lastAt = new Map<string, number>();
  let movementCount = 0;
  const move = async (
    p: SeedProduct,
    loc: string,
    quantity: number,
    kind: string,
    at: Date,
    reference: string,
    note: string,
    idempotencyKey: string,
    actorId: string,
  ) => {
    const k = key(p.id, loc);
    const balance = (levels.get(k) ?? 0) + quantity;
    if (balance < 0) throw new Error(`Stock of ${p.id} at ${loc} would go below zero`);
    levels.set(k, balance);
    lastAt.set(loc, Math.max(lastAt.get(loc) ?? 0, at.getTime()));
    const id = `demo-im-${++movementCount}`;
    await bulk.add('InventoryMovement', {
      id,
      productId: p.id,
      locationId: loc,
      kind,
      quantity,
      balanceAfter: balance,
      actorId,
      reference,
      note,
      idempotencyKey,
      createdAt: at,
    });
    return id;
  };
  const par = (p: SeedProduct) => (p.counted ? Math.max(20, p.lowStockAt * 4) : 30);
  const godownStocked = (p: SeedProduct) => p.category === 'cement' || p.category === 'steel';
  let purchaseCount = 0;
  let transferCount = 0;
  const purchase = async (p: SeedProduct, loc: string, quantity: number, at: Date) => {
    purchaseCount++;
    await move(
      p,
      loc,
      quantity,
      'PURCHASE_IN',
      at,
      `Supplier bill DEMO-${String(purchaseCount).padStart(6, '0')}`,
      'Truck unloaded',
      `demo-purchase:${purchaseCount}`,
      keeper(loc),
    );
  };
  /** Brings a shop up to its level, from its own firm's godown for cement and steel. */
  const restock = async (p: SeedProduct, shop: string, at: Date) => {
    const need = par(p) - (levels.get(key(p.id, shop)) ?? 0);
    if (need <= 0) return;
    if (!godownStocked(p)) return purchase(p, shop, need, at);
    const godown = godownFor[shop]!;
    const have = levels.get(key(p.id, godown)) ?? 0;
    if (have < need)
      await purchase(
        p,
        godown,
        Math.max(need - have, par(p) * 2),
        new Date(at.getTime() - 30 * MINUTE),
      );
    transferCount++;
    const id = `demo-tr-${transferCount}`;
    const received = new Date(at.getTime() + rng.int(5, 25) * MINUTE);
    await bulk.add('StockTransfer', {
      id,
      fromLocationId: godown,
      toLocationId: shop,
      status: 'RECEIVED',
      vehicle: `BR01 ${rng.pick(['GA', 'GB', 'PA'])} ${rng.int(1000, 9999)}`,
      note: '',
      sentById: keeper(godown),
      sentAt: at,
      receivedById: cashier(shop),
      receivedAt: received,
      idempotencyKey: `demo-transfer:${transferCount}`,
    });
    await bulk.add('StockTransferLine', {
      transferId: id,
      productId: p.id,
      sentQty: need,
      receivedQty: need,
    });
    await move(
      p,
      godown,
      -need,
      'TRANSFER_OUT',
      at,
      id,
      'To shop',
      `transfer:${id}:out:${p.id}`,
      keeper(godown),
    );
    await move(
      p,
      shop,
      need,
      'TRANSFER_IN',
      received,
      id,
      'From godown',
      `transfer:${id}:in:${p.id}`,
      cashier(shop),
    );
  };
  /** Takes stock out for a sale, restocking just before it if the shelf is short. */
  const takeOut = async (
    p: SeedProduct,
    shop: string,
    quantity: number,
    at: Date,
    kind: string,
    reference: string,
    note: string,
    idempotencyKey: string,
    actorId: string,
  ) => {
    if ((levels.get(key(p.id, shop)) ?? 0) < quantity) {
      const before = new Date(Math.max((lastAt.get(shop) ?? 0) + 1000, at.getTime() - 20 * MINUTE));
      // A line being run down gets only what this sale needs, so it ends the history short.
      const extra = runDown.has(p.id) && dayOf(at) >= lastWeek ? 0 : par(p);
      await purchase(p, shop, quantity + extra, before < at ? before : at);
    }
    return move(p, shop, -quantity, kind, at, reference, note, idempotencyKey, actorId);
  };

  // Opening count on the first morning.
  const opening = istInstant(ctx.firstDay, 7, 0);
  for (const p of products) {
    for (const shop of SHOPS)
      await move(
        p,
        shop,
        par(p),
        'OPENING_COUNT',
        opening,
        'Opening count',
        'Demo opening stock',
        `demo-open:${p.id}:${shop}`,
        keeper(shop),
      );
    if (godownStocked(p))
      for (const godown of GODOWNS)
        await move(
          p,
          godown,
          par(p) * 2,
          'OPENING_COUNT',
          opening,
          'Opening count',
          'Demo opening stock',
          `demo-open:${p.id}:${godown}`,
          keeper(godown),
        );
  }
  // A few lines go short at the end, so "Kam stock" has something to show.
  const runDown = new Set(products.filter(() => rng.chance(0.08)).map((p) => p.id));
  const lastWeek = addDays(ctx.today, -10);

  // ---- Money -------------------------------------------------------------------------------
  type Drawer = { cash: number };
  const drawer = new Map<string, Drawer>();
  const drawerOf = (shop: string, day: string) => {
    const k = `${shop}|${day}`;
    const d = drawer.get(k) ?? { cash: 0 };
    drawer.set(k, d);
    return d;
  };
  let fmCount = 0;
  const money = async (row: {
    locationId: string;
    kind: string;
    amountPaise: number;
    at: Date;
    channel: string;
    actorId: string;
    paymentId?: string;
    inventoryMovementId?: string;
    counterParty?: string;
  }) => {
    const id = `demo-fm-${++fmCount}`;
    await bulk.add('FinancialMovement', {
      id,
      locationId: row.locationId,
      paymentId: row.paymentId ?? null,
      inventoryMovementId: row.inventoryMovementId ?? null,
      kind: row.kind,
      amountPaise: row.amountPaise,
      actorId: row.actorId,
      occurredAt: row.at,
      channel: row.channel,
      counterParty: row.counterParty ?? '',
    });
    const cash = row.channel === 'CASH' || row.channel === '';
    const sign: Record<string, number> = {
      COUNTER_SALE: 1,
      COLLECTION: 1,
      KHATA_PAYMENT: 1,
      KHATA_PAYMENT_REVERSAL: -1,
      REFUND: -1,
    };
    if (row.kind === 'STAFF_PAY') drawerOf(row.locationId, dayOf(row.at)).cash -= row.amountPaise;
    else if (cash && sign[row.kind])
      drawerOf(row.locationId, dayOf(row.at)).cash += sign[row.kind]! * row.amountPaise;
    return id;
  };

  const totals = new Map<string, { balance: number; lastOrderAt: Date | null }>();
  const totalOf = (id: string) => {
    const t = totals.get(id) ?? { balance: 0, lastOrderAt: null };
    totals.set(id, t);
    return t;
  };
  let ledgerCount = 0;
  const ledger = async (
    c: SeedCustomer,
    kind: 'SALE_ON_CREDIT' | 'PAYMENT_RECEIVED',
    amountPaise: number,
    at: Date,
    actorId: string,
    link: { orderId?: string; financialMovementId?: string },
    note: string,
  ) => {
    const t = totalOf(c.id);
    t.balance += amountPaise;
    await bulk.add('CustomerLedgerEntry', {
      id: `demo-le-${++ledgerCount}`,
      locationId: c.shop,
      customerId: c.id,
      kind,
      amountPaise,
      balanceAfterPaise: t.balance,
      orderId: link.orderId ?? null,
      financialMovementId: link.financialMovementId ?? null,
      note,
      actorId,
      occurredAt: at,
      createdAt: at,
    });
  };

  // ---- Who orders --------------------------------------------------------------------------
  const contractors = customers.filter((c) => c.kind === 'contractor');
  const regulars = customers.filter((c) => c.kind === 'regular');
  const houses = customers
    .filter((c) => c.kind === 'house')
    .sort((a, b) => (a.startDay < b.startDay ? -1 : 1));
  const contractorWeights = contractors.reduce<number[]>((acc, c) => {
    acc.push((acc[acc.length - 1] ?? 0) + c.weight);
    return acc;
  }, []);
  const pickContractor = () => {
    const roll = rng.next() * (contractorWeights[contractorWeights.length - 1] ?? 0);
    let lo = 0;
    let hi = contractorWeights.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (contractorWeights[mid]! < roll) lo = mid + 1;
      else hi = mid;
    }
    return contractors[lo];
  };
  const HOUSE_WINDOW = 150;
  const pickHouse = (day: string) => {
    // Owners building now: their start day falls in the last 150 days.
    const from = addDays(day, -HOUSE_WINDOW);
    let lo = 0;
    let hi = houses.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (houses[mid]!.startDay < from) lo = mid + 1;
      else hi = mid;
    }
    let end = lo;
    let top = houses.length;
    while (end < top) {
      const mid = (end + top) >> 1;
      if (houses[mid]!.startDay <= day) end = mid + 1;
      else top = mid;
    }
    return end > lo ? houses[rng.int(lo, end - 1)] : undefined;
  };

  const byCategory = new Map<string, { list: SeedProduct[]; total: number }>();
  for (const p of products) {
    const entry = byCategory.get(p.category) ?? { list: [], total: 0 };
    entry.list.push(p);
    entry.total += p.weight;
    byCategory.set(p.category, entry);
  }
  const pickProduct = (category: string) => {
    const entry = byCategory.get(category);
    if (!entry) return undefined;
    let roll = rng.next() * entry.total;
    for (const p of entry.list) {
      roll -= p.weight;
      if (roll < 0) return p;
    }
    return entry.list[entry.list.length - 1];
  };
  const mixes: Record<SeedCustomer['kind'], [string, number][]> = {
    house: [
      ['cement', 0.35],
      ['steel', 0.2],
      ['sand', 0.15],
      ['bricks', 0.12],
      ['aggregates', 0.1],
      ['pipes', 0.05],
      ['hardware', 0.03],
    ],
    contractor: [
      ['cement', 0.4],
      ['steel', 0.25],
      ['sand', 0.1],
      ['aggregates', 0.1],
      ['bricks', 0.08],
      ['pipes', 0.04],
      ['hardware', 0.03],
    ],
    regular: [
      ['cement', 0.3],
      ['hardware', 0.25],
      ['pipes', 0.2],
      ['steel', 0.1],
      ['sand', 0.1],
      ['bricks', 0.05],
    ],
  };
  const sources: Record<SeedCustomer['kind'], [Source, number][]> = {
    contractor: [
      ['PHONE', 0.45],
      ['WHATSAPP', 0.3],
      ['APP', 0.15],
      ['WALK_IN', 0.1],
    ],
    house: [
      ['PHONE', 0.35],
      ['APP', 0.3],
      ['WALK_IN', 0.2],
      ['WHATSAPP', 0.15],
    ],
    regular: [
      ['WALK_IN', 0.4],
      ['PHONE', 0.3],
      ['APP', 0.15],
      ['WHATSAPP', 0.15],
    ],
  };

  // ---- One order ---------------------------------------------------------------------------
  const numbers = new Set<string>();
  const hex = (n: number) =>
    Array.from({ length: n }, () => '0123456789abcdef'[rng.int(0, 15)]).join('');
  const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[rng.int(0, 3)]}${hex(3)}-${hex(12)}`;
  const waOrders: WaOrder[] = [];
  let orderCount = 0;
  let historyCount = 0;

  const placeOrder = async (c: SeedCustomer, day: string) => {
    const source = rng.weighted(sources[c.kind]);
    const shop = c.shop;
    const lineCount = rng.weighted([
      [1, 0.45],
      [2, 0.3],
      [3, 0.17],
      [4, 0.08],
    ]);
    const chosen = new Map<string, SeedProduct>();
    for (let i = 0; i < lineCount * 2 && chosen.size < lineCount; i++) {
      const p = pickProduct(rng.weighted(mixes[c.kind]));
      if (p) chosen.set(p.id, p);
    }
    if (!chosen.size) return;
    const hour = rng.weighted([
      [8, 0.06],
      [9, 0.1],
      [10, 0.13],
      [11, 0.13],
      [12, 0.11],
      [13, 0.08],
      [14, 0.09],
      [15, 0.1],
      [16, 0.09],
      [17, 0.07],
      [18, 0.04],
    ]);
    const created = istInstant(day, hour, rng.int(0, 59));
    if (created > now) return;
    const id = `demo-o${String(++orderCount).padStart(7, '0')}`;
    let number: string;
    do number = `SC-${day.slice(0, 4)}-${hex(8).toUpperCase()}`;
    while (numbers.has(number));
    numbers.add(number);
    const factor = c.kind === 'contractor' ? 1.4 : c.kind === 'regular' ? 0.5 : 1;
    const items = [...chosen.values()].map((p, i) => {
      const quantity = Math.max(1, Math.round(rng.int(p.qty[0], p.qty[1]) * factor));
      const rate = p.rateOn(day);
      return {
        id: `${id}-i${i + 1}`,
        orderId: id,
        productId: p.id,
        name: p.name,
        unit: p.unit,
        packSize: p.packSize,
        quantity,
        listPricePaise: rate.paise,
        pricePaise: rate.paise,
        priceVersion: rate.version,
        lineTotalPaise: rate.paise * quantity,
        product: p,
      };
    });
    const subtotal = items.reduce((n, i) => n + i.lineTotalPaise, 0);
    const fee =
      source === 'WALK_IN' || subtotal >= 5000000 ? 0 : shop === PLACES.shopB ? 50000 : 40000;
    const total = subtotal + fee;
    const credit = c.credit && rng.chance(0.75);
    const address = c.addresses[rng.int(0, c.addresses.length - 1)]!;
    const confirmer = rng.chance(0.55) ? ctx.actors.owner : cashier(shop);

    // The status trail, cut at "now".
    const trail: [Status, Date, string, string][] = [];
    let t = created;
    if (source === 'APP') {
      trail.push([
        'AWAITING_CONFIRMATION',
        t,
        credit ? 'Credit order placed.' : 'Cash on delivery order placed.',
        c.id,
      ]);
      // This afternoon's app orders mostly still wait, so Pakka karo has work at "now".
      const waits = created.getTime() > now.getTime() - 4 * 60 * MINUTE && rng.chance(0.7);
      t = working(new Date(t.getTime() + (waits ? rng.int(300, 600) : rng.int(5, 90)) * MINUTE));
      trail.push(['CONFIRMED', t, 'Confirmed by the shop.', confirmer]);
    } else trail.push(['CONFIRMED', t, 'Order recorded by owner.', confirmer]);
    const cancelled = rng.chance(0.04);
    const walkIn = source === 'WALK_IN';
    const driver = rng.pick(drivers(shop));
    if (cancelled) {
      t = working(new Date(t.getTime() + rng.int(10, 60) * MINUTE));
      trail.push([
        'CANCELLED',
        t,
        rng.pick(['Customer cancelled.', 'Customer will order later.', 'Site not ready.']),
        cashier(shop),
      ]);
    } else {
      t = working(new Date(t.getTime() + (walkIn ? 3 : rng.int(20, 120)) * MINUTE));
      trail.push(['PREPARING', t, '', keeper(shop)]);
      t = working(new Date(t.getTime() + (walkIn ? 5 : rng.int(30, 150)) * MINUTE));
      trail.push([
        'OUT_FOR_DELIVERY',
        t,
        walkIn ? '' : 'Goods loaded.',
        walkIn ? cashier(shop) : driver,
      ]);
      t = working(new Date(t.getTime() + (walkIn ? 4 : rng.int(45, 180)) * MINUTE));
      trail.push([
        'DELIVERED',
        t,
        walkIn ? 'Handed over at the counter.' : 'Delivered by driver.',
        walkIn ? cashier(shop) : driver,
      ]);
    }
    const shown = trail.filter(([, at]) => at <= now);
    const [status, lastAt] = shown[shown.length - 1]!;
    const delivered = status === 'DELIVERED';
    const outAt = shown.find(([s]) => s === 'OUT_FOR_DELIVERY')?.[1];
    const confirmedAt = shown.find(([s]) => s === 'CONFIRMED')?.[1] ?? null;

    if (source === 'APP')
      await bulk.add('CheckoutReview', {
        id: `${id}-review`,
        userId: c.id,
        snapshot: {
          items: items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            pricePaise: i.pricePaise,
          })),
          subtotalPaise: subtotal,
          deliveryFeePaise: fee,
          totalPaise: total,
        },
        expiresAt: new Date(created.getTime() + 15 * MINUTE),
        createdAt: new Date(created.getTime() - 2 * MINUTE),
      });
    await bulk.add('Order', {
      id,
      number,
      userId: c.id,
      reviewId: source === 'APP' ? `${id}-review` : null,
      idempotencyKey: source === 'WHATSAPP' ? `wa:demo-wd-${id}` : uuid(),
      status,
      source,
      locationId: shop,
      address: walkIn
        ? {
            label: 'Dukaan se',
            name: c.name,
            phone: c.phone,
            line1: 'Collected at the shop',
            area: c.area,
            city: 'Patna',
            state: 'Bihar',
            pincode: c.pincode,
            landmark: '',
          }
        : {
            label: address.label,
            name: address.name,
            phone: address.phone,
            line1: address.line1,
            area: address.area,
            city: 'Patna',
            state: 'Bihar',
            pincode: address.pincode,
            landmark: '',
          },
      deliveryDate: dayOf(outAt ?? addDaysAt(created, 1)),
      notes: '',
      subtotalPaise: subtotal,
      deliveryFeePaise: fee,
      totalPaise: total,
      version: shown.length,
      confirmedAt,
      confirmedById: confirmedAt ? confirmer : null,
      createdById: source === 'APP' ? null : confirmer,
      createdAt: created,
      updatedAt: lastAt,
    });
    for (const { product: _p, ...item } of items) await bulk.add('OrderItem', item);
    for (const [s, at, note, actor] of shown)
      await bulk.add('OrderStatusHistory', {
        id: `demo-oh-${++historyCount}`,
        orderId: id,
        status: s,
        note,
        actorId: actor,
        createdAt: at,
      });
    const paymentId = `${id}-pay`;
    await bulk.add('Payment', {
      id: paymentId,
      orderId: id,
      method: credit ? 'CREDIT' : 'COD',
      status: delivered && !credit ? 'CAPTURED' : 'PENDING',
      amountPaise: total,
      createdAt: created,
      updatedAt: lastAt,
    });
    await bulk.add('OwnerWork', {
      id: `${id}-work`,
      orderId: id,
      assignedToId: source === 'APP' ? null : confirmer,
      acknowledgedAt: confirmedAt,
      // Already delivered, so the alert worker never sends anything for seeded orders.
      createdAt: created,
      deliveredAt: created,
      nextAttemptAt: created,
    });
    const tot = totalOf(c.id);
    if (!tot.lastOrderAt || created > tot.lastOrderAt) tot.lastOrderAt = created;

    // What happens to stock and money, at the moment it happens.
    schedule(created, async () => {
      for (const i of items)
        await takeOut(
          i.product,
          shop,
          i.quantity,
          created,
          walkIn ? 'WALK_IN_SALE' : 'ONLINE_ORDER',
          source === 'APP' ? `${id}-review` : number,
          source === 'APP' ? 'Online order reservation' : '',
          source === 'APP' ? `order:${id}-review:${i.productId}` : `phone:${number}:${i.productId}`,
          source === 'APP' ? c.id : confirmer,
        );
    });
    const cancelAt = shown.find(([s]) => s === 'CANCELLED')?.[1];
    if (cancelAt)
      schedule(cancelAt, async () => {
        for (const i of items)
          await move(
            i.product,
            shop,
            i.quantity,
            'ORDER_CANCELLED',
            cancelAt,
            number,
            'Order cancelled',
            `cancel:${id}:${i.productId}`,
            cashier(shop),
          );
      });
    if (credit && outAt)
      schedule(outAt, () =>
        ledger(
          c,
          'SALE_ON_CREDIT',
          total,
          outAt,
          cashier(shop),
          { orderId: id },
          `Credit sale ${number}`,
        ),
      );
    if (delivered && !credit) {
      const at = shown[shown.length - 1]![1];
      schedule(at, async () => {
        await money({
          locationId: shop,
          kind: 'COLLECTION',
          amountPaise: total,
          at,
          channel: rng.chance(0.65) ? 'CASH' : 'UPI',
          actorId: cashier(shop),
          paymentId,
        });
      });
    }
    if (source === 'WHATSAPP')
      waOrders.push({
        orderId: id,
        customer: c,
        shop,
        at: created,
        lines: items.map((i) => ({
          productId: i.productId,
          name: i.name,
          quantity: i.quantity,
          unit: i.unit,
        })),
        decidedById: confirmer,
        pincode: address.pincode,
        area: address.area,
      });
  };

  // ---- The days ----------------------------------------------------------------------------
  const target = ORDER_TARGET[ctx.size];
  // Today is never a holiday in the demo: the Aaj page needs a working day to show.
  const weights = days.map((day) =>
    day === ctx.today ? Math.max(busyness(day), 0.95) : busyness(day),
  );
  const perUnit = target / weights.reduce((a, b) => a + b, 0);
  const credits = customers.filter((c) => c.credit);
  const lastPaid = new Map<string, string>();
  const payouts = new Map<string, DrawerPayout[]>();
  for (const p of input.payouts) payouts.set(p.day, [...(payouts.get(p.day) ?? []), p]);
  const counterItems = products.filter(
    (p) => p.category === 'hardware' || p.category === 'pipes' || p.category === 'cement',
  );
  let counterCount = 0;
  let gallaCount = 0;
  let closeCount = 0;
  const lastCounted = new Map<string, number>();

  for (const [index, day] of days.entries()) {
    // Morning restock: shelves below one and a half times their low mark are filled.
    const morning = istInstant(day, 6, 45);
    if (morning <= now)
      for (const shop of SHOPS)
        for (const p of products) {
          if (runDown.has(p.id) && day >= lastWeek) continue;
          if ((levels.get(key(p.id, shop)) ?? 0) < Math.max(1, p.lowStockAt * 1.5))
            await restock(p, shop, new Date(morning.getTime() + rng.int(0, 25) * MINUTE));
        }

    // Orders.
    const count = Math.max(0, Math.round(perUnit * weights[index]! * (0.8 + rng.next() * 0.4)));
    for (let i = 0; i < count; i++) {
      const kind = rng.weighted<SeedCustomer['kind']>([
        ['contractor', 0.4],
        ['house', 0.35],
        ['regular', 0.25],
      ]);
      const c =
        kind === 'contractor'
          ? pickContractor()
          : kind === 'house'
            ? pickHouse(day)
            : rng.pick(regulars);
      if (c) await placeOrder(c, day);
    }

    // Counter sales without an order: a few bags, nails, a pipe.
    for (const shop of SHOPS) {
      const n = Math.round(
        weights[index]! * (shop === PLACES.shopA ? 9 : 5) * (0.7 + rng.next() * 0.6),
      );
      for (let i = 0; i < n; i++) {
        const p = rng.pick(counterItems);
        const at = istInstant(day, rng.int(8, 19), rng.int(0, 49));
        const quantity = rng.int(1, p.category === 'cement' ? 5 : 4);
        const id = ++counterCount;
        schedule(at, async () => {
          const movement = await takeOut(
            p,
            shop,
            quantity,
            at,
            'WALK_IN_SALE',
            'Counter sale',
            '',
            `demo-counter:${id}`,
            cashier(shop),
          );
          await money({
            locationId: shop,
            kind: 'COUNTER_SALE',
            amountPaise: p.rateOn(day).paise * quantity,
            at,
            channel: rng.chance(0.8) ? 'CASH' : 'UPI',
            actorId: cashier(shop),
            inventoryMovementId: movement,
          });
        });
      }
    }

    // Udhaar payments: good payers settle every few weeks, slow ones rarely.
    for (const c of credits) {
      const balance = totalOf(c.id).balance;
      if (balance <= 0) continue;
      const since = lastPaid.get(c.id);
      if (since && since > addDays(day, -7)) continue;
      if (!rng.chance(0.07 * c.payer)) continue;
      const amount = Math.min(
        balance,
        Math.max(50000, Math.floor((balance * (0.3 + rng.next() * 0.7)) / 10000) * 10000),
      );
      const at = istInstant(day, rng.int(10, 18), rng.int(0, 59));
      lastPaid.set(c.id, day);
      schedule(at, async () => {
        const live = totalOf(c.id).balance;
        const paid = Math.min(amount, live);
        if (paid <= 0) return;
        const fm = await money({
          locationId: c.shop,
          kind: 'KHATA_PAYMENT',
          amountPaise: paid,
          at,
          channel: rng.chance(0.55) ? 'CASH' : 'UPI',
          actorId: cashier(c.shop),
          counterParty: c.id,
        });
        await ledger(
          c,
          'PAYMENT_RECEIVED',
          -paid,
          at,
          cashier(c.shop),
          { financialMovementId: fm },
          '',
        );
      });
    }

    // Salaries paid from the drawer.
    for (const p of payouts.get(day) ?? [])
      schedule(p.at, async () => {
        await money({
          locationId: p.shop,
          kind: 'STAFF_PAY',
          amountPaise: p.amountPaise,
          at: p.at,
          channel: 'CASH',
          actorId: p.actorId,
        });
      });

    // Small expenses from the drawer.
    for (const shop of SHOPS)
      for (const [reason, lo, hi, chance] of [
        ['Chai-nashta', 80, 300, 0.9],
        ['Mazdoori (unloading)', 400, 1500, 0.5],
        ['Gaadi ka diesel', 800, 2500, 0.35],
        ['Bijli-pani', 300, 1200, 0.04],
      ] as const) {
        if (!rng.chance(chance)) continue;
        const at = istInstant(day, rng.int(9, 19), rng.int(0, 45));
        const amount = rng.int(lo, hi) * 100;
        const id = ++gallaCount;
        schedule(at, async () => {
          await bulk.add('GallaEntry', {
            id: `demo-ge-${id}`,
            locationId: shop,
            day,
            kind: 'PAID_OUT',
            amountPaise: amount,
            reason,
            actorId: cashier(shop),
            idempotencyKey: `demo-galla:${id}`,
            createdAt: at,
          });
          drawerOf(shop, day).cash -= amount;
        });
      }

    // Run the day in time order.
    const events = (queue.get(day) ?? []).sort(
      (a, b) => a.at.getTime() - b.at.getTime() || a.seq - b.seq,
    );
    queue.delete(day);
    for (const event of events) await event.run();

    // Evening: cash goes to the bank, then the drawer is counted and closed. Today stays open.
    if (day >= ctx.today) continue;
    for (const shop of SHOPS) {
      const d = drawerOf(shop, day);
      const opening = lastCounted.get(shop) ?? 0;
      let expected = opening + d.cash;
      const actor = cashier(shop);
      if (expected > 3000000) {
        const keep = rng.int(5, 15) * 100000;
        const deposit = Math.floor((expected - keep) / 100000) * 100000;
        if (deposit > 0) {
          const id = ++gallaCount;
          await bulk.add('GallaEntry', {
            id: `demo-ge-${id}`,
            locationId: shop,
            day,
            kind: 'PAID_OUT',
            amountPaise: deposit,
            reason: 'Bank mein jama',
            actorId: actor,
            idempotencyKey: `demo-galla:${id}`,
            createdAt: istInstant(day, 20, 10),
          });
          expected -= deposit;
        }
      }
      if (expected < 0) {
        // A thin drawer gets change from the owner first.
        const top = Math.ceil(-expected / 100000) * 100000 + 200000;
        const id = ++gallaCount;
        await bulk.add('GallaEntry', {
          id: `demo-ge-${id}`,
          locationId: shop,
          day,
          kind: 'PAID_IN',
          amountPaise: top,
          reason: 'Chhutta / owner se',
          actorId: actor,
          idempotencyKey: `demo-galla:${id}`,
          createdAt: istInstant(day, 20, 5),
        });
        expected += top;
      }
      const diff = rng.chance(0.12) ? rng.int(-20, 10) * 1000 : 0;
      const counted = Math.max(0, expected + diff);
      await bulk.add('DayClose', {
        id: `demo-dc-${++closeCount}`,
        locationId: shop,
        day,
        expectedPaise: expected,
        countedPaise: counted,
        differencePaise: counted - expected,
        reason:
          counted === expected
            ? ''
            : rng.pick(['Chhutta ka farq', 'Ek note kam', 'UPI galti se cash likha']),
        closedById: actor,
        createdAt: istInstant(day, 20, 30),
      });
      lastCounted.set(shop, counted);
    }
  }

  return { totals, waOrders, levels, orders: orderCount };
}

function addDaysAt(at: Date, days: number) {
  return new Date(at.getTime() + days * 86_400_000);
}
