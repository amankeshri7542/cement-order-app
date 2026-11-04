'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../lib/api';
import { User } from '@shiv/shared';
export default function DeleteAccount() {
  const [phone, setPhone] = useState(''),
    [code, setCode] = useState(''),
    [devCode, setDevCode] = useState(''),
    [sent, setSent] = useState(false),
    [user, setUser] = useState<User | null>(null),
    [confirmation, setConfirmation] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <main className="policy-page">
      <a href="/privacy">SHIV CEMENT STORE · PRIVACY</a>
      <h1>Delete your account.</h1>
      <p>
        You can make this request here without installing the app. Verify the mobile number
        belonging to the account you want to delete.
      </p>
      <p>
        Deletion signs out every device and removes your saved addresses, cart, notifications and
        profile contact details. De-identified financial and audit records remain. Open deliveries
        and refunds must be resolved first. <a href="/privacy">Read the data policy.</a>
      </p>
      {done ? (
        <p role="status">Your account has been deleted and its sessions revoked.</p>
      ) : (
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              if (user) {
                await api('/me/delete', 'POST', { confirmation });
                setDone(true);
                setUser(null);
              } else if (sent) {
                const r = await api<{ user: User }>('/auth/otp/verify', 'POST', {
                  phone: `+91${phone}`,
                  code,
                });
                setUser(r.user);
              } else {
                const r = await api<{ devCode?: string }>('/auth/otp/request', 'POST', {
                  phone: `+91${phone}`,
                });
                setDevCode(r.devCode || '');
                setSent(true);
              }
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {!user ? (
            <>
              <label className="field">
                Mobile number (+91)
                <input
                  aria-label="Mobile number"
                  type="tel"
                  value={phone}
                  disabled={!ready || sent}
                  pattern="[6-9][0-9]{9}"
                  maxLength={10}
                  required
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                />
              </label>
              {sent && (
                <label className="field">
                  Verification code
                  <input
                    aria-label="Verification code"
                    value={code}
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
              )}
              {devCode && (
                <p className="warning">Local development code: {devCode}. No SMS was sent.</p>
              )}
            </>
          ) : (
            <>
              <p>Signed in as {user.phone}. This cannot be undone.</p>
              <label className="field">
                Type DELETE to confirm
                <input
                  aria-label="Deletion confirmation"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  required
                  pattern="DELETE"
                />
              </label>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={!ready || busy}>
            {busy
              ? 'Please wait…'
              : user
                ? 'Delete my account'
                : sent
                  ? 'Verify account'
                  : 'Get verification code'}
          </button>
          {sent && !user && (
            <button
              className="secondary"
              type="button"
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
    </main>
  );
}
