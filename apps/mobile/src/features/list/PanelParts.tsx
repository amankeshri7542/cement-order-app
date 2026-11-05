import { Pressable, StyleSheet, Text } from 'react-native';
import {
  dayLabel,
  istToday,
  shortDayLabel,
  whatsappListLink,
  whatsappListText,
} from '@shiv/shared';
import type { ListLine } from '../../logic/list-core';
import type { CatalogProduct } from '../../logic/types';
import { dayAfter } from '../../logic/panel-core';
import { clearList } from '../../state/list';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { useSheetClose } from '../../ui/Sheet';
import { C, space, T, touch } from '../../ui/tokens';
import { w } from '../../words';

export function ChoiceRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      disabled={!onPress}
      onPress={onPress}
      style={panelStyles.choice}
    >
      <Text style={[T.small, panelStyles.choiceLabel]}>{label}</Text>
      <Text style={[T.body, panelStyles.flex]} numberOfLines={2}>
        {value}
      </Text>
      {onPress ? <Icon name="chevron-forward" size={18} /> : null}
    </Pressable>
  );
}

export const friendlyDay = (date: string) => {
  const today = istToday();
  if (date === today) return w('panel.today', { day: shortDayLabel(date, 'en') });
  if (date === dayAfter(today)) return w('panel.tomorrow', { day: shortDayLabel(date, 'en') });
  return dayLabel(date, 'en');
};

export function ClearAfterWhatsApp({ onDone }: { onDone: () => void }) {
  const close = useSheetClose();
  return (
    <Button
      kind="link"
      onPress={() => {
        clearList();
        onDone();
        close();
      }}
    >
      {w('panel.clearList')}
    </Button>
  );
}

/** The list as a WhatsApp message: Roman script and no prices. Null hides the button. */
export function listLink(
  whatsapp: string,
  lines: ListLine[],
  byId: Record<string, CatalogProduct>,
  site?: string,
) {
  const rows = lines.flatMap((line) => {
    const product = byId[line.productId];
    return product ? [{ name: product.name, unit: product.unit, quantity: line.quantity }] : [];
  });
  return whatsappListLink(whatsapp, whatsappListText(rows, site));
}

export const panelStyles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: C.up,
    minHeight: touch + 4,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  choiceLabel: { width: 82, color: C.ink2 },
});
