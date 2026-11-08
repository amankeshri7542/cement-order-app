/**
 * Who may do what. Fixed in code and reviewed in git, so nobody can give away salary access by
 * mistake. The API enforces this table on every route, and the desk reads it to draw its menus.
 * Change PERMISSIONS_VERSION whenever a role's rights change; audit rows record it.
 */
export const PERMISSIONS_VERSION = 10;

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
  // Order cards made from WhatsApp or the paste box, at one's own shop.
  'wa.cards',
  // Who may hear from the AI: the stage, test numbers and quiet rules. Owners only.
  'wa.stage',
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
  // The staff app, hazri and the jobs done from it.
  'staffapp.use',
  'attendance.read',
  'attendance.review',
  'attendance.mark',
  'attendance.correct',
  'attendance.proof.read',
  'device.approve.first',
  'device.approve.change',
  'screen.manage',
  'stock.load',
  'trip.assign',
  'trip.drive',
  'cash.count',
  // Salary. Only owners move it; the accountant reads it; a manager never sees anyone's but his own.
  'staff.salary.read',
  'staff.salary.pay',
  // Ask. Owners answer what customers ask; the operator reads numbers and can stop the AI.
  'advisor.review',
  'advisor.health',
  'advisor.control',
  // Tally, read-only. Its numbers are for owners and the accountant, nobody else.
  'tally.read',
  'tally.numbers.view',
  'tally.match',
  'tally.devices',
  'tally.health',
  // CRM. A shop's people see that shop's calls; the lists of who owes what stay with those who run it.
  'customers.phone.read',
  'crm.followups.read',
  'crm.followups',
  'crm.followups.assign',
  'crm.remind',
  'crm.dormant.read',
  'crm.vasooli.read',
  // The opening sheet. The accountant types what the paper book says; only an owner signs it.
  'khata.opening.draft',
  'khata.opening.approve',
] as const;
export type Permission = (typeof permissions)[number];

/** ALL means every shop. SHOP means only the shops on this person's memberships. */
export type PermissionScope = 'ALL' | 'SHOP';

/**
 * All the staff app can ever do, whoever is holding it. It signs in with a code alone, so a phone
 * holding it reaches no money, rates or other people, even when the person is an owner.
 */
export const staffAppPermissions: readonly string[] = [
  'staffapp.use',
  'stock.read',
  'stock.receive',
  'stock.count',
  'stock.transfer',
  'stock.report',
  'stock.load',
  'approvals.ask',
  'trip.drive',
];

const everything = Object.fromEntries(permissions.map((name) => [name, 'ALL'])) as Record<
  Permission,
  PermissionScope
>;

export const rolePermissions: Record<StaffRole, Partial<Record<Permission, PermissionScope>>> = {
  OWNER: everything,
  MANAGER: {
    'customers.phone.read': 'ALL',
    'crm.followups.read': 'SHOP',
    'crm.followups': 'SHOP',
    'crm.followups.assign': 'SHOP',
    'crm.remind': 'SHOP',
    'crm.dormant.read': 'SHOP',
    'crm.vasooli.read': 'SHOP',
    'staffapp.use': 'SHOP',
    'attendance.read': 'SHOP',
    'attendance.review': 'SHOP',
    'attendance.mark': 'SHOP',
    'attendance.correct': 'SHOP',
    'device.approve.first': 'SHOP',
    'screen.manage': 'SHOP',
    'stock.load': 'SHOP',
    'trip.assign': 'SHOP',
    'cash.count': 'SHOP',
    'desk.use': 'ALL',
    'dashboard.read': 'SHOP',
    'orders.read': 'SHOP',
    'orders.read.money': 'SHOP',
    'wa.cards': 'SHOP',
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
    // Collection work: their shop's calls and reminders. The lists of who owes what are not theirs.
    'customers.phone.read': 'ALL',
    'crm.followups.read': 'SHOP',
    'crm.followups': 'SHOP',
    'crm.remind': 'SHOP',
    'staffapp.use': 'SHOP',
    'cash.count': 'SHOP',
    'desk.use': 'ALL',
    'dashboard.read': 'SHOP',
    'orders.read': 'SHOP',
    'orders.read.money': 'SHOP',
    'wa.cards': 'SHOP',
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
    // Reads the lists, with no customer's number on them, and calls nobody.
    'crm.followups.read': 'ALL',
    'crm.dormant.read': 'ALL',
    'crm.vasooli.read': 'ALL',
    'khata.opening.draft': 'ALL',
    'staff.salary.read': 'ALL',
    'tally.read': 'ALL',
    'tally.numbers.view': 'ALL',
    // Linking a ledger to a customer writes nothing to Tally or the khata.
    'tally.match': 'ALL',
    'attendance.read': 'ALL',
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
    'staffapp.use': 'SHOP',
    'stock.load': 'SHOP',
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
  DRIVER: {
    'staffapp.use': 'SHOP',
    'trip.drive': 'SHOP',
  },
  HELPER: {
    'staffapp.use': 'SHOP',
  },
  // The technical operator keeps the system healthy, and never touches orders, money or stock.
  TECH_OPERATOR: {
    // Numbers only, never a customer's words, and a way to stop the AI.
    'advisor.health': 'ALL',
    'advisor.control': 'ALL',
    'desk.use': 'ALL',
    'alerts.manage': 'ALL',
    'system.ops': 'ALL',
    // Counts and connection state only. Customers' words need wa.read.
    'wa.admin': 'ALL',
    // The shop PCs and whether they answer. No party, amount or Tally number.
    'tally.devices': 'ALL',
    'tally.health': 'ALL',
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

/** One membership as the firm check reads it: its shop's firm, and a one-firm limit if any. */
export type FirmMembershipView = {
  role: StaffRole;
  locationId: string | null;
  firmId?: string | null;
  location?: { firmId: string } | null;
};

/**
 * Whose books this person may see (plan v4, platform section 2.2). A shop membership gives that shop's
 * firm. An all-shop membership gives every firm, unless it carries a one-firm limit (an accountant
 * for one firm). The widest wins.
 */
export function firmsFor(memberships: readonly FirmMembershipView[]): 'ALL' | string[] {
  const firms = new Set<string>();
  for (const m of memberships) {
    if (m.locationId) {
      if (m.location?.firmId) firms.add(m.location.firmId);
    } else if (m.firmId) firms.add(m.firmId);
    else return 'ALL';
  }
  return [...firms].sort();
}

/**
 * For someone limited to some firms: every shop-by-shop permission they hold at all shops becomes
 * the list of those firms' shops, so every route that already filters by shop also filters by firm.
 * Permissions that are not shop-by-shop are left alone; their routes filter by firm themselves.
 */
export function narrowToFirms(
  access: Access,
  firms: 'ALL' | readonly string[],
  locations: readonly { id: string; firmId: string }[],
): Access {
  if (firms === 'ALL') return access;
  const shops = locations.filter((l) => firms.includes(l.firmId)).map((l) => l.id);
  const narrowed: Access = {};
  for (const [name, scope] of Object.entries(access) as [Permission, 'ALL' | string[]][])
    narrowed[name] =
      scope === 'ALL'
        ? isShopScoped(name)
          ? [...shops]
          : 'ALL'
        : scope.filter((shop) => shops.includes(shop));
  return narrowed;
}
