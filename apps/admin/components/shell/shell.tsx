'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  Banknote,
  BarChart3,
  BookOpen,
  CalendarCheck,
  CheckCircle,
  ClipboardList,
  Contact,
  FileText,
  History,
  Home,
  IndianRupee,
  Menu as MenuIcon,
  MessageCircle,
  Moon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  PhoneCall,
  Plus,
  Scale,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  SunMoon,
  Truck,
  Type,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Drawer, EmptyState, Kbd, Menu, Sheet } from '@shiv/design';
import { htmlLang, languages, type MessageKey } from '@shiv/i18n';
import { api } from '../../lib/api';
import {
  chooseAppearance,
  currentAppearance,
  type TextSize,
  type ThemeChoice,
} from '../../lib/appearance';
import { useChooseLanguage, useLanguage, useT } from '../../lib/i18n';
import { useOwner } from '../../lib/owner';
import { writeScope, readScope } from '../../lib/scope';
import {
  currentItem,
  plusActions,
  type Badge,
  type IconName,
  type NavGroup,
} from '../../lib/shell-nav';
import css from './shell.module.css';

const icons: Record<IconName, LucideIcon> = {
  home: Home,
  check: CheckCircle,
  orders: ClipboardList,
  list: FileText,
  truck: Truck,
  book: BookOpen,
  phone: PhoneCall,
  wallet: Wallet,
  chart: BarChart3,
  scale: Scale,
  package: Package,
  users: Users,
  calendar: CalendarCheck,
  banknote: Banknote,
  shield: ShieldCheck,
  rupee: IndianRupee,
  message: MessageCircle,
  settings: Settings,
  userCog: UserCog,
  contact: Contact,
  history: History,
  activity: Activity,
};

export type Counts = Record<Badge, number>;

function Count({ value }: { value: number }) {
  if (!value) return null;
  return (
    <span className={css.count} aria-label={String(value)}>
      {value > 99 ? '99+' : value}
    </span>
  );
}

const railKey = 'shiv-desk-rail';

/**
 * The laptop's grouped rail (plan v4 02, section 2): small-caps group labels, the page this person
 * is on marked, counts only where work waits, and a narrow icon-only mode that is remembered.
 */
export function Rail({ groups, counts }: { groups: NavGroup[]; counts: Counts }) {
  const t = useT();
  const path = usePathname();
  const { canOpen } = useOwner();
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    try {
      setNarrow(localStorage.getItem(railKey) === 'narrow');
    } catch {
      /* Keep this visit usable when browser storage is disabled. */
    }
  }, []);
  const flip = () => {
    setNarrow(!narrow);
    try {
      localStorage.setItem(railKey, narrow ? 'wide' : 'narrow');
    } catch {
      /* Keep this visit usable when browser storage is disabled. */
    }
  };
  // The page leaves room for the rail at its current width (owner.module.css, --rail-width).
  useEffect(() => {
    document.documentElement.dataset.rail = narrow ? 'narrow' : 'wide';
  }, [narrow]);
  const here = currentItem(path);
  return (
    <nav
      aria-label={t('owner.desk')}
      className={css.rail}
      data-narrow={narrow || undefined}
      data-owner-rail=""
    >
      <div className={css.railHead}>
        <Link href="/today" className={css.brand}>
          <img src="/icon-192.png" alt="" width="32" height="32" />
          <span className={css.railText}>{t('owner.deskName')}</span>
        </Link>
        <button
          type="button"
          className={css.railFlip}
          aria-label={t(narrow ? 'owner.shell.expand' : 'owner.shell.collapse')}
          aria-pressed={narrow}
          onClick={flip}
        >
          {narrow ? (
            <PanelLeftOpen size={18} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={18} aria-hidden="true" />
          )}
        </button>
      </div>
      {canOpen('/orders/new') && (
        <Link
          href="/orders/new"
          className={css.railNew}
          aria-current={path === '/orders/new' ? 'page' : undefined}
        >
          <Plus size={18} aria-hidden="true" />
          <span className={css.railText}>{t('owner.newOrder')}</span>
        </Link>
      )}
      {groups.map((group) => (
        <RailGroup key={group.id} group={group} here={here} counts={counts} />
      ))}
    </nav>
  );
}

function RailGroup({
  group,
  here,
  counts,
}: {
  group: NavGroup;
  here: string | null;
  counts: Counts;
}) {
  const t = useT();
  const id = useId();
  return (
    <div role="group" aria-labelledby={group.label ? id : undefined} className={css.railGroup}>
      {group.label && (
        <span id={id} className={css.groupLabel}>
          {t(group.label)}
        </span>
      )}
      <ul>
        {group.items.map((item) => {
          const Mark = icons[item.icon];
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                title={t(item.key)}
                aria-current={here === item.href ? 'page' : undefined}
                className={css.railLink}
              >
                <Mark size={18} aria-hidden="true" />
                <span className={css.railText}>{t(item.key)}</span>
                {item.badge && <Count value={counts[item.badge]} />}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Every shop, one firm, or one shop: the scope every page reads (`useShopScope`). */
export function ScopeSwitcher() {
  const t = useT();
  const { shops, firms, can, scope, setScope } = useOwner();
  // Only where this person works. Other shops exist, but there is nothing of theirs to narrow to.
  const mine = shops.filter(
    (shop) =>
      can('stock.read', shop.id) || can('orders.read', shop.id) || can('galla.read', shop.id),
  );
  if (!mine.length) return null;
  if (mine.length === 1)
    return (
      <span className={css.scopeLocked}>{t('owner.shell.yourShop', { shop: mine[0]!.name })}</span>
    );
  const byFirm =
    firms.length > 1
      ? firms
          .map((firm) => ({ firm, shops: mine.filter((shop) => shop.firmId === firm.id) }))
          .filter((row) => row.shops.length)
      : [];
  const loose = byFirm.length
    ? mine.filter((shop) => !byFirm.some((row) => row.shops.includes(shop)))
    : mine;
  return (
    <label className={css.scope}>
      <span>{t('owner.shell.shop')}</span>
      <select
        value={writeScope(scope)}
        onChange={(event) => setScope(readScope(event.target.value))}
      >
        <option value="">{t('owner.shell.allShops')}</option>
        {byFirm.map(({ firm, shops: inFirm }) => (
          <optgroup key={firm.id} label={firm.name}>
            <option value={`firm:${firm.id}`}>
              {t('owner.shell.firmAll', { firm: firm.name })}
            </option>
            {inFirm.map((shop) => (
              <option key={shop.id} value={`shop:${shop.id}`}>
                {shop.name}
              </option>
            ))}
          </optgroup>
        ))}
        {loose.map((shop) => (
          <option key={shop.id} value={`shop:${shop.id}`}>
            {shop.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The top bar's search (plan v4 02, section 3). B4a finds pages and actions on this desk; B4b adds
 * customers, orders, bills, goods and suppliers from the server.
 */
export function DeskSearch({ groups, onPick }: { groups: NavGroup[]; onPick?: () => void }) {
  const t = useT();
  const router = useRouter();
  const { canOpen } = useOwner();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const found = useMemo(() => {
    const typed = query.trim().toLowerCase();
    const pages = groups.flatMap((group) =>
      group.items.map((item) => ({ href: item.href, label: t(item.key), kind: 'page' as const })),
    );
    const actions = plusActions
      .filter((action) => canOpen(action.needs))
      .map((action) => ({ href: action.href, label: t(action.key), kind: 'action' as const }));
    const all = [...actions, ...pages];
    return typed ? all.filter((item) => item.label.toLowerCase().includes(typed)).slice(0, 8) : [];
  }, [query, groups, t, canOpen]);
  useEffect(() => {
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
  }, []);
  const go = (href: string) => {
    setQuery('');
    setOpen(false);
    onPick?.();
    router.push(href);
  };
  return (
    <div className={css.search} role="search">
      <label htmlFor={`${listId}-input`} className={css.hidden}>
        {t('owner.shell.searchLabel')}
      </label>
      <input
        ref={input}
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={open && !!query.trim()}
        aria-controls={listId}
        aria-activedescendant={open && found[active] ? `${listId}-${active}` : undefined}
        aria-keyshortcuts="/"
        autoComplete="off"
        placeholder={t('owner.shell.search')}
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((at) => Math.min(found.length - 1, at + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((at) => Math.max(0, at - 1));
          } else if (event.key === 'Enter' && found[active]) {
            event.preventDefault();
            go(found[active].href);
          } else if (event.key === 'Escape') {
            setQuery('');
            input.current?.blur();
          }
        }}
      />
      {open && query.trim() && (
        <div className={css.results}>
          <ul id={listId} role="listbox" aria-label={t('owner.shell.searchLabel')}>
            {found.map((item, index) => (
              <li
                key={item.href}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={css.result}
                onMouseDown={(event) => {
                  event.preventDefault();
                  go(item.href);
                }}
              >
                <span>{item.label}</span>
                <span className={css.resultKind}>
                  {t(
                    item.kind === 'page' ? 'owner.shell.searchPages' : 'owner.shell.searchActions',
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className={css.soon}>{t('owner.shell.searchSoon')}</p>
        </div>
      )}
    </div>
  );
}

const themes: ThemeChoice[] = ['auto', 'light', 'dark'];
const sizes: TextSize[] = ['normal', 'large', 'larger'];

/** Theme, language and "Bada akshar", each saved for the person (B1, B2). */
export function LookControls({ words = false }: { words?: boolean }) {
  const t = useT();
  const { notice } = useOwner();
  const { language } = useLanguage();
  const choose = useChooseLanguage();
  const [look, setLook] = useState<{ theme: ThemeChoice; textSize: TextSize }>({
    theme: 'auto',
    textSize: 'normal',
  });
  useEffect(() => setLook(currentAppearance()), []);
  const save = (next: { theme?: ThemeChoice; textSize?: TextSize }) => {
    setLook((was) => ({ ...was, ...next }));
    chooseAppearance(next).catch(() => notice(t('owner.appearance.notSaved'), true));
  };
  const ThemeMark = look.theme === 'dark' ? Moon : look.theme === 'light' ? Sun : SunMoon;
  return (
    <>
      <Menu
        label={t('owner.shell.theme', { choice: t(`owner.appearance.theme.${look.theme}`) })}
        icon={words ? undefined : <ThemeMark size={18} />}
        variant={words ? 'secondary' : 'quiet'}
        items={themes.map((theme) => ({
          label: `${look.theme === theme ? '✓ ' : ''}${t(`owner.appearance.theme.${theme}`)}`,
          onSelect: () => save({ theme }),
        }))}
      />
      <Menu
        label={t('owner.shell.textSize', {
          choice: t(`owner.appearance.textSize.${look.textSize}`),
        })}
        icon={words ? undefined : <Type size={18} />}
        variant={words ? 'secondary' : 'quiet'}
        items={sizes.map((textSize) => ({
          label: `${look.textSize === textSize ? '✓ ' : ''}${t(`owner.appearance.textSize.${textSize}`)}`,
          onSelect: () => save({ textSize }),
        }))}
      />
      <Menu
        label={t('owner.shell.language', { choice: t(`language.${language}`) })}
        icon={
          words ? undefined : (
            <span lang={htmlLang(language)} className={css.langMark}>
              {language === 'en' ? 'En' : language === 'hi' ? 'हि' : 'Hi'}
            </span>
          )
        }
        variant={words ? 'secondary' : 'quiet'}
        items={languages.map((value) => ({
          label: `${language === value ? '✓ ' : ''}${t(`language.${value}`)}`,
          onSelect: () =>
            void choose(value).catch(() => notice(t('owner.appearance.notSaved'), true)),
        }))}
      />
    </>
  );
}

/** The person menu: who is signed in, the shortcuts, and sign out. */
export function PersonMenu() {
  const t = useT();
  const { me, endSession } = useOwner();
  const [keys, setKeys] = useState(false);
  return (
    <>
      <Menu
        label={t('owner.shell.account')}
        icon={<span className={css.initials}>{(me.name || me.phone).trim().slice(0, 2)}</span>}
        variant="quiet"
        items={[
          { label: t('owner.shell.shortcuts'), onSelect: () => setKeys(true) },
          {
            label: t('owner.logout'),
            onSelect: () => void api('/auth/logout', 'POST').finally(endSession),
            danger: true,
          },
        ]}
      />
      {keys && (
        <Sheet
          title={t('owner.shell.shortcuts')}
          closeLabel={t('owner.close')}
          onClose={() => setKeys(false)}
        >
          <dl className={css.keys}>
            {(
              [
                ['/', 'owner.shell.key.search'],
                ['M', 'owner.shell.key.saathi'],
                ['N', 'owner.shell.key.new'],
                ['Esc', 'owner.shell.key.close'],
              ] as [string, MessageKey][]
            ).map(([key, words]) => (
              <div key={key}>
                <dt>
                  <Kbd>{key}</Kbd>
                </dt>
                <dd>{t(words)}</dd>
              </div>
            ))}
          </dl>
        </Sheet>
      )}
    </>
  );
}

/** Saathi's panel. Its answers arrive in E2; until then it says what it will do. */
export function SaathiPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Drawer open={open} title={t('owner.shell.saathi')} onClose={onClose}>
      <EmptyState
        icon={<Sparkles size={24} />}
        title={t('owner.shell.saathi')}
        body={t('owner.shell.saathiSoon')}
      />
    </Drawer>
  );
}

/** The [+] sheet on a phone: the day's starting actions in one place. */
export function PlusSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { canOpen } = useOwner();
  return (
    <Sheet title={t('owner.shell.plusTitle')} closeLabel={t('owner.close')} onClose={onClose}>
      <ul className={css.plusList}>
        {plusActions
          .filter((action) => canOpen(action.needs))
          .map((action) => (
            <li key={action.href}>
              <Link href={action.href} onClick={onClose}>
                <Plus size={20} aria-hidden="true" />
                {t(action.key)}
              </Link>
            </li>
          ))}
      </ul>
    </Sheet>
  );
}

/** A phone's five tabs: Aaj · Pakka karo · [+] · Saathi · Menu (plan v4 02, section 2). */
export function PhoneTabs({
  counts,
  onPlus,
  onSaathi,
}: {
  counts: Counts;
  onPlus: () => void;
  onSaathi: () => void;
}) {
  const t = useT();
  const path = usePathname();
  const { canOpen } = useOwner();
  const here = currentItem(path);
  const tab = (href: string, key: MessageKey, Mark: LucideIcon, count = 0) =>
    canOpen(href) ? (
      <Link
        href={href}
        className={css.tab}
        aria-current={here === href || path === href ? 'page' : undefined}
      >
        <Mark size={22} aria-hidden="true" />
        <span>{t(key)}</span>
        <Count value={count} />
      </Link>
    ) : null;
  return (
    <nav aria-label={t('owner.desk')} className={css.tabs} data-owner-tabs="">
      {tab('/today', 'owner.today', Home)}
      {tab('/inbox', 'owner.pakka.title', CheckCircle, counts.waiting)}
      {canOpen('/orders/new') && (
        <button
          type="button"
          className={`${css.tab} ${css.plus}`}
          onClick={onPlus}
          aria-haspopup="dialog"
        >
          <Plus size={26} aria-hidden="true" />
          <span>{t('owner.shell.plus')}</span>
        </button>
      )}
      <button type="button" className={css.tab} onClick={onSaathi} aria-haspopup="dialog">
        <Sparkles size={22} aria-hidden="true" />
        <span>{t('owner.shell.saathi')}</span>
      </button>
      <Link href="/more" className={css.tab} aria-current={path === '/more' ? 'page' : undefined}>
        <MenuIcon size={22} aria-hidden="true" />
        <span>{t('owner.shell.menu')}</span>
        <Count value={counts.reviews} />
      </Link>
    </nav>
  );
}

/** The laptop's top bar: search in the middle, then scope, Saathi, look and the person menu. */
export function TopBar({ groups, onSaathi }: { groups: NavGroup[]; onSaathi: () => void }) {
  const t = useT();
  return (
    <header className={css.top}>
      <Link href="/today" className={`${css.brand} ${css.phoneOnly}`}>
        <img src="/icon-192.png" alt="" width="32" height="32" />
        <span>{t('owner.deskName')}</span>
      </Link>
      <div className={css.wideOnly}>
        <DeskSearch groups={groups} />
      </div>
      <div className={css.topEnd}>
        <ScopeSwitcher />
        <div className={css.wideOnly}>
          <button type="button" className={css.saathi} onClick={onSaathi} aria-keyshortcuts="M">
            <Sparkles size={18} aria-hidden="true" />
            {t('owner.shell.saathi')}
          </button>
          <LookControls />
          <PersonMenu />
        </div>
      </div>
    </header>
  );
}
