// Where the customer is, as plain data: a tab, screens pushed over it, and sheets over those. All
// four tabs stay mounted, so Ask keeps its conversation and every list keeps its place. Plain logic,
// unit-tested under Node.

export const tabs = ['home', 'ask', 'orders', 'account'] as const;
export type Tab = (typeof tabs)[number];

export type Route =
  | { screen: 'product'; id: string }
  | { screen: 'search' }
  | { screen: 'order'; id: string }
  | { screen: 'reply'; id: string }
  | { screen: 'udhaar' }
  | { screen: 'people' }
  | { screen: 'sites' }
  | { screen: 'article'; slug: string };

export type SheetRoute =
  | { sheet: 'list'; repeat?: string }
  | { sheet: 'sites-picker'; purpose: 'panel' | 'browse' }
  | { sheet: 'site-form'; id?: string; purpose?: 'panel' | 'browse' }
  | { sheet: 'day' }
  | { sheet: 'sign-in' }
  | { sheet: 'pincode' }
  | { sheet: 'ask-shop' };

export type Nav = { tab: Tab; stack: Route[]; sheets: SheetRoute[] };
export const startNav = (): Nav => ({ tab: 'home', stack: [], sheets: [] });

const key = (route: Route) => JSON.stringify(route);

/** Opening what is already on top does nothing, so a double tap never stacks two copies. */
export function pushRoute(nav: Nav, route: Route): Nav {
  const top = nav.stack.at(-1);
  if (top && key(top) === key(route)) return nav;
  return { ...nav, stack: [...nav.stack, route].slice(-12) };
}

export function openTab(nav: Nav, tab: Tab): Nav {
  return { ...nav, tab, stack: [] };
}

export function openSheet(nav: Nav, sheet: SheetRoute): Nav {
  const top = nav.sheets.at(-1);
  if (top && JSON.stringify(top) === JSON.stringify(sheet)) return nav;
  return { ...nav, sheets: [...nav.sheets, sheet].slice(-3) };
}

export function closeSheet(nav: Nav, sheet?: SheetRoute['sheet']): Nav {
  if (!nav.sheets.length) return nav;
  if (!sheet) return { ...nav, sheets: nav.sheets.slice(0, -1) };
  return { ...nav, sheets: nav.sheets.filter((item) => item.sheet !== sheet) };
}

/**
 * The back button: closes a sheet, pops a screen, then returns to Home, then lets the app exit.
 * Null means there is nowhere left to go.
 */
export function backFrom(nav: Nav): Nav | null {
  if (nav.sheets.length) return { ...nav, sheets: nav.sheets.slice(0, -1) };
  if (nav.stack.length) return { ...nav, stack: nav.stack.slice(0, -1) };
  if (nav.tab !== 'home') return { ...nav, tab: 'home' };
  return null;
}

const screensWithId = ['product', 'order', 'reply'] as const;
const plainScreens = ['search', 'udhaar', 'people', 'sites'] as const;

/** Reads a browser address: "#/order/abc", "#/orders". Anything else opens Home. */
export function navFromHash(hash: string): Nav {
  const [first, second] = hash
    .replace(/^#\/?/, '')
    .split('?')[0]!
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return '';
      }
    });
  const start = startNav();
  if (!first) return start;
  if ((tabs as readonly string[]).includes(first)) return { ...start, tab: first as Tab };
  if ((screensWithId as readonly string[]).includes(first) && second && validId(second))
    return { ...start, stack: [{ screen: first, id: second } as Route] };
  if ((plainScreens as readonly string[]).includes(first))
    return { ...start, stack: [{ screen: first } as Route] };
  if (first === 'article' && second && validId(second))
    return { ...start, stack: [{ screen: 'article', slug: second }] };
  return start;
}

export function hashFromNav(nav: Nav): string {
  const top = nav.stack.at(-1);
  if (!top) return nav.tab === 'home' ? '#/' : `#/${nav.tab}`;
  if ('id' in top) return `#/${top.screen}/${encodeURIComponent(top.id)}`;
  if ('slug' in top) return `#/article/${encodeURIComponent(top.slug)}`;
  return `#/${top.screen}`;
}

/** Our own ids, nothing else: a tampered link or notification never reaches a request. */
export const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);

/** The order a notification points to, or null for anything that is not one of our ids. */
export function orderIdFromPush(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const id = (data as { orderId?: unknown }).orderId;
  return validId(id) ? id : null;
}

/** Screens that show one person's own details. */
export const privateRoute = (route: Route) =>
  ['order', 'reply', 'udhaar', 'people', 'sites'].includes(route.screen);
export const privateTab = (_tab: Tab) => false;
