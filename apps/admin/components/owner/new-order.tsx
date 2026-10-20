'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  DateChips,
  EmptyState,
  Field,
  MoneyText,
  PhoneField,
  QuantityStepper,
  SearchBar,
  Sheet,
} from '@shiv/design';
import {
  istToday,
  money,
  phoneOrderSchema,
  productName,
  unitLabel,
  totals,
  type AddressInput,
  type Order,
  type Product,
} from '@shiv/shared';
import { z } from 'zod';
import { ApiError, api } from '../../lib/api';
import { useLanguage, useT } from '../../lib/i18n';
import { useAction, useDebounced, useOwner, useUnsavedGuard } from '../../lib/owner';
import type { Customer, DeliveryCheck } from '../../lib/owner-types';
import { MoreRows, PageHeader, Problem, QueryStatus, usePaged } from './common';
import css from './owner.module.css';

type Input = z.infer<typeof phoneOrderSchema>;
type Draft = {
  phone: string;
  name: string;
  quantities: Record<string, number>;
  date: string;
  source: 'PHONE' | 'WALK_IN';
  payment: 'COD' | 'CREDIT';
  anonymous: boolean;
  notes: string;
  address: AddressInput;
  override: boolean;
};
const refusal = new Set([
  'OUT_OF_STOCK',
  'STOCK_CONFLICT',
  'CREDIT_NOT_ALLOWED',
  'CREDIT_LIMIT_EXCEEDED',
  'CREDIT_OVERRIDE_FORBIDDEN',
  'KHATA_OVERFLOW',
  'INVALID_INPUT',
  'INVALID_QUANTITY',
  'INVALID_CREDIT_OVERRIDE',
  'INVALID_DELIVERY_DATE',
  'NOT_SERVICEABLE',
  'DELIVERY_MINIMUM',
  'FORBIDDEN',
]);

export function NewOrder() {
  const t = useT();
  const { language } = useLanguage();
  const { me, offline } = useOwner();
  const router = useRouter();
  const params = useSearchParams();
  const fresh = (): Draft => ({
    phone: '',
    name: '',
    quantities: {},
    date: istToday(),
    source: params.get('source') === 'WALK_IN' ? 'WALK_IN' : 'PHONE',
    payment: 'COD',
    anonymous: params.get('source') === 'WALK_IN',
    notes: '',
    override: false,
    address: {
      label: t('owner.address'),
      name: '',
      phone: '',
      line1: '',
      area: '',
      city: t('owner.patna'),
      state: 'Bihar',
      pincode: '',
      landmark: '',
    },
  });
  const [draft, setDraft] = useState<Draft>(fresh);
  const [stage, setStage] = useState(1);
  const [ready, setReady] = useState(false);
  const [review, setReview] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const phone = useDebounced(draft.phone);
  const [key, setKey] = useState('');
  const frozen = useRef<Input | null>(null);
  const persisted = useRef(false);
  const addressEdited = useRef(false);
  const nameEdited = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const storageKey = `shiv-owner-order:${me.id}`;
  const change = (patch: Partial<Draft>) =>
    setDraft((current) => {
      const next = { ...current, ...patch };
      if (next.payment !== 'CREDIT') next.override = false;
      return next;
    });
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (
        saved?.draft &&
        typeof saved.draft.phone === 'string' &&
        typeof saved.draft.quantities === 'object'
      ) {
        setDraft({ ...fresh(), ...saved.draft });
        addressEdited.current = !!saved.draft.address?.line1;
        nameEdited.current = !!saved.draft.name;
      }
      const pending = phoneOrderSchema.safeParse(saved?.pending);
      if (pending.success) {
        frozen.current = pending.data;
        persisted.current = true;
        setKey(pending.data.idempotencyKey);
        setUncertain(true);
        setStage(3);
      } else setKey(saved?.key || crypto.randomUUID());
    } catch {
      setKey(crypto.randomUUID());
    }
    setReady(true);
    // A draft belongs to one signed-in owner, not to a query-string rerender.
  }, [storageKey]);
  useEffect(() => {
    if (ready)
      try {
        sessionStorage.setItem(storageKey, JSON.stringify({ draft, key, pending: frozen.current }));
      } catch {
        /* The live form still works without browser storage. */
      }
  }, [draft, key, ready, storageKey, uncertain]);
  const { clearDirty } = useUnsavedGuard(
    ready &&
      ((!uncertain && (!!draft.phone || Object.values(draft.quantities).some(Boolean))) ||
        (uncertain && !persisted.current)),
  );

  const customers = useQuery({
    queryKey: ['customers', 'phone', phone],
    enabled: phone.length === 10 && !draft.anonymous,
    queryFn: () =>
      api<{ items: Customer[] }>(`/admin/customers?q=${encodeURIComponent('+91' + phone)}&limit=5`),
  });
  const customer = customers.data?.items.find((item) => item.phone === '+91' + draft.phone);
  const linkedId = params.get('customer');
  const linked = useQuery({
    queryKey: ['customers', 'detail', linkedId],
    enabled: !!linkedId,
    queryFn: () => api<Customer>(`/admin/customers/${linkedId}`),
  });
  useEffect(() => {
    if (linked.data && !draft.phone && !uncertain)
      change({ phone: linked.data.phone.replace(/^\+91/, ''), name: linked.data.name });
  }, [linked.data, draft.phone, uncertain]);
  const detail = useQuery({
    queryKey: ['customers', 'detail', customer?.id],
    enabled: !!customer,
    queryFn: () => api<Customer>(`/admin/customers/${customer!.id}`),
  });
  const appliedCustomer = useRef('');
  useEffect(() => {
    if (!detail.data || appliedCustomer.current === detail.data.id || uncertain) return;
    appliedCustomer.current = detail.data.id;
    const last = detail.data.orders?.[0]?.address ?? detail.data.addresses?.[0];
    setDraft((current) => ({
      ...current,
      name: nameEdited.current ? current.name : detail.data!.name || current.name,
      address:
        last && !addressEdited.current
          ? {
              label: last.label || t('owner.address'),
              name: last.name,
              phone: last.phone,
              line1: last.line1,
              area: last.area,
              city: last.city,
              state: 'Bihar',
              pincode: last.pincode,
              landmark: last.landmark || '',
            }
          : current.address,
    }));
  }, [detail.data, uncertain, t]);
  const products = usePaged<Product>(
    ['products', 'owner', q],
    `/admin/products?limit=100&q=${encodeURIComponent(q)}`,
  );
  const productCache = useRef(new Map<string, Product>());
  for (const page of products.data?.pages ?? [])
    for (const product of page.items) productCache.current.set(product.id, product);
  const selectedIds = Object.keys(draft.quantities)
    .filter((id) => draft.quantities[id]! > 0)
    .sort();
  const missingIds = selectedIds.filter((id) => !productCache.current.has(id));
  const selectedProducts = useQuery({
    queryKey: ['products', 'selected', selectedIds],
    enabled: missingIds.length > 0,
    queryFn: () =>
      Promise.all(missingIds.map((id) => api<Product>(`/products/${encodeURIComponent(id)}`))),
  });
  for (const product of selectedProducts.data ?? []) productCache.current.set(product.id, product);
  const selectionReady = selectedIds.every((id) => productCache.current.has(id));
  const lines = Object.entries(draft.quantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([id, quantity]) => {
      const product = productCache.current.get(id);
      return product ? { product, quantity, pricePaise: product.pricePaise } : null;
    })
    .filter((item) => item !== null);
  const delivery = useQuery({
    queryKey: ['delivery', draft.address.pincode],
    enabled: draft.source === 'PHONE' && /^\d{6}$/.test(draft.address.pincode),
    queryFn: () => api<DeliveryCheck>(`/delivery/${draft.address.pincode}`),
  });
  const zone = delivery.data?.zone;
  let amountError: unknown;
  let amounts = { subtotalPaise: 0, deliveryFeePaise: 0, totalPaise: 0 };
  try {
    amounts = totals(
      lines,
      draft.source === 'PHONE' ? (zone?.deliveryFeePaise ?? 0) : 0,
      draft.source === 'PHONE' ? (zone?.freeDeliveryAbovePaise ?? null) : null,
    );
  } catch {
    amountError = new ApiError('INVALID_QUANTITY', t('error.INVALID_QUANTITY'), 'error.invalid');
  }
  const subtotal = amounts.subtotalPaise;
  const creditAllowed = !!customer?.creditAllowed && !draft.anonymous;
  const action = useAction(
    async () => {
      const input =
        frozen.current ??
        phoneOrderSchema.parse({
          customerPhone: draft.anonymous ? undefined : '+91' + draft.phone,
          customerName: draft.anonymous ? undefined : draft.name,
          source: draft.source,
          items: Object.entries(draft.quantities)
            .filter(([, quantity]) => quantity > 0)
            .map(([productId, quantity]) => ({ productId, quantity })),
          deliveryDate: draft.date,
          paymentMethod: draft.payment,
          notes: draft.notes,
          idempotencyKey: key,
          overrideLimit: draft.override,
          address:
            draft.source === 'WALK_IN'
              ? undefined
              : {
                  ...draft.address,
                  name: draft.address.name || draft.name,
                  phone: draft.address.phone || '+91' + draft.phone,
                },
        });
      frozen.current = input;
      setUncertain(true);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify({ draft, key, pending: input }));
        persisted.current = true;
      } catch {
        persisted.current = false;
      }
      try {
        const order = await api<Order>('/admin/orders/phone', 'POST', input);
        frozen.current = null;
        clearDirty();
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* Already recorded. */
        }
        router.replace(`/orders/${order.id}?created=1`);
        return order;
      } catch (error) {
        if (error instanceof ApiError && refusal.has(error.code)) {
          frozen.current = null;
          setUncertain(false);
        }
        throw error;
      }
    },
    [['orders', 'list'], ['customers']],
    'owner.orderCreated',
  );
  const updateAddress = (field: keyof AddressInput, value: string) => {
    addressEdited.current = true;
    change({ address: { ...draft.address, [field]: value } });
  };
  const formValid =
    draft.source === 'WALK_IN' ||
    !!(
      draft.address.line1 &&
      draft.address.area &&
      draft.address.city &&
      /^\d{6}$/.test(draft.address.pincode) &&
      delivery.data?.serviceable
    );
  return (
    <>
      <PageHeader
        title={t(draft.source === 'WALK_IN' ? 'owner.walkIn' : 'owner.newOrder')}
        back="/orders"
      />
      <Problem error={amountError || selectedProducts.error} />
      <ol className={css.steps}>
        {[1, 2, 3].map((value) => (
          <li key={value} aria-current={stage === value ? 'step' : undefined}>
            {t(
              value === 1
                ? 'owner.customerStep'
                : value === 2
                  ? 'owner.materialStep'
                  : 'owner.deliveryStep',
            )}
          </li>
        ))}
      </ol>
      {uncertain && !action.isPending && (
        <div className={css.card}>
          <p role="status">{t('error.timeout')}</p>
          <Button disabled={offline} onClick={() => action.mutate()}>
            {t('owner.retry')}
          </Button>
        </div>
      )}
      <fieldset disabled={uncertain || action.isPending} className={css.formFieldset}>
        {stage === 1 && (
          <div className={css.card}>
            <div className={css.chips}>
              {(['PHONE', 'WALK_IN'] as const).map((source) => (
                <Button
                  key={source}
                  type="button"
                  variant={source === draft.source ? 'primary' : 'secondary'}
                  onClick={() => change({ source, anonymous: false, payment: 'COD' })}
                >
                  {t(source === 'PHONE' ? 'owner.phoneOrder' : 'owner.walkIn')}
                </Button>
              ))}
            </div>
            {draft.source === 'WALK_IN' && (
              <label className={css.check}>
                <input
                  type="checkbox"
                  checked={draft.anonymous}
                  onChange={(event) => change({ anonymous: event.target.checked, payment: 'COD' })}
                />
                {t('owner.anonymous')}
              </label>
            )}
            {!draft.anonymous && (
              <>
                <PhoneField
                  label={t('owner.phone')}
                  value={draft.phone}
                  onChange={(value) => {
                    if (value === draft.phone) return;
                    addressEdited.current = false;
                    nameEdited.current = false;
                    appliedCustomer.current = '';
                    change({ phone: value, payment: 'COD', name: '', address: fresh().address });
                  }}
                />
                {customers.isFetching && <p role="status">{t('owner.loading')}</p>}
                <Problem error={customers.error} />
                {customer && (
                  <div className={css.card}>
                    <strong>{customer.name}</strong>
                    <p>{customer.area}</p>
                    <span className={customer.balancePaise > 0 ? css.due : css.paid}>
                      {t('owner.balance')}: {money(Math.abs(customer.balancePaise))}
                    </span>
                  </div>
                )}
                <Field label={t('owner.name')}>
                  <input
                    value={draft.name}
                    maxLength={100}
                    onChange={(event) => {
                      nameEdited.current = true;
                      change({ name: event.target.value });
                    }}
                  />
                </Field>
              </>
            )}
            <Button
              className={css.wide}
              disabled={
                !ready ||
                (!draft.anonymous && (!/^[6-9]\d{9}$/.test(draft.phone) || !draft.name.trim()))
              }
              onClick={() => setStage(2)}
            >
              {t('owner.continue')}
            </Button>
          </div>
        )}
        {stage === 2 && (
          <>
            <SearchBar
              label={t('owner.searchProducts')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <QueryStatus query={products} />
            <div className={css.grid}>
              {(products.data?.pages.flatMap((page) => page.items) ?? []).map((product) => (
                <article key={product.id} className={css.product}>
                  <div>
                    <h3>{productName(product, language)}</h3>
                    <p>
                      {unitLabel(product.packSize || product.unit, language)} ·{' '}
                      <MoneyText value={product.pricePaise} />
                    </p>
                    <p className={css.hint}>{t('owner.stockCount', { count: product.stock })}</p>
                  </div>
                  <QuantityStepper
                    label={`${t('owner.quantity')} ${productName(product, language)}`}
                    value={draft.quantities[product.id] || 0}
                    min={product.minQuantity}
                    step={product.quantityStep}
                    max={product.stock}
                    decreaseLabel={t('owner.decrease', { name: productName(product, language) })}
                    increaseLabel={t('owner.increase', { name: productName(product, language) })}
                    onChange={(quantity) =>
                      change({ quantities: { ...draft.quantities, [product.id]: quantity } })
                    }
                  />
                  {(product.minQuantity > 1 || product.quantityStep > 1) && (
                    <p className={css.hint}>
                      {t('owner.quantityRule', {
                        min: product.minQuantity,
                        step: product.quantityStep,
                      })}
                    </p>
                  )}
                </article>
              ))}
              {!products.isPending && !products.data?.pages[0]?.items.length && (
                <EmptyState title={t('owner.emptyStock')} />
              )}
            </div>
            <MoreRows query={products} />
            <div className={`${css.sticky} ${css.row}`}>
              <MoneyText value={subtotal} />
              <Button
                disabled={!lines.length || !selectionReady || !!amountError}
                onClick={() => setStage(3)}
              >
                {t('owner.continue')}
              </Button>
            </div>
          </>
        )}
        {stage === 3 && (
          <div className={css.stack}>
            <section className={css.card}>
              <h2>{t('owner.deliveryDate')}</h2>
              <DateChips
                value={draft.date}
                onChange={(date) => change({ date })}
                labels={{
                  today: t('owner.today'),
                  tomorrow: t('owner.tomorrow'),
                  dayAfter: t('owner.dayAfter'),
                  pick: t('owner.pickDate'),
                }}
              />
              {draft.source === 'PHONE' && (
                <>
                  <h2>{t('owner.address')}</h2>
                  <Field label={t('owner.addressLine')}>
                    <input
                      value={draft.address.line1}
                      maxLength={250}
                      onChange={(event) => updateAddress('line1', event.target.value)}
                      required
                    />
                  </Field>
                  <div className={css.columns}>
                    <Field label={t('owner.area')}>
                      <input
                        value={draft.address.area}
                        maxLength={120}
                        onChange={(event) => updateAddress('area', event.target.value)}
                        required
                      />
                    </Field>
                    <Field label={t('owner.city')}>
                      <input
                        value={draft.address.city}
                        maxLength={100}
                        onChange={(event) => updateAddress('city', event.target.value)}
                        required
                      />
                    </Field>
                  </div>
                  <Field label={t('owner.pincode')}>
                    <input
                      value={draft.address.pincode}
                      maxLength={6}
                      inputMode="numeric"
                      onChange={(event) =>
                        updateAddress('pincode', event.target.value.replace(/\D/g, '').slice(0, 6))
                      }
                      required
                    />
                  </Field>
                  <Field label={`${t('owner.landmark')} · ${t('owner.optional')}`}>
                    <input
                      value={draft.address.landmark}
                      maxLength={200}
                      onChange={(event) => updateAddress('landmark', event.target.value)}
                    />
                  </Field>
                  {delivery.data && (
                    <p className={delivery.data.serviceable ? css.paid : css.due}>
                      {t(delivery.data.serviceable ? 'owner.serviceable' : 'owner.notServiceable')}
                      {zone &&
                        subtotal < zone.minimumOrderPaise &&
                        ` · ${t('owner.deliveryMinimum', { amount: money(zone.minimumOrderPaise) })}`}
                    </p>
                  )}
                  <Problem error={delivery.error} />
                </>
              )}
            </section>
            <section className={css.card}>
              <h2>{t('owner.paymentMethod')}</h2>
              <div className={css.chips}>
                {(['COD', 'CREDIT'] as const).map((payment) => (
                  <Button
                    key={payment}
                    variant={draft.payment === payment ? 'primary' : 'secondary'}
                    disabled={payment === 'CREDIT' && !creditAllowed}
                    aria-pressed={payment === draft.payment}
                    onClick={() => change({ payment, override: false })}
                  >
                    {t(payment === 'COD' ? 'owner.cash' : 'owner.credit')}
                  </Button>
                ))}
              </div>
              {!creditAllowed && (
                <p className={css.hint}>
                  {t(draft.anonymous ? 'owner.creditPhoneRequired' : 'owner.creditDisabled')}
                </p>
              )}
              {draft.payment === 'CREDIT' && (
                <>
                  <p>
                    {t('owner.balanceAfter')}:{' '}
                    <MoneyText value={(customer?.balancePaise ?? 0) + amounts.totalPaise} signed />
                  </p>
                  <label className={css.check}>
                    <input
                      type="checkbox"
                      checked={draft.override}
                      onChange={(event) => change({ override: event.target.checked })}
                    />
                    {t('owner.override')}
                  </label>
                  <p className={css.hint}>{t('owner.overrideHelp')}</p>
                </>
              )}
              <Field label={t('owner.orderNotes')}>
                <textarea
                  value={draft.notes}
                  maxLength={500}
                  onChange={(event) => change({ notes: event.target.value })}
                />
              </Field>
              <div className={css.summary}>
                <div>
                  <span>{t('owner.subtotal')}</span>
                  <MoneyText value={subtotal} />
                </div>
                <div>
                  <span>{t('owner.deliveryFee')}</span>
                  <MoneyText value={amounts.deliveryFeePaise} />
                </div>
                <div className={css.total}>
                  <span>{t('owner.total')}</span>
                  <MoneyText value={amounts.totalPaise} />
                </div>
              </div>
              <Button
                className={css.wide}
                disabled={
                  !formValid ||
                  !lines.length ||
                  !selectionReady ||
                  !!amountError ||
                  offline ||
                  (draft.source === 'PHONE' && !!zone && subtotal < zone.minimumOrderPaise)
                }
                onClick={() => setReview(true)}
              >
                {t('owner.reviewOrder')}
              </Button>
            </section>
          </div>
        )}
        {stage > 1 && (
          <Button variant="ghost" onClick={() => setStage(stage - 1)}>
            {t('owner.back')}
          </Button>
        )}
      </fieldset>
      <Problem error={action.error} />
      {review && (
        <Sheet
          title={t('owner.reviewOrder')}
          closeLabel={t('owner.close')}
          onClose={() => {
            if (!action.isPending) setReview(false);
          }}
        >
          <h3>{draft.name || t('owner.walkIn')}</h3>
          {lines.map((line) => (
            <div key={line.product.id} className={css.summary}>
              <div>
                <span>
                  {productName(line.product, language)} × {line.quantity}
                </span>
                <MoneyText value={line.pricePaise * line.quantity} />
              </div>
            </div>
          ))}
          <p className={css.moneyHero}>
            {t('owner.total')}: {money(amounts.totalPaise)}
          </p>
          {draft.payment === 'CREDIT' && (
            <p className={css.due}>
              {t('owner.balanceAfter')}: {money((customer?.balancePaise ?? 0) + amounts.totalPaise)}
            </p>
          )}
          <Problem error={action.error} />
          <Button
            className={css.wide}
            disabled={action.isPending || offline}
            onClick={() => action.mutate()}
          >
            {action.isPending ? t('owner.busy') : t('owner.placeOrder')}
          </Button>
        </Sheet>
      )}
    </>
  );
}
