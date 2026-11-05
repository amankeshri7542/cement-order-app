export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace(
  /\/$/,
  '',
);

/** An approved product photo: https, on the asset host, in the one path uploads are stored under. */
export function approvedPhoto(images: readonly string[]): string | null {
  const configured = process.env.NEXT_PUBLIC_ASSET_ORIGIN;
  if (!configured) return null;
  try {
    const allowed = new URL(configured);
    if (allowed.protocol !== 'https:') return null;
    return (
      images.find((value) => {
        const url = new URL(value);
        return (
          url.origin === allowed.origin &&
          !url.username &&
          !url.password &&
          /^\/products\/[a-f0-9-]{36}\.webp$/.test(url.pathname) &&
          !url.search &&
          !url.hash
        );
      }) ?? null
    );
  } catch {
    return null;
  }
}
