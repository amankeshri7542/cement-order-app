import type { Order, OwnerWork, User } from '@shiv/shared';
/** What one customer owes one firm (plan v4, two firms). */
export type FirmBalance = {
  firmId: string;
  name?: string;
  balancePaise: number;
  creditLimitPaise: number | null;
};
export type Customer = User & {
  /** Per firm, only the firms this person may see. */
  byFirm?: FirmBalance[];
  createdAt: string;
  creditAllowed: boolean;
  creditLimitPaise: number | null;
  balancePaise: number;
  khataBalancePaise: number;
  area: string;
  tags: string[];
  lastOrderAt: string | null;
  notesCount: number;
  addresses?: import('@shiv/shared').Address[];
  orders?: Order[];
};
export type LedgerEntry = {
  id: string;
  kind: string;
  amountPaise: number;
  balanceAfterPaise: number;
  reversal?: { id: string } | null;
  note: string;
  occurredAt: string;
  createdAt: string;
  reversesId: string | null;
};
export type Ledger = {
  balancePaise: number;
  creditAllowed: boolean;
  creditLimitPaise: number | null;
  entries: import('@shiv/shared').Page<LedgerEntry>;
};
export type Dashboard = {
  todayOrders: number;
  todaySalesPaise: number;
  todayCounterSalesPaise: number;
  todayRefundsPaise: number;
  khataDuePaise: number;
  /** Each firm this person sees: money in today and udhaar owed. */
  byFirm?: { firmId: string; name: string; todayMoneyInPaise: number; khataDuePaise: number }[];
  todayCreditSalesPaise: number;
  todayPhoneOrders: number;
  newWork: number;
  issues: number;
  pendingOrders: number;
  pendingPayments: number;
  pendingDeliveries: number;
  recentOrders: Order[];
};
export type WorkItem = OwnerWork & {
  order?: Order & { user?: User };
  quote?: import('@shiv/shared').Quote;
};
export type KhataSummary = {
  totalDuePaise: number;
  customersWithDue: number;
  /** Each firm this person sees, beside the combined figure. */
  byFirm?: { firmId: string; name: string; totalDuePaise: number; customersWithDue: number }[];
  overdue30d: {
    id: string;
    name: string;
    phone: string;
    balancePaise: number;
    overduePaise: number;
  }[];
};
export type DeliveryCheck = { serviceable: boolean; zone?: import('@shiv/shared').DeliveryZone };
