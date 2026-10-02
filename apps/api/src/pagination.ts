import { z } from 'zod';
import { fail, hash } from './http';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  cursor: z.string().max(2000).optional(),
});
const cursorSchema = z.strictObject({
  scope: z.string(),
  value: z.union([z.string().max(250), z.number().int().min(0)]),
  id: z.string().min(1).max(100),
});
export function paginate(
  query: unknown,
  scope: string,
  field = 'createdAt',
  direction: 'asc' | 'desc' = 'desc',
) {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) fail('INVALID_PAGE', 'Choose a page size between 1 and 100.');
  const { limit, cursor } = parsed.data;
  const fingerprint = hash(`${scope}:${field}:${direction}`);
  let after = {};
  if (cursor) {
    let data: z.infer<typeof cursorSchema>;
    try {
      data = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
    } catch {
      fail('INVALID_CURSOR', 'Refresh this list to continue.');
    }
    if (data.scope !== fingerprint) fail('INVALID_CURSOR', 'Filters changed. Refresh this list.');
    const value = field === 'createdAt' ? new Date(String(data.value)) : data.value;
    if (
      (field === 'createdAt' && !Number.isFinite((value as Date).getTime())) ||
      (field === 'pricePaise' && typeof value !== 'number') ||
      (field === 'name' && typeof value !== 'string')
    )
      fail('INVALID_CURSOR', 'Refresh this list to continue.');
    const operator = direction === 'asc' ? 'gt' : 'lt';
    after = {
      AND: [
        { [field]: { [direction === 'asc' ? 'gte' : 'lte']: value } },
        {
          OR: [{ [field]: { [operator]: value } }, { [field]: value, id: { [operator]: data.id } }],
        },
      ],
    };
  }
  return {
    take: limit + 1,
    after,
    orderBy: [{ [field]: direction }, { id: direction }],
    finish<T extends { id: string }>(rows: T[]) {
      const items = rows.slice(0, limit);
      const last = items.at(-1) as (T & Record<string, unknown>) | undefined;
      return {
        items,
        nextCursor:
          rows.length > limit && last
            ? Buffer.from(
                JSON.stringify({ scope: fingerprint, value: last[field], id: last.id }),
              ).toString('base64url')
            : null,
      };
    },
  };
}
