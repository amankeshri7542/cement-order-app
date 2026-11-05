import type { QueueEntry } from './queue';

export type Job = 'loads' | 'truck' | 'damage' | 'count' | 'transfer' | 'trip' | 'cash';
const jobRights: Record<Job, string> = {
  loads: 'stock.load',
  truck: 'stock.receive',
  damage: 'stock.report',
  count: 'stock.count',
  transfer: 'stock.transfer',
  trip: 'trip.drive',
  cash: 'trip.drive',
};
/** The server decides who holds what, and says so in today's answer. This only draws it. */
export function jobsFor(access: readonly string[]): Job[] {
  return (Object.keys(jobRights) as Job[]).filter((job) => access.includes(jobRights[job]));
}
export type KaamMode = 'stock' | 'drive' | 'both' | 'none';
export function kaamMode(access: readonly string[]): KaamMode {
  const jobs = jobsFor(access);
  const stock = jobs.some((job) => job !== 'trip' && job !== 'cash');
  const drive = jobs.includes('trip');
  if (stock && drive) return 'both';
  if (stock) return 'stock';
  if (drive) return 'drive';
  return 'none';
}
/** Tabs in one list, so a later one is a single new line here. */
export type TabKey = 'hazri' | 'kaam' | 'paisa';
export const allTabs: readonly { key: TabKey; show: (access: readonly string[]) => boolean }[] = [
  { key: 'hazri', show: () => true },
  { key: 'kaam', show: (access) => jobsFor(access).length > 0 },
  { key: 'paisa', show: () => true },
];
export const tabsFor = (access: readonly string[]) =>
  allTabs.filter((tab) => tab.show(access)).map((tab) => tab.key);

// ---- Money ------------------------------------------------------------------------------------
/** "₹18,500", grouped the Indian way, with paise only if there are any. */
export function rupees(paise: number) {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const whole = String(Math.floor(abs / 100));
  const fraction = abs % 100;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  return `${negative ? '-' : ''}₹${grouped}${fraction ? `.${String(fraction).padStart(2, '0')}` : ''}`;
}
const maxPaise = 1_000_000_000;
/** What someone typed as rupees, in whole paise. Null for anything that is not an amount. */
export function parseRupees(text: string): number | null {
  const clean = text.replace(/[₹,\s]/g, '');
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.') as [string, string?];
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return paise <= maxPaise ? paise : null;
}
/** What the money box starts with: the same figure, in the form a person types it. */
export function rupeesInput(paise: number) {
  const whole = Math.floor(paise / 100);
  const fraction = paise % 100;
  return fraction ? `${whole}.${String(fraction).padStart(2, '0')}` : String(whole);
}
/** A whole number of bags, for counts and stock. Null for anything else. */
export function parseCount(text: string, min = 0, max = 1_000_000): number | null {
  const clean = text.trim();
  if (!/^\d{1,7}$/.test(clean)) return null;
  const value = Number(clean);
  return value >= min && value <= max ? value : null;
}

// ---- Stock jobs -------------------------------------------------------------------------------
export type LoadItem = {
  id: string;
  number: string;
  status: string;
  deliveryDate: string | null;
  shopName: string;
  area: string;
  items: { productId?: string; name: string; unit: string; quantity: number }[];
  loaded: { vehicle: string; billNumber: string; createdAt: string } | null;
};
/** Today's loads and any late ones. Later days wait; what is done sinks to the bottom. */
export function loadsToday(items: readonly LoadItem[], day: string, queue: readonly QueueEntry[]) {
  const shown = items
    .filter((row) => !row.deliveryDate || row.deliveryDate.slice(0, 10) <= day)
    .map((row) => {
      const waiting = queue.find(
        (entry) => entry.kind === 'load' && entry.path === `staff/stock/loads/${row.id}`,
      );
      return { ...row, waiting: Boolean(waiting) };
    });
  const isDone = (row: (typeof shown)[number]) => row.waiting || Boolean(row.loaded);
  return { open: shown.filter((row) => !isDone(row)), done: shown.filter(isDone) };
}

export type StockTable = {
  shops: {
    id: string;
    name: string;
    openCount: { id: string; status: string; opening: boolean } | null;
    hidden?: boolean;
  }[];
  items: {
    id: string;
    name: string;
    unit: string;
    category: string;
    stockMode: string;
    shops?: { locationId: string; quantity?: number | null }[];
  }[];
};
export type ProductChoice = { id: string; name: string; unit: string; category: string };
/**
 * Names only. The stock list the server sends may hold book figures, and a count must stay blind,
 * so they are dropped here and never reach a screen or the phone's storage.
 */
export function productChoices(table: Pick<StockTable, 'items'>): ProductChoice[] {
  return table.items.map((item) => ({
    id: item.id,
    name: item.name,
    unit: item.unit,
    category: item.category,
  }));
}
/** The stock list as it may be kept on the phone: no figures of any kind. */
export function blindTable(table: StockTable) {
  return {
    shops: table.shops.map((shop) => ({
      id: shop.id,
      name: shop.name,
      openCount:
        shop.openCount && shop.openCount.status === 'OPEN'
          ? {
              id: shop.openCount.id,
              status: shop.openCount.status,
              opening: shop.openCount.opening,
            }
          : null,
    })),
    items: productChoices(table),
  };
}
export type BlindTable = ReturnType<typeof blindTable>;

export type CountLine = {
  productId: string;
  name: string;
  unit: string;
  countedQty: number | null;
};
export type CountView = { id: string; locationId: string; status: string; lines: CountLine[] };
/** Only what the counter may see, even if the server were ever to send more. */
export function blindCount(count: CountView): CountView {
  return {
    id: count.id,
    locationId: count.locationId,
    status: count.status,
    lines: count.lines.map((line) => ({
      productId: line.productId,
      name: line.name,
      unit: line.unit,
      countedQty: line.countedQty,
    })),
  };
}
export function countProgress(lines: readonly CountLine[], drafts: Record<string, string>) {
  const done = lines.filter((line) => {
    const draft = drafts[line.productId];
    return draft !== undefined ? parseCount(draft) !== null : line.countedQty !== null;
  }).length;
  return { done, total: lines.length, finished: lines.length > 0 && done === lines.length };
}

export type Transfer = {
  id: string;
  status: string;
  fromName: string;
  toName: string;
  toLocationId: string;
  vehicle: string;
  carrierName: string;
  sentAt: string;
  sentByName: string;
  canReceive: boolean;
  lines: {
    productId: string;
    name: string;
    unit: string;
    sentQty: number;
    receivedQty: number | null;
  }[];
};
export type BlindTransfer = Omit<Transfer, 'lines'> & {
  lines: { productId: string; name: string; unit: string }[];
};
/** What was sent stays out of sight, so the count at this end is a real count. */
export function blindTransfer(row: Transfer): BlindTransfer {
  return {
    id: row.id,
    status: row.status,
    fromName: row.fromName,
    toName: row.toName,
    toLocationId: row.toLocationId,
    vehicle: row.vehicle,
    carrierName: row.carrierName,
    sentAt: row.sentAt,
    sentByName: row.sentByName,
    canReceive: row.canReceive,
    lines: row.lines.map((line) => ({
      productId: line.productId,
      name: line.name,
      unit: line.unit,
    })),
  };
}
export const transfersToReceive = <T extends Pick<Transfer, 'id' | 'canReceive'>>(
  items: readonly T[],
  queue: readonly QueueEntry[],
) =>
  items.filter(
    (row) =>
      row.canReceive &&
      !queue.some(
        (entry) =>
          entry.kind === 'transfer' && entry.path === `admin/stock/transfers/${row.id}/receive`,
      ),
  );

// ---- A driver's trip --------------------------------------------------------------------------
export type Stop = {
  id: string;
  sequence: number;
  status: string;
  orderId: string;
  number: string;
  orderStatus: string;
  name: string;
  phone: string;
  line1: string;
  area: string;
  landmark: string;
  lat: number | null;
  lng: number | null;
  notes: string;
  items: { name: string; unit: string; quantity: number }[];
  loaded: boolean;
  collectPaise: number;
  onCredit: boolean;
};
export type Trip = {
  id: string;
  status: string;
  vehicle: string;
  shopName: string;
  stops: Stop[];
};
export type StopFigure =
  { kind: 'collect'; paise: number } | { kind: 'udhaar' } | { kind: 'nothing' };
/** One figure to read in the sun. Never a balance: only what to take from this delivery. */
export function stopFigure(stop: Pick<Stop, 'collectPaise' | 'onCredit'>): StopFigure {
  if (stop.onCredit) return { kind: 'udhaar' };
  if (stop.collectPaise > 0) return { kind: 'collect', paise: stop.collectPaise };
  return { kind: 'nothing' };
}
export const stopAddress = (stop: Pick<Stop, 'line1' | 'area' | 'landmark'>) =>
  [stop.line1, stop.area, stop.landmark].filter(Boolean).join(', ');
export const telLink = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
/** The saved pin if there is one, otherwise the address as words. */
export function mapLink(stop: Pick<Stop, 'lat' | 'lng' | 'line1' | 'area' | 'landmark'>) {
  const query =
    typeof stop.lat === 'number' && typeof stop.lng === 'number'
      ? `${stop.lat},${stop.lng}`
      : `${stopAddress(stop)}, Patna`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** The trip as the driver last saw it, with what is still on the phone laid over it. */
export function withQueue(trips: readonly Trip[], queue: readonly QueueEntry[]) {
  return trips.map((trip) => {
    const started = queue.some(
      (entry) => entry.kind === 'tripStart' && entry.path === `staff/trips/${trip.id}/start`,
    );
    return {
      ...trip,
      status: started ? 'OUT' : trip.status,
      waiting: started,
      stops: trip.stops.map((stop) => {
        const delivered = queue.some(
          (entry) =>
            entry.kind === 'delivered' && entry.path === `staff/stops/${stop.id}/delivered`,
        );
        const problem = queue.some(
          (entry) =>
            entry.kind === 'stopProblem' && entry.path === `staff/stops/${stop.id}/problem`,
        );
        return {
          ...stop,
          status: delivered ? 'DELIVERED' : problem ? 'PROBLEM' : stop.status,
          waiting: delivered || problem,
        };
      }),
    };
  });
}
export type TripView = ReturnType<typeof withQueue>[number];
export type StopView = TripView['stops'][number];
export const openStops = (trip: TripView) => trip.stops.filter((stop) => stop.status === 'PENDING');
export const nextStop = (trip: TripView) => openStops(trip)[0] ?? null;
/** What the trip screen asks for next. */
export function tripStage(trip: TripView): 'NOT_LOADED' | 'LEAVE' | 'ON_ROAD' | 'FINISHED' {
  if (trip.status === 'PLANNED')
    return trip.stops.every((stop) => stop.loaded) ? 'LEAVE' : 'NOT_LOADED';
  return openStops(trip).length ? 'ON_ROAD' : 'FINISHED';
}

export type Handover = {
  key: string;
  offeredPaise: number;
  countedPaise: number | null;
  offeredAt: string | null;
  status: 'WAITING' | 'DONE' | 'DIFFERENT';
};
export type CashState = {
  holdingPaise: number;
  collections: number;
  handovers: Handover[];
};
const collected = (entry: QueueEntry) => {
  const money = entry.body.collected as { amountPaise?: number; channel?: string } | undefined;
  return money?.channel === 'CASH' ? (money.amountPaise ?? 0) : 0;
};
/** Cash in hand, counting deliveries and handovers still on the phone. */
export function cashWithYou(cash: CashState | null, queue: readonly QueueEntry[]) {
  const server = cash?.holdingPaise ?? 0;
  const waitingIn = queue
    .filter((entry) => entry.kind === 'delivered')
    .reduce((sum, entry) => sum + collected(entry), 0);
  const offered = queue.some((entry) => entry.kind === 'handover');
  return {
    // A handover takes everything held so far, so nothing is left to count once it is on its way.
    holdingPaise: offered ? 0 : server + waitingIn,
    waiting: waitingIn > 0 || offered,
  };
}
/**
 * Short, or over: a fact with both numbers. Nobody is accused by a screen. The server judges this
 * against what was collected, and does not send that figure, so a difference between what was said
 * and what was counted can be nil while the record still differs.
 */
export function handoverDifference(handover: Pick<Handover, 'offeredPaise' | 'countedPaise'>) {
  if (handover.countedPaise === null) return null;
  return Math.abs(handover.offeredPaise - handover.countedPaise);
}
