'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Field, MoneyText, Sheet, StatusPill } from '@shiv/design';
import { bigRateChangePercent, istToday, momentLabel, money } from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { api } from '../../lib/api';
import { useLanguage, useT } from '../../lib/i18n';
import { useAction, useOwner } from '../../lib/owner';
import { moneyInput, PageHeader, Problem, QueryStatus, rupeesToPaise } from './common';
import css from './owner.module.css';

type RateRow = {
  id: string;
  name: string;
  brand: string;
  unit: string;
  version: number;
  pricePaise: number;
  categoryId: string;
  category: { name: string };
};
type Rule = {
  id: string;
  kind: 'SLAB' | 'GROUP' | 'SPECIAL' | 'OFFER';
  title: string;
  productId: string | null;
  categoryId: string | null;
  minQuantity: number;
  groupId: string | null;
  customerId: string | null;
  valueType: 'RATE' | 'PERCENT_OFF' | 'AMOUNT_OFF';
  value: number;
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
  stacks: boolean;
  isPublic: boolean;
  version: number;
  product: { name: string } | null;
  category: { name: string } | null;
  group: { name: string } | null;
};
type Group = { id: string; name: string; active: boolean; customers: number };

const ratesKey = ['rates'];
const rulesKey = ['pricing', 'rules'];
const groupsKey = ['pricing', 'groups'];
const paiseOf = (rupees: string) => {
  try {
    return rupeesToPaise(rupees);
  } catch {
    return null;
  }
};
const tabs = ['today', 'slabs', 'customers', 'bhada', 'offers', 'limits'] as const;
type Tab = (typeof tabs)[number];

/** Daam aur offer: every rupee rule, from one page. The server works out every rate. */
export function Rates() {
  const t = useT();
  const { can } = useOwner();
  const [tab, setTab] = useState<Tab>('today');
  const shown = tabs.filter((name) => (name === 'today' ? true : can('pricing.edit')));
  return (
    <>
      <PageHeader title={t('owner.rates.title')} />
      {shown.length > 1 && (
        <div className={css.chips} role="tablist" aria-label={t('owner.rates.title')}>
          {shown.map((name) => (
            <Button
              key={name}
              role="tab"
              aria-selected={tab === name}
              variant={tab === name ? 'primary' : 'secondary'}
              onClick={() => setTab(name)}
            >
              {t(`owner.rates.tab.${name}` as MessageKey)}
            </Button>
          ))}
        </div>
      )}
      {tab === 'today' && <TodayRates />}
      {tab === 'slabs' && <RuleList kind="SLAB" />}
      {tab === 'customers' && <CustomerRates />}
      {tab === 'bhada' && <Bhada />}
      {tab === 'offers' && <RuleList kind="OFFER" />}
      {tab === 'limits' && <Limits />}
    </>
  );
}

function TodayRates() {
  const t = useT();
  const { language } = useLanguage();
  const { can, confirm, notice } = useOwner();
  const rates = useQuery({
    queryKey: ratesKey,
    queryFn: () => api<{ items: RateRow[]; checkedAt: string | null }>('/admin/rates'),
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<RateRow | null>(null);
  const items = useMemo(() => rates.data?.items ?? [], [rates.data]);
  const newRate = (row: RateRow) => {
    const typed = drafts[row.id];
    return typed === undefined ? row.pricePaise : paiseOf(typed);
  };
  const changes = items.filter((row) => {
    const next = newRate(row);
    return next !== null && next > 0 && next !== row.pricePaise;
  });
  const bad = items.some((row) => {
    const next = newRate(row);
    return next === null || next < 1;
  });
  const big = (row: RateRow) =>
    Math.abs((newRate(row) ?? 0) - row.pricePaise) * 100 >= row.pricePaise * bigRateChangePercent;
  const body = () => ({
    rates: changes.map((row) => ({
      productId: row.id,
      expectedVersion: row.version,
      pricePaise: newRate(row)!,
    })),
    bigChangesChecked: true,
  });
  const finished = () => setDrafts({});
  const publish = useAction(async () => {
    if (changes.some(big)) {
      const sure = await confirm({
        title: t('owner.rates.bigTitle'),
        body: t('owner.rates.bigBody', {
          names: changes
            .filter(big)
            .map((row) => row.name)
            .join(', '),
        }),
        confirmLabel: t('owner.rates.bigYes'),
      });
      if (!sure) return;
    }
    await api('/admin/rates/publish', 'POST', body());
    finished();
    notice(t('owner.rates.published'));
  }, [ratesKey, ['products']]);
  const ask = useAction(async () => {
    await api('/admin/rates/ask', 'POST', { ...body(), idempotencyKey: crypto.randomUUID() });
    finished();
    notice(t('owner.rates.asked'));
  }, [['approvals']]);
  const reaffirm = useAction(
    () => api('/admin/rates/reaffirm', 'POST'),
    [ratesKey],
    'owner.rates.reaffirmed',
  );
  const adjust = (categoryId: string, step: number, percent: boolean) => {
    setDrafts((current) => {
      const next = { ...current };
      for (const row of items.filter((item) => item.categoryId === categoryId)) {
        const base = newRate(row) ?? row.pricePaise;
        const moved = percent ? Math.round(base * (1 + step / 100)) : base + step * 100;
        if (moved > 0) next[row.id] = moneyInput(moved);
      }
      return next;
    });
  };
  const groups = [...new Set(items.map((row) => row.categoryId))];
  const stale =
    rates.data?.checkedAt && Date.now() - new Date(rates.data.checkedAt).getTime() > 3 * 86400000;
  const editable = can('rates.publish') || can('rates.ask');
  return (
    <div className={css.stack}>
      <QueryStatus query={rates} />
      {rates.data?.checkedAt && (
        <p className={css.sub}>
          {t('owner.rates.lastChecked', { when: momentLabel(rates.data.checkedAt, language) })}
          {stale ? ` ${t('owner.rates.stale')}` : ''}
        </p>
      )}
      <div className={css.actions}>
        {can('rates.publish') && (
          <Button
            variant="secondary"
            disabled={reaffirm.isPending || changes.length > 0}
            onClick={() => reaffirm.mutate(undefined)}
          >
            {t('owner.rates.same')}
          </Button>
        )}
        {can('ratecard.share') && <ShareCard />}
      </div>
      <Problem error={reaffirm.error} />
      {groups.map((categoryId) => {
        const rows = items.filter((row) => row.categoryId === categoryId);
        return (
          <section className={css.card} key={categoryId}>
            <div className={css.row}>
              <h2>{rows[0]!.category.name}</h2>
              {editable && (
                <div className={css.chips}>
                  <Button variant="secondary" onClick={() => adjust(categoryId, -5, false)}>
                    {t('owner.rates.minusFive')}
                  </Button>
                  <Button variant="secondary" onClick={() => adjust(categoryId, 5, false)}>
                    {t('owner.rates.plusFive')}
                  </Button>
                </div>
              )}
            </div>
            {rows.map((row) => {
              const next = newRate(row);
              const moved = next !== null && next !== row.pricePaise;
              return (
                <div className={css.rateRow} key={row.id}>
                  <div>
                    <strong>{row.name}</strong>
                    <p className={css.sub}>{row.unit}</p>
                    {moved && next !== null && (
                      <p className={css.sub}>
                        {t('owner.rates.moved', {
                          change: `${next > row.pricePaise ? '+' : '-'}${money(Math.abs(next - row.pricePaise))}`,
                          before: money(row.pricePaise),
                        })}
                      </p>
                    )}
                    {moved && big(row) && <p className={css.error}>{t('owner.rates.bigRow')}</p>}
                    <button
                      type="button"
                      className={css.linkButton}
                      onClick={() => setHistory(row)}
                    >
                      {t('owner.rates.pastRates')}
                    </button>
                  </div>
                  {editable ? (
                    <Field label={t('owner.rates.rateFor', { name: row.name })}>
                      <input
                        inputMode="decimal"
                        value={drafts[row.id] ?? moneyInput(row.pricePaise)}
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, [row.id]: event.target.value }))
                        }
                      />
                    </Field>
                  ) : (
                    <MoneyText value={row.pricePaise} />
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
      {rates.data && !items.length && <EmptyState title={t('owner.rates.empty')} />}
      {changes.length > 0 && (
        <div className={css.payBar}>
          <span>{t('owner.rates.changedCount', { count: changes.length })}</span>
          {can('rates.publish') ? (
            <Button disabled={bad || publish.isPending} onClick={() => publish.mutate(undefined)}>
              {t('owner.rates.publish')}
            </Button>
          ) : (
            <Button disabled={bad || ask.isPending} onClick={() => ask.mutate(undefined)}>
              {t('owner.rates.askOwner')}
            </Button>
          )}
          <Button variant="secondary" onClick={finished}>
            {t('owner.rates.discard')}
          </Button>
        </div>
      )}
      <Problem error={publish.error ?? ask.error} />
      {history && <RateHistory row={history} close={() => setHistory(null)} />}
    </div>
  );
}

function RateHistory({ row, close }: { row: RateRow; close: () => void }) {
  const t = useT();
  const { language } = useLanguage();
  const history = useQuery({
    queryKey: ['rates', 'history', row.id],
    queryFn: () =>
      api<{ id: string; oldPricePaise: number; newPricePaise: number; createdAt: string }[]>(
        `/admin/rates/${row.id}/history`,
      ),
  });
  return (
    <Sheet title={row.name} closeLabel={t('owner.close')} onClose={close}>
      <QueryStatus query={history} />
      {history.data && !history.data.length && <p>{t('owner.rates.noHistory')}</p>}
      <table className={css.table}>
        <tbody>
          {history.data?.map((entry) => (
            <tr key={entry.id}>
              <td>{momentLabel(entry.createdAt, language)}</td>
              <td>{money(entry.oldPricePaise)}</td>
              <td>{money(entry.newPricePaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Sheet>
  );
}

/** Sends today's rates as a picture, using the phone's own share sheet. */
function ShareCard() {
  const t = useT();
  const { language } = useLanguage();
  const { notice } = useOwner();
  const [files, setFiles] = useState<File[]>([]);
  const share = useAction(async () => {
    const result = await api<{ pages: { pngBase64: string }[] }>(
      '/admin/rate-cards/current',
      'POST',
      {
        language,
      },
    );
    const made = result.pages.map(
      (page, index) =>
        new File(
          [Uint8Array.from(atob(page.pngBase64), (character) => character.charCodeAt(0))],
          `shiv-rates-${istToday()}-${index + 1}.png`,
          { type: 'image/png' },
        ),
    );
    setFiles(made);
    if (navigator.canShare?.({ files: made }))
      await navigator.share({ files: made, title: t('owner.shareRates') }).catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          notice(t('owner.shareReady'));
      });
  });
  return (
    <>
      <Button disabled={share.isPending} onClick={() => share.mutate(undefined)}>
        {t('owner.shareRates')}
      </Button>
      <Problem error={share.error} />
      {files.length > 0 && (
        <Sheet
          title={t('owner.shareReady')}
          closeLabel={t('owner.close')}
          onClose={() => setFiles([])}
        >
          <div className={css.stack}>
            {files.map((file, index) => {
              const url = URL.createObjectURL(file);
              return (
                <div key={file.name}>
                  <img className={css.ratePreview} src={url} alt={t('owner.shareRates')} />
                  <a className={css.inlineLink} href={url} download={file.name}>
                    {t('owner.download')} {index + 1}
                  </a>
                </div>
              );
            })}
          </div>
        </Sheet>
      )}
    </>
  );
}

const ruleWords = (rule: Pick<Rule, 'valueType' | 'value'>) =>
  rule.valueType === 'RATE'
    ? money(rule.value)
    : rule.valueType === 'AMOUNT_OFF'
      ? `-${money(rule.value)}`
      : `-${rule.value / 100}%`;

function RuleCard({ rule, onEdit }: { rule: Rule; onEdit: () => void }) {
  const t = useT();
  return (
    <article className={css.card}>
      <div className={css.row}>
        <strong>
          {rule.title ||
            rule.product?.name ||
            rule.category?.name ||
            rule.group?.name ||
            t('owner.rates.allGoods')}
        </strong>
        {!rule.active && <StatusPill label={t('owner.rates.off')} />}
      </div>
      <p>
        {rule.product?.name ?? rule.category?.name ?? t('owner.rates.allGoods')} · {ruleWords(rule)}
        {rule.minQuantity > 1 ? ` · ${t('owner.rates.fromQty', { count: rule.minQuantity })}` : ''}
      </p>
      {(rule.startsOn || rule.endsOn) && (
        <p className={css.sub}>
          {rule.startsOn ?? '...'} - {rule.endsOn ?? '...'}
        </p>
      )}
      {rule.isPublic && <StatusPill tone="blue" label={t('owner.rates.public')} />}
      <div className={css.actions}>
        <Button variant="secondary" onClick={onEdit}>
          {t('owner.rates.edit')}
        </Button>
      </div>
    </article>
  );
}

function RuleList({
  kind,
  groupId,
  customerId,
}: {
  kind: Rule['kind'];
  groupId?: string;
  customerId?: string;
}) {
  const t = useT();
  const rules = useQuery({
    queryKey: rulesKey,
    queryFn: () => api<Rule[]>('/admin/pricing/rules'),
  });
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const rows = (rules.data ?? []).filter(
    (rule) =>
      rule.kind === kind &&
      (!groupId || rule.groupId === groupId) &&
      (!customerId || rule.customerId === customerId),
  );
  return (
    <div className={css.stack}>
      <QueryStatus query={rules} />
      <Button onClick={() => setEditing('new')}>
        {t(`owner.rates.add.${kind}` as MessageKey)}
      </Button>
      {rows.map((rule) => (
        <RuleCard key={rule.id} rule={rule} onEdit={() => setEditing(rule)} />
      ))}
      {rules.data && !rows.length && <EmptyState title={t('owner.rates.noRules')} />}
      {editing && (
        <RuleSheet
          kind={kind}
          rule={editing === 'new' ? null : editing}
          {...(groupId ? { groupId } : {})}
          {...(customerId ? { customerId } : {})}
          close={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RuleSheet({
  kind,
  rule,
  groupId,
  customerId,
  close,
}: {
  kind: Rule['kind'];
  rule: Rule | null;
  groupId?: string;
  customerId?: string;
  close: () => void;
}) {
  const t = useT();
  const rates = useQuery({
    queryKey: ratesKey,
    queryFn: () => api<{ items: RateRow[] }>('/admin/rates'),
  });
  const items = rates.data?.items ?? [];
  const categories = [...new Map(items.map((row) => [row.categoryId, row.category.name]))];
  const today = istToday();
  const [target, setTarget] = useState(
    rule?.productId ? `p:${rule.productId}` : rule?.categoryId ? `c:${rule.categoryId}` : '',
  );
  const [title, setTitle] = useState(rule?.title ?? '');
  const [minQuantity, setMinQuantity] = useState(
    String(rule?.minQuantity ?? (kind === 'SLAB' ? 100 : 1)),
  );
  const [valueType, setValueType] = useState<Rule['valueType']>(
    rule?.valueType ?? (kind === 'OFFER' || kind === 'GROUP' ? 'PERCENT_OFF' : 'RATE'),
  );
  const [value, setValue] = useState(
    rule
      ? rule.valueType === 'PERCENT_OFF'
        ? String(rule.value / 100)
        : moneyInput(rule.value)
      : '',
  );
  const [startsOn, setStartsOn] = useState(rule?.startsOn ?? (kind === 'OFFER' ? today : ''));
  const [endsOn, setEndsOn] = useState(rule?.endsOn ?? '');
  const [active, setActive] = useState(rule?.active ?? true);
  const [isPublic, setIsPublic] = useState(rule?.isPublic ?? false);
  const [stacks, setStacks] = useState(rule?.stacks ?? false);
  const number = valueType === 'PERCENT_OFF' ? Math.round(Number(value) * 100) : paiseOf(value);
  const save = useAction(
    async () => {
      const body = {
        kind,
        title: title.trim(),
        productId: target.startsWith('p:') ? target.slice(2) : null,
        categoryId: target.startsWith('c:') ? target.slice(2) : null,
        minQuantity: Number(minQuantity) || 1,
        groupId: rule?.groupId ?? groupId ?? null,
        customerId: rule?.customerId ?? customerId ?? null,
        valueType,
        value: number,
        startsOn: startsOn || null,
        endsOn: endsOn || null,
        active,
        stacks: kind === 'OFFER' && stacks,
        isPublic: kind === 'OFFER' && isPublic,
      };
      if (rule)
        await api(`/admin/pricing/rules/${rule.id}`, 'PATCH', {
          ...body,
          expectedVersion: rule.version,
        });
      else await api('/admin/pricing/rules', 'POST', body);
      close();
    },
    [rulesKey],
    'owner.rates.saved',
  );
  return (
    <Sheet
      title={t(`owner.rates.add.${kind}` as MessageKey)}
      closeLabel={t('owner.close')}
      onClose={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(undefined);
        }}
      >
        {kind === 'OFFER' && (
          <Field label={t('owner.rates.offerName')}>
            <input
              value={title}
              maxLength={60}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
        )}
        <Field label={t('owner.rates.onWhat')}>
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">{t('owner.rates.allGoods')}</option>
            {categories.map(([id, name]) => (
              <option key={id} value={`c:${id}`}>
                {t('owner.rates.allOf', { name })}
              </option>
            ))}
            {items.map((row) => (
              <option key={row.id} value={`p:${row.id}`}>
                {row.name}
              </option>
            ))}
          </select>
        </Field>
        {(kind === 'SLAB' || kind === 'OFFER') && (
          <Field label={t('owner.rates.minQty')}>
            <input
              inputMode="numeric"
              value={minQuantity}
              onChange={(event) => setMinQuantity(event.target.value)}
            />
          </Field>
        )}
        <Field label={t('owner.rates.valueType')}>
          <select
            value={valueType}
            onChange={(event) => setValueType(event.target.value as Rule['valueType'])}
          >
            <option value="RATE">{t('owner.rates.type.RATE')}</option>
            <option value="AMOUNT_OFF">{t('owner.rates.type.AMOUNT_OFF')}</option>
            <option value="PERCENT_OFF">{t('owner.rates.type.PERCENT_OFF')}</option>
          </select>
        </Field>
        <Field
          label={t(valueType === 'PERCENT_OFF' ? 'owner.rates.percent' : 'owner.rates.rupees')}
        >
          <input
            inputMode="decimal"
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <Field label={t('owner.rates.startsOn')}>
          <input
            type="date"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
          />
        </Field>
        <Field label={t('owner.rates.endsOn')}>
          <input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
        </Field>
        {kind === 'OFFER' && (
          <>
            <label className={css.check}>
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(event) => setIsPublic(event.target.checked)}
              />
              {t('owner.rates.showPublic')}
            </label>
            <label className={css.check}>
              <input
                type="checkbox"
                checked={stacks}
                onChange={(event) => setStacks(event.target.checked)}
              />
              {t('owner.rates.stacks')}
            </label>
          </>
        )}
        <label className={css.check}>
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />
          {t('owner.rates.on')}
        </label>
        <Problem error={save.error} />
        <div className={css.sheetBar}>
          <Button className={css.wide} disabled={save.isPending || !number}>
            {t('owner.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function CustomerRates() {
  const t = useT();
  const groups = useQuery({
    queryKey: groupsKey,
    queryFn: () => api<Group[]>('/admin/pricing/groups'),
  });
  const suggestions = useQuery({
    queryKey: ['pricing', 'suggestions'],
    queryFn: () =>
      api<{ customerId: string; name: string; phone: string; orders: number }[]>(
        '/admin/pricing/suggestions',
      ),
  });
  const [name, setName] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const customers = useQuery({
    queryKey: ['customers', 'search', q],
    enabled: q.trim().length > 1,
    queryFn: () =>
      api<{ items: { id: string; name: string; phone: string }[] }>(
        `/admin/customers?limit=8&q=${encodeURIComponent(q)}`,
      ),
  });
  const add = useAction(async () => {
    await api('/admin/pricing/groups', 'POST', { name: name.trim() });
    setName('');
  }, [groupsKey]);
  const move = useAction(
    ({ customerId, groupId }: { customerId: string; groupId: string }) =>
      api(`/admin/pricing/customers/${customerId}/group`, 'PUT', { groupId }),
    [groupsKey, ['pricing', 'suggestions']],
    'owner.rates.saved',
  );
  return (
    <div className={css.stack}>
      <section className={css.card}>
        <h2>{t('owner.rates.groups')}</h2>
        <QueryStatus query={groups} />
        {groups.data?.map((group) => (
          <div key={group.id}>
            <div className={css.row}>
              <span>
                {group.name} · {t('owner.rates.groupCount', { count: group.customers })}
              </span>
              <Button
                variant="secondary"
                onClick={() => setOpen(open === group.id ? null : group.id)}
              >
                {t('owner.rates.groupRates')}
              </Button>
            </div>
            {open === group.id && <RuleList kind="GROUP" groupId={group.id} />}
          </div>
        ))}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate(undefined);
          }}
        >
          <Field label={t('owner.rates.newGroup')}>
            <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Button variant="secondary" disabled={!name.trim() || add.isPending}>
            {t('owner.rates.addGroup')}
          </Button>
          <Problem error={add.error} />
        </form>
      </section>
      <section className={css.card}>
        <h2>{t('owner.rates.special')}</h2>
        <p>{t('owner.rates.specialHelp')}</p>
        <Field label={t('owner.rates.findCustomer')}>
          <input value={q} onChange={(event) => setQ(event.target.value)} />
        </Field>
        {customers.data?.items.map((customer) => (
          <div className={css.row} key={customer.id}>
            <span>
              {customer.name} · {customer.phone}
            </span>
            <Button variant="secondary" onClick={() => setPicked(customer)}>
              {t('owner.rates.choose')}
            </Button>
          </div>
        ))}
        {picked && (
          <>
            <h3>{picked.name}</h3>
            <RuleList kind="SPECIAL" customerId={picked.id} />
          </>
        )}
      </section>
      <section className={css.card}>
        <h2>{t('owner.rates.suggested')}</h2>
        <p>{t('owner.rates.suggestedHelp')}</p>
        <QueryStatus query={suggestions} />
        {suggestions.data?.map((row) => (
          <div className={css.row} key={row.customerId}>
            <span>
              {row.name} · {t('owner.rates.orderCount', { count: row.orders })}
            </span>
            {groups.data
              ?.filter((group) => group.active)
              .map((group) => (
                <Button
                  key={group.id}
                  variant="secondary"
                  disabled={move.isPending}
                  onClick={() => move.mutate({ customerId: row.customerId, groupId: group.id })}
                >
                  {group.name}
                </Button>
              ))}
          </div>
        ))}
        {suggestions.data && !suggestions.data.length && <p>{t('owner.rates.noSuggestions')}</p>}
        <Problem error={move.error} />
      </section>
    </div>
  );
}

function Bhada() {
  const t = useT();
  const zones = useQuery({
    queryKey: ['zones'],
    queryFn: () =>
      api<{ id: string; name: string; deliveryFeePaise: number }[]>('/admin/delivery-zones'),
  });
  const rates = useQuery({
    queryKey: ['pricing', 'delivery-rates'],
    queryFn: () =>
      api<{ id: string; zoneId: string; vehicle: string; feePaise: number; active: boolean }[]>(
        '/admin/pricing/delivery-rates',
      ),
  });
  const [zoneId, setZoneId] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [fee, setFee] = useState('');
  const save = useAction(
    async () => {
      await api('/admin/pricing/delivery-rates', 'PUT', {
        zoneId,
        vehicle: vehicle.trim(),
        feePaise: rupeesToPaise(fee),
      });
      setVehicle('');
      setFee('');
    },
    [['pricing', 'delivery-rates']],
    'owner.rates.saved',
  );
  return (
    <div className={css.stack}>
      <p>{t('owner.rates.bhadaHelp')}</p>
      <QueryStatus query={zones} />
      {zones.data?.map((zone) => (
        <section className={css.card} key={zone.id}>
          <div className={css.row}>
            <h2>{zone.name}</h2>
            <MoneyText value={zone.deliveryFeePaise} />
          </div>
          {rates.data
            ?.filter((rate) => rate.zoneId === zone.id)
            .map((rate) => (
              <div className={css.row} key={rate.id}>
                <span>{rate.vehicle}</span>
                <MoneyText value={rate.feePaise} />
              </div>
            ))}
        </section>
      ))}
      {zones.data && zones.data.length > 0 && (
        <form
          className={css.card}
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(undefined);
          }}
        >
          <h2>{t('owner.rates.addBhada')}</h2>
          <Field label={t('owner.rates.area')}>
            <select required value={zoneId} onChange={(event) => setZoneId(event.target.value)}>
              <option value="" />
              {zones.data.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('owner.rates.vehicle')}>
            <input
              required
              maxLength={40}
              value={vehicle}
              onChange={(event) => setVehicle(event.target.value)}
            />
          </Field>
          <Field label={t('owner.rates.rupees')}>
            <input
              required
              inputMode="decimal"
              value={fee}
              onChange={(event) => setFee(event.target.value)}
            />
          </Field>
          <Button disabled={save.isPending || paiseOf(fee) === null}>{t('owner.save')}</Button>
          <Problem error={save.error} />
        </form>
      )}
    </div>
  );
}

function Limits() {
  const t = useT();
  const limits = useQuery({
    queryKey: ['pricing', 'limits'],
    queryFn: () =>
      api<{
        shops: { id: string; name: string; managerRateCapPercent: number }[];
        people: { id: string; name: string; rateCapPercent: number | null }[];
        onlinePaymentsEnabled: boolean;
      }>('/admin/pricing/limits'),
  });
  return (
    <div className={css.stack}>
      <QueryStatus query={limits} />
      <section className={css.card}>
        <h2>{t('owner.rates.shopLimits')}</h2>
        {limits.data?.shops.map((shop) => (
          <div className={css.row} key={shop.id}>
            <span>{shop.name}</span>
            <strong>{shop.managerRateCapPercent}%</strong>
          </div>
        ))}
        <p className={css.sub}>{t('owner.rates.shopLimitsHelp')}</p>
      </section>
      <section className={css.card}>
        <h2>{t('owner.rates.personLimits')}</h2>
        {limits.data?.people.map((person) => (
          <PersonLimit key={person.id} person={person} />
        ))}
        {limits.data && !limits.data.people.length && <p>{t('owner.rates.noManagers')}</p>}
      </section>
      <section className={css.card}>
        <h2>{t('owner.rates.payments')}</h2>
        <p>
          {t(limits.data?.onlinePaymentsEnabled ? 'owner.rates.onlineOn' : 'owner.rates.onlineOff')}
        </p>
      </section>
    </div>
  );
}

function PersonLimit({
  person,
}: {
  person: { id: string; name: string; rateCapPercent: number | null };
}) {
  const t = useT();
  const [value, setValue] = useState(
    person.rateCapPercent === null ? '' : String(person.rateCapPercent),
  );
  const typed = value.trim();
  const good = typed === '' || (/^\d{1,3}$/.test(typed) && Number(typed) <= 100);
  const save = useAction(
    () =>
      api(`/admin/pricing/people/${person.id}/rate-cap`, 'PUT', {
        rateCapPercent: typed === '' ? null : Number(typed),
      }),
    [['pricing', 'limits']],
    'owner.rates.saved',
  );
  return (
    <form
      className={css.row}
      onSubmit={(event) => {
        event.preventDefault();
        if (good) save.mutate(undefined);
      }}
    >
      <Field label={t('owner.rates.personLimit', { name: person.name })}>
        <input
          inputMode="numeric"
          value={value}
          aria-invalid={!good}
          onChange={(event) => setValue(event.target.value)}
        />
      </Field>
      {!good && <p className={css.error}>{t('owner.rates.personLimitBad')}</p>}
      <Button variant="secondary" disabled={save.isPending || !good}>
        {t('owner.save')}
      </Button>
      <Problem error={save.error} />
    </form>
  );
}
