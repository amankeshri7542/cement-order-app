/**
 * Who may do what. Fixed in code and reviewed in git, so nobody can give away salary access by
 * mistake. The API enforces this table on every route, and the desk reads it to draw its menus.
 * Change PERMISSIONS_VERSION whenever a role's rights change; audit rows record it.
 */
export const PERMISSIONS_VERSION = 4;

export const staffRoles = [
  'OWNER',
  'MANAGER',
  'CASHIER',
  'ACCOUNTANT',
  'STOCK_KEEPER',
  'DRIVER',
  'HELPER',
  'TECH_OPERATOR',
] as const;
export type StaffRole = (typeof staffRoles)[number];

/** These roles cover every shop, and hold a membership with no shop on it. */
export const allShopRoles: readonly StaffRole[] = ['OWNER', 'ACCOUNTANT', 'TECH_OPERATOR'];

export const permissions = [
  'desk.use',
  'dashboard.read',
  'orders.read',
  'orders.read.money',
  'orders.create',
  'orders.confirm',
  'orders.confirm.credit',
  'orders.change',
  'orders.rate.change',
  'orders.credit.override',
  'orders.status',
  'orders.maintain',
  'orders.override',
  'money.receive',
  'money.refund',
  'quotes.read',
  'quotes.price',
  'customers.read',
  'customers.note',
  'customers.edit',
  'khata.read.one',
  'khata.read.list',
  'khata.payment',
  'khata.adjust',
  'khata.reverse',
  'khata.credit.set',
  'enquiries.handle',
  'stock.read',
  'stock.receive',
  'stock.sell',
  'stock.adjust',
  'products.edit',
  'rates.publish',
  'ratecard.share',
  'delivery.read',
  'delivery.edit',
  'store.edit',
  'reports.read',
  'audit.read',
  'staff.read',
  'staff.manage',
  'location.manage',
  'alerts.manage',
  'system.ops',
  'wa.read',
  'wa.ai.control',
  'wa.learn',
  'wa.admin',
  'stock.count',
  'stock.transfer',
  'stock.report',
  'approvals.ask',
  'approvals.decide',
  'galla.read',
  'galla.close',
  'rates.read',
  'rates.ask',
  'pricing.edit',
] as const;
export type Permission = (typeof permissions)[number];

/** ALL means every shop. SHOP means only the shops on this person's memberships. */
export type PermissionScope = 'ALL' | 'SHOP';

const everything = Object.fromEntries(permissions.map((name) => [name, 'ALL'])) as Record<
  Permission,
  PermissionScope
>;

export const rolePermissions: Record<StaffRole, Partial<Record<Permission, PermissionScope>>> = {
  OWNER: everything,
  MANAGER: {
    'desk.use': 'ALL',
    'dashboard.read': 'SHOP',
    'orders.read': 'SHOP',
    'orders.read.money': 'SHOP',
    'orders.create': 'SHOP',
    'orders.confirm': 'SHOP',
    'orders.confirm.credit': 'SHOP',
    'orders.change': 'SHOP',
    // Only down to the cap the owners set for that shop.
    'orders.rate.change': 'SHOP',
    'orders.status': 'SHOP',
    'money.receive': 'SHOP',
    'money.refund': 'SHOP',
    'quotes.read': 'SHOP',
    'quotes.price': 'SHOP',
    // Customers and their one balance belong to the firm, not to a shop.
    'customers.read': 'ALL',
    'customers.note': 'ALL',
    'khata.read.one': 'ALL',
    'khata.payment': 'ALL',
    'enquiries.handle': 'ALL',
    'stock.read': 'SHOP',
    'stock.receive': 'SHOP',
    'stock.sell': 'SHOP',
    'stock.count': 'SHOP',
    'stock.transfer': 'SHOP',
    'stock.report': 'SHOP',
    'approvals.ask': 'SHOP',
    'galla.read': 'SHOP',
    'galla.close': 'SHOP',
    'rates.read': 'ALL',
    'rates.ask': 'ALL',
    'ratecard.share': 'ALL',
    'delivery.read': 'ALL',
    'reports.read': 'SHOP',
    'staff.read': 'SHOP',
  },
  CASHIER: {
    'desk.use': 'ALL',
    'dashboard.read': 'SHOP',
    'orders.read': 'SHOP',
    'orders.read.money': 'SHOP',
    'orders.create': 'SHOP',
    // Cash orders only. An udhaar order waits for a manager or an owner.
    'orders.confirm': 'SHOP',
    'orders.change': 'SHOP',
    'money.receive': 'SHOP',
    'quotes.read': 'SHOP',
    'customers.read': 'ALL',
    'customers.note': 'ALL',
    'khata.read.one': 'ALL',
    'khata.payment': 'ALL',
    'enquiries.handle': 'ALL',
    'stock.read': 'SHOP',
    'stock.sell': 'SHOP',
    'approvals.ask': 'SHOP',
    'galla.read': 'SHOP',
    'galla.close': 'SHOP',
    'rates.read': 'ALL',
    'ratecard.share': 'ALL',
    'delivery.read': 'ALL',
  },
  ACCOUNTANT: {
    'desk.use': 'ALL',
    'dashboard.read': 'ALL',
    'orders.read': 'ALL',
    'orders.read.money': 'ALL',
    'quotes.read': 'ALL',
    'customers.read': 'ALL',
    'khata.read.one': 'ALL',
    'khata.read.list': 'ALL',
    'stock.read': 'ALL',
    'galla.read': 'ALL',
    'rates.read': 'ALL',
    'delivery.read': 'ALL',
    'reports.read': 'ALL',
    'audit.read': 'ALL',
  },
  STOCK_KEEPER: {
    'desk.use': 'ALL',
    // Sees which goods to load, with no rupee values anywhere.
    'orders.read': 'SHOP',
    'stock.read': 'SHOP',
    'stock.receive': 'SHOP',
    'stock.count': 'SHOP',
    'stock.transfer': 'SHOP',
    'stock.report': 'SHOP',
    'approvals.ask': 'SHOP',
  },
  // Drivers and helpers work in the staff app, which arrives in Phase 5. Nothing on the desk.
  DRIVER: {},
  HELPER: {},
  // The technical operator keeps the system healthy, and never touches orders, money or stock.
  TECH_OPERATOR: {
    'desk.use': 'ALL',
    'alerts.manage': 'ALL',
    'system.ops': 'ALL',
    // Counts and connection state only. Customers' words need wa.read.
    'wa.admin': 'ALL',
  },
};

export type StaffMembershipView = { role: StaffRole; locationId: string | null };

/** For each permission, either every shop or the list of shop ids this person holds it at. */
export type Access = Partial<Record<Permission, 'ALL' | string[]>>;

export function accessFor(memberships: readonly StaffMembershipView[]): Access {
  const access: Access = {};
  for (const { role, locationId } of memberships)
    for (const [name, scope] of Object.entries(rolePermissions[role]) as [
      Permission,
      PermissionScope,
    ][]) {
      if (access[name] === 'ALL') continue;
      if (scope === 'ALL' || !locationId) access[name] = 'ALL';
      else access[name] = [...new Set([...((access[name] as string[]) || []), locationId])];
    }
  return access;
}

/** Whether this person holds the permission at all, or at one given shop. */
export function canDo(access: Access, name: Permission, locationId?: string | null) {
  const scope = access[name];
  if (!scope) return false;
  if (scope === 'ALL' || !locationId) return true;
  return scope.includes(locationId);
}

/** True when some role holds this permission for only certain shops, so routes must check which. */
export function isShopScoped(name: Permission) {
  return staffRoles.some((role) => rolePermissions[role][name] === 'SHOP');
}

/** A role that needs shops chosen for it. */
export const needsShop = (role: StaffRole) => !allShopRoles.includes(role);
