'use client';

import { useReportWebVitals } from 'next/web-vitals';

/** First-party numbers only: no cookies, no IP stored, and nothing but a metric, a page and a tier. */
export function Vitals() {
  useReportWebVitals((metric) => {
    if (!['LCP', 'INP', 'CLS', 'FCP', 'TTFB'].includes(metric.name)) return;
    try {
      navigator.sendBeacon?.(
        '/api/e',
        JSON.stringify({
          name: metric.name,
          value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
          path: location.pathname,
          tier: document.documentElement.getAttribute('data-film') || 'still',
          memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0,
        }),
      );
    } catch {
      /* A lost number costs nothing. */
    }
  });
  return null;
}
