import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { clientConfigSchema, compareVersions, space } from '@shiv/shared';
import { api } from './api';
import { useStore } from './store';
import { Button, C, Notice, Stamp, s } from './ui';

export const appVersion = Constants.expoConfig?.version || '1.0.0';

/**
 * Blocks an app older than the shop's minimum version (set on the server), so an API change can
 * never strand old installs mid-order. A failed check never blocks: the shop stays usable.
 */
export function UpdateGate({ children }: { children: ReactNode }) {
  const { t, languageState } = useStore();
  const [required, setRequired] = useState<{ storeUrl: string } | null>(null);
  const [available, setAvailable] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let active = true;
    void api<unknown>('/client-config')
      .then((value) => {
        const config = clientConfigSchema.safeParse(value);
        if (!active || !config.success) return;
        const { minimumVersion, latestVersion, storeUrl } = config.data.android;
        if (compareVersions(appVersion, minimumVersion) < 0) setRequired({ storeUrl });
        else if (compareVersions(appVersion, latestVersion) < 0) setAvailable(storeUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  if (required && languageState !== 'loading')
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: C.paper,
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
        <Button
          icon="logo-google-playstore"
          onPress={() => void Linking.openURL(required.storeUrl)}
        >
          {t('Update on Google Play', 'Google Play पर अपडेट करें')}
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
              { justifyContent: 'flex-end', backgroundColor: C.stone, paddingBottom: space.xs },
            ]}
          >
            <Button kind="quiet" onPress={() => setDismissed(true)}>
              {t('Later', 'बाद में')}
            </Button>
            <Button kind="quiet" onPress={() => void Linking.openURL(available)}>
              {t('Update', 'अपडेट करें')}
            </Button>
          </View>
        </View>
      ) : null}
    </>
  );
}
