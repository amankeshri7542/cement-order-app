'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Button, EmptyState, Field, MoneyText } from '@shiv/design';
import { dayLabel, istToday, money, type Permission } from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { api, download } from '../../../lib/api';
import { useLanguage, useT, useWords } from '../../../lib/i18n';
import { useIsWide, useOwner } from '../../../lib/owner';
import { MoreRows, PageHeader, QueryStatus } from '../common';
import { NotYourPage } from '../not-your-page';
import css from '../owner.module.css';
import own from './crm.module.css';
import { FollowUpSheet } from './follow-up';
import { bookMoney } from './pure';
import { YaadDilao } from './reminder';
import type { Mahine, Quiet, Shaam, Suppliers, Vasooli, VasooliRow } from './types';

const enc = encodeURIComponent;
const bigMoney = (paise: string | null) => (paise === null ? '' : bookMoney(paise));

function CsvButton({ path, name }: { path: string; name: string }) {
  const t = useT();
  const words = useWords();
  const { notice } = useOwner();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        download(path, name)
          .catch((error: unknown) => notice(words.error(error), true))
          .finally(() => setBusy(false));
      }}
    >
      <Download aria-hidden="true" size={16} /> {t('owner.reports.csv')}
    </Button>
  );
}

function Line({
  label,
  children,
  total = false,
}: {
  label: string;
  children: React.ReactNode;
  total?: boolean;
}) {
  return (
    <li className={total ? own.linesTotal : ''}>
      <span>{label}</span>
      <span className={own.money}>{children}</span>
    </li>
  );
}

// ---- Shaam ka hisaab --------------------------------------------------------------------------
function ShaamReport() {
  const t = useT();
  const { language } = useLanguage();
  const { shopId } = useOwner();
  const [day, setDay] = useState(istToday());
  const query = `day=${day}${shopId ? `&locationId=${enc(shopId)}` : ''}`;
  const report = useQuery({
    queryKey: ['crm', 'shaam', day, shopId],
    queryFn: () => api<Shaam>(`/admin/reports/shaam?${query}`),
  });
  const r = report.data;
  return (
    <section className={`${css.card} ${own.narrow}`} aria-label={t('owner.crm.report.shaam')}>
      <div className={own.spread}>
        <Field label={t('owner.crm.when.date')}>
          <input
            type="date"
            value={day}
            max={istToday()}
            onChange={(event) => setDay(event.target.value || istToday())}
          />
        </Field>
        <CsvButton path={`/admin/reports/shaam.csv?${query}`} name={`shiv-shaam-${day}.csv`} />
      </div>
      <QueryStatus query={report} />
      {r && (
        <>
          <p className={own.quiet}>{dayLabel(r.day, language)}</p>
          <ul className={own.lines}>
            <Line label={t('owner.crm.shaam.cash')}>{money(r.moneyIn.cashPaise)}</Line>
            <Line label={t('owner.crm.shaam.upi')}>{money(r.moneyIn.upiPaise)}</Line>
            {r.moneyIn.onlinePaise !== 0 && (
              <Line label={t('owner.crm.shaam.online')}>{money(r.moneyIn.onlinePaise)}</Line>
            )}
            {r.moneyIn.otherPaise !== 0 && (
              <Line label={t('owner.crm.shaam.other')}>{money(r.moneyIn.otherPaise)}</Line>
            )}
            <Line label={t('owner.crm.shaam.total')} total>
              {money(r.moneyIn.totalPaise)}
            </Line>
            <Line label={t('owner.crm.shaam.given')}>{money(r.udhaarGivenPaise)}</Line>
            <Line label={t('owner.crm.shaam.received')}>{money(r.udhaarReceivedPaise)}</Line>
            <Line label={t('owner.crm.shaam.orders')}>{r.orders}</Line>
            <Line label={t('owner.crm.shaam.closed')}>
              {t('owner.crm.shaam.closedOf', { closed: r.galla.closed, shops: r.galla.shops })}
            </Line>
            <Line label={t('owner.crm.shaam.galla')}>
              {money(Math.abs(r.galla.differencePaise))}
              {r.galla.differencePaise < 0 ? ` ${t('owner.crm.shaam.short')}` : ''}
              {r.galla.differencePaise > 0 ? ` ${t('owner.crm.shaam.over')}` : ''}
            </Line>
          </ul>
        </>
      )}
    </section>
  );
}

// ---- Vasooli list -----------------------------------------------------------------------------
const promiseWord: Record<string, MessageKey> = {
  OPEN: 'owner.crm.promise.open',
  KEPT: 'owner.crm.promise.kept',
  BROKEN: 'owner.crm.promise.broken',
};

function VasooliActions({ row }: { row: VasooliRow }) {
  const t = useT();
  const { can } = useOwner();
  const [writing, setWriting] = useState(false);
  return (
    <div className={own.buttons}>
      {row.phone && (
        <a className={css.inlineLink} href={`tel:${row.phone}`}>
          {t('owner.call')}
        </a>
      )}
      {can('crm.remind') && <YaadDilao customerId={row.id} blocked={row.reminderBlocked} />}
      {can('crm.followups') && (
        <Button type="button" variant="ghost" onClick={() => setWriting(true)}>
          {t('owner.crm.whenWillPay')}
        </Button>
      )}
      {writing && (
        <FollowUpSheet customerId={row.id} startKind="PAYMENT" close={() => setWriting(false)} />
      )}
    </div>
  );
}

/** "Yaad dilaya 3 din pehle", so nobody reminds someone who was reminded yesterday. */
function RemindedLine({ at }: { at: string | null }) {
  const t = useT();
  const words = useWords();
  if (!at) return null;
  return <p className={own.quiet}>{t('owner.crm.remindedAgo', { age: words.age(at) })}</p>;
}

function PromiseCell({ row }: { row: VasooliRow }) {
  const t = useT();
  const { language } = useLanguage();
  if (!row.promise?.state) return null;
  const tone =
    row.promise.state === 'BROKEN' ? own.tagBad : row.promise.state === 'KEPT' ? own.tagGood : '';
  return (
    <span className={`${own.tag} ${tone}`}>
      {t(promiseWord[row.promise.state]!)} · {dayLabel(row.promise.dueOn, language)}
    </span>
  );
}

function VasooliReport() {
  const t = useT();
  const { language } = useLanguage();
  const { shopId } = useOwner();
  const wide = useIsWide();
  const shop = shopId ? `locationId=${enc(shopId)}` : '';
  const list = useInfiniteQuery({
    queryKey: ['crm', 'vasooli', shopId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<Vasooli>(
        `/admin/reports/vasooli?${[shop, pageParam ? `cursor=${enc(pageParam)}` : '']
          .filter(Boolean)
          .join('&')}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const first = list.data?.pages[0];
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  const age = (row: VasooliRow) =>
    row.fromOpening
      ? t('owner.crm.oldestOpening')
      : row.ageDays === null
        ? ''
        : t('owner.crm.days', { days: row.ageDays });
  return (
    <div className={css.stack}>
      <div className={own.spread}>
        {first && (
          <div>
            <p className={own.quiet}>
              {t('owner.crm.vasooli.summary', { customers: first.customersWithDue })}
            </p>
            <p className={own.figure}>{money(first.totalDuePaise)}</p>
          </div>
        )}
        <CsvButton
          path={`/admin/reports/vasooli.csv${shop ? `?${shop}` : ''}`}
          name={`shiv-vasooli-${istToday()}.csv`}
        />
      </div>
      {!!first?.unsigned.customers && (
        <Link href="/udhaar/opening" className={own.look}>
          {t('owner.crm.vasooli.unsigned', { count: first.unsigned.customers })}{' '}
          <span aria-hidden="true">→</span>
        </Link>
      )}
      <QueryStatus query={list} />
      {!list.isPending && !list.error && !rows.length && (
        <EmptyState title={t('owner.crm.vasooli.empty')} />
      )}
      {!!rows.length &&
        (wide ? (
          <div className={`${css.card} ${own.scroll}`}>
            <table className={own.table}>
              <thead>
                <tr>
                  <th>{t('owner.crm.col.customer')}</th>
                  <th className={own.moneyCell}>{t('owner.crm.col.due')}</th>
                  <th className={own.moneyCell}>{t('owner.crm.col.limit')}</th>
                  <th>{t('owner.crm.col.oldest')}</th>
                  <th>{t('owner.crm.col.lastMoney')}</th>
                  <th>{t('owner.crm.col.promise')}</th>
                  <th>{t('owner.crm.col.do')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/customers/${row.id}`} className={css.inlineLink}>
                        {row.name || row.phoneMasked}
                      </Link>
                      <p className={own.quiet}>
                        {[row.phone ?? row.phoneMasked, row.area].filter(Boolean).join(' · ')}
                      </p>
                      <RemindedLine at={row.lastRemindedAt} />
                    </td>
                    <td className={own.moneyCell}>
                      <MoneyText value={row.balancePaise} signed />
                    </td>
                    <td className={own.moneyCell}>
                      {row.limitPaise === null ? '' : money(row.limitPaise)}
                    </td>
                    <td>{age(row)}</td>
                    <td>
                      {row.lastPaymentOn && row.lastPaymentPaise !== null
                        ? `${money(row.lastPaymentPaise)} · ${dayLabel(row.lastPaymentOn, language)}`
                        : ''}
                    </td>
                    <td>
                      <PromiseCell row={row} />
                    </td>
                    <td>
                      <VasooliActions row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          rows.map((row) => (
            <article key={row.id} className={css.card}>
              <div className={own.spread}>
                <Link href={`/customers/${row.id}`} className={own.name}>
                  {row.name || row.phoneMasked}
                </Link>
                <MoneyText value={row.balancePaise} signed />
              </div>
              <p className={own.quiet}>
                {[row.phone ?? row.phoneMasked, row.area, age(row)].filter(Boolean).join(' · ')}
              </p>
              {row.lastPaymentOn && row.lastPaymentPaise !== null && (
                <p className={own.quiet}>
                  {t('owner.crm.lastMoney')}: {money(row.lastPaymentPaise)} ·{' '}
                  {dayLabel(row.lastPaymentOn, language)}
                </p>
              )}
              <RemindedLine at={row.lastRemindedAt} />
              <PromiseCell row={row} />
              <VasooliActions row={row} />
            </article>
          ))
        ))}
      <MoreRows query={list} />
    </div>
  );
}

// ---- Chup grahak ------------------------------------------------------------------------------
function QuietReport() {
  const t = useT();
  const { language } = useLanguage();
  const { shopId, can } = useOwner();
  const shop = shopId ? `locationId=${enc(shopId)}` : '';
  const list = useQuery({
    queryKey: ['crm', 'quiet', shopId],
    queryFn: () => api<Quiet>(`/admin/crm/dormant${shop ? `?${shop}` : ''}`),
  });
  const r = list.data;
  return (
    <div className={css.stack}>
      <div className={own.spread}>
        <p className={own.quiet}>
          {r &&
            t('owner.crm.quiet.rule', {
              orders: r.rule.minOrders,
              days: r.rule.minQuietDays,
              times: r.rule.timesUsualGap,
            })}
        </p>
        <CsvButton
          path={`/admin/reports/chup-grahak.csv${shop ? `?${shop}` : ''}`}
          name={`shiv-chup-grahak-${istToday()}.csv`}
        />
      </div>
      <QueryStatus query={list} />
      {r && !r.items.length && <EmptyState title={t('owner.crm.quiet.empty')} />}
      {r?.items.map((row) => (
        <article key={row.id} className={css.card}>
          <div className={own.spread}>
            <Link href={`/customers/${row.id}`} className={own.name}>
              {row.name || row.phoneMasked}
            </Link>
            <span className={`${own.tag} ${own.tagLook}`}>
              {t('owner.crm.quiet.days', { days: row.quietDays })}
            </span>
          </div>
          <p className={own.quiet}>
            {[row.phone ?? row.phoneMasked, row.area].filter(Boolean).join(' · ')}
          </p>
          <p>
            {t('owner.crm.quiet.pattern', {
              orders: row.orders,
              gap: row.usualGapDays ?? 0,
              last: dayLabel(row.lastOrderOn, language),
            })}
          </p>
          <p className={own.quiet}>
            {[
              row.lastMaterial,
              row.lastRatePaise !== null ? `${money(row.lastRatePaise)}/${row.lastUnit}` : '',
              row.site,
              row.yearPaise !== null
                ? t('owner.crm.quiet.year', { amount: money(row.yearPaise) })
                : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className={own.buttons}>
            {row.phone && (
              <a className={css.inlineLink} href={`tel:${row.phone}`}>
                {t('owner.call')}
              </a>
            )}
            {can('crm.remind') && (
              <YaadDilao
                customerId={row.id}
                purpose="QUIET"
                blocked={row.reminderBlocked}
                label={t('owner.crm.quiet.message')}
              />
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

// ---- Mahine ka saar ---------------------------------------------------------------------------
function MonthReport() {
  const t = useT();
  const { shopId } = useOwner();
  const [month, setMonth] = useState(istToday().slice(0, 7));
  const query = `month=${month}${shopId ? `&locationId=${enc(shopId)}` : ''}`;
  const report = useQuery({
    queryKey: ['crm', 'mahine', month, shopId],
    queryFn: () => api<Mahine>(`/admin/reports/mahine?${query}`),
  });
  const r = report.data;
  return (
    <div className={css.stack}>
      <div className={own.spread}>
        <Field label={t('owner.crm.month')}>
          <input
            type="month"
            value={month}
            max={istToday().slice(0, 7)}
            onChange={(event) => setMonth(event.target.value || istToday().slice(0, 7))}
          />
        </Field>
        <CsvButton path={`/admin/reports/mahine.csv?${query}`} name={`shiv-mahine-${month}.csv`} />
      </div>
      <QueryStatus query={report} />
      {r && (
        <>
          <section className={`${css.card} ${own.narrow}`}>
            <h2>{t('owner.crm.mahine.udhaar')}</h2>
            <ul className={own.lines}>
              <Line label={t('owner.crm.mahine.start')}>{money(r.udhaar.startPaise)}</Line>
              <Line label={t('owner.crm.shaam.given')}>{money(r.udhaar.givenPaise)}</Line>
              <Line label={t('owner.crm.shaam.received')}>{money(r.udhaar.receivedPaise)}</Line>
              {r.udhaar.otherPaise !== 0 && (
                <Line label={t('owner.crm.mahine.other')}>{money(r.udhaar.otherPaise)}</Line>
              )}
              <Line label={t('owner.crm.mahine.end')} total>
                {money(r.udhaar.endPaise)}
              </Line>
            </ul>
          </section>
          <section className={css.card}>
            <h2>{t('owner.crm.mahine.sales')}</h2>
            <p className={own.quiet}>{t('owner.crm.mahine.notProfit')}</p>
            {r.materials.length ? (
              <div className={own.scroll}>
                <table className={own.table}>
                  <thead>
                    <tr>
                      <th>{t('owner.crm.rates.item')}</th>
                      <th className={own.moneyCell}>{t('owner.crm.col.quantity')}</th>
                      <th className={own.moneyCell}>{t('owner.crm.col.value')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.materials.map((row) => (
                      <tr key={`${row.productId}-${row.unit}`}>
                        <td>{row.name}</td>
                        <td className={own.moneyCell}>
                          {row.quantity.toLocaleString('en-IN')} {row.unit}
                        </td>
                        <td className={own.moneyCell}>{money(row.totalPaise)}</td>
                      </tr>
                    ))}
                    <tr className={own.total}>
                      <td colSpan={2}>{t('owner.crm.shaam.total')}</td>
                      <td className={own.moneyCell}>{money(r.appSalesPaise)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={own.quiet}>{t('owner.crm.mahine.noSales')}</p>
            )}
          </section>
          {r.topCustomers.length > 0 && (
            <section className={css.card}>
              <h2>{t('owner.crm.mahine.top')}</h2>
              <ul className={own.lines}>
                {r.topCustomers.map((row) => (
                  <li key={row.id}>
                    <Link href={`/customers/${row.id}`} className={css.inlineLink}>
                      {row.name || row.phoneMasked}
                    </Link>
                    <span className={own.money}>{money(row.totalPaise)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {r.tally && (
            <section className={`${css.card} ${own.narrow}`}>
              <h2>{t('owner.crm.mahine.books')}</h2>
              {r.tally.connected ? (
                <ul className={own.lines}>
                  <Line label={t('owner.crm.mahine.appSales')}>{money(r.appSalesPaise)}</Line>
                  <Line label={t('owner.crm.mahine.tallySales')}>
                    {bigMoney(r.tally.salesPaise)}
                  </Line>
                  <Line label={t('owner.crm.report.suppliers')}>
                    {bigMoney(r.tally.suppliers.totalPaise)}
                  </Line>
                </ul>
              ) : (
                <p className={own.quiet}>{t('owner.crm.tally.notConnected')}</p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ---- Supplier baaki ---------------------------------------------------------------------------
function SuppliersReport() {
  const t = useT();
  const words = useWords();
  const { language } = useLanguage();
  const list = useQuery({
    queryKey: ['crm', 'suppliers'],
    queryFn: () => api<Suppliers>('/admin/tally/suppliers'),
  });
  const r = list.data;
  return (
    <div className={css.stack}>
      <QueryStatus query={list} />
      {r && !r.connected && <EmptyState title={t('owner.crm.tally.notConnected')} />}
      {r?.connected && (
        <section className={css.card}>
          <div className={own.spread}>
            <p className={own.figure}>{bigMoney(r.totalPaise)}</p>
            {r.asOf && (
              <p className={own.quiet}>
                {t('owner.crm.tally.until', { when: words.moment(r.asOf) })}
              </p>
            )}
          </div>
          {r.items.length ? (
            <div className={own.scroll}>
              <table className={own.table}>
                <thead>
                  <tr>
                    <th>{t('owner.crm.col.supplier')}</th>
                    <th className={own.moneyCell}>{t('owner.crm.col.payable')}</th>
                    <th>{t('owner.crm.col.lastPurchase')}</th>
                    <th>{t('owner.crm.col.lastPaid')}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.items.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td className={own.moneyCell}>{bigMoney(row.payablePaise)}</td>
                      <td>{row.lastPurchaseOn ? dayLabel(row.lastPurchaseOn, language) : ''}</td>
                      <td>{row.lastPaymentOn ? dayLabel(row.lastPaymentOn, language) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={own.quiet}>{t('owner.crm.suppliers.empty')}</p>
          )}
        </section>
      )}
    </div>
  );
}

// ---- The page ---------------------------------------------------------------------------------
const reports: { id: string; word: MessageKey; needs: Permission; Body: () => React.ReactNode }[] =
  [
    { id: 'shaam', word: 'owner.crm.report.shaam', needs: 'reports.read', Body: ShaamReport },
    {
      id: 'vasooli',
      word: 'owner.crm.report.vasooli',
      needs: 'crm.vasooli.read',
      Body: VasooliReport,
    },
    { id: 'chup', word: 'owner.crm.report.chup', needs: 'crm.dormant.read', Body: QuietReport },
    { id: 'mahine', word: 'owner.crm.report.mahine', needs: 'reports.read', Body: MonthReport },
    {
      id: 'suppliers',
      word: 'owner.crm.report.suppliers',
      needs: 'tally.numbers.view',
      Body: SuppliersReport,
    },
  ];

export function HisaabPage() {
  const t = useT();
  const { can } = useOwner();
  const router = useRouter();
  const asked = useSearchParams().get('tab');
  const allowed = reports.filter((report) => can(report.needs));
  const current = allowed.find((report) => report.id === asked) ?? allowed[0];
  if (!current) return <NotYourPage />;
  const { Body } = current;
  return (
    <div className={own.page}>
      <PageHeader title={t(current.word)} back="/reports" />
      <div className={own.tabs} role="tablist" aria-label={t('owner.reports')}>
        {allowed.map((report) => (
          <Button
            key={report.id}
            role="tab"
            type="button"
            aria-selected={report.id === current.id}
            variant={report.id === current.id ? 'primary' : 'secondary'}
            onClick={() => router.replace(`/reports/hisaab?tab=${report.id}`)}
          >
            {t(report.word)}
          </Button>
        ))}
        <Link className={css.inlineLink} href="/calls">
          {t('owner.crm.todayCalls')} <span aria-hidden="true">→</span>
        </Link>
      </div>
      <Body />
    </div>
  );
}
