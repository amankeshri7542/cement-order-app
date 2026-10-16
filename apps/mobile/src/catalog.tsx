import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  dateLabel,
  money,
  maxOrderable,
  orderStatusText,
  productDescription,
  productName,
  quantityProblem,
  ratesFrom,
  unitLabel,
  timeLabel,
  MAX_LINE_QUANTITY,
  space,
  radius,
  textSize,
  type Language,
  type Page,
  type Product,
} from '@shiv/shared';
import { api } from './api';
import { useStore } from './store';
import { awards } from './trust';
import { useReorder } from './orders';
import {
  Bone,
  Button,
  C,
  Chip,
  display,
  displaySize,
  Empty,
  Field,
  Icon,
  Notice,
  Roll,
  Screen,
  Section,
  Stamp,
  Tag,
  teko,
  TornEdge,
  s,
  type IconName,
} from './ui';

const categoryIcons: Record<string, IconName> = {
  cement: 'cube-outline',
  steel: 'reorder-four-outline',
  sand: 'layers-outline',
  bricks: 'grid-outline',
  aggregates: 'ellipse-outline',
  tiles: 'apps-outline',
  pipes: 'git-merge-outline',
  hardware: 'construct-outline',
};
const categoryHindi: Record<string, string> = {
  cement: 'सीमेंट',
  steel: 'सरिया',
  sand: 'बालू',
  bricks: 'ईंट',
  aggregates: 'गिट्टी',
  tiles: 'टाइल्स',
  pipes: 'पाइप',
  hardware: 'हार्डवेयर',
};
export const categoryName = (slug: string, name: string, language: Language) =>
  language === 'hi' ? categoryHindi[slug] || name : name;

/** Each material's drawing colour (cement bag kraft, steel bar, brick, sand, stone). */
const materialTone: Record<string, [string, string]> = {
  cement: [C.mKraft, C.ink],
  steel: [C.mSteel, C.onInk],
  bricks: [C.mBrick, C.onInk],
  sand: [C.mSand, C.ink],
  aggregates: [C.mStone, C.ink],
};

/**
 * The shop's own product photo, or a plain tile in the material's colour when there is none.
 * Never a stock photo.
 */
export function MaterialArt({ product, size = 64 }: { product: Product; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [product.images[0]]);
  if (product.images[0] && !failed)
    return (
      <Image
        accessibilityIgnoresInvertColors
        source={{ uri: product.images[0] }}
        onError={() => setFailed(true)}
        resizeMode="contain"
        style={{ width: size, height: size, backgroundColor: C.paper }}
      />
    );
  const [background, color] = materialTone[product.category.slug] || [C.tab2, C.ink];
  return (
    <View style={[cs.tile, { width: size, height: size, backgroundColor: background }]}>
      <Icon
        name={categoryIcons[product.category.slug] || 'cube-outline'}
        size={size * 0.5}
        color={color}
      />
    </View>
  );
}

const unitText = (product: Product, language: Language) =>
  language === 'hi' ? `प्रति ${unitLabel(product.unit, language)}` : `per ${product.unit}`;

/**
 * One row per material: everything needed to choose it, and the basket control, in ~100dp.
 * Once in the basket the row shows a quantity bar that can be typed into (200 bags is one
 * entry, not forty taps).
 */
export function ProductRow({ product, onInk }: { product: Product; onInk?: boolean }) {
  const { t, language, navigate, add, setQuantity, basketQuantity, cartBusy, setToast } =
    useStore();
  const [busy, setBusy] = useState(false);
  const inBasket = basketQuantity(product.id);
  const available = product.active && product.stock >= product.minQuantity;
  const name = productName(product, language);
  const unit = unitLabel(product.unit, language);
  // On the open (ink) rate folder the row sits on steel ink; on Materials it is a surface.
  const ink = onInk ? C.onInk : C.ink;
  const quiet = onInk ? { color: C.onInkMuted } : null;
  return (
    <View style={onInk ? cs.inkRow : cs.row} testID={`product-${product.id}`}>
      <View style={[s.row, { gap: space.sm, alignItems: 'flex-start' }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('View', 'देखें')} ${name}`}
          onPress={() => navigate({ screen: 'Product', id: product.id })}
          style={({ pressed }) => [cs.rowMain, pressed && { opacity: 0.75 }]}
        >
          <MaterialArt product={product} size={onInk ? 48 : 64} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[cs.rowName, { color: ink }]} numberOfLines={2}>
              {name}
            </Text>
            <Text style={[s.small, quiet]} numberOfLines={1}>
              {[product.brand, product.grade, product.packSize].filter(Boolean).join(' · ')}
            </Text>
            <View style={cs.rowPriceLine}>
              <Roll value={money(product.pricePaise)} style={[cs.rowPrice, { color: ink }]} />
              <Text style={[s.small, quiet]}>/ {unit}</Text>
            </View>
            {!available && <Tag tone="grey">{t('Out of stock', 'स्टॉक नहीं')}</Tag>}
          </View>
        </Pressable>
        {available && inBasket === 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Add to basket', 'टोकरी में जोड़ें')}
            disabled={busy || cartBusy}
            onPress={() => {
              setBusy(true);
              void add(product).finally(() => setBusy(false));
            }}
            style={({ pressed }) => [
              cs.add,
              pressed && { backgroundColor: C.accentPress },
              (busy || cartBusy) && { backgroundColor: C.tab3 },
            ]}
          >
            <Icon name="add" color={busy || cartBusy ? C.muted : C.onAccent} size={20} />
            <Text style={[cs.addText, (busy || cartBusy) && { color: C.muted }]}>
              {t('Add', 'जोड़ें')}
            </Text>
          </Pressable>
        )}
      </View>
      {inBasket > 0 && (
        <View style={cs.inBasket}>
          <Icon name="basket" color={onInk ? C.onInk : C.ok} size={18} />
          <Text
            style={[
              s.small,
              {
                flexGrow: 1,
                flexShrink: 1,
                flexBasis: 100,
                color: onInk ? C.onInk : C.ok,
                fontWeight: '700',
              },
            ]}
          >
            {t('In basket', 'टोकरी में')} · {unit}
          </Text>
          <Quantity
            label={`${name} ${t('quantity', 'मात्रा')}`}
            value={inBasket}
            min={product.minQuantity}
            step={product.quantityStep}
            max={Math.min(product.stock, MAX_LINE_QUANTITY)}
            disabled={cartBusy}
            commitOnBlur
            allowRemove
            onInvalid={setToast}
            change={(quantity) => void setQuantity(product, quantity)}
          />
        </View>
      )}
    </View>
  );
}

function RowSkeletons() {
  const { t } = useStore();
  return (
    <View
      accessibilityLabel={t('Loading materials', 'सामग्री लोड हो रही है')}
      accessibilityState={{ busy: true }}
      style={{ gap: space.md }}
    >
      {[0, 1, 2, 3].map((key) => (
        <View key={key} style={[cs.row, { gap: space.md }]}>
          <Bone height={64} width={64} />
          <View style={{ flex: 1, gap: space.sm }}>
            <Bone width="80%" />
            <Bone width="50%" />
            <Bone width="35%" height={20} />
          </View>
        </View>
      ))}
    </View>
  );
}

type DeliveryResult = {
  serviceable: boolean;
  zone?: {
    name: string;
    estimate: string;
    terms?: string;
    deliveryFeePaise: number;
    minimumOrderPaise: number;
    freeDeliveryAbovePaise: number | null;
  };
};
export function DeliveryCheck() {
  const { t, say } = useStore();
  const [pincode, setPincode] = useState('');
  const [result, setResult] = useState<DeliveryResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  async function check(value = pincode) {
    if (!/^[1-9]\d{5}$/.test(value)) {
      setError(t('Enter a valid six-digit pincode.', 'छह अंकों का सही पिनकोड लिखें।'));
      return;
    }
    const current = ++request.current;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await api<DeliveryResult>(`/delivery/${value}`);
      if (current === request.current) setResult(response);
    } catch (e) {
      if (current === request.current) setError(say(e));
    } finally {
      if (current === request.current) setBusy(false);
    }
  }
  return (
    <View style={[s.card, { gap: space.md }]}>
      <View style={s.row}>
        <Icon name="location-outline" color={C.ink} />
        <Text style={[s.h3, { flex: 1 }]}>
          {t('Delivery to your site', 'आपकी साइट पर डिलीवरी')}
        </Text>
      </View>
      <View style={[s.row, { gap: space.sm, flexWrap: 'wrap' }]}>
        <TextInput
          accessibilityLabel={t('Delivery pincode', 'डिलीवरी पिनकोड')}
          placeholder={t('6-digit pincode', '6 अंकों का पिनकोड')}
          placeholderTextColor={C.muted}
          value={pincode}
          maxLength={6}
          keyboardType="number-pad"
          onChangeText={(value) => {
            const digits = value.replace(/\D/g, '');
            request.current++;
            setPincode(digits);
            setResult(null);
            setError('');
            setBusy(false);
            // Six digits is a complete pincode: check without another tap.
            if (digits.length === 6) void check(digits);
          }}
          onSubmitEditing={() => void check()}
          style={[s.input, { flexGrow: 1, flexBasis: 160 }]}
        />
        <Button loading={busy} onPress={() => void check()} style={{ minWidth: 104 }}>
          {t('Check', 'जाँचें')}
        </Button>
      </View>
      {error ? <Notice error>{error}</Notice> : null}
      {result &&
        (result.serviceable && result.zone ? (
          <Notice tone="good">
            {t(
              `Delivery available · ${result.zone.name}\n${result.zone.estimate}\nDelivery ${money(result.zone.deliveryFeePaise)} · minimum order ${money(result.zone.minimumOrderPaise)}${result.zone.freeDeliveryAbovePaise !== null ? ` · free above ${money(result.zone.freeDeliveryAbovePaise)}` : ''}`,
              `डिलीवरी उपलब्ध · ${result.zone.name}\n${result.zone.estimate}\nडिलीवरी ${money(result.zone.deliveryFeePaise)} · न्यूनतम ऑर्डर ${money(result.zone.minimumOrderPaise)}${result.zone.freeDeliveryAbovePaise !== null ? ` · ${money(result.zone.freeDeliveryAbovePaise)} से ऊपर मुफ़्त` : ''}`,
            )}
            {result.zone.terms
              ? `\n${t('Delivery terms', 'डिलीवरी शर्तें')}: ${result.zone.terms}`
              : ''}
          </Notice>
        ) : (
          <Notice>
            {t(
              'This pincode is not on our delivery list yet. Call or WhatsApp the store to discuss your site.',
              'यह पिनकोड अभी हमारी डिलीवरी सूची में नहीं है। अपनी साइट के बारे में दुकान को फ़ोन या WhatsApp करें।',
            )}
          </Notice>
        ))}
    </View>
  );
}

/** Folder tones from the front folder back; the open folder is steel ink. */
const folderTones = [C.tab1, C.tab2, C.tab3, C.tab4, C.tab4, C.tab4];

/** The tab of a rate folder: a raised strip over the left half, with slanted ends. */
function FolderTab({ color }: { color: string }) {
  return (
    <View style={cs.folderTabRow} accessible={false}>
      <View style={[cs.slantLeft, { borderBottomColor: color }]} />
      <View style={[cs.folderTab, { backgroundColor: color }]} />
      <View style={[cs.slantRight, { borderBottomColor: color }]} />
    </View>
  );
}

/**
 * Today's lowest in-stock price per material, as stacked rate folders. The open folder comes to
 * the front (last) as a steel-ink panel listing that material's products with Add.
 */
function RateBoard() {
  const { products, loading, error, t, language, navigate, refreshCatalog } = useStore();
  const rates = useMemo(() => ratesFrom(products, 6), [products]);
  const checkedAt = useMemo(() => new Date().toISOString(), [products]);
  // null: the first material (cement) is open, as on the counter; '' closes every folder.
  const [chosen, setChosen] = useState<string | null>(null);
  const open = chosen === null ? rates[0]?.slug || '' : chosen;
  const ordered = [
    ...rates.filter((rate) => rate.slug !== open),
    ...rates.filter((rate) => rate.slug === open),
  ];
  return (
    <View>
      <Text style={cs.ratesTitle} accessibilityRole="header">
        {t('Current rates', 'मौजूदा भाव')}
      </Text>
      <Text style={s.small}>
        {loading
          ? t('Checking today’s prices…', 'आज के भाव जाँचे जा रहे हैं…')
          : t(
              `Lowest in-stock price · checked ${timeLabel(checkedAt)}`,
              `सबसे कम उपलब्ध भाव · ${timeLabel(checkedAt)} पर जाँचा`,
            )}
      </Text>
      {loading && !rates.length ? (
        <View style={{ marginTop: space.md }}>
          {[0, 1, 2, 3].map((row) => (
            <View key={row} style={{ marginTop: row ? -4 : 0 }}>
              <FolderTab color={folderTones[row]!} />
              <View style={[cs.folder, { backgroundColor: folderTones[row] }]}>
                <View style={{ height: 18, width: '45%', backgroundColor: C.ground }} />
              </View>
            </View>
          ))}
        </View>
      ) : error && !rates.length ? (
        <View style={[s.card, { gap: space.md, marginTop: space.md }]}>
          <Text style={s.body}>
            {t('Today’s rates could not load.', 'आज के भाव लोड नहीं हो सके।')}
          </Text>
          <Button secondary onPress={() => void refreshCatalog()}>
            {t('Try again', 'फिर कोशिश करें')}
          </Button>
        </View>
      ) : rates.length ? (
        <View style={{ marginTop: space.md }}>
          {ordered.map((rate, index) => {
            const isOpen = rate.slug === open;
            const tone = isOpen ? C.ink : folderTones[index] || C.tab4;
            const name = categoryName(rate.slug, rate.name, language);
            const unit = unitLabel(rate.product.unit, language);
            return (
              <View key={rate.slug} style={{ marginTop: index ? -4 : 0 }}>
                <FolderTab color={tone} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${name}: ${t(`from ${money(rate.product.pricePaise)}`, `${money(rate.product.pricePaise)} से`)} ${unitText(rate.product, language)}`}
                  accessibilityState={{ expanded: isOpen }}
                  aria-expanded={isOpen}
                  onPress={() => setChosen(isOpen ? '' : rate.slug)}
                  style={({ pressed }) => [
                    cs.folder,
                    { backgroundColor: tone },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[cs.folderName, isOpen && { color: C.onInk }]}>{name}</Text>
                  <View style={cs.folderRate}>
                    <Roll
                      value={money(rate.product.pricePaise)}
                      style={[cs.folderPrice, isOpen && { color: C.onInk }]}
                    />
                    <Text style={[cs.folderUnit, isOpen && { color: C.onInkMuted }]}>/ {unit}</Text>
                  </View>
                </Pressable>
                {isOpen && (
                  <View style={cs.folderPanel}>
                    {products
                      .filter((product) => product.category.slug === rate.slug)
                      .slice(0, 4)
                      .map((product) => (
                        <ProductRow key={product.id} product={product} onInk />
                      ))}
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => navigate({ screen: 'Products', category: rate.slug })}
                      style={cs.folderMore}
                    >
                      <Text style={[s.link, { color: C.onInk }]}>
                        {t('See all', 'सब देखें')} · {name}
                      </Text>
                      <Icon name="arrow-forward" size={18} color={C.onInk} />
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={[s.body, { marginTop: space.md }]}>
          {t(
            'No materials are in stock right now. Call the store for today’s rates.',
            'अभी कोई सामग्री स्टॉक में नहीं है। आज के भाव के लिए दुकान पर फ़ोन करें।',
          )}
        </Text>
      )}
      <Text style={[s.small, { marginTop: space.md }]}>
        {t(
          'Delivery is added when you review your order.',
          'डिलीवरी शुल्क ऑर्डर की समीक्षा में जुड़ता है।',
        )}
      </Text>
    </View>
  );
}

/** First on Home for returning customers: the latest order as a small paper slip. */
function LatestOrder() {
  const { latestOrder, t, language, navigate } = useStore();
  const reorder = useReorder(latestOrder);
  if (!latestOrder) return null;
  return (
    <View>
      <View style={[s.paper, { gap: space.sm, paddingBottom: space.md }]}>
        <View style={s.between}>
          <Text style={s.small}>{t('Your latest order', 'आपका पिछला ऑर्डर')}</Text>
          <OrderStatusTag status={latestOrder.status} language={language} />
        </View>
        <Text style={cs.slipNumber}>{latestOrder.number}</Text>
        <Text style={s.small} numberOfLines={2}>
          {latestOrder.items.map((item) => `${item.name} × ${item.quantity}`).join(', ')} ·{' '}
          {money(latestOrder.totalPaise)}
        </Text>
        <View style={[s.row, { gap: space.sm, flexWrap: 'wrap', marginTop: space.xs }]}>
          <Button
            secondary
            icon="navigate-outline"
            style={{ flexGrow: 1, flexBasis: 128 }}
            onPress={() => navigate({ screen: 'Order', id: latestOrder.id })}
          >
            {t('Track', 'ट्रैक करें')}
          </Button>
          <Button
            icon="repeat"
            style={{ flexGrow: 1, flexBasis: 128 }}
            loading={reorder.busy}
            disabled={!reorder.ready}
            onPress={() => void reorder.run()}
          >
            {reorder.pending
              ? t('Check reorder', 'दोबारा जाँचें')
              : t('Order again', 'फिर से मँगाएँ')}
          </Button>
        </View>
        {reorder.error ? <Notice error>{reorder.error}</Notice> : null}
      </View>
      <TornEdge />
    </View>
  );
}

export function OrderStatusTag({ status, language }: { status: string; language: Language }) {
  const good = ['DELIVERED', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'PAID'].includes(status);
  const bad = ['CANCELLED', 'DELIVERY_EXCEPTION', 'REFUND_PENDING'].includes(status);
  return (
    <Tag tone={bad ? 'clay' : good ? 'green' : 'grey'}>{orderStatusText(status, language)}</Tag>
  );
}

export function Home() {
  const { products, navigate, t, refreshCurrent, refreshing, user } = useStore();
  const brands = useMemo(
    () => [...new Set(products.map((product) => product.brand).filter(Boolean))].slice(0, 12),
    [products],
  );
  // One row of plain links in place of shortcut cards.
  const links: [string, () => void][] = [
    [t('All materials', 'सारी सामग्री'), () => navigate({ screen: 'Products' })],
    [t('Bulk quote', 'थोक भाव'), () => navigate({ screen: 'QuoteRequest' })],
    [t('Ask Shiv Sahayak', 'शिव सहायक से पूछें'), () => navigate({ screen: 'Assistant' })],
    [t('Compare', 'तुलना करें'), () => navigate({ screen: 'Compare' })],
  ];
  return (
    <Screen onRefresh={() => void refreshCurrent()} refreshing={refreshing}>
      {user && <LatestOrder />}
      <RateBoard />
      <View style={cs.links}>
        {links.map(([label, onPress]) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            onPress={onPress}
            style={({ pressed }) => [cs.linkItem, pressed && { opacity: 0.7 }]}
          >
            <Text style={s.link}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <DeliveryCheck />
      <View style={[s.paper, { gap: space.md }]}>
        <View style={[s.row, { alignItems: 'flex-start' }]}>
          <Stamp size={44} />
          <Text style={[s.h2, { flex: 1 }]}>
            {t('One list. A written price for your site.', 'एक सूची। आपकी साइट का लिखित भाव।')}
          </Text>
        </View>
        <Text style={s.body}>
          {t(
            'Building a house or a site? Send quantities and your site address. The store prices each item with freight and sends a quote you can accept.',
            'घर या बड़ी साइट बना रहे हैं? मात्रा और साइट का पता भेजें। दुकान हर सामग्री का भाव, भाड़े के साथ, लिखकर भेजेगी।',
          )}
        </Text>
        <Button icon="arrow-forward" onPress={() => navigate({ screen: 'QuoteRequest' })}>
          {t('Ask for a bulk quote', 'थोक भाव माँगें')}
        </Button>
      </View>
      {awards.length > 0 && (
        <View>
          <Section title={t('Awards & recognition', 'पुरस्कार और सम्मान')} />
          <View style={{ gap: 2 }}>
            {awards.map((award) => (
              <View key={award.title} style={[s.card, s.row]}>
                <Icon name="ribbon-outline" color={C.ink} size={28} />
                <View style={{ flex: 1 }}>
                  <Text style={s.h3}>{award.title}</Text>
                  <Text style={s.small}>
                    {award.issuer} · {award.year}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}
      {brands.length > 0 && (
        <View>
          <Section title={t('Brands at our counter', 'हमारी दुकान के ब्रांड')} />
          <View style={cs.brands}>
            {brands.map((brand) => (
              <Text key={brand} style={cs.brand}>
                {brand}
              </Text>
            ))}
          </View>
        </View>
      )}
    </Screen>
  );
}

export function Catalogue() {
  const {
    route,
    products: refreshedProducts,
    categories,
    t,
    language,
    registerRefresh,
    say,
  } = useStore();
  const [query, setQuery] = useState('');
  const [brand, setBrand] = useState('');
  const [brands, setBrands] = useState<string[]>([]);
  const [search, setSearch] = useState({ query: '', brand: '' });
  const [category, setCategory] = useState(route.category || '');
  const [availability, setAvailability] = useState('all');
  const [sort, setSort] = useState('name');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [items, setItems] = useState<Product[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const visibleItems = useRef(items);
  visibleItems.current = items;
  const inFlight = useRef(false);
  // The list reports reaching its end only once per content length. If that happens while a
  // page is still loading, remember it and fetch the next page as soon as that load finishes.
  const endPending = useRef(false);
  useEffect(() => {
    if (route.screen === 'Products') setCategory(route.category || '');
  }, [route.screen, route.category]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = { query: query.trim(), brand: brand.trim() };
      setSearch((previous) =>
        previous.query === next.query && previous.brand === next.brand ? previous : next,
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [query, brand]);
  useEffect(() => {
    let active = true;
    void api<{ brand: string }[]>(`/brands?q=${encodeURIComponent(search.brand)}`)
      .then((values) => {
        if (active) setBrands(values.map((value) => value.brand));
      })
      .catch(() => {
        if (active) setBrands([]);
      });
    return () => {
      active = false;
    };
  }, [search.brand]);
  const load = useCallback(
    async (cursor?: string, background = false) => {
      if (background && inFlight.current) return;
      const current = ++request.current;
      inFlight.current = true;
      if (cursor) setMore(true);
      else if (!background) {
        setLoading(true);
        setMore(false);
        setItems([]);
        setNextCursor(null);
      }
      setError('');
      const params = new URLSearchParams({
        limit: '24',
        q: search.query,
        category,
        brand: search.brand,
        availability,
        sort,
      });
      if (cursor) params.set('cursor', cursor);
      try {
        let page = await api<Page<Product>>(`/products?${params}`);
        const refreshed = [...page.items];
        // Refresh exactly the pages already opened, preserving the customer's browsing depth.
        while (background && page.nextCursor && refreshed.length < visibleItems.current.length) {
          params.set('cursor', page.nextCursor);
          page = await api<Page<Product>>(`/products?${params}`);
          if (current !== request.current) return;
          refreshed.push(...page.items);
        }
        if (current !== request.current) return;
        setItems((old) =>
          cursor
            ? [
                ...old,
                ...page.items.filter((item) => !old.some((existing) => existing.id === item.id)),
              ]
            : [...new Map(refreshed.map((item) => [item.id, item])).values()],
        );
        setNextCursor(page.nextCursor);
      } catch (e) {
        if (current === request.current) setError(say(e));
      } finally {
        if (current === request.current) {
          inFlight.current = false;
          setLoading(false);
          setMore(false);
        }
      }
    },
    [search, category, availability, sort, say],
  );
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [load]);
  useEffect(() => {
    void load(undefined, true);
  }, [load, refreshedProducts]);
  useEffect(() => {
    if (!endPending.current || loading || more) return;
    endPending.current = false;
    if (nextCursor) void load(nextCursor);
  }, [loading, more, nextCursor, load]);
  useEffect(() => registerRefresh(() => load(undefined, true)), [load, registerRefresh]);
  // Scroll events can arrive faster than re-renders; ask for each page once.
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (!more) requested.current = null;
  }, [more]);
  const loadMore = () => {
    if (nextCursor && !more && !loading) {
      if (requested.current === nextCursor) return;
      requested.current = nextCursor;
      void load(nextCursor);
    } else if (items.length && (more || loading)) endPending.current = true;
  };
  const filtered = brand || availability !== 'all' || sort !== 'name';
  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      <View style={cs.searchBox}>
        <Icon name="search-outline" color={C.ink2} />
        <TextInput
          accessibilityLabel={t('Search materials', 'सामग्री खोजें')}
          placeholder={t('Search cement, steel, sand…', 'सीमेंट, सरिया, बालू खोजें…')}
          placeholderTextColor={C.muted}
          value={query}
          maxLength={100}
          returnKeyType="search"
          onChangeText={setQuery}
          style={cs.searchInput}
        />
        {query ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Clear search', 'खोज हटाएँ')}
            onPress={() => setQuery('')}
            hitSlop={10}
          >
            <Icon name="close-circle" color={C.muted} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.sm }}
        accessibilityLabel={t('Material category', 'सामग्री की श्रेणी')}
      >
        <Chip label={t('All', 'सभी')} selected={!category} onPress={() => setCategory('')} />
        {categories.map((item) => (
          <Chip
            key={item.id}
            label={categoryName(item.slug, item.name, language)}
            selected={category === item.slug}
            onPress={() => setCategory(item.slug)}
          />
        ))}
        <Chip
          label={`${t('Filters', 'फ़िल्टर')}${filtered ? ' •' : ''}`}
          accessibilityLabel={t('Filters and sort', 'फ़िल्टर और क्रम')}
          selected={filtersOpen}
          onPress={() => setFiltersOpen((open) => !open)}
        />
      </ScrollView>
      {filtersOpen && (
        <View style={[s.card, { gap: space.md }]}>
          <Field
            label={t('Brand', 'ब्रांड')}
            placeholder={t('For example: UltraTech', 'जैसे: UltraTech')}
            value={brand}
            maxLength={80}
            onChangeText={setBrand}
            autoCapitalize="none"
          />
          {brands.length > 0 && (
            <ScrollView horizontal contentContainerStyle={{ gap: space.sm }}>
              <Chip
                label={t('All brands', 'सभी ब्रांड')}
                selected={!brand}
                onPress={() => setBrand('')}
              />
              {brands.map((name) => (
                <Chip
                  key={name}
                  label={name}
                  selected={brand === name}
                  onPress={() => setBrand(name)}
                />
              ))}
            </ScrollView>
          )}
          <Text style={s.label}>{t('Stock', 'स्टॉक')}</Text>
          <View style={[s.row, { flexWrap: 'wrap', gap: space.sm }]}>
            {(
              [
                ['all', t('All', 'सभी')],
                ['in', t('In stock', 'स्टॉक में')],
                ['out', t('Out of stock', 'स्टॉक नहीं')],
              ] as const
            ).map(([value, label]) => (
              <Chip
                key={value}
                label={label}
                selected={availability === value}
                onPress={() => setAvailability(value)}
              />
            ))}
          </View>
          <Text style={s.label}>{t('Sort by', 'क्रम')}</Text>
          <View style={[s.row, { flexWrap: 'wrap', gap: space.sm }]}>
            {(
              [
                ['name', t('Name', 'नाम')],
                ['price_asc', t('Price: low to high', 'भाव: कम से ज़्यादा')],
                ['price_desc', t('Price: high to low', 'भाव: ज़्यादा से कम')],
                ['newest', t('Newest', 'नई')],
              ] as const
            ).map(([value, label]) => (
              <Chip
                key={value}
                label={label}
                selected={sort === value}
                onPress={() => setSort(value)}
              />
            ))}
          </View>
          <Button secondary onPress={() => setFiltersOpen(false)}>
            {t('Show materials', 'सामग्री दिखाएँ')}
          </Button>
        </View>
      )}
      {loading ? (
        <RowSkeletons />
      ) : (
        <Text style={s.small}>
          {t(`${items.length} materials`, `${items.length} सामग्री`)}
          {nextCursor ? t(' · more below', ' · नीचे और') : ''}
        </Text>
      )}
      {Boolean(error) && (
        <View style={{ gap: space.sm }}>
          <Notice error>{error}</Notice>
          <Button secondary onPress={() => void load(undefined, Boolean(items.length))}>
            {t('Try again', 'फिर कोशिश करें')}
          </Button>
        </View>
      )}
    </View>
  );
  return (
    <FlatList
      data={loading ? [] : items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <ProductRow product={item} />}
      ListHeaderComponent={header}
      ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={cs.list}
      initialNumToRender={8}
      windowSize={7}
      removeClippedSubviews={Platform.OS === 'android'}
      onEndReachedThreshold={0.6}
      onEndReached={loadMore}
      // A fast fling can reach the bottom before the list draws its last rows; the list then
      // never reports its end, so the scroll position is checked as well.
      onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
        const left = contentSize.height - contentOffset.y - layoutMeasurement.height;
        if (items.length && left < layoutMeasurement.height * 0.6) loadMore();
      }}
      scrollEventThrottle={100}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          colors={[C.accent]}
          onRefresh={() => {
            setRefreshing(true);
            void load(undefined, true).finally(() => setRefreshing(false));
          }}
        />
      }
      ListEmptyComponent={
        !loading && !error ? (
          <Empty
            title={t('No materials match', 'कोई सामग्री नहीं मिली')}
            body={t('Try another name, brand or category.', 'दूसरा नाम, ब्रांड या श्रेणी आज़माएँ।')}
            action={t('Clear filters', 'फ़िल्टर हटाएँ')}
            onAction={() => {
              setQuery('');
              setBrand('');
              setCategory('');
              setAvailability('all');
              setSort('name');
            }}
          />
        ) : null
      }
      ListFooterComponent={
        more ? (
          <View style={{ paddingVertical: space.lg }}>
            <RowSkeletons />
          </View>
        ) : nextCursor && !loading ? (
          <Button secondary onPress={() => void load(nextCursor)} style={{ marginTop: space.md }}>
            {t('Load more materials', 'और सामग्री दिखाएँ')}
          </Button>
        ) : null
      }
    />
  );
}

export function ProductDetail() {
  const {
    route,
    knownProducts,
    products,
    t,
    language,
    add,
    navigate,
    basketQuantity,
    cartBusy,
    registerRefresh,
    remember,
    compare,
    toggleCompare,
    say,
  } = useStore();
  const cached = knownProducts[route.id || ''];
  const [product, setProduct] = useState<Product | null>(cached || null);
  const [quantity, setQuantity] = useState(cached?.minQuantity || 1);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    setError('');
    try {
      const value = await api<Product>(`/products/${encodeURIComponent(route.id || '')}`);
      if (current !== request.current) return;
      setProduct(value);
      remember([value]);
      const room = maxOrderable(
        value,
        Math.min(value.stock, MAX_LINE_QUANTITY) - basketQuantity(value.id),
      );
      setQuantity((old) => (quantityProblem(value, old, room) ? value.minQuantity : old));
    } catch (e) {
      if (current === request.current) setError(say(e));
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [route.id]);
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [load, products]);
  useEffect(() => registerRefresh(load), [load, registerRefresh]);
  if (loading && !product)
    return (
      <Screen>
        <RowSkeletons />
      </Screen>
    );
  if (!product)
    return (
      <Screen>
        <Empty
          title={t('Material could not be loaded', 'सामग्री लोड नहीं हो सकी')}
          body={error || t('It may no longer be available.', 'शायद यह अब उपलब्ध नहीं है।')}
          action={t('Try again', 'फिर कोशिश करें')}
          onAction={() => void load()}
        />
      </Screen>
    );
  const inBasket = basketQuantity(product.id);
  const room = Math.min(product.stock, MAX_LINE_QUANTITY) - inBasket;
  const available = product.active && product.stock >= product.minQuantity;
  const problem = quantityProblem(product, quantity, room);
  const comparing = compare.some((item) => item.id === product.id);
  return (
    <Screen
      footer={
        available ? (
          <>
            <View style={s.between}>
              <Quantity
                value={quantity}
                min={product.minQuantity}
                step={product.quantityStep}
                max={room}
                disabled={cartBusy || busy}
                change={setQuantity}
              />
              <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
                <Text style={s.small}>{t('Total', 'कुल')}</Text>
                <Text style={s.price}>{money(product.pricePaise * quantity)}</Text>
              </View>
            </View>
            <Button
              disabled={cartBusy || Boolean(problem) || room < product.minQuantity}
              loading={busy}
              icon="basket-outline"
              onPress={() => {
                setBusy(true);
                void add(product, quantity).finally(() => setBusy(false));
              }}
            >
              {t('Add to basket', 'टोकरी में जोड़ें')}
            </Button>
          </>
        ) : (
          <Button secondary onPress={() => navigate({ screen: 'QuoteRequest', id: product.id })}>
            {t('Out of stock · ask for a quote', 'स्टॉक नहीं · भाव माँगें')}
          </Button>
        )
      }
    >
      {Boolean(error) && (
        <Notice error>
          {error} {t('Showing the last loaded details.', 'पिछली बार की जानकारी दिख रही है।')}
        </Notice>
      )}
      <View style={[s.row, { alignItems: 'flex-start' }]}>
        <MaterialArt product={product} size={96} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.h1}>{productName(product, language)}</Text>
          {/* The English name is what is printed on the bag, so Hindi readers see it too. */}
          {language === 'hi' && product.nameHi ? <Text style={s.small}>{product.name}</Text> : null}
          <Text style={s.small}>{product.brand}</Text>
          <Tag tone={available ? 'green' : 'grey'}>
            {available ? t('In stock', 'स्टॉक में') : t('Out of stock', 'स्टॉक नहीं')}
          </Tag>
        </View>
      </View>
      <View style={[s.card, { gap: space.sm }]}>
        <View style={[s.row, { alignItems: 'baseline', flexWrap: 'wrap', gap: space.sm }]}>
          <Roll value={money(product.pricePaise)} style={s.display} maxFontSizeMultiplier={1.5} />
          <Text style={[s.body, { color: C.ink }]}>{unitText(product, language)}</Text>
        </View>
        <Text style={s.small}>
          {t(
            `Price updated ${dateLabel(product.priceUpdatedAt, language)}. Confirmed again when you review your order.`,
            `भाव ${dateLabel(product.priceUpdatedAt, language)} को बदला गया। ऑर्डर की समीक्षा में फिर पक्का होगा।`,
          )}
        </Text>
        {inBasket > 0 && (
          <Notice tone="good">
            {t(
              `${inBasket} × ${product.unit} already in your basket`,
              `${inBasket} × ${unitLabel(product.unit, language)} पहले से टोकरी में`,
            )}
          </Notice>
        )}
      </View>
      <View style={{ gap: space.sm }}>
        <Text style={s.h3}>{t('Specification', 'विवरण')}</Text>
        <View style={cs.facts}>
          {(
            [
              [
                t('Category', 'श्रेणी'),
                categoryName(product.category.slug, product.category.name, language),
              ],
              [t('Type', 'प्रकार'), product.type],
              [t('Grade', 'ग्रेड'), product.grade],
              [t('Pack', 'पैक'), product.packSize],
              [t('Sold per', 'बिक्री इकाई'), unitLabel(product.unit, language)],
              [
                t('Order', 'ऑर्डर'),
                t(
                  `minimum ${product.minQuantity}, in steps of ${product.quantityStep}`,
                  `कम से कम ${product.minQuantity}, ${product.quantityStep} के गुणक में`,
                ),
              ],
            ] as const
          )
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <View key={label} style={cs.fact}>
                <Text style={s.small}>{label}</Text>
                <Text style={[s.body, { color: C.ink, fontWeight: '700' }]}>{value}</Text>
              </View>
            ))}
        </View>
      </View>
      {product.description ? (
        <Text style={s.body}>{productDescription(product, language)}</Text>
      ) : null}
      {product.recommendedUse ? (
        <View style={{ gap: space.xs }}>
          <Text style={s.h3}>{t('Recommended use', 'कहाँ इस्तेमाल करें')}</Text>
          <Text style={s.body}>{product.recommendedUse}</Text>
        </View>
      ) : null}
      <View style={[s.row, { gap: space.sm, flexWrap: 'wrap' }]}>
        <Button
          secondary
          icon="document-text-outline"
          style={{ flexGrow: 1, flexBasis: 140 }}
          onPress={() => navigate({ screen: 'QuoteRequest', id: product.id })}
        >
          {t('Bulk quote', 'थोक भाव')}
        </Button>
        <Button
          secondary
          icon={comparing ? 'checkmark' : 'git-compare-outline'}
          style={{ flexGrow: 1, flexBasis: 140 }}
          onPress={() => {
            if (!comparing) toggleCompare(product);
            navigate({ screen: 'Compare' });
          }}
        >
          {t('Compare', 'तुलना करें')}
        </Button>
      </View>
      <DeliveryCheck />
    </Screen>
  );
}

export function Quantity({
  value,
  change,
  max = MAX_LINE_QUANTITY,
  min = 1,
  step = 1,
  disabled,
  label,
  commitOnBlur = false,
  allowRemove = false,
  onInvalid,
}: {
  value: number;
  change: (value: number) => void;
  max?: number;
  min?: number;
  step?: number;
  disabled?: boolean;
  label?: string;
  commitOnBlur?: boolean;
  allowRemove?: boolean;
  onInvalid?: (message: string) => void;
}) {
  const { t } = useStore();
  const name = label || t('Quantity', 'मात्रा');
  const [draft, setDraft] = useState(String(value));
  const input = useRef<TextInput>(null);
  // react-native-web applies selectTextOnFocus after a delay; if the customer has already typed
  // a digit, that late select-all made the next keystroke replace it ("12" became "2").
  const typedSinceFocus = useRef(false);
  // Show the saved quantity, but never overwrite what the customer is typing: a basket save or
  // background refresh finishing mid-entry used to replace their digits.
  const editing = useRef(false);
  useEffect(() => {
    if (!disabled && !editing.current) setDraft(String(value));
  }, [value, disabled]);
  const previous = Math.min(Math.floor(max / step) * step, Math.floor((value - 1) / step) * step);
  const next = Math.max(min, Math.ceil((value + 1) / step) * step);
  const canDecrease = allowRemove || previous >= min;
  function commit() {
    const quantity = Number(draft);
    if (
      draft &&
      Number.isInteger(quantity) &&
      quantity >= min &&
      quantity <= max &&
      quantity % step === 0
    ) {
      if (quantity !== value) change(quantity);
    } else {
      setDraft(String(value));
      onInvalid?.(
        t(
          `Enter a quantity from ${min} to ${max}, in steps of ${step}.`,
          `${min} से ${max} तक, ${step} के गुणक में मात्रा लिखें।`,
        ),
      );
    }
  }
  return (
    <View style={cs.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('Decrease', 'कम करें')} ${name}`}
        disabled={disabled || !canDecrease}
        onPress={() => change(previous < min ? 0 : previous)}
        style={[cs.stepButton, (disabled || !canDecrease) && { opacity: 0.35 }]}
      >
        <Icon name="remove" size={20} />
      </Pressable>
      <TextInput
        accessibilityLabel={name}
        accessibilityHint={t(
          `Minimum ${min}, step ${step}, maximum ${max}`,
          `कम से कम ${min}, गुणक ${step}, अधिकतम ${max}`,
        )}
        ref={input}
        value={draft}
        keyboardType="number-pad"
        selectTextOnFocus={Platform.OS !== 'web'}
        onFocus={() => {
          editing.current = true;
          if (Platform.OS !== 'web') return;
          typedSinceFocus.current = false;
          setTimeout(() => {
            if (!typedSinceFocus.current)
              (input.current as unknown as { select?: () => void } | null)?.select?.();
          }, 0);
        }}
        editable={!disabled}
        onBlur={() => {
          editing.current = false;
          if (commitOnBlur) commit();
          else setDraft(String(value));
        }}
        onSubmitEditing={() => {
          if (commitOnBlur) commit();
        }}
        onChangeText={(text) => {
          typedSinceFocus.current = true;
          if (!/^\d*$/.test(text)) return;
          setDraft(text);
          const typed = Number(text);
          if (
            !commitOnBlur &&
            Number.isInteger(typed) &&
            typed >= min &&
            typed <= max &&
            typed % step === 0
          )
            change(typed);
        }}
        style={cs.quantityValue}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('Increase', 'बढ़ाएँ')} ${name}`}
        disabled={disabled || next > max}
        onPress={() => change(next)}
        style={[cs.stepButton, (disabled || next > max) && { opacity: 0.35 }]}
      >
        <Icon name="add" size={20} />
      </Pressable>
    </View>
  );
}

const cs = StyleSheet.create({
  list: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
  },
  tile: { alignItems: 'center', justifyContent: 'center' },
  // Product rows are surfaces on the cement ground, separated by tone, not lines.
  row: { gap: space.sm, backgroundColor: C.surface, padding: space.md },
  inkRow: { gap: space.sm, paddingVertical: space.md },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  rowName: { color: C.ink, fontSize: textSize.body, fontWeight: '800', lineHeight: 22 },
  rowPriceLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.xs,
    marginTop: 2,
  },
  rowPrice: {
    color: C.ink,
    ...teko(displaySize.figure),
    fontVariant: ['tabular-nums'],
  },
  add: {
    minHeight: 48,
    minWidth: 76,
    paddingHorizontal: space.md,
    borderRadius: radius.control,
    backgroundColor: C.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  addText: { color: C.onAccent, fontSize: textSize.body, fontWeight: '800' },
  inBasket: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.xs,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: C.rule,
    borderRadius: radius.control,
    backgroundColor: C.paper,
  },
  stepButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  quantityValue: {
    width: 64,
    minWidth: 40,
    flexShrink: 1,
    minHeight: 48,
    textAlign: 'center',
    color: C.ink,
    ...display,
    fontSize: displaySize.figure,
    fontVariant: ['tabular-nums'],
  },
  // Home: the rate folders.
  ratesTitle: { color: C.ink, ...teko(displaySize.head) },
  folderTabRow: { flexDirection: 'row', height: 8, pointerEvents: 'none' },
  slantLeft: {
    width: 0,
    height: 0,
    borderBottomWidth: 8,
    borderLeftWidth: 8,
    borderLeftColor: 'transparent',
  },
  folderTab: { width: '44%', height: 8 },
  slantRight: {
    width: 0,
    height: 0,
    borderBottomWidth: 8,
    borderRightWidth: 8,
    borderRightColor: 'transparent',
  },
  folder: {
    minHeight: 56,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    columnGap: space.md,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.md,
  },
  folderName: { color: C.ink, ...teko(displaySize.figure) },
  folderRate: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.xs,
  },
  folderPrice: {
    color: C.ink,
    ...teko(displaySize.figure),
    fontVariant: ['tabular-nums'],
  },
  folderUnit: { color: C.ink2, fontSize: textSize.small, lineHeight: 20 },
  folderPanel: {
    backgroundColor: C.ink,
    paddingHorizontal: space.md,
    paddingBottom: space.md,
    gap: 2,
  },
  folderMore: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
  },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg },
  linkItem: { minHeight: 48, justifyContent: 'center' },
  slipNumber: {
    color: C.ink,
    ...teko(displaySize.figure),
    fontVariant: ['tabular-nums'],
  },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  fact: { flexGrow: 1, flexBasis: 150, backgroundColor: C.surface, padding: space.md, gap: 2 },
  brands: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  brand: {
    color: C.ink,
    ...teko(displaySize.small),
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: C.surface,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: C.paper,
    borderWidth: 1.5,
    borderColor: C.rule,
    borderBottomWidth: 2,
    borderBottomColor: C.muted,
    borderRadius: radius.control,
  },
  searchInput: { flex: 1, color: C.ink, fontSize: textSize.body, minHeight: 48 },
});
