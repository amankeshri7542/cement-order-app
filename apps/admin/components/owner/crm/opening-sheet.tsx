'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, EmptyState, Field, SearchBar } from '@shiv/design';
import { dayLabel, istToday, money } from '@shiv/shared';
import { ApiError, api } from '../../../lib/api';
import { moneyInput, rupeesToPaise } from '../common';
import { useLanguage, useT, useWords } from '../../../lib/i18n';
import { useAction, useDebounced, useOwner } from '../../../lib/owner';
import { MoreRows, PageHeader, Problem, QueryStatus } from '../common';
import { NotYourPage } from '../not-your-page';
import css from '../owner.module.css';
import own from './crm.module.css';
import { bookMoney } from './pure';
import type { OpeningRow, OpeningSheet } from './types';

const enc = encodeURIComponent;
const sheetKey = ['khata', 'opening'];
type Result = {
  signed: number;
  already: number;
  refused: number;
  results: { customerId: string; status: string; code?: string }[];
};

type Choice = { tally: boolean; reason: string };

function Row({
  row,
  asOf,
  selected,
  toggle,
  choice,
  choose,
}: {
  row: OpeningRow;
  asOf: string;
  selected: boolean;
  toggle: (on: boolean) => void;
  choice: Choice;
  choose: (choice: Choice) => void;
}) {
  const t = useT();
  const { language } = useLanguage();
  const { can, shops, shopId } = useOwner();
  const [paper, setPaper] = useState(moneyInput(row.draft?.paperPaise));
  // The balance counts under this shop until the customer next takes credit somewhere.
  const [shop, setShop] = useState(row.draft?.locationId ?? shopId ?? shops[0]?.id ?? '');
  const save = useAction(async () => {
    await api('/admin/khata/opening-sheet', 'POST', {
      customerId: row.id,
      asOf,
      paperPaise: rupeesToPaise(paper, true),
      ...(shop ? { locationId: shop } : {}),
    });
  }, [sheetKey]);
  const tally = row.tallyPaise ?? row.draft?.tallyPaise ?? null;
  const differs = !!row.draft && tally !== null && BigInt(tally) !== BigInt(row.draft.paperPaise);
  const unsaved =
    paper !== moneyInput(row.draft?.paperPaise) ||
    (!!row.draft && (row.draft.asOf !== asOf || row.draft.locationId !== shop));
  return (
    <div className={own.sheetRow}>
      <div>
        <Link href={`/customers/${row.id}`} className={own.name}>
          {row.name || row.phoneMasked}
        </Link>
        <p className={own.quiet}>
          {[row.phone ?? row.phoneMasked, row.area].filter(Boolean).join(' · ')}
        </p>
        <p className={own.quiet}>
          {t('owner.crm.opening.app', { amount: money(row.appBalancePaise) })}
          {tally !== null && ` · ${t('owner.crm.tally.number', { amount: bookMoney(tally) })}`}
        </p>
        {differs && <p className={own.look}>{t('owner.crm.opening.differs')}</p>}
      </div>
      {row.signoff ? (
        <div>
          <span className={`${own.tag} ${own.tagGood}`}>
            {t('owner.crm.signed', { day: dayLabel(row.signoff.asOf, language) })}
          </span>
          <p className={own.second}>{money(row.signoff.chosenPaise)}</p>
          {row.signoff.reason && <p className={own.quiet}>{row.signoff.reason}</p>}
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <Field label={t('owner.crm.opening.paper')}>
            <input
              inputMode="decimal"
              value={paper}
              pattern="-?[0-9]+([.][0-9]{1,2})?"
              required
              onChange={(event) => setPaper(event.target.value)}
            />
          </Field>
          {shops.length > 1 && (
            <Field label={t('owner.whichShop')}>
              <select value={shop} onChange={(event) => setShop(event.target.value)}>
                {shops.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className={own.buttons}>
            <Button variant="secondary" disabled={save.isPending || !unsaved || !paper}>
              {t('owner.crm.opening.write')}
            </Button>
            {!unsaved && row.draft && (
              <span className={own.tag}>{t('owner.crm.opening.written')}</span>
            )}
          </div>
          <Problem error={save.error} />
        </form>
      )}
      <div>
        {!row.signoff && row.draft && can('khata.opening.approve') && (
          <label className={css.check}>
            <input
              type="checkbox"
              checked={selected}
              disabled={unsaved}
              onChange={(event) => toggle(event.target.checked)}
            />
            {t('owner.crm.opening.sign', {
              amount:
                choice.tally && tally !== null ? bookMoney(tally) : money(row.draft.paperPaise),
            })}
          </label>
        )}
        {!row.signoff && differs && can('khata.opening.approve') && (
          <>
            <label className={css.check}>
              <input
                type="checkbox"
                checked={choice.tally}
                onChange={(event) => choose({ ...choice, tally: event.target.checked })}
              />
              {t('owner.crm.opening.useTally')}
            </label>
            {choice.tally && (
              <Field label={t('owner.crm.opening.why')}>
                <input
                  value={choice.reason}
                  maxLength={200}
                  onChange={(event) => choose({ ...choice, reason: event.target.value })}
                />
              </Field>
            )}
          </>
        )}
        {!row.signoff && !row.draft && <p className={own.quiet}>{t('owner.crm.opening.notYet')}</p>}
      </div>
    </div>
  );
}

/**
 * The opening sheet (plan 09 section 9). The accountant or an owner types what the paper book says,
 * and only an owner signs. Until a customer is signed their balance goes nowhere: not on a reminder,
 * not on the Vasooli list, and not in the customer's own app.
 */
export function OpeningSheetPage() {
  const t = useT();
  const words = useWords();
  const { can, notice } = useOwner();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [status, setStatus] = useState<'pending' | 'signed'>('pending');
  const [asOf, setAsOf] = useState(istToday());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refused, setRefused] = useState<Result['results']>([]);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const list = useInfiniteQuery({
    queryKey: [...sheetKey, status, q],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<OpeningSheet>(
        `/admin/khata/opening-sheet?status=${status}&q=${enc(q)}${pageParam ? `&cursor=${enc(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  const first = list.data?.pages[0];
  const sign = useAction(async () => {
    const chosen = rows.filter((row) => selected.has(row.id) && row.draft);
    const result = await api<Result>('/admin/khata/opening-sheet/approve', 'POST', {
      rows: chosen.map((row) => {
        const choice = choices[row.id];
        const tally = row.tallyPaise ?? row.draft!.tallyPaise;
        const reason = choice?.reason.trim();
        return {
          customerId: row.id,
          draftVersion: row.draft!.version,
          ...(choice?.tally && tally !== null
            ? { chosenPaise: Number(tally), ...(reason ? { reason } : {}) }
            : { chosenPaise: row.draft!.paperPaise }),
        };
      }),
    });
    setSelected(new Set());
    setRefused(result.results.filter((row) => row.status === 'REFUSED'));
    notice(t('owner.crm.opening.signedCount', { count: result.signed + result.already }));
  }, [sheetKey, ['customers'], ['crm']]);
  if (!can('khata.opening.draft')) return <NotYourPage />;
  return (
    <div className={own.page}>
      <PageHeader
        title={t('owner.crm.opening.title')}
        back="/udhaar"
        sub={t('owner.crm.opening.sub')}
      />
      <section className={`${css.card} ${own.narrow}`}>
        <Field label={t('owner.crm.opening.cutoff')}>
          <input
            type="date"
            value={asOf}
            max={istToday()}
            onChange={(event) => setAsOf(event.target.value || istToday())}
          />
        </Field>
        {first && (
          <p className={own.quiet}>
            {t('owner.crm.opening.counts', { pending: first.pending, signed: first.signed })}
          </p>
        )}
      </section>
      <SearchBar
        label={t('owner.crm.opening.search')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className={own.tabs} role="tablist" aria-label={t('owner.crm.opening.title')}>
        {(['pending', 'signed'] as const).map((value) => (
          <Button
            key={value}
            type="button"
            role="tab"
            aria-selected={value === status}
            variant={value === status ? 'primary' : 'secondary'}
            onClick={() => setStatus(value)}
          >
            {t(value === 'pending' ? 'owner.crm.opening.pending' : 'owner.crm.opening.signed')}
          </Button>
        ))}
      </div>
      <QueryStatus query={list} />
      {!list.isPending && !list.error && !rows.length && (
        <EmptyState
          title={t(
            status === 'pending' ? 'owner.crm.opening.empty' : 'owner.crm.opening.emptySigned',
          )}
        />
      )}
      {!!rows.length && (
        <section className={css.card}>
          {rows.map((row) => (
            <Row
              key={`${row.id}-${row.draft?.version ?? 0}`}
              row={row}
              asOf={row.draft?.asOf ?? asOf}
              selected={selected.has(row.id)}
              choice={choices[row.id] ?? { tally: false, reason: '' }}
              choose={(choice) => setChoices({ ...choices, [row.id]: choice })}
              toggle={(on) => {
                const next = new Set(selected);
                if (on) next.add(row.id);
                else next.delete(row.id);
                setSelected(next);
              }}
            />
          ))}
        </section>
      )}
      <MoreRows query={list} />
      {refused.length > 0 && (
        <ul className={own.lines} aria-label={t('owner.crm.opening.refused')}>
          {refused.map((row) => (
            <li key={row.customerId}>
              <span>{rows.find((item) => item.id === row.customerId)?.name ?? row.customerId}</span>
              <span>{words.error(new ApiError(row.code ?? 'REQUEST_FAILED', ''))}</span>
            </li>
          ))}
        </ul>
      )}
      {can('khata.opening.approve') && selected.size > 0 && (
        <div className={own.buttons}>
          <Button disabled={sign.isPending} onClick={() => sign.mutate()}>
            {t('owner.crm.opening.signSelected', { count: selected.size })}
          </Button>
        </div>
      )}
      <Problem error={sign.error} />
    </div>
  );
}
