'use client';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Address, AddressInput, SessionInfo, User } from '@shiv/shared';
import { momentLabel } from '@shiv/shared/src/dates';
import { goodAddress, goodName } from '../../lib/guards';
import { customerApi, CustomerError, errorText, localPhone } from '../../lib/customer-api';
import { deviceLabel } from '../../lib/devices';
import { useCommerce } from './commerce';
import { NameStep, needsName, useSavedPincode } from './first-run';
const language = 'en' as const;
/** Only our own buying pages: a sign-in link must never carry someone off this site. */
const safeNext = (next: string | null) =>
  next && ['/list', '/list?go=order', '/checkout', '/quotes', '/orders', '/account'].includes(next)
    ? next
    : '/list';

export function AccountRequired({
  children,
  nested = false,
}: {
  children: ReactNode;
  // A page that already has its own h1 embeds the gate with a section heading.
  nested?: boolean;
}) {
  const c = useCommerce();
  const Heading = nested ? 'h2' : 'h1';
  if (!c.ready)
    return (
      <p className="loading-state" role="status">
        Restoring your session…
      </p>
    );
  if (!c.user && c.sessionUnknown)
    // Offline or outage: the customer may well be signed in, so do not ask them to sign in again.
    return (
      <section className="account-gate" role="status">
        <Heading>We could not confirm your sign-in.</Heading>
        <p>
          Check your connection, then try again. Your list and saved requests are kept on this
          device.
        </p>
        <button className="button" onClick={() => void c.retrySession()}>
          Try again
        </button>
      </section>
    );
  if (!c.user)
    return (
      <section className="account-gate">
        <Heading>Pick up where you left off.</Heading>
        <p>
          Sign in to use your saved addresses, orders and rate requests. Your list stays on this
          device.
        </p>
        <Link className="button" href="/account">
          Sign in
        </Link>
      </section>
    );
  if (c.user.role === 'ADMIN')
    return (
      <section className="account-gate">
        <Heading>Use your customer account.</Heading>
        <p>
          The owner desk has separate staff controls. Sign out here to shop with a customer phone
          number.
        </p>
        <button className="button" onClick={() => void c.signout()}>
          Sign out
        </button>
      </section>
    );
  return <Fragment key={c.user.id}>{children}</Fragment>;
}
export function AccountPage() {
  const c = useCommerce();
  const router = useRouter();
  const params = useSearchParams();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false);
  // A new account without a name is asked for one once, before going on.
  const [naming, setNaming] = useState<User | null>(null);
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
          surface: 'CUSTOMER',
        });
        if (request.current !== current || account.current !== owner) return;
        target = result.user.id;
        await c.signedIn(result.user);
        if (request.current !== current || (account.current && account.current !== result.user.id))
          return;
        if (needsName(result.user)) setNaming(result.user);
        else carryOn();
      }
    } catch (e) {
      if (request.current === current && account.current === target) c.showError(e);
    } finally {
      if (request.current === current) setBusy(false);
    }
  }
  function carryOn() {
    const next = params.get('next');
    router.push(safeNext(next));
  }
  return (
    <div className="account-page">
      <div className="page-heading">
        <h1>Your next project, together.</h1>
      </div>
      {naming && c.user?.id === naming.id ? (
        <NameStep
          user={naming}
          done={() => {
            setNaming(null);
            carryOn();
          }}
        />
      ) : c.user ? (
        <>
          <section className="account-summary">
            <h2>{c.user.name || 'Welcome back'}</h2>
            <p>{c.user.phone}</p>
            <div className="action-row">
              <Link className="button" href="/orders">
                Your orders
              </Link>
              <Link className="button secondary" href="/quotes">
                Your quotations
              </Link>
              <button className="text-link" disabled={c.busy} onClick={() => void c.signout()}>
                Sign out
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
          <h2>Sign in with your phone</h2>
          <p>Your orders and requests use the same account as the customer app.</p>
          <label>
            Mobile number
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
                Six-digit code
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
                  Local test only. No SMS sent. Test code: <strong>{devCode}</strong>
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
                Change phone / resend code
              </button>
            </>
          )}
          <button className="button" disabled={!c.ready || busy}>
            {busy ? 'Please wait…' : sent ? 'Verify and continue' : 'Get sign-in code'}
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
    if (!goodName(name)) {
      setProblem('Enter your name, up to 100 letters.');
      return;
    }
    setBusy(true);
    setProblem('');
    try {
      await customerApi<User>('/me', 'PATCH', { name: name.trim(), language, contractor }, user.id);
      if (!live()) return;
      await c.refresh();
      if (!live()) return;
      setEditing(false);
      c.setMessage('Profile saved');
    } catch (e) {
      if (live()) setProblem(errorText(e));
    } finally {
      if (live()) setBusy(false);
    }
  }
  return (
    <section className="account-panel">
      <div className="section-heading">
        <h2>Your profile</h2>
        {!editing && (
          <button className="text-link" onClick={edit}>
            Edit profile
          </button>
        )}
      </div>
      <p>Name: {user.name || 'Not added yet'}</p>
      {user.role === 'CONTRACTOR' ? (
        <p>Verified contractor</p>
      ) : user.contractorStatus === 'PENDING' ? (
        <p>Contractor verification requested. The shop will confirm.</p>
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
            Full name
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
            I am a contractor or builder (ask for verification)
          </label>
          {problem && <p role="alert">{problem}</p>}
          <div className="action-row">
            <button className="button" disabled={busy}>
              {busy ? 'Please wait…' : 'Save profile'}
            </button>
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
function SignedInDevices() {
  const c = useCommerce();
  const live = useLive();
  const id = c.user!.id;
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const load = useCallback(async () => {
    const items = await authApi<SessionInfo[]>('/auth/sessions', 'GET', undefined, id);
    if (live()) setSessions(items);
  }, [id, live]);
  useEffect(() => {
    void load().catch((e) => {
      if (live()) setProblem(errorText(e));
    });
  }, [load, live]);
  async function signOut(session?: SessionInfo) {
    if (!session && !window.confirm('Sign out of every other device? This device stays signed in.'))
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
        c.setMessage(session ? 'That device is signed out.' : 'Other devices are signed out.');
    } catch (e) {
      if (live()) setProblem(errorText(e));
    } finally {
      if (live()) setBusy(false);
    }
  }
  return (
    <section className="account-panel">
      <h2>Signed-in devices</h2>
      <p>Sign out phones and computers you no longer use, or a device you have lost.</p>
      {problem && <p role="alert">{problem}</p>}
      {!sessions ? (
        !problem && (
          <p className="loading-state" role="status">
            Loading devices…
          </p>
        )
      ) : (
        <ul className="session-list">
          {sessions.map((session) => {
            const label = deviceLabel(session.label);
            return (
              <li key={session.id}>
                <div>
                  <strong>
                    {label}
                    {session.current && <span className="status-badge">This device</span>}
                  </strong>
                  <small>Last used {momentLabel(session.lastSeenAt, language)}</small>
                </div>
                {!session.current && (
                  <button
                    className="text-link"
                    disabled={busy}
                    aria-label={`Sign out device: ${label}`}
                    onClick={() => void signOut(session)}
                  >
                    Sign out device
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {sessions?.some((session) => !session.current) && (
        <button className="button secondary" disabled={busy} onClick={() => void signOut()}>
          Sign out other devices
        </button>
      )}
    </section>
  );
}
// Same request and wording as the Android app's Delete account; the server refuses while any
// order or refund is still open (ACTIVE_ORDERS).
function DeleteAccount() {
  const c = useCommerce();
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
          text: errorText(e),
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
    // Stays here: the public pages have no place for this message, and the customer must see it.
    c.setMessage('Account deleted');
  }
  return (
    <section className="account-panel">
      <h2>Delete your account</h2>
      {!open ? (
        <button className="text-link" onClick={() => setOpen(true)}>
          Delete account
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void remove();
          }}
        >
          <p>
            Deletion removes your profile, addresses, list and sign-ins on every phone. Order
            records without your details stay for the shop’s accounts. Finish open orders first.
            This cannot be undone.
          </p>
          <label>
            Type DELETE to confirm
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
                  See open orders
                </Link>
              )}
            </p>
          )}
          <div className="action-row">
            <button
              className="button"
              disabled={busy || confirmation.trim().toUpperCase() !== 'DELETE'}
            >
              {busy ? 'Please wait…' : 'Permanently delete my account'}
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
              Keep my account
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
  const [pincode] = useSavedPincode();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<AddressInput | null>(null);
  // Read when the list arrives: checkout restores a saved choice before or after that.
  const chosen = useRef(selected);
  chosen.current = selected;
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
    setLoaded(false);
    if (id)
      void customerApi<Address[]>('/me/addresses', 'GET', undefined, id)
        .then((items) => {
          if (!active) return;
          setAddresses(items);
          setLoaded(true);
          // Checkout picks a saved address by itself when none is chosen yet.
          if (onSelect && items[0] && !items.some((item) => item.id === chosen.current))
            onSelect(items[0].id);
        })
        .catch((error) => {
          if (active) c.showError(error);
        });
    return () => {
      active = false;
    };
  }, [id, c.showError]);
  // A new address starts from what is known: the customer's name and number, the checked pincode.
  const startNew = useCallback(() => {
    setEditing('');
    setForm({
      ...blank,
      name: c.user?.name || '',
      phone: c.user?.phone.replace(/^\+91/, '') || '',
      pincode,
    });
  }, [c.user, pincode]);
  // In checkout, a customer with no saved address goes straight to the form.
  const opened = useRef(false);
  useEffect(() => {
    if (onSelect && loaded && !addresses.length && !form && !opened.current) {
      opened.current = true;
      startNew();
    }
  }, [onSelect, loaded, addresses.length, form, startNew]);
  async function save() {
    if (!form || !id) return;
    setBusy(true);
    try {
      const body = {
        ...form,
        phone: form.phone.startsWith('+91') ? form.phone : `+91${form.phone}`,
      };
      if (!goodAddress(body)) {
        c.setError('Check every required field, phone and six-digit pincode.');
        return;
      }
      const address = await customerApi<Address>(
        editing ? `/me/addresses/${editing}` : '/me/addresses',
        editing ? 'PATCH' : 'POST',
        body,
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
    if (!id || !window.confirm('Remove this saved address?')) return;
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
  const fields: [keyof AddressInput, string][] = [
    ['label', 'Address label'],
    ['name', 'Recipient name'],
    ['phone', 'Recipient phone'],
    ['line1', 'House / street / site'],
    ['area', 'Area'],
    ['city', 'City'],
    ['pincode', 'Pincode'],
    ['landmark', 'Landmark (optional)'],
  ];
  return (
    <section className="address-book">
      <div className="section-heading">
        <h2>Delivery addresses</h2>
        <button className="text-link" onClick={startNew}>
          Add address +
        </button>
      </div>
      {loaded && !addresses.length && !form && (
        <div className="empty-state compact">
          <p>
            No saved address yet. Add your site or home address once; it is ready for every order.
          </p>
          <button className="button secondary" onClick={startNew}>
            Add your first address
          </button>
        </div>
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
                Deliver here
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
                Edit address
              </button>
              <button disabled={busy} className="text-link" onClick={() => void remove(address)}>
                Remove address
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
          <h3>{editing ? 'Edit address' : 'New address'}</h3>
          <div className="form-grid">
            {fields.map(([key, en]) => (
              <label key={key}>
                {en}
                <input
                  required={key !== 'landmark'}
                  maxLength={
                    key === 'line1' ? 250 : key === 'phone' ? 13 : key === 'pincode' ? 6 : 100
                  }
                  inputMode={key === 'pincode' || key === 'phone' ? 'numeric' : 'text'}
                  value={form[key] ?? ''}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <p>State: Bihar</p>
          <div className="action-row">
            <button className="button" disabled={busy}>
              Save address
            </button>
            <button type="button" className="text-link" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
