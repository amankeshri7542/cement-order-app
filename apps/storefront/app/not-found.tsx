import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false } };

export default function NotFound() {
  return (
    <div style={{ padding: 'clamp(32px, 5vw, 72px) var(--m) var(--section)' }}>
      <h1>This page is not here.</h1>
      <p style={{ marginTop: '1rem', fontSize: 'var(--t-3)' }}>
        It may have moved. The rates and materials are still a tap away.
      </p>
      <p style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: '1.25rem' }}>
        <Link className="btn btn-solid" href="/rates">
          See the rates
        </Link>
        <Link className="btn btn-line" href="/materials">
          All materials
        </Link>
      </p>
    </div>
  );
}
