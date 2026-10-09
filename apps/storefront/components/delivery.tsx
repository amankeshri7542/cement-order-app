'use client';

import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { deliveryResponse, publicGet } from '../lib/api';
import { price } from '../lib/catalog';
import { useLanguage } from './language';
import { useLiveRefresh } from './live';

export function Delivery() {
  const { t } = useLanguage();
  const [pincode, setPincode] = useState('');
  const [result, setResult] = useState<z.infer<typeof deliveryResponse> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'invalid' | 'network' | null>(null);
  const [ready, setReady] = useState(false);
  const request = useRef(0);
  const checkedPincode = useRef<string | null>(null);
  useEffect(() => {
    setReady(true);
    return () => {
      request.current++;
    };
  }, []);
  useLiveRefresh(() => {
    if (checkedPincode.current) void check(checkedPincode.current);
  });
  async function check(value = pincode) {
    const current = ++request.current;
    setResult(null);
    if (!/^[1-9]\d{5}$/.test(value)) {
      checkedPincode.current = null;
      setError('invalid');
      setBusy(false);
      return;
    }
    checkedPincode.current = value;
    setError(null);
    setBusy(true);
    try {
      const data = await publicGet(`/delivery/${value}`, deliveryResponse);
      if (request.current === current) setResult(data);
    } catch {
      if (request.current === current) setError('network');
    } finally {
      if (request.current === current) setBusy(false);
    }
  }
  return (
    <section className="delivery-section" id="delivery" aria-labelledby="delivery-title">
      <div className="delivery-heading">
        <span className="delivery-mark" aria-hidden="true">
          ↗
        </span>
        <div>
          <p className="eyebrow">{t('BEFORE YOU PLAN A DELIVERY', 'डिलीवरी की तैयारी से पहले')}</p>
          <h2 id="delivery-title">{t('Start with your pincode.', 'अपने पिनकोड से शुरू करें।')}</h2>
          <p>
            {t(
              'Check the listed delivery area, charges and minimum order for your site.',
              'अपने काम की जगह पर डिलीवरी क्षेत्र, शुल्क और न्यूनतम ऑर्डर जाँचें।',
            )}
          </p>
        </div>
      </div>
      <div className="delivery-check">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void check();
          }}
          noValidate
        >
          <label htmlFor="delivery-pincode">{t('Delivery pincode', 'डिलीवरी पिनकोड')}</label>
          <div className="pincode-input">
            <input
              id="delivery-pincode"
              disabled={!ready}
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={6}
              placeholder="800001"
              value={pincode}
              aria-invalid={error === 'invalid'}
              aria-describedby={error ? 'delivery-error' : undefined}
              onChange={(event) => {
                request.current++;
                checkedPincode.current = null;
                setBusy(false);
                setResult(null);
                setError(null);
                setPincode(event.target.value.replace(/\D/g, '').slice(0, 6));
              }}
            />
            <button className="button" disabled={!ready || busy}>
              {busy ? t('Checking…', 'जाँच रहे हैं…') : t('Check pincode', 'पिनकोड जाँचें')}
            </button>
          </div>
        </form>
        {error ? (
          <p id="delivery-error" role="alert">
            {error === 'invalid'
              ? t('Enter a valid six-digit pincode.', 'सही छह अंकों का पिनकोड डालें।')
              : t(
                  'Delivery information could not load. Check your connection and try Check pincode again.',
                  'डिलीवरी की जानकारी लोड नहीं हो सकी। इंटरनेट जाँचें और फिर पिनकोड जाँचें।',
                )}
          </p>
        ) : null}
        {result ? (
          <div className="delivery-result" role="status">
            {result.serviceable && result.zone ? (
              <>
                <strong>
                  {t('Delivery listed for this pincode', 'इस पिनकोड पर डिलीवरी दर्ज है')}
                </strong>
                <p>
                  {result.zone.name} · {result.zone.estimate}
                </p>
                <p>
                  {t('Delivery fee', 'डिलीवरी शुल्क')}: {price(result.zone.deliveryFeePaise)}
                  <br />
                  {t('Minimum order', 'न्यूनतम ऑर्डर')}: {price(result.zone.minimumOrderPaise)}
                  {result.zone.freeDeliveryAbovePaise !== null ? (
                    <>
                      <br />
                      {t('Free delivery from', 'इस राशि से मुफ़्त डिलीवरी')}:{' '}
                      {price(result.zone.freeDeliveryAbovePaise)}
                    </>
                  ) : null}
                </p>
                <small>
                  {t(
                    'This is a delivery check, not a booking. Confirm timing and charges with the store before purchase.',
                    'यह डिलीवरी की जाँच है, बुकिंग नहीं। खरीदारी से पहले दुकान से समय और शुल्क की पुष्टि करें।',
                  )}
                </small>
              </>
            ) : (
              <>
                <strong>
                  {t(
                    'Delivery is not listed for this pincode.',
                    'इस पिनकोड पर डिलीवरी दर्ज नहीं है।',
                  )}
                </strong>
                <p>
                  {t(
                    'Please confirm delivery arrangements with the store before planning your purchase.',
                    'खरीदारी की तैयारी से पहले दुकान से डिलीवरी की व्यवस्था की पुष्टि करें।',
                  )}
                </p>
              </>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
