'use client';
import { useCallback, useEffect, useState } from 'react';
import { Page } from '@shiv/shared';
import { BellRing, MessageCircle, Volume2 } from 'lucide-react';
import { api } from '../lib/api';
import { useWords } from '../lib/i18n';
import { chime, disablePush, enablePush, pushEnabled, pushSupported } from '../lib/push';
import { Field, Modal } from './ui';

type Staff = {
  id: string;
  name: string | null;
  phone: string;
  staffTitle: string;
  whatsappAlerts: boolean;
  _count: { pushSubscriptions: number };
};
type Message = {
  id: string;
  template: string;
  recipient: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  attempts: number;
  lastError: string | null;
  createdAt: string;
};
const soundKey = 'shiv-owner-sound';
/** Whether the desk plays the new-work bell (on unless switched off on this device). */
export function soundOn() {
  try {
    return localStorage.getItem(soundKey) !== 'off';
  } catch {
    return true;
  }
}

/** Staff names and roles, and how each person hears about new orders and quotes. */
export function StaffAlerts({ me }: { me: string }) {
  const { t, error: say, moment } = useWords();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [device, setDevice] = useState<boolean | null>(null);
  const [sound, setSound] = useState(true);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [people, log] = await Promise.all([
      api<Staff[]>('/admin/staff'),
      api<Page<Message>>('/admin/alerts/messages?limit=20'),
    ]);
    setStaff(people);
    setMessages(log.items);
  }, []);
  useEffect(() => {
    setSound(soundOn());
    void pushEnabled().then(setDevice, () => setDevice(false));
    const refreshVisible = () => {
      void load()
        .then(() => setError(''))
        .catch((e) => setError(say(e)));
    };
    refreshVisible();
    window.addEventListener('shiv-owner-refresh', refreshVisible);
    return () => window.removeEventListener('shiv-owner-refresh', refreshVisible);
  }, [load]);
  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError('');
    setNote('');
    try {
      await work();
      setNote(done);
      await load();
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  };
  const templateText: Record<string, string> = {
    shiv_new_order: t('New order alert', 'नया ऑर्डर अलर्ट'),
    shiv_new_quote: t('New quote request alert', 'नया भाव अनुरोध अलर्ट'),
    shiv_order_status: t('Customer order update', 'ग्राहक को ऑर्डर अपडेट'),
    shiv_test_alert: t('Test alert', 'जाँच अलर्ट'),
  };
  const statusText: Record<Message['status'], string> = {
    PENDING: t('Waiting to send', 'भेजना बाकी'),
    SENT: t('Sent', 'भेजा गया'),
    FAILED: t('Failed', 'नहीं गया'),
    SKIPPED: t('Skipped (daily limit)', 'रोका (दिन की सीमा)'),
  };
  return (
    <section className="form-stack">
      <section className="panel padded">
        <h2>
          <BellRing size={21} /> {t('Alerts on this device', 'इस फ़ोन/कंप्यूटर पर अलर्ट')}
        </h2>
        <p className="muted">
          {t(
            'Get a notification with sound for every new order and quote request, even when the desk is closed. Add the desk to the home screen first on Android (Chrome menu → Add to Home screen).',
            'हर नए ऑर्डर और भाव अनुरोध पर आवाज़ के साथ सूचना, डेस्क बंद होने पर भी। Android पर पहले Chrome मेनू → "होम स्क्रीन में जोड़ें" करें।',
          )}
        </p>
        {!pushSupported() ? (
          <p className="warning">
            {t(
              'This browser cannot show alerts. Use Chrome on Android or a desktop browser.',
              'यह ब्राउज़र अलर्ट नहीं दिखा सकता। Android पर Chrome या कंप्यूटर ब्राउज़र इस्तेमाल करें।',
            )}
          </p>
        ) : (
          <div className="button-row">
            {device ? (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await disablePush();
                    setDevice(false);
                  }, t('Alerts turned off on this device.', 'इस डिवाइस पर अलर्ट बंद।'))
                }
              >
                {t('Turn off alerts here', 'यहाँ अलर्ट बंद करें')}
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await enablePush();
                    setDevice(true);
                  }, t('Alerts are on for this device.', 'इस डिवाइस पर अलर्ट चालू।'))
                }
              >
                {t('Turn on alerts here', 'यहाँ अलर्ट चालू करें')}
              </button>
            )}
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void act(
                  () => api('/admin/alerts/test', 'POST', {}),
                  t(
                    'Test alert sent to your switched-on devices and WhatsApp.',
                    'जाँच अलर्ट आपके चालू डिवाइस और WhatsApp पर भेजा।',
                  ),
                )
              }
            >
              {t('Send a test alert', 'जाँच अलर्ट भेजें')}
            </button>
          </div>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => {
              setSound(e.target.checked);
              try {
                localStorage.setItem(soundKey, e.target.checked ? 'on' : 'off');
              } catch {
                /* Keep this visit usable when browser storage is disabled. */
              }
              if (e.target.checked) chime();
            }}
          />{' '}
          <Volume2 size={16} />{' '}
          {t('Ring a bell for new work while the desk is open', 'डेस्क खुला हो तो नए काम पर घंटी बजे')}
        </label>
        {note && <p role="status">{note}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
      <section className="panel padded">
        <h2>{t('Shop staff', 'दुकान का स्टाफ़')}</h2>
        <p className="muted">
          {t(
            'Adding a new staff login is done by the technical operator, for safety.',
            'सुरक्षा के लिए नया स्टाफ़ लॉगिन तकनीकी व्यक्ति बनाते हैं।',
          )}
        </p>
        {staff.map((s) => (
          <div className="session-row" key={s.id}>
            <div>
              <strong>
                {s.name || t('Unnamed staff', 'बिना नाम')}
                {s.id === me ? ` · ${t('you', 'आप')}` : ''}
              </strong>
              <small>
                {[
                  s.staffTitle,
                  s.phone,
                  s.whatsappAlerts ? t('WhatsApp alerts on', 'WhatsApp अलर्ट चालू') : '',
                  t(
                    `${s._count.pushSubscriptions} alert devices`,
                    `${s._count.pushSubscriptions} अलर्ट डिवाइस`,
                  ),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </div>
            <button
              className="secondary"
              aria-label={`${t('Edit', 'बदलें')} ${s.name || s.phone}`}
              onClick={() => setEditing(s)}
            >
              {t('Edit', 'बदलें')}
            </button>
          </div>
        ))}
      </section>
      <section className="panel padded">
        <h2>
          <MessageCircle size={21} /> {t('WhatsApp messages', 'WhatsApp संदेश')}
        </h2>
        <p className="muted">
          {t(
            'Recent alert messages. Phone numbers are partly hidden.',
            'हाल के अलर्ट संदेश। नंबर आधे छिपे हैं।',
          )}
        </p>
        <ol className="activity-list">
          {messages.map((m) => (
            <li key={m.id}>
              <strong>{templateText[m.template] || m.template}</strong>
              <span>
                {[m.recipient, statusText[m.status], m.attempts > 1 ? `${t('tries', 'कोशिश')} ${m.attempts}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {m.lastError && m.status !== 'SENT' && <small>{m.lastError}</small>}
              <small>{moment(m.createdAt)}</small>
              {(m.status === 'FAILED' || m.status === 'SKIPPED') && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => api(`/admin/alerts/messages/${m.id}/retry`, 'POST', {}),
                      t('Message queued again.', 'संदेश फिर से कतार में।'),
                    )
                  }
                >
                  {t('Send again', 'फिर भेजें')}
                </button>
              )}
            </li>
          ))}
        </ol>
        {!messages.length && <p>{t('No WhatsApp messages yet.', 'अभी कोई WhatsApp संदेश नहीं।')}</p>}
      </section>
      {editing && (
        <Modal title={t('Edit staff', 'स्टाफ़ बदलें')} close={() => setEditing(null)}>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act(async () => {
                await api(`/admin/staff/${editing.id}`, 'PATCH', {
                  name: String(f.get('name')),
                  staffTitle: String(f.get('title') || ''),
                  whatsappAlerts: f.get('whatsapp') === 'on',
                });
                setEditing(null);
              }, t('Staff details saved.', 'स्टाफ़ की जानकारी सहेजी।'));
            }}
          >
            <Field label={t('Name', 'नाम')}>
              <input name="name" defaultValue={editing.name || ''} required maxLength={100} />
            </Field>
            <Field label={t('Role at the shop', 'दुकान में काम')}>
              <input
                name="title"
                defaultValue={editing.staffTitle}
                maxLength={60}
                placeholder={t('Retail counter / Bulk quotes', 'खुदरा काउंटर / थोक भाव')}
              />
            </Field>
            <label className="check">
              <input type="checkbox" name="whatsapp" defaultChecked={editing.whatsappAlerts} />{' '}
              {t(
                `Send new-order WhatsApp alerts to ${editing.phone}`,
                `${editing.phone} पर नए ऑर्डर का WhatsApp अलर्ट भेजें`,
              )}
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {t('Save', 'सहेजें')}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
