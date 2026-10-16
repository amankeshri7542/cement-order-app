import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  addressSchema,
  momentLabel,
  radius,
  space,
  textSize,
  type Address,
  type SessionInfo,
  type User,
} from '@shiv/shared';
import { api, clearLocalSession, saveSession } from './api';
import { useStore } from './store';
import {
  Button,
  C,
  Chip,
  Empty,
  Field,
  headingScale,
  Icon,
  Notice,
  s,
  Screen,
  Section,
  Stamp,
  type IconName,
} from './ui';
import { confirm } from './orders';

export function Login() {
  const { loginVisible, setLoginVisible, completeLogin, t, say } = useStore();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (!sent) {
        const result = await api<{ devCode?: string }>('/auth/otp/request', 'POST', {
          phone: `+91${phone}`,
        });
        setDevCode(result.devCode || '');
        setSent(true);
      } else {
        const result = await api<{ user: User; accessToken?: string; refreshToken?: string }>(
          '/auth/otp/verify',
          'POST',
          { phone: `+91${phone}`, code },
        );
        const user = await saveSession(result);
        setSent(false);
        setCode('');
        setDevCode('');
        await completeLogin(user);
      }
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      visible={loginVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setLoginVisible(false)}
    >
      {/* A modal has its own window, so Android's resize-for-keyboard does not reach it. */}
      <KeyboardAvoidingView behavior="padding" style={ac.overlay}>
        <SafeAreaView edges={['bottom']} style={ac.sheet}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: space.xl, gap: space.lg }}
          >
            <View style={s.between}>
              <Stamp size={44} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Close', 'बंद करें')}
                onPress={() => setLoginVisible(false)}
                style={{ padding: space.md }}
              >
                <Icon name="close" />
              </Pressable>
            </View>
            <View style={{ gap: space.xs }}>
              <Text style={s.h1} maxFontSizeMultiplier={headingScale}>
                {t('Sign in with your mobile', 'मोबाइल नंबर से साइन इन')}
              </Text>
              <Text style={s.body}>
                {t(
                  'We send a 6-digit code by SMS. No password needed.',
                  'हम SMS से 6 अंकों का कोड भेजेंगे। पासवर्ड की ज़रूरत नहीं।',
                )}
              </Text>
            </View>
            <Field
              label={`${t('Mobile number', 'मोबाइल नंबर')} (+91)`}
              value={phone}
              onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              maxLength={10}
              editable={!sent && !busy}
              placeholder={t('10-digit mobile number', '10 अंकों का मोबाइल नंबर')}
              returnKeyType="send"
              onSubmitEditing={() => {
                if (!sent && phone.length === 10 && !busy) void submit();
              }}
              autoFocus
            />
            {sent && (
              <Field
                label={t('Verification code', 'सत्यापन कोड')}
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={6}
                placeholder={t('6-digit code', '6 अंकों का कोड')}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (code.length === 6 && !busy) void submit();
                }}
                autoFocus
              />
            )}
            {Boolean(devCode) && (
              <Notice>
                Local development code: {devCode}
                {'\n'}No SMS was sent. Test mode is disabled in production.
              </Notice>
            )}
            {Boolean(error) && <Notice error>{error}</Notice>}
            <Button
              loading={busy}
              disabled={sent ? code.length !== 6 : phone.length !== 10}
              onPress={() => void submit()}
              icon="arrow-forward"
            >
              {sent
                ? t('Verify & continue', 'कोड पक्का करें')
                : t('Get verification code', 'कोड भेजें')}
            </Button>
            {sent && (
              <Button
                kind="quiet"
                onPress={() => {
                  setSent(false);
                  setCode('');
                  setDevCode('');
                }}
              >
                {t('Change number or send a new code', 'नंबर बदलें या नया कोड भेजें')}
              </Button>
            )}
            <Text style={[s.small, { textAlign: 'center' }]}>
              {t(
                'Your number is used only for sign-in and order updates.',
                'आपका नंबर सिर्फ़ साइन इन और ऑर्डर की जानकारी के लिए है।',
              )}
            </Text>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Account() {
  const {
    user,
    setUser,
    t,
    language,
    setLanguage,
    navigate,
    signout,
    setLoginVisible,
    settings,
    setToast,
    say,
  } = useStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [contractor, setContractor] = useState(
    user?.contractorStatus === 'PENDING' || user?.role === 'CONTRACTOR',
  );
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setName(user?.name || '');
    setContractor(user?.contractorStatus === 'PENDING' || user?.role === 'CONTRACTOR');
  }, [user]);
  async function save() {
    setBusy(true);
    setError('');
    try {
      const u = await api<User>('/me', 'PATCH', { name, language, contractor });
      setUser(u);
      setEditing(false);
      setToast(t('Profile saved', 'प्रोफ़ाइल सहेजी गई'));
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  }
  async function enablePush() {
    if (Platform.OS !== 'android') {
      setToast(
        t('Order updates are always shown in the app.', 'ऑर्डर की जानकारी हमेशा ऐप में दिखती है।'),
      );
      return;
    }
    try {
      await Notifications.setNotificationChannelAsync('orders', {
        name: t('Order updates', 'ऑर्डर की जानकारी'),
        importance: Notifications.AndroidImportance.DEFAULT,
      });
      const permission = await Notifications.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        setToast(
          t(
            'Notifications are off. You can still see every update in Orders.',
            'सूचनाएँ बंद हैं। ऑर्डर में हर जानकारी फिर भी दिखेगी।',
          ),
        );
        return;
      }
      const token = await Notifications.getDevicePushTokenAsync();
      await api('/me/devices', 'POST', { token: token.data, platform: 'android' });
      setToast(t('Order notifications are on', 'ऑर्डर की सूचनाएँ चालू हैं'));
    } catch {
      setToast(
        t(
          'Notifications are not available in this build yet. Updates are shown in Orders.',
          'इस ऐप में सूचनाएँ अभी उपलब्ध नहीं हैं। जानकारी ऑर्डर में दिखेगी।',
        ),
      );
    }
  }
  function open(url: string) {
    void Linking.openURL(url).catch(() =>
      setToast(t('Could not open this link.', 'यह लिंक नहीं खुल सका।')),
    );
  }
  const phone = settings?.phone.replace(/\D/g, '');
  const rows: { label: string; icon: IconName; action: () => void }[] = [
    {
      label: t('My orders', 'मेरे ऑर्डर'),
      icon: 'receipt-outline',
      action: () => navigate({ screen: 'Orders' }),
    },
    {
      label: t('Bulk quotes', 'थोक भाव'),
      icon: 'document-text-outline',
      action: () => navigate({ screen: 'Quotes' }),
    },
    {
      label: t('Saved addresses', 'सहेजे पते'),
      icon: 'location-outline',
      action: () => navigate({ screen: 'Addresses' }),
    },
    {
      label: t('Order notifications', 'ऑर्डर की सूचनाएँ'),
      icon: 'notifications-outline',
      action: () => void enablePush(),
    },
  ];
  return (
    <Screen>
      <View style={[s.card, s.row]}>
        <View style={ac.avatar}>
          <Icon name="person" color={C.ink2} size={30} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.h2} maxFontSizeMultiplier={headingScale}>
            {user?.name || (user ? t('Welcome', 'स्वागत है') : t('Not signed in', 'साइन इन नहीं'))}
          </Text>
          <Text style={s.body}>
            {user?.phone ||
              t('Sign in to order and track deliveries', 'ऑर्डर और डिलीवरी के लिए साइन इन करें')}
          </Text>
        </View>
        {user && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Edit profile', 'प्रोफ़ाइल बदलें')}
            onPress={() => setEditing(!editing)}
            style={{ padding: space.md }}
          >
            <Icon name="create-outline" />
          </Pressable>
        )}
      </View>
      {!user && (
        <Button icon="log-in-outline" onPress={() => setLoginVisible(true)}>
          {t('Sign in', 'साइन इन')}
        </Button>
      )}
      {user?.role === 'ADMIN' && (
        <Notice>
          {t(
            'This is a staff account. Shop work happens on the owner desk; use a customer number to order here.',
            'यह स्टाफ़ खाता है। दुकान का काम मालिक पटल पर होता है; यहाँ ऑर्डर के लिए ग्राहक नंबर इस्तेमाल करें।',
          )}
        </Notice>
      )}
      {editing && (
        <View style={[s.card, s.stack]}>
          <Field
            label={t('Full name', 'पूरा नाम')}
            value={name}
            onChangeText={setName}
            maxLength={100}
          />
          <View style={s.row}>
            <Switch
              value={contractor}
              onValueChange={setContractor}
              trackColor={{ true: C.accent, false: C.rule }}
              accessibilityLabel={t(
                'I buy for business or construction projects',
                'मैं व्यापार या निर्माण के लिए खरीदता/खरीदती हूँ',
              )}
            />
            <Text style={[s.body, { flex: 1 }]}>
              {t(
                'I am a contractor or builder (ask for verification)',
                'मैं ठेकेदार या बिल्डर हूँ (सत्यापन माँगें)',
              )}
            </Text>
          </View>
          {Boolean(error) && <Notice error>{error}</Notice>}
          <Button loading={busy} onPress={() => void save()}>
            {t('Save', 'सहेजें')}
          </Button>
        </View>
      )}
      <View style={{ gap: 2 }}>
        {rows.map((row) => (
          <Pressable
            accessibilityRole="button"
            onPress={row.action}
            key={row.label}
            style={({ pressed }) => [ac.accountRow, pressed && { opacity: 0.7 }]}
          >
            <Icon name={row.icon} color={C.ink} />
            <Text style={ac.rowLabel}>{row.label}</Text>
            <Icon name="chevron-forward" size={18} color={C.muted} />
          </Pressable>
        ))}
        <View style={ac.accountRow}>
          <Icon name="language-outline" color={C.ink} />
          <Text style={ac.rowLabel}>{t('Language', 'भाषा')}</Text>
          <Chip
            label="हिंदी"
            role="radio"
            selected={language === 'hi'}
            onPress={() => setLanguage('hi')}
          />
          <Chip
            label="English"
            role="radio"
            selected={language === 'en'}
            onPress={() => setLanguage('en')}
          />
        </View>
      </View>
      {phone ? (
        <View style={[s.card, s.stack]}>
          <Text style={s.h3}>{t('Talk to the shop', 'दुकान से बात करें')}</Text>
          <Text style={s.body}>
            {t('Shiv Cement Store · Patna, Bihar', 'शिव सीमेंट स्टोर · पटना, बिहार')}
          </Text>
          <View style={[s.row, { gap: space.sm }]}>
            <Button secondary icon="call" style={{ flex: 1 }} onPress={() => open(`tel:+${phone}`)}>
              {t('Call', 'फ़ोन करें')}
            </Button>
            <Button
              secondary
              icon="logo-whatsapp"
              style={{ flex: 1 }}
              onPress={() => open(`https://wa.me/${phone}`)}
            >
              WhatsApp
            </Button>
          </View>
        </View>
      ) : null}
      {user && (
        <View style={[s.card, s.stack]}>
          <Text style={s.h3}>{t('Security and privacy', 'सुरक्षा और निजता')}</Text>
          <Button
            secondary
            onPress={() =>
              void api<SessionInfo[]>('/auth/sessions')
                .then(setSessions)
                .catch((e) => setToast(say(e)))
            }
          >
            {t('Signed-in phones', 'साइन इन वाले फ़ोन')}
          </Button>
          {sessions?.map((session) => (
            <View key={session.id} style={s.between}>
              <Text style={[s.body, { flex: 1 }]}>
                {session.current ? t('This phone', 'यह फ़ोन') : session.label} ·{' '}
                {momentLabel(session.lastSeenAt, language)}
              </Text>
              {!session.current && (
                <Button
                  kind="quiet"
                  onPress={() =>
                    void api(`/auth/sessions/${session.id}`, 'DELETE')
                      .then(() => api<SessionInfo[]>('/auth/sessions'))
                      .then(setSessions)
                      .catch((e) => setToast(say(e)))
                  }
                >
                  {t('Sign out', 'साइन आउट')}
                </Button>
              )}
            </View>
          ))}
          <Button kind="quiet" onPress={() => setDeleting(!deleting)}>
            {t('Delete account', 'खाता हटाएँ')}
          </Button>
          {deleting && (
            <>
              <Notice>
                {t(
                  'Deletion removes your profile, addresses, basket and sign-ins on every phone. Order records without your details stay for the shop’s accounts. Finish open orders first. This cannot be undone.',
                  'खाता हटाने से आपकी प्रोफ़ाइल, पते, टोकरी और सभी फ़ोन से साइन इन हट जाएँगे। आपकी जानकारी के बिना ऑर्डर का हिसाब दुकान के रिकॉर्ड में रहेगा। पहले खुले ऑर्डर पूरे करें। यह वापस नहीं होगा।',
                )}
              </Notice>
              <Field
                label={t('Type DELETE to confirm', 'पक्का करने के लिए DELETE लिखें')}
                value={confirmation}
                onChangeText={setConfirmation}
                autoCapitalize="characters"
              />
              <Button
                disabled={confirmation !== 'DELETE'}
                loading={busy}
                onPress={async () => {
                  setBusy(true);
                  try {
                    await api('/me/delete', 'POST', { confirmation });
                    await clearLocalSession();
                    setUser(null);
                    navigate({ screen: 'Home' });
                    setToast(t('Account deleted', 'खाता हटा दिया गया'));
                  } catch (e) {
                    setToast(say(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('Permanently delete my account', 'मेरा खाता हमेशा के लिए हटाएँ')}
              </Button>
            </>
          )}
        </View>
      )}
      {user && (
        <Button
          secondary
          icon="log-out-outline"
          onPress={async () => {
            if (
              await confirm(
                t('Sign out of this phone?', 'इस फ़ोन से साइन आउट करें?'),
                language,
                t('Sign out', 'साइन आउट'),
                t('Stay', 'रुकें'),
              )
            )
              void signout();
          }}
        >
          {t('Sign out', 'साइन आउट')}
        </Button>
      )}
      <Button
        kind="quiet"
        onPress={() => open(process.env.EXPO_PUBLIC_PRIVACY_URL || 'http://localhost:3000/privacy')}
      >
        {t('Privacy and account deletion policy', 'निजता और खाता हटाने की नीति')}
      </Button>
      <Text style={[s.small, { textAlign: 'center' }]}>
        {t('Shiv Cement Store · built on trust', 'शिव सीमेंट स्टोर · भरोसे की दुकान')}
      </Text>
    </Screen>
  );
}

export function Addresses() {
  const {
    user,
    addresses,
    setAddresses,
    t,
    setToast,
    route,
    completeAddress,
    refreshAccount,
    say,
    language,
  } = useStore();
  // route.id: an address to edit, or 'new' to open straight onto an empty form.
  const creating = route.id === 'new';
  const editId = creating ? undefined : route.id;
  const routedAddress = addresses.find((address) => address.id === editId);
  const [show, setShow] = useState(Boolean(route.id) || !addresses.length);
  const [editingId, setEditingId] = useState<string | null>(editId || null);
  const initialized = useRef(!editId || Boolean(routedAddress));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function addressForm(address?: Address) {
    return {
      label: address?.label || t('Site', 'साइट'),
      name: address?.name || user?.name || '',
      phone: (address?.phone || user?.phone || '').replace('+91', ''),
      line1: address?.line1 || '',
      area: address?.area || '',
      city: address?.city || 'Patna',
      pincode: address?.pincode || '',
      landmark: address?.landmark || '',
    };
  }
  const [form, setForm] = useState(() => addressForm(routedAddress));
  const inputs = useRef<(TextInput | null)[]>([]);
  function edit(address?: Address) {
    initialized.current = true;
    setEditingId(address?.id || null);
    setForm(addressForm(address));
    setError('');
    setShow(true);
  }
  useEffect(() => {
    if (initialized.current || !editId) return;
    const address = addresses.find((item) => item.id === editId);
    if (address) {
      initialized.current = true;
      edit(address);
    }
  }, [addresses, editId]);
  async function save() {
    setBusy(true);
    setError('');
    try {
      const parsed = addressSchema.safeParse({
        ...form,
        phone: `+91${form.phone}`,
        state: 'Bihar',
      });
      if (!parsed.success)
        throw new Error(
          language === 'hi'
            ? 'पता पूरा भरें: नाम, 10 अंकों का मोबाइल, मकान/गली, इलाक़ा, शहर और 6 अंकों का पिनकोड।'
            : parsed.error.issues.map((i) => i.message).join('\n'),
        );
      const address = await api<Address>(
        editingId ? `/me/addresses/${editingId}` : '/me/addresses',
        editingId ? 'PATCH' : 'POST',
        parsed.data,
      );
      setAddresses((old) => [address, ...old.filter((item) => item.id !== address.id)]);
      setShow(false);
      setToast(t('Address saved', 'पता सहेजा गया'));
      completeAddress(address.id);
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  }
  // What the driver needs first; the label and landmark are optional extras at the end.
  const fields = [
    { key: 'line1', label: t('House, plot or street', 'मकान, प्लॉट या गली') },
    { key: 'area', label: t('Area / locality', 'इलाक़ा / मोहल्ला') },
    { key: 'pincode', label: t('Pincode', 'पिनकोड') },
    { key: 'name', label: t('Person receiving', 'सामान लेने वाले का नाम') },
    { key: 'phone', label: t('Mobile number (+91)', 'मोबाइल नंबर (+91)') },
    { key: 'city', label: t('City / district', 'शहर / ज़िला') },
    { key: 'landmark', label: t('Landmark (optional)', 'पहचान का स्थान (वैकल्पिक)') },
    { key: 'label', label: t('Name this address (Home / Site)', 'पते का नाम (घर / साइट)') },
  ] as const;
  return (
    <Screen
      footer={
        show && initialized.current ? (
          <Button loading={busy} onPress={() => void save()}>
            {t('Save address', 'पता सहेजें')}
          </Button>
        ) : undefined
      }
    >
      <Section
        title={t('Saved addresses', 'सहेजे पते')}
        action={show ? undefined : t('Add new', 'नया जोड़ें')}
        onAction={() => edit()}
      />
      {!addresses.length && !show && (
        <Empty icon="location-outline" title={t('No saved addresses', 'कोई पता सहेजा नहीं')} />
      )}
      {!show &&
        addresses.map((a) => (
          <View key={a.id} style={[s.card, { gap: space.xs }]}>
            <View style={s.between}>
              <Text style={s.h3}>{a.label}</Text>
              <View style={s.row}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('Edit', 'बदलें')} ${a.label}`}
                  disabled={busy}
                  onPress={() => edit(a)}
                  style={{ padding: space.md }}
                >
                  <Icon name="create-outline" />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('Delete', 'हटाएँ')} ${a.label}`}
                  disabled={busy}
                  onPress={async () => {
                    if (
                      !(await confirm(
                        t(`Delete the ${a.label} address?`, `${a.label} पता हटाएँ?`),
                        language,
                        t('Delete', 'हटाएँ'),
                        t('Keep', 'रखें'),
                      ))
                    )
                      return;
                    setBusy(true);
                    try {
                      await api(`/me/addresses/${a.id}`, 'DELETE');
                      setAddresses((old) => old.filter((x) => x.id !== a.id));
                    } catch (e) {
                      setToast(say(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                  style={{ padding: space.md }}
                >
                  <Icon name="trash-outline" color={C.muted} />
                </Pressable>
              </View>
            </View>
            <Text style={s.body}>
              {a.name} · {a.phone}
              {'\n'}
              {a.line1}, {a.area}, {a.city} {a.pincode}
            </Text>
          </View>
        ))}
      {show && !initialized.current && (
        <View style={s.stack}>
          <Notice error>
            {t(
              'This saved address is not available. Refresh your addresses.',
              'यह सहेजा पता नहीं मिला। अपने पते रीफ़्रेश करें।',
            )}
          </Notice>
          <Button
            secondary
            loading={busy}
            onPress={async () => {
              setBusy(true);
              try {
                await refreshAccount();
              } catch (e) {
                setToast(say(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('Refresh addresses', 'पते रीफ़्रेश करें')}
          </Button>
        </View>
      )}
      {show && initialized.current && (
        <View style={s.stack}>
          <Text style={s.h2} maxFontSizeMultiplier={headingScale}>
            {editingId
              ? t('Edit address', 'पता बदलें')
              : t('Add a delivery address', 'डिलीवरी का पता जोड़ें')}
          </Text>
          {fields.map((x, index) => (
            <Field
              key={x.key}
              ref={(input) => {
                inputs.current[index] = input;
              }}
              label={x.label}
              value={form[x.key]}
              returnKeyType={index < fields.length - 1 ? 'next' : 'done'}
              submitBehavior={index < fields.length - 1 ? 'submit' : 'blurAndSubmit'}
              onSubmitEditing={() =>
                index < fields.length - 1 ? inputs.current[index + 1]?.focus() : void save()
              }
              keyboardType={
                x.key === 'phone' ? 'phone-pad' : x.key === 'pincode' ? 'number-pad' : 'default'
              }
              maxLength={x.key === 'pincode' ? 6 : x.key === 'phone' ? 10 : 200}
              onChangeText={(value) => setForm((current) => ({ ...current, [x.key]: value }))}
            />
          ))}
          <Text style={s.small}>
            {t(
              'State: Bihar. Delivery charges are checked for your pincode at review.',
              'राज्य: बिहार। डिलीवरी शुल्क समीक्षा के समय आपके पिनकोड से जाँचा जाता है।',
            )}
          </Text>
          {Boolean(error) && <Notice error>{error}</Notice>}
          {addresses.length > 0 && (
            <Button
              kind="quiet"
              disabled={busy}
              onPress={() => {
                setShow(false);
                setError('');
              }}
            >
              {t('Cancel', 'रद्द करें')}
            </Button>
          )}
        </View>
      )}
    </Screen>
  );
}

const ac = StyleSheet.create({
  // Dialogs are the one raised object besides menus and toasts.
  overlay: { flex: 1, backgroundColor: 'rgba(28, 34, 39, 0.6)', justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    maxHeight: '94%',
    backgroundColor: C.ground,
    borderTopLeftRadius: radius.control,
    borderTopRightRadius: radius.control,
    elevation: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    backgroundColor: C.tab1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  accountRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.md,
    minHeight: 60,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: C.surface,
  },
  rowLabel: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 120,
    color: C.ink,
    fontSize: textSize.body,
    fontWeight: '700',
  },
});
