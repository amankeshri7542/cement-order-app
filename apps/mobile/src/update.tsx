import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Linking, Platform, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clientConfigSchema, compareVersions, space } from '@shiv/shared';
import { api } from './api';
import { useStore } from './store';
import { Button, C, Notice, Stamp, s } from './ui';

export const appVersion = Constants.expoConfig?.version || '1.0.0';

/**
 * Blocks an app older than the shop's minimum version (set on the server), so an API change can
 * never strand old installs mid-order. A failed check never blocks: the shop stays usable. The
 * check runs again whenever the app returns to the front, so a lowered minimum unblocks it.
 */
export function UpdateGate({ children }: { children: ReactNode }) {
  const { t, languageState, setToast } = useStore();
  const [required, setRequired] = useState<{ storeUrl: string } | null>(null);
  const [available, setAvailable] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const mounted = useRef(true);
  const check = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    setChecking(true);
    try {
      const config = clientConfigSchema.safeParse(await api<unknown>('/client-config'));
      if (!mounted.current || !config.success) return;
      const { minimumVersion, latestVersion, storeUrl } = config.data.android;
      const blocked = compareVersions(appVersion, minimumVersion) < 0;
      setRequired(blocked ? { storeUrl } : null);
      setAvailable(!blocked && compareVersions(appVersion, latestVersion) < 0 ? storeUrl : null);
    } catch {
      // No answer keeps the last result: an unchecked app is never blocked or unblocked.
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => {
      mounted.current = false;
      sub.remove();
    };
  }, [check]);
  const openStore = (url: string, blocking: boolean) => {
    setOpenFailed(false);
    void Linking.openURL(url).catch(() => {
      if (blocking) setOpenFailed(true);
      else
        setToast(
          t(
            'Could not open Google Play. Please update the app from the Play Store.',
            'Google Play नहीं खुल सका। कृपया Play Store से ऐप अपडेट करें।',
          ),
        );
    });
  };
  if (required && languageState !== 'loading')
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: C.ground,
          padding: space.xl,
          justifyContent: 'center',
          gap: space.lg,
        }}
      >
        <Stamp size={64} />
        <Text style={s.h1}>{t('Please update the app', 'कृपया ऐप अपडेट करें')}</Text>
        <Text style={s.body}>
          {t(
            'This version can no longer place orders safely. Updating takes a minute and keeps your basket and orders.',
            'यह संस्करण अब सुरक्षित ऑर्डर नहीं कर सकता। अपडेट में एक मिनट लगेगा, आपकी टोकरी और ऑर्डर बने रहेंगे।',
          )}
        </Text>
        <Button icon="logo-google-playstore" onPress={() => openStore(required.storeUrl, true)}>
          {t('Update on Google Play', 'Google Play पर अपडेट करें')}
        </Button>
        {openFailed ? (
          <Notice error>
            {t(
              'Could not open Google Play. Open the Play Store and search for Shiv Cement Store.',
              'Google Play नहीं खुल सका। Play Store खोलकर Shiv Cement Store खोजें।',
            )}
          </Notice>
        ) : null}
        <Button secondary loading={checking} onPress={() => void check()}>
          {t('Try again', 'फिर कोशिश करें')}
        </Button>
        <Text style={s.small}>
          {t('Installed version', 'लगा हुआ संस्करण')} {appVersion}
        </Text>
      </SafeAreaView>
    );
  return (
    <>
      {children}
      {available && !dismissed && languageState === 'set' ? (
        <View style={{ position: 'absolute', top: 64, left: space.md, right: space.md }}>
          <Notice>
            {t('A newer version of the app is available.', 'ऐप का नया संस्करण उपलब्ध है।')}
          </Notice>
          <View
            style={[
              s.row,
              { justifyContent: 'flex-end', backgroundColor: C.surface, paddingBottom: space.xs },
            ]}
          >
            <Button kind="quiet" onPress={() => setDismissed(true)}>
              {t('Later', 'बाद में')}
            </Button>
            <Button kind="quiet" onPress={() => openStore(available, false)}>
              {t('Update', 'अपडेट करें')}
            </Button>
          </View>
        </View>
      ) : null}
    </>
  );
}
