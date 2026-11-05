import { useState } from 'react';
import { Image, Share, StyleSheet, Text, View } from 'react-native';
import { money } from '../../logic/money';
import { orderRule, packLine } from '../../logic/pack';
import { rateToShow } from '../../logic/rates';
import { homeState } from '../../logic/home-state';
import { ask } from '../../state/ask';
import { catalogStore } from '../../state/catalog';
import { addToList, listStore, setQuantity } from '../../state/list';
import { back, goToTab, openSheet } from '../../state/nav';
import { ordersStore } from '../../state/orders';
import { sessionStore } from '../../state/session';
import { showToast } from '../../state/ui';
import { useSelect } from '../../state/use';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Empty, Notice } from '../../ui/Notice';
import { Press } from '../../ui/Press';
import { Screen, TopBar } from '../../ui/Screen';
import { Specimen } from '../../ui/Specimen';
import { Stepper } from '../../ui/Stepper';
import { C, headingScale, space, T, touch } from '../../ui/tokens';
import { w } from '../../words';
import { SampleTag } from '../home/RateBand';

const siteUrl = process.env.EXPO_PUBLIC_SITE_URL;

/** One drawing or the shop's real photo, the rate beside its unit, and a fixed footer. */
export function ProductScreen({ id }: { id: string }) {
  const product = useSelect(catalogStore, (state) => state.byId[id]);
  const mine = useSelect(catalogStore, (state) => state.myRates[id]);
  const sample = useSelect(catalogStore, (state) => state.sampleRates);
  const askEnabled = useSelect(catalogStore, (state) => state.askEnabled);
  const quantity = useSelect(listStore, (state) => state.quantity[id] ?? 0);
  const user = useSelect(sessionStore, (state) => state.user);
  const known = useSelect(ordersStore, (state) => state.known);
  const latest = useSelect(ordersStore, (state) => state.items[0] ?? null);
  const [photoFailed, setPhotoFailed] = useState(false);
  if (!product)
    return (
      <Screen topBar={<TopBar title="" />}>
        <Empty title={w('product.gone')} action={w('common.back')} onAction={() => back()} />
      </Screen>
    );
  const rate = rateToShow(product, mine);
  const photo = product.images[0];
  const isNew = homeState({ user, ordersKnown: known, latestOrder: latest }) === 'new';
  const facts: [string, string][] = (
    [
      [w('product.type'), product.type],
      [w('product.grade'), product.grade],
      [w('product.brand'), product.brand],
      [w('product.pack'), packLine(product) || product.packSize || product.unit],
      [w('product.order'), orderRule(product)],
    ] as [string, string][]
  ).filter(([, value]) => value);
  return (
    <Screen
      topBar={
        <TopBar
          title={product.name}
          right={
            siteUrl ? (
              <Press
                accessibilityRole="button"
                accessibilityLabel={w('common.share')}
                onPress={() =>
                  // A website link and no price: rates change, and a message can be forwarded.
                  void Share.share({ message: `${product.name}\n${siteUrl}/products/${id}` }).catch(
                    () => {},
                  )
                }
                style={styles.icon}
              >
                <Icon name="share-social-outline" />
              </Press>
            ) : null
          }
        />
      }
      footer={
        quantity > 0 ? (
          <>
            <View style={styles.footerRow}>
              <Stepper
                name={product.name}
                value={quantity}
                min={product.minQuantity}
                step={product.quantityStep}
                onChange={(next) => setQuantity(id, next)}
                onInvalid={showToast}
              />
              {rate.paise !== null ? (
                <Text style={T.rate}>{money(rate.paise * quantity)}</Text>
              ) : null}
            </View>
            <Button kind="lamp" onPress={() => openSheet({ sheet: 'list' })}>
              {w('product.seeList')}
            </Button>
          </>
        ) : (
          <Button kind="lamp" onPress={() => addToList(product)}>
            {rate.paise === null
              ? w('rates.add')
              : w('product.add', { amount: money(rate.paise * product.minQuantity) })}
          </Button>
        )
      }
    >
      <View style={styles.art}>
        {photo && !photoFailed ? (
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: photo }}
            resizeMode="contain"
            onError={() => setPhotoFailed(true)}
            style={styles.photo}
          />
        ) : (
          <Specimen slug={product.categorySlug} size={180} />
        )}
      </View>
      <Text style={T.display} accessibilityRole="header" maxFontSizeMultiplier={headingScale}>
        {product.name}
      </Text>
      <View style={styles.rate}>
        {rate.paise === null ? (
          <Text style={[T.title, styles.quiet]}>{w('rates.askRate')}</Text>
        ) : (
          <>
            <Text style={T.rateBig} maxFontSizeMultiplier={1.4}>
              {money(rate.paise)}
            </Text>
            <Text style={[T.body, styles.flex]}>/ {product.unit}</Text>
          </>
        )}
        {sample ? <SampleTag /> : null}
      </View>
      {rate.yours ? (
        <Text style={[T.small, { color: C.ok }]}>
          {w('rates.yourRate', { list: money(rate.listPaise!) })}
        </Text>
      ) : null}
      {product.availability !== 'IN_STOCK' ? (
        <Notice tone="warn">{w('product.askFirst')}</Notice>
      ) : null}
      <View style={styles.facts}>
        {facts.map(([label, value]) => (
          <View key={label} style={styles.fact}>
            <Text style={[T.small, styles.factLabel]}>{label}</Text>
            <Text style={[T.body, styles.flex]}>{value}</Text>
          </View>
        ))}
      </View>
      {product.description ? (
        <Text style={[T.body, styles.quiet]}>{product.description}</Text>
      ) : null}
      {product.recommendedUse ? (
        <Text style={[T.body, styles.quiet]}>{product.recommendedUse}</Text>
      ) : null}
      {isNew && askEnabled ? (
        <Button
          kind="link"
          onPress={() => {
            goToTab('ask');
            void ask(w('product.askQuestion', { name: product.name }), id);
          }}
        >
          {w('product.notSure')}
        </Button>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  art: { alignItems: 'center', minHeight: 120 },
  photo: { width: '100%', height: 200, backgroundColor: C.up },
  rate: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 0 },
  quiet: { color: C.ink2 },
  facts: { backgroundColor: C.up, paddingHorizontal: space[3] },
  fact: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space[3],
    paddingVertical: space[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.rule,
  },
  factLabel: { width: 72, color: C.ink2 },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  icon: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
});
