import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type TextInput } from 'react-native';
import * as Location from 'expo-location';
import { addressSchema, phoneDigits, type Address } from '@shiv/shared';
import { money } from '../../logic/money';
import { api } from '../../state/api';
import { checkoutStore, updateDraft } from '../../state/checkout';
import { say } from '../../state/net';
import { currentUser, sessionStore } from '../../state/session';
import { checkPincode, deleteSite, putSite, sitesStore } from '../../state/sites';
import { showToast } from '../../state/ui';
import { useSelect } from '../../state/use';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Notice } from '../../ui/Notice';
import { Sheet, useSheetClose } from '../../ui/Sheet';
import { C, space, T } from '../../ui/tokens';
import { w } from '../../words';
import { deliverHereWords } from './deliver-words';

type Pin = { lat: number; lng: number };
type Form = {
  pincode: string;
  line1: string;
  landmark: string;
  name: string;
  phone: string;
  area: string;
  label: string;
  city: string;
};

/** Five things, in the order a driver needs them, and an optional pin. */
export function SiteForm({
  id,
  purpose,
  onClosed,
}: {
  id?: string;
  purpose?: 'panel' | 'browse';
  onClosed: () => void;
}) {
  return (
    <Sheet title={id ? w('sites.edit') : w('sites.add')} onClosed={onClosed}>
      <FormBody id={id} purpose={purpose} />
    </Sheet>
  );
}

function FormBody({ id, purpose }: { id?: string; purpose?: 'panel' | 'browse' }) {
  const close = useSheetClose();
  const user = useSelect(sessionStore, (state) => state.user);
  const editing = useSelect(sitesStore, (state) => state.items.find((item) => item.id === id));
  const saved = useSelect(sitesStore, (state) => state.pincode);
  const [form, setForm] = useState<Form>(() => ({
    pincode: editing?.pincode ?? saved,
    line1: editing?.line1 ?? '',
    landmark: editing?.landmark ?? '',
    // "Who receives it" defaults to you, and on the first site it supplies your name.
    name: editing?.name ?? user?.name ?? '',
    phone: (editing?.phone ?? user?.phone ?? '').replace('+91', ''),
    area: editing?.area ?? '',
    label: editing?.label ?? '',
    city: editing?.city ?? 'Patna',
  }));
  const [pin, setPin] = useState<Pin | null>(() =>
    editing?.lat != null && editing.lng != null ? { lat: editing.lat, lng: editing.lng } : null,
  );
  const [pinWord, setPinWord] = useState('');
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const answer = useSelect(sitesStore, (state) =>
    form.pincode.length === 6 ? state.answers[form.pincode] : undefined,
  );
  const inputs = useRef<(TextInput | null)[]>([]);
  const set = (key: keyof Form, value: string) => setForm((old) => ({ ...old, [key]: value }));
  useEffect(() => {
    if (/^[1-9]\d{5}$/.test(form.pincode)) void checkPincode(form.pincode).catch(() => {});
  }, [form.pincode]);
  // The shop's area name, when it filled one in. Where it did not, the form asks; it never guesses.
  useEffect(() => {
    if (answer?.area && !editing) setForm((old) => ({ ...old, area: answer.area }));
  }, [answer?.area, editing]);

  async function usePin() {
    setLocating(true);
    setPinWord('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setPinWord(w('sites.pinRefused'));
        return;
      }
      const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setPin({ lat: here.coords.latitude, lng: here.coords.longitude });
      setPinWord(w('sites.pinSaved'));
    } catch {
      setPinWord(w('sites.pinRefused'));
    } finally {
      setLocating(false);
    }
  }
  async function save() {
    setBusy(true);
    setError('');
    const area = form.area.trim();
    const parsed = addressSchema.safeParse({
      label: form.label.trim() || (area ? w('sites.autoName', { area }) : w('sites.defaultName')),
      name: form.name,
      phone: `+91${phoneDigits(form.phone)}`,
      line1: form.line1,
      area,
      city: form.city,
      state: 'Bihar',
      pincode: form.pincode,
      landmark: form.landmark,
      ...(pin ? pin : editing?.lat != null ? { lat: null, lng: null } : {}),
    });
    if (!parsed.success) {
      setBusy(false);
      setError(w('sites.incomplete'));
      return;
    }
    try {
      const site = await api<Address>(
        id ? `/me/addresses/${id}` : '/me/addresses',
        id ? 'PATCH' : 'POST',
        parsed.data,
      );
      putSite(site);
      if (purpose === 'panel') checkoutStore.patch({ panelSite: site.id });
      else if (!id) updateDraft({ addressId: site.id });
      // The first site supplies the customer's name; there is no separate name step.
      const me = currentUser();
      if (me && !me.name.trim())
        void api<typeof me>('/me', 'PATCH', { name: site.name, language: 'en' })
          .then((next) => sessionStore.patch({ user: next }))
          .catch(() => {});
      showToast(w('sites.saved'));
      close();
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!id) return;
    setBusy(true);
    try {
      await deleteSite(id);
      close();
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  }
  const showArea = Boolean(editing) || (Boolean(answer) && !answer?.area);
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
      <Button kind="line" icon="navigate-outline" loading={locating} onPress={() => void usePin()}>
        {pin ? w('sites.pinAgain') : w('sites.useSpot')}
      </Button>
      {pinWord ? <Text style={[T.small, styles.quiet]}>{pinWord}</Text> : null}
      <View>
        <Field
          label={w('sites.pincode')}
          value={form.pincode}
          keyboardType="number-pad"
          maxLength={6}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => inputs.current[0]?.focus()}
          onChangeText={(value) => set('pincode', value.replace(/\D/g, ''))}
        />
        {answer?.zone ? (
          <Text style={[T.small, styles.good]}>
            {deliverHereWords(answer.area, money(answer.zone.deliveryFeePaise))}
          </Text>
        ) : answer ? (
          <Text style={[T.small, styles.warn]}>{w('sites.notHere')}</Text>
        ) : null}
      </View>
      <Field
        ref={(input) => {
          inputs.current[0] = input;
        }}
        label={w('sites.house')}
        value={form.line1}
        maxLength={250}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => inputs.current[1]?.focus()}
        onChangeText={(value) => set('line1', value)}
      />
      {showArea ? (
        <>
          <Field
            label={w('sites.area')}
            value={form.area}
            maxLength={120}
            onChangeText={(value) => set('area', value)}
          />
          <Field
            label={w('sites.city')}
            value={form.city}
            maxLength={100}
            onChangeText={(value) => set('city', value)}
          />
        </>
      ) : null}
      <Field
        ref={(input) => {
          inputs.current[1] = input;
        }}
        label={w('sites.landmark')}
        value={form.landmark}
        maxLength={200}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => inputs.current[2]?.focus()}
        onChangeText={(value) => set('landmark', value)}
      />
      <Field
        ref={(input) => {
          inputs.current[2] = input;
        }}
        label={w('sites.receiver')}
        value={form.name}
        maxLength={100}
        autoComplete="name"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => inputs.current[3]?.focus()}
        onChangeText={(value) => set('name', value)}
      />
      <Field
        ref={(input) => {
          inputs.current[3] = input;
        }}
        label={w('sites.receiverPhone')}
        prefix="+91"
        value={form.phone}
        keyboardType="phone-pad"
        maxLength={18}
        onChangeText={(value) => set('phone', phoneDigits(value))}
      />
      {editing ? (
        <Field
          label={w('sites.label')}
          value={form.label}
          maxLength={40}
          onChangeText={(value) => set('label', value)}
        />
      ) : form.area.trim() ? (
        <Text style={[T.small, styles.quiet]}>
          {w('sites.willName', { name: w('sites.autoName', { area: form.area.trim() }) })}
        </Text>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button loading={busy} onPress={() => void save()}>
        {w('sites.save')}
      </Button>
      {editing ? (
        <Button kind="link" disabled={busy} onPress={() => void remove()}>
          {w('sites.remove')}
        </Button>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space[4], paddingBottom: space[5], gap: space[3] },
  quiet: { color: C.ink2 },
  good: { color: C.ok, paddingTop: space[1] },
  warn: { color: C.warn, paddingTop: space[1] },
});
