import type { MessageKey } from '@shiv/i18n';
import type { Access } from '@shiv/shared';
import { pathAllowed } from './nav';

/**
 * The desk's navigation (plan v4 02, section 2): six groups instead of 24 flat links. Only pages
 * that exist are listed; Turant bill, Vasooli, Kharid and Transfer join their groups when their
 * phases build them. Pages that will merge (Hazri and Salary into Staff, Aaj ke call into Udhaar,
 * Trip into Order) keep their own item until then: see `routeMoves` below.
 */
export type IconName =
  | 'home'
  | 'check'
  | 'orders'
  | 'list'
  | 'truck'
  | 'book'
  | 'phone'
  | 'wallet'
  | 'chart'
  | 'scale'
  | 'package'
  | 'users'
  | 'calendar'
  | 'banknote'
  | 'shield'
  | 'rupee'
  | 'message'
  | 'settings'
  | 'userCog'
  | 'contact'
  | 'history'
  | 'activity';
export type Badge = 'waiting' | 'reviews';
export type NavItem = { href: string; key: MessageKey; icon: IconName; badge?: Badge };
export type NavGroup = { id: string; label?: MessageKey; items: NavItem[] };

export const navGroups: readonly NavGroup[] = [
  { id: 'top', items: [{ href: '/today', key: 'owner.today', icon: 'home' }] },
  {
    id: 'bikri',
    label: 'owner.nav.bikri',
    items: [
      { href: '/inbox', key: 'owner.pakka.title', icon: 'check', badge: 'waiting' },
      { href: '/orders', key: 'owner.orders', icon: 'orders' },
      { href: '/lists', key: 'owner.lists.title', icon: 'list' },
      { href: '/trips', key: 'owner.trips.title', icon: 'truck' },
    ],
  },
  {
    id: 'paisa',
    label: 'owner.nav.paisa',
    items: [
      { href: '/udhaar', key: 'owner.khata', icon: 'book' },
      { href: '/calls', key: 'owner.crm.todayCalls', icon: 'phone' },
      { href: '/galla', key: 'owner.galla.title', icon: 'wallet' },
      { href: '/reports', key: 'owner.reports', icon: 'chart' },
      { href: '/tally', key: 'owner.tally.nav', icon: 'scale' },
    ],
  },
  {
    id: 'maal',
    label: 'owner.nav.maal',
    items: [{ href: '/stock', key: 'owner.stock', icon: 'package' }],
  },
  {
    id: 'log',
    label: 'owner.nav.log',
    items: [
      { href: '/customers', key: 'owner.customers', icon: 'users' },
      { href: '/hazri', key: 'owner.hazri.title', icon: 'calendar', badge: 'reviews' },
      { href: '/salary', key: 'owner.salary.title', icon: 'banknote' },
      { href: '/manzoori', key: 'owner.manzoori.title', icon: 'shield' },
    ],
  },
  {
    id: 'setup',
    label: 'owner.nav.setup',
    items: [
      { href: '/rates', key: 'owner.rates.nav', icon: 'rupee' },
      { href: '/whatsapp', key: 'owner.whatsappReading', icon: 'message' },
      { href: '/settings', key: 'owner.settings.title', icon: 'settings' },
      { href: '/users', key: 'owner.people', icon: 'userCog' },
      { href: '/staff', key: 'owner.staff', icon: 'contact' },
      { href: '/activity', key: 'owner.activity', icon: 'history' },
      { href: '/system', key: 'owner.system.title', icon: 'activity' },
    ],
  },
];

/** The groups and items that pass `open`. A group with nothing left is not shown. */
export function groupsWhere(open: (path: string) => boolean): NavGroup[] {
  return navGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => open(item.href)) }))
    .filter((group) => group.items.length > 0);
}

/** The groups and items this person may open. */
export function visibleGroups(access: Access): NavGroup[] {
  return groupsWhere((path) => pathAllowed(access, path));
}

/** Which item a page belongs to: the longest matching route, so /orders/123 is Order. */
export function currentItem(path: string): string | null {
  let best: string | null = null;
  for (const group of navGroups)
    for (const { href } of group.items)
      if ((path === href || path.startsWith(`${href}/`)) && (!best || href.length > best.length))
        best = href;
  return best;
}

/** The phone's five tabs (plan v4 02, section 2): Aaj · Pakka karo · [+] · Saathi · Menu. */
export const phoneTabs = ['/today', '/inbox', 'plus', 'saathi', '/more'] as const;

/** What the [+] sheet offers today. Turant bill, Maal aaya, Vasooli and Paisa liya join it later. */
export const plusActions: readonly { href: string; key: MessageKey; needs: string }[] = [
  { href: '/orders/new', key: 'owner.phoneOrder', needs: '/orders/new' },
  { href: '/orders/new?source=WALK_IN', key: 'owner.walkIn', needs: '/orders/new' },
];

/**
 * Where every page and tab of the old desk goes (plan v4 02, section 8). `now` moves redirect
 * today; a `later` move keeps its page where it is until the phase named builds its new home, so
 * no link ever lands on a page that does not exist yet.
 */
export type RouteMove = { from: string; to: string; now: boolean; phase?: string; note?: string };
export const routeMoves: readonly RouteMove[] = [
  { from: '/khata', to: '/udhaar', now: true },
  { from: '/more', to: '/today', now: true, note: 'On a laptop. On a phone /more is the Menu.' },
  { from: '/more?view=users', to: '/users', now: true },
  { from: '/more?view=store', to: '/settings', now: true },
  { from: '/more?view=zones', to: '/settings', now: true },
  { from: '/more?view=devices', to: '/settings', now: true },
  { from: '/more?view=language', to: '/settings', now: true },
  { from: '/more?view=activity', to: '/activity', now: true },
  { from: '/more?view=reports', to: '/reports', now: true },
  { from: '/more?view=quotes', to: '/lists', now: true },
  { from: '/more?view=rates', to: '/rates', now: true },
  { from: '/more?view=products', to: '/stock?tab=maal', now: true },
  { from: '/more?view=staff', to: '/staff', now: true },
  { from: '/more?view=whatsapp', to: '/whatsapp', now: true },
  { from: '/calls', to: '/udhaar?tab=calls', now: false, phase: 'C3' },
  { from: '/udhaar/opening', to: '/udhaar (its menu)', now: false, phase: 'C3' },
  { from: '/trips', to: '/orders?tab=gaadi', now: false, phase: 'C4' },
  { from: '/users', to: '/settings?section=log', now: false, phase: 'C5' },
  { from: '/staff', to: '/settings?section=alert', now: false, phase: 'C5' },
  { from: '/hazri', to: '/staff?tab=hazri', now: false, phase: 'C6' },
  { from: '/salary', to: '/staff?tab=salary', now: false, phase: 'C6' },
  { from: '/reports/hisaab', to: '/reports (its tabs)', now: false, phase: 'C7' },
  {
    from: '/stock?tab=…',
    to: '/stock, /transfers, Stock menu → Ginti, Settings → Maal ki list',
    now: false,
    phase: 'C2',
  },
];
