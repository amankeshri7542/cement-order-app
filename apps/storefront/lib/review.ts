// Placeholders and review notes show in development and in builds that opt in with
// NEXT_PUBLIC_CONTENT_REVIEW=on. A normal production build never shows them to customers.
export const reviewOn = (env: { NEXT_PUBLIC_CONTENT_REVIEW?: string; NODE_ENV?: string }) =>
  env.NEXT_PUBLIC_CONTENT_REVIEW === 'on' || env.NODE_ENV !== 'production';
export const contentReview = reviewOn({
  NEXT_PUBLIC_CONTENT_REVIEW: process.env.NEXT_PUBLIC_CONTENT_REVIEW,
  NODE_ENV: process.env.NODE_ENV,
});

/**
 * Unsigned guide drafts: for a private review build only. A site search engines may read is the
 * customers' site, so drafts never show there, whatever else was set.
 */
export const draftsVisible = (review: boolean, indexing: boolean) => review && !indexing;
