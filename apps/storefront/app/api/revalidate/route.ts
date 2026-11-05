import { timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { catalogTag } from '../../../lib/public-data';

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * The API calls this when a rate changes, so the next page load shows it. expire: 0 on purpose:
 * the recommended 'max' would serve the old rate to the next visitor, and a price must not do that.
 */
export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  const given = request.headers.get('x-revalidate-secret');
  if (!secret || !given || !same(secret, given)) return new Response(null, { status: 403 });
  revalidateTag(catalogTag, { expire: 0 });
  return new Response(null, { status: 204 });
}
