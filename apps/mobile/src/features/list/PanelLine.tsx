import { memo, useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { type ReviewLeftOut } from '@shiv/shared';
import { money } from '../../logic/money';
import { leftOutWord } from '../../logic/panel-core';
import { catalogStore } from '../../state/catalog';
import { showToast } from '../../state/ui';
import { useSelect } from '../../state/use';
import { ease, reducedMotion } from '../../ui/motion';
import { Stepper } from '../../ui/Stepper';
import { C, space, T, touch } from '../../ui/tokens';
import { w, type Word } from '../../words';

const leftOutWords: Record<ReturnType<typeof leftOutWord>, Word> = {
  notSold: 'panel.notSold',
  quantity: 'panel.badQuantity',
  askShop: 'panel.askShop',
};

/** A line in the panel: swipe left to remove, or step it down to 0, which always works. */
export const PanelLine = memo(function PanelLine({
  productId,
  name: oldName,
  unit: oldUnit,
  quantity,
  rate,
  was,
  leftOut,
  off,
  onChange,
}: {
  productId: string;
  name?: string;
  unit?: string;
  quantity: number;
  rate: number | null;
  was?: number;
  leftOut?: ReviewLeftOut;
  /** A guest's line the shop said no to. */
  off?: boolean;
  onChange: (productId: string, quantity: number) => void;
}) {
  const product = useSelect(catalogStore, (state) => state.byId[productId]);
  const name = product?.name ?? oldName ?? w('panel.oldItem');
  const unit = product?.unit ?? oldUnit ?? '';
  const slide = useRef(new Animated.Value(0)).current;
  const drag = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dx < -14 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
        onPanResponderMove: (_, gesture) => slide.setValue(Math.min(0, gesture.dx)),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx < -110) {
            if (reducedMotion()) onChange(productId, 0);
            else ease(slide, -500, 140, () => onChange(productId, 0));
          } else ease(slide, 0, 140);
        },
        onPanResponderTerminate: () => ease(slide, 0, 140),
      }),
    [slide, onChange, productId],
  );
  const gone = Boolean(leftOut) || off;
  return (
    <Animated.View
      {...drag.panHandlers}
      style={[styles.line, { transform: [{ translateX: slide }] }]}
      testID={`panel-${productId}`}
    >
      <View style={styles.top}>
        <View style={styles.words}>
          <Text style={[T.body, gone && styles.struck]} numberOfLines={2}>
            {name}
          </Text>
          {rate !== null ? (
            <Text style={[T.small, styles.quiet]} numberOfLines={2}>
              {money(rate)} / {unit}
            </Text>
          ) : (
            <Text style={[T.small, styles.quiet]}>{unit}</Text>
          )}
          {was !== undefined ? (
            <Text style={[T.small, styles.changed]}>
              {w('panel.rateChanged', { was: money(was) })}
            </Text>
          ) : null}
          {leftOut ? (
            <Text style={[T.small, styles.changed]}>
              {w(leftOutWords[leftOutWord(leftOut.reason)], {
                min: leftOut.minQuantity ?? 1,
                step: leftOut.quantityStep ?? 1,
              })}
            </Text>
          ) : off ? (
            <Text style={[T.small, styles.changed]}>{w('panel.askShop')}</Text>
          ) : null}
        </View>
        {leftOut?.reason === 'NOT_SOLD' ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onChange(productId, 0)}
            style={styles.remove}
          >
            <Text style={[T.small, styles.link]}>{w('panel.remove')}</Text>
          </Pressable>
        ) : (
          <Stepper
            name={name}
            value={quantity}
            min={product?.minQuantity ?? leftOut?.minQuantity ?? 1}
            step={product?.quantityStep ?? leftOut?.quantityStep ?? 1}
            onChange={(next) => onChange(productId, next)}
            onInvalid={showToast}
          />
        )}
      </View>
      {rate !== null && !gone ? (
        <Text style={[T.rateSmall, styles.total]}>{money(rate * quantity)}</Text>
      ) : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  line: {
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.rule,
    backgroundColor: C.ground,
    gap: space[1],
  },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  words: { flex: 1, minWidth: 0 },
  struck: { textDecorationLine: 'line-through', color: C.ink2 },
  quiet: { color: C.ink2 },
  changed: { color: C.diyaInk },
  total: { textAlign: 'right' },
  remove: { minHeight: touch, justifyContent: 'center' },
  link: { textDecorationLine: 'underline' },
});
