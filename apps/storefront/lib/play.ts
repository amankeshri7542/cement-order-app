/** Only a real Google Play address for an app is shown to customers. */
export const approvedPlayUrl = (value: string | undefined) =>
  value &&
  /^https:\/\/play\.google\.com\/store\/apps\/details\?id=[A-Za-z0-9._]+(&[\w=%.-]*)?$/.test(value)
    ? value
    : '';

// The app's Google Play address, shown in the footer once the app is published
// (NEXT_PUBLIC_PLAY_URL, set at build time).
export const playUrl = approvedPlayUrl(process.env.NEXT_PUBLIC_PLAY_URL);
