// Web build, for browser tests only: a test says what the phone's GPS would report. Android reads
// the real thing (see location.native.ts).
import type { FixState } from '../logic/capture';

export type FixHandler = (state: FixState) => void;
type TestWindow = { __staffFix?: FixState; __staffSettingsOpened?: number };
const testWindow = () => globalThis as unknown as TestWindow;
const current = (): FixState => testWindow().__staffFix ?? { status: 'OK', fix: null };

export async function watchLocation(onFix: FixHandler): Promise<() => void> {
  onFix(current());
  const timer = setInterval(() => onFix(current()), 200);
  return () => clearInterval(timer);
}
export const readLocationOnce = async (_capMs: number) => current();
export const askLocation = async () => {};
export const openSettings = async () => {
  testWindow().__staffSettingsOpened = (testWindow().__staffSettingsOpened ?? 0) + 1;
};
export const openLocationSwitch = openSettings;
