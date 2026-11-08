'use client';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { MoneyText } from '@shiv/design';
import { searchKey, type SearchResponse } from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { keyFor, searchEndpoint } from '../../lib/endpoints';
import { useT } from '../../lib/i18n';
import { readRecent, remember, type Recent } from '../../lib/recent';
import { useDebounced, useOwner, useShopScope } from '../../lib/owner';
import { plusActions, type NavGroup } from '../../lib/shell-nav';
import { Status } from '../owner/common';
import css from './shell.module.css';

/*
 * The top bar's search (plan v4, 02 section 3). Customers, orders and goods come from the server
 * (`GET admin/search`), each group only when this person may read it; actions and pages come from
 * the desk's own list. With the box empty it shows what was opened from it lately.
 */

type Group = 'recent' | 'customers' | 'orders' | 'products' | 'actions' | 'pages';
type Hit = {
  key: string;
  group: Group;
  href: string;
  label: string;
  detail?: ReactNode;
  trailing?: ReactNode;
  /** What to remember when it is opened; only server results are remembered. */
  remember?: Recent;
};

const groupWords: Record<Group, MessageKey> = {
  recent: 'owner.shell.searchRecent',
  customers: 'owner.shell.searchCustomers',
  orders: 'owner.shell.searchOrders',
  products: 'owner.shell.searchGoods',
  actions: 'owner.shell.searchActions',
  pages: 'owner.shell.searchPages',
};

export function DeskSearch({
  groups,
  onPick,
  inline = false,
  pages = true,
  onQuery,
}: {
  groups: NavGroup[];
  onPick?: () => void;
  /**
   * The phone's Menu: results sit under the box and push the page down instead of floating, and
   * pages are left to the Menu's own list (which `onQuery` filters).
   */
  inline?: boolean;
  pages?: boolean;
  onQuery?: (typed: string) => void;
}) {
  const t = useT();
  const router = useRouter();
  const { canOpen, me, shops } = useOwner();
  const { params } = useShopScope();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<Recent[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const typed = query.trim().slice(0, 100);
  const asked = useDebounced(typed, 200);
  const request = { q: asked, ...params };
  const server = useQuery({
    queryKey: keyFor(searchEndpoint, request),
    queryFn: () => searchEndpoint.fetch(request),
    enabled: asked.length >= 2,
    staleTime: 15000,
    retry: false,
    // While the next answer loads, the last one stays, so the list does not flash empty.
    placeholderData: (previous) => previous,
  });
  const answer = typed.length >= 2 ? server.data : undefined;
  const shopName = (id: string) => shops.find((shop) => shop.id === id)?.name ?? id;

  const hits = useMemo<Hit[]>(() => {
    if (!typed)
      return recent.map((row) => ({
        key: `recent:${row.href}`,
        group: 'recent',
        href: row.href,
        label: row.label,
        detail: t(groupWords[row.group]),
        remember: row,
      }));
    const words = searchKey(typed);
    const matches = (label: string) => {
      const target = searchKey(label).join(' ');
      return words.every((word) => target.includes(word));
    };
    const choices = pages
      ? [
          ...plusActions
            .filter((action) => canOpen(action.needs))
            .map((action) => ({
              href: action.href,
              label: t(action.key),
              group: 'actions' as const,
            })),
          ...groups.flatMap((group) =>
            group.items.map((item) => ({
              href: item.href,
              label: t(item.key),
              group: 'pages' as const,
            })),
          ),
        ]
      : [];
    const local: Hit[] = choices
      .filter((item) => matches(item.label))
      .slice(0, 6)
      .map((item) => ({ ...item, key: `${item.group}:${item.href}` }));
    return [...serverHits(answer, { canOpen, shopName, t }), ...local];
    // shopName reads shops, which the list depends on.
  }, [typed, recent, answer, groups, t, canOpen, shops, pages]);

  useEffect(() => {
    // The top bar's box answers "/"; the Menu's is on a phone, which has no keyboard shortcuts.
    if (inline) return;
    const press = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
        return;
      event.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', press);
    return () => document.removeEventListener('keydown', press);
  }, [inline]);
  useEffect(() => setActive((at) => Math.min(at, Math.max(0, hits.length - 1))), [hits.length]);

  const go = (hit: Hit) => {
    if (hit.remember) remember(me.id, hit.remember);
    setQuery('');
    onQuery?.('');
    setOpen(false);
    onPick?.();
    router.push(hit.href);
  };
  const searching = typed.length >= 2 && (asked !== typed || server.isFetching);
  const failed = typed.length >= 2 && server.isError && !server.isFetching;
  const nothing =
    typed.length >= 2 && !searching && !failed && answer?.query === typed && !hits.length;
  // Inline results stay while something is typed, so a tap on a phone does not lose them.
  const showing = (open || (inline && !!typed)) && (!!typed || hits.length > 0);
  const byGroup = (Object.keys(groupWords) as Group[])
    .map((group) => ({ group, items: hits.filter((hit) => hit.group === group) }))
    .filter((row) => row.items.length);

  return (
    <div className={inline ? css.searchInline : css.search} role="search">
      <label htmlFor={`${listId}-input`} className={css.hidden}>
        {t('owner.shell.searchLabel')}
      </label>
      <input
        ref={input}
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing && hits[active] ? `${listId}-${active}` : undefined}
        aria-keyshortcuts={inline ? undefined : '/'}
        autoComplete="off"
        maxLength={100}
        placeholder={t('owner.shell.search')}
        value={query}
        onFocus={() => {
          setRecent(readRecent(me.id));
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(event) => {
          setQuery(event.target.value);
          onQuery?.(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActive((at) => Math.min(hits.length - 1, at + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((at) => Math.max(0, at - 1));
          } else if (event.key === 'Enter' && showing && hits[active]) {
            event.preventDefault();
            go(hits[active]);
          } else if (event.key === 'Escape') {
            setQuery('');
            onQuery?.('');
            input.current?.blur();
          }
        }}
      />
      {showing && (
        <div className={inline ? css.resultsInline : css.results}>
          <div id={listId} role="listbox" aria-label={t('owner.shell.searchLabel')}>
            {byGroup.map(({ group, items }) => (
              <div key={group} role="group" aria-label={t(groupWords[group])}>
                <div className={css.resultGroup} aria-hidden="true">
                  {t(groupWords[group])}
                </div>
                {items.map((hit) => {
                  const index = hits.indexOf(hit);
                  return (
                    <div
                      key={hit.key}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={index === active}
                      className={css.result}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        go(hit);
                      }}
                    >
                      <span className={css.resultText}>
                        <span className={css.resultLabel}>{hit.label}</span>
                        {hit.detail && <span className={css.resultKind}>{hit.detail}</span>}
                      </span>
                      {hit.trailing}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <p className={css.soon} role="status">
            {failed
              ? t('owner.shell.searchFailed')
              : searching
                ? t('owner.shell.searchLoading')
                : nothing
                  ? t('owner.shell.searchNone', { q: typed })
                  : ''}
          </p>
        </div>
      )}
    </div>
  );
}

/** The server's groups as rows, each only when its page may be opened. */
function serverHits(
  answer: SearchResponse | undefined,
  {
    canOpen,
    shopName,
    t,
  }: {
    canOpen: (route: string) => boolean;
    shopName: (id: string) => string;
    t: ReturnType<typeof useT>;
  },
): Hit[] {
  if (!answer) return [];
  const customers: Hit[] = canOpen('/customers')
    ? (answer.customers ?? []).map((row) => {
        const href = `/customers/${row.id}`;
        const label = row.name || row.phone;
        return {
          key: `customer:${row.id}`,
          group: 'customers',
          href,
          label,
          detail: [row.phone, row.area].filter(Boolean).join(' · '),
          trailing:
            row.balancePaise !== null && row.balancePaise !== 0 ? (
              <MoneyText value={row.balancePaise} signed />
            ) : undefined,
          remember: { href, label, group: 'customers' },
        };
      })
    : [];
  const orders: Hit[] = canOpen('/orders')
    ? (answer.orders ?? []).map((row) => {
        const href = `/orders/${row.id}`;
        return {
          key: `order:${row.id}`,
          group: 'orders',
          href,
          label: row.number,
          detail: [row.customerName, shopName(row.locationId)].filter(Boolean).join(' · '),
          trailing: <Status value={row.status} />,
          remember: { href, label: row.number, group: 'orders' },
        };
      })
    : [];
  const products: Hit[] = canOpen('/stock')
    ? (answer.products ?? []).map((row) => {
        const href = `/stock?product=${row.id}`;
        const stock = row.stock
          .map((level) => {
            const amount =
              level.quantity === null
                ? t(level.low ? 'owner.shell.searchOut' : 'owner.shell.searchIn')
                : String(level.quantity);
            const low =
              level.quantity !== null && level.low ? ` ${t('owner.shell.searchLow')}` : '';
            return `${shopName(level.locationId)} ${amount}${low}`;
          })
          .join(' · ');
        return {
          key: `product:${row.id}`,
          group: 'products',
          href,
          label: row.name,
          detail: [
            [row.brand, row.unit].filter(Boolean).join(' · '),
            stock && t('owner.shell.searchStock', { shops: stock }),
          ]
            .filter(Boolean)
            .join(' — '),
          remember: { href, label: row.name, group: 'products' },
        };
      })
    : [];
  return [...customers, ...orders, ...products];
}
