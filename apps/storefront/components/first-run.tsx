'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { z } from 'zod';
import {
  firstOrderSteps,
  firstRunKeys,
  isPincode,
  nextSteps,
  pick,
  type Order,
  type Page,
  type User,
} from '@shiv/shared';
import { publicGet } from '../lib/api';
import { customerApi, errorText } from '../lib/customer-api';
import { useCommerce } from './commerce';
import { useLanguage } from './language';

// First-run guidance on the website, matching the Android app: the remembered pincode, the
// "first order in 3 steps" card, the one-time name question and "what happens next" after an
// order. The words come from packages/shared/src/first-run.ts.

const pincodeEvent = 'shiv-pincode';
function readKey(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeKey(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* A hint only: the page works without it. */
  }
}
function subscribePincode(change: () => void) {
  window.addEventListener(pincodeEvent, change);
  window.addEventListener('storage', change);
  return () => {
    window.removeEventListener(pincodeEvent, change);
    window.removeEventListener('storage', change);
  };
}
/** The last pincode checked on this device ('' before hydration or when none). */
export function useSavedPincode() {
  const pincode = useSyncExternalStore(
    subscribePincode,
    () => {
      const saved = readKey(firstRunKeys.pincode);
      return isPincode(saved) ? saved : '';
    },
    () => '',
  );
  const remember = useCallback((value: string | null) => {
    writeKey(firstRunKeys.pincode, value && isPincode(value) ? value : null);
    window.dispatchEvent(new Event(pincodeEvent));
  }, []);
  return [pincode, remember] as const;
}

const shopContact = z.object({
  contactApproved: z.boolean(),
  phone: z.string(),
  whatsapp: z.string(),
});
let contactRequest: Promise<z.infer<typeof shopContact> | null> | null = null;
/** Call and WhatsApp appear only once the family approved the number (public-content.ts). */
export function useShopContact() {
  const [contact, setContact] = useState<{ phone: string; whatsapp: string } | null>(null);
  useEffect(() => {
    let active = true;
    contactRequest ??= publicGet('/shop-content', shopContact).catch(() => {
      contactRequest = null;
      return null;
    });
    void contactRequest.then((shop) => {
      const valid = (value?: string) => (value && /^\+91[6-9]\d{9}$/.test(value) ? value : '');
      if (active && shop?.contactApproved && (valid(shop.phone) || valid(shop.whatsapp)))
        setContact({ phone: valid(shop.phone), whatsapp: valid(shop.whatsapp) });
    });
    return () => {
      active = false;
    };
  }, []);
  return contact;
}

/** Whether the signed-in customer has any order: null while unknown (and for guests: false). */
function useHasOrder() {
  const c = useCommerce();
  const id = c.user?.id;
  const [state, setState] = useState<{ id?: string; has: boolean | null }>({ has: null });
  useEffect(() => {
    if (!c.ready) return;
    if (!id) {
      setState({ has: false });
      return;
    }
    let active = true;
    setState({ id, has: null });
    void customerApi<Page<Order>>('/orders?limit=1', 'GET', undefined, id)
      .then((page) => {
        if (active) setState({ id, has: page.items.length > 0 });
      })
      // Unknown stays hidden: an error here must not show a beginner card to a regular customer.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [c.ready, id]);
  return state.id === id ? state.has : null;
}

/** "Your first order in 3 steps" on the home page, until an order exists or it is closed. */
export function FirstOrderCard() {
  const { t, language } = useLanguage();
  const hasOrder = useHasOrder();
  const closed = useSyncExternalStore(
    subscribePincode,
    () => readKey(firstRunKeys.firstOrderTip) === '1',
    () => true,
  );
  if (closed || hasOrder !== false) return null;
  return (
    <section className="first-order" aria-labelledby="first-order-title">
      <div className="first-order-head">
        <h2 id="first-order-title">{t('Your first order in 3 steps', 'पहला ऑर्डर, 3 आसान कदम')}</h2>
        <button
          type="button"
          className="first-order-close"
          aria-label={t('Hide these steps', 'ये कदम छिपाएँ')}
          onClick={() => {
            writeKey(firstRunKeys.firstOrderTip, '1');
            window.dispatchEvent(new Event(pincodeEvent));
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <ol>
        {firstOrderSteps.map((step, index) => (
          <li key={index}>
            <strong>{pick(language, step.title)}</strong>
            <span>{pick(language, step.body)}</span>
          </li>
        ))}
      </ol>
      <div className="first-order-actions">
        <Link className="button" href="/products">
          {t('Choose materials', 'सामग्री चुनें')} <span aria-hidden="true">→</span>
        </Link>
        <a className="text-link" href="#delivery">
          {t('Check your pincode', 'अपना पिनकोड जाँचें')}
        </a>
      </div>
    </section>
  );
}

/**
 * Asked once after the first sign-in when the account has no name: one field, skippable. The
 * name greets the customer and fills the "person receiving" on new addresses.
 */
export function needsName(user: User) {
  return (
    user.role !== 'ADMIN' && !user.name.trim() && readKey(firstRunKeys.nameAsked(user.id)) !== '1'
  );
}
export function NameStep({ user, done }: { user: User; done: () => void }) {
  const c = useCommerce();
  const { t, language } = useLanguage();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const finish = () => {
    writeKey(firstRunKeys.nameAsked(user.id), '1');
    done();
  };
  async function save() {
    const value = name.trim();
    if (!value || value.length > 100) {
      setProblem(t('Enter your name, up to 100 letters.', 'अपना नाम लिखें, 100 अक्षरों तक।'));
      return;
    }
    setBusy(true);
    setProblem('');
    try {
      await customerApi<User>('/me', 'PATCH', { name: value, language }, user.id);
      await c.refresh().catch(() => {});
      finish();
    } catch (e) {
      setProblem(errorText(e, language === 'hi'));
      setBusy(false);
    }
  }
  return (
    <form
      className="name-step"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      aria-labelledby="name-step-title"
    >
      <h2 id="name-step-title">{t('What should we call you?', 'आपका नाम क्या है?')}</h2>
      <p>
        {t(
          'We use it to greet you and as the person receiving on new addresses. You can change it later in your account.',
          'इससे हम आपको नाम से बुलाएँगे और नए पते पर सामान लेने वाले का नाम भरेंगे। बाद में खाते में बदल सकते हैं।',
        )}
      </p>
      <label htmlFor="first-name">{t('Your name', 'आपका नाम')}</label>
      <input
        id="first-name"
        autoComplete="name"
        maxLength={100}
        value={name}
        disabled={busy}
        aria-invalid={Boolean(problem)}
        aria-describedby={problem ? 'name-step-problem' : undefined}
        onChange={(event) => setName(event.target.value)}
      />
      {problem ? (
        <p id="name-step-problem" role="alert" className="field-problem">
          {problem}
        </p>
      ) : null}
      <div className="action-row">
        <button className="button" disabled={busy}>
          {busy ? t('Saving…', 'सहेज रहे हैं…') : t('Save and continue', 'सहेजें और आगे बढ़ें')}
        </button>
        <button type="button" className="text-link" disabled={busy} onClick={finish}>
          {t('Skip for now', 'अभी छोड़ें')}
        </button>
      </div>
    </form>
  );
}

/** What happens after an order, from its real status. No times are promised. */
export function NextSteps({ order, placed }: { order: Order; placed?: boolean }) {
  const { t, language } = useLanguage();
  const contact = useShopContact();
  const steps = nextSteps(order);
  if (!steps) return null;
  return (
    <section className="next-steps" aria-labelledby={`next-${order.id}`}>
      {placed ? (
        <p className="next-steps-placed" role="status">
          {t(`Order ${order.number} is placed.`, `ऑर्डर ${order.number} हो गया।`)}
        </p>
      ) : null}
      <h2 id={`next-${order.id}`}>{t('What happens next', 'आगे क्या होगा')}</h2>
      <ol>
        {steps.map((step, index) => (
          <li
            key={step.key}
            className={`step-${step.state}`}
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <span className="step-mark" aria-hidden="true">
              {step.state === 'done' ? '✓' : index + 1}
            </span>
            <div>
              <strong>{pick(language, step.title)}</strong>
              <span className="sr-only">
                {step.state === 'done'
                  ? t('Done.', 'हो गया।')
                  : step.state === 'current'
                    ? t('Now.', 'अभी।')
                    : t('Next.', 'आगे।')}
              </span>
              {step.state !== 'done' ? <p>{pick(language, step.body)}</p> : null}
            </div>
          </li>
        ))}
      </ol>
      {contact ? (
        <div className="action-row">
          {contact.phone ? (
            <a className="button secondary" href={`tel:${contact.phone}`}>
              {t('Call the shop', 'दुकान पर फ़ोन करें')}
            </a>
          ) : null}
          {contact.whatsapp ? (
            <a
              className="button secondary"
              href={`https://wa.me/${contact.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(
                t(`About my order ${order.number}`, `मेरे ऑर्डर ${order.number} के बारे में`),
              )}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              WhatsApp
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
