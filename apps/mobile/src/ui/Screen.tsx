import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { back } from '../state/nav';
import { w } from '../words';
import { Icon } from './Icon';
import { C, headingScale, space, T, touch } from './tokens';

/**
 * A phone that has not been touched yet (a keyboard is attached, or a test started the app) hands
 * its first focus to whichever view appears first, and a scroll view scrolls to its focused child:
 * Home opened half way down the page. Until the customer first touches the list, a new screen stays
 * at the top. This fixed a real launch bug.
 */
export function useOpenAtTop<
  T extends {
    scrollTo?: (at: { y: number; animated: boolean }) => void;
    scrollToOffset?: (at: { offset: number; animated: boolean }) => void;
  },
>() {
  const list = useRef<T>(null);
  const touched = useRef(false);
  const [settling, setSettling] = useState(Platform.OS === 'android');
  useEffect(() => {
    if (!settling) return;
    const timer = setTimeout(() => setSettling(false), 2000);
    return () => clearTimeout(timer);
  }, [settling]);
  return {
    ref: list,
    onTouchStart: () => {
      touched.current = true;
    },
    onScrollBeginDrag: () => {
      touched.current = true;
    },
    scrollEventThrottle: settling ? 16 : undefined,
    onScroll: settling
      ? (event: NativeSyntheticEvent<NativeScrollEvent>) => {
          if (touched.current || event.nativeEvent.contentOffset.y <= 0) return;
          list.current?.scrollTo?.({ y: 0, animated: false });
          list.current?.scrollToOffset?.({ offset: 0, animated: false });
        }
      : undefined,
  };
}

/** The bar on a pushed screen: back, a title, and at most one action. */
export function TopBar({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={w('common.back')}
        onPress={() => back()}
        style={styles.barButton}
      >
        <Icon name="arrow-back" />
      </Pressable>
      <Text
        style={[T.title, styles.barTitle]}
        accessibilityRole="header"
        numberOfLines={1}
        maxFontSizeMultiplier={headingScale}
      >
        {title}
      </Text>
      {right}
    </View>
  );
}

/** Every screen's scroll container; `footer` stays pinned so the main action never scrolls away. */
export function Screen({
  children,
  footer,
  refreshing = false,
  onRefresh,
  topBar,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  topBar?: React.ReactNode;
}) {
  const openAtTop = useOpenAtTop<ScrollView>();
  return (
    <View style={styles.fill}>
      {topBar}
      <ScrollView
        {...openAtTop}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[C.ink]}
              tintColor={C.ink}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.ground },
  content: { padding: space[4], paddingBottom: space[6], gap: space[4] },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingLeft: space[1],
    paddingRight: space[1],
    backgroundColor: C.ground,
  },
  barButton: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  barTitle: { flex: 1, marginLeft: space[1] },
  footer: {
    backgroundColor: C.up,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    gap: space[2],
  },
});
