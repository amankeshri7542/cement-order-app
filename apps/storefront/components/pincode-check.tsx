'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { API_URL } from '../lib/api';
import { rupees } from '../lib/format';
import { PINCODE_KEY, readPincode, savePincode, type DeliveryAnswer } from '../lib/pincode';
import s from './page.module.css';

/** Fee, minimum and estimate for one pincode. Plain words, and a remembered pincode. */
export function PincodeCheck({
  onResult,
  whatsapp,
}: {
  onResult?: (pin: string, answer: DeliveryAnswer | null) => void;
  whatsapp?: string;
}) {
  const [pin, setPin] = useState('');
  const [answer, setAnswer] = useState<DeliveryAnswer | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'bad' | 'failed'>('idle');
  const asked = useRef(0);
  async function check(value: string) {
    const current = ++asked.current;
    setAnswer(null);
    if (!/^[1-9]\d{5}$/.test(value)) {
      setState('bad');
      onResult?.('', null);
      return;
    }
    setState('busy');
    try {
      const response = await fetch(`${API_URL}/delivery/${value}`, {
        credentials: 'omit',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('refused');
      const data = (await response.json()) as DeliveryAnswer;
      if (current !== asked.current) return;
      setAnswer(data);
      setState('idle');
      savePincode(value);
      onResult?.(value, data);
    } catch {
      if (current !== asked.current) return;
      setState('failed');
      onResult?.(value, null);
    }
  }
  useEffect(() => {
    const saved = readPincode();
    if (saved) {
      setPin(saved);
      void check(saved);
    }
    // Runs once: a remembered pincode is filled in and checked when the page can run scripts.
  }, []);
  return (
    <div data-pincode={PINCODE_KEY}>
      <form
        className={s.search}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void check(pin);
        }}
      >
        <label className="sr" htmlFor="pincode">
          Site pincode
        </label>
        <input
          id="pincode"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          placeholder="Site pincode"
          value={pin}
          aria-invalid={state === 'bad'}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
        />
        <button className="btn btn-solid" disabled={state === 'busy'}>
          {state === 'busy' ? 'Checking' : 'Check'}
        </button>
      </form>
      <div aria-live="polite" style={{ marginTop: '0.75rem' }}>
        {state === 'bad' ? <p role="alert">Enter a six-digit pincode.</p> : null}
        {state === 'failed' ? (
          <p role="alert">The shop could not be reached to check this. Try again in a moment.</p>
        ) : null}
        {answer?.serviceable && answer.zone ? (
          <p>
            The shop delivers to {pin}.{' '}
            {answer.zone.deliveryFeePaise
              ? `Delivery ${rupees(answer.zone.deliveryFeePaise)}.`
              : 'No delivery charge.'}{' '}
            {answer.zone.minimumOrderPaise
              ? `Smallest order ${rupees(answer.zone.minimumOrderPaise)}.`
              : ''}{' '}
            {answer.zone.freeDeliveryAbovePaise !== null
              ? `Free above ${rupees(answer.zone.freeDeliveryAbovePaise)}.`
              : ''}{' '}
            {answer.zone.estimate} {answer.zone.terms}
          </p>
        ) : null}
        {answer && !answer.serviceable ? (
          <p>
            The shop does not list {pin} for delivery yet.{' '}
            {whatsapp ? (
              <a className="link" href={whatsapp} target="_blank" rel="noopener noreferrer">
                Ask on WhatsApp
              </a>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
