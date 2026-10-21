/**
 * How long a number waits before another sign-in code can be asked for. The server refuses a
 * sooner request and the app counts this down on its resend button, so both read this one value.
 */
export const otpResendSeconds = 30;
