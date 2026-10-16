'use client';
import { X, Package, ArrowUpRight } from 'lucide-react';
import { statusLabel } from '@shiv/shared';
import { useEffect, useId, useRef } from 'react';
import { useWords } from '../lib/i18n';
// Desk-only states that are not order, quote or payment statuses.
const deskStates: Record<string, [string, string]> = {
  INACTIVE: ['Hidden', 'छिपा'],
  IN_STOCK: ['In stock', 'स्टॉक में'],
  OUT_OF_STOCK: ['Out of stock', 'स्टॉक ख़त्म'],
  CUSTOMER: ['Customer', 'ग्राहक'],
  CONTRACTOR: ['Contractor', 'ठेकेदार'],
  ADMIN: ['Staff', 'स्टाफ़'],
  // Quote states from the shop's side (the shared labels speak to the customer).
  REQUESTED: ['Requested', 'अनुरोध आया'],
  SENT: ['Sent', 'भाव भेजा'],
  ACCEPTED: ['Accepted · create the order', 'मंज़ूर · ऑर्डर बनाएँ'],
};
export function Badge({ value }: { value: string }) {
  const { status, language, t } = useWords();
  const desk = deskStates[value];
  const text = desk ? t(...desk) : status(value);
  return (
    <span className={`badge ${value.toLowerCase()}`}>
      {text === value && language === 'en' ? statusLabel(value) : text}
    </span>
  );
}
export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty">
      <Package size={32} strokeWidth={1.4} />
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const { t } = useWords();
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="modal-head">
        <h2 id={heading}>{title}</h2>
        <button className="icon-button" aria-label={t('Close dialog', 'बंद करें')} onClick={close}>
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function SectionTitle({
  title,
  sub,
  action,
  onAction,
}: {
  title: string;
  sub?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {action && (
        <button className="text-button" onClick={onAction}>
          {action}
          <ArrowUpRight size={16} />
        </button>
      )}
    </div>
  );
}
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
