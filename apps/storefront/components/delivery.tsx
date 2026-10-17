'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { deliveryResponse, publicGet } from '../lib/api';
import { price } from '../lib/catalog';
import { useLanguage } from './language';
import { useLiveRefresh } from './live';
import { useSavedPincode } from './first-run';

/**
 * The pincode check: a full section on the home page, a compact one in the basket. The last
 * checked pincode is remembered on this device and checked again on the next visit.
 */
export function Delivery({ variant = 'home' }: { variant?: 'home' | 'hero' | 'basket' }) {
  const { t } = useLanguage();
  const [saved, remember] = useSavedPincode();
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
      if (request.current === current) {
        setResult(data);
        remember(value);
      }
    } catch {
      if (request.current === current) setError('network');
    } finally {
      if (request.current === current) setBusy(false);
    }
  }
  // A remembered pincode is filled in and checked once the page can run scripts.
  const checkedSaved = useRef('');
  useEffect(() => {
    if (!ready || !saved || checkedSaved.current === saved || checkedPincode.current) return;
    checkedSaved.current = saved;
    setPincode(saved);
    void check(saved);
    // check reads only refs and setters; a new saved pincode is what should trigger it.
  }, [ready, saved]);
  const basket = variant === 'basket';
  return (
    <section
      className={`delivery-section delivery-${variant}`}
      id={basket ? 'basket-delivery' : 'delivery'}
      aria-labelledby="delivery-title"
    >
      {/* The delivery coupon: an ink slip with a dotted tear line between its two halves. */}
      <div className="delivery-heading">
        <div>
          <h2 id="delivery-title">
            {basket
              ? t('Delivery to your site', 'आपकी साइट पर डिलीवरी')
              : t('Start with your pincode.', 'अपने पिनकोड से शुरू करें।')}
          </h2>
          <p>
            {basket
              ? t(
                  'See the fee and minimum order for your site before checkout.',
                  'चेकआउट से पहले अपनी साइट का डिलीवरी शुल्क और न्यूनतम ऑर्डर देखें।',
                )
              : t(
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
                  {t(
                    `Delivery to ${checkedPincode.current}`,
                    `${checkedPincode.current} पर डिलीवरी`,
                  )}
                </strong>
                <p>
                  {result.zone.name}
                  {result.zone.estimate ? ` · ${result.zone.estimate}` : ''}
                </p>
                {result.zone.terms ? (
                  <p>
                    {t('Delivery terms', 'डिलीवरी शर्तें')}: {result.zone.terms}
                  </p>
                ) : null}
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
                    'This is a delivery check, not a booking. Checkout shows the current terms again before you confirm.',
                    'यह डिलीवरी की जाँच है, बुकिंग नहीं। पुष्टि से पहले चेकआउट में मौजूदा शर्तें फिर दिखती हैं।',
                  )}
                </small>
              </>
            ) : (
              <>
                <strong>
                  {t(
                    `${checkedPincode.current} is not on the delivery list yet.`,
                    `${checkedPincode.current} अभी डिलीवरी सूची में नहीं है।`,
                  )}
                </strong>
                <p>
                  {t(
                    'Check that it is the pincode of your site. For another area, send a bulk quote: the shop replies with freight if it can deliver there.',
                    'जाँचें कि यह आपकी साइट का पिनकोड है। दूसरे इलाक़े के लिए थोक भाव माँगें: दुकान वहाँ पहुँचा सके तो भाड़े के साथ जवाब देगी।',
                  )}
                </p>
                <Link className="text-link" href="/quotes">
                  {t('Ask for a bulk quote', 'थोक भाव माँगें')} <span aria-hidden="true">→</span>
                </Link>
              </>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
