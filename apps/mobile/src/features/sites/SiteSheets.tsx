import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { deliveryDateOptions } from '@shiv/shared';
import { money } from '../../logic/money';
import { checkoutStore, updateDraft } from '../../state/checkout';
import { closeSheet, openSheet } from '../../state/nav';
import { say } from '../../state/net';
import { checkPincode, rememberPincode, sitesStore } from '../../state/sites';
import { useSelect } from '../../state/use';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Notice } from '../../ui/Notice';
import { Sheet, useSheetClose } from '../../ui/Sheet';
import { C, radius, space, T, touch } from '../../ui/tokens';
import { w } from '../../words';
import { deliverHereWords } from './deliver-words';
import { friendlyDay } from '../list/PanelParts';

/** The one sites sheet: last used first, with who receives it and the delivery cost. */
export function SitesPicker({
  purpose,
  onClosed,
}: {
  purpose: 'panel' | 'browse';
  onClosed: () => void;
}) {
  const sites = useSelect(sitesStore, (state) => state.items);
  const answers = useSelect(sitesStore, (state) => state.answers);
  const current = useSelect(checkoutStore, (state) =>
    purpose === 'panel' ? (state.panelSite ?? state.draft.addressId) : state.draft.addressId,
  );
  useEffect(() => {
    for (const pincode of new Set(sites.map((site) => site.pincode)))
      if (!answers[pincode]) void checkPincode(pincode).catch(() => {});
  }, [sites]);
  return (
    <Sheet title={w('sites.title')} onClosed={onClosed}>
      <ScrollView contentContainerStyle={styles.body}>
        <Rows purpose={purpose} current={current} />
        <Button kind="line" icon="add" onPress={() => openSheet({ sheet: 'site-form', purpose })}>
          {w('sites.add')}
        </Button>
      </ScrollView>
    </Sheet>
  );
}

function Rows({ purpose, current }: { purpose: 'panel' | 'browse'; current: string }) {
  const close = useSheetClose();
  const sites = useSelect(sitesStore, (state) => state.items);
  const answers = useSelect(sitesStore, (state) => state.answers);
  return (
    <View style={styles.rows}>
      {sites.map((site) => {
        const chosen = site.id === current || (!current && site === sites[0]);
        const zone = answers[site.pincode]?.zone;
        return (
          <Pressable
            key={site.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: chosen }}
            aria-checked={chosen}
            onPress={() => {
              if (purpose === 'panel') checkoutStore.patch({ panelSite: site.id });
              else updateDraft({ addressId: site.id });
              close();
            }}
            style={styles.row}
          >
            <Icon name={chosen ? 'radio-button-on' : 'radio-button-off'} />
            <View style={styles.flex}>
              <Text style={T.body} numberOfLines={1}>
                {site.label}
              </Text>
              <Text style={[T.small, styles.quiet]} numberOfLines={2}>
                {site.name}
                {zone
                  ? ` · ${w('sites.deliveryCost', { cost: money(zone.deliveryFeePaise) })}`
                  : ''}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={w('sites.editLabel', { site: site.label })}
              onPress={() => openSheet({ sheet: 'site-form', id: site.id, purpose })}
              style={styles.edit}
            >
              <Icon name="create-outline" />
            </Pressable>
          </Pressable>
        );
      })}
    </View>
  );
}

/** For a guest, the same sheet is the pincode check, and the pincode stays on the phone. */
export function PincodeSheet({ onClosed }: { onClosed: () => void }) {
  const saved = useSelect(sitesStore, (state) => state.pincode);
  const [pincode, setPincode] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const answer = useSelect(sitesStore, (state) =>
    pincode.length === 6 ? state.answers[pincode] : undefined,
  );
  async function check(value: string) {
    if (!/^[1-9]\d{5}$/.test(value)) {
      setError(w('sites.badPincode'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await checkPincode(value);
      rememberPincode(value);
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (saved) void check(saved);
  }, []);
  return (
    <Sheet title={w('home.checkDelivery')} onClosed={onClosed}>
      <View style={styles.body}>
        <View style={styles.pinBox}>
          <TextInput
            accessibilityLabel={w('sites.pincode')}
            placeholder={w('sites.pincodeHint')}
            placeholderTextColor={C.ink2}
            value={pincode}
            maxLength={6}
            keyboardType="number-pad"
            autoFocus
            onChangeText={(value) => {
              const digits = value.replace(/\D/g, '');
              setPincode(digits);
              setError('');
              if (digits.length === 6) void check(digits);
            }}
            style={[T.body, styles.flex, { color: C.ink }]}
          />
          <Button kind="quiet" loading={busy} onPress={() => void check(pincode)}>
            {w('sites.check')}
          </Button>
        </View>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {answer?.zone ? (
          <Notice tone="good">
            {deliverHereWords(answer.area, money(answer.zone.deliveryFeePaise))}
          </Notice>
        ) : null}
        {answer && !answer.zone ? <Notice tone="warn">{w('sites.notHere')}</Notice> : null}
      </View>
    </Sheet>
  );
}

/** The day the customer wants. Only a person at the shop can promise one. */
export function DaySheet({ onClosed }: { onClosed: () => void }) {
  const date = useSelect(checkoutStore, (state) => state.draft.date);
  const days = deliveryDateOptions(new Date(), 1, 14);
  return (
    <Sheet title={w('panel.day')} onClosed={onClosed}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[T.small, styles.quiet]}>{w('panel.dayNote')}</Text>
        <View style={styles.rows}>
          {days.map((day) => (
            <Pressable
              key={day}
              accessibilityRole="radio"
              accessibilityState={{ checked: day === date }}
              aria-checked={day === date}
              onPress={() => {
                updateDraft({ date: day });
                closeSheet('day');
              }}
              style={styles.row}
            >
              <Icon name={day === date ? 'radio-button-on' : 'radio-button-off'} />
              <Text style={[T.body, styles.flex]}>{friendlyDay(day)}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space[4], paddingBottom: space[4], gap: space[3] },
  rows: { gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: C.up,
    minHeight: touch + 8,
    paddingLeft: space[3],
    paddingVertical: space[1],
  },
  flex: { flex: 1, minWidth: 0 },
  quiet: { color: C.ink2 },
  edit: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  pinBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    borderWidth: 1.5,
    borderColor: C.ink,
    borderRadius: radius.control,
    backgroundColor: C.up,
    paddingLeft: space[3],
    paddingRight: 2,
    minHeight: 52,
  },
});
