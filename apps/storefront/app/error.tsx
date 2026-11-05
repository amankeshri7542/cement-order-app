'use client';

import Link from 'next/link';

/** Something broke while drawing a page. Never a stack trace; always a way forward. */
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div style={{ padding: 'clamp(32px, 5vw, 72px) var(--m)' }}>
      <h1>This page could not be shown.</h1>
      <p style={{ marginTop: '1rem', fontSize: 'var(--t-3)' }}>Your list is saved on this phone.</p>
      <p style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: '1.25rem' }}>
        <button type="button" className="btn btn-solid" onClick={reset}>
          Try again
        </button>
        <Link className="btn btn-line" href="/">
          Go to the home page
        </Link>
      </p>
    </div>
  );
}
