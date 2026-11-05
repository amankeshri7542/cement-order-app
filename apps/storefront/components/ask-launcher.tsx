'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import s from './ask-sheet.module.css';

const AskPanel = dynamic(() => import('./ask-panel'), {
  ssr: false,
  loading: () => (
    <p role="status" aria-live="polite">
      Opening…
    </p>
  ),
});

type Opened = { seed: string; sendNow: boolean; productId?: string };

/**
 * Links marked data-ask open Ask in a sheet instead of leaving the page. The panel's code loads on
 * that first tap, so a page nobody asks from pays nothing for it. With no JavaScript the link just
 * goes to /ask.
 */
export function AskLauncher() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.<HTMLElement>('[data-ask]');
      if (!link || event.metaKey || event.ctrlKey) return;
      // The Ask page has its own box. A sheet over it would be the same thing twice.
      if (location.pathname === '/ask') return;
      event.preventDefault();
      returnTo.current = link;
      setOpened({
        seed: link.dataset.askSeed ?? '',
        sendNow: link.hasAttribute('data-ask-send'),
        productId: link.dataset.askProduct,
      });
    };
    // Before React's handler, or the link would also navigate behind the sheet.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  useEffect(() => {
    if (opened && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [opened]);
  if (!opened) return null;
  const close = () => {
    dialog.current?.close();
    setOpened(null);
    returnTo.current?.focus();
  };
  return (
    <dialog ref={dialog} className={s.dialog} aria-label="Ask" onCancel={close} onClose={close}>
      <div className={s.dialogHead}>
        <b>Ask</b>
        <button type="button" className="btn btn-quiet" onClick={close}>
          Close
        </button>
      </div>
      <AskPanel seed={opened.seed} sendNow={opened.sendNow} productId={opened.productId} />
    </dialog>
  );
}

/** The panel on its own page, /ask. */
export function AskInline({ seed, productId }: { seed?: string; productId?: string }) {
  return <AskPanel seed={seed} productId={productId} />;
}
