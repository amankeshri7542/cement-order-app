import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { rateItems, type RateItem } from '../../logic/rates';
import { refreshEverything } from '../../state/boot';
import { catalogStore, refreshCatalog } from '../../state/catalog';
import { openSheet, push } from '../../state/nav';
import { ordersStore } from '../../state/orders';
import { sessionStore } from '../../state/session';
import { useSelect } from '../../state/use';
import { Button } from '../../ui/Button';
import { Icon, Mark } from '../../ui/Icon';
import { Bone, Empty } from '../../ui/Notice';
import { useOpenAtTop } from '../../ui/Screen';
import { Specimen } from '../../ui/Specimen';
import { C, space, T, touch } from '../../ui/tokens';
import { w, type Word } from '../../words';
import { RateRow } from '../rates/RateRow';
import { homeState } from '../../logic/home-state';
import { activeMaterial, MaterialTabs, RateBand } from './RateBand';
import { TopSlot } from './TopSlot';

type HomeItem =
  | { kind: 'brand'; key: 'brand' }
  | { kind: 'top'; key: 'top' }
  | { kind: 'band'; key: 'band' }
  | { kind: 'tabs'; key: 'tabs' }
  | { kind: 'state'; key: 'state' }
  | { kind: 'foot'; key: 'foot' }
  | RateItem;

/** The shop's words for a material; the name the shop typed is the fallback. */
const materialWords: Partial<Record<string, Word>> = {
  cement: 'material.cement',
  steel: 'material.steel',
  sand: 'material.sand',
  aggregates: 'material.aggregates',
  bricks: 'material.bricks',
};
const materialName = (slug: string, name: string) => {
  const word = materialWords[slug];
  return word ? w(word) : name;
};

// Changing this on the fly is not allowed, so it lives out here.
const viewability = { itemVisiblePercentThreshold: 40 };

const Brand = memo(function Brand() {
  return (
    <View style={styles.brand}>
      <Mark size={24} />
      <Text style={[T.titleStrong, styles.brandWord]} maxFontSizeMultiplier={1.3}>
        {w('app.name')}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={w('search.title')}
        onPress={() => push({ screen: 'search' })}
        style={styles.iconButton}
      >
        <Icon name="search-outline" />
      </Pressable>
    </View>
  );
});

const Heading = memo(function Heading({
  slug,
  name,
  unit,
  detailed,
}: {
  slug: string;
  name: string;
  unit: string;
  detailed: boolean;
}) {
  const title = materialName(slug, name);
  if (!detailed)
    return (
      <Text style={[T.titleLight, styles.plainHeading]} accessibilityRole="header">
        {title}
      </Text>
    );
  return (
    <View style={styles.heading}>
      <Specimen slug={slug} />
      <View style={styles.headingWords}>
        <Text style={T.head} accessibilityRole="header">
          {title}
        </Text>
        {unit ? <Text style={[T.small, styles.quiet]}>{w('home.soldBy', { unit })}</Text> : null}
      </View>
    </View>
  );
});

function Foot({ detailed }: { detailed: boolean }) {
  return (
    <View style={styles.foot}>
      <Text style={[T.small, styles.quiet]}>{w('home.deliveryNote')}</Text>
      {detailed ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => openSheet({ sheet: 'ask-shop' })}
          style={styles.footRow}
        >
          <Icon name="chatbubble-ellipses-outline" />
          <View style={styles.flex}>
            <Text style={T.bodyStrong}>{w('home.notListed')}</Text>
            <Text style={[T.small, styles.quiet]}>{w('home.notListedDetail')}</Text>
          </View>
          <Icon name="chevron-forward" size={18} />
        </Pressable>
      ) : null}
    </View>
  );
}

function RatesState() {
  const loading = useSelect(catalogStore, (state) => state.loading);
  const error = useSelect(catalogStore, (state) => state.error);
  if (loading)
    return (
      <View style={styles.skeleton} accessibilityLabel={w('common.loading')}>
        {[0, 1, 2, 3, 4].map((row) => (
          <View key={row} style={styles.skeletonRow}>
            <View style={styles.flex}>
              <Bone height={18} width="70%" />
              <View style={styles.gap} />
              <Bone height={14} width="45%" />
            </View>
            <Bone height={48} width={72} />
          </View>
        ))}
      </View>
    );
  if (error)
    return (
      <View style={styles.statePad}>
        <Empty title={w('home.firstRates')} body={error} />
        <Button onPress={() => void refreshCatalog()}>{w('common.retry')}</Button>
      </View>
    );
  return (
    <View style={styles.statePad}>
      <Empty title={w('home.noRates')} />
    </View>
  );
}

/** One list: the top slot, the rate band, sticky material tabs, then every rate. */
export function HomeScreen() {
  const products = useSelect(catalogStore, (state) => state.products);
  const categories = useSelect(catalogStore, (state) => state.categories);
  const user = useSelect(sessionStore, (state) => state.user);
  const known = useSelect(ordersStore, (state) => state.known);
  const latest = useSelect(ordersStore, (state) => state.items[0] ?? null);
  const detailed = homeState({ user, ordersKnown: known, latestOrder: latest }) === 'new';
  const [refreshing, setRefreshing] = useState(false);
  const list = useOpenAtTop<FlatList<HomeItem>>();
  const rates = useMemo(() => rateItems(products, categories), [products, categories]);
  const data = useMemo<HomeItem[]>(
    () => [
      { kind: 'brand', key: 'brand' },
      { kind: 'top', key: 'top' },
      { kind: 'band', key: 'band' },
      { kind: 'tabs', key: 'tabs' },
      ...(rates.length ? rates : [{ kind: 'state' as const, key: 'state' as const }]),
      { kind: 'foot', key: 'foot' },
    ],
    [rates],
  );
  const materials = useMemo(
    () =>
      rates.flatMap((item) =>
        item.kind === 'heading'
          ? [{ slug: item.slug, name: materialName(item.slug, item.name) }]
          : [],
      ),
    [rates],
  );
  const jump = useCallback(
    (slug: string) => {
      const index = data.findIndex((item) => item.kind === 'heading' && item.slug === slug);
      if (index < 0) return;
      activeMaterial.patch({ slug });
      list.ref.current?.scrollToIndex({ index, viewOffset: touch, animated: false });
    },
    [data, list.ref],
  );
  const renderItem = useCallback(
    ({ item }: { item: HomeItem }) => {
      switch (item.kind) {
        case 'brand':
          return <Brand />;
        case 'top':
          return <TopSlot />;
        case 'band':
          return <RateBand />;
        case 'tabs':
          return <MaterialTabs materials={materials} onJump={jump} />;
        case 'state':
          return <RatesState />;
        case 'foot':
          return <Foot detailed={detailed} />;
        case 'heading':
          return <Heading slug={item.slug} name={item.name} unit={item.unit} detailed={detailed} />;
        default:
          return <RateRow id={item.id} />;
      }
    },
    [materials, jump, detailed],
  );
  const onViewable = useRef(({ viewableItems }: { viewableItems: { item: HomeItem }[] }) => {
    const heading = viewableItems.find(({ item }) => item.kind === 'heading');
    if (heading && heading.item.kind === 'heading')
      activeMaterial.patch({ slug: heading.item.slug });
  }).current;
  return (
    <FlatList
      {...list}
      style={styles.fill}
      data={data}
      keyExtractor={(item) => item.key}
      renderItem={renderItem}
      stickyHeaderIndices={[3]}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={12}
      maxToRenderPerBatch={8}
      windowSize={9}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={viewability}
      onScrollToIndexFailed={({ index, averageItemLength }) => {
        list.ref.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
        setTimeout(() => {
          list.ref.current?.scrollToIndex({ index, viewOffset: touch, animated: false });
        }, 80);
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          colors={[C.ink]}
          onRefresh={() => {
            setRefreshing(true);
            refreshEverything();
            setTimeout(() => setRefreshing(false), 700);
          }}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.ground },
  flex: { flex: 1, minWidth: 0 },
  gap: { height: space[2] },
  quiet: { color: C.ink2 },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingLeft: space[4],
    paddingRight: space[1],
    gap: space[2],
    backgroundColor: C.ground,
  },
  brandWord: { flex: 1 },
  iconButton: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  heading: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[2],
  },
  headingWords: { flex: 1, minWidth: 0 },
  plainHeading: { paddingHorizontal: space[4], paddingTop: space[5], paddingBottom: space[1] },
  foot: { padding: space[4], gap: space[3], paddingBottom: space[6] },
  footRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: C.up,
    padding: space[3],
  },
  skeleton: { padding: space[4], gap: space[4] },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  statePad: { padding: space[4], gap: space[3] },
});
