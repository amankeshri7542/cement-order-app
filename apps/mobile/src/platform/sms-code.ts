// The sign-in code inside an SMS. Plain logic with no React Native imports, so it is unit-tested
// under Node (test/sms-code.test.mjs).

/** The six-digit code in a message, or '' when there is none (longer numbers are not codes). */
export function codeFromMessage(message: string): string {
  return /(?:^|\D)(\d{6})(?!\d)/.exec(message)?.[1] ?? '';
}
