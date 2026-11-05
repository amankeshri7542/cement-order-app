import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { phoneDigits, webEnquirySchema } from '@shiv/shared';
import { api } from '../../state/api';
import { say } from '../../state/net';
import { sessionStore } from '../../state/session';
import { showToast } from '../../state/ui';
import { useSelect } from '../../state/use';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Notice } from '../../ui/Notice';
import { Sheet, useSheetClose } from '../../ui/Sheet';
import { C, space, T } from '../../ui/tokens';
import { w } from '../../words';

/** "Not listed? Ask the shop." A person reads it and replies; no sign-in is needed to ask. */
export function AskShopSheet({ onClosed }: { onClosed: () => void }) {
  return (
    <Sheet title={w('askShop.title')} onClosed={onClosed}>
      <Body />
    </Sheet>
  );
}

function Body() {
  const close = useSheetClose();
  const user = useSelect(sessionStore, (state) => state.user);
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState((user?.phone ?? '').replace('+91', ''));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function send() {
    const parsed = webEnquirySchema.safeParse({
      name,
      phone: `+91${phone}`,
      message,
      interest: 'Not listed, from the app',
      language: 'en',
    });
    if (!parsed.success) {
      setError(w('askShop.incomplete'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('/web/enquiries', 'POST', parsed.data);
      showToast(w('askShop.sent'));
      close();
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
      <Text style={[T.body, styles.quiet]}>{w('askShop.explain')}</Text>
      <Field
        label={w('askShop.message')}
        value={message}
        onChangeText={setMessage}
        multiline
        maxLength={1000}
        autoFocus
      />
      <Field
        label={w('askShop.name')}
        value={name}
        onChangeText={setName}
        maxLength={80}
        autoComplete="name"
      />
      <Field
        label={w('askShop.mobile')}
        prefix="+91"
        value={phone}
        keyboardType="phone-pad"
        maxLength={18}
        onChangeText={(value) => setPhone(phoneDigits(value))}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button loading={busy} onPress={() => void send()}>
        {w('askShop.send')}
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space[4], paddingBottom: space[5], gap: space[3] },
  quiet: { color: C.ink2 },
});
