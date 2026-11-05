import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { compareVersions } from '@shiv/shared';
import { refreshConfig } from '../../state/catalog';
import { showToast } from '../../state/ui';
import { Button } from '../../ui/Button';
import { Mark } from '../../ui/Icon';
import { Notice } from '../../ui/Notice';
import { C, headingScale, space, T } from '../../ui/tokens';
import { w } from '../../words';

export const appVersion = Constants.expoConfig?.version || '1.0.0';

/**
 * Blocks an app older than the shop's minimum version, so an API change can never strand old installs
 * mid-order. A failed check never blocks: the shop stays usable. It checks again whenever the app
 * returns to the front, so a lowered minimum unblocks it.
 */
export function UpdateGate({ children }: { children: React.ReactNode }) {
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
      const config = await refreshConfig();
      if (!mounted.current || !config) return;
      const { minimumVersion, latestVersion, storeUrl } = config.android;
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
      else showToast(w('update.openFailed'));
    });
  };
  if (required)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: C.ground,
          padding: space[5],
          justifyContent: 'center',
          gap: space[4],
        }}
      >
        <Mark size={48} />
        <Text style={T.display} maxFontSizeMultiplier={headingScale}>
          {w('update.title')}
        </Text>
        <Text style={T.body}>{w('update.body')}</Text>
        <Button icon="logo-google-playstore" onPress={() => openStore(required.storeUrl, true)}>
          {w('update.go')}
        </Button>
        {openFailed ? <Notice tone="error">{w('update.openFailed')}</Notice> : null}
        <Button kind="quiet" loading={checking} onPress={() => void check()}>
          {w('common.retry')}
        </Button>
        <Text style={[T.small, { color: C.ink2 }]}>
          {w('update.version', { version: appVersion })}
        </Text>
      </SafeAreaView>
    );
  return (
    <>
      {children}
      {available && !dismissed ? (
        <View
          style={{
            position: 'absolute',
            top: 64,
            left: space[3],
            right: space[3],
            backgroundColor: C.up,
          }}
        >
          <Notice>{w('update.newer')}</Notice>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              gap: space[3],
              paddingHorizontal: space[3],
            }}
          >
            <Button kind="link" onPress={() => setDismissed(true)}>
              {w('common.notNow')}
            </Button>
            <Button kind="link" onPress={() => openStore(available, false)}>
              {w('update.short')}
            </Button>
          </View>
        </View>
      ) : null}
    </>
  );
}
