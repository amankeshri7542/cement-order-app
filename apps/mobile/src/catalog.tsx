import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Page, Product, money } from '@shiv/shared';
import { api, message } from './api';
import { useStore } from './store';
import { Button, C, Empty, Field, Icon, IconName, Notice, Section, Tag, s } from './ui';

const categoryIcons: Record<string, IconName> = {
  cement: 'cube-outline',
  steel: 'reorder-four-outline',
  sand: 'layers-outline',
  bricks: 'grid-outline',
  aggregates: 'shapes-outline',
  tiles: 'apps-outline',
  pipes: 'git-merge-outline',
  hardware: 'construct-outline',
};
const categoryHindi: Record<string, string> = {
  cement: 'सीमेंट',
  steel: 'सरिया',
  sand: 'बालू',
  bricks: 'ईंट और ब्लॉक',
  aggregates: 'गिट्टी',
  tiles: 'टाइल्स',
  pipes: 'पाइप',
  hardware: 'हार्डवेयर',
};
export function MaterialArt({ product, large }: { product: Product; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [product.images[0]]);
  if (product.images[0] && !failed)
    return (
      <Image
        accessibilityLabel={product.name}
        source={{ uri: product.images[0] }}
        onError={() => setFailed(true)}
        style={{ width: '100%', height: large ? 260 : 140, resizeMode: 'contain' }}
      />
    );
  return (
    <View style={[cs.art, large && { height: 260 }]}>
      <Icon
        name={categoryIcons[product.category.slug] || 'cube-outline'}
        size={large ? 84 : 48}
        color={C.muted}
      />
      <Text style={[s.specification, { marginTop: 10 }]}>
        {product.category.name.toUpperCase()}
      </Text>
      <Text style={cs.photoCaption}>Product photo pending</Text>
    </View>
  );
}
export function ProductCard({ product }: { product: Product }) {
  const { t, language, navigate, add, cart, cartBusy, setQuantity, setToast } = useStore();
  const [busy, setBusy] = useState(false);
  const inCart = cart.find((line) => line.productId === product.id)?.quantity || 0;
  const available = product.stock >= product.minQuantity;
  return (
    <View style={cs.productCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${product.name}`}
        onPress={() => navigate({ screen: 'Product', id: product.id })}
      >
        <View style={cs.productImage}>
          <MaterialArt product={product} />
        </View>
        <View style={cs.productInfo}>
          <Text style={s.eyebrow}>{product.brand.toUpperCase()}</Text>
          <Text numberOfLines={2} style={cs.productName}>
            {product.name}
          </Text>
          <Text numberOfLines={2} style={s.specification}>
            {[product.grade, product.packSize || product.type].filter(Boolean).join(' · ')}
          </Text>
          <Text style={[s.price, { marginTop: 12, fontSize: 23 }]}>
            {money(product.pricePaise)}
          </Text>
          <Text style={cs.unit}>per {product.unit}</Text>
          <Text style={[cs.stock, { color: available ? C.green : C.red }]}>
            {available ? t('stock') : t('unavailable')}
          </Text>
          <Text style={cs.unit}>
            Min. {product.minQuantity} · step {product.quantityStep}
          </Text>
        </View>
      </Pressable>
      {inCart > 0 ? (
        <View style={[cs.cardButton, { gap: 6, paddingHorizontal: 0 }]}>
          <Text style={[cs.unit, { marginTop: 0 }]}>
            {language === 'hi' ? 'कार्ट में' : 'In cart'} · {product.unit}
          </Text>
          <Quantity
            label={`${product.name} quantity`}
            value={inCart}
            min={product.minQuantity}
            step={product.quantityStep}
            max={Math.min(product.stock, 10000)}
            disabled={cartBusy}
            commitOnBlur
            allowRemove
            onInvalid={setToast}
            change={(quantity) =>
              void setQuantity(product.id, quantity).catch((e) => setToast(message(e)))
            }
          />
        </View>
      ) : (
        <Button
          secondary
          disabled={!available || cartBusy}
          loading={busy}
          onPress={() => {
            setBusy(true);
            void add(product).finally(() => setBusy(false));
          }}
          icon="add"
          style={cs.cardButton}
        >
          {t('add')}
        </Button>
      )}
    </View>
  );
}
function ProductGrid({ products }: { products: Product[] }) {
  const { width } = useWindowDimensions();
  const columns = width > 1000 ? 4 : width > 700 ? 3 : width < 350 ? 1 : 2;
  return (
    <View style={cs.grid}>
      {products.map((product) => (
        <View key={product.id} style={{ width: `${100 / columns}%`, padding: 6 }}>
          <ProductCard product={product} />
        </View>
      ))}
    </View>
  );
}
function Skeletons() {
  return (
    <View
      accessibilityLabel="Loading materials"
      accessibilityState={{ busy: true }}
      style={cs.grid}
    >
      {[0, 1, 2, 3].map((key) => (
        <View key={key} style={{ width: '50%', padding: 6 }}>
          <View style={cs.skeleton}>
            <View style={{ height: 132, backgroundColor: C.concrete }} />
            <View style={cs.skeletonLine} />
            <View style={[cs.skeletonLine, { width: '55%' }]} />
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
function DeliveryCheck() {
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
  async function check() {
    if (!/^[1-9]\d{5}$/.test(pincode)) {
      setError('Enter a valid six-digit pincode.');
      return;
    }
    const current = ++request.current;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await api<DeliveryResult>(`/delivery/${pincode}`);
      if (current === request.current) setResult(response);
    } catch (e) {
      if (current === request.current) setError(message(e));
    } finally {
      if (current === request.current) setBusy(false);
    }
  }
  return (
    <View style={cs.delivery}>
      <View style={[s.row, { flexWrap: 'wrap' }]}>
        <Icon name="location-outline" />
        <Text style={s.h2}>Delivery to your site</Text>
      </View>
      <Text style={s.body}>Check your pincode for delivery charges and availability.</Text>
      <View style={[s.row, { flexWrap: 'wrap' }]}>
        <TextInput
          accessibilityLabel="Delivery pincode"
          placeholder="6-digit pincode"
          placeholderTextColor={C.muted}
          value={pincode}
          maxLength={6}
          keyboardType="number-pad"
          onChangeText={(value) => {
            request.current++;
            setPincode(value.replace(/\D/g, ''));
            setResult(null);
            setError('');
            setBusy(false);
          }}
          onSubmitEditing={() => void check()}
          style={[s.input, { flex: 1, minWidth: 145 }]}
        />
        <Button loading={busy} onPress={() => void check()}>
          Check delivery
        </Button>
      </View>
      {error ? <Notice error>{error}</Notice> : null}
      {result &&
        (result.serviceable && result.zone ? (
          <View style={{ gap: 6 }}>
            <Text style={{ color: C.green, fontWeight: '700', fontSize: 15 }}>
              {result.zone.name} · Delivery available
            </Text>
            <Text style={s.body}>{result.zone.estimate}</Text>
            <Text style={s.specification}>
              {money(result.zone.deliveryFeePaise)} delivery ·{' '}
              {money(result.zone.minimumOrderPaise)} minimum order
              {result.zone.freeDeliveryAbovePaise !== null
                ? ` · Free delivery from ${money(result.zone.freeDeliveryAbovePaise)}`
                : ''}
            </Text>
          </View>
        ) : (
          <Notice>
            This pincode is not currently available for online delivery. Call the store to discuss
            your site.
          </Notice>
        ))}
    </View>
  );
}
export function Home() {
  const {
    products,
    categories,
    settings,
    navigate,
    t,
    language,
    loading,
    error,
    refreshCatalog,
    setToast,
  } = useStore();
  const { width } = useWindowDimensions();
  function contact(url: string) {
    void Linking.openURL(url).catch(() =>
      setToast('Could not open this link. Please call the store directly.'),
    );
  }
  return (
    <>
      <View style={cs.hero}>
        <View style={cs.counterLabel}>
          <Text style={cs.counterLabelText}>SHIV CEMENT STORE / PATNA, BIHAR</Text>
          <Icon name="construct-outline" color={C.yellow} />
        </View>
        <Text style={[cs.heroTitle, width < 500 && { fontSize: 35, lineHeight: 39 }]}>
          {language === 'hi' ? 'आपकी साइट।\nआपकी सामग्री।' : 'Your site.\nYour materials.'}
        </Text>
        <Text style={cs.heroBody}>
          {language === 'hi'
            ? 'सीमेंट से सरिया तक — दाम देखें, सामग्री चुनें और डिलीवरी जांचें।'
            : 'Cement to steel. Check prices, choose your materials and plan the next delivery.'}
        </Text>
        <Button
          icon="arrow-forward"
          onPress={() => navigate({ screen: 'Products' })}
          style={{ alignSelf: 'flex-start', marginTop: 16 }}
        >
          {t('browse')}
        </Button>
        <View style={cs.counterFooter}>
          <Text style={cs.counterFooterText}>PRICE / UNIT / SPECIFICATION</Text>
          <Text style={cs.counterFooterText}>THE MATERIALS COUNTER</Text>
        </View>
      </View>
      <View style={cs.quickActions}>
        <Button
          secondary
          icon="refresh-outline"
          onPress={() => navigate({ screen: 'Orders' })}
          style={{ flex: 1, minWidth: 130 }}
        >
          Reorder materials
        </Button>
        <Button
          secondary
          icon="document-text-outline"
          onPress={() => navigate({ screen: 'QuoteRequest' })}
          style={{ flex: 1, minWidth: 130 }}
        >
          Bulk quotation
        </Button>
      </View>
      <DeliveryCheck />
      <Section title={t('materials')} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={cs.categories}
      >
        {categories.map((category) => (
          <Pressable
            accessibilityRole="button"
            key={category.id}
            style={cs.category}
            onPress={() => navigate({ screen: 'Products', category: category.slug })}
          >
            <Icon name={categoryIcons[category.slug] || 'cube-outline'} size={28} />
            <Text style={cs.categoryName}>
              {language === 'hi' ? categoryHindi[category.slug] || category.name : category.name}
            </Text>
            <Icon name="arrow-forward" size={16} />
          </Pressable>
        ))}
      </ScrollView>
      <Section
        title={t('today')}
        action={t('all')}
        onAction={() => navigate({ screen: 'Products' })}
      />
      <Text style={[s.body, { marginBottom: 14 }]}>
        Prices per selling unit. Final availability and delivery confirmed at checkout.
      </Text>
      {error ? (
        <Empty
          title="Prices could not be loaded"
          body={error}
          action="Try again"
          onAction={() => void refreshCatalog()}
        />
      ) : loading ? (
        <Skeletons />
      ) : (
        <ProductGrid products={products.slice(0, 8)} />
      )}
      {!loading && !error && !products.length && (
        <Empty
          title="The materials counter is being updated"
          body="Call the store for current prices and availability."
        />
      )}
      <View style={cs.bulk}>
        <Text style={s.eyebrow}>PLANNING A BIGGER BUILD?</Text>
        <Text style={s.h2}>One list. A quote for your site.</Text>
        <Text style={s.body}>
          Send material quantities and your delivery address. The store will prepare a quotation for
          you to review.
        </Text>
        <Button secondary onPress={() => navigate({ screen: 'QuoteRequest' })} icon="arrow-forward">
          Request bulk quotation
        </Button>
      </View>
      {settings && (
        <View style={cs.help}>
          <Text style={s.h2}>Talk to Shiv Cement Store</Text>
          <Text style={s.body}>Need help choosing a material or arranging delivery?</Text>
          <View style={cs.quickActions}>
            <Button
              secondary
              icon="call-outline"
              onPress={() => contact(`tel:${settings.phone}`)}
              style={{ flex: 1 }}
            >
              Call store
            </Button>
            <Button
              secondary
              icon="logo-whatsapp"
              onPress={() => contact(`https://wa.me/${settings.phone.replace(/\D/g, '')}`)}
              style={{ flex: 1 }}
            >
              WhatsApp
            </Button>
          </View>
        </View>
      )}
    </>
  );
}
function FilterChips({
  values,
  selected,
  change,
  label,
}: {
  values: { value: string; label: string }[];
  selected: string;
  change: (value: string) => void;
  label: string;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={cs.filterRow}
      >
        {values.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: option.value === selected }}
            onPress={() => change(option.value)}
            style={[cs.filter, option.value === selected && cs.selectedFilter]}
          >
            <Text style={[cs.filterText, option.value === selected && { color: C.white }]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
export function Catalogue() {
  const { route, products: refreshedProducts, categories, t, registerRefresh } = useStore();
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
  const [error, setError] = useState('');
  const request = useRef(0);
  const visibleItems = useRef(items);
  visibleItems.current = items;
  const inFlight = useRef(false);
  useEffect(() => {
    setCategory(route.category || '');
  }, [route.category]);
  useEffect(() => {
    const timer = setTimeout(() => setSearch({ query: query.trim(), brand: brand.trim() }), 300);
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
        if (current === request.current) setError(message(e));
      } finally {
        if (current === request.current) {
          inFlight.current = false;
          setLoading(false);
          setMore(false);
        }
      }
    },
    [search, category, availability, sort],
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
  return (
    <View style={s.stack}>
      <View>
        <Text style={s.eyebrow}>THE MATERIALS COUNTER</Text>
        <Text style={[s.title, { marginTop: 8 }]}>{t('products')}</Text>
        <Text style={[s.body, { marginTop: 8 }]}>
          Compare prices, units and specifications for your next order.
        </Text>
      </View>
      <View style={cs.searchBox}>
        <Icon name="search-outline" />
        <TextInput
          accessibilityLabel={t('search')}
          placeholder={t('search')}
          placeholderTextColor={C.muted}
          value={query}
          maxLength={100}
          onChangeText={setQuery}
          style={cs.searchInput}
        />
      </View>
      <FilterChips
        label="Material category"
        values={[
          { value: '', label: t('all') },
          ...categories.map((item) => ({ value: item.slug, label: item.name })),
        ]}
        selected={category}
        change={setCategory}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Filters and sort"
        accessibilityState={{ expanded: filtersOpen }}
        onPress={() => setFiltersOpen((open) => !open)}
        style={[s.between, s.card, { padding: 14 }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[s.label, { color: C.ink }]}>Filters &amp; sort</Text>
          <Text style={s.specification}>
            {brand || 'All brands'} ·{' '}
            {availability === 'all'
              ? 'All stock'
              : availability === 'in'
                ? 'In stock'
                : 'Out of stock'}
            {sort !== 'name' ? ' · Sorted' : ''}
          </Text>
        </View>
        <Icon name={filtersOpen ? 'chevron-up' : 'options-outline'} />
      </Pressable>
      {filtersOpen && (
        <View style={s.stack}>
          <Field
            label="Filter by brand"
            placeholder="For example: UltraTech"
            value={brand}
            maxLength={80}
            onChangeText={setBrand}
            autoCapitalize="none"
          />
          {brands.length > 0 && (
            <FilterChips
              label="Choose a matching brand"
              values={[
                { value: '', label: 'All brands' },
                ...brands.map((name) => ({ value: name, label: name })),
              ]}
              selected={brand}
              change={setBrand}
            />
          )}
          <FilterChips
            label="Availability"
            values={[
              { value: 'all', label: 'All materials' },
              { value: 'in', label: 'In stock' },
              { value: 'out', label: 'Out of stock' },
            ]}
            selected={availability}
            change={setAvailability}
          />
          <FilterChips
            label="Sort by"
            values={[
              { value: 'name', label: 'Name' },
              { value: 'price_asc', label: 'Price: low to high' },
              { value: 'price_desc', label: 'Price: high to low' },
              { value: 'newest', label: 'Recently added' },
            ]}
            selected={sort}
            change={setSort}
          />
          <Button secondary onPress={() => setFiltersOpen(false)}>
            Show materials
          </Button>
        </View>
      )}
      {loading ? (
        <Skeletons />
      ) : (
        <>
          <Text style={s.specification}>
            {items.length} materials loaded{nextCursor ? ' · more available' : ''}
          </Text>
          <ProductGrid products={items} />
        </>
      )}
      {Boolean(error) && (
        <View style={s.stack}>
          <Notice error>{error}</Notice>
          <Button secondary onPress={() => void load(undefined, Boolean(items.length))}>
            Try again
          </Button>
        </View>
      )}
      {!loading && !error && !items.length && (
        <Empty
          title="No materials match these filters"
          body="Try another name, brand or category."
          action="Clear filters"
          onAction={() => {
            setQuery('');
            setBrand('');
            setCategory('');
            setAvailability('all');
            setSort('name');
          }}
        />
      )}
      {!loading && !error && nextCursor && (
        <Button secondary loading={more} onPress={() => void load(nextCursor)}>
          Load more materials
        </Button>
      )}
    </View>
  );
}
export function ProductDetail() {
  const { route, products, t, add, navigate, cart, cartBusy, registerRefresh } = useStore();
  const cached = products.find((item) => item.id === route.id);
  const [product, setProduct] = useState<Product | null>(cached || null);
  const [quantity, setQuantity] = useState(cached?.minQuantity || 1);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0);
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    setError('');
    try {
      const value = await api<Product>(`/products/${encodeURIComponent(route.id || '')}`);
      if (current !== request.current) return;
      setProduct(value);
      const inCart = cartRef.current.find((line) => line.productId === value.id)?.quantity || 0;
      const available = Math.max(
        value.minQuantity,
        Math.floor((Math.min(value.stock, 10000) - inCart) / value.quantityStep) *
          value.quantityStep,
      );
      setQuantity((old) => {
        if (old >= value.minQuantity && old <= available && old % value.quantityStep === 0)
          return old;
        return Math.min(
          available,
          Math.max(value.minQuantity, Math.ceil(old / value.quantityStep) * value.quantityStep),
        );
      });
    } catch (e) {
      if (current === request.current) setError(message(e));
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
  if (loading && !product) return <Skeletons />;
  if (!product)
    return (
      <Empty
        title="Material could not be loaded"
        body={error || 'This material may no longer be available.'}
        action="Try again"
        onAction={() => void load()}
      />
    );
  const inCart = cart.find((line) => line.productId === product.id)?.quantity || 0;
  return (
    <View style={s.stack}>
      {Boolean(error) && (
        <Notice error>{error} Displaying the last loaded material details.</Notice>
      )}
      <View style={[s.card, { backgroundColor: C.concrete }]}>
        <MaterialArt product={product} large />
      </View>
      <View style={s.between}>
        <Tag tone={product.stock >= product.minQuantity ? 'green' : 'grey'}>
          {product.stock >= product.minQuantity ? t('stock') : t('unavailable')}
        </Tag>
        <Text style={s.specification}>{product.category.name}</Text>
      </View>
      <Text style={s.eyebrow}>{product.brand.toUpperCase()}</Text>
      <Text style={s.title}>{product.name}</Text>
      <Text style={s.specification}>
        {[product.grade, product.type, product.packSize].filter(Boolean).join(' · ')}
      </Text>
      <View style={[s.row, { flexWrap: 'wrap' }]}>
        <Text style={[s.price, { fontSize: 36 }]}>{money(product.pricePaise)}</Text>
        <Text style={s.body}>per {product.unit}</Text>
      </View>
      <Text style={s.body}>
        Price updated {new Date(product.priceUpdatedAt).toLocaleDateString('en-IN')}. Final price
        confirmed at checkout.
      </Text>
      <View style={[s.card, { gap: 8 }]}>
        <Text style={s.h2}>Ordering specification</Text>
        <Text style={s.specification}>
          Selling unit: {product.unit}
          {product.packSize ? `\nPack: ${product.packSize}` : ''}
          {`\nMinimum: ${product.minQuantity} · Order step: ${product.quantityStep}`}
        </Text>
      </View>
      <Text style={s.body}>{product.description}</Text>
      {product.recommendedUse ? (
        <>
          <Text style={s.h2}>Recommended use</Text>
          <Text style={s.body}>{product.recommendedUse}</Text>
        </>
      ) : null}
      <View style={[s.between, { flexWrap: 'wrap' }]}>
        <Text style={s.label}>{t('quantity')}</Text>
        <Quantity
          value={quantity}
          min={product.minQuantity}
          step={product.quantityStep}
          max={Math.min(product.stock, 10000) - inCart}
          disabled={cartBusy || busy}
          change={setQuantity}
        />
      </View>
      <Button
        disabled={
          !product.active ||
          cartBusy ||
          quantity + inCart > Math.min(product.stock, 10000) ||
          quantity < product.minQuantity ||
          quantity % product.quantityStep !== 0
        }
        loading={busy}
        icon="bag-add-outline"
        onPress={() => {
          setBusy(true);
          void add(product, quantity).finally(() => setBusy(false));
        }}
      >
        {t('add')} · {money(product.pricePaise * quantity)}
      </Button>
      {inCart > 0 && (
        <Text style={s.body}>
          In cart: {inCart} × {product.unit}
        </Text>
      )}
      <Button secondary onPress={() => navigate({ screen: 'QuoteRequest', id: product.id })}>
        {t('bulk')}
      </Button>
      <DeliveryCheck />
    </View>
  );
}
export function Quantity({
  value,
  change,
  max = 10000,
  min = 1,
  step = 1,
  disabled,
  label = 'Quantity',
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
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    if (!disabled) setDraft(String(value));
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
      onInvalid?.(`Enter a quantity from ${min} to ${max}, in steps of ${step}.`);
    }
  }
  return (
    <View style={cs.quantity}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label === 'Quantity' ? 'quantity' : label}`}
        disabled={disabled || !canDecrease}
        onPress={() => change(previous < min ? 0 : previous)}
        style={[cs.quantityButton, (disabled || !canDecrease) && { opacity: 0.35 }]}
      >
        <Icon name="remove" size={19} />
      </Pressable>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={`Minimum ${min}, step ${step}, maximum ${max}`}
        value={draft}
        keyboardType="number-pad"
        selectTextOnFocus
        editable={!disabled}
        onBlur={() => (commitOnBlur ? commit() : setDraft(String(value)))}
        onSubmitEditing={() => {
          if (commitOnBlur) commit();
        }}
        onChangeText={(text) => {
          if (!/^\d*$/.test(text)) return;
          setDraft(text);
          const next = Number(text);
          if (
            !commitOnBlur &&
            Number.isInteger(next) &&
            next >= min &&
            next <= max &&
            next % step === 0
          )
            change(next);
        }}
        style={cs.quantityValue}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label === 'Quantity' ? 'quantity' : label}`}
        disabled={disabled || next > max}
        onPress={() => change(next)}
        style={[cs.quantityButton, (disabled || next > max) && { opacity: 0.35 }]}
      >
        <Icon name="add" size={19} />
      </Pressable>
    </View>
  );
}
const cs = StyleSheet.create({
  hero: {
    backgroundColor: C.navy,
    borderRadius: 5,
    padding: 25,
    overflow: 'hidden',
    borderLeftWidth: 6,
    borderLeftColor: C.yellow,
  },
  counterLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 16,
  },
  counterLabelText: { color: C.sand, fontSize: 11, fontWeight: '700', letterSpacing: 1.3, flex: 1 },
  heroTitle: {
    color: C.paper,
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -1.8,
    lineHeight: 43,
  },
  heroBody: { color: '#D0D4CD', fontSize: 15, lineHeight: 23, maxWidth: 470, marginTop: 18 },
  counterFooter: {
    borderTopWidth: 1,
    borderTopColor: '#4E5852',
    paddingTop: 16,
    marginTop: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  counterFooterText: { color: C.sand, fontSize: 10, letterSpacing: 1 },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 16 },
  delivery: { backgroundColor: C.concrete, borderRadius: 5, padding: 20, gap: 14 },
  categories: { gap: 10, paddingBottom: 3 },
  category: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    minWidth: 140,
    padding: 16,
    gap: 14,
    borderRadius: 4,
  },
  categoryName: { color: C.ink, fontSize: 14, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  productCard: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 5,
    overflow: 'hidden',
    height: '100%',
    justifyContent: 'space-between',
  },
  productImage: { backgroundColor: C.concrete, borderBottomWidth: 1, borderBottomColor: C.line },
  art: { height: 140, alignItems: 'center', justifyContent: 'center' },
  photoCaption: { fontSize: 11, color: C.muted, marginTop: 3 },
  productInfo: { padding: 13, gap: 5 },
  productName: { fontSize: 16, lineHeight: 21, fontWeight: '700', color: C.ink, minHeight: 42 },
  unit: { color: C.muted, fontSize: 12, lineHeight: 18 },
  stock: { fontSize: 12, fontWeight: '600', marginTop: 8 },
  cardButton: { marginHorizontal: 12, marginBottom: 13, paddingHorizontal: 10, minHeight: 46 },
  bulk: { backgroundColor: C.sand, padding: 22, marginTop: 28, borderRadius: 5, gap: 14 },
  help: { paddingVertical: 28, gap: 10 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 4,
  },
  searchInput: { flex: 1, color: C.ink, fontSize: 15, minHeight: 52, paddingVertical: 14 },
  filterRow: { gap: 8, paddingBottom: 3 },
  filter: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 4,
    backgroundColor: C.white,
  },
  selectedFilter: { backgroundColor: C.navy, borderColor: C.navy },
  filterText: { fontSize: 13, fontWeight: '600', color: C.muted },
  skeleton: {
    backgroundColor: C.white,
    borderColor: C.line,
    borderWidth: 1,
    paddingBottom: 20,
    minHeight: 230,
  },
  skeletonLine: {
    height: 14,
    margin: 15,
    marginBottom: 0,
    width: '75%',
    backgroundColor: C.concrete,
  },
  quantity: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 4,
    backgroundColor: C.white,
  },
  quantityButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  quantityValue: {
    width: 54,
    minWidth: 32,
    flexShrink: 1,
    minHeight: 46,
    textAlign: 'center',
    color: C.ink,
    fontSize: 15,
    fontWeight: '600',
  },
});
