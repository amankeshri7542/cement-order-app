import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { AppState, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export type CameraAccess = 'asking' | 'ok' | 'ask' | 'blocked';
export function useCameraAccess(): { access: CameraAccess; ask: () => void } {
  const [permission, request, read] = useCameraPermissions();
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void request();
  }, [permission?.granted, permission?.canAskAgain]);
  // Back from Settings: the switch may have changed.
  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'active') void read();
    });
    return () => listener.remove();
  }, []);
  return {
    access: !permission
      ? 'asking'
      : permission.granted
        ? 'ok'
        : permission.canAskAgain
          ? 'ask'
          : 'blocked',
    ask: () => void request(),
  };
}
export function QrCamera(props: { onCode(text: string): void; torch: boolean; active: boolean }) {
  return (
    <CameraView
      style={StyleSheet.absoluteFill}
      facing="back"
      enableTorch={props.torch}
      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onBarcodeScanned={props.active ? ({ data }) => props.onCode(data) : undefined}
    />
  );
}
export type PhotoHandle = { take(): Promise<string | null> };
export const PhotoCamera = forwardRef<PhotoHandle, { facing: 'front' | 'back' }>(
  function PhotoCamera({ facing }, ref) {
    const camera = useRef<CameraView>(null);
    useImperativeHandle(ref, () => ({
      async take() {
        const picture = await camera.current?.takePictureAsync({ quality: 0.7 });
        if (!picture) return null;
        // Small enough to go over a weak connection, and well inside the server's limit.
        const context = ImageManipulator.manipulate(picture.uri);
        context.resize({ width: 1280 });
        const image = await context.renderAsync();
        const saved = await image.saveAsync({ compress: 0.6, format: SaveFormat.JPEG });
        // The full-size original is not needed, and should not sit on the phone.
        new File(picture.uri).delete();
        return saved.uri;
      },
    }));
    return <CameraView ref={camera} style={StyleSheet.absoluteFill} facing={facing} />;
  },
);
