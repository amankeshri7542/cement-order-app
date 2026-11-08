import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isShopScoped, PERMISSIONS_VERSION, permissions } from '@shiv/shared';
import { AppModule } from '../src/app';
import type { CanRule } from '../src/http';

type Route = {
  name: string;
  isPublic: boolean;
  isSelf: boolean;
  can?: CanRule;
  firm?: 'own' | 'shop' | 'none';
};

/** Every route Nest will serve, with its access rule, read the same way the guard reads it. */
function routes(): Route[] {
  const controllers: (new (...args: never[]) => object)[] =
    Reflect.getMetadata('controllers', AppModule) ?? [];
  return controllers.flatMap((controller) => {
    const base = String(Reflect.getMetadata('path', controller) ?? '');
    return Object.getOwnPropertyNames(controller.prototype).flatMap((key) => {
      const handler = (controller.prototype as Record<string, unknown>)[key];
      if (typeof handler !== 'function' || key === 'constructor') return [];
      const path = Reflect.getMetadata('path', handler) as string | string[] | undefined;
      if (path === undefined) return [];
      const read = <T>(rule: string) =>
        (Reflect.getMetadata(rule, handler) ?? Reflect.getMetadata(rule, controller)) as T;
      return [
        {
          name: `${controller.name}.${key} ${base}/${String(path)}`,
          isPublic: !!read('public'),
          isSelf: !!read('self'),
          can: read<CanRule | undefined>('can'),
          firm: read<Route['firm']>('firm'),
        },
      ];
    });
  });
}

describe('every route says who may use it', () => {
  const all = routes();

  it('finds the routes', () => {
    expect(all.length).toBeGreaterThan(100);
  });
  it('no route is left without a rule', () => {
    const missing = all.filter((route) => !route.isPublic && !route.isSelf && !route.can);
    expect(missing.map((route) => route.name)).toEqual([]);
  });
  it('no route carries two conflicting rules', () => {
    const both = all.filter(
      (route) => [route.isPublic, route.isSelf, !!route.can].filter(Boolean).length > 1,
    );
    expect(both.map((route) => route.name)).toEqual([]);
  });
  it('names only permissions that exist', () => {
    for (const route of all)
      if (route.can) expect(permissions, route.name).toContain(route.can.permission);
  });
  it('a permission some role holds for certain shops always says how to find the shop', () => {
    const open = all.filter(
      (route) => route.can && isShopScoped(route.can.permission) && !route.can.shop,
    );
    expect(open.map((route) => route.name)).toEqual([]);
  });
  it('the old all-or-nothing staff check is gone', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
      });
    for (const file of files(join(__dirname, '../src')))
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/@Admin\(\)/);
  });
});

/**
 * Permissions whose routes read or write something that belongs to one firm: customers' money and
 * orders, khata, galla, reports, follow-ups and Tally's numbers (plan v4, two firms). Each such route
 * must say how it keeps to the firms a person may see.
 */
const firmOwned = [
  'customers.read',
  'customers.note',
  'khata.read.one',
  'khata.read.list',
  'khata.payment',
  'khata.adjust',
  'khata.reverse',
  'khata.credit.set',
  'khata.opening.draft',
  'khata.opening.approve',
  'crm.followups.read',
  'crm.followups',
  'crm.dormant.read',
  'crm.vasooli.read',
  'crm.remind',
  'orders.read',
  'orders.confirm',
  'orders.status',
  'quotes.read',
  'galla.read',
  'galla.close',
  'cash.count',
  'money.receive',
  'money.refund',
  'reports.read',
  'dashboard.read',
  'audit.read',
  'tally.numbers.view',
  'tally.match',
];

describe('two firms', () => {
  const all = routes();
  it("every firm-owned route says how it keeps to a person's firms", () => {
    const missing = all.filter(
      (route) => route.can && firmOwned.includes(route.can.permission) && !route.firm,
    );
    expect(missing.map((route) => `${route.name} (${route.can!.permission})`)).toEqual([]);
  });
  it('a route left to its shop filter really has one', () => {
    const wrong = all.filter(
      (route) => route.firm === 'shop' && !(route.can && isShopScoped(route.can.permission)),
    );
    expect(wrong.map((route) => route.name)).toEqual([]);
  });
  it('the firm list names only permissions that exist', () => {
    for (const name of firmOwned) expect(permissions).toContain(name);
  });
});

describe('the audit log', () => {
  it('a new row is stamped with the current rules by default', () => {
    const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8');
    expect(schema).toMatch(
      new RegExp(`permissionsVersion\\s+Int\\s+@default\\(${PERMISSIONS_VERSION}\\)`),
    );
  });
  it('never takes a whole request body, which could carry personal text it can never remove', () => {
    const files = readdirSync(join(__dirname, '../src')).filter((name) => name.endsWith('.ts'));
    for (const name of files)
      expect(readFileSync(join(__dirname, '../src', name), 'utf8'), name).not.toMatch(
        /details: (body|input|data)\s*[,}]/,
      );
  });
});
