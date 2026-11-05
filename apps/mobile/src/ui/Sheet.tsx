import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { w } from '../words';
import { Icon } from './Icon';
import { ease, nativeDriver, reducedMotion } from './motion';
import { C, headingScale, motion, radius, space, T, touch } from './tokens';
import { Toast } from './Toast';
import { useKeyboardHeight } from './useKeyboard';

const SheetClose = createContext<() => void>(() => {});
/** Closes the sheet this is inside, with its motion. */
export const useSheetClose = () => useContext(SheetClose);

/**
 * The one sheet: the list panel, sites and sign-in. A real window, so TalkBack stays inside and the
 * back button closes it; drag the handle down to dismiss. Scrolling inside never fights the drag,
 * because only the handle and title start one. Typed fields stay above the keyboard.
 */
export function Sheet({
  title,
  onClosed,
  children,
  footer,
  closeLabel,
}: {
  title: string;
  /** Called once the sheet has left the screen. */
  onClosed: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  closeLabel?: string;
}) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const height = useRef(Dimensions.get('window').height).current;
  const travel = useRef(new Animated.Value(reducedMotion() ? 0 : height)).current;
  const scrim = useRef(new Animated.Value(reducedMotion() ? 1 : 0)).current;
  const closing = useRef(false);
  const close = useRef(() => {
    if (closing.current) return;
    closing.current = true;
    ease(scrim, 0, motion.ui);
    ease(travel, height, motion.ui, () => onClosedRef.current());
  }).current;
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  useEffect(() => {
    ease(scrim, 1, motion.sheet);
    ease(travel, 0, motion.sheet);
  }, [scrim, travel]);
  const drag = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => travel.setValue(Math.max(0, gesture.dy)),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 96 || gesture.vy > 0.8) close();
          else
            Animated.spring(travel, {
              toValue: 0,
              damping: 28,
              stiffness: 240,
              mass: 1,
              useNativeDriver: nativeDriver,
            }).start();
        },
      }),
    [travel, close],
  );
  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      {/* A modal has its own window, so Android's resize for the keyboard does not reach it. */}
      <View style={[styles.fill, { paddingBottom: keyboard }]}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: scrim }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={closeLabel ?? w('common.close')}
            onPress={close}
            style={styles.fill}
          />
        </Animated.View>
        <Animated.View style={[styles.sheet, { transform: [{ translateY: travel }] }]}>
          {/* Paper below the sheet, so nothing shows under it if a keyboard's height lingers. */}
          <View pointerEvents="none" style={[styles.below, footer ? styles.belowFooter : null]} />
          <View {...drag.panHandlers} style={styles.top}>
            <View style={styles.handle} />
            <View style={styles.titleRow}>
              <Text
                style={[T.head, styles.title]}
                accessibilityRole="header"
                maxFontSizeMultiplier={headingScale}
              >
                {title}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={closeLabel ?? w('common.close')}
                onPress={close}
                style={styles.close}
              >
                <Icon name="close" />
              </Pressable>
            </View>
          </View>
          <SheetClose.Provider value={close}>
            <View style={styles.body}>{children}</View>
            {footer ? (
              <View
                style={[
                  styles.footer,
                  { paddingBottom: keyboard ? space[2] : insets.bottom + space[3] },
                ]}
              >
                {footer}
              </View>
            ) : (
              <View style={{ height: keyboard ? 0 : insets.bottom }} />
            )}
          </SheetClose.Provider>
        </Animated.View>
        {/* A sheet is its own window, so a message about it has to appear inside it. */}
        <Toast />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: C.scrim },
  sheet: {
    // Of the room above the keyboard, so a typed field and its sheet always fit.
    maxHeight: '94%',
    backgroundColor: C.ground,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  below: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    height: 240,
    backgroundColor: C.ground,
  },
  belowFooter: { backgroundColor: C.up },
  top: { paddingTop: space[2] },
  handle: {
    alignSelf: 'center',
    width: 32,
    height: 3,
    borderRadius: 2,
    backgroundColor: C.ink2,
    opacity: 0.5,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space[4],
    paddingRight: space[1],
    minHeight: touch + 8,
  },
  title: { flex: 1 },
  close: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  body: { flexShrink: 1 },
  footer: {
    backgroundColor: C.up,
    paddingHorizontal: space[4],
    paddingTop: space[3],
    gap: space[2],
  },
});
