import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { type User } from '@shiv/shared';
import { money } from '../../logic/money';
import { enableOrderPush, pushKeys } from '../../platform/push';
import { api } from '../../state/api';
import { catalogStore } from '../../state/catalog';
import { khataStore } from '../../state/khata';
import { push } from '../../state/nav';
import { say } from '../../state/net';
import { writeSaved } from '../../state/saved';
import { forgetAccount, requireSignIn, sessionStore, setUser, signOut } from '../../state/session';
import { refreshShop, shopStore } from '../../state/shop';
import { sitesStore } from '../../state/sites';
import { showToast } from '../../state/ui';
import { useSelect } from '../../state/use';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Icon, type IconName } from '../../ui/Icon';
import { Notice } from '../../ui/Notice';
import { Screen } from '../../ui/Screen';
import { C, headingScale, space, T, touch } from '../../ui/tokens';
import { w } from '../../words';
import { pushWords } from '../orders/NotifyPrompt';
import { sure } from '../orders/OrderScreen';

const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL || 'http://localhost:3000/privacy';

function Row({
  icon,
  label,
  detail,
  onPress,
}: {
  icon: IconName;
  label: string;
  detail?: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      <Icon name={icon} />
      <Text style={[T.body, styles.flex]}>{label}</Text>
      {detail ? <Text style={[T.rateSmall, styles.quiet]}>{detail}</Text> : null}
      <Icon name="chevron-forward" size={18} />
    </Pressable>
  );
}

export function AccountScreen() {
  const user = useSelect(sessionStore, (state) => state.user);
  const sites = useSelect(sitesStore, (state) => state.items.length);
  const khata = useSelect(khataStore, (state) => state.khata);
  const people = useSelect(khataStore, (state) => state.people.length);
  const shop = useSelect(shopStore, (state) => state);
  const awardsUrl = useSelect(catalogStore, (state) => state.awardsUrl);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? '');
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void refreshShop();
  }, []);
  useEffect(() => setName(user?.name ?? ''), [user?.name]);
  const open = (url: string) =>
    void Linking.openURL(url).catch(() => showToast(w('common.couldNotOpen')));
  async function saveName() {
    setBusy(true);
    setError('');
    try {
      setUser(await api<User>('/me', 'PATCH', { name, language: 'en' }));
      setEditing(false);
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  }
  async function notifications() {
    if (Platform.OS !== 'android') return showToast(w('push.always'));
    const result = await enableOrderPush(w('push.channel'));
    if (result === 'on' && user) await writeSaved(pushKeys.on(user.id), true).catch(() => {});
    showToast(pushWords(result));
  }
  async function signOutOthers() {
    if (
      !(await sure(w('account.signOutOthersSure'), w('account.signOutOthers'), w('common.notNow')))
    )
      return;
    try {
      await api('/auth/sessions/revoke-others', 'POST', {});
      showToast(w('account.signedOutOthers'));
    } catch (e) {
      showToast(say(e));
    }
  }
  async function deleteAccount() {
    setBusy(true);
    setError('');
    try {
      await api('/me/delete', 'POST', { confirmation });
      await forgetAccount();
      showToast(w('account.deleted'));
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text style={T.display} accessibilityRole="header" maxFontSizeMultiplier={headingScale}>
            {user ? user.name || w('account.welcome') : w('tabs.account')}
          </Text>
          {user ? <Text style={[T.body, styles.quiet]}>{user.phone}</Text> : null}
        </View>
        {user ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={w('account.editName')}
            onPress={() => setEditing((old) => !old)}
            style={styles.icon}
          >
            <Icon name="create-outline" />
          </Pressable>
        ) : null}
      </View>
      {editing ? (
        <View style={styles.group}>
          <Field label={w('account.name')} value={name} maxLength={100} onChangeText={setName} />
          <Button loading={busy} disabled={!name.trim()} onPress={() => void saveName()}>
            {w('common.save')}
          </Button>
        </View>
      ) : null}
      {!user ? (
        <Button onPress={() => requireSignIn(() => {})}>{w('account.signIn')}</Button>
      ) : null}
      {user?.role === 'ADMIN' ? <Notice>{w('account.staff')}</Notice> : null}
      {user ? (
        <View style={styles.rows}>
          {khata.available ? (
            <>
              <Row
                icon="wallet-outline"
                label={w('udhaar.title')}
                detail={money(khata.balancePaise)}
                onPress={() => push({ screen: 'udhaar' })}
              />
              <Row
                icon="people-outline"
                label={w('people.title')}
                detail={people ? String(people) : undefined}
                onPress={() => push({ screen: 'people' })}
              />
            </>
          ) : null}
          <Row
            icon="location-outline"
            label={w('sites.title')}
            detail={sites ? String(sites) : undefined}
            onPress={() => push({ screen: 'sites' })}
          />
          <Row
            icon="notifications-outline"
            label={w('push.row')}
            onPress={() => void notifications()}
          />
        </View>
      ) : null}
      {shop.phone || shop.whatsapp ? (
        <View style={styles.group}>
          <Text style={T.bodyStrong}>{w('account.talk')}</Text>
          <View style={styles.talk}>
            {shop.phone ? (
              <Button
                kind="quiet"
                icon="call-outline"
                style={styles.flex}
                onPress={() => open(`tel:${shop.phone}`)}
              >
                {w('account.call')}
              </Button>
            ) : null}
            {shop.whatsapp ? (
              <Button
                kind="quiet"
                icon="logo-whatsapp"
                style={styles.flex}
                onPress={() => open(`https://wa.me/${shop.whatsapp.replace(/\D/g, '')}`)}
              >
                WhatsApp
              </Button>
            ) : null}
          </View>
        </View>
      ) : null}
      {user ? (
        <View style={styles.rows}>
          <Row
            icon="shield-checkmark-outline"
            label={w('account.signOutOthers')}
            onPress={() => void signOutOthers()}
          />
          <Row
            icon="log-out-outline"
            label={w('account.signOut')}
            onPress={() => {
              void sure(w('account.signOutSure'), w('account.signOut'), w('account.stay')).then(
                (yes) => {
                  if (yes) void signOut();
                },
              );
            }}
          />
        </View>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <View style={styles.links}>
        <Button kind="link" onPress={() => open(privacyUrl)}>
          {w('account.privacy')}
        </Button>
        {awardsUrl ? (
          <Button kind="link" onPress={() => open(awardsUrl)}>
            {w('account.awards')}
          </Button>
        ) : null}
        {user ? (
          <Button kind="link" onPress={() => setDeleting((old) => !old)}>
            {w('account.delete')}
          </Button>
        ) : null}
      </View>
      {deleting ? (
        <View style={styles.group}>
          <Notice>{w('account.deleteExplain')}</Notice>
          <Field
            label={w('account.deleteType')}
            value={confirmation}
            onChangeText={setConfirmation}
            autoCapitalize="characters"
          />
          <Button
            loading={busy}
            disabled={confirmation !== 'DELETE'}
            onPress={() => void deleteAccount()}
          >
            {w('account.deleteConfirm')}
          </Button>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  quiet: { color: C.ink2 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  icon: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  rows: { gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 56,
    paddingHorizontal: space[3],
    backgroundColor: C.up,
  },
  group: { backgroundColor: C.up, padding: space[3], gap: space[3] },
  talk: { flexDirection: 'row', gap: space[2] },
  links: { alignItems: 'center' },
});
