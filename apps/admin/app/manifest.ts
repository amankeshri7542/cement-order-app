import type { MetadataRoute } from 'next';
import { color } from '@shiv/design/tokens';

// Lets Papa and Chacha add the desk to the phone's home screen and receive order alerts.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Shiv Cement Desk',
    short_name: 'Shiv Cement Desk',
    description: 'Orders, quotes, stock and money for Shiv Cement Store.',
    lang: 'hi',
    start_url: '/today',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: color.paper,
    theme_color: color.navy,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
