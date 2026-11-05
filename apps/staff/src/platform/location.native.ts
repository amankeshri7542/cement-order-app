import { Linking } from 'react-native';
import * as Location from 'expo-location';
import type { Fix, FixState, LocationStatus } from '../logic/capture';

const toFix = (position: Location.LocationObject): Fix => ({
  lat: position.coords.latitude,
  lng: position.coords.longitude,
  accuracyM: position.coords.accuracy,
  mocked: position.mocked === true,
});
/** A permission or a switch. Asked once; after that the screen names the exact switch. */
async function status(ask: boolean): Promise<LocationStatus> {
  let permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted && permission.canAskAgain && ask)
    permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return 'DENIED';
  if (!(await Location.hasServicesEnabledAsync())) return 'GPS_OFF';
  return permission.android?.accuracy === 'coarse' ? 'APPROXIMATE' : 'OK';
}
export type FixHandler = (state: FixState) => void;
/** Reads while the hazri screen is open and stops with it. No background permission exists. */
export async function watchLocation(onFix: FixHandler): Promise<() => void> {
  const state = await status(true);
  if (state === 'DENIED' || state === 'GPS_OFF') {
    onFix({ status: state, fix: null });
    return () => {};
  }
  const last = await Location.getLastKnownPositionAsync({
    maxAge: 120000,
    requiredAccuracy: 500,
  }).catch(() => null);
  if (last) onFix({ status: state, fix: toFix(last) });
  const watch = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 0 },
    (position) => onFix({ status: state, fix: toFix(position) }),
  );
  return () => watch.remove();
}
/** One reading at a driver's tap, with a limit, so a step is never held up by the sky. */
export async function readLocationOnce(capMs: number): Promise<FixState> {
  const state = await status(false);
  if (state === 'DENIED' || state === 'GPS_OFF') return { status: state, fix: null };
  const last = await Location.getLastKnownPositionAsync({
    maxAge: 60000,
    requiredAccuracy: 500,
  }).catch(() => null);
  if (last) return { status: state, fix: toFix(last) };
  const timer = new Promise<null>((resolve) => setTimeout(() => resolve(null), capMs));
  const reading = Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  }).catch(() => null);
  const position = await Promise.race([reading, timer]);
  return { status: state, fix: position ? toFix(position) : null };
}
/** Asks once at the first driver tap, so a later step can read without asking. */
export async function askLocation() {
  await status(true).catch(() => null);
}
export const openSettings = () => Linking.openSettings();
/** The phone's own location switch, which is not one of this app's settings. */
export const openLocationSwitch = () =>
  Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() =>
    Linking.openSettings(),
  );
