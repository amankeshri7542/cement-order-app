'use client';
import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import type { DeliveryZone, Page, Product } from '@shiv/shared';
import { api } from '../lib/api';
import { useWords } from '../lib/i18n';

type Staff = { whatsappAlerts: boolean; _count: { pushSubscriptions: number } };
export type SetupTarget = 'zones' | 'products' | 'store' | 'alerts';
type Status = Record<SetupTarget, boolean>;

/** What a new store still needs before customers can order, read from the live records. */
export async function setupStatus(settingsVersion: number | null): Promise<Status> {
  const [zones, products, staff] = await Promise.all([
    api<DeliveryZone[]>('/admin/delivery-zones'),
    // The customer catalogue: an active material with stock (prices are always above zero).
    api<Page<Product>>('/products?availability=in&limit=1'),
    api<Staff[]>('/admin/staff'),
  ]);
  return {
    zones: zones.some((zone) => zone.active && zone.pincodes.length > 0),
    products: products.items.length > 0,
    // The store details start from a built-in default; one save by the owner confirms them.
    store: Boolean(settingsVersion && settingsVersion > 1),
    alerts: staff.some((person) => person.whatsappAlerts || person._count.pushSubscriptions > 0),
  };
}

/**
 * The first-run checklist on Today. Each row ticks itself from real data and opens the screen
 * that does the job; the whole card disappears once all four are done.
 */
export function SetupChecklist({
  settingsVersion,
  open,
}: {
  settingsVersion: number | null;
  open: (target: SetupTarget) => void;
}) {
  const { t, error: say } = useWords();
  const [status, setStatus] = useState<Status | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const load = useCallback(() => {
    void setupStatus(settingsVersion)
      .then((next) => {
        setStatus(next);
        setProblem(null);
      })
      .catch(setProblem);
  }, [settingsVersion]);
  useEffect(() => {
    load();
    window.addEventListener('shiv-owner-refresh', load);
    return () => window.removeEventListener('shiv-owner-refresh', load);
  }, [load]);
  if (problem && !status)
    return (
      <p className="warning" role="status">
        {t('The setup checklist could not load.', 'शुरुआती सूची लोड नहीं हुई।')} {say(problem)}{' '}
        <button className="text-button" onClick={load}>
          {t('Try again', 'फिर कोशिश करें')}
        </button>
      </p>
    );
  if (!status) return null;
  const rows: { key: SetupTarget; title: string; detail: string; action: string }[] = [
    {
      key: 'zones',
      title: t('Delivery pincodes and fees', 'डिलीवरी पिनकोड और भाड़ा'),
      detail: t(
        'Add the pincodes you deliver to, with the fee and minimum order. Customers cannot order without this.',
        'जिन पिनकोड पर माल भेजते हैं, उन्हें भाड़े और कम से कम ऑर्डर के साथ जोड़ें। इसके बिना ग्राहक ऑर्डर नहीं कर सकते।',
      ),
      action: t('Open delivery areas', 'डिलीवरी क्षेत्र खोलें'),
    },
    {
      key: 'products',
      title: t('First material with price and stock', 'पहली सामग्री, भाव और स्टॉक के साथ'),
      detail: t(
        'Add one material with its selling price and the stock you have now.',
        'एक सामग्री उसके बिक्री भाव और अभी के स्टॉक के साथ जोड़ें।',
      ),
      action: t('Open prices & stock', 'भाव और स्टॉक खोलें'),
    },
    {
      key: 'store',
      title: t('Store phone and WhatsApp number', 'दुकान का फ़ोन और WhatsApp नंबर'),
      detail: t(
        'Check the number customers will call, then press Save settings once.',
        'ग्राहक जिस नंबर पर फ़ोन करेंगे, उसे जाँचें, फिर एक बार "सेटिंग सहेजें" दबाएँ।',
      ),
      action: t('Open store details', 'दुकान की जानकारी खोलें'),
    },
    {
      key: 'alerts',
      title: t('New-order alerts switched on', 'नए ऑर्डर का अलर्ट चालू'),
      detail: t(
        'Switch on alerts on this device or WhatsApp alerts for one staff member, so no order waits unseen.',
        'इस डिवाइस पर या किसी स्टाफ़ के WhatsApp पर अलर्ट चालू करें, ताकि कोई ऑर्डर बिना देखे न रहे।',
      ),
      action: t('Open staff & alerts', 'स्टाफ़ और अलर्ट खोलें'),
    },
  ];
  const done = rows.filter((row) => status[row.key]).length;
  if (done === rows.length) return null;
  return (
    <section className="panel padded setup-checklist" aria-labelledby="setup-title">
      <div className="setup-head">
        <div>
          <h2 id="setup-title">{t('Set up your store', 'दुकान तैयार करें')}</h2>
          <p className="muted">
            {t(
              'Four things before the first customer order. Each one ticks itself when it is done.',
              'पहले ग्राहक ऑर्डर से पहले चार काम। हर काम पूरा होते ही अपने-आप टिक हो जाता है।',
            )}
          </p>
        </div>
        <strong
          className="setup-count"
          aria-label={t(`${done} of 4 done`, `4 में से ${done} पूरे`)}
        >
          {done}/4
        </strong>
      </div>
      <ol className="setup-steps">
        {rows.map((row, index) => {
          const ok = status[row.key];
          return (
            <li key={row.key} className={ok ? 'done' : ''}>
              <span className="setup-mark" aria-hidden="true">
                {ok ? <Check size={18} /> : index + 1}
              </span>
              <div>
                <strong>{row.title}</strong>
                <span className="sr-only">
                  {ok ? t('Done.', 'पूरा।') : t('Not done yet.', 'अभी बाकी।')}
                </span>
                {!ok && <p>{row.detail}</p>}
              </div>
              {!ok && (
                <button className="secondary" onClick={() => open(row.key)}>
                  {row.action} <ChevronRight size={16} aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
