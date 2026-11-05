import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { orderStatusText } from '@shiv/shared';
import { C, space, T } from './tokens';

const tones: Record<string, { color: string; square: string }> = {
  AWAITING_CONFIRMATION: { color: C.warn, square: C.diya },
  PENDING_PAYMENT: { color: C.warn, square: C.diya },
  CONFIRMED: { color: C.ok, square: C.ok },
  PREPARING: { color: C.ok, square: C.ok },
  OUT_FOR_DELIVERY: { color: C.ok, square: C.ok },
  DELIVERED: { color: C.ink, square: C.ink },
  DELIVERY_EXCEPTION: { color: C.danger, square: C.danger },
  CANCELLED: { color: C.danger, square: C.danger },
  REFUND_PENDING: { color: C.danger, square: C.danger },
  REFUNDED: { color: C.ink2, square: C.ink2 },
};

/** Status is a word and a small square, never colour alone. */
export const StatusTag = memo(function StatusTag({ status }: { status: string }) {
  const tone = tones[status] ?? { color: C.ink2, square: C.ink2 };
  return (
    <View style={styles.tag}>
      <View style={[styles.square, { backgroundColor: tone.square }]} />
      <Text style={[T.bodyStrong, styles.word, { color: tone.color }]}>
        {orderStatusText(status, 'en')}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  tag: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 1 },
  square: { width: 10, height: 10 },
  word: { flexShrink: 1 },
});
