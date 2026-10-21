import { describe, expect, it } from 'vitest';
import { orderStatusText } from '@shiv/shared';
import { notifyCustomer, pushText } from '../src/notify';

function fakeTx(language: string | null) {
  const created: Record<string, unknown>[] = [];
  const tx = {
    user: { findUnique: async () => (language === null ? null : { language }) },
    notification: {
      create: async ({ data }: { data: Record<string, unknown> }) => void created.push(data),
    },
  };
  return { created, tx: tx as never };
}

describe('customer notifications', () => {
  it('are written in Hindi for a Hindi reader and in English for an English reader', async () => {
    const hindi = fakeTx('hi');
    await notifyCustomer(hindi.tx, 'u1', pushText('orderPlaced', { number: 'SC-1' }), 'o1');
    expect(hindi.created).toEqual([
      { userId: 'u1', title: 'ऑर्डर मिल गया', body: 'SC-1 दर्ज हो गया है।', orderId: 'o1' },
    ]);
    const english = fakeTx('en');
    await notifyCustomer(english.tx, 'u1', pushText('orderPlaced', { number: 'SC-1' }), 'o1');
    expect(english.created).toEqual([
      { userId: 'u1', title: 'Order received', body: 'SC-1 has been placed.', orderId: 'o1' },
    ]);
  });

  it('default to Hindi when the customer never chose or the account is unknown', async () => {
    for (const language of [null, '', 'fr']) {
      const { created, tx } = fakeTx(language);
      await notifyCustomer(tx, 'u1', pushText('quoteReady', { number: 'Q-9' }));
      expect(created[0]).toMatchObject({ title: 'आपका थोक भाव तैयार है' });
    }
  });

  it('says the order status in the reader’s own words', async () => {
    const words = pushText('orderStatus', (language) => ({
      number: 'SC-2',
      status: orderStatusText('OUT_FOR_DELIVERY', language),
    }));
    expect(words('hi')).toEqual({
      title: 'ऑर्डर की जानकारी',
      body: `SC-2: ${orderStatusText('OUT_FOR_DELIVERY', 'hi')}`,
    });
    expect(words('en').body).toBe(`SC-2: ${orderStatusText('OUT_FOR_DELIVERY', 'en')}`);
    expect(words('hi').body).toMatch(/[ऀ-ॿ]/);
  });

  it('leave out the order link when there is none', async () => {
    const { created, tx } = fakeTx('hi');
    await notifyCustomer(tx, 'u1', pushText('quoteOrder', { quote: 'Q-1', order: 'SC-3' }));
    expect(created[0]).not.toHaveProperty('orderId');
    expect(created[0]).toMatchObject({ body: 'Q-1 अब SC-3 है। तय भाव और भाड़ा वही रहेंगे।' });
  });

  it('have both languages for every template', () => {
    for (const kind of [
      'orderPlaced',
      'orderStatus',
      'delivery',
      'quoteReady',
      'quoteOrder',
      'paymentConfirmed',
      'refundRequired',
    ] as const) {
      const params = { number: 'N', status: 'S', quote: 'Q', order: 'O' };
      for (const language of ['hi', 'en'] as const) {
        const { title, body } = pushText(kind, params)(language);
        expect(title.trim()).not.toBe('');
        expect(body).not.toMatch(/\{\w+\}/);
      }
      expect(pushText(kind, params)('hi').title).not.toBe(pushText(kind, params)('en').title);
    }
  });
});
