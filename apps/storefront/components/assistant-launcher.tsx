'use client';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useCommerce } from './commerce';
import { useLanguage } from './language';
const Assistant = dynamic(() => import('./assistant-panel'), { ssr: false });
export function AssistantLauncher() {
  const { t } = useLanguage();
  const { user } = useCommerce();
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    const ask = (event: Event) => {
      setContext((event as CustomEvent<{ id: string; name: string }>).detail);
      setOpen(true);
    };
    window.addEventListener('shiv-ask-material', ask);
    return () => window.removeEventListener('shiv-ask-material', ask);
  }, []);
  return (
    <>
      <button
        className="assistant-launcher"
        aria-haspopup="dialog"
        onClick={(event) => {
          event.currentTarget.focus();
          setContext(null);
          setOpen(true);
        }}
      >
        <span aria-hidden="true">✳</span>
        <span>
          {t('Shiv Assistant', 'शिव सहायक')}
          <small>{t('Material questions? Ask here.', 'सामग्री का सवाल? यहाँ पूछें।')}</small>
        </span>
      </button>
      {open && (
        <Assistant key={user?.id || 'guest'} context={context} close={() => setOpen(false)} />
      )}
    </>
  );
}
export function AskAbout({ id, name }: { id: string; name: string }) {
  const { t } = useLanguage();
  return (
    <button
      className="text-link"
      onClick={(event) => {
        event.currentTarget.focus();
        window.dispatchEvent(new CustomEvent('shiv-ask-material', { detail: { id, name } }));
      }}
    >
      ✳ {t('Ask about this material', 'इस सामग्री के बारे में पूछें')}
    </button>
  );
}
