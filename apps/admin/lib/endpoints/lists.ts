import { customerPageSchema, orderPageSchema, type Order, type Page } from '@shiv/shared';
import type { Customer } from '../owner-types';
import { endpoint, type Schema } from './core';

/*
 * List endpoints read through useList. Their schemas check the fields a page reads and let the
 * rest through, so the desk's fuller types stay as they are until each page is rebuilt.
 */
export const customerList = endpoint<
  Page<Customer>,
  { q?: string; sort?: 'recent' | 'due'; limit?: number; cursor?: string; firmId?: string }
>({
  key: ['customers', 'list'],
  path: '/admin/customers',
  schema: customerPageSchema as unknown as Schema<Page<Customer>>,
  scope: 'firm',
});

export const orderList = endpoint<
  Page<Order>,
  {
    q?: string;
    group?: 'all' | 'today' | 'pending' | 'completed';
    limit?: number;
    cursor?: string;
    locationId?: string;
    firmId?: string;
  }
>({
  key: ['orders', 'list'],
  path: '/admin/orders',
  schema: orderPageSchema as unknown as Schema<Page<Order>>,
  scope: 'shop',
});

/** Every list endpoint, for the test that each one takes the top bar's choice. */
export const listEndpoints = { customerList, orderList } as const;
