import { t, type Language, type MessageKey, type Params } from '@shiv/i18n';
import type { Prisma } from '@prisma/client';

type Tx = Pick<Prisma.TransactionClient, 'user' | 'notification'>;

/** The push.* templates that have a title and a body. */
export type PushKind =
  | 'orderPlaced'
  | 'orderStatus'
  | 'delivery'
  | 'quoteReady'
  | 'quoteOrder'
  | 'paymentConfirmed'
  | 'refundRequired';

/** A customer's title and body from the push.* messages, in the language they will read. */
export const pushText =
  (kind: PushKind, params: Params | ((language: Language) => Params) = {}) =>
  (language: Language) => {
    const values = typeof params === 'function' ? params(language) : params;
    return {
      title: t(`push.${kind}.title` as MessageKey, values, language),
      body: t(`push.${kind}.body` as MessageKey, values, language),
    };
  };

/**
 * Records a notification for a customer, worded in the language they chose in the app (Hindi when
 * they never chose one). Written inside the caller's transaction, so it exists exactly when the
 * change it announces does; the maintenance loop sends it.
 */
export async function notifyCustomer(
  tx: Tx,
  userId: string,
  words: (language: Language) => { title: string; body: string },
  orderId?: string,
) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { language: true } });
  const { title, body } = words(user?.language === 'en' ? 'en' : 'hi');
  await tx.notification.create({
    data: { userId, title, body, ...(orderId ? { orderId } : {}) },
  });
}
