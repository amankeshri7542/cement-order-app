// Web build, for browser tests only: nothing here reaches an Android bundle. A test hands over a
// scanned code through a hook that only exists when the test switch was set at build time.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

export type CameraAccess = 'asking' | 'ok' | 'ask' | 'blocked';
type TestHost = {
  __staffScan?: (text: string) => void;
  __staffCamera?: CameraAccess;
};
const host = () => globalThis as unknown as TestHost;

export function useCameraAccess(): { access: CameraAccess; ask: () => void } {
  return { access: host().__staffCamera ?? 'ok', ask: () => {} };
}
export function QrCamera(props: { onCode(text: string): void; torch: boolean; active: boolean }) {
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_STAFF_TEST !== '1') return;
    host().__staffScan = (text) => {
      if (latest.current.active) latest.current.onCode(text);
    };
    return () => {
      delete host().__staffScan;
    };
  }, []);
  return (
    <View testID="camera-stub" style={[StyleSheet.absoluteFill, { backgroundColor: '#121513' }]} />
  );
}
export type PhotoHandle = { take(): Promise<string | null> };
export const PhotoCamera = forwardRef<PhotoHandle, { facing: 'front' | 'back' }>(
  function PhotoCamera(_props, ref) {
    useImperativeHandle(ref, () => ({
      async take() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const draw = canvas.getContext('2d');
        if (draw) {
          draw.fillStyle = '#808080';
          draw.fillRect(0, 0, 64, 64);
        }
        return canvas.toDataURL('image/jpeg', 0.8);
      },
    }));
    return (
      <View testID="photo-stub" style={[StyleSheet.absoluteFill, { backgroundColor: '#121513' }]} />
    );
  },
);
