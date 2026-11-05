'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type QueryKey,
} from '@tanstack/react-query';
import { Button, EmptyState, Field, PhoneField, SearchBar, Sheet } from '@shiv/design';
import { type Page } from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { api } from '../../../lib/api';
import { useT, useWords } from '../../../lib/i18n';
import { useAction, useDebounced, useOwner } from '../../../lib/owner';
import type { Customer } from '../../../lib/owner-types';
import { MoreRows, Problem, QueryStatus } from '../common';
import own from '../crm/crm.module.css';
import { bookMoney } from '../crm/pure';
import css from '../owner.module.css';
import { Tag, useTallyStatus } from './haal';
import { partySide, plainMoney, sharePercent, type Side } from './pure';
import tally from './tally.module.css';
import type { Party, PartyList, PartySuggestion } from './types';

const enc = encodeURIComponent;
type Filter = 'unlinked' | 'linked' | 'notCustomer' | 'all';
const filters: { id: Filter; word: MessageKey }[] = [
  { id: 'unlinked', word: 'owner.tally.party.todo' },
  { id: 'linked', word: 'owner.tally.party.linked' },
  { id: 'notCustomer', word: 'owner.tally.party.notCustomers' },
  { id: 'all', word: 'owner.tally.party.all' },
];
const sideWord: Record<Side, MessageKey> = {
  owes: 'owner.tally.party.owes',
  holds: 'owner.tally.party.holds',
  toPay: 'owner.tally.party.toPay',
  toGet: 'owner.tally.party.toGet',
  clear: 'owner.tally.party.clear',
};
/** What a person just did, kept on screen as one line, because the row itself moves off this list. */
type Done = { ledgerId: string; line: string };
// Everything a link touches: this list, a customer's numbers and the customer page's Tally line.
const linkKeys = [['tally'], ['customers', 'crm']];

/**
 * After a refused write the list reads again, and this row may leave it with whatever it was showing,
 * so what went wrong is said where it stays on screen.
 */
function useTell() {
  const words = useWords();
  const { notice } = useOwner();
  return async (write: () => Promise<unknown>) => {
    try {
      await write();
    } catch (error) {
      notice(words.error(error), true);
      throw error;
    }
  };
}

function byWord(t: ReturnType<typeof useT>, row: PartySuggestion) {
  return row.by === 'NAME'
    ? t('owner.tally.party.byNAME', { score: row.score })
    : t(row.by === 'PHONE' ? 'owner.tally.party.byPHONE' : 'owner.tally.party.byGSTIN');
}

/** "Abhi joda", with its undo. Stays until the next thing is done or it is undone. */
function UndoLine({ done, clear }: { done: Done; clear: () => void }) {
  const t = useT();
  const { offline } = useOwner();
  const undo = useAction(
    async () => {
      await api(`/admin/tally/parties/${done.ledgerId}/unlink`, 'POST');
      clear();
    },
    linkKeys,
    'owner.tally.undone',
  );
  return (
    <div className={css.undoLine} role="status">
      <span>{done.line}</span>
      <Button
        type="button"
        variant="secondary"
        disabled={offline || undo.isPending}
        onClick={() => undo.mutate()}
      >
        {t('owner.tally.undo')}
      </Button>
      <Problem error={undo.error} />
    </div>
  );
}

function SuggestionRow({
  party,
  row,
  onDone,
}: {
  party: Party;
  row: PartySuggestion;
  onDone: (done: Done) => void;
}) {
  const t = useT();
  const { offline } = useOwner();
  const tell = useTell();
  const accept = useAction(async () => {
    await tell(() =>
      api(`/admin/tally/parties/${party.id}/link`, 'POST', {
        userId: row.userId,
        method: row.by,
        score: row.score,
      }),
    );
    onDone({
      ledgerId: party.id,
      line: t('owner.tally.party.linkedLine', { party: party.name, name: row.name }),
    });
  }, linkKeys);
  return (
    <div className={tally.suggestion}>
      <div>
        <p className={tally.line}>{row.name}</p>
        <p className={own.quiet}>
          {[byWord(t, row), row.phone, row.area].filter(Boolean).join(' · ')}
        </p>
      </div>
      <Button
        type="button"
        variant="secondary"
        disabled={offline || accept.isPending}
        aria-label={`${t('owner.tally.yes')}: ${row.name}`}
        onClick={() => accept.mutate()}
      >
        {t('owner.tally.yes')}
      </Button>
    </div>
  );
}

/** For a party with no suggestion, or a wrong one: someone already here, or a new person by phone. */
function LinkSheet({
  party,
  close,
  onDone,
}: {
  party: Party;
  close: () => void;
  onDone: (done: Done) => void;
}) {
  const t = useT();
  const { offline } = useOwner();
  const tell = useTell();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  // Tally's own ledger phone, when it has one. A person still presses the button.
  const [phone, setPhone] = useState(() => party.phones[0]?.replace(/^\+91/, '') ?? '');
  const [name, setName] = useState(party.name);
  const found = useQuery({
    enabled: q.length >= 2,
    queryKey: ['tally', 'customerSearch', q],
    queryFn: () => api<Page<Customer>>(`/admin/customers?limit=8&q=${enc(q)}`),
  });
  const link = useAction(
    async (input: { userId: string; name: string } | { phone: string; name: string }) => {
      await tell(() =>
        api(`/admin/tally/parties/${party.id}/link`, 'POST', {
          ...('userId' in input ? { userId: input.userId } : input),
          method: 'TYPED',
        }),
      );
      onDone({
        ledgerId: party.id,
        line: t('owner.tally.party.linkedLine', { party: party.name, name: input.name }),
      });
      close();
    },
    linkKeys,
  );
  const phoneOk = /^[6-9]\d{9}$/.test(phone);
  const rows = found.data?.items ?? [];
  return (
    <Sheet
      title={t('owner.tally.link.title', { party: party.name })}
      closeLabel={t('owner.close')}
      onClose={close}
    >
      <div className={own.sheetBody}>
        <SearchBar
          label={t('owner.tally.link.search')}
          value={search}
          maxLength={100}
          onChange={(event) => setSearch(event.target.value)}
        />
        {q.length >= 2 && found.isSuccess && !rows.length && (
          <p className={own.quiet}>{t('owner.tally.link.none')}</p>
        )}
        {q.length >= 2 && <QueryStatus query={found} />}
        {rows.length > 0 && (
          <ul className={tally.choices}>
            {rows.map((row) => (
              <li key={row.id} className={tally.suggestion}>
                <div>
                  <p className={tally.line}>{row.name || row.phone}</p>
                  <p className={own.quiet}>{[row.phone, row.area].filter(Boolean).join(' · ')}</p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={offline || link.isPending}
                  aria-label={`${t('owner.tally.yes')}: ${row.name || row.phone}`}
                  onClick={() => link.mutate({ userId: row.id, name: row.name || row.phone })}
                >
                  {t('owner.tally.yes')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <hr className={tally.divider} />
        <h3 className={tally.subtitle}>{t('owner.tally.link.new')}</h3>
        <form
          className={own.sheetBody}
          onSubmit={(event) => {
            event.preventDefault();
            if (phoneOk && name.trim()) link.mutate({ phone: `+91${phone}`, name: name.trim() });
          }}
        >
          <PhoneField
            label={t('owner.tally.link.phone')}
            value={phone}
            onChange={setPhone}
            pattern="[6-9][0-9]{9}"
          />
          <Field label={t('owner.tally.link.name')}>
            <input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <p className={own.quiet}>{t('owner.tally.link.help')}</p>
          <Button
            variant="secondary"
            className={css.wide}
            disabled={offline || link.isPending || !phoneOk || !name.trim()}
          >
            {t('owner.tally.link.save')}
          </Button>
        </form>
      </div>
    </Sheet>
  );
}

function PartyRow({
  party,
  supplier,
  onDone,
}: {
  party: Party;
  supplier: boolean;
  onDone: (done: Done | null) => void;
}) {
  const t = useT();
  const words = useWords();
  const { can, offline } = useOwner();
  const mayAct = can('tally.match');
  const tell = useTell();
  const [linking, setLinking] = useState(false);
  const mark = useAction(async () => {
    await tell(() => api(`/admin/tally/parties/${party.id}/not-customer`, 'POST'));
    onDone({
      ledgerId: party.id,
      line: t('owner.tally.party.markedLine', { party: party.name }),
    });
  }, linkKeys);
  const undo = useAction(
    async () => {
      await tell(() => api(`/admin/tally/parties/${party.id}/unlink`, 'POST'));
      // Whatever the line above the list offered to undo may be this very link.
      onDone(null);
    },
    linkKeys,
    'owner.tally.undone',
  );
  const facts = [party.group, party.company].filter(Boolean).join(' · ');
  return (
    <article className={`${css.card} ${tally.party}`}>
      <div className={tally.partyWho}>
        <h3 className={tally.title}>{party.name}</h3>
        {facts && <p className={own.quiet}>{facts}</p>}
        {party.tieOutOk === false && <Tag tone="look">{t('owner.crm.tally.notSure')}</Tag>}
      </div>
      <div className={tally.partyAmount}>
        {party.closingPaise === null ? (
          <span className={own.quiet}>{t('owner.tally.party.noNumber')}</span>
        ) : (
          <>
            <strong>{plainMoney(party.closingPaise)}</strong>
            <span className={own.quiet}>
              {t(sideWord[partySide(party.closingPaise, supplier)])}
            </span>
          </>
        )}
        {party.asOf && (
          <span className={tally.ledgerNote}>
            {t('owner.crm.tally.until', { when: words.moment(party.asOf) })}
          </span>
        )}
      </div>
      <div className={tally.partyAct}>
        {party.status === 'LINKED' && party.customer && (
          <div className={tally.suggestion}>
            <div>
              <p className={own.quiet}>{t('owner.tally.party.linkedTo')}</p>
              <p className={tally.line}>
                <Link href={`/customers/${party.customer.id}?tab=tally`} className={css.inlineLink}>
                  {party.customer.name || party.customer.phone}
                </Link>
              </p>
              <p className={own.quiet}>{party.customer.phone}</p>
            </div>
            {mayAct && (
              <Button
                type="button"
                variant="ghost"
                disabled={offline || undo.isPending}
                aria-label={`${t('owner.tally.undo')}: ${party.name}`}
                onClick={() => undo.mutate()}
              >
                {t('owner.tally.undo')}
              </Button>
            )}
          </div>
        )}
        {party.status === 'NOT_CUSTOMER' && (
          <div className={tally.suggestion}>
            <p className={own.quiet}>{t('owner.tally.party.marked')}</p>
            {mayAct && (
              <Button
                type="button"
                variant="ghost"
                disabled={offline || undo.isPending}
                aria-label={`${t('owner.tally.undo')}: ${party.name}`}
                onClick={() => undo.mutate()}
              >
                {t('owner.tally.undo')}
              </Button>
            )}
          </div>
        )}
        {party.status === 'UNLINKED' && mayAct && (
          <>
            {party.suggestions.map((row) => (
              <SuggestionRow key={row.userId} party={party} row={row} onDone={onDone} />
            ))}
            <div className={own.buttons}>
              <Button
                type="button"
                variant="secondary"
                disabled={offline}
                onClick={() => setLinking(true)}
              >
                {t('owner.tally.party.find')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={offline || mark.isPending}
                onClick={() => mark.mutate()}
              >
                {t('owner.tally.party.notCustomer')}
              </Button>
            </div>
          </>
        )}
      </div>
      {linking && <LinkSheet party={party} close={() => setLinking(false)} onDone={onDone} />}
    </article>
  );
}

export function PartyJodo() {
  const t = useT();
  const status = useTallyStatus();
  const [supplier, setSupplier] = useState(false);
  const [filter, setFilter] = useState<Filter>('unlinked');
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const q = useDebounced(search.trim());
  const params = [
    `class=${supplier ? 'CREDITOR' : 'DEBTOR'}`,
    `filter=${filter}`,
    q ? `q=${enc(q)}` : '',
    companyId ? `companyId=${enc(companyId)}` : '',
    'limit=24',
  ]
    .filter(Boolean)
    .join('&');
  const list = useInfiniteQuery<PartyList, Error, InfiniteData<PartyList>, QueryKey, number>({
    queryKey: ['tally', 'parties', params],
    initialPageParam: 0,
    placeholderData: (previous) => previous,
    queryFn: ({ pageParam }) =>
      api<PartyList>(`/admin/tally/parties?${params}${pageParam ? `&skip=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.nextSkip ?? undefined,
  });
  const books = status.data?.companies.filter((company) => company.role === 'PRIMARY') ?? [];
  const first = list.data?.pages[0];
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  const progress = first?.progress;
  if (status.data && !books.length)
    return (
      <EmptyState
        title={t(
          status.data.devices.some((pc) => !pc.revoked)
            ? 'owner.tally.noPrimary'
            : 'owner.crm.tally.notConnected',
        )}
        action={
          <Link href="/tally?tab=haal" className={css.inlineLink}>
            {t('owner.tally.goHaal')}
          </Link>
        }
      />
    );
  const empty: MessageKey = q
    ? 'owner.tally.party.noMatch'
    : !progress?.totalParties
      ? 'owner.tally.party.none'
      : filter === 'unlinked'
        ? 'owner.tally.party.allDone'
        : filter === 'linked'
          ? 'owner.tally.party.noneLinked'
          : filter === 'notCustomer'
            ? 'owner.tally.party.noneMarked'
            : 'owner.tally.party.none';
  return (
    <div className={tally.page}>
      {progress && progress.totalParties > 0 && (
        <section
          className={`${css.card} ${tally.cardBody}`}
          aria-label={t('owner.tally.tab.party')}
        >
          <p className={tally.line}>
            {t(supplier ? 'owner.tally.party.progressPlain' : 'owner.tally.party.progress', {
              linked: bookMoney(progress.linkedPaise),
              total: bookMoney(progress.totalPaise),
              parties: progress.linkedParties,
              all: progress.totalParties,
            })}
          </p>
          <progress
            className={tally.bar}
            max={100}
            value={sharePercent(progress.linkedPaise, progress.totalPaise)}
            aria-hidden="true"
          />
          <p className={own.quiet}>{t('owner.tally.noWrite')}</p>
        </section>
      )}
      {done && <UndoLine done={done} clear={() => setDone(null)} />}
      <div className={tally.search}>
        <SearchBar
          label={t('owner.tally.party.search')}
          value={search}
          maxLength={80}
          onChange={(event) => setSearch(event.target.value)}
        />
        {books.length > 1 && (
          <Field label={t('owner.tally.party.company')}>
            <select value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
              <option value="">{t('owner.tally.party.allCompanies')}</option>
              {books.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <div className={tally.filters} role="group" aria-label={t('owner.tally.party.show')}>
        {filters.map(({ id, word }) => (
          <Button
            key={id}
            type="button"
            variant={id === filter ? 'primary' : 'secondary'}
            aria-pressed={id === filter}
            onClick={() => setFilter(id)}
          >
            {t(word)}
          </Button>
        ))}
      </div>
      <div className={tally.filters} role="group" aria-label={t('owner.tally.party.kind')}>
        {[false, true].map((value) => (
          <Button
            key={String(value)}
            type="button"
            variant={value === supplier ? 'primary' : 'ghost'}
            aria-pressed={value === supplier}
            onClick={() => setSupplier(value)}
          >
            {t(value ? 'owner.tally.party.creditors' : 'owner.tally.party.debtors')}
          </Button>
        ))}
      </div>
      <QueryStatus query={list} />
      {!list.isPending && !list.error && !rows.length && <EmptyState title={t(empty)} />}
      <div className={css.stack}>
        {rows.map((party) => (
          <PartyRow key={party.id} party={party} supplier={supplier} onDone={setDone} />
        ))}
      </div>
      <MoreRows query={list} />
    </div>
  );
}
