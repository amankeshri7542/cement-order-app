import { useRef } from 'react';
import {
  Animated,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { nativeDriver, reducedMotion } from './motion';
import { motion } from './tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Every button and row control: a press scales to 0.97 on the native side, from onPressIn. Pressable
 * keeps the click action TalkBack's double tap relies on.
 */
export function Press({
  style,
  scale = 0.97,
  onPressIn,
  onPressOut,
  children,
  ...props
}: Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  scale?: number;
  children?: React.ReactNode;
}) {
  const value = useRef(new Animated.Value(1)).current;
  const to = (toValue: number) =>
    Animated.spring(value, {
      toValue,
      ...motion.springPress,
      useNativeDriver: nativeDriver,
    }).start();
  return (
    <AnimatedPressable
      {...props}
      style={[style, { transform: [{ scale: value }] }]}
      onPressIn={(event) => {
        if (!reducedMotion()) to(scale);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        if (!reducedMotion()) to(1);
        onPressOut?.(event);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}
