'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  DeliveryZone,
  InventoryMovement,
  Page,
  Product,
  SessionInfo,
  money,
  statusLabel,
} from '@shiv/shared';
import { api, errorMessage } from '../lib/api';
import { Field, Modal } from './ui';

export function Inventory({
  product,
  close,
  refresh,
}: {
  product: Product;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [rows, setRows] = useState<InventoryMovement[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const load = useCallback(
    async (after?: string) => {
      const page = await api<Page<InventoryMovement>>(
        `/admin/products/${product.id}/movements?limit=20${after ? '&cursor=' + encodeURIComponent(after) : ''}`,
      );
      setRows((old) => (after ? [...old, ...page.items] : page.items));
      setCursor(page.nextCursor);
    },
    [product.id],
  );
  useEffect(() => {
    const refreshVisible = () => {
      void load()
        .then(() => setError(''))
        .catch((e) => setError(errorMessage(e)));
    };
    refreshVisible();
    window.addEventListener('shiv-owner-refresh', refreshVisible);
    return () => window.removeEventListener('shiv-owner-refresh', refreshVisible);
  }, [load]);
  return (
    <Modal title={`Stock ledger · ${product.name}`} close={close}>
      <p>Quantities use {product.unit}. Corrections are new movements; past entries stay intact.</p>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const form = e.currentTarget,
            f = new FormData(form);
          try {
            await api(`/admin/products/${product.id}/movements`, 'POST', {
              kind: f.get('kind'),
              quantity: Number(f.get('quantity')),
              reference: f.get('reference'),
              note: f.get('note'),
              idempotencyKey: key,
            });
            setKey(crypto.randomUUID());
            form.reset();
            await Promise.all([load(), refresh()]).catch(() =>
              setError(
                'Stock movement recorded. The latest balance could not be refreshed; do not repeat the entry. Use Refresh data.',
              ),
            );
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Movement">
            <select name="kind">
              {['PURCHASE_IN', 'WALK_IN_SALE', 'RETURN', 'DAMAGE', 'MANUAL_ADJUSTMENT'].map((k) => (
                <option key={k} value={k}>
                  {statusLabel(k)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity">
            <input name="quantity" type="number" step="1" required min="-1000000" max="1000000" />
          </Field>
          <Field label="Receipt / reference">
            <input name="reference" maxLength={100} />
          </Field>
          <Field label="Reason">
            <input name="note" required maxLength={500} />
          </Field>
        </div>
        <p className="muted">
          Enter a positive quantity for purchases, sales, returns and damage. Only manual
          adjustments accept negative quantities.
        </p>
        <button className="primary" disabled={busy}>
          Record stock movement
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When / movement</th>
              <th>Change</th>
              <th>Balance</th>
              <th>Reference / reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {new Date(r.createdAt).toLocaleString('en-IN')}
                  <small>{statusLabel(r.kind)}</small>
                </td>
                <td>
                  {r.quantity > 0 ? '+' : ''}
                  {r.quantity}
                </td>
                <td>{r.balanceAfter}</td>
                <td>
                  {r.reference}
                  <small>{r.note}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p>No movements recorded yet.</p>}
      {cursor && (
        <button
          className="secondary"
          onClick={() => void load(cursor).catch((e) => setError(errorMessage(e)))}
        >
          Older movements
        </button>
      )}
    </Modal>
  );
}

export function DeliveryZones() {
  const [zones, setZones] = useState<DeliveryZone[]>([]),
    [editing, setEditing] = useState<DeliveryZone | 'new' | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    async () => setZones(await api<DeliveryZone[]>('/admin/delivery-zones')),
    [],
  );
  useEffect(() => {
    const refreshVisible = () => {
      void load()
        .then(() => setError(''))
        .catch((e) => setError(errorMessage(e)));
    };
    refreshVisible();
    window.addEventListener('shiv-owner-refresh', refreshVisible);
    return () => window.removeEventListener('shiv-owner-refresh', refreshVisible);
  }, [load]);
  const zone = editing === 'new' ? null : editing;
  return (
    <section className="panel operations-panel">
      <div className="section-title">
        <div>
          <h2>Delivery areas</h2>
          <p>Only active, listed pincodes can check out. Each pincode belongs to one zone.</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setError('');
            setEditing('new');
          }}
        >
          Add delivery zone
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="zone-grid">
        {zones.map((z) => (
          <button
            key={z.id}
            className="zone-card"
            onClick={() => {
              setError('');
              setEditing(z);
            }}
          >
            <strong>{z.name}</strong>
            <span>
              {z.active ? 'Active' : 'Inactive'} · {money(z.deliveryFeePaise)} delivery
            </span>
            <span>{z.pincodes.map((p) => p.pincode).join(', ')}</span>
            <small>{z.estimate}</small>
          </button>
        ))}
      </div>
      {!zones.length && (
        <p>No delivery zones. Add verified serviceable pincodes before accepting orders.</p>
      )}
      {editing && (
        <Modal
          title={zone ? 'Edit delivery zone' : 'Add delivery zone'}
          close={() => setEditing(null)}
        >
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                await api(
                  zone ? `/admin/delivery-zones/${zone.id}` : '/admin/delivery-zones',
                  zone ? 'PATCH' : 'POST',
                  {
                    name: f.get('name'),
                    active: f.get('active') === 'on',
                    pincodes: String(f.get('pincodes'))
                      .split(/[\s,]+/)
                      .filter(Boolean),
                    deliveryFeePaise: Math.round(Number(f.get('fee')) * 100),
                    minimumOrderPaise: Math.round(Number(f.get('minimum')) * 100),
                    freeDeliveryAbovePaise:
                      f.get('free') === '' ? null : Math.round(Number(f.get('free')) * 100),
                    estimate: f.get('estimate'),
                    ...(zone ? { expectedVersion: zone.version } : {}),
                  },
                );
                await load();
                setEditing(null);
                setError('');
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Zone name">
              <input name="name" defaultValue={zone?.name} required maxLength={100} />
            </Field>
            <Field label="Pincodes, separated by commas">
              <textarea
                name="pincodes"
                defaultValue={zone?.pincodes.map((p) => p.pincode).join(', ')}
                required
              />
            </Field>
            <div className="form-grid">
              <Field label="Delivery charge (₹)">
                <input
                  name="fee"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={(zone?.deliveryFeePaise || 0) / 100}
                  required
                />
              </Field>
              <Field label="Minimum order (₹)">
                <input
                  name="minimum"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={(zone?.minimumOrderPaise || 0) / 100}
                  required
                />
              </Field>
              <Field label="Free delivery above (₹), optional">
                <input
                  name="free"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={
                    zone?.freeDeliveryAbovePaise == null ? '' : zone.freeDeliveryAbovePaise / 100
                  }
                />
              </Field>
            </div>
            <Field label="Delivery estimate">
              <input
                name="estimate"
                defaultValue={zone?.estimate}
                required
                maxLength={200}
                placeholder="Usually 1–2 days; confirmed by phone"
              />
            </Field>
            <label className="checkbox">
              <input type="checkbox" name="active" defaultChecked={zone?.active ?? true} /> Active
              and serviceable
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              Save delivery zone
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}

export function StaffSessions() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]),
    [error, setError] = useState('');
  const load = useCallback(async () => setSessions(await api<SessionInfo[]>('/auth/sessions')), []);
  useEffect(() => {
    const refreshVisible = () => {
      void load()
        .then(() => setError(''))
        .catch((e) => setError(errorMessage(e)));
    };
    refreshVisible();
    window.addEventListener('shiv-owner-refresh', refreshVisible);
    return () => window.removeEventListener('shiv-owner-refresh', refreshVisible);
  }, [load]);
  return (
    <section className="panel operations-panel">
      <h2>Your signed-in devices</h2>
      <p>Staff access expires after eight hours. Sign out devices you no longer use.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {sessions.map((s) => (
        <div className="session-row" key={s.id}>
          <div>
            <strong>{s.current ? 'This device' : s.label}</strong>
            <small>
              Last used {new Date(s.lastSeenAt).toLocaleString('en-IN')} · {s.deviceCount}{' '}
              notification devices
            </small>
          </div>
          {!s.current && (
            <button
              className="secondary"
              onClick={() =>
                void api(`/auth/sessions/${s.id}`, 'DELETE')
                  .then(load)
                  .catch((e) => setError(errorMessage(e)))
              }
            >
              Sign out device
            </button>
          )}
        </div>
      ))}
      <button
        className="secondary"
        onClick={() =>
          void api('/auth/sessions/revoke-others', 'POST', {})
            .then(load)
            .catch((e) => setError(errorMessage(e)))
        }
      >
        Sign out other devices
      </button>
    </section>
  );
}

type Audit = {
  id: string;
  event: string;
  actorId: string;
  entityId: string;
  createdAt: string;
  details: unknown;
};
export function AuditHistory() {
  const [rows, setRows] = useState<Audit[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState('');
  const load = useCallback(async (after?: string) => {
    const page = await api<Page<Audit>>(
      `/admin/audit?limit=24${after ? '&cursor=' + encodeURIComponent(after) : ''}`,
    );
    setRows((old) => (after ? [...old, ...page.items] : page.items));
    setCursor(page.nextCursor);
  }, []);
  useEffect(() => {
    const refreshVisible = () => {
      void load()
        .then(() => setError(''))
        .catch((e) => setError(errorMessage(e)));
    };
    refreshVisible();
    window.addEventListener('shiv-owner-refresh', refreshVisible);
    return () => window.removeEventListener('shiv-owner-refresh', refreshVisible);
  }, [load]);
  return (
    <section className="panel operations-panel">
      <h2>Store activity</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Staff / record</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.createdAt).toLocaleString('en-IN')}</td>
                <td>{statusLabel(r.event)}</td>
                <td>
                  {r.actorId}
                  <small>{r.entityId}</small>
                </td>
                <td>
                  <details>
                    <summary>View details</summary>
                    <pre>{JSON.stringify(r.details, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor && (
        <button
          className="secondary"
          onClick={() => void load(cursor).catch((e) => setError(errorMessage(e)))}
        >
          Older activity
        </button>
      )}
    </section>
  );
}
