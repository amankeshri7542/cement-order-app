import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { money } from '../../logic/money';
import { catalogStore } from '../../state/catalog';
import { listStore, listSummary } from '../../state/list';
import { openSheet } from '../../state/nav';
import { useSelect } from '../../state/use';
import { Icon } from '../../ui/Icon';
import { ease, nativeDriver, reducedMotion } from '../../ui/motion';
import { C, motion, radius, space, T } from '../../ui/tokens';
import { useKeyboardHeight } from '../../ui/useKeyboard';
import { w } from '../../words';

const OLD_RATES_MS = 24 * 60 * 60 * 1000;

/**
 * Exists only when there is a list. It takes its own space when it rises, so it never covers a row,
 * and steps aside for the keyboard.
 */
export function ListBar() {
  const lines = useSelect(listStore, (state) => state.lines);
  const savedAt = useSelect(catalogStore, (state) => state.savedAt);
  useSelect(catalogStore, (state) => state.byId);
  const typing = useKeyboardHeight() > 0;
  const rise = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const count = lines.length;
  const before = useRef(count);
  useEffect(() => {
    if (count > before.current && before.current === 0) ease(rise, 1, motion.ui);
    else if (count > 0) rise.setValue(1);
    if (count > before.current && !reducedMotion()) {
      pop.setValue(1.5);
      Animated.spring(pop, {
        toValue: 1,
        ...motion.springPress,
        useNativeDriver: nativeDriver,
      }).start();
    }
    before.current = count;
  }, [count, rise, pop]);
  if (!count || typing) return null;
  const { totalPaise, whole } = listSummary(lines);
  // A total worked out from rates over a day old is only "about".
  const stale = savedAt !== null && Date.now() - savedAt > OLD_RATES_MS;
  const shown = money(totalPaise);
  return (
    <Animated.View
      style={{
        opacity: rise,
        transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [56, 0] }) }],
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={w('list.barLabel', { count, total: shown })}
        onPress={() => openSheet({ sheet: 'list' })}
        style={styles.bar}
        testID="list-bar"
      >
        <Animated.View style={[styles.count, { transform: [{ scale: pop }] }]}>
          <Text style={[T.bodyStrong, { color: C.onDiya }]} maxFontSizeMultiplier={1.3}>
            {count}
          </Text>
        </Animated.View>
        <Text style={[T.body, styles.word]}>{w('list.title')}</Text>
        <View style={styles.right}>
          <Text style={[T.rate, styles.total]} maxFontSizeMultiplier={1.3}>
            {stale || !whole ? `${w('list.about')} ${shown}` : shown}
          </Text>
          <Icon name="chevron-forward" size={18} color={C.onNight} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: space[4],
    gap: space[3],
    backgroundColor: C.night,
  },
  count: {
    minWidth: 30,
    height: 30,
    paddingHorizontal: space[1],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    backgroundColor: C.diya,
  },
  word: { flex: 1, color: C.onNight },
  right: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  total: { color: C.onNight },
});
