import type { QueryClient, QueryKey } from '@tanstack/react-query';

// A query still on its first fetch answers an invalidation with that fetch, which may have read
// before the write committed. Cancelling first makes every query read again after the write.
export async function refreshAfterWrite(client: QueryClient, keys: QueryKey[]) {
  await Promise.all(
    keys.map(async (queryKey) => {
      await client.cancelQueries({ queryKey });
      await client.invalidateQueries({ queryKey });
    }),
  );
}
