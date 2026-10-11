// Internal content-review notes are visible in development and in builds that opt in with
// NEXT_PUBLIC_CONTENT_REVIEW=on. A normal production build never shows them to customers.
export const contentReview =
  process.env.NEXT_PUBLIC_CONTENT_REVIEW === 'on' || process.env.NODE_ENV !== 'production';
