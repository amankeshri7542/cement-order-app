import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from './tokens';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** Ionicons outline, 22 dp, ink. No filled circles. */
export function Icon({
  name,
  color = C.ink,
  size = 22,
}: {
  name: IconName;
  color?: string;
  size?: number;
}) {
  return <Ionicons name={name} color={color} size={size} aria-hidden accessible={false} />;
}

/**
 * The mark: three starter bars on a slab, the sariya left on the roof for the next floor. Built from
 * plain views so it needs no drawing library and stays sharp at any size.
 */
export function Mark({ size = 22, color = C.ink }: { size?: number; color?: string }) {
  const u = size / 32;
  const bar = (left: number, top: number, width: number, height: number) => ({
    position: 'absolute' as const,
    left: left * u,
    top: top * u,
    width: width * u,
    height: height * u,
    backgroundColor: color,
  });
  return (
    <View accessible={false} style={[styles.mark, { width: size, height: size }]}>
      <View style={bar(3, 24, 26, 5)} />
      <View style={bar(14.4, 3.6, 3.2, 20.4)} />
      <View style={bar(5.7, 9.4, 3.2, 14.6)} />
      <View style={bar(2.6, 9.4, 6.3, 2.9)} />
      <View style={bar(23.1, 9.4, 3.2, 14.6)} />
      <View style={bar(23.1, 9.4, 6.3, 2.9)} />
    </View>
  );
}
const styles = StyleSheet.create({ mark: { flexShrink: 0 } });
