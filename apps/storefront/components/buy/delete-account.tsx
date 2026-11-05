'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { customerApi, errorText, localPhone } from '../../lib/customer-api';

function Heading({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="page-heading">
      <h1>{title}</h1>
      {lead ? <p>{lead}</p> : null}
    </div>
  );
}

/** Public account deletion: the Play Store link and anyone without the app can use it. */
export function DeleteAccountPage() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [sent, setSent] = useState(false);
  const [signedInAs, setSignedInAs] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  // Each step takes keyboard and screen-reader users to what it asks for next.
  const codeRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (sent) codeRef.current?.focus();
  }, [sent]);
  useEffect(() => {
    if (signedInAs) confirmRef.current?.focus();
  }, [signedInAs]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (signedInAs) {
        await customerApi('/me/delete', 'POST', { confirmation });
        setDone(true);
        setSignedInAs('');
      } else if (sent) {
        const result = await customerApi<{ user: { phone: string } }>('/auth/otp/verify', 'POST', {
          phone: `+91${phone}`,
          code,
          surface: 'CUSTOMER',
        });
        setSignedInAs(result.user.phone);
      } else {
        const result = await customerApi<{ devCode?: string }>('/auth/otp/request', 'POST', {
          phone: `+91${phone}`,
        });
        setDevCode(result.devCode || '');
        setSent(true);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="commerce-page">
      <Heading
        title={'Delete your account'}
        lead={
          'You can make this request here without installing the app. Verify the mobile number of the account you want to delete.'
        }
      />
      <p>
        Deleting your account signs out every device and removes your saved addresses, basket,
        notifications and profile details. De-identified order and audit records remain. Open
        deliveries and refunds, and any khata (credit) balance with the shop, must be settled first.{' '}
        <Link className="text-link" href="/privacy">
          Read the privacy page
        </Link>
      </p>
      {done ? (
        <p className="account-form" role="status" ref={doneRef} tabIndex={-1}>
          Your account has been deleted and its sessions ended.
        </p>
      ) : (
        <form className="account-form" onSubmit={(event) => void submit(event)} aria-busy={busy}>
          {!signedInAs ? (
            <>
              <label>
                Mobile number (+91)
                <input
                  type="tel"
                  autoComplete="tel"
                  placeholder="9876543210"
                  required
                  pattern="[6-9][0-9]{9}"
                  disabled={!ready || sent || busy}
                  value={phone}
                  onChange={(event) => setPhone(localPhone(event.target.value))}
                />
              </label>
              {sent && (
                <label>
                  Verification code
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    ref={codeRef}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </label>
              )}
              {devCode && (
                <p className="local-notice">
                  Local test only. No SMS sent. Test code: <strong>{devCode}</strong>
                </p>
              )}
            </>
          ) : (
            <>
              <p>{`Signed in as ${signedInAs}. This cannot be undone.`}</p>
              <label>
                Type DELETE to confirm
                <input
                  ref={confirmRef}
                  value={confirmation}
                  pattern="DELETE"
                  required
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
            </>
          )}
          {error && (
            <p className="error-text" role="alert" ref={errorRef} tabIndex={-1}>
              {error}
            </p>
          )}
          <button className="button" disabled={!ready || busy}>
            {busy
              ? 'Please wait…'
              : signedInAs
                ? 'Delete my account'
                : sent
                  ? 'Verify the number'
                  : 'Get verification code'}
          </button>
          {sent && !signedInAs && (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setSent(false);
                setCode('');
                setDevCode('');
              }}
            >
              Change number / resend code
            </button>
          )}
        </form>
      )}
    </div>
  );
}
