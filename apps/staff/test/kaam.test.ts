import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rolePermissions, staffAppPermissions, type StaffRole } from '@shiv/shared';
import {
  allTabs,
  blindCount,
  blindTable,
  blindTransfer,
  cashWithYou,
  countProgress,
  handoverDifference,
  jobsFor,
  kaamMode,
  loadsToday,
  mapLink,
  nextStop,
  parseCount,
  parseRupees,
  productChoices,
  rupees,
  rupeesInput,
  stopAddress,
  stopFigure,
  tabsFor,
  telLink,
  transfersToReceive,
  tripStage,
  withQueue,
  type LoadItem,
  type Stop,
  type Transfer,
  type Trip,
} from '../src/logic/kaam';
import type { QueueEntry } from '../src/logic/queue';

/** What a phone really holds for a role, by the server's own table. */
const accessOf = (role: StaffRole) =>
  Object.keys(rolePermissions[role]).filter((name) => staffAppPermissions.includes(name));

const entry = (kind: QueueEntry['kind'], path: string, body: object = {}): QueueEntry => ({
  id: `${kind}:${path}`,
  kind,
  method: 'POST',
  path,
  body: body as Record<string, unknown>,
  userId: 'u',
  claimsAge: false,
  mono: 0,
  boot: 1,
  carriedMs: 0,
  rebooted: false,
});

test('what each role’s Kaam tab holds, by what its phone may do', () => {
  assert.deepEqual(jobsFor(accessOf('STOCK_KEEPER')), [
    'loads',
    'truck',
    'damage',
    'count',
    'transfer',
  ]);
  assert.deepEqual(jobsFor(accessOf('DRIVER')), ['trip', 'cash']);
  assert.deepEqual(jobsFor(accessOf('HELPER')), []);
  assert.deepEqual(jobsFor(accessOf('CASHIER')), []);
  assert.deepEqual(jobsFor(accessOf('ACCOUNTANT')), []);
  assert.deepEqual(jobsFor(accessOf('TECH_OPERATOR')), []);
  assert.deepEqual(jobsFor(accessOf('MANAGER')), ['loads', 'truck', 'damage', 'count', 'transfer']);
  assert.deepEqual(jobsFor(accessOf('OWNER')), [
    'loads',
    'truck',
    'damage',
    'count',
    'transfer',
    'trip',
    'cash',
  ]);
});
test('a person sees one kind of Kaam home', () => {
  assert.equal(kaamMode(accessOf('STOCK_KEEPER')), 'stock');
  assert.equal(kaamMode(accessOf('DRIVER')), 'drive');
  assert.equal(kaamMode(accessOf('OWNER')), 'both');
  assert.equal(kaamMode(accessOf('HELPER')), 'none');
  assert.equal(kaamMode([]), 'none');
});
test('tabs follow from that, and a new one is one line', () => {
  assert.deepEqual(tabsFor(accessOf('STOCK_KEEPER')), ['hazri', 'kaam', 'paisa']);
  assert.deepEqual(tabsFor(accessOf('DRIVER')), ['hazri', 'kaam', 'paisa']);
  assert.deepEqual(tabsFor(accessOf('HELPER')), ['hazri', 'paisa']);
  assert.equal(allTabs.length, 3);
});

test('rupees read the Indian way', () => {
  assert.equal(rupees(1850000), '₹18,500');
  assert.equal(rupees(11169000), '₹1,11,690');
  assert.equal(rupees(10000000000), '₹10,00,00,000');
  assert.equal(rupees(50), '₹0.50');
  assert.equal(rupees(1234567), '₹12,345.67');
  assert.equal(rupees(0), '₹0');
  assert.equal(rupees(-50000), '-₹500');
});
test('money is read to the paisa, and anything else is refused', () => {
  assert.equal(parseRupees('18500'), 1850000);
  assert.equal(parseRupees('₹18,500'), 1850000);
  assert.equal(parseRupees('18500.5'), 1850050);
  assert.equal(parseRupees('18500.55'), 1850055);
  assert.equal(parseRupees('0'), 0);
  // Decimal money must not drift through floating point.
  assert.equal(parseRupees('19.99'), 1999);
  assert.equal(parseRupees('1.15'), 115);
  for (const bad of ['', 'abc', '-5', '1.234', '1e5', '999999999', '12.', '.5', '1,2.3.4'])
    assert.equal(parseRupees(bad), null, bad);
});
test('the box starts with the same figure', () => {
  assert.equal(rupeesInput(1850000), '18500');
  assert.equal(rupeesInput(1850050), '18500.50');
  assert.equal(parseRupees(rupeesInput(1850050)), 1850050);
});
test('counts are whole numbers in range', () => {
  assert.equal(parseCount('0'), 0);
  assert.equal(parseCount('318'), 318);
  assert.equal(parseCount('0', 1), null);
  for (const bad of ['', '-1', '1.5', 'abc', '99999999']) assert.equal(parseCount(bad), null, bad);
});

const load = (extra: Partial<LoadItem>): LoadItem => ({
  id: 'o1',
  number: '2047',
  status: 'CONFIRMED',
  deliveryDate: '2026-11-03',
  shopName: 'Main',
  area: 'Kankarbagh',
  items: [{ name: 'Cement', unit: 'bag', quantity: 50 }],
  loaded: null,
  ...extra,
});
test('today’s loads include late ones, and later days wait', () => {
  const { open, done } = loadsToday(
    [
      load({ id: 'a', deliveryDate: '2026-11-03' }),
      load({ id: 'b', deliveryDate: '2026-11-02' }),
      load({ id: 'c', deliveryDate: '2026-11-04' }),
      load({ id: 'd', deliveryDate: null }),
      load({
        id: 'e',
        loaded: { vehicle: 'BR', billNumber: '', createdAt: '2026-11-03T00:00:00Z' },
      }),
    ],
    '2026-11-03',
    [],
  );
  assert.deepEqual(
    open.map((row) => row.id),
    ['a', 'b', 'd'],
  );
  assert.deepEqual(
    done.map((row) => row.id),
    ['e'],
  );
});
test('a load saved on the phone reads as done, and says it has not gone', () => {
  const { open, done } = loadsToday([load({ id: 'a' })], '2026-11-03', [
    entry('load', 'staff/stock/loads/a'),
  ]);
  assert.equal(open.length, 0);
  assert.equal(done[0]?.waiting, true);
});
test('no money words ever reach the loader’s view, because none is kept', () => {
  const text = JSON.stringify(loadsToday([load({})], '2026-11-03', []));
  assert.doesNotMatch(text, /paise|price|rate|udhaar|credit/i);
});

const table = {
  shops: [
    {
      id: 's1',
      name: 'Main',
      openCount: { id: 'c1', status: 'OPEN', opening: false },
      hidden: true,
    },
    { id: 's2', name: 'Second', openCount: { id: 'c2', status: 'SUBMITTED', opening: false } },
  ],
  items: [
    {
      id: 'p1',
      name: 'Cement',
      unit: 'bag',
      category: 'Cement',
      stockMode: 'COUNTED',
      sourcing: 'x',
      onTheRoad: 12345,
      shops: [{ locationId: 's1', quantity: 987654, lowStockAt: 25, isOn: true, countedAt: null }],
    },
  ],
};
test('book figures are dropped as soon as they arrive', () => {
  const kept = blindTable(table);
  const text = JSON.stringify(kept);
  assert.doesNotMatch(text, /987654|12345|quantity|onTheRoad|lowStockAt/);
  assert.deepEqual(kept.items[0], { id: 'p1', name: 'Cement', unit: 'bag', category: 'Cement' });
  assert.doesNotMatch(JSON.stringify(productChoices(table)), /987654/);
});
test('only a count still open is offered', () => {
  const kept = blindTable(table);
  assert.equal(kept.shops[0]?.openCount?.id, 'c1');
  assert.equal(kept.shops[1]?.openCount, null);
});
test('a count keeps only names and the person’s own figures, even if sent more', () => {
  const kept = blindCount({
    id: 'c',
    locationId: 's',
    status: 'OPEN',
    lines: [
      {
        productId: 'p',
        name: 'Cement',
        unit: 'bag',
        countedQty: null,
        systemQty: 987654,
        heldQty: 5,
        differenceQty: 3,
      } as never,
    ],
  });
  assert.doesNotMatch(JSON.stringify(kept), /987654|systemQty|heldQty|differenceQty/);
});
test('count progress: "3 of 12", typing included', () => {
  const lines = [
    { productId: 'a', name: 'A', unit: 'bag', countedQty: 5 },
    { productId: 'b', name: 'B', unit: 'bag', countedQty: null },
  ];
  assert.deepEqual(countProgress(lines, {}), { done: 1, total: 2, finished: false });
  assert.deepEqual(countProgress(lines, { b: '0' }), { done: 2, total: 2, finished: true });
  assert.deepEqual(countProgress(lines, { b: '' }), { done: 1, total: 2, finished: false });
  assert.equal(countProgress([], {}).finished, false);
});
const transfer: Transfer = {
  id: 't1',
  status: 'SENT',
  fromName: 'Second',
  toName: 'Main',
  toLocationId: 's1',
  vehicle: 'BR',
  carrierName: '',
  sentAt: '2026-11-03T03:00:00Z',
  sentByName: 'P',
  canReceive: true,
  lines: [{ productId: 'p', name: 'Cement', unit: 'bag', sentQty: 777, receivedQty: null }],
};
test('what was sent stays out of sight at the receiving end', () => {
  assert.doesNotMatch(JSON.stringify(blindTransfer(transfer)), /777|sentQty/);
});
test('only transfers this person may receive, and not one already on its way', () => {
  assert.deepEqual(transfersToReceive([transfer], []).length, 1);
  assert.deepEqual(transfersToReceive([{ ...transfer, canReceive: false }], []).length, 0);
  assert.deepEqual(
    transfersToReceive([transfer], [entry('transfer', 'admin/stock/transfers/t1/receive')]).length,
    0,
  );
});

const stop = (extra: Partial<Stop> = {}): Stop => ({
  id: 's1',
  sequence: 1,
  status: 'PENDING',
  orderId: 'o',
  number: '2047',
  orderStatus: 'PREPARING',
  name: 'Test Customer',
  phone: '+91 90000-00001',
  line1: 'Plot 12',
  area: 'Kankarbagh',
  landmark: 'Near the temple',
  lat: null,
  lng: null,
  notes: '',
  items: [],
  loaded: true,
  collectPaise: 0,
  onCredit: false,
  ...extra,
});
test('one figure: collect, udhaar, or nothing, and never a balance', () => {
  assert.deepEqual(stopFigure({ collectPaise: 1850000, onCredit: false }), {
    kind: 'collect',
    paise: 1850000,
  });
  assert.deepEqual(stopFigure({ collectPaise: 0, onCredit: true }), { kind: 'udhaar' });
  assert.deepEqual(stopFigure({ collectPaise: 0, onCredit: false }), { kind: 'nothing' });
  // Udhaar wins: a driver must never be told to collect on an udhaar order.
  assert.deepEqual(stopFigure({ collectPaise: 500, onCredit: true }), { kind: 'udhaar' });
});
test('the address, the call and the map', () => {
  assert.equal(stopAddress(stop()), 'Plot 12, Kankarbagh, Near the temple');
  assert.equal(stopAddress(stop({ line1: '', landmark: '' })), 'Kankarbagh');
  assert.equal(telLink('+91 90000-00001'), 'tel:+919000000001');
  assert.match(mapLink(stop({ lat: 25.6, lng: 85.1 })), /query=25\.6%2C85\.1$/);
  const words = mapLink(stop());
  assert.match(words, /Kankarbagh/);
  assert.ok(words.startsWith('https://www.google.com/maps/search/?api=1&query='));
});
test('a map link cannot be turned into something else by an address', () => {
  const link = mapLink(stop({ line1: 'x&y=1#z', lat: null }));
  assert.ok(!link.includes('#'));
  assert.ok(!link.includes('&y='));
});
const trip = (extra: Partial<Trip> = {}): Trip => ({
  id: 't1',
  status: 'PLANNED',
  vehicle: 'BR',
  shopName: 'Main',
  stops: [stop(), stop({ id: 's2', sequence: 2 })],
  ...extra,
});
test('a trip’s stage', () => {
  const view = (value: Trip) => withQueue([value], [])[0]!;
  assert.equal(tripStage(view(trip())), 'LEAVE');
  assert.equal(tripStage(view(trip({ stops: [stop({ loaded: false })] }))), 'NOT_LOADED');
  assert.equal(tripStage(view(trip({ status: 'OUT' }))), 'ON_ROAD');
  assert.equal(
    tripStage(view(trip({ status: 'OUT', stops: [stop({ status: 'DELIVERED' })] }))),
    'FINISHED',
  );
});
test('steps on the phone lay over the saved trip, and say they have not gone', () => {
  const [view] = withQueue(
    [trip()],
    [entry('tripStart', 'staff/trips/t1/start'), entry('delivered', 'staff/stops/s1/delivered')],
  );
  assert.equal(view!.status, 'OUT');
  assert.equal(view!.waiting, true);
  assert.equal(view!.stops[0]!.status, 'DELIVERED');
  assert.equal(view!.stops[0]!.waiting, true);
  assert.equal(nextStop(view!)?.id, 's2');
});
test('a problem on the phone also moves on', () => {
  const [view] = withQueue(
    [trip({ status: 'OUT' })],
    [entry('stopProblem', 'staff/stops/s1/problem')],
  );
  assert.equal(view!.stops[0]!.status, 'PROBLEM');
});
const cash = { holdingPaise: 500000, collections: 1, handovers: [] };
test('cash in hand counts what is still on the phone', () => {
  assert.deepEqual(cashWithYou(cash, []), { holdingPaise: 500000, waiting: false });
  assert.deepEqual(
    cashWithYou(cash, [
      entry('delivered', 'p', { collected: { amountPaise: 200000, channel: 'CASH' } }),
    ]),
    { holdingPaise: 700000, waiting: true },
  );
  // UPI goes to the shop's code, so it is not in anyone's pocket.
  assert.deepEqual(
    cashWithYou(cash, [
      entry('delivered', 'p', { collected: { amountPaise: 200000, channel: 'UPI' } }),
    ]),
    { holdingPaise: 500000, waiting: false },
  );
  assert.deepEqual(cashWithYou(null, []), { holdingPaise: 0, waiting: false });
});
test('a handover on its way means nothing is held', () => {
  assert.deepEqual(cashWithYou(cash, [entry('handover', 'staff/cash/handover')]), {
    holdingPaise: 0,
    waiting: true,
  });
});
test('a difference is only ever a figure', () => {
  assert.equal(handoverDifference({ offeredPaise: 100, countedPaise: null }), null);
  assert.equal(handoverDifference({ offeredPaise: 100, countedPaise: 70 }), 30);
  assert.equal(handoverDifference({ offeredPaise: 70, countedPaise: 100 }), 30);
  assert.equal(handoverDifference({ offeredPaise: 70, countedPaise: 70 }), 0);
});
