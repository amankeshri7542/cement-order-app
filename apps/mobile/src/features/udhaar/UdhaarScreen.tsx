import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, Switch, Text, View } from 'react-native';
import { momentLabel, phoneSchema, type Person } from '@shiv/shared';
import { money } from '../../logic/money';
import { api } from '../../state/api';
import {
  khataStore,
  loadMoreKhata,
  refreshKhata,
  refreshPeople,
  setReminders,
} from '../../state/khata';
import { push } from '../../state/nav';
import { say } from '../../state/net';
import { refreshShop, shopStore } from '../../state/shop';
import { showToast } from '../../state/ui';
import { useSelect } from '../../state/use';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Notice } from '../../ui/Notice';
import { Screen, TopBar } from '../../ui/Screen';
import { C, space, T } from '../../ui/tokens';
import { w } from '../../words';

/** What an entry was, in plain words. No tags and no notes. */
export function whatFor(entry: { kind: string; channel: string; orderNumber: string | null }) {
  if (entry.orderNumber) return w('udhaar.goods', { number: entry.orderNumber });
  if (entry.kind === 'PAYMENT_RECEIVED') {
    if (entry.channel === 'CASH') return w('udhaar.paidCash');
    if (entry.channel === 'UPI') return w('udhaar.paidUpi');
    return w('udhaar.paid');
  }
  if (entry.kind === 'OPENING_BALANCE') return w('udhaar.opening');
  return w('udhaar.adjusted');
}

/**
 * "You owe the shop". Read only, with no limit, tags or notes. It appears only after an owner has
 * signed off the opening balance; for anyone else this screen says nothing about whether there is one.
 */
export function UdhaarScreen() {
  const khata = useSelect(khataStore, (state) => state.khata);
  const people = useSelect(khataStore, (state) => state.people.length);
  const whatsapp = useSelect(shopStore, (state) => state.whatsapp);
  useEffect(() => {
    void refreshKhata();
    void refreshShop();
  }, []);
  // Nothing is said about why, or whether there is a balance.
  if (!khata.available)
    return <Screen topBar={<TopBar title={w('udhaar.title')} />}>{null}</Screen>;
  return (
    <Screen topBar={<TopBar title={w('udhaar.title')} />}>
      <View>
        <Text style={T.body}>{w('udhaar.owe')}</Text>
        <Text style={[T.rateBig, styles.amount]} maxFontSizeMultiplier={1.4}>
          {money(khata.balancePaise)}
        </Text>
        <Text style={[T.small, styles.quiet]}>
          {w('udhaar.asOf', { time: momentLabel(khata.asOf, 'en') })}
        </Text>
      </View>
      <View>
        {khata.entries.map((entry) => (
          <View key={entry.id} style={styles.entry}>
            <View style={styles.flex}>
              <Text style={T.body}>{momentLabel(entry.on, 'en')}</Text>
              <Text style={[T.small, styles.quiet]}>{whatFor(entry)}</Text>
            </View>
            <Text style={T.rateSmall}>
              {entry.amountPaise >= 0 ? '+ ' : '- '}
              {money(Math.abs(entry.amountPaise))}
            </Text>
          </View>
        ))}
      </View>
      {khata.nextCursor ? (
        <Button kind="quiet" onPress={() => void loadMoreKhata().catch((e) => showToast(say(e)))}>
          {w('udhaar.more')}
        </Button>
      ) : null}
      {whatsapp ? (
        <Button
          kind="quiet"
          icon="logo-whatsapp"
          onPress={() =>
            void Linking.openURL(`https://wa.me/${whatsapp.replace(/\D/g, '')}`).catch(() =>
              showToast(w('common.couldNotOpen')),
            )
          }
        >
          {w('udhaar.wrong')}
        </Button>
      ) : null}
      <View style={styles.reminders}>
        <Text style={[T.body, styles.flex]}>{w('udhaar.reminders')}</Text>
        <Switch
          accessibilityLabel={w('udhaar.reminders')}
          value={!khata.remindersStopped}
          trackColor={{ true: C.ink, false: C.down }}
          thumbColor={C.up}
          onValueChange={(on) => void setReminders(on).catch((e) => showToast(say(e)))}
        />
      </View>
      <Button kind="line" icon="people-outline" onPress={() => push({ screen: 'people' })}>
        {people ? w('udhaar.peopleCount', { count: people }) : w('people.title')}
      </Button>
    </Screen>
  );
}

/** Who may order on this account. Their number, and nothing else about them. */
export function PeopleScreen() {
  const available = useSelect(khataStore, (state) => state.khata.available);
  const [people, setPeople] = useState<Person[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setPeople(await api<Person[]>('/me/people'));
    } catch (e) {
      setError(say(e));
    }
  }, []);
  useEffect(() => {
    if (available) void load();
  }, [available, load]);
  if (!available) return <Screen topBar={<TopBar title={w('people.title')} />}>{null}</Screen>;
  async function add() {
    const full = `+91${phone}`;
    if (!name.trim() || !phoneSchema.safeParse(full).success) {
      setError(w('people.invalid'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('/me/people', 'POST', { name: name.trim(), phone: full });
      setName('');
      setPhone('');
      await load();
      void refreshPeople();
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    try {
      await api(`/me/people/${id}`, 'DELETE');
      await load();
      void refreshPeople();
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen topBar={<TopBar title={w('people.title')} />}>
      <Text style={[T.body, styles.quiet]}>{w('people.explain')}</Text>
      {people.map((person) => (
        <View key={person.id} style={styles.entry}>
          <View style={styles.flex}>
            <Text style={T.body}>{person.name}</Text>
            <Text style={[T.small, styles.quiet]}>{person.phone}</Text>
          </View>
          <Button
            kind="link"
            label={w('people.removeLabel', { name: person.name })}
            disabled={busy}
            onPress={() => void remove(person.id)}
          >
            {w('panel.remove')}
          </Button>
        </View>
      ))}
      <View style={styles.group}>
        <Field label={w('people.name')} value={name} maxLength={100} onChangeText={setName} />
        <Field
          label={w('people.mobile')}
          prefix="+91"
          value={phone}
          keyboardType="phone-pad"
          maxLength={10}
          onChangeText={(value) => setPhone(value.replace(/\D/g, ''))}
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button loading={busy} onPress={() => void add()}>
          {w('people.add')}
        </Button>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  reminders: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: C.up,
    paddingHorizontal: space[3],
    minHeight: 56,
  },
  flex: { flex: 1, minWidth: 0 },
  quiet: { color: C.ink2 },
  amount: { fontSize: 44, lineHeight: 52 },
  entry: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.rule,
  },
  group: { backgroundColor: C.up, padding: space[3], gap: space[3] },
});
