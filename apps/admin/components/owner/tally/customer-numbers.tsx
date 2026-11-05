'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@shiv/design';
import { dayLabel } from '@shiv/shared';
import { isMessageKey } from '@shiv/i18n';
import { api } from '../../../lib/api';
import { useLanguage, useT, useWords } from '../../../lib/i18n';
import { useAction, useOwner } from '../../../lib/owner';
import { Problem, QueryStatus } from '../common';
import own from '../crm/crm.module.css';
import { bookMoney } from '../crm/pure';
import css from '../owner.module.css';
import { Tag, useTallyStatus } from './haal';
import { asKhata, lineWord, linesAddUp, plainMoney, signedMoney } from './pure';
import tally from './tally.module.css';
import type {
  CustomerNumbers,
  DifferenceLine,
  NumbersParty,
  StandingMatch,
  VoucherChange,
} from './types';

// The customer page's own facts and the Farq list both move with these.
const tallyKeys = (id: string) => [
  ['tally'],
  ['customers', 'crm', id],
  ['customers', 'timeline', id],
];

function Ledger({
  label,
  note,
  amount,
  total = false,
  greyed = false,
}: {
  label: string;
  note?: string;
  amount: string;
  total?: boolean;
  greyed?: boolean;
}) {
  return (
    <div
      className={`${css.ledgerLine} ${total ? tally.ledgerTotal : ''} ${greyed ? tally.greyed : ''}`}
    >
      <span>
        {label}
        {note && <span className={tally.ledgerNote}>{note}</span>}
      </span>
      <span className={css.amount}>{amount}</span>
    </div>
  );
}

/** A label is an order or voucher number, or an entry's kind, which has words of its own. */
function useLabelWord() {
  const t = useT();
  return (label?: string) => {
    if (!label) return '';
    const key = `status.${label}`;
    return isMessageKey(key) ? t(key) : label;
  };
}

function LineRow({ line }: { line: DifferenceLine }) {
  const t = useT();
  const { language } = useLanguage();
  const labelWord = useLabelWord();
  const note = [line.on ? dayLabel(line.on, language) : '', labelWord(line.label)]
    .filter(Boolean)
    .join(' · ');
  return <Ledger label={t(lineWord(line))} note={note} amount={signedMoney(line.amountPaise)} />;
}

/** One tap each, or all at once. A suggestion is only a suggestion until a person accepts it. */
function Suggestions({
  customerId,
  lines,
  suggestions,
}: {
  customerId: string;
  lines: DifferenceLine[];
  suggestions: { entryId: string; voucherId: string; amountPaise: string }[];
}) {
  const t = useT();
  const { language } = useLanguage();
  const accept = useAction(
    async (items: { entryId: string; voucherId: string }[]) => {
      await api('/admin/tally/matches', 'POST', { items });
    },
    tallyKeys(customerId),
    'owner.tally.numbers.matchedDone',
  );
  if (!suggestions.length) return null;
  // The route takes 100 at a time, and refuses the lot past that. The next tap takes the rest.
  const batch = suggestions.slice(0, 100);
  const words = (row: (typeof suggestions)[number]) => {
    const entry = lines.find((line) => line.entryId === row.entryId);
    const voucher = lines.find((line) => line.voucherId === row.voucherId);
    const amount = plainMoney(row.amountPaise);
    return entry?.on && voucher?.on
      ? t('owner.tally.numbers.suggestLine', {
          day: dayLabel(entry.on, language),
          label: voucher.label ?? '',
          voucherDay: dayLabel(voucher.on, language),
          amount,
        })
      : t('owner.tally.numbers.suggestShort', { amount });
  };
  return (
    <section className={tally.section} aria-label={t('owner.tally.numbers.suggest')}>
      <div className={own.spread}>
        <h3 className={tally.subtitle}>{t('owner.tally.numbers.suggest')}</h3>
        {suggestions.length > 1 && (
          <Button
            type="button"
            variant="secondary"
            disabled={accept.isPending}
            onClick={() =>
              accept.mutate(batch.map(({ entryId, voucherId }) => ({ entryId, voucherId })))
            }
          >
            {t('owner.tally.numbers.acceptAll', { count: batch.length })}
          </Button>
        )}
      </div>
      <ul className={tally.choices}>
        {suggestions.map((row) => (
          <li key={`${row.entryId}:${row.voucherId}`} className={tally.suggestion}>
            <p className={tally.line}>{words(row)}</p>
            <Button
              type="button"
              variant="secondary"
              disabled={accept.isPending}
              aria-label={`${t('owner.tally.yes')}: ${words(row)}`}
              onClick={() => accept.mutate([{ entryId: row.entryId, voucherId: row.voucherId }])}
            >
              {t('owner.tally.yes')}
            </Button>
          </li>
        ))}
      </ul>
      <Problem error={accept.error} />
    </section>
  );
}

function MatchRow({ customerId, row }: { customerId: string; row: StandingMatch }) {
  const t = useT();
  const { language } = useLanguage();
  const undo = useAction(
    async () => {
      await api(`/admin/tally/matches/${row.id}/undo`, 'POST');
    },
    tallyKeys(customerId),
    'owner.tally.undone',
  );
  const line = t('owner.tally.numbers.matchLine', {
    label: row.label,
    day: row.on ? dayLabel(row.on, language) : '',
    amount: plainMoney(row.amountPaise),
  });
  return (
    <li className={tally.rowEnd}>
      <div>
        <p className={tally.line}>{line}</p>
        {row.voucherGone && <p className={own.look}>{t('owner.tally.numbers.voucherGone')}</p>}
      </div>
      <Button
        type="button"
        variant="ghost"
        disabled={undo.isPending}
        aria-label={`${t('owner.tally.undo')}: ${line}`}
        onClick={() => undo.mutate()}
      >
        {t('owner.tally.undo')}
      </Button>
      <Problem error={undo.error} />
    </li>
  );
}

function changeWords(t: ReturnType<typeof useT>, row: VoucherChange) {
  const from = row.oldAmountPaise === null ? '' : bookMoney(asKhata(row.oldAmountPaise));
  const to = row.newAmountPaise === null ? '' : bookMoney(asKhata(row.newAmountPaise));
  if (row.kind === 'DELETED') return t('owner.tally.numbers.changeDELETED', { from });
  if (row.kind === 'RESTORED') return t('owner.tally.numbers.changeRESTORED', { to });
  return t('owner.tally.numbers.changeALTERED', { from, to });
}

function PartyRow({ customerId, party }: { customerId: string; party: NumbersParty }) {
  const t = useT();
  const words = useWords();
  const { can, confirm } = useOwner();
  const unlink = useAction(
    async () => {
      await api(`/admin/tally/parties/${party.ledgerId}/unlink`, 'POST');
    },
    tallyKeys(customerId),
    'owner.tally.undone',
  );
  return (
    <li className={tally.rowEnd}>
      <div>
        <p className={tally.line}>{party.name}</p>
        <p className={own.quiet}>
          {[
            party.company,
            party.closingPaise === null ? '' : bookMoney(asKhata(party.closingPaise)),
            party.asOf ? t('owner.crm.tally.until', { when: words.moment(party.asOf) }) : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {party.deleted && <Tag tone="look">{t('owner.tally.numbers.partyGone')}</Tag>}
        {party.tieOutOk === false && (
          <p className={own.look}>
            {t('owner.crm.tally.notSure')}
            {party.tieOutGapPaise !== null &&
              ` · ${t('owner.tally.numbers.gap', { amount: plainMoney(party.tieOutGapPaise) })}`}
          </p>
        )}
      </div>
      {can('tally.match') && (
        <Button
          type="button"
          variant="ghost"
          disabled={unlink.isPending}
          onClick={() =>
            void confirm({
              title: t('owner.tally.numbers.unlinkTitle', { party: party.name }),
              body: t('owner.tally.numbers.unlinkBody'),
              confirmLabel: t('owner.tally.numbers.unlinkYes'),
            }).then((yes) => {
              if (yes) unlink.mutate();
            })
          }
        >
          {t('owner.tally.numbers.unlink')}
        </Button>
      )}
      <Problem error={unlink.error} />
    </li>
  );
}

/**
 * The customer page's Tally tab: both numbers with Tally's time, then every line between them.
 * Only ever rendered for those who hold tally.numbers.view, and the API refuses everyone else.
 */
export function CustomerNumbersPanel({ id }: { id: string }) {
  const top = useRef<HTMLDivElement>(null);
  // On a phone this sits under the facts and rates, so a tap on "dekho" would seem to do nothing.
  useEffect(() => {
    if (!window.matchMedia?.('(min-width: 64rem)').matches)
      top.current?.scrollIntoView({ block: 'start' });
  }, []);
  return (
    <div ref={top} className={tally.anchor}>
      <Numbers id={id} />
    </div>
  );
}

function Numbers({ id }: { id: string }) {
  const t = useT();
  const words = useWords();
  const { can } = useOwner();
  const status = useTallyStatus();
  const numbers = useQuery({
    queryKey: ['tally', 'numbers', id],
    queryFn: () => api<CustomerNumbers>(`/admin/tally/customers/${id}/numbers`),
  });
  const data = numbers.data;
  if (!data)
    return (
      <section className={css.card}>
        <QueryStatus query={numbers} />
      </section>
    );
  // With no books in use, linking is not yet the next step: the same line the Tally page draws.
  const noBooks = status.data && !status.data.companies.some((row) => row.role === 'PRIMARY');
  if (data.state === 'NOT_LINKED' || !data.tally)
    return (
      <section
        className={`${css.card} ${tally.cardBody}`}
        aria-label={t('owner.tally.numbers.title')}
      >
        <h2 className={tally.title}>{t('owner.tally.numbers.title')}</h2>
        <p className={tally.line}>
          {t(noBooks ? 'owner.crm.tally.notConnected' : 'owner.crm.tally.notLinked')}
        </p>
        {noBooks && (
          <Link href="/tally?tab=haal" className={css.inlineLink}>
            {t('owner.tally.goHaal')} <span aria-hidden="true">→</span>
          </Link>
        )}
        {!noBooks && can('tally.match') && (
          <>
            <p className={own.quiet}>{t('owner.tally.numbers.linkHelp')}</p>
            <Link href="/tally?tab=party" className={css.inlineLink}>
              {t('owner.tally.goParty')} <span aria-hidden="true">→</span>
            </Link>
          </>
        )}
      </section>
    );
  const { tally: book } = data;
  const when = book.asOf ? words.moment(book.asOf) : null;
  const ready = data.state === 'READY' && book.differencePaise !== null;
  const unsure = book.tieOut === 'REWRITTEN';
  const unexplained = book.unexplainedPaise ?? '0';
  const hasGap = ready && BigInt(book.differencePaise!) !== BigInt(0);
  const hasMissing = ready && BigInt(unexplained) !== BigInt(0);
  return (
    <section
      className={`${css.card} ${tally.cardBody}`}
      aria-label={t('owner.tally.numbers.title')}
    >
      <div className={own.spread}>
        <h2 className={tally.title}>{t('owner.tally.numbers.title')}</h2>
        {book.tieOut === 'OK' && ready && <Tag tone="good">{t('owner.tally.numbers.tied')}</Tag>}
        {book.tieOut === 'FAILED' && <Tag tone="look">{t('owner.crm.tally.notSure')}</Tag>}
        {book.tieOut === 'PENDING' && <Tag tone="plain">{t('owner.tally.numbers.pending')}</Tag>}
      </div>
      {unsure && <p className={own.look}>{t('owner.tally.numbers.rewritten')}</p>}
      {book.stale && (
        <p className={own.look}>
          {t('owner.tally.numbers.stale', { when: when ?? t('owner.tally.numbers.tallyNoTime') })}
        </p>
      )}
      <div className={css.ledger}>
        <Ledger
          label={t('owner.tally.numbers.khata')}
          amount={bookMoney(String(data.khataPaise))}
        />
        <Ledger
          label={
            when ? t('owner.tally.numbers.tally', { when }) : t('owner.tally.numbers.tallyNoTime')
          }
          amount={bookMoney(book.appEquivalentPaise)}
          greyed={unsure}
        />
        {ready && (
          <Ledger
            label={t('owner.tally.line.total')}
            amount={bookMoney(book.differencePaise!)}
            total
          />
        )}
      </div>
      {!ready && <p className={own.quiet}>{t('owner.crm.tally.copying')}</p>}
      {ready && !hasGap && !data.lines.length && !hasMissing && (
        <p className={tally.line}>{t('owner.tally.numbers.same')}</p>
      )}
      {ready && (data.lines.length > 0 || hasMissing) && (
        <section className={tally.section} aria-label={t('owner.tally.numbers.why')}>
          <h3 className={tally.subtitle}>{t('owner.tally.numbers.why')}</h3>
          <p className={own.quiet}>{t('owner.tally.numbers.signHelp')}</p>
          <div className={css.ledger}>
            {data.lines.map((line, index) => (
              <LineRow
                key={`${line.reason}:${line.entryId ?? line.voucherId ?? index}`}
                line={line}
              />
            ))}
            {hasMissing && (
              <Ledger label={t('owner.tally.line.unexplained')} amount={signedMoney(unexplained)} />
            )}
            <Ledger
              label={t('owner.tally.line.total')}
              amount={signedMoney(book.differencePaise!)}
              total
            />
          </div>
          {linesAddUp(data.lines, unexplained, book.differencePaise!) ? (
            <p className={own.quiet}>{t('owner.tally.numbers.addsUp')}</p>
          ) : (
            <p className={own.look}>{t('owner.tally.numbers.notAddsUp')}</p>
          )}
        </section>
      )}
      {ready && can('tally.match') && (
        <Suggestions customerId={id} lines={data.lines} suggestions={data.suggestions} />
      )}
      {ready && data.changes.length > 0 && (
        <section className={tally.section} aria-label={t('owner.tally.numbers.changes')}>
          <h3 className={tally.subtitle}>{t('owner.tally.numbers.changes')}</h3>
          <ul className={own.lines}>
            {data.changes.map((row) => (
              <li key={row.id}>
                <span>{changeWords(t, row)}</span>
                <span className={own.quiet}>{words.moment(row.detectedAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {ready && can('tally.match') && data.matches.length > 0 && (
        <section className={tally.section} aria-label={t('owner.tally.numbers.matches')}>
          <h3 className={tally.subtitle}>{t('owner.tally.numbers.matches')}</h3>
          <ul className={tally.choices}>
            {data.matches.map((row) => (
              <MatchRow key={row.id} customerId={id} row={row} />
            ))}
          </ul>
        </section>
      )}
      <section className={tally.section} aria-label={t('owner.tally.numbers.parties')}>
        <h3 className={tally.subtitle}>{t('owner.tally.numbers.parties')}</h3>
        <ul className={tally.choices}>
          {data.parties.map((party) => (
            <PartyRow key={party.ledgerId} customerId={id} party={party} />
          ))}
        </ul>
      </section>
    </section>
  );
}
