'use client';
import { X, Package, ArrowUpRight } from 'lucide-react';
import { statusLabel } from '@shiv/shared';
import { useEffect, useRef } from 'react';
export function Badge({ value }: { value: string }) {
  return <span className={`badge ${value.toLowerCase()}`}>{statusLabel(value)}</span>;
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
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={close}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={close}>
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
