import { useCallback, useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import {
  fetchFresh,
  keepPhoto,
  newId,
  readCache,
  runStep,
  useApp,
  writeCache,
  type StepResult,
} from '../core';
import {
  blindCount,
  blindTable,
  blindTransfer,
  countProgress,
  loadsToday,
  parseCount,
  transfersToReceive,
  type BlindTable,
  type BlindTransfer,
  type CountView,
  type LoadItem,
  type ProductChoice,
  type StockTable,
  type Transfer,
} from '../logic/kaam';
import { dayText, istDay, timeText } from '../logic/time';
import { useNav } from '../nav';
import {
  Band,
  Btn,
  Card,
  Choice,
  Field,
  numberBox,
  Row,
  Screen,
  Stepper,
  Tag,
  Txt,
  useOnce,
} from '../ui';
import { space } from '../ui/tokens';
import { now } from '../core';
import { OutcomeFlood } from './flood';
import { BackBtn, Bands, TabBar, TopBar, Waiting } from './shell';

/** The same moment for every job: green if it reached the server, amber if the phone kept it. */
export function StepFlood(props: {
  result: StepResult;
  title: string;
  lines?: string[];
  onDone: () => void;
  amberWhenSent?: boolean;
}) {
  const { tr } = useApp();
  const { result, title, lines = [], onDone } = props;
  const outcome =
    result.how === 'sent'
      ? {
          tone: props.amberWhenSent ? ('amber' as const) : ('ok' as const),
          title,
          lines,
          actions: ['home' as const],
          autoReturn: !props.amberWhenSent,
          icon: props.amberWhenSent ? ('clock' as const) : ('check' as const),
        }
      : result.how === 'saved'
        ? {
            tone: 'amber' as const,
            title: tr('staff.hazri.waitingTitle'),
            lines: [title, ...lines, tr('staff.common.notSent')],
            actions: ['home' as const],
            autoReturn: false,
            icon: 'clock' as const,
          }
        : {
            tone: 'red' as const,
            title: tr('staff.result.notSaved'),
            lines: [refusedWords(result, tr)],
            actions: ['home' as const],
            autoReturn: false,
            icon: 'alert' as const,
          };
  return <OutcomeFlood outcome={outcome} on={{ home: onDone }} />;
}
const refusedWords = (result: StepResult, tr: ReturnType<typeof useApp>['tr']) => {
  if (result.how !== 'refused') return tr('staff.result.nothingSaved');
  const known: Record<string, Parameters<typeof tr>[0]> = {
    ORDER_CHANGED: 'staff.failed.why.ORDER_CHANGED',
    NOT_LOADED: 'staff.failed.why.NOT_LOADED',
    TRIP_DONE: 'staff.failed.why.TRIP_DONE',
    NOT_YOUR_TRIP: 'staff.failed.why.NOT_YOUR_TRIP',
    COUNT_NOT_OPEN: 'staff.failed.why.COUNT_NOT_OPEN',
    RECOUNT_SOMEONE_ELSE: 'staff.failed.why.RECOUNT_SOMEONE_ELSE',
    COUNT_NOT_FINISHED: 'staff.count.notFinished',
    NOTHING_TO_HAND_OVER: 'staff.failed.why.NOTHING_TO_HAND_OVER',
    SAME_PERSON: 'staff.failed.why.SAME_PERSON',
  };
  const key = known[result.code];
  return tr(key ?? 'staff.failed.why.default');
};

function useStockTable() {
  const [table, setTable] = useState<BlindTable | null>(null);
  const load = useCallback(() => {
    // Book figures in the reply stop here. Only names and open counts go any further.
    void fetchFresh<StockTable, BlindTable>('stock', 'admin/stock', blindTable).then((result) =>
      setTable(result.value),
    );
  }, []);
  useEffect(load, [load]);
  return { table, load };
}

export function StockHome({ tabs }: { tabs?: boolean }) {
  const { tr, entries, today } = useApp();
  const nav = useNav();
  const [items, setItems] = useState<LoadItem[] | null>(null);
  const { table } = useStockTable();
  const [transfers, setTransfers] = useState<BlindTransfer[]>([]);
  useEffect(() => {
    void fetchFresh<{ items: LoadItem[] }, LoadItem[]>(
      'loads',
      'staff/stock/loads',
      (reply) => reply.items,
    ).then((result) => setItems(result.value ?? []));
    void fetchFresh<{ items: Transfer[] }, BlindTransfer[]>(
      'transfers',
      'admin/stock/transfers?open=true',
      (reply) => reply.items.map(blindTransfer),
    ).then((result) => setTransfers(result.value ?? []));
  }, []);
  const at = now();
  const day = at === null ? (today?.day ?? '') : istDay(at);
  const { open, done } = loadsToday(items ?? [], day, entries);
  const openCount = table?.shops.find((shop) => shop.openCount);
  const toReceive = transfersToReceive(transfers, entries);
  return (
    <Screen
      testID="screen-stock"
      top={<TopBar />}
      band={<Bands />}
      {...(tabs ? { tabs: <TabBar /> } : {})}
      footer={
        <Row>
          <Btn
            testID="stock-truck"
            flex
            kind={open.length ? 'quiet' : 'lamp'}
            icon="truck"
            label={tr('staff.truck.button')}
            onPress={() => nav.push('truck')}
          />
          <Btn
            testID="stock-more"
            flex
            kind="quiet"
            label={tr('staff.kaam.more')}
            onPress={() => nav.push('more')}
          />
        </Row>
      }
    >
      <Txt kind="head">{tr('staff.loads.title')}</Txt>
      {openCount ? (
        <Choice
          testID="open-count"
          icon="list"
          label={tr('staff.count.title')}
          onPress={() => nav.push('count')}
        />
      ) : null}
      {toReceive.length ? (
        <Choice
          testID="open-transfers"
          icon="truck"
          label={`${tr('staff.transfer.button')}: ${toReceive.length}`}
          onPress={() => nav.push('transfers')}
        />
      ) : null}
      {items === null ? <Waiting /> : null}
      {items !== null && !open.length && !done.length ? (
        <Txt testID="loads-empty">{tr('staff.loads.empty')}</Txt>
      ) : null}
      {open.map((row, index) => (
        <Card key={row.id} testID={`load-${row.number}`}>
          <Txt>{tr('staff.loads.order', { number: row.number })}</Txt>
          <ItemsList items={row.items} />
          {row.area ? <Txt kind="small">{row.area}</Txt> : null}
          <Btn
            testID={`load-done-${row.number}`}
            kind={index === 0 ? 'lamp' : 'solid'}
            label={tr('staff.loads.markDone')}
            onPress={() => nav.push('loadDone', { id: row.id, number: row.number })}
          />
        </Card>
      ))}
      {done.map((row) => (
        <Card key={row.id} quiet testID={`load-finished-${row.number}`}>
          <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <Txt>{tr('staff.loads.order', { number: row.number })}</Txt>
            <Tag
              tone={row.waiting ? 'warn' : 'ok'}
              text={tr(row.waiting ? 'staff.common.notSent' : 'staff.loads.done')}
            />
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
/** The number first and large, so it reads without reading. */
export function ItemsList({
  items,
}: {
  items: { name: string; unit: string; quantity: number }[];
}) {
  return (
    <View style={{ gap: space.xs }}>
      {items.map((item, index) => (
        <Row key={`${item.name}-${index}`} style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
          <Txt kind="head">{item.quantity}</Txt>
          <Txt style={{ flexShrink: 1 }}>
            {item.unit} {item.name}
          </Txt>
        </Row>
      ))}
    </View>
  );
}

export function LoadDoneScreen({ params }: { params?: Record<string, unknown> }) {
  const { tr } = useApp();
  const nav = useNav();
  const number = params?.number as string;
  const id = params?.id as string;
  const [vehicle, setVehicle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StepResult | null>(null);
  const { busy, once } = useOnce();
  const send = async () => {
    const clean = vehicle.trim().toUpperCase();
    if (!clean) {
      setError(tr('staff.loads.vehicle'));
      return;
    }
    const key = newId();
    setResult(
      await runStep({
        id: key,
        kind: 'load',
        method: 'POST',
        path: `staff/stock/loads/${id}`,
        body: { vehicle: clean.slice(0, 30), idempotencyKey: key },
        claimsAge: false,
      }),
    );
  };
  if (result)
    return (
      <StepFlood
        result={result}
        title={tr('staff.loads.markDone')}
        lines={[tr('staff.loads.floodLine', { number })]}
        onDone={() => nav.home()}
      />
    );
  return (
    <Screen
      testID="screen-load-done"
      top={<TopBar />}
      footer={
        <>
          <Btn
            testID="load-send"
            kind="lamp"
            label={tr('staff.loads.markDone')}
            disabled={busy}
            onPress={() => once(send)}
          />
          <BackBtn />
        </>
      }
    >
      <Txt kind="head">{tr('staff.loads.which', { number })}</Txt>
      <Field
        testID="vehicle-input"
        label={tr('staff.loads.vehicle')}
        value={vehicle}
        onChangeText={setVehicle}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={30}
        placeholder="BR 01 XX 0000"
        error={error}
      />
    </Screen>
  );
}

export function MoreScreen() {
  const { tr, today } = useApp();
  const nav = useNav();
  const access = today?.access ?? [];
  return (
    <Screen testID="screen-more" top={<TopBar />} footer={<BackBtn />}>
      <Txt kind="head">{tr('staff.kaam.more')}</Txt>
      {access.includes('stock.report') ? (
        <Choice
          testID="more-damage"
          icon="alert-triangle"
          label={tr('staff.damage.title')}
          onPress={() => nav.push('damage')}
        />
      ) : null}
      {access.includes('stock.count') ? (
        <Choice
          testID="more-count"
          icon="list"
          label={tr('staff.count.title')}
          onPress={() => nav.push('count')}
        />
      ) : null}
      {access.includes('stock.transfer') ? (
        <Choice
          testID="more-transfers"
          icon="truck"
          label={tr('staff.transfer.button')}
          onPress={() => nav.push('transfers')}
        />
      ) : null}
    </Screen>
  );
}

function ShopChoice(props: {
  table: BlindTable | null;
  value: string | null;
  onChange(id: string): void;
}) {
  const { tr } = useApp();
  const shops = props.table?.shops ?? [];
  if (shops.length < 2) return null;
  return (
    <View style={{ gap: space.sm }}>
      <Txt>{tr('staff.shop.choose')}</Txt>
      {shops.map((shop) => (
        <Choice
          key={shop.id}
          testID={`shop-${shop.id}`}
          label={shop.name}
          chosen={props.value === shop.id}
          onPress={() => props.onChange(shop.id)}
        />
      ))}
    </View>
  );
}
function MaterialChoice(props: {
  items: ProductChoice[];
  value: string | null;
  onChange(id: string): void;
  label: string;
}) {
  const { tr } = useApp();
  const nav = useNav();
  const chosen = props.items.find((item) => item.id === props.value);
  return (
    <Choice
      testID="material-choose"
      icon="box"
      label={chosen ? chosen.name : props.label}
      chosen={Boolean(chosen)}
      detail={chosen ? chosen.unit : tr('staff.truck.choose')}
      onPress={() =>
        nav.push('pick', { title: props.label, items: props.items, onPick: props.onChange })
      }
    />
  );
}
/** The material list has its own screen, and a filter once it is too long to scroll through. */
export function PickScreen({ params }: { params?: Record<string, unknown> }) {
  const { tr } = useApp();
  const nav = useNav();
  const items = (params?.items as ProductChoice[]) ?? [];
  const [filter, setFilter] = useState('');
  const clean = filter.trim().toLowerCase();
  const shown = clean
    ? items.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(clean))
    : items;
  return (
    <Screen testID="screen-pick" top={<TopBar />} footer={<BackBtn />}>
      <Txt kind="head">{params?.title as string}</Txt>
      {items.length > 8 ? (
        <Field
          testID="pick-filter"
          label={tr('staff.truck.filter')}
          value={filter}
          onChangeText={setFilter}
        />
      ) : null}
      {shown.map((item) => (
        <Choice
          key={item.id}
          testID={`material-${item.id}`}
          icon="box"
          label={item.name}
          detail={item.unit}
          onPress={() => {
            (params?.onPick as (id: string) => void)(item.id);
            nav.pop();
          }}
        />
      ))}
    </Screen>
  );
}
function PhotoRow(props: {
  label: string;
  uri: string | null;
  onUri(uri: string): void;
  testID: string;
}) {
  const { tr } = useApp();
  const nav = useNav();
  return (
    <Choice
      testID={props.testID}
      icon="camera"
      label={props.label}
      chosen={Boolean(props.uri)}
      {...(props.uri ? { detail: tr('staff.photo.added') } : {})}
      onPress={() => nav.push('photo', { title: props.label, facing: 'back', onDone: props.onUri })}
    />
  );
}
const singleShop = (table: BlindTable | null, chosen: string | null) =>
  chosen ?? (table && table.shops.length === 1 ? table.shops[0]!.id : null);

export function TruckScreen() {
  const { tr } = useApp();
  const nav = useNav();
  const { busy, once } = useOnce();
  const { table } = useStockTable();
  const [shop, setShop] = useState<string | null>(null);
  const [product, setProduct] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('');
  const [supplier, setSupplier] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StepResult | null>(null);
  const send = async () => {
    const count = parseCount(quantity, 1, 100000);
    const locationId = singleShop(table, shop);
    if (!locationId || !product) return setError(tr('staff.truck.material'));
    if (count === null) return setError(tr('staff.truck.needQty'));
    if (!supplier.trim()) return setError(tr('staff.truck.needSupplier'));
    setError(null);
    const key = newId();
    const kept = photo ? await keepPhoto(photo).catch(() => null) : null;
    setResult(
      await runStep({
        id: key,
        kind: 'receipt',
        method: 'POST',
        path: 'staff/stock/receipts',
        body: {
          locationId,
          productId: product,
          quantity: count,
          supplierName: supplier.trim().slice(0, 80),
          ...(vehicle.trim() ? { vehicle: vehicle.trim().toUpperCase().slice(0, 30) } : {}),
          idempotencyKey: key,
        },
        claimsAge: false,
        ...(kept ? { photo: { uri: kept, kind: 'KANTA_SLIP' as const, locationId } } : {}),
      }),
    );
  };
  if (result)
    return <StepFlood result={result} title={tr('staff.truck.added')} onDone={() => nav.home()} />;
  return (
    <Screen
      testID="screen-truck"
      top={<TopBar />}
      footer={
        <>
          <Btn
            testID="truck-send"
            kind="lamp"
            label={tr('staff.truck.add')}
            disabled={busy}
            onPress={() => once(send)}
          />
          <BackBtn />
        </>
      }
    >
      <Txt kind="head">{tr('staff.truck.button')}</Txt>
      {table === null ? <Waiting /> : null}
      <ShopChoice table={table} value={singleShop(table, shop)} onChange={setShop} />
      <MaterialChoice
        items={table?.items ?? []}
        value={product}
        onChange={setProduct}
        label={tr('staff.truck.material')}
      />
      <Stepper
        testID="truck-qty"
        label={tr('staff.truck.qty')}
        value={quantity}
        onChange={setQuantity}
      />
      <Field
        testID="truck-supplier"
        label={tr('staff.truck.supplier')}
        value={supplier}
        onChangeText={setSupplier}
        maxLength={80}
      />
      <Field
        testID="truck-vehicle"
        label={tr('staff.loads.vehicle')}
        value={vehicle}
        onChangeText={setVehicle}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={30}
        placeholder="BR 01 XX 0000"
      />
      <PhotoRow testID="truck-photo" label={tr('staff.truck.photo')} uri={photo} onUri={setPhoto} />
      {error ? <Band testID="form-error" tone="danger" text={error} /> : null}
    </Screen>
  );
}

const damageReasons = ['wet', 'torn', 'broken', 'other'] as const;
export function DamageScreen() {
  const { tr } = useApp();
  const nav = useNav();
  const { busy, once } = useOnce();
  const { table } = useStockTable();
  const [shop, setShop] = useState<string | null>(null);
  const [product, setProduct] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<(typeof damageReasons)[number] | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StepResult | null>(null);
  const send = async () => {
    const count = parseCount(quantity, 1, 100000);
    const locationId = singleShop(table, shop);
    if (!locationId || !product) return setError(tr('staff.truck.material'));
    if (count === null) return setError(tr('staff.truck.needQty'));
    if (!reason) return setError(tr('staff.damage.why'));
    if (!photo) return setError(tr('staff.damage.needPhoto'));
    setError(null);
    const key = newId();
    const kept = await keepPhoto(photo).catch(() => null);
    if (!kept) return setError(tr('staff.photo.failed'));
    setResult(
      await runStep({
        id: key,
        kind: 'damage',
        method: 'POST',
        path: 'admin/stock/damage',
        body: {
          locationId,
          productId: product,
          quantity: count,
          note: tr(`staff.damage.${reason}`),
          idempotencyKey: key,
        },
        claimsAge: false,
        photo: { uri: kept, kind: 'DAMAGE_PHOTO', locationId },
      }),
    );
  };
  if (result)
    return (
      <StepFlood
        result={result}
        title={tr('staff.damage.sent')}
        amberWhenSent
        onDone={() => nav.home()}
      />
    );
  return (
    <Screen
      testID="screen-damage"
      top={<TopBar />}
      footer={
        <>
          <Btn
            testID="damage-send"
            kind="lamp"
            label={tr('staff.damage.send')}
            disabled={busy}
            onPress={() => once(send)}
          />
          <BackBtn />
        </>
      }
    >
      <Txt kind="head">{tr('staff.damage.title')}</Txt>
      {table === null ? <Waiting /> : null}
      <ShopChoice table={table} value={singleShop(table, shop)} onChange={setShop} />
      <MaterialChoice
        items={table?.items ?? []}
        value={product}
        onChange={setProduct}
        label={tr('staff.truck.material')}
      />
      <Stepper
        testID="damage-qty"
        label={tr('staff.damage.qty')}
        value={quantity}
        onChange={setQuantity}
      />
      <Txt>{tr('staff.damage.why')}</Txt>
      {damageReasons.map((key) => (
        <Choice
          key={key}
          testID={`damage-${key}`}
          label={tr(`staff.damage.${key}`)}
          chosen={reason === key}
          onPress={() => setReason(key)}
        />
      ))}
      <PhotoRow
        testID="damage-photo"
        label={tr('staff.damage.photo')}
        uri={photo}
        onUri={setPhoto}
      />
      {error ? <Band testID="form-error" tone="danger" text={error} /> : null}
    </Screen>
  );
}

/** Names and empty boxes. No figure from the book ever reaches this screen, or the phone. */
export function CountScreen() {
  const { tr, entries } = useApp();
  const nav = useNav();
  const { busy, once } = useOnce();
  const { table } = useStockTable();
  const shop = table?.shops.find((row) => row.openCount);
  const [count, setCount] = useState<CountView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StepResult | null>(null);
  const countId = shop?.openCount?.id;
  useEffect(() => {
    if (table === null) return;
    if (!countId) {
      setLoading(false);
      return;
    }
    void (async () => {
      const saved = await readCache<Record<string, string>>(`draft:${countId}`);
      if (saved) setDrafts(saved);
      const fresh = await fetchFresh<CountView, CountView>(
        `count:${countId}`,
        `admin/stock/counts/${countId}`,
        blindCount,
      );
      setCount(fresh.value);
      setLoading(false);
    })();
  }, [table, countId]);
  const change = (productId: string, text: string) => {
    const next = { ...drafts, [productId]: text.replace(/\D/g, '').slice(0, 7) };
    setDrafts(next);
    if (countId) void writeCache(`draft:${countId}`, next);
  };
  /** One line at a time, so a dropped network loses nothing. */
  const saveLine = (productId: string) => {
    if (!countId) return;
    const value = parseCount(drafts[productId] ?? '');
    if (value === null) return;
    const key = newId();
    void runStep({
      id: key,
      kind: 'countLine',
      method: 'PUT',
      path: `admin/stock/counts/${countId}/lines`,
      body: { productId, countedQty: value },
      claimsAge: false,
      replaceKey: `${countId}:${productId}`,
    });
  };
  const lines = count?.lines ?? [];
  const progress = countProgress(lines, drafts);
  const send = async () => {
    if (!countId) return;
    if (!progress.finished) return setError(tr('staff.count.notFinished'));
    setError(null);
    for (const line of lines) if (drafts[line.productId] !== undefined) saveLine(line.productId);
    const key = newId();
    setResult(
      await runStep({
        id: key,
        kind: 'countSubmit',
        method: 'POST',
        path: `admin/stock/counts/${countId}/submit`,
        body: {},
        claimsAge: false,
      }),
    );
  };
  if (result)
    return (
      <StepFlood
        result={result}
        title={tr('staff.count.sent')}
        lines={[tr('staff.count.sentLine')]}
        onDone={() => nav.home()}
      />
    );
  if (loading || table === null)
    return (
      <Screen testID="screen-count" top={<TopBar />} footer={<BackBtn />}>
        <Txt kind="head">{tr('staff.count.title')}</Txt>
        <Waiting />
      </Screen>
    );
  if (!countId || !count)
    return (
      <Screen testID="screen-count" top={<TopBar />} footer={<BackBtn />}>
        <Txt kind="head">{tr('staff.count.title')}</Txt>
        <Txt testID="count-none">{tr('staff.count.none')}</Txt>
        <Txt kind="small">{tr('staff.count.noneLine')}</Txt>
      </Screen>
    );
  const waitingLines = entries.filter((entry) => entry.kind === 'countLine').length;
  return (
    <Screen
      testID="screen-count"
      top={<TopBar />}
      band={<Bands />}
      footer={
        <>
          <Btn
            testID="count-send"
            kind="lamp"
            label={tr('staff.count.send')}
            disabled={busy}
            onPress={() => once(send)}
          />
          <BackBtn />
        </>
      }
    >
      <Txt kind="head">{tr('staff.count.title')}</Txt>
      <Txt kind="small">{tr('staff.count.hint')}</Txt>
      <Txt testID="count-progress">
        {tr('staff.count.progress', { done: progress.done, total: progress.total })}
      </Txt>
      {waitingLines ? <Tag tone="warn" text={tr('staff.common.notSent')} /> : null}
      {lines.map((line) => (
        <Card key={line.productId} testID={`count-line-${line.productId}`}>
          <Txt>{line.name}</Txt>
          <Txt kind="small">{line.unit}</Txt>
          <TextInput
            testID={`count-box-${line.productId}`}
            accessibilityLabel={line.name}
            value={
              drafts[line.productId] ?? (line.countedQty === null ? '' : String(line.countedQty))
            }
            onChangeText={(text) => change(line.productId, text)}
            onEndEditing={() => saveLine(line.productId)}
            onBlur={() => saveLine(line.productId)}
            keyboardType="number-pad"
            style={numberBox}
          />
        </Card>
      ))}
      {error ? <Band testID="form-error" tone="danger" text={error} /> : null}
    </Screen>
  );
}

export function TransfersScreen() {
  const { tr, entries } = useApp();
  const nav = useNav();
  const [items, setItems] = useState<BlindTransfer[] | null>(null);
  useEffect(() => {
    void fetchFresh<{ items: Transfer[] }, BlindTransfer[]>(
      'transfers',
      'admin/stock/transfers?open=true',
      (reply) => reply.items.map(blindTransfer),
    ).then((result) => setItems(result.value ?? []));
  }, []);
  const list = transfersToReceive(items ?? [], entries);
  return (
    <Screen testID="screen-transfers" top={<TopBar />} footer={<BackBtn />}>
      <Txt kind="head">{tr('staff.transfer.button')}</Txt>
      {items === null ? <Waiting /> : null}
      {items !== null && !list.length ? (
        <Txt testID="transfers-none">{tr('staff.transfer.none')}</Txt>
      ) : null}
      {list.map((row) => (
        <Choice
          key={row.id}
          testID={`transfer-${row.id}`}
          icon="truck"
          label={tr('staff.transfer.from', { shop: row.fromName })}
          detail={tr('staff.transfer.left', {
            day: dayText(istDay(Date.parse(row.sentAt)), tr),
            time: timeText(row.sentAt),
            name: row.sentByName,
          })}
          onPress={() => nav.push('transferReceive', { transfer: row })}
        />
      ))}
    </Screen>
  );
}

export function TransferReceiveScreen({ params }: { params?: Record<string, unknown> }) {
  const { tr } = useApp();
  const nav = useNav();
  const { busy, once } = useOnce();
  const transfer = params?.transfer as BlindTransfer;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StepResult | null>(null);
  const send = async () => {
    const lines = transfer.lines.map((line) => ({
      productId: line.productId,
      receivedQty: parseCount(drafts[line.productId] ?? ''),
    }));
    if (lines.some((line) => line.receivedQty === null))
      return setError(tr('staff.transfer.needAll'));
    setError(null);
    const key = newId();
    setResult(
      await runStep({
        id: key,
        kind: 'transfer',
        method: 'POST',
        path: `admin/stock/transfers/${transfer.id}/receive`,
        body: { lines },
        claimsAge: false,
      }),
    );
  };
  if (result)
    return (
      <StepFlood result={result} title={tr('staff.transfer.done')} onDone={() => nav.home()} />
    );
  return (
    <Screen
      testID="screen-transfer-receive"
      top={<TopBar />}
      footer={
        <>
          <Btn
            testID="transfer-send"
            kind="lamp"
            label={tr('staff.transfer.receive')}
            disabled={busy}
            onPress={() => once(send)}
          />
          <BackBtn />
        </>
      }
    >
      <Txt kind="head">{tr('staff.transfer.from', { shop: transfer.fromName })}</Txt>
      <Txt kind="small">{tr('staff.transfer.hint')}</Txt>
      {transfer.lines.map((line) => (
        <Card key={line.productId}>
          <Txt>{line.name}</Txt>
          <Txt kind="small">{line.unit}</Txt>
          <TextInput
            testID={`receive-box-${line.productId}`}
            accessibilityLabel={line.name}
            value={drafts[line.productId] ?? ''}
            onChangeText={(text) =>
              setDrafts((now_) => ({
                ...now_,
                [line.productId]: text.replace(/\D/g, '').slice(0, 7),
              }))
            }
            keyboardType="number-pad"
            style={numberBox}
          />
        </Card>
      ))}
      {error ? <Band testID="form-error" tone="danger" text={error} /> : null}
    </Screen>
  );
}
