import type { ReactNode } from 'react';

// No loading.tsx here on purpose: without one, Next does not prefetch these dynamic routes, which
// stops a page full of links from sending thirty requests.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return children;
}
