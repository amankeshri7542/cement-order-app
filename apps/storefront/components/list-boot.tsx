'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { API_URL } from '../lib/api';
import { rupees } from '../lib/format';
import { readCompare, toggleCompare } from '../lib/compare';
import { drain, list, readLine, SIGNED_IN_KEY, type QueuedTap } from '../lib/list-store';
import { waText } from '../lib/whatsapp';

type Win = typeof window & { __listQ?: QueuedTap[]; __listOn?: boolean };
const all = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<T>(selector));

/** Puts the list on the page: counts, Add and steppers, the slip and WhatsApp links. */
function paint() {
  const { lines } = list.snapshot();
  const quantities = new Map(lines.map((line) => [line.i, line.q]));
  const root = document.documentElement;
  if (lines.length) root.setAttribute('data-list-has', '');
  else root.removeAttribute('data-list-has');
  for (const el of all('[data-list-count]')) {
    if (el.textContent !== String(lines.length)) {
      el.textContent = String(lines.length);
      el.parentElement?.animate?.([{ transform: 'scale(1.5)' }, { transform: 'scale(1)' }], {
        duration: 260,
        easing: 'cubic-bezier(.22,1,.36,1)',
      });
    }
  }
  for (const owner of all('[data-line]')) {
    const qty = quantities.get(owner.dataset.id ?? '') ?? 0;
    for (const button of all('[data-add]', owner))
      button.setAttribute('aria-pressed', qty ? 'true' : 'false');
    for (const out of all('[data-qty-out]', owner)) out.textContent = String(qty);
    for (const less of all<HTMLButtonElement>('[data-step="-1"]', owner)) less.disabled = !qty;
  }
  const text = waText.list(lines.map((line) => ({ name: line.n, unit: line.u, qty: line.q })));
  for (const link of all<HTMLAnchorElement>('[data-wa-list]')) {
    const base = link.dataset.waList ?? '';
    if (lines.length) link.href = `${base}?text=${encodeURIComponent(text)}`;
    else link.href = base;
    link.hidden = false;
  }
  for (const label of all('[data-wa-count]'))
    label.textContent = lines.length
      ? `Send my list of ${lines.length} on WhatsApp`
      : (label.dataset.waCount ?? 'Open WhatsApp');
  for (const slip of all('[data-slip]')) {
    const box = slip.querySelector('[data-slip-lines]');
    if (!box) continue;
    box.replaceChildren(
      ...lines.map((line) => {
        const row = document.createElement('li');
        const left = document.createElement('span');
        left.textContent = `${line.q} × ${line.n}`;
        const right = document.createElement('span');
        right.textContent = line.r === null ? 'Ask for the rate' : rupees(line.r * line.q);
        row.append(left, right);
        return row;
      }),
    );
    const priced = lines.filter((line) => line.r !== null);
    const sum = priced.reduce((total, line) => total + line.r! * line.q, 0);
    (slip.querySelector('[data-slip-empty]') as HTMLElement | null)?.toggleAttribute(
      'hidden',
      lines.length > 0,
    );
    (slip.querySelector('[data-slip-total]') as HTMLElement | null)?.toggleAttribute(
      'hidden',
      !priced.length,
    );
    const total = slip.querySelector('[data-slip-sum]');
    if (total) total.textContent = priced.length ? rupees(sum) : '';
    (slip.querySelector('[data-slip-actions]') as HTMLElement | null)?.toggleAttribute(
      'hidden',
      !lines.length,
    );
  }
}

function paintCompare() {
  const chosen = readCompare();
  for (const button of all('[data-compare]')) {
    const on = chosen.includes(button.dataset.compare ?? '');
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.textContent = on
      ? `Comparing (${chosen.length}${chosen.length > 1 ? ', open below' : ''})`
      : 'Compare';
  }
  for (const link of all('[data-compare-open]')) link.hidden = chosen.length < 2;
}

function onClick(event: MouseEvent) {
  const target = event.target as Element | null;
  const close = target?.closest?.('[data-close-dialog]');
  if (close) {
    close.closest('dialog')?.close();
    return;
  }
  const opener = target?.closest?.<HTMLElement>('[data-choose]');
  if (opener) {
    const dialog = document.getElementById(`choose-${opener.dataset.choose}`);
    if (dialog instanceof HTMLDialogElement) {
      event.preventDefault();
      dialog.showModal();
    }
    return;
  }
  const compare = target?.closest?.<HTMLElement>('[data-compare]');
  if (compare) {
    toggleCompare(compare.dataset.compare ?? '');
    paintCompare();
    return;
  }
  const button = target?.closest?.<HTMLElement>('[data-add],[data-step]');
  if (!button) return;
  const input = readLine(button.closest('[data-line]')?.getAttribute('data-line') ?? null);
  if (!input) return;
  if (button.hasAttribute('data-step'))
    list.step(input, button.getAttribute('data-step') === '-1' ? -1 : 1);
  else list.toggle(input);
  void track('added');
}

function track(name: string) {
  try {
    navigator.sendBeacon?.('/api/e', JSON.stringify({ name, path: location.pathname }));
  } catch {
    /* A lost signal costs nothing. */
  }
}

/**
 * A signed-in customer sees their own rate on public pages. A stored hint decides if we ask, so a
 * guest's page never calls the API at load. The answer is theirs alone and is never stored.
 */
async function showYourRates() {
  let signedIn = false;
  try {
    signedIn = localStorage.getItem(SIGNED_IN_KEY) === '1';
  } catch {
    /* Treated as a guest. */
  }
  const spots = all('[data-your-rate]');
  if (!signedIn || !spots.length) return;
  const ask = () => fetch(`${API_URL}/me/rates`, { credentials: 'include', cache: 'no-store' });
  try {
    let response = await ask();
    if (response.status === 401) {
      const renewed = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!renewed.ok) {
        localStorage.removeItem(SIGNED_IN_KEY);
        return;
      }
      response = await ask();
    }
    if (!response.ok) return;
    const rates = (await response.json()) as {
      productId: string;
      listPaise: number;
      yourPaise: number;
    }[];
    if (!Array.isArray(rates)) return;
    const yours = new Map(rates.map((rate) => [rate.productId, rate]));
    for (const spot of spots) {
      const rate = yours.get(spot.dataset.yourRate ?? '');
      if (
        rate &&
        Number.isSafeInteger(rate.yourPaise) &&
        rate.yourPaise > 0 &&
        rate.yourPaise < rate.listPaise
      ) {
        spot.textContent = `Your rate ${rupees(rate.yourPaise)}`;
        spot.hidden = false;
      } else spot.hidden = true;
    }
  } catch {
    /* The public rate stays on the page. */
  }
}

/** Header state a static header cannot know: where we are, and whether a page is on its way. */
function markPage(pathname: string) {
  for (const link of all<HTMLAnchorElement>('[data-nav-links] a')) {
    const path = new URL(link.href).pathname;
    if (pathname === path || pathname.startsWith(`${path}/`))
      link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.querySelector('[data-menu]')?.removeAttribute('open');
  document.documentElement.removeAttribute('data-nav-pending');
}
let pendingTimer: ReturnType<typeof setTimeout> | undefined;
function onNavigate(event: MouseEvent) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a[href^="/"]');
  if (!link || link.target) return;
  if (new URL(link.href).pathname === location.pathname) return;
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(
    () => document.documentElement.setAttribute('data-nav-pending', ''),
    200,
  );
}

export function ListBoot() {
  const pathname = usePathname();
  useEffect(() => {
    const win = window as Win;
    win.__listOn = true;
    drain(win.__listQ ?? []);
    const unsubscribe = list.subscribe(paint);
    // Before React's handler: a chooser opened from a link must not also follow the link.
    document.addEventListener('click', onClick, true);
    document.addEventListener('click', onNavigate);
    return () => {
      win.__listOn = false;
      unsubscribe();
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('click', onNavigate);
    };
  }, []);
  // Each new page brings new rows to fill in.
  useEffect(() => {
    clearTimeout(pendingTimer);
    markPage(pathname);
    paint();
    paintCompare();
    void showYourRates();
  }, [pathname]);
  return null;
}
