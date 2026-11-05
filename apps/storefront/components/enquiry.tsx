'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { API_URL } from '../lib/api';
import s from './page.module.css';

type Field = 'name' | 'phone' | 'pincode' | 'interest' | 'message';
const names: Record<Field, string> = {
  name: 'your name',
  phone: 'the mobile number',
  pincode: 'the pincode',
  interest: 'the material',
  message: 'your message',
};

/**
 * "Ask the shop": a visitor with no account leaves a name, a number and a question or complaint.
 * The shop sees it on the desk's Today screen. Nothing is sent to the visitor automatically, and a
 * hidden field catches robots.
 */
export function EnquiryForm({ interest: seeded = '' }: { interest?: string }) {
  const [kind, setKind] = useState<'question' | 'complaint'>('question');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pincode, setPincode] = useState('');
  const [interest, setInterest] = useState(seeded.slice(0, 200));
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ phone: string; ticket: string; kind: string } | null>(null);
  const [error, setError] = useState('');
  const [bad, setBad] = useState<Field[]>([]);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);
  const mark = (field: Field) =>
    bad.includes(field)
      ? { 'aria-invalid': true as const, 'aria-describedby': 'enquiry-error' }
      : {};

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setBad([]);
    try {
      const response = await fetch(`${API_URL}/web/enquiries`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          name: name.trim(),
          phone: `+91${phone}`,
          ...(pincode ? { pincode } : {}),
          ...(kind === 'complaint'
            ? { interest: 'Complaint' }
            : interest.trim()
              ? { interest: interest.trim() }
              : {}),
          message: message.trim(),
          language: 'en',
          website,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        ticket?: string;
        error?: { details?: { field?: string }[] };
      } | null;
      if (response.ok) {
        setDone({ phone, ticket: data?.ticket ?? '', kind });
        return;
      }
      const fields = (data?.error?.details ?? [])
        .map((item) => item.field)
        .filter((field): field is Field => Boolean(field && field in names));
      if (fields.length) {
        setBad(fields);
        setError(`Please check ${fields.map((field) => names[field]).join(', ')}.`);
      } else if (response.status === 429)
        setError(
          'Many messages have just come from this network or number. Please try again later.',
        );
      else setError('The shop could not receive this just now. Please try again.');
    } catch {
      setError('This could not be sent. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className={s.state} role="status">
        <h3 ref={doneRef} tabIndex={-1}>
          Your message has reached the shop.
        </h3>
        {done.ticket ? (
          <p>
            Your {done.kind === 'complaint' ? 'complaint' : 'message'} number is{' '}
            <b data-ticket>{done.ticket}</b>. Keep it, so the shop can find this quickly.
          </p>
        ) : null}
        <p>The shop will contact you on {done.phone}.</p>
        <p className={s.actions}>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              setDone(null);
              setMessage('');
            }}
          >
            Send another message
          </button>
        </p>
      </div>
    );

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-busy={busy}
      style={{ display: 'grid', gap: 16, maxWidth: '34rem' }}
    >
      <fieldset
        style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: 16 }}
      >
        <legend className="sr">What is this about?</legend>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
          <input
            type="radio"
            name="kind"
            checked={kind === 'question'}
            onChange={() => setKind('question')}
          />
          A question
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
          <input
            type="radio"
            name="kind"
            checked={kind === 'complaint'}
            onChange={() => setKind('complaint')}
          />
          A complaint
        </label>
      </fieldset>
      <label className={s.field}>
        Your name
        <input
          required
          maxLength={80}
          autoComplete="name"
          value={name}
          {...mark('name')}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className={s.field}>
        Mobile number
        <input
          type="tel"
          required
          autoComplete="tel"
          placeholder="9876543210"
          pattern="[6-9][0-9]{9}"
          title="A 10-digit mobile number"
          value={phone}
          {...mark('phone')}
          onChange={(event) =>
            setPhone(
              event.target.value
                .replace(/^\+?91/, '')
                .replace(/\D/g, '')
                .slice(0, 10),
            )
          }
        />
      </label>
      <label className={s.field}>
        Site pincode (optional)
        <input
          inputMode="numeric"
          autoComplete="postal-code"
          pattern="[1-9][0-9]{5}"
          maxLength={6}
          value={pincode}
          {...mark('pincode')}
          onChange={(event) => setPincode(event.target.value.replace(/\D/g, ''))}
        />
      </label>
      {kind === 'question' ? (
        <label className={s.field}>
          Material you are asking about (optional)
          <input
            maxLength={200}
            value={interest}
            {...mark('interest')}
            onChange={(event) => setInterest(event.target.value)}
          />
        </label>
      ) : null}
      <label className={s.field}>
        {kind === 'complaint' ? 'What went wrong?' : 'Your question'}
        <textarea
          required
          rows={4}
          maxLength={1000}
          value={message}
          {...mark('message')}
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>
      {/* Robots fill every field they find; people never see this one. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }}>
        <label>
          Website
          <input
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </label>
      </div>
      {error ? (
        <p
          role="alert"
          id="enquiry-error"
          ref={errorRef}
          tabIndex={-1}
          style={{ color: 'var(--danger)' }}
        >
          {error}
        </p>
      ) : null}
      <div>
        <button className="btn btn-solid" disabled={busy}>
          {busy ? 'Please wait…' : 'Send to the shop'}
        </button>
      </div>
      <p className={s.meta} style={{ marginTop: 0 }}>
        We use your number only to reply to this message.
      </p>
    </form>
  );
}
