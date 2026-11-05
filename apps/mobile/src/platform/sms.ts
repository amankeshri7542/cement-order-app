import { Platform } from 'react-native';
import { codeFromMessage } from './sms-code';

/**
 * Android can hand the app a sign-in SMS without any SMS permission when the message ends with
 * the app's own hash (the SMS Retriever API). This waits for one such message and passes on its
 * six-digit code. Anything missing (another platform, a phone without Play services, a message
 * without the hash) just leaves the customer typing the code, as before. The module is loaded
 * only here, on Android, so the browser build never touches it.
 */
export function listenForSignInCode(onCode: (code: string) => void): () => void {
  if (Platform.OS !== 'android') return () => {};
  let active = true;
  let listener: typeof import('react-native-otp-verify') | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    listener = require('react-native-otp-verify');
    void listener!
      .startOtpListener((message) => {
        const code = codeFromMessage(String(message));
        if (active && code) onCode(code);
      })
      .catch(() => {});
  } catch {
    return () => {};
  }
  return () => {
    active = false;
    try {
      listener?.removeListener();
    } catch {
      // Nothing to remove.
    }
  };
}
