import type { PrismaClient } from '@prisma/client';

/**
 * Fast inserts without a new dependency: each column travels as one array parameter and Postgres
 * unnests them (`INSERT … SELECT FROM unnest($1::text[], …)`), which is close to COPY speed.
 * Values go as parameters, never into the SQL text.
 *
 * Column types: 'text', 'int', 'bigint', 'bool', 'float', 'ts' (a Date, stored as Prisma's
 * timestamp(3) in UTC), 'json' (any value, stored as jsonb), 'text[]' (a string list), 'int[]'
 * (a number list), or an enum name in double quotes, such as '"OrderStatus"'.
 */
export type ColumnType =
  'text' | 'int' | 'bigint' | 'bool' | 'float' | 'ts' | 'json' | 'text[]' | 'int[]' | `"${string}"`;
export type Columns = Record<string, ColumnType>;
export type Row = Record<string, unknown>;

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function wire(type: ColumnType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'ts':
      if (!(value instanceof Date) || Number.isNaN(value.getTime()))
        throw new Error(`Expected a valid Date, got ${String(value)}`);
      return value.toISOString().replace('T', ' ').replace('Z', '');
    case 'json':
      return JSON.stringify(value);
    case 'text[]':
      if (!Array.isArray(value)) throw new Error('Expected a string list.');
      return `{${value.map((v) => `"${String(v).replace(/["\\]/g, '\\$&')}"`).join(',')}}`;
    case 'int[]':
      if (!Array.isArray(value) || !value.every(Number.isInteger))
        throw new Error('Expected a whole-number list.');
      return `{${value.join(',')}}`;
    default:
      return value;
  }
}

function arrayType(type: ColumnType): string {
  if (type === 'float') return 'float8[]';
  if (type === 'bool') return 'boolean[]';
  if (type === 'int' || type === 'bigint') return `${type}[]`;
  return 'text[]';
}

function cast(type: ColumnType): string {
  if (type === 'ts') return '::timestamp(3)';
  if (type === 'json') return '::jsonb';
  if (type === 'text[]') return '::text[]';
  if (type === 'int[]') return '::int[]';
  if (type.startsWith('"')) return `::${type}`;
  return '';
}

type Table = { columns: Columns; names: string[]; sql: string; rows: Row[] };

/**
 * Buffers rows per table and writes them in batches. Tables are written in the order they were
 * registered, parents first, so a child row never reaches the database before the row it points
 * to: when any buffer fills, every buffer is flushed in that order.
 */
export class Bulk {
  /** Rows written per table, for the run summary. */
  readonly written = new Map<string, number>();
  private readonly tables = new Map<string, Table>();

  constructor(
    private readonly db: PrismaClient,
    private readonly chunk = 5000,
  ) {}

  /** Registers a table. Call in parent-to-child order before adding rows. */
  table(table: string, columns: Columns) {
    if (!identifier.test(table)) throw new Error(`Bad table name ${table}`);
    if (this.tables.has(table)) throw new Error(`Table ${table} registered twice`);
    const names = Object.keys(columns);
    for (const name of names) {
      const type = columns[name]!;
      if (!identifier.test(name)) throw new Error(`Bad column ${name}`);
      if (type.startsWith('"') && !/^"[A-Za-z]+"$/.test(type)) throw new Error(`Bad type ${type}`);
    }
    const select = names.map((name, i) => `u.c${i}${cast(columns[name]!)}`).join(', ');
    const unnest = names.map((name, i) => `$${i + 1}::${arrayType(columns[name]!)}`).join(', ');
    const alias = names.map((_, i) => `c${i}`).join(', ');
    const sql = `INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(', ')}) SELECT ${select} FROM unnest(${unnest}) AS u(${alias})`;
    this.tables.set(table, { columns, names, sql, rows: [] });
  }

  async add(table: string, row: Row) {
    const t = this.tables.get(table);
    if (!t) throw new Error(`Table ${table} is not registered`);
    t.rows.push(row);
    if (t.rows.length >= this.chunk) await this.flush();
  }

  async addAll(table: string, rows: readonly Row[]) {
    for (const row of rows) await this.add(table, row);
  }

  /** Writes every buffered row, parents first. */
  async flush() {
    for (const [name, t] of this.tables) {
      if (!t.rows.length) continue;
      const rows = t.rows;
      t.rows = [];
      const params = t.names.map((column) =>
        rows.map((row) => wire(t.columns[column]!, row[column])),
      );
      await this.db.$executeRawUnsafe(t.sql, ...params);
      this.written.set(name, (this.written.get(name) ?? 0) + rows.length);
    }
  }
}
