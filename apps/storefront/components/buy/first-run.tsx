'use client';
import { useEffect, useState } from 'react';
import type { Order, User } from '@shiv/shared';
import { firstRunKeys, nextSteps } from '@shiv/shared/src/first-run';
import { pick } from '@shiv/shared/src/i18n';
import { API_URL } from '../../lib/api';
import { customerApi, errorText } from '../../lib/customer-api';
import { savePincode, readPincode } from '../../lib/pincode';
import { useCommerce } from './commerce';
const language = 'en' as const;

// First-run guidance on the website, matching the Android app: the one-time name question and
// "what happens next" after an order. The words come from packages/shared/src/first-run.ts.

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
/** The last pincode checked on this device ('' before it can be read, or when none). */
export function useSavedPincode() {
  const [pincode, setPincode] = useState('');
  useEffect(() => setPincode(readPincode()), []);
  const remember = (value: string | null) => {
    if (value) savePincode(value);
    else writeKey(firstRunKeys.pincode, null);
    setPincode(value ?? '');
  };
  return [pincode, remember] as const;
}

type ShopContact = { contactApproved?: boolean; phone?: string; whatsapp?: string };
let contactRequest: Promise<ShopContact | null> | null = null;
/** Call and WhatsApp appear only once the family approved the number. */
export function useShopContact() {
  const [contact, setContact] = useState<{ phone: string; whatsapp: string } | null>(null);
  useEffect(() => {
    let active = true;
    const request = (contactRequest ??= fetch(`${API_URL}/public/shop`, { credentials: 'omit' })
      .then((response) => (response.ok ? (response.json() as Promise<ShopContact>) : null))
      .catch(() => {
        contactRequest = null;
        return null;
      }));
    void request.then((shop) => {
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
      setProblem('Enter your name, up to 100 letters.');
      return;
    }
    setBusy(true);
    setProblem('');
    try {
      await customerApi<User>('/me', 'PATCH', { name: value, language }, user.id);
      await c.refresh().catch(() => {});
      finish();
    } catch (e) {
      setProblem(errorText(e));
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
      <h2 id="name-step-title">What should we call you?</h2>
      <p>
        We use it to greet you and as the person receiving on new addresses. You can change it later
        in your account.
      </p>
      <label htmlFor="first-name">Your name</label>
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
          {busy ? 'Saving…' : 'Save and continue'}
        </button>
        <button type="button" className="text-link" disabled={busy} onClick={finish}>
          Skip for now
        </button>
      </div>
    </form>
  );
}

/** What happens after an order, from its real status. No times are promised. */
export function NextSteps({ order, placed }: { order: Order; placed?: boolean }) {
  const contact = useShopContact();
  const steps = nextSteps(order);
  if (!steps) return null;
  return (
    <section className="next-steps" aria-labelledby={`next-${order.id}`}>
      {placed ? (
        <p className="next-steps-placed" role="status">
          {`Order ${order.number} is placed.`}
        </p>
      ) : null}
      <h2 id={`next-${order.id}`}>What happens next</h2>
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
                {step.state === 'done' ? 'Done.' : step.state === 'current' ? 'Now.' : 'Next.'}
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
              Call the shop
            </a>
          ) : null}
          {contact.whatsapp ? (
            <a
              className="button secondary"
              href={`https://wa.me/${contact.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(
                `About my order ${order.number}`,
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
