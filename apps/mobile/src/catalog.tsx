import { useState } from 'react';
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
import { Product, money } from '@shiv/shared';
import { useStore } from './store';
import { Button, C, Empty, Icon, IconName, Section, Tag, s } from './ui';

const categoryIcons: Record<string, IconName> = {
  cement: 'cube-outline',
  steel: 'reorder-four-outline',
  sand: 'layers-outline',
  bricks: 'grid-outline',
};
export function MaterialArt({ product, large }: { product: Product; large?: boolean }) {
  if (product.images[0])
    return (
      <Image
        accessibilityLabel={product.name}
        source={{ uri: product.images[0] }}
        style={{ width: '100%', height: large ? 240 : 140, resizeMode: 'contain' }}
      />
    );
  const color =
    product.brand === 'ACC'
      ? '#bd4e40'
      : product.brand === 'Dalmia'
        ? '#387295'
        : product.brand === 'Shree'
          ? '#789549'
          : '#e6b943';
  return (
    <View style={[cs.art, large && { height: 260 }]}>
      {product.category.slug === 'cement' ? (
        <View
          style={[
            cs.bag,
            {
              backgroundColor: color,
              transform: [{ rotate: '-6deg' }, { scale: large ? 1.6 : 1 }],
            },
          ]}
        >
          <View style={cs.bagSeam} />
          <Text style={[cs.bagBrand, { color: product.brand === 'UltraTech' ? C.navy : '#fff' }]}>
            {product.brand.toUpperCase()}
          </Text>
          <View style={cs.bagStripe}>
            <Text style={cs.bagGrade}>{product.grade}</Text>
            <Text style={cs.bagCement}>CEMENT</Text>
          </View>
          <Text style={cs.bagWeight}>50 kg</Text>
          <View style={[cs.bagSeam, { top: undefined, bottom: 4 }]} />
        </View>
      ) : (
        <Icon
          name={categoryIcons[product.category.slug] || 'cube-outline'}
          size={large ? 110 : 68}
          color={product.category.slug === 'bricks' ? '#b7775c' : '#7890a3'}
        />
      )}
    </View>
  );
}
export function ProductCard({ product }: { product: Product }) {
  const { t, navigate, add } = useStore();
  const [busy, setBusy] = useState(false);
  return (
    <View style={cs.productCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${product.name}`}
        onPress={() => navigate({ screen: 'Product', id: product.id })}
      >
        <View style={cs.productImage}>
          <MaterialArt product={product} />
          <View style={cs.productGrade}>
            <Text style={cs.productGradeText}>{product.grade}</Text>
          </View>
        </View>
        <View style={cs.productInfo}>
          <Text style={cs.productBrand}>{product.brand.toUpperCase()}</Text>
          <Text numberOfLines={2} style={cs.productName}>
            {product.name}
          </Text>
          <Text style={cs.productUnit}>
            {product.type} · {product.unit}
          </Text>
          <View style={cs.productPrice}>
            <Text style={s.price}>{money(product.pricePaise)}</Text>
            <Text style={cs.perUnit}>/ unit</Text>
          </View>
          <Text style={[cs.stock, !product.stock && { color: C.red }]}>
            {product.stock ? `● ${t('stock')}` : t('unavailable')}
          </Text>
        </View>
      </Pressable>
      <Button
        secondary
        onPress={() => {
          setBusy(true);
          void add(product).finally(() => setBusy(false));
        }}
        disabled={!product.stock}
        loading={busy}
        icon="add"
        style={{ marginHorizontal: 14, marginBottom: 15, minHeight: 42, paddingVertical: 9 }}
      >
        {t('add')}
      </Button>
    </View>
  );
}
function ProductGrid({ products }: { products: Product[] }) {
  const { width } = useWindowDimensions();
  const columns = width > 900 ? 4 : width > 650 ? 3 : 2;
  return (
    <View style={cs.grid}>
      {products.map((p) => (
        <View key={p.id} style={{ width: `${100 / columns}%`, padding: 6 }}>
          <ProductCard product={p} />
        </View>
      ))}
    </View>
  );
}
export function Home() {
  const { products, categories, settings, navigate, t, language, user } = useStore();
  const { width } = useWindowDimensions();
  return (
    <>
      <View style={cs.searchBox}>
        <Icon name="search-outline" color="#8295a5" size={20} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('search')}
          onPress={() => navigate({ screen: 'Products' })}
          style={{ flex: 1, paddingVertical: 15 }}
        >
          <Text style={cs.searchPlaceholder}>{t('search')}</Text>
        </Pressable>
        <Icon name="options-outline" color="#8295a5" size={20} />
      </View>
      <View style={cs.hero}>
        <View style={{ flex: 1, zIndex: 1 }}>
          <View style={cs.heroEyebrow}>
            <View style={cs.dot} />
            <Text style={cs.heroEyebrowText}>{t('greeting')}</Text>
          </View>
          <Text style={[cs.heroTitle, width < 550 && { fontSize: 31 }]}>
            {language === 'hi'
              ? 'मजबूत नींव।\nबेहतर कल।'
              : 'Strong foundations.\nStronger tomorrows.'}
          </Text>
          <Text style={cs.heroBody}>{t('tagline')}</Text>
          <Button
            onPress={() => navigate({ screen: 'Products' })}
            icon="arrow-forward"
            style={{ alignSelf: 'flex-start', marginTop: 20 }}
          >
            {t('browse')}
          </Button>
        </View>
        {width > 600 && (
          <View style={cs.heroArt}>
            <View style={cs.heroBuilding} />
            <View style={[cs.heroBuilding, { right: 16, height: 150, width: 55 }]} />
            <View style={cs.heroBag}>
              <Text style={cs.heroBagBrand}>SHIV</Text>
              <Text style={cs.heroBagTitle}>BUILD{`\n`}STRONG.</Text>
              <Text style={cs.heroBagCaption}>CEMENT STORE</Text>
            </View>
          </View>
        )}
      </View>
      <View style={cs.trustRow}>
        {[
          {
            icon: 'shield-checkmark-outline' as const,
            text: language === 'hi' ? 'भरोसेमंद ब्रांड' : 'Trusted brands',
          },
          {
            icon: 'pricetag-outline' as const,
            text: language === 'hi' ? 'साफ और सही दाम' : 'Transparent prices',
          },
          {
            icon: 'car-outline' as const,
            text: language === 'hi' ? 'बिहार भर में डिलीवरी' : 'Across Bihar',
          },
        ].map((x) => (
          <View key={x.icon} style={cs.trustItem}>
            <Icon name={x.icon} size={18} color="#657e92" />
            <Text style={cs.trustText}>{x.text}</Text>
          </View>
        ))}
      </View>
      <Section title={t('materials')} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={cs.categories}
      >
        {categories.map((c) => (
          <Pressable
            accessibilityRole="button"
            key={c.id}
            style={cs.category}
            onPress={() => navigate({ screen: 'Products', category: c.slug })}
          >
            <View style={cs.categoryIcon}>
              <Icon name={categoryIcons[c.slug] || 'cube-outline'} size={28} color="#5d768b" />
            </View>
            <Text style={cs.categoryName}>
              {language === 'hi'
                ? { cement: 'सीमेंट', steel: 'सरिया', sand: 'बालू', bricks: 'ईंट' }[c.slug] ||
                  c.name
                : c.name}
            </Text>
            <Icon name="arrow-forward" size={15} color="#8a9ba8" />
          </Pressable>
        ))}
      </ScrollView>
      <Section
        title={t('today')}
        action={t('all')}
        onAction={() => navigate({ screen: 'Products' })}
      />
      <ProductGrid products={products.filter((p) => p.category.slug === 'cement').slice(0, 4)} />
      <View style={cs.bulk}>
        <View style={cs.bulkIcon}>
          <Icon name="construct-outline" size={31} color="#90762f" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={cs.bulkEyebrow}>
            {language === 'hi' ? 'ठेकेदार और बड़े ऑर्डर' : 'FOR CONTRACTORS & BIGGER BUILDS'}
          </Text>
          <Text style={cs.bulkTitle}>{t('bulkTitle')}</Text>
          <Text style={cs.bulkBody}>{t('bulkBody')}</Text>
        </View>
        <Button onPress={() => navigate({ screen: 'QuoteRequest' })} secondary icon="arrow-forward">
          {t('bulk')}
        </Button>
      </View>
      {user && (
        <View style={[s.card, s.between, { marginTop: 22 }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16 }}>
              {language === 'hi' ? 'फिर वही सामग्री चाहिए?' : 'Picking up where you left off?'}
            </Text>
            <Text style={[s.body, { marginTop: 6 }]}>
              {language === 'hi'
                ? 'पिछले ऑर्डर से दोबारा खरीदें।'
                : 'Reorder your materials at today’s prices.'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('orders')}
            onPress={() => navigate({ screen: 'Orders' })}
            style={{ padding: 12 }}
          >
            <Icon name="arrow-forward" />
          </Pressable>
        </View>
      )}
      <View style={cs.help}>
        <Icon name="headset-outline" color="#70879a" size={24} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '600', color: C.ink, fontSize: 13 }}>{t('needHelp')}</Text>
          <Text style={[s.body, { fontSize: 11 }]}>Shiv Cement Store · Patna, Bihar</Text>
        </View>
        {settings && (
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL(`https://wa.me/${settings.phone.replace('+', '')}`)}
            style={{ padding: 12 }}
          >
            <Icon name="logo-whatsapp" color={C.green} size={26} />
          </Pressable>
        )}
      </View>
    </>
  );
}
export function Catalogue() {
  const { route, products, categories, t } = useStore();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(route.category || '');
  const result = products.filter(
    (p) =>
      (!category || p.category.slug === category) &&
      `${p.name} ${p.brand} ${p.type}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <View>
      <Text style={s.title}>{t('products')}</Text>
      <Text style={[s.body, { marginTop: 7, marginBottom: 20 }]}>{t('tagline')}</Text>
      <View style={cs.searchBox}>
        <Icon name="search-outline" color="#8295a5" />
        <TextInput
          accessibilityLabel={t('search')}
          placeholder={t('search')}
          placeholderTextColor="#8c9aa5"
          value={query}
          onChangeText={setQuery}
          style={{ flex: 1, color: C.ink, paddingVertical: 15, fontSize: 14 }}
        />
      </View>
      <ScrollView
        horizontal
        contentContainerStyle={cs.filterRow}
        showsHorizontalScrollIndicator={false}
      >
        {[{ id: '', slug: '', name: t('all') }, ...categories].map((c) => (
          <Pressable
            key={c.id}
            accessibilityRole="button"
            aria-selected={category === c.slug}
            accessibilityState={{ selected: category === c.slug }}
            onPress={() => setCategory(c.slug)}
            style={[
              cs.filter,
              category === c.slug && { backgroundColor: C.navy, borderColor: C.navy },
            ]}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: '600',
                color: category === c.slug ? C.white : '#718594',
              }}
            >
              {c.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <ProductGrid products={result} />
      {!result.length && (
        <Empty title="No materials found" body="Try another product name or category." />
      )}
    </View>
  );
}
export function ProductDetail() {
  const { route, products, t, add, settings, navigate } = useStore();
  const [quantity, setQuantity] = useState(10);
  const [busy, setBusy] = useState(false);
  const p = products.find((p) => p.id === route.id);
  if (!p)
    return (
      <Empty
        title="Product unavailable"
        body="This product is no longer available. Browse the latest catalogue."
        action={t('browse')}
        onAction={() => navigate({ screen: 'Products' })}
      />
    );
  return (
    <View style={s.stack}>
      <View style={[s.card, { padding: 15, backgroundColor: '#eef2f5' }]}>
        <MaterialArt product={p} large />
      </View>
      <View style={s.between}>
        <Tag>{p.grade}</Tag>
        <Text style={{ fontSize: 12, color: p.stock ? C.green : C.red }}>
          {p.stock ? t('stock') : t('unavailable')}
        </Text>
      </View>
      <Text style={[s.eyebrow, { marginBottom: -8 }]}>{p.brand.toUpperCase()}</Text>
      <Text style={s.title}>{p.name}</Text>
      <Text style={s.body}>
        {p.type} · {p.unit}
      </Text>
      <View style={s.row}>
        <Text style={[s.price, { fontSize: 35 }]}>{money(p.pricePaise)}</Text>
        <Text style={s.body}>/ {p.unit}</Text>
      </View>
      <Text style={[s.body, { fontSize: 11 }]}>
        Updated {new Date(p.priceUpdatedAt).toLocaleDateString('en-IN')} · Final price confirmed at
        checkout
      </Text>
      <View style={[s.card, s.row]}>
        <Icon name="car-outline" color="#668092" />
        <Text style={[s.body, { flex: 1 }]}>{settings?.deliveryMessage}</Text>
      </View>
      <Text style={s.body}>{p.description}</Text>
      <Text style={s.h2}>Recommended use</Text>
      <Text style={s.body}>{p.recommendedUse}</Text>
      <View style={s.between}>
        <Text style={s.label}>{t('quantity')}</Text>
        <Quantity value={quantity} max={Math.min(p.stock, 10000)} change={setQuantity} />
      </View>
      <Button
        disabled={!p.stock || quantity > p.stock}
        loading={busy}
        icon="bag-add-outline"
        onPress={() => {
          setBusy(true);
          void add(p, quantity).finally(() => setBusy(false));
        }}
      >
        {t('add')}
      </Button>
      <Button secondary onPress={() => navigate({ screen: 'QuoteRequest', id: p.id })}>
        {t('bulk')}
      </Button>
    </View>
  );
}
export function Quantity({
  value,
  change,
  max = 10000,
  min = 1,
  disabled,
}: {
  value: number;
  change: (v: number) => void;
  max?: number;
  min?: number;
  disabled?: boolean;
}) {
  return (
    <View style={cs.quantity}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Decrease quantity"
        disabled={disabled || value <= min}
        onPress={() => change(value - 1)}
        style={[cs.quantityButton, (disabled || value <= min) && { opacity: 0.3 }]}
      >
        <Icon name="remove" size={17} />
      </Pressable>
      <TextInput
        accessibilityLabel="Quantity"
        value={String(value)}
        keyboardType="number-pad"
        selectTextOnFocus
        editable={!disabled}
        onChangeText={(v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n >= min && n <= max) change(n);
        }}
        style={cs.quantityValue}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Increase quantity"
        disabled={disabled || value >= max}
        onPress={() => change(value + 1)}
        style={[cs.quantityButton, (disabled || value >= max) && { opacity: 0.3 }]}
      >
        <Icon name="add" size={17} />
      </Pressable>
    </View>
  );
}
const cs = StyleSheet.create({
  searchBox: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 9,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 22,
  },
  searchPlaceholder: { color: '#8c9aa5', fontSize: 13 },
  hero: {
    backgroundColor: C.navy,
    borderRadius: 13,
    padding: 30,
    flexDirection: 'row',
    overflow: 'hidden',
    minHeight: 245,
  },
  heroEyebrow: { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 15 },
  dot: { height: 5, width: 5, borderRadius: 5, backgroundColor: C.yellow },
  heroEyebrowText: { color: '#d3b65d', fontSize: 8, letterSpacing: 1.6, fontWeight: '700' },
  heroTitle: {
    color: '#fff',
    fontSize: 37,
    fontWeight: '700',
    letterSpacing: -1.2,
    lineHeight: 43,
  },
  heroBody: { color: '#a9bdcd', fontSize: 12, marginTop: 13, lineHeight: 20 },
  heroArt: { width: 210, position: 'relative', marginBottom: -30 },
  heroBag: {
    position: 'absolute',
    bottom: 15,
    right: 53,
    width: 120,
    height: 170,
    backgroundColor: C.yellow,
    borderRadius: 10,
    padding: 16,
    transform: [{ rotate: '8deg' }],
  },
  heroBagBrand: { fontSize: 19, color: C.navy, fontWeight: '900', letterSpacing: 2 },
  heroBagTitle: {
    fontSize: 21,
    lineHeight: 25,
    fontWeight: '900',
    color: C.navy,
    marginVertical: 17,
  },
  heroBagCaption: { fontSize: 7, color: C.navy, letterSpacing: 1 },
  heroBuilding: {
    position: 'absolute',
    height: 190,
    width: 69,
    borderWidth: 1,
    borderColor: '#37546b',
    backgroundColor: '#254157',
    bottom: 0,
    right: 125,
  },
  trustRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    paddingVertical: 20,
  },
  trustItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trustText: { fontSize: 10, color: '#778997', fontWeight: '500' },
  categories: { gap: 12, paddingBottom: 2 },
  category: {
    minWidth: 145,
    backgroundColor: C.white,
    padding: 12,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  categoryIcon: {
    height: 38,
    width: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#edf2f6',
    borderRadius: 7,
  },
  categoryName: { color: C.ink, fontSize: 12, fontWeight: '600', flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  productCard: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    overflow: 'hidden',
    height: '100%',
    justifyContent: 'space-between',
  },
  productImage: { backgroundColor: '#f0f3f6', margin: 9, borderRadius: 7, position: 'relative' },
  productGrade: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: '#ffffffbb',
    borderRadius: 3,
  },
  productGradeText: { fontSize: 8, color: '#6e7e8c', fontWeight: '600' },
  art: { height: 140, alignItems: 'center', justifyContent: 'center' },
  bag: {
    height: 99,
    width: 70,
    borderRadius: 4,
    paddingTop: 13,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#00000010',
  },
  bagBrand: { fontSize: 9, fontWeight: '900', textAlign: 'center', letterSpacing: -0.4 },
  bagStripe: {
    backgroundColor: '#ffffffdc',
    marginTop: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  bagGrade: { fontSize: 14, fontWeight: '800', color: C.navy },
  bagCement: { fontSize: 6, color: C.navy, letterSpacing: 1, marginTop: 3 },
  bagWeight: { fontSize: 6, color: '#fff', textAlign: 'center', marginTop: 9 },
  bagSeam: {
    position: 'absolute',
    top: 4,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: '#00000018',
  },
  productInfo: { padding: 14, paddingTop: 5 },
  productBrand: {
    fontSize: 8,
    letterSpacing: 1.2,
    fontWeight: '700',
    color: '#9aa5ae',
    marginBottom: 6,
  },
  productName: { fontSize: 14, fontWeight: '700', color: C.ink, minHeight: 35, lineHeight: 18 },
  productUnit: { fontSize: 9, color: C.muted, marginTop: 5 },
  productPrice: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginTop: 13,
    flexWrap: 'wrap',
  },
  perUnit: { fontSize: 9, color: C.muted },
  stock: { fontSize: 9, color: C.green, marginTop: 9 },
  bulk: {
    marginTop: 28,
    backgroundColor: '#faf3df',
    borderWidth: 1,
    borderColor: '#ebe0c1',
    padding: 24,
    borderRadius: 10,
    gap: 15,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  bulkIcon: {
    width: 53,
    height: 53,
    borderRadius: 8,
    backgroundColor: '#efe4c6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulkEyebrow: {
    fontSize: 8,
    letterSpacing: 1,
    color: '#9a854b',
    fontWeight: '700',
    marginBottom: 8,
  },
  bulkTitle: {
    fontSize: 20,
    color: C.ink,
    fontWeight: '700',
    lineHeight: 25,
    minWidth: 180,
    maxWidth: 430,
  },
  bulkBody: { fontSize: 11, color: '#9a8b65', lineHeight: 18, marginTop: 8, maxWidth: 430 },
  help: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 30,
    paddingHorizontal: 4,
  },
  filterRow: { gap: 8, paddingBottom: 19 },
  filter: {
    borderWidth: 1,
    borderColor: '#dfe6ec',
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderRadius: 25,
    backgroundColor: C.white,
  },
  quantity: {
    borderWidth: 1,
    borderColor: '#dae3e9',
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.white,
  },
  quantityButton: { height: 44, width: 37, alignItems: 'center', justifyContent: 'center' },
  quantityValue: {
    width: 45,
    textAlign: 'center',
    fontSize: 13,
    color: C.ink,
    fontWeight: '600',
    minHeight: 44,
  },
});
