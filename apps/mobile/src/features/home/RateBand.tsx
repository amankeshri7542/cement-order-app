import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { timeLabel } from '@shiv/shared';
import { savedAge } from '../../logic/age';
import { createStore } from '../../logic/store-core';
import { catalogStore } from '../../state/catalog';
import { checkoutStore } from '../../state/checkout';
import { openSheet } from '../../state/nav';
import { netStore } from '../../state/net';
import { sessionStore } from '../../state/session';
import { sitesStore } from '../../state/sites';
import { useSelect } from '../../state/use';
import { Icon } from '../../ui/Icon';
import { C, space, T, touch } from '../../ui/tokens';
import { w } from '../../words';

/** The tag on every rate until the family says these are the shop's real rates. */
export function SampleTag() {
  return (
    <View style={styles.sample}>
      <Text style={[T.smallStrong, { color: C.onDiya }]}>{w('rates.sample')}</Text>
    </View>
  );
}

/** Night, and only here: today's rates, how fresh they are, and where they deliver to. */
export const RateBand = memo(function RateBand() {
  const sample = useSelect(catalogStore, (state) => state.sampleRates);
  const checkedAt = useSelect(catalogStore, (state) => state.ratesCheckedAt);
  const savedAt = useSelect(catalogStore, (state) => state.savedAt);
  const online = useSelect(netStore, (state) => state.online);
  const user = useSelect(sessionStore, (state) => state.user);
  const siteId = useSelect(checkoutStore, (state) => state.draft.addressId);
  const site = useSelect(
    sitesStore,
    (state) => state.items.find((item) => item.id === siteId) ?? state.items[0],
  );
  const pincode = useSelect(sitesStore, (state) => state.pincode);
  const freshness =
    !online && savedAt
      ? w('home.offlineRates', { age: savedAge(savedAt, Date.now()) })
      : savedAt
        ? w('home.savedRates', { age: savedAge(savedAt, Date.now()) })
        : checkedAt
          ? w('home.checked', { time: timeLabel(checkedAt) })
          : '';
  const where =
    site?.label || (pincode ? w('home.deliveryTo', { pincode }) : w('home.checkDelivery'));
  return (
    <View style={styles.band}>
      <View style={styles.first}>
        <Text style={[T.head, styles.on]} accessibilityRole="header">
          {w('home.todaysRates')}
        </Text>
        {sample ? <SampleTag /> : null}
      </View>
      <View style={styles.second}>
        <Text style={[T.small, styles.quiet]} numberOfLines={2}>
          {freshness}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            openSheet(user ? { sheet: 'sites-picker', purpose: 'browse' } : { sheet: 'pincode' })
          }
          style={styles.site}
        >
          <Icon name="location-outline" size={18} color={C.onNight} />
          <Text style={[T.small, styles.on, styles.siteWord]} numberOfLines={1}>
            {where}
          </Text>
          <Icon name="chevron-forward" size={16} color={C.onNight} />
        </Pressable>
      </View>
    </View>
  );
});

/** Sticks when scrolled: a 140 dp sticky band is too much on a small phone. */
export const activeMaterial = createStore({ slug: '' });

export function MaterialTabs({
  materials,
  onJump,
}: {
  materials: { slug: string; name: string }[];
  onJump: (slug: string) => void;
}) {
  const chosen = useSelect(activeMaterial, (state) => state.slug);
  const active = chosen || materials[0]?.slug || '';
  return (
    <View style={styles.tabs}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {materials.map((item) => {
          const on = item.slug === active;
          return (
            <Pressable
              key={item.slug}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              aria-selected={on}
              onPress={() => onJump(item.slug)}
              style={styles.tab}
            >
              <Text style={[on ? T.bodyStrong : T.body, on ? styles.on : styles.quiet]}>
                {item.name}
              </Text>
              <View style={[styles.mark, on && styles.markOn]} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    backgroundColor: C.night,
    paddingHorizontal: space[4],
    paddingTop: space[3],
    gap: space[1],
  },
  first: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  second: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
    minHeight: touch,
  },
  on: { color: C.onNight },
  quiet: { color: C.onNight2, flexShrink: 1 },
  sample: {
    backgroundColor: C.diya,
    paddingHorizontal: space[2],
    paddingVertical: 3,
    borderRadius: 2,
  },
  site: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    minHeight: touch,
    maxWidth: '62%',
  },
  siteWord: { flexShrink: 1 },
  tabs: { backgroundColor: C.night, paddingHorizontal: space[1] },
  tab: { minHeight: touch, paddingHorizontal: space[3], justifyContent: 'center' },
  mark: { position: 'absolute', left: space[3], right: space[3], bottom: 5, height: 2 },
  markOn: { backgroundColor: C.onNight },
});
