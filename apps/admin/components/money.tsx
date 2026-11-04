'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MoneyReport as Report, istToday, money, shortDayLabel } from '@shiv/shared';
import { Download } from 'lucide-react';
import { api, download } from '../lib/api';
import { useWords } from '../lib/i18n';
import { Field } from './ui';

const shift = (day: string, days: number) =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
const monthStart = (day: string) => `${day.slice(0, 8)}01`;

/** The shop's money for a range of days: orders, cash vs UPI, counter sales, refunds, quotes. */
export function MoneyReport() {
  const { t, error: say, language } = useWords();
  const today = istToday();
  const [range, setRange] = useState({ from: today, to: today });
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const query = `from=${range.from}&to=${range.to}`;
  // Only the latest request may fill the cards: a slow earlier range must not replace the
  // range the owner picked last.
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    setBusy(true);
    try {
      const next = await api<Report>(`/admin/reports/money?${query}`);
      if (current !== sequence.current) return;
      setReport(next);
      setError('');
    } catch (e) {
      if (current === sequence.current) setError(say(e));
    } finally {
      if (current === sequence.current) setBusy(false);
    }
  }, [query]);
  useEffect(() => {
    void load();
    window.addEventListener('shiv-owner-refresh', load);
    return () => window.removeEventListener('shiv-owner-refresh', load);
  }, [load]);
  const presets = [
    { label: t('Today', 'आज'), from: today, to: today },
    { label: t('Yesterday', 'कल'), from: shift(today, -1), to: shift(today, -1) },
    { label: t('Last 7 days', 'पिछले 7 दिन'), from: shift(today, -6), to: today },
    { label: t('This month', 'इस महीने'), from: monthStart(today), to: today },
  ];
  const r = report;
  return (
    <section className="money-report form-stack">
      <div className="panel padded">
        <div className="chips" role="group" aria-label={t('Date range', 'तारीख़')}>
          {presets.map((p) => (
            <button
              key={p.label}
              className={p.from === range.from && p.to === range.to ? 'primary' : 'secondary'}
              aria-pressed={p.from === range.from && p.to === range.to}
              onClick={() => setRange({ from: p.from, to: p.to })}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <Field label={t('From', 'से')}>
            <input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) =>
                e.target.value && setRange((old) => ({ ...old, from: e.target.value }))
              }
            />
          </Field>
          <Field label={t('To', 'तक')}>
            <input
              type="date"
              value={range.to}
              min={range.from}
              max={today}
              onChange={(e) =>
                e.target.value && setRange((old) => ({ ...old, to: e.target.value }))
              }
            />
          </Field>
        </div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void download(
              `/admin/reports/money.csv?${query}`,
              `shiv-money-${range.from}-to-${range.to}.csv`,
            ).catch((e) => setError(say(e)))
          }
        >
          <Download size={17} /> {t('Download for Excel (CSV)', 'Excel के लिए डाउनलोड (CSV)')}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {r && (
        <>
          <section className="stats-grid" aria-label={t('Money summary', 'पैसे का सार')}>
            <article className="stat-card">
              <span>{t('Net collected', 'कुल मिला (शुद्ध)')}</span>
              <strong>{money(r.netPaise)}</strong>
              <small>{t('All money in, minus refunds', 'सारी वसूली, लौटाया पैसा घटाकर')}</small>
            </article>
            <article className="stat-card">
              <span>{t('Cash', 'नकद')}</span>
              <strong>{money(r.collections.cashPaise + r.counter.cashPaise)}</strong>
              <small>
                {t('Orders', 'ऑर्डर')} {money(r.collections.cashPaise)} · {t('counter', 'काउंटर')}{' '}
                {money(r.counter.cashPaise)}
              </small>
            </article>
            <article className="stat-card">
              <span>UPI</span>
              <strong>{money(r.collections.upiPaise + r.counter.upiPaise)}</strong>
              <small>
                {t('Orders', 'ऑर्डर')} {money(r.collections.upiPaise)} · {t('counter', 'काउंटर')}{' '}
                {money(r.counter.upiPaise)}
              </small>
            </article>
            <article className="stat-card">
              <span>{t('Cash still to collect', 'अभी लेना बाकी')}</span>
              <strong>{money(r.pendingCash.amountPaise)}</strong>
              <small>
                {t(
                  `${r.pendingCash.orders} open COD orders (all dates)`,
                  `${r.pendingCash.orders} खुले COD ऑर्डर (सभी दिन)`,
                )}
              </small>
            </article>
          </section>
          <section className="panel padded money-lines">
            <h2>{t('Details', 'विवरण')}</h2>
            <dl>
              <dt>{t('Orders placed', 'ऑर्डर आए')}</dt>
              <dd>
                {r.orders.placed} · {money(r.orders.valuePaise)}
              </dd>
              <dt>{t('Delivered / cancelled', 'पहुँचे / रद्द')}</dt>
              <dd>
                {r.orders.delivered} / {r.orders.cancelled}
              </dd>
              <dt>{t('Counter sales', 'काउंटर बिक्री')}</dt>
              <dd>
                {r.counter.sales} ·{' '}
                {money(r.counter.cashPaise + r.counter.upiPaise + r.counter.unrecordedPaise)}
              </dd>
              {r.collections.onlinePaise > 0 && (
                <>
                  <dt>{t('Online payments', 'ऑनलाइन भुगतान')}</dt>
                  <dd>{money(r.collections.onlinePaise)}</dd>
                </>
              )}
              {r.collections.unrecordedPaise + r.counter.unrecordedPaise > 0 && (
                <>
                  <dt>{t('Collected, method not recorded', 'मिला, तरीका दर्ज नहीं')}</dt>
                  <dd>{money(r.collections.unrecordedPaise + r.counter.unrecordedPaise)}</dd>
                </>
              )}
              <dt>{t('Refunds returned', 'लौटाया पैसा')}</dt>
              <dd>{money(r.refundsPaise)}</dd>
              <dt>
                {t('Quotes asked / sent / won / lost', 'भाव माँगे / भेजे / मंज़ूर / नामंज़ूर')}
              </dt>
              <dd>
                {r.quotes.requested} / {r.quotes.sent} / {r.quotes.accepted} /{' '}
                {r.quotes.rejected + r.quotes.expired}
              </dd>
            </dl>
            <small>
              {t(
                'By India time. Collections are not profit; purchase costs are not tracked.',
                'भारतीय समय से। वसूली मुनाफ़ा नहीं है; ख़रीद की लागत यहाँ दर्ज नहीं होती।',
              )}
            </small>
          </section>
          {r.days.length > 1 && (
            <div className="panel table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('Day', 'दिन')}</th>
                    <th>{t('Orders', 'ऑर्डर')}</th>
                    <th>{t('Collected', 'वसूली')}</th>
                    <th>{t('Counter', 'काउंटर')}</th>
                    <th>{t('Refunds', 'लौटाया')}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.days.map((d) => (
                    <tr key={d.date}>
                      <td>{shortDayLabel(d.date, language)}</td>
                      <td>{d.orders}</td>
                      <td>{money(d.collectedPaise)}</td>
                      <td>{money(d.counterPaise)}</td>
                      <td>{money(d.refundsPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
