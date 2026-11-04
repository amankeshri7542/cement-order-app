import { z } from 'zod';
import { cartMergeSchema } from './index';

// What a guest has chosen before signing in. Only product ids and quantities are kept on the
// device (phone secure storage has small value limits); prices always come fresh from the API.
export const guestIntentSchema = z.object({
  key: z.string().uuid(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1).max(100),
        quantity: z.number().int().min(1).max(10000),
      }),
    )
    .max(50),
});
export type GuestIntent = z.infer<typeof guestIntentSchema>;

/** The existing POST /cart/merge body; the stored key makes retries safe after a lost reply. */
export function toMergePayload(intent: GuestIntent): z.infer<typeof cartMergeSchema> {
  return cartMergeSchema.parse({
    idempotencyKey: intent.key,
    items: intent.lines.map(({ productId, quantity }) => ({ productId, quantity })),
  });
}
