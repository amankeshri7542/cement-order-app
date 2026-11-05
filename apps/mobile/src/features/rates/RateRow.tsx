import { memo, useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { money } from '../../logic/money';
import { offerFor, rateToShow, rowDetail } from '../../logic/rates';
import { catalogStore } from '../../state/catalog';
import { addToList, listStore, setQuantity } from '../../state/list';
import { push } from '../../state/nav';
import { showToast } from '../../state/ui';
import { useSelect } from '../../state/use';
import { Icon } from '../../ui/Icon';
import { Press } from '../../ui/Press';
import { Stepper } from '../../ui/Stepper';
import { C, radius, space, T, touch } from '../../ui/tokens';
import { w } from '../../words';

/**
 * One rate: name, grade and unit, rate, Add. It reads its own quantity and rate through selectors, so
 * an Add re-renders this row and the bar, nothing else. Add never says no: stock is checked on the
 * panel. Nothing here shows a stock figure.
 */
export const RateRow = memo(function RateRow({ id }: { id: string }) {
  const product = useSelect(catalogStore, (state) => state.byId[id]);
  const mine = useSelect(catalogStore, (state) => state.myRates[id]);
  const quantity = useSelect(listStore, (state) => state.quantity[id] ?? 0);
  const offer = useSelect(catalogStore, (state) =>
    state.offers.length && state.byId[id]
      ? offerFor(state.byId[id], state.offers, (slug) => state.categoryIds[slug])
      : null,
  );
  const open = useCallback(() => push({ screen: 'product', id }), [id]);
  const change = useCallback((next: number) => setQuantity(id, next), [id]);
  if (!product) return null;
  const rate = rateToShow(product, mine);
  const label = w('rates.rowLabel', {
    name: product.name,
    rate: rate.paise === null ? w('rates.askRate') : money(rate.paise),
    unit: product.unit,
  });
  return (
    <View style={styles.row} testID={`product-${id}`}>
      <View style={styles.top}>
        <Press
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={open}
          scale={0.99}
          style={styles.main}
        >
          <Text style={T.body} numberOfLines={2}>
            {product.name}
          </Text>
          <Text style={[T.small, styles.quiet]} numberOfLines={2}>
            {rowDetail(product)}
          </Text>
          {rate.yours ? (
            <Text style={[T.small, styles.yours]}>
              {w('rates.yourRate', { list: money(rate.listPaise!) })}
            </Text>
          ) : null}
          {offer ? (
            <Text style={[T.small, styles.offer]} numberOfLines={2}>
              {offer.title}
            </Text>
          ) : null}
        </Press>
        <Text style={rate.paise === null ? styles.noRate : T.rate}>
          {rate.paise === null ? w('rates.askRate') : money(rate.paise)}
        </Text>
        {quantity > 0 ? (
          <View accessibilityLabel={w('rates.added')} style={[styles.add, styles.added]}>
            <Icon name="checkmark" size={16} color={C.onDiya} />
            <Text style={[T.smallStrong, { color: C.onDiya }]}>{w('rates.added')}</Text>
          </View>
        ) : (
          <Press
            accessibilityRole="button"
            accessibilityLabel={w('rates.addLabel', { name: product.name })}
            onPress={() => addToList(product)}
            style={styles.add}
          >
            <Text style={T.bodyStrong}>{w('rates.add')}</Text>
          </Press>
        )}
      </View>
      {quantity > 0 ? (
        <View style={styles.bottom}>
          <Stepper
            name={product.name}
            value={quantity}
            min={product.minQuantity}
            step={product.quantityStep}
            onChange={change}
            onInvalid={showToast}
          />
          <Text style={[T.small, styles.unit]} numberOfLines={1}>
            {product.unit}
          </Text>
          {rate.paise !== null ? (
            <Text style={T.rateSmall}>{money(rate.paise * quantity)}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.rule,
    backgroundColor: C.ground,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 56 },
  main: { flex: 1, minWidth: 0, justifyContent: 'center', minHeight: touch },
  quiet: { color: C.ink2 },
  yours: { color: C.ok },
  offer: { color: C.diyaInk },
  noRate: { ...T.small, color: C.ink2, maxWidth: 72, textAlign: 'right' },
  add: {
    width: 72,
    minHeight: touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    backgroundColor: C.down,
  },
  added: { backgroundColor: C.diya, flexDirection: 'row', gap: 2 },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[1] },
  unit: { flex: 1, color: C.ink2 },
});
