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
  quantityProblem,
  ratesFrom,
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
  Empty,
  Field,
  Icon,
  Notice,
  Screen,
  Section,
  Stamp,
  Tag,
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

/** A product photo, or a material tile in the shop's colours when there is none. */
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
        style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: C.stone }}
      />
    );
  return (
    <View style={[cs.tile, { width: size, height: size }]}>
      <Icon
        name={categoryIcons[product.category.slug] || 'cube-outline'}
        size={size * 0.5}
        color={C.inkSoft}
      />
    </View>
  );
}

const unitText = (product: Product, language: Language) =>
  language === 'hi' ? `प्रति ${product.unit}` : `per ${product.unit}`;

/**
 * One row per material: everything needed to choose it, and the basket control, in ~100dp.
 * Once in the basket the row shows a quantity bar that can be typed into (200 bags is one
 * entry, not forty taps).
 */
export function ProductRow({ product }: { product: Product }) {
  const { t, navigate, add, setQuantity, basketQuantity, cartBusy, setToast } = useStore();
  const [busy, setBusy] = useState(false);
  const inBasket = basketQuantity(product.id);
  const available = product.active && product.stock >= product.minQuantity;
  return (
    <View style={cs.row} testID={`product-${product.id}`}>
      <View style={[s.row, { gap: space.sm }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('View', 'देखें')} ${product.name}`}
          onPress={() => navigate({ screen: 'Product', id: product.id })}
          style={({ pressed }) => [cs.rowMain, pressed && { opacity: 0.75 }]}
        >
          <MaterialArt product={product} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={cs.rowName} numberOfLines={2}>
              {product.name}
            </Text>
            <Text style={s.small} numberOfLines={1}>
              {[product.brand, product.grade, product.packSize].filter(Boolean).join(' · ')}
            </Text>
            <View style={[s.row, { gap: space.xs, marginTop: 2 }]}>
              <Text style={cs.rowPrice}>{money(product.pricePaise)}</Text>
              <Text style={s.small}>/ {product.unit}</Text>
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
              (busy || cartBusy) && { opacity: 0.5 },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Icon name="add" color={C.surface} size={20} />
            <Text style={cs.addText}>{t('Add', 'जोड़ें')}</Text>
          </Pressable>
        )}
      </View>
      {inBasket > 0 && (
        <View style={cs.inBasket}>
          <Icon name="basket" color={C.green} size={18} />
          <Text style={[s.small, { flex: 1, color: C.green, fontWeight: '700' }]}>
            {t('In basket', 'टोकरी में')} · {product.unit}
          </Text>
          <Quantity
            label={`${product.name} ${t('quantity', 'मात्रा')}`}
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
        <Icon name="location-outline" color={C.clay} />
        <Text style={s.h3}>{t('Delivery to your site', 'आपकी साइट पर डिलीवरी')}</Text>
      </View>
      <View style={[s.row, { gap: space.sm }]}>
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
          style={[s.input, { flex: 1 }]}
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

/** Today's lowest in-stock price per material, as on the shop's chalk board. */
function RateBoard() {
  const { products, loading, error, t, language, navigate, refreshCatalog } = useStore();
  const rates = useMemo(() => ratesFrom(products, 6), [products]);
  const checkedAt = useMemo(() => new Date().toISOString(), [products]);
  return (
    <View style={cs.board}>
      <View style={[s.row, { alignItems: 'flex-start' }]}>
        <Stamp size={46} tone="clay" />
        <View style={{ flex: 1 }}>
          <Text style={cs.boardTitle} accessibilityRole="header">
            {t('Current rates', 'मौजूदा भाव')}
          </Text>
          <Text style={cs.boardSub}>
            {loading
              ? t('Checking today’s prices…', 'आज के भाव जाँचे जा रहे हैं…')
              : t(
                  `Lowest in-stock price · checked ${timeLabel(checkedAt)}`,
                  `सबसे कम उपलब्ध भाव · ${timeLabel(checkedAt)} पर जाँचा`,
                )}
          </Text>
        </View>
      </View>
      {loading && !rates.length ? (
        <View style={{ gap: space.sm, marginTop: space.md }}>
          {[0, 1, 2, 3].map((row) => (
            <View key={row} style={cs.rateRow}>
              <View style={{ height: 18, width: '55%', backgroundColor: '#2E4B5C' }} />
            </View>
          ))}
        </View>
      ) : error && !rates.length ? (
        <View style={{ gap: space.md, marginTop: space.md }}>
          <Text style={cs.boardSub}>
            {t('Today’s rates could not load.', 'आज के भाव लोड नहीं हो सके।')}
          </Text>
          <Button secondary onPress={() => void refreshCatalog()}>
            {t('Try again', 'फिर कोशिश करें')}
          </Button>
        </View>
      ) : rates.length ? (
        <View style={{ marginTop: space.sm }}>
          {rates.map((rate) => (
            <Pressable
              key={rate.slug}
              accessibilityRole="button"
              accessibilityLabel={`${categoryName(rate.slug, rate.name, language)}: ${t(`from ${money(rate.product.pricePaise)}`, `${money(rate.product.pricePaise)} से`)} ${unitText(rate.product, language)}`}
              onPress={() => navigate({ screen: 'Products', category: rate.slug })}
              style={({ pressed }) => [cs.rateRow, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={cs.rateName}>{categoryName(rate.slug, rate.name, language)}</Text>
                <Text style={cs.rateProduct} numberOfLines={1}>
                  {rate.product.name}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={cs.ratePrice}>{money(rate.product.pricePaise)}</Text>
                <Text style={cs.rateProduct}>/ {rate.product.unit}</Text>
              </View>
              <Icon name="chevron-forward" color={C.clayOnInk} size={18} />
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={[cs.boardSub, { marginTop: space.md }]}>
          {t(
            'No materials are in stock right now. Call the store for today’s rates.',
            'अभी कोई सामग्री स्टॉक में नहीं है। आज के भाव के लिए दुकान पर फ़ोन करें।',
          )}
        </Text>
      )}
      <Text style={[cs.boardSub, { marginTop: space.md, fontSize: 13 }]}>
        {t(
          'Delivery is added when you review your order.',
          'डिलीवरी शुल्क ऑर्डर की समीक्षा में जुड़ता है।',
        )}
      </Text>
    </View>
  );
}

/** Compact, first on Home for returning customers: where is my order, and order it again. */
function LatestOrder() {
  const { latestOrder, t, language, navigate } = useStore();
  const reorder = useReorder(latestOrder);
  if (!latestOrder) return null;
  return (
    <View style={[s.card, { gap: space.sm, padding: space.md }]}>
      <View style={s.between}>
        <Text style={s.h3} numberOfLines={1}>
          {t('Your latest order', 'आपका पिछला ऑर्डर')}
        </Text>
        <OrderStatusTag status={latestOrder.status} language={language} />
      </View>
      <Text style={s.small} numberOfLines={1}>
        {latestOrder.number} ·{' '}
        {latestOrder.items.map((item) => `${item.name} × ${item.quantity}`).join(', ')}
      </Text>
      <View style={[s.row, { gap: space.sm }]}>
        <Button
          secondary
          icon="navigate-outline"
          style={{ flex: 1, minHeight: 48 }}
          onPress={() => navigate({ screen: 'Order', id: latestOrder.id })}
        >
          {t('Track', 'ट्रैक करें')}
        </Button>
        <Button
          icon="repeat"
          style={{ flex: 1, minHeight: 48 }}
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
  const { categories, products, navigate, t, language, refreshCurrent, refreshing, user } =
    useStore();
  const brands = useMemo(
    () => [...new Set(products.map((product) => product.brand).filter(Boolean))].slice(0, 12),
    [products],
  );
  const actions: [string, IconName, () => void][] = [
    [t('All materials', 'सारी सामग्री'), 'grid-outline', () => navigate({ screen: 'Products' })],
    [
      t('Bulk quote', 'थोक भाव'),
      'document-text-outline',
      () => navigate({ screen: 'QuoteRequest' }),
    ],
    [
      t('Ask Shiv Sahayak', 'शिव सहायक से पूछें'),
      'chatbubbles-outline',
      () => navigate({ screen: 'Assistant' }),
    ],
    [t('Compare', 'तुलना करें'), 'git-compare-outline', () => navigate({ screen: 'Compare' })],
  ];
  return (
    <Screen onRefresh={() => void refreshCurrent()} refreshing={refreshing}>
      {user && <LatestOrder />}
      <RateBoard />
      <View style={cs.actions}>
        {actions.map(([label, icon, onPress]) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            onPress={onPress}
            style={({ pressed }) => [cs.action, pressed && { opacity: 0.75 }]}
          >
            <Icon name={icon} color={C.clay} size={26} />
            <Text style={cs.actionText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {categories.length > 0 && (
        <View>
          <Section title={t('Shop by material', 'सामग्री के हिसाब से')} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.sm }}
          >
            {categories.map((category) => (
              <Pressable
                accessibilityRole="button"
                key={category.id}
                style={({ pressed }) => [cs.category, pressed && { opacity: 0.75 }]}
                onPress={() => navigate({ screen: 'Products', category: category.slug })}
              >
                <Icon name={categoryIcons[category.slug] || 'cube-outline'} size={28} />
                <Text style={cs.categoryName}>
                  {categoryName(category.slug, category.name, language)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
      <DeliveryCheck />
      <View style={cs.bulk}>
        <Text style={s.eyebrow}>
          {t('BUILDING A HOUSE OR A SITE?', 'घर या बड़ी साइट बना रहे हैं?')}
        </Text>
        <Text style={s.h2}>
          {t('One list. A written price for your site.', 'एक सूची। आपकी साइट का लिखित भाव।')}
        </Text>
        <Text style={s.body}>
          {t(
            'Send quantities and your site address. The store prices each item with freight and sends a quote you can accept.',
            'मात्रा और साइट का पता भेजें। दुकान हर सामग्री का भाव, भाड़े के साथ, लिखकर भेजेगी।',
          )}
        </Text>
        <Button icon="arrow-forward" onPress={() => navigate({ screen: 'QuoteRequest' })}>
          {t('Ask for a bulk quote', 'थोक भाव माँगें')}
        </Button>
      </View>
      {awards.length > 0 && (
        <View>
          <Section title={t('Awards & recognition', 'पुरस्कार और सम्मान')} />
          {awards.map((award) => (
            <View key={award.title} style={[s.card, s.row, { marginBottom: space.sm }]}>
              <Icon name="ribbon-outline" color={C.clay} size={28} />
              <View style={{ flex: 1 }}>
                <Text style={s.h3}>{award.title}</Text>
                <Text style={s.small}>
                  {award.issuer} · {award.year}
                </Text>
              </View>
            </View>
          ))}
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
  useEffect(() => registerRefresh(() => load(undefined, true)), [load, registerRefresh]);
  const filtered = brand || availability !== 'all' || sort !== 'name';
  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      <View style={cs.searchBox}>
        <Icon name="search-outline" color={C.inkSoft} />
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
      onEndReached={() => {
        if (nextCursor && !more && !loading) void load(nextCursor);
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          colors={[C.clay]}
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
          <Text style={s.eyebrow}>{product.brand.toUpperCase()}</Text>
          <Text style={[s.h1, { fontSize: 26 }]}>{product.name}</Text>
          <Tag tone={available ? 'green' : 'grey'}>
            {available ? t('In stock', 'स्टॉक में') : t('Out of stock', 'स्टॉक नहीं')}
          </Tag>
        </View>
      </View>
      <View style={[s.card, { gap: space.sm }]}>
        <View style={[s.row, { alignItems: 'baseline', flexWrap: 'wrap', gap: space.sm }]}>
          <Text style={[s.price, { fontSize: 32 }]}>{money(product.pricePaise)}</Text>
          <Text style={s.body}>{unitText(product, language)}</Text>
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
              `${inBasket} × ${product.unit} पहले से टोकरी में`,
            )}
          </Notice>
        )}
      </View>
      <View style={[s.card, { gap: space.sm }]}>
        <Text style={s.h3}>{t('Specification', 'विवरण')}</Text>
        {(
          [
            [
              t('Category', 'श्रेणी'),
              categoryName(product.category.slug, product.category.name, language),
            ],
            [t('Type', 'प्रकार'), product.type],
            [t('Grade', 'ग्रेड'), product.grade],
            [t('Pack', 'पैक'), product.packSize],
            [t('Sold per', 'बिक्री इकाई'), product.unit],
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
            <View key={label} style={[s.between, { alignItems: 'flex-start' }]}>
              <Text style={s.small}>{label}</Text>
              <Text style={[s.body, { color: C.ink, flex: 1, textAlign: 'right' }]}>{value}</Text>
            </View>
          ))}
      </View>
      {product.description ? <Text style={s.body}>{product.description}</Text> : null}
      {product.recommendedUse ? (
        <View style={{ gap: space.xs }}>
          <Text style={s.h3}>{t('Recommended use', 'कहाँ इस्तेमाल करें')}</Text>
          <Text style={s.body}>{product.recommendedUse}</Text>
        </View>
      ) : null}
      <View style={[s.row, { gap: space.sm }]}>
        <Button
          secondary
          icon="document-text-outline"
          style={{ flex: 1 }}
          onPress={() => navigate({ screen: 'QuoteRequest', id: product.id })}
        >
          {t('Bulk quote', 'थोक भाव')}
        </Button>
        <Button
          secondary
          icon={comparing ? 'checkmark' : 'git-compare-outline'}
          style={{ flex: 1 }}
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
  tile: {
    backgroundColor: C.stone,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    gap: space.sm,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: radius.md,
    padding: space.md,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  inBasket: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: C.stone,
  },
  rowName: { color: C.ink, fontSize: textSize.body, fontWeight: '800', lineHeight: 21 },
  rowPrice: { color: C.ink, fontSize: 20, fontWeight: '800' },
  add: {
    minHeight: 48,
    minWidth: 76,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: C.clay,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  addText: { color: C.surface, fontSize: textSize.body, fontWeight: '800' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: C.ink,
    borderRadius: radius.md,
    backgroundColor: C.surface,
  },
  stepButton: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  quantityValue: {
    width: 64,
    minWidth: 40,
    flexShrink: 1,
    minHeight: 48,
    textAlign: 'center',
    color: C.ink,
    fontSize: textSize.lead,
    fontWeight: '800',
  },
  board: { backgroundColor: C.ink, borderRadius: radius.lg, padding: space.lg },
  boardTitle: { color: C.paper, fontSize: 26, fontWeight: '800' },
  boardSub: { color: '#C9D3D8', fontSize: textSize.caption, lineHeight: 20 },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#2E4B5C',
  },
  rateName: { color: C.paper, fontSize: textSize.lead, fontWeight: '800' },
  rateProduct: { color: '#C9D3D8', fontSize: 13 },
  ratePrice: { color: C.clayOnInk, fontSize: 22, fontWeight: '800' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 76,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
    justifyContent: 'center',
  },
  actionText: { color: C.ink, fontSize: textSize.body, fontWeight: '800' },
  category: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    minWidth: 96,
    minHeight: 88,
    padding: space.md,
    gap: space.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryName: { color: C.ink, fontSize: textSize.body, fontWeight: '700' },
  bulk: { backgroundColor: C.kraft, padding: space.lg, borderRadius: radius.lg, gap: space.md },
  brands: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  brand: {
    color: C.ink,
    fontSize: textSize.body,
    fontWeight: '800',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: C.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: C.line,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: C.line,
    borderRadius: radius.md,
  },
  searchInput: { flex: 1, color: C.ink, fontSize: textSize.body, minHeight: 52 },
});
