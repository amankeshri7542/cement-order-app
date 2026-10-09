'use client';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Address, AddressInput, User } from '@shiv/shared';
import { addressSchema } from '@shiv/shared';
import { customerApi } from '../lib/customer-api';
import { useCommerce } from './commerce';
import { useLanguage } from './language';

export function AccountRequired({ children }: { children: ReactNode }) {
  const c = useCommerce();
  const { t } = useLanguage();
  if (!c.ready)
    return (
      <p className="loading-state" role="status">
        {t('Restoring your session…', 'आपका सत्र वापस ला रहे हैं…')}
      </p>
    );
  if (!c.user)
    return (
      <section className="account-gate">
        <p className="eyebrow">{t('YOUR CUSTOMER ACCOUNT', 'आपका ग्राहक खाता')}</p>
        <h1>{t('Pick up where you left off.', 'जहाँ रुके थे, वहीं से शुरू करें।')}</h1>
        <p>
          {t(
            'Sign in to use your saved addresses, basket, orders and quotations. Your guest materials stay on this device.',
            'सहेजे पते, टोकरी, ऑर्डर और भाव के लिए साइन इन करें। बिना साइन इन की सामग्री इस उपकरण पर बनी रहेगी।',
          )}
        </p>
        <Link className="button" href="/account">
          {t('Sign in', 'साइन इन करें')}
        </Link>
      </section>
    );
  if (c.user.role === 'ADMIN')
    return (
      <section className="account-gate">
        <h1>{t('Use your customer account.', 'ग्राहक खाता इस्तेमाल करें।')}</h1>
        <p>
          {t(
            'The owner desk has separate staff controls. Sign out here to shop with a customer phone number.',
            'मालिक के पटल पर कर्मचारी नियंत्रण अलग हैं। ग्राहक नंबर से खरीदने के लिए यहाँ साइन आउट करें।',
          )}
        </p>
        <button className="button" onClick={() => void c.signout()}>
          {t('Sign out', 'साइन आउट करें')}
        </button>
      </section>
    );
  return <Fragment key={c.user.id}>{children}</Fragment>;
}
export function AccountPage() {
  const c = useCommerce();
  const { t } = useLanguage();
  const router = useRouter();
  const params = useSearchParams();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const account = useRef(c.user?.id);
  account.current = c.user?.id;
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  async function submit() {
    const current = ++request.current;
    const owner = account.current;
    let target = owner;
    setBusy(true);
    c.setError('');
    try {
      const number = phone.startsWith('+91') ? phone : `+91${phone}`;
      if (!sent) {
        const result = await customerApi<{ devCode?: string }>('/auth/otp/request', 'POST', {
          phone: number,
        });
        if (request.current !== current || account.current !== owner) return;
        setSent(true);
        setDevCode(result.devCode || '');
      } else {
        const result = await customerApi<{ user: User }>('/auth/otp/verify', 'POST', {
          phone: number,
          code,
        });
        if (request.current !== current || account.current !== owner) return;
        target = result.user.id;
        await c.signedIn(result.user);
        if (request.current !== current || (account.current && account.current !== result.user.id))
          return;
        const next = params.get('next');
        router.push(
          next && ['/cart', '/checkout', '/quotes', '/orders'].includes(next) ? next : '/cart',
        );
      }
    } catch (e) {
      if (request.current === current && account.current === target) c.showError(e);
    } finally {
      if (request.current === current) setBusy(false);
    }
  }
  return (
    <div className="account-page">
      <div className="page-heading">
        <p className="eyebrow">{t('SHIV CEMENT · YOUR ACCOUNT', 'शिव सीमेंट · आपका खाता')}</p>
        <h1>{t('Your next project, together.', 'आपका अगला काम, साथ मिलकर।')}</h1>
      </div>
      {c.user ? (
        <>
          <section className="account-summary">
            <h2>{c.user.name || t('Welcome back', 'फिर स्वागत है')}</h2>
            <p>{c.user.phone}</p>
            <div className="action-row">
              <Link className="button" href="/orders">
                {t('Your orders', 'आपके ऑर्डर')}
              </Link>
              <Link className="button secondary" href="/quotes">
                {t('Your quotations', 'आपके भाव')}
              </Link>
              <button className="text-link" disabled={c.busy} onClick={() => void c.signout()}>
                {t('Sign out', 'साइन आउट करें')}
              </button>
            </div>
          </section>
          <AccountRequired>
            <AddressBook />
          </AccountRequired>
        </>
      ) : (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h2>{t('Sign in with your phone', 'अपने फ़ोन से साइन इन करें')}</h2>
          <p>
            {t(
              'Your basket and requests use the same account as the customer app.',
              'आपकी टोकरी और अनुरोध ग्राहक ऐप वाले खाते में ही रहते हैं।',
            )}
          </p>
          <label>
            {t('Mobile number', 'मोबाइल नंबर')}
            <input
              type="tel"
              autoComplete="tel"
              placeholder="9876543210"
              required
              pattern="(\+91)?[6-9][0-9]{9}"
              disabled={!c.ready || sent || busy}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          {sent && (
            <>
              <label>
                {t('Six-digit code', 'छह अंकों का कोड')}
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
              {devCode && (
                <p className="local-notice">
                  {t(
                    'Local test only. No SMS sent. Test code:',
                    'केवल स्थानीय परीक्षण। SMS नहीं भेजा गया। परीक्षण कोड:',
                  )}{' '}
                  <strong>{devCode}</strong>
                </p>
              )}
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  request.current++;
                  setBusy(false);
                  setSent(false);
                  setCode('');
                  setDevCode('');
                }}
              >
                {t('Change phone / resend code', 'नंबर बदलें / फिर कोड भेजें')}
              </button>
            </>
          )}
          <button className="button" disabled={!c.ready || busy}>
            {busy
              ? t('Please wait…', 'कृपया रुकें…')
              : sent
                ? t('Verify and continue', 'जाँचें और जारी रखें')
                : t('Get sign-in code', 'साइन इन कोड पाएँ')}
          </button>
        </form>
      )}
    </div>
  );
}
const blank: AddressInput = {
  label: 'Home',
  name: '',
  phone: '',
  line1: '',
  area: '',
  city: 'Patna',
  state: 'Bihar',
  pincode: '',
  landmark: '',
};
export function AddressBook({
  selected,
  onSelect,
  onChange,
}: {
  selected?: string;
  onSelect?: (id: string) => void;
  onChange?: () => void;
}) {
  const c = useCommerce();
  const { t } = useLanguage();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [form, setForm] = useState<AddressInput | null>(null);
  const [editing, setEditing] = useState('');
  const [busy, setBusy] = useState(false);
  const id = c.user?.id;
  const account = useRef(id);
  account.current = id;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => mounted.current && account.current === id;
  useEffect(() => {
    let active = true;
    setAddresses([]);
    if (id)
      void customerApi<Address[]>('/me/addresses', 'GET', undefined, id)
        .then((items) => {
          if (active) setAddresses(items);
        })
        .catch((error) => {
          if (active) c.showError(error);
        });
    return () => {
      active = false;
    };
  }, [id, c.showError]);
  async function save() {
    if (!form || !id) return;
    setBusy(true);
    try {
      const parsed = addressSchema.safeParse({
        ...form,
        phone: form.phone.startsWith('+91') ? form.phone : `+91${form.phone}`,
      });
      if (!parsed.success)
        throw new Error(
          t(
            'Check every required field, phone and six-digit pincode.',
            'हर ज़रूरी जानकारी, नंबर और छह अंकों का पिनकोड जाँचें।',
          ),
        );
      const address = await customerApi<Address>(
        editing ? `/me/addresses/${editing}` : '/me/addresses',
        editing ? 'PATCH' : 'POST',
        parsed.data,
        id,
      );
      if (!current()) return;
      const items = await customerApi<Address[]>('/me/addresses', 'GET', undefined, id);
      if (!current()) return;
      setAddresses(items);
      setForm(null);
      setEditing('');
      onChange?.();
      onSelect?.(address.id);
    } catch (e) {
      if (current()) c.showError(e);
    } finally {
      if (current()) setBusy(false);
    }
  }
  async function remove(address: Address) {
    if (!id || !window.confirm(t('Remove this saved address?', 'यह सहेजा पता हटाएँ?'))) return;
    setBusy(true);
    try {
      await customerApi(`/me/addresses/${address.id}`, 'DELETE', undefined, id);
      if (!current()) return;
      setAddresses((old) => old.filter((item) => item.id !== address.id));
      if (selected === address.id) onSelect?.('');
      onChange?.();
    } catch (e) {
      if (current()) c.showError(e);
    } finally {
      if (current()) setBusy(false);
    }
  }
  const fields: [keyof AddressInput, string, string][] = [
    ['label', 'Address label', 'पते का नाम'],
    ['name', 'Recipient name', 'पाने वाले का नाम'],
    ['phone', 'Recipient phone', 'पाने वाले का फ़ोन'],
    ['line1', 'House / street / site', 'घर / सड़क / काम की जगह'],
    ['area', 'Area', 'इलाका'],
    ['city', 'City', 'शहर'],
    ['pincode', 'Pincode', 'पिनकोड'],
    ['landmark', 'Landmark (optional)', 'पहचान (वैकल्पिक)'],
  ];
  return (
    <section className="address-book">
      <div className="section-heading">
        <h2>{t('Delivery addresses', 'डिलीवरी के पते')}</h2>
        <button
          className="text-link"
          onClick={() => {
            setForm(blank);
            setEditing('');
          }}
        >
          {t('Add address +', 'पता जोड़ें +')}
        </button>
      </div>
      {!addresses.length && !form && (
        <p>
          {t(
            'Add your site or home address to continue.',
            'आगे बढ़ने के लिए घर या काम की जगह का पता जोड़ें।',
          )}
        </p>
      )}
      <div className="address-list">
        {addresses.map((address) => (
          <article key={address.id} className={selected === address.id ? 'selected-address' : ''}>
            {onSelect && (
              <label className="choice">
                <input
                  type="radio"
                  name="delivery-address"
                  checked={selected === address.id}
                  onChange={() => {
                    onSelect(address.id);
                    onChange?.();
                  }}
                />
                {t('Deliver here', 'यहाँ डिलीवरी करें')}
              </label>
            )}
            <strong>
              {address.label} · {address.name}
            </strong>
            <p>
              {address.line1}, {address.area}, {address.city} {address.pincode}
            </p>
            <p>{address.phone}</p>
            <div className="action-row">
              <button
                className="text-link"
                onClick={() => {
                  setEditing(address.id);
                  setForm({
                    label: address.label,
                    name: address.name,
                    phone: address.phone,
                    line1: address.line1,
                    area: address.area,
                    city: address.city,
                    state: address.state,
                    pincode: address.pincode,
                    landmark: address.landmark,
                  });
                }}
              >
                {t('Edit address', 'पता बदलें')}
              </button>
              <button disabled={busy} className="text-link" onClick={() => void remove(address)}>
                {t('Remove address', 'पता हटाएँ')}
              </button>
            </div>
          </article>
        ))}
      </div>
      {form && (
        <form
          className="address-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h3>{editing ? t('Edit address', 'पता बदलें') : t('New address', 'नया पता')}</h3>
          <div className="form-grid">
            {fields.map(([key, en, hi]) => (
              <label key={key}>
                {t(en, hi)}
                <input
                  required={key !== 'landmark'}
                  maxLength={
                    key === 'line1' ? 250 : key === 'phone' ? 13 : key === 'pincode' ? 6 : 100
                  }
                  inputMode={key === 'pincode' || key === 'phone' ? 'numeric' : 'text'}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <p>{t('State: Bihar', 'राज्य: बिहार')}</p>
          <div className="action-row">
            <button className="button" disabled={busy}>
              {t('Save address', 'पता सहेजें')}
            </button>
            <button type="button" className="text-link" onClick={() => setForm(null)}>
              {t('Cancel', 'रद्द करें')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
