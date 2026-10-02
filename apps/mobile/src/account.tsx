import { useState } from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { addressSchema, Address, User } from '@shiv/shared';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, message, saveSession } from './api';
import { useStore } from './store';
import { Button, C, Field, Icon, IconName, Notice, Section, s } from './ui';

export function Login() {
  const { loginVisible, setLoginVisible, setUser, setLanguage, t } = useStore();
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
        setUser(user);
        setLanguage(user.language);
        setLoginVisible(false);
        setSent(false);
        setCode('');
        setDevCode('');
      }
    } catch (e) {
      setError(message(e));
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
      <View style={ac.overlay}>
        <SafeAreaView style={ac.login}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 28, gap: 20 }}
          >
            <View style={s.between}>
              <View style={ac.logo}>
                <Icon name="business-outline" color={C.navy} size={29} />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('close')}
                onPress={() => setLoginVisible(false)}
                style={{ padding: 12 }}
              >
                <Icon name="close" />
              </Pressable>
            </View>
            <View>
              <Text style={s.eyebrow}>WELCOME TO SHIV CEMENT STORE</Text>
              <Text style={[s.title, { marginTop: 12 }]}>Let’s get you building.</Text>
              <Text style={[s.body, { marginTop: 8 }]}>
                Sign in to order materials and keep track of your deliveries.
              </Text>
            </View>
            <Field
              label={`${t('phone')} (+91)`}
              value={phone}
              onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
              keyboardType="phone-pad"
              autoComplete="tel"
              maxLength={10}
              editable={!sent}
              placeholder="10-digit mobile number"
            />
            {sent && (
              <Field
                label={t('code')}
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="6-digit code"
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
              {sent ? t('verify') : t('getCode')}
            </Button>
            {sent && (
              <Button
                secondary
                onPress={() => {
                  setSent(false);
                  setCode('');
                  setDevCode('');
                }}
              >
                Change number / request another code
              </Button>
            )}
            <Text style={[s.body, { fontSize: 11, textAlign: 'center' }]}>
              Your number is used for account access and order updates.
            </Text>
          </ScrollView>
        </SafeAreaView>
      </View>
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
  } = useStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [contractor, setContractor] = useState(user?.role === 'CONTRACTOR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true);
    setError('');
    try {
      const u = await api<User>('/me', 'PATCH', { name, language, contractor });
      setUser(u);
      setEditing(false);
      setToast('Profile saved');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function enablePush() {
    if (Platform.OS !== 'android') {
      setToast(
        'Native push setup is currently available for Android builds. Order updates are always available in the app.',
      );
      return;
    }
    try {
      await Notifications.setNotificationChannelAsync('orders', {
        name: 'Order updates',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
      const permission = await Notifications.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        setToast('Notification permission was not granted.');
        return;
      }
      const token = await Notifications.getDevicePushTokenAsync();
      await api('/me/devices', 'POST', { token: token.data, platform: 'android' });
      setToast('Order notifications enabled');
    } catch {
      setToast('Notifications require a configured Firebase Android development build.');
    }
  }
  const rows: { label: string; icon: IconName; action: () => void }[] = [
    { label: t('orders'), icon: 'receipt-outline', action: () => navigate({ screen: 'Orders' }) },
    {
      label: t('savedAddresses'),
      icon: 'location-outline',
      action: () => navigate({ screen: 'Addresses' }),
    },
    {
      label: t('quotes'),
      icon: 'document-text-outline',
      action: () => navigate({ screen: 'Quotes' }),
    },
    {
      label: 'Order notifications',
      icon: 'notifications-outline',
      action: () => void enablePush(),
    },
  ];
  return (
    <View style={s.stack}>
      <Text style={s.title}>{t('account')}</Text>
      <View style={[s.card, s.row]}>
        <View style={ac.avatar}>
          <Icon name="person-outline" color="#6b8497" size={30} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: C.ink }}>
            {user?.name || (user ? 'Welcome to Shiv' : 'Your building partner')}
          </Text>
          <Text style={s.body}>{user?.phone || 'Sign in for orders and quotations'}</Text>
        </View>
        {user && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            onPress={() => setEditing(!editing)}
            style={{ padding: 12 }}
          >
            <Icon name="create-outline" />
          </Pressable>
        )}
      </View>
      {!user && <Button onPress={() => setLoginVisible(true)}>{t('signin')}</Button>}
      {editing && (
        <View style={[s.card, s.stack]}>
          <Field label={t('name')} value={name} onChangeText={setName} maxLength={100} />
          <View style={s.row}>
            <Switch
              value={contractor}
              onValueChange={setContractor}
              accessibilityLabel={t('contractor')}
            />
            <Text style={[s.body, { flex: 1 }]}>{t('contractor')}</Text>
          </View>
          {Boolean(error) && <Notice error>{error}</Notice>}
          <Button loading={busy} onPress={() => void save()}>
            {t('save')}
          </Button>
        </View>
      )}
      <View style={s.card}>
        {rows.map((row) => (
          <Pressable
            accessibilityRole="button"
            onPress={row.action}
            key={row.label}
            style={ac.accountRow}
          >
            <Icon name={row.icon} color="#6d8599" />
            <Text style={ac.rowLabel}>{row.label}</Text>
            <Icon name="chevron-forward" size={17} color="#9ba9b4" />
          </Pressable>
        ))}
        <View style={ac.accountRow}>
          <Icon name="language-outline" color="#6d8599" />
          <Text style={ac.rowLabel}>{t('language')}</Text>
          {(['en', 'hi'] as const).map((l) => (
            <Pressable
              key={l}
              accessibilityRole="button"
              aria-selected={language === l}
              accessibilityState={{ selected: language === l }}
              onPress={() => setLanguage(l)}
              style={[ac.language, language === l && { backgroundColor: C.navy }]}
            >
              <Text style={{ color: language === l ? '#fff' : C.muted, fontSize: 12 }}>
                {l === 'en' ? 'EN' : 'हिंदी'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {settings && (
        <View style={[s.card, s.stack]}>
          <Text style={s.h2}>{t('contact')}</Text>
          <Text style={s.body}>Shiv Cement Store{`\n`}Patna & Bihar</Text>
          <View style={s.row}>
            <Button
              secondary
              icon="call-outline"
              onPress={() => void Linking.openURL(`tel:${settings.phone}`)}
              style={{ flex: 1 }}
            >
              Call store
            </Button>
            <Button
              secondary
              icon="logo-whatsapp"
              onPress={() =>
                void Linking.openURL(`https://wa.me/${settings.phone.replace('+', '')}`)
              }
              style={{ flex: 1 }}
            >
              WhatsApp
            </Button>
          </View>
        </View>
      )}
      {user && (
        <Button secondary onPress={() => void signout()}>
          {t('signout')}
        </Button>
      )}
      <Text style={[s.body, { textAlign: 'center', fontSize: 11 }]}>
        Shiv Cement Store · Built on trust.
      </Text>
    </View>
  );
}
export function Addresses() {
  const { user, addresses, setAddresses, t, setToast } = useStore();
  const [show, setShow] = useState(!addresses.length);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    label: 'Site',
    name: user?.name || '',
    phone: user?.phone.replace('+91', '') || '',
    line1: '',
    area: '',
    city: 'Patna',
    pincode: '',
    landmark: '',
  });
  async function save() {
    setBusy(true);
    setError('');
    try {
      const parsed = addressSchema.safeParse({
        ...form,
        phone: `+91${form.phone}`,
        state: 'Bihar',
      });
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('\n'));
      const address = await api<Address>('/me/addresses', 'POST', parsed.data);
      setAddresses([address, ...addresses]);
      setShow(false);
      setToast('Address saved');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={s.stack}>
      <Section title={t('savedAddresses')} action="+ Add new" onAction={() => setShow(true)} />
      {addresses.map((a) => (
        <View key={a.id} style={s.card}>
          <View style={s.between}>
            <Text style={{ color: C.ink, fontWeight: '700', fontSize: 16 }}>{a.label}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete ${a.label} address`}
              onPress={async () => {
                try {
                  await api(`/me/addresses/${a.id}`, 'DELETE');
                  setAddresses(addresses.filter((x) => x.id !== a.id));
                } catch (e) {
                  setToast(message(e));
                }
              }}
              style={{ padding: 12 }}
            >
              <Icon name="trash-outline" size={18} color={C.muted} />
            </Pressable>
          </View>
          <Text style={s.body}>
            {a.name} · {a.phone}
            {'\n'}
            {a.line1}, {a.area}, {a.city}, {a.state} {a.pincode}
          </Text>
        </View>
      ))}
      {show && (
        <View style={[s.card, s.stack]}>
          <Text style={s.h2}>Add a delivery address</Text>
          {(
            [
              { key: 'label', label: 'Address label (Home / Site)' },
              { key: 'name', label: 'Recipient name' },
              { key: 'phone', label: 'Mobile number (+91)' },
              { key: 'line1', label: 'Building, plot or street' },
              { key: 'area', label: 'Area / locality' },
              { key: 'city', label: 'City / district' },
              { key: 'pincode', label: 'Pincode' },
              { key: 'landmark', label: 'Landmark (optional)' },
            ] as const
          ).map((x) => (
            <Field
              key={x.key}
              label={x.label}
              value={form[x.key]}
              keyboardType={['phone', 'pincode'].includes(x.key) ? 'number-pad' : 'default'}
              maxLength={x.key === 'pincode' ? 6 : x.key === 'phone' ? 10 : 200}
              onChangeText={(value) => setForm({ ...form, [x.key]: value })}
            />
          ))}
          <Text style={s.body}>State: Bihar · We deliver across Bihar.</Text>
          {Boolean(error) && <Notice error>{error}</Notice>}
          <Button loading={busy} onPress={() => void save()}>
            {t('saveAddress')}
          </Button>
          {addresses.length > 0 && (
            <Button secondary onPress={() => setShow(false)}>
              Cancel
            </Button>
          )}
        </View>
      )}
    </View>
  );
}
const ac = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#10243c80',
    justifyContent: 'center',
    alignItems: 'center',
  },
  login: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '95%',
    backgroundColor: '#fff',
    borderRadius: 15,
  },
  logo: {
    width: 50,
    height: 50,
    backgroundColor: C.yellow,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 59,
    height: 59,
    backgroundColor: '#eaf0f5',
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    minHeight: 60,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f5',
  },
  rowLabel: { flex: 1, color: C.ink, fontSize: 13, fontWeight: '500' },
  language: { padding: 12, borderRadius: 5, backgroundColor: '#f1f4f7' },
});
