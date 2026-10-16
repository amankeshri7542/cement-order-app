'use client';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Address, AddressInput, SessionInfo, User } from '@shiv/shared';
import { addressSchema, momentLabel, profileSchema } from '@shiv/shared';
import { customerApi, CustomerError, errorText, localPhone } from '../lib/customer-api';
import { deviceLabel } from '../lib/devices';
import { useCommerce } from './commerce';
import { useLanguage } from './language';

export function AccountRequired({
  children,
  nested = false,
}: {
  children: ReactNode;
  // A page that already has its own h1 embeds the gate with a section heading.
  nested?: boolean;
}) {
  const c = useCommerce();
  const { t } = useLanguage();
  const Heading = nested ? 'h2' : 'h1';
  if (!c.ready)
    return (
      <p className="loading-state" role="status">
        {t('Restoring your session…', 'आपका सत्र वापस ला रहे हैं…')}
      </p>
    );
  if (!c.user && c.sessionUnknown)
    // Offline or outage: the customer may well be signed in, so do not ask them to sign in again.
    return (
      <section className="account-gate" role="status">
        <Heading>
          {t('We could not confirm your sign-in.', 'आपका साइन इन जाँचा नहीं जा सका।')}
        </Heading>
        <p>
          {t(
            'Check your connection, then try again. Your basket and saved requests are kept on this device.',
            'इंटरनेट जाँचें, फिर कोशिश करें। आपकी टोकरी और सहेजे अनुरोध इसी उपकरण पर सुरक्षित हैं।',
          )}
        </p>
        <button className="button" onClick={() => void c.retrySession()}>
          {t('Try again', 'फिर कोशिश करें')}
        </button>
      </section>
    );
  if (!c.user)
    return (
      <section className="account-gate">
        <Heading>{t('Pick up where you left off.', 'जहाँ रुके थे, वहीं से शुरू करें।')}</Heading>
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
        <Heading>{t('Use your customer account.', 'ग्राहक खाता इस्तेमाल करें।')}</Heading>
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
          <AccountRequired nested>
            <Profile />
            <AddressBook />
            <SignedInDevices />
            <DeleteAccount />
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
              onChange={(e) => setPhone(localPhone(e.target.value))}
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
/** False once the section unmounts (sign-out or another account), so late replies are dropped. */
function useLive() {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => mounted.current, []);
}
// customerApi leaves /auth/ paths to the session code, so these calls refresh an expired access
// token themselves once before reporting that the customer must sign in again.
async function authApi<T>(path: string, method: string, body: unknown, accountId: string) {
  try {
    return await customerApi<T>(path, method, body, accountId);
  } catch (e) {
    if (!(e instanceof CustomerError) || e.status !== 401) throw e;
    try {
      await customerApi('/auth/refresh', 'POST', {}, undefined, false);
    } catch (refresh) {
      if (refresh instanceof CustomerError && refresh.status === 401)
        window.dispatchEvent(new CustomEvent('shiv-session-expired', { detail: { accountId } }));
      throw refresh;
    }
    return customerApi<T>(path, method, body, accountId, false);
  }
}
// Name and contractor request, as the Android app's Edit profile.
function Profile() {
  const c = useCommerce();
  const { t, language } = useLanguage();
  const live = useLive();
  const user = c.user!;
  const contractorAsked = user.contractorStatus === 'PENDING' || user.role === 'CONTRACTOR';
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const [contractor, setContractor] = useState(contractorAsked);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  function edit() {
    setName(user.name);
    setContractor(contractorAsked);
    setProblem('');
    setEditing(true);
  }
  async function save() {
    const parsed = profileSchema.safeParse({ name, language, contractor });
    if (!parsed.success) {
      setProblem(t('Enter your name, up to 100 letters.', 'अपना नाम लिखें, 100 अक्षरों तक।'));
      return;
    }
    setBusy(true);
    setProblem('');
    try {
      await customerApi<User>('/me', 'PATCH', parsed.data, user.id);
      if (!live()) return;
      await c.refresh();
      if (!live()) return;
      setEditing(false);
      c.setMessage(t('Profile saved', 'प्रोफ़ाइल सहेजी गई'));
    } catch (e) {
      if (live()) setProblem(errorText(e, language === 'hi'));
    } finally {
      if (live()) setBusy(false);
    }
  }
  return (
    <section className="account-panel">
      <div className="section-heading">
        <h2>{t('Your profile', 'आपकी प्रोफ़ाइल')}</h2>
        {!editing && (
          <button className="text-link" onClick={edit}>
            {t('Edit profile', 'प्रोफ़ाइल बदलें')}
          </button>
        )}
      </div>
      <p>
        {t('Name', 'नाम')}: {user.name || t('Not added yet', 'अभी नहीं जोड़ा')}
      </p>
      {user.role === 'CONTRACTOR' ? (
        <p>{t('Verified contractor', 'सत्यापित ठेकेदार')}</p>
      ) : user.contractorStatus === 'PENDING' ? (
        <p>
          {t(
            'Contractor verification requested. The shop will confirm.',
            'ठेकेदार सत्यापन माँगा गया है। दुकान पुष्टि करेगी।',
          )}
        </p>
      ) : null}
      {editing && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            {t('Full name', 'पूरा नाम')}
            <input
              autoComplete="name"
              maxLength={100}
              required
              aria-invalid={Boolean(problem)}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="choice">
            <input
              type="checkbox"
              checked={contractor}
              disabled={user.role === 'CONTRACTOR'}
              onChange={(e) => setContractor(e.target.checked)}
            />
            {t(
              'I am a contractor or builder (ask for verification)',
              'मैं ठेकेदार या बिल्डर हूँ (सत्यापन माँगें)',
            )}
          </label>
          {problem && <p role="alert">{problem}</p>}
          <div className="action-row">
            <button className="button" disabled={busy}>
              {busy ? t('Please wait…', 'कृपया रुकें…') : t('Save profile', 'प्रोफ़ाइल सहेजें')}
            </button>
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              {t('Cancel', 'रद्द करें')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
function SignedInDevices() {
  const c = useCommerce();
  const { t, language } = useLanguage();
  const live = useLive();
  const id = c.user!.id;
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const hi = language === 'hi';
  const load = useCallback(async () => {
    const items = await authApi<SessionInfo[]>('/auth/sessions', 'GET', undefined, id);
    if (live()) setSessions(items);
  }, [id, live]);
  useEffect(() => {
    void load().catch((e) => {
      if (live()) setProblem(errorText(e, hi));
    });
  }, [load, live, hi]);
  async function signOut(session?: SessionInfo) {
    if (
      !session &&
      !window.confirm(
        t(
          'Sign out of every other device? This device stays signed in.',
          'बाकी सभी डिवाइस से साइन आउट करें? यह डिवाइस साइन इन रहेगा।',
        ),
      )
    )
      return;
    setBusy(true);
    setProblem('');
    try {
      if (session)
        await authApi(`/auth/sessions/${encodeURIComponent(session.id)}`, 'DELETE', undefined, id);
      else await authApi('/auth/sessions/revoke-others', 'POST', {}, id);
      if (!live()) return;
      await load();
      if (live())
        c.setMessage(
          session
            ? t('That device is signed out.', 'उस डिवाइस से साइन आउट हो गया।')
            : t('Other devices are signed out.', 'बाकी डिवाइस से साइन आउट हो गया।'),
        );
    } catch (e) {
      if (live()) setProblem(errorText(e, hi));
    } finally {
      if (live()) setBusy(false);
    }
  }
  return (
    <section className="account-panel">
      <h2>{t('Signed-in devices', 'साइन इन वाले डिवाइस')}</h2>
      <p>
        {t(
          'Sign out phones and computers you no longer use, or a device you have lost.',
          'जो फ़ोन या कंप्यूटर अब काम में नहीं या खो गया है, उससे साइन आउट करें।',
        )}
      </p>
      {problem && <p role="alert">{problem}</p>}
      {!sessions ? (
        !problem && (
          <p className="loading-state" role="status">
            {t('Loading devices…', 'डिवाइस लोड हो रहे हैं…')}
          </p>
        )
      ) : (
        <ul className="session-list">
          {sessions.map((session) => {
            const label = deviceLabel(session.label, language);
            return (
              <li key={session.id}>
                <div>
                  <strong>
                    {label}
                    {session.current && (
                      <span className="status-badge">{t('This device', 'यह डिवाइस')}</span>
                    )}
                  </strong>
                  <small>
                    {t('Last used', 'आख़िरी बार')} {momentLabel(session.lastSeenAt, language)}
                  </small>
                </div>
                {!session.current && (
                  <button
                    className="text-link"
                    disabled={busy}
                    aria-label={t(`Sign out device: ${label}`, `डिवाइस से साइन आउट: ${label}`)}
                    onClick={() => void signOut(session)}
                  >
                    {t('Sign out device', 'डिवाइस से साइन आउट')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {sessions?.some((session) => !session.current) && (
        <button className="button secondary" disabled={busy} onClick={() => void signOut()}>
          {t('Sign out other devices', 'बाकी सभी डिवाइस से साइन आउट')}
        </button>
      )}
    </section>
  );
}
// Same request and wording as the Android app's Delete account; the server refuses while any
// order or refund is still open (ACTIVE_ORDERS).
function DeleteAccount() {
  const c = useCommerce();
  const { t, language } = useLanguage();
  const router = useRouter();
  const live = useLive();
  const id = c.user!.id;
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; text: string } | null>(null);
  async function remove() {
    // Typed confirmation, forgiving case and spaces (phone keyboards capitalise and pad).
    if (confirmation.trim().toUpperCase() !== 'DELETE') return;
    setBusy(true);
    setProblem(null);
    try {
      await customerApi('/me/delete', 'POST', { confirmation: 'DELETE' }, id);
    } catch (e) {
      if (live()) {
        setProblem({
          code: e instanceof CustomerError ? e.code : '',
          text: errorText(e, language === 'hi'),
        });
        setBusy(false);
      }
      return;
    }
    // Drafts, pending requests and recovery records saved for this account on this browser.
    try {
      for (const store of [localStorage, sessionStorage])
        for (const key of Object.keys(store))
          if (key.startsWith('shiv_') && key.includes(id)) store.removeItem(key);
    } catch {
      /* Storage blocked: nothing was kept. */
    }
    // Every session is already gone; this clears the cookies and the signed-in view.
    await c.signout();
    c.setMessage(t('Account deleted', 'खाता हटा दिया गया'));
    router.push('/');
  }
  return (
    <section className="account-panel">
      <h2>{t('Delete your account', 'अपना खाता हटाएँ')}</h2>
      {!open ? (
        <button className="text-link" onClick={() => setOpen(true)}>
          {t('Delete account', 'खाता हटाएँ')}
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void remove();
          }}
        >
          <p>
            {t(
              'Deletion removes your profile, addresses, basket and sign-ins on every phone. Order records without your details stay for the shop’s accounts. Finish open orders first. This cannot be undone.',
              'खाता हटाने से आपकी प्रोफ़ाइल, पते, टोकरी और सभी फ़ोन से साइन इन हट जाएँगे। आपकी जानकारी के बिना ऑर्डर का हिसाब दुकान के रिकॉर्ड में रहेगा। पहले खुले ऑर्डर पूरे करें। यह वापस नहीं होगा।',
            )}
          </p>
          <label>
            {t('Type DELETE to confirm', 'पक्का करने के लिए DELETE लिखें')}
            <input
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoFocus
            />
          </label>
          {problem && (
            <p role="alert">
              {problem.text}{' '}
              {problem.code === 'ACTIVE_ORDERS' && (
                <Link className="text-link" href="/orders">
                  {t('See open orders', 'खुले ऑर्डर देखें')}
                </Link>
              )}
            </p>
          )}
          <div className="action-row">
            <button
              className="button"
              disabled={busy || confirmation.trim().toUpperCase() !== 'DELETE'}
            >
              {busy
                ? t('Please wait…', 'कृपया रुकें…')
                : t('Permanently delete my account', 'मेरा खाता हमेशा के लिए हटाएँ')}
            </button>
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setConfirmation('');
                setProblem(null);
              }}
            >
              {t('Keep my account', 'खाता रखें')}
            </button>
          </div>
        </form>
      )}
    </section>
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
