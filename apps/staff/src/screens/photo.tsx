import { useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../core';
import { useNav } from '../nav';
import { openSettings } from '../platform/location';
import { PhotoCamera, useCameraAccess, type PhotoHandle } from '../platform/camera';
import { Band, Btn, Icon, Screen, Txt } from '../ui';
import { colors, space } from '../ui/tokens';
import { BackBtn, TopBar } from './shell';

/**
 * One photo. Hands it to the next screen, or to whoever asked through a callback. Every photo in
 * the app is taken here, and it also carries the way out when the camera is not there.
 */
export function PhotoScreen({ params }: { params?: Record<string, unknown> }) {
  const { tr } = useApp();
  const nav = useNav();
  const camera = useRef<PhotoHandle>(null);
  const { access, ask } = useCameraAccess();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const insets = useSafeAreaInsets();
  const title = params?.title as string;
  const line = params?.line as string | undefined;
  const skipLabel = params?.skipLabel as string | undefined;
  const next = params?.next as { screen: string; params: Record<string, unknown> } | undefined;
  const onDone = params?.onDone as ((uri: string) => void) | undefined;
  const finish = (photoUri: string | null) => {
    if (onDone && photoUri) {
      onDone(photoUri);
      nav.pop();
      return;
    }
    if (next) nav.replace(next.screen, { ...next.params, ...(photoUri ? { photoUri } : {}) });
    else nav.pop();
  };
  const take = async () => {
    setFailed(false);
    try {
      const taken = await camera.current?.take();
      if (taken) setUri(taken);
      else setFailed(true);
    } catch {
      setFailed(true);
    }
  };
  if (access === 'ask' || access === 'blocked')
    return (
      <Screen
        testID="screen-photo-blocked"
        top={<TopBar />}
        footer={
          <>
            <Btn
              testID="open-settings"
              kind="lamp"
              icon="settings"
              label={tr(access === 'ask' ? 'staff.scan.cameraOn' : 'staff.common.settings')}
              onPress={() => (access === 'ask' ? ask() : void openSettings())}
            />
            {skipLabel ? (
              <Btn
                testID="photo-skip"
                kind="quiet"
                label={skipLabel}
                onPress={() => finish(null)}
              />
            ) : null}
            <BackBtn />
          </>
        }
      >
        <Icon name="camera-off" size={48} />
        <Txt kind="head">{tr('staff.scan.cameraBlockedTitle')}</Txt>
        <Txt>{tr('staff.scan.cameraBlocked')}</Txt>
      </Screen>
    );
  return (
    <View testID="screen-photo" style={{ flex: 1, backgroundColor: colors.night }}>
      {uri ? (
        <Image
          testID="photo-preview"
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          accessibilityLabel={title}
        />
      ) : (
        <PhotoCamera ref={camera} facing={(params?.facing as 'front' | 'back') ?? 'back'} />
      )}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            paddingTop: insets.top + space.sm,
            paddingBottom: Math.max(insets.bottom, space.lg),
            paddingHorizontal: space.lg,
            justifyContent: 'space-between',
          },
        ]}
      >
        <View style={{ paddingTop: space.xl, gap: space.sm }}>
          <Txt kind="head" color={colors.onNight} center>
            {title}
          </Txt>
          {line ? (
            <Txt color={colors.onNight2} center>
              {line}
            </Txt>
          ) : null}
        </View>
        <View style={{ gap: space.sm }}>
          {failed ? <Band tone="danger" text={tr('staff.photo.failed')} /> : null}
          {uri ? (
            <>
              <Btn
                testID="photo-use"
                kind="lamp"
                icon="check"
                label={tr('staff.photo.use')}
                onPress={() => finish(uri)}
              />
              <Btn
                testID="photo-retake"
                kind="line"
                on={colors.onNight}
                label={tr('staff.photo.retake')}
                onPress={() => setUri(null)}
              />
            </>
          ) : (
            <>
              <Btn
                testID="photo-take"
                kind="lamp"
                icon="camera"
                label={tr('staff.photo.take')}
                onPress={() => void take()}
              />
              {skipLabel ? (
                <Btn
                  testID="photo-skip"
                  kind="line"
                  on={colors.onNight}
                  label={skipLabel}
                  onPress={() => finish(null)}
                />
              ) : null}
              <BackBtn />
            </>
          )}
        </View>
      </View>
    </View>
  );
}
