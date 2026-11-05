import { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { ease } from '../../ui/motion';
import { tractorPlate } from '../../ui/Specimen';
import { C, motion, space, T } from '../../ui/tokens';
import { w } from '../../words';

/** Which stop an order is at. Off-road statuses have no stop: the page explains itself instead. */
export const stopOf = (status: string): number | null => {
  const stops: Record<string, number> = {
    AWAITING_CONFIRMATION: 0,
    CONFIRMED: 1,
    PREPARING: 1,
    OUT_FOR_DELIVERY: 2,
    DELIVERED: 3,
  };
  return stops[status] ?? null;
};

/**
 * The status line with the tractor: Waiting, Confirmed, On the way, Delivered. It moves one stop, and
 * only when the status really changes. A delivery problem stops the tractor where it was. No time is
 * ever promised here.
 */
export function StatusLine({ status }: { status: string }) {
  const stop = stopOf(status);
  const [width, setWidth] = useState(0);
  const at = useRef(new Animated.Value(0)).current;
  const shown = stop ?? 2;
  const lastStop = useRef<number | null>(null);
  useEffect(() => {
    if (!width) return;
    const to = (shown / 3) * Math.max(0, width - tractorWidth);
    if (lastStop.current === null) at.setValue(to);
    else if (lastStop.current !== shown) ease(at, to, motion.confirm);
    lastStop.current = shown;
  }, [shown, width, at]);
  const words = [
    w('status.waiting'),
    w('status.confirmed'),
    w('status.onWay'),
    w('status.delivered'),
  ];
  return (
    <View
      accessible
      accessibilityLabel={stop === null ? undefined : w('status.line', { stop: words[stop]! })}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
    >
      <Animated.View style={{ transform: [{ translateX: at }] }}>
        <Image source={tractorPlate} resizeMode="contain" style={styles.tractor} />
      </Animated.View>
      <View style={styles.rule} />
      <View style={styles.stops}>
        {words.map((word, index) => (
          <Text
            key={word}
            style={[
              index === stop ? T.smallStrong : T.small,
              index === stop ? null : styles.quiet,
              index === 3 ? styles.right : null,
            ]}
            numberOfLines={1}
          >
            {word}
          </Text>
        ))}
      </View>
    </View>
  );
}

const tractorWidth = 96;
const styles = StyleSheet.create({
  tractor: { width: tractorWidth, height: 48 },
  rule: { height: 2, backgroundColor: C.rule },
  stops: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: space[1],
    gap: space[1],
  },
  quiet: { color: C.ink2 },
  right: { textAlign: 'right' },
});
