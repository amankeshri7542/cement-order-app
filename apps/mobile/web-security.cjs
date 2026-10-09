module.exports = function securityHeaders(dev = false) {
  const api = new URL(process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000/api/v1').origin;
  const asset = process.env.EXPO_PUBLIC_ASSET_ORIGIN
    ? new URL(process.env.EXPO_PUBLIC_ASSET_ORIGIN).origin
    : '';
  if (!dev && (!api.startsWith('https:') || (asset && !asset.startsWith('https:'))))
    throw new Error('Production frontend origins require HTTPS');
  return {
    'Content-Security-Policy': `default-src 'self'; script-src 'self' https://checkout.razorpay.com${dev ? " 'unsafe-inline' 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${asset}; font-src 'self' data:; connect-src 'self' ${api} https://api.razorpay.com${dev ? ' ws://localhost:* ws://127.0.0.1:*' : ''}; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; frame-src https://api.razorpay.com https://checkout.razorpay.com${dev ? '' : '; upgrade-insecure-requests'}`,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...(dev ? {} : { 'Strict-Transport-Security': 'max-age=31536000' }),
  };
};
