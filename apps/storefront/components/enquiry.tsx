'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CustomerError,
  customerApi,
  errorText,
  localPhone,
  refusedFields,
} from '../lib/customer-api';
import { useLanguage } from './language';

/**
 * "Ask the shop": a visitor with no account leaves a name, a number and a question. The shop's
 * owner sees it on the owner desk's Today screen and phones back. Nothing is sent to the visitor
 * automatically. A hidden field catches robots (a person never fills it).
 */
type Field = 'name' | 'phone' | 'pincode' | 'interest' | 'message';
const fieldNames: Record<Field, [string, string]> = {
  name: ['your name', 'आपका नाम'],
  phone: ['the mobile number', 'मोबाइल नंबर'],
  pincode: ['the pincode', 'पिनकोड'],
  interest: ['the material', 'सामग्री'],
  message: ['your question', 'आपका सवाल'],
};

export function EnquiryForm() {
  const { t, language } = useLanguage();
  const params = useSearchParams();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pincode, setPincode] = useState('');
  const [message, setMessage] = useState('');
  const [interest, setInterest] = useState((params.get('interest') ?? '').slice(0, 200));
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState<Field[]>([]);
  // Keyboard and screen-reader users are taken to what changed: the problem, or the reply.
  const errorRef = useRef<HTMLParagraphElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (sentTo) doneRef.current?.focus();
  }, [sentTo]);
  // The form works once the page can run scripts, so an early tap is not lost.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const problem = (field: Field) =>
    invalid.includes(field)
      ? { 'aria-invalid': true as const, 'aria-describedby': 'enquiry-error' }
      : {};

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setInvalid([]);
    try {
      await customerApi('/web/enquiries', 'POST', {
        name: name.trim(),
        phone: `+91${phone}`,
        ...(pincode ? { pincode } : {}),
        message: message.trim(),
        ...(interest.trim() ? { interest: interest.trim() } : {}),
        language,
        website,
      });
      setSentTo(phone);
    } catch (e) {
      const fields = refusedFields(e).filter((field): field is Field => field in fieldNames);
      if (fields.length) {
        setInvalid(fields);
        const names = fields.map((field) => fieldNames[field][language === 'hi' ? 1 : 0]);
        setError(t(`Please check ${names.join(', ')}.`, `कृपया ${names.join(', ')} जाँचें।`));
      } else if (e instanceof CustomerError && e.status === 429)
        // The shop's number is not shown yet, so this must not say "call the shop".
        setError(
          t(
            'Many messages have just been sent from this network or number. Please try again later.',
            'इस नेटवर्क या नंबर से अभी बहुत संदेश भेजे गए हैं। कृपया कुछ देर बाद फिर कोशिश करें।',
          ),
        );
      else setError(errorText(e, language === 'hi'));
    } finally {
      setBusy(false);
    }
  }

  if (sentTo)
    return (
      <div className="account-form" role="status">
        <h3 ref={doneRef} tabIndex={-1}>
          {t('Your message has reached the shop.', 'आपका संदेश दुकान तक पहुँच गया है।')}
        </h3>
        <p>
          {t(`The shop will contact you on ${sentTo}.`, `दुकान आपसे ${sentTo} पर संपर्क करेगी।`)}
        </p>
        <button
          className="text-link"
          onClick={() => {
            setSentTo('');
            setMessage('');
          }}
        >
          {t('Send another message', 'एक और संदेश भेजें')}
        </button>
      </div>
    );

  return (
    <form className="account-form" onSubmit={(event) => void submit(event)} aria-busy={busy}>
      <label>
        {t('Your name', 'आपका नाम')}
        <input
          required
          maxLength={80}
          autoComplete="name"
          {...problem('name')}
          value={name}
          disabled={!ready || busy}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        {t('Mobile number', 'मोबाइल नंबर')}
        <input
          type="tel"
          required
          autoComplete="tel"
          {...problem('phone')}
          placeholder="9876543210"
          pattern="[6-9][0-9]{9}"
          title={t('A 10-digit mobile number', '10 अंकों का मोबाइल नंबर')}
          value={phone}
          disabled={!ready || busy}
          onChange={(event) => setPhone(localPhone(event.target.value))}
        />
      </label>
      <label>
        {t('Site pincode (optional)', 'साइट का पिनकोड (वैकल्पिक)')}
        <input
          inputMode="numeric"
          autoComplete="postal-code"
          {...problem('pincode')}
          pattern="[1-9][0-9]{5}"
          maxLength={6}
          value={pincode}
          disabled={!ready || busy}
          onChange={(event) => setPincode(event.target.value.replace(/\D/g, ''))}
        />
      </label>
      <label>
        {t(
          'Material you are asking about (optional)',
          'जिस सामग्री के बारे में पूछना है (वैकल्पिक)',
        )}
        <input
          maxLength={200}
          value={interest}
          {...problem('interest')}
          disabled={!ready || busy}
          onChange={(event) => setInterest(event.target.value)}
        />
      </label>
      <label>
        {t('Your question', 'आपका सवाल')}
        <textarea
          required
          rows={4}
          maxLength={1000}
          value={message}
          {...problem('message')}
          disabled={!ready || busy}
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>
      {/* Robots fill every field they find; people never see this one. */}
      <div className="hp" aria-hidden="true">
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
      {error && (
        <p className="error-text" role="alert" id="enquiry-error" ref={errorRef} tabIndex={-1}>
          {error}
        </p>
      )}
      <button className="button" disabled={!ready || busy}>
        {busy ? t('Please wait…', 'कृपया रुकें…') : t('Send to the shop', 'दुकान को भेजें')}
      </button>
      <p className="form-note">
        {t(
          'We use your number only to reply to this message.',
          'आपका नंबर सिर्फ़ इस संदेश का जवाब देने के लिए इस्तेमाल होगा।',
        )}
      </p>
    </form>
  );
}
