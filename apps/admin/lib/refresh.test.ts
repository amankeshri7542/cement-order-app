import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { refreshAfterWrite } from './refresh';

const settled = () => new Promise((resolve) => setTimeout(resolve, 5));
const answer = (reads: ((stock: number) => void)[], index: number, stock: number) => {
  const read = reads[index];
  assert(read, `read ${index} never started`);
  read(stock);
};

function watchStock() {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 15000, retry: false } },
  });
  const key = ['products', 'stock', 'cement'];
  const reads: ((stock: number) => void)[] = [];
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: () => new Promise<number>((resolve) => reads.push(resolve)),
  });
  const stop = observer.subscribe(() => undefined);
  return { client, key, reads, stop };
}

test('a write during a first fetch reads again and never keeps the older read', async (t) => {
  const { client, key, reads, stop } = watchStock();
  t.after(stop);
  await settled();
  assert.equal(reads.length, 1);
  const refreshed = refreshAfterWrite(client, [['products']]);
  await settled();
  assert.equal(reads.length, 2, 'the refresh must start a new read');
  answer(reads, 1, 55);
  answer(reads, 0, 48);
  await refreshed;
  await settled();
  assert.equal(client.getQueryData(key), 55);
});

test('a write after a finished fetch reads again', async (t) => {
  const { client, key, reads, stop } = watchStock();
  t.after(stop);
  await settled();
  answer(reads, 0, 48);
  await settled();
  const refreshed = refreshAfterWrite(client, [['products']]);
  await settled();
  assert.equal(reads.length, 2);
  answer(reads, 1, 55);
  await refreshed;
  assert.equal(client.getQueryData(key), 55);
});

test('only the named keys are refreshed', async (t) => {
  const { client, reads, stop } = watchStock();
  t.after(stop);
  await settled();
  answer(reads, 0, 48);
  await settled();
  await refreshAfterWrite(client, [['orders']]);
  await settled();
  assert.equal(reads.length, 1);
});
