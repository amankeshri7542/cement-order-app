import DeviceKey from '../../modules/device-key';

export const publicKey = () => DeviceKey.publicKey();
export const signText = (message: string) => DeviceKey.sign(message);
/** Time since boot. The user cannot change it, unlike the phone's clock. */
export const mono = () => DeviceKey.elapsedRealtime();
export const bootCount = () => DeviceKey.bootCount();
export const modelInfo = () => ({ model: DeviceKey.model(), sdk: DeviceKey.sdk() });
