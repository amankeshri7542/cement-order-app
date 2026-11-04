import { canDo, type Access, type Permission } from '@shiv/shared';

/** Which permission opens each page. The API enforces the same rules on every route. */
const pages: [path: string, needs: Permission][] = [
  ['/inbox', 'orders.confirm'],
  ['/orders/new', 'orders.create'],
  ['/orders', 'orders.read'],
  ['/lists', 'quotes.read'],
  ['/customers', 'customers.read'],
  ['/khata', 'khata.read.list'],
  ['/udhaar', 'khata.read.list'],
  ['/rates', 'rates.read'],
  ['/stock', 'stock.read'],
  ['/manzoori', 'approvals.ask'],
  ['/galla', 'galla.read'],
  ['/reports', 'reports.read'],
  ['/activity', 'audit.read'],
  ['/users', 'staff.manage'],
  ['/settings', 'desk.use'],
  ['/system', 'system.ops'],
  ['/today', 'dashboard.read'],
  ['/more', 'desk.use'],
];

export function pathAllowed(access: Access, path: string) {
  if (path === '/whatsapp' || path.startsWith('/whatsapp/')) return viewAllowed(access, 'whatsapp');
  // Owners decide here, and everyone else sees what they themselves asked.
  if (path === '/manzoori')
    return canDo(access, 'approvals.ask') || canDo(access, 'approvals.decide');
  if (path === '/staff' || path.startsWith('/staff/'))
    return canDo(access, 'staff.read') || canDo(access, 'alerts.manage');
  const page = pages.find(([route]) => path === route || path.startsWith(`${route}/`));
  return page ? canDo(access, page[1]) : canDo(access, 'desk.use');
}

/** The first page of this person's job: a stock keeper's day starts at stock, not the takings. */
export function homeFor(access: Access) {
  return (
    ['/today', '/stock', '/orders', '/system', '/more'].find((path) => pathAllowed(access, path)) ??
    '/more'
  );
}

/** The pages under More. Each is now a real page of its own, and old links lead there. */
export const moreViews = {
  users: ['staff.manage'],
  store: ['store.edit'],
  zones: ['delivery.edit'],
  devices: ['desk.use'],
  activity: ['audit.read'],
  reports: ['reports.read'],
  language: ['desk.use'],
  quotes: ['quotes.read'],
  rates: ['rates.read'],
  products: ['products.edit'],
  staff: ['staff.read', 'alerts.manage'],
  whatsapp: ['wa.read', 'wa.ai.control', 'wa.admin'],
} as const satisfies Record<string, readonly Permission[]>;
/** Where each old address now lives. */
export const moreRoutes: Record<MoreView, string> = {
  users: '/users',
  store: '/settings',
  zones: '/settings',
  devices: '/settings',
  activity: '/activity',
  reports: '/reports',
  language: '/settings',
  quotes: '/lists',
  rates: '/rates',
  products: '/stock?tab=maal',
  staff: '/staff',
  whatsapp: '/whatsapp',
};
export type MoreView = keyof typeof moreViews;

/** The permissions that open a page under More. A name that is not a page opens nothing. */
export function viewNeeds(view: string): readonly Permission[] {
  return Object.hasOwn(moreViews, view) ? moreViews[view as MoreView] : [];
}

export function viewAllowed(access: Access, view: string) {
  return viewNeeds(view).some((name) => canDo(access, name));
}
