import { requireNativeModule } from 'expo-modules-core';

type DeviceKeyNative = {
  /** SPKI, base64. Makes the key the first time it is asked for. */
  publicKey(): Promise<string>;
  /** SHA256withECDSA over the UTF-8 bytes of the text. DER, base64. */
  sign(message: string): Promise<string>;
  deleteKey(): Promise<void>;
  elapsedRealtime(): number;
  bootCount(): number;
  model(): string;
  sdk(): number;
};

export default requireNativeModule<DeviceKeyNative>('DeviceKey');
