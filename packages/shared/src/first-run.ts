import type { Order } from './index';
import type { Bilingual } from './i18n';

// First-run guidance shared by the Android app and the website, so both say the same thing in
// the same order. Screens choose the layout; the words and the step logic live here.

/** Device storage keys. Values are this device's hints only; nothing here is sent to the shop. */
export const firstRunKeys = {
  /** The last pincode a customer checked (six digits as a string). */
  pincode: 'shiv_pincode_v1',
  /** Set once the "first order in 3 steps" card is closed. */
  firstOrderTip: 'shiv_first_order_tip_v1',
  /** Set once this account was asked for a name (saved or skipped), so it is asked only once. */
  nameAsked: (userId: string) => `shiv_name_asked_${userId}`,
} as const;

export const isPincode = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d{5}$/.test(value);

/** The three steps of a first order, shown on Home until the customer has any order. */
export const firstOrderSteps: readonly { title: Bilingual; body: Bilingual }[] = [
  {
    title: ['Choose material and quantity', 'सामग्री और मात्रा चुनें'],
    body: [
      'Every price shows its selling unit: a bag, a tonne, a thousand bricks.',
      'हर भाव के साथ उसकी इकाई लिखी है: बोरी, टन, हज़ार ईंट।',
    ],
  },
  {
    title: ['Check your site pincode', 'साइट का पिनकोड जाँचें'],
    body: [
      'See the delivery fee and minimum order before you sign in.',
      'साइन इन से पहले डिलीवरी शुल्क और न्यूनतम ऑर्डर देखें।',
    ],
  },
  {
    title: ['Pay cash on delivery', 'डिलीवरी पर नकद दें'],
    body: [
      'Pay in cash or UPI when the material reaches your site.',
      'सामग्री साइट पर पहुँचने पर नकद या UPI से भुगतान करें।',
    ],
  },
];

export type NextStepState = 'done' | 'current' | 'todo';
export type NextStep = { key: string; state: NextStepState; title: Bilingual; body: Bilingual };

/**
 * "What happens next" after an order, mirroring the real order statuses. The shop looks at each
 * order and confirms it, and the customer gets a message here. Nobody needs to call, and no times
 * are promised. Returns null for orders off the normal path
 * (cancelled, refunds, payment pending, a delivery problem): those screens explain themselves.
 */
export function nextSteps(order: Pick<Order, 'status' | 'number'>): NextStep[] | null {
  // Which step each status is on. Once confirmed, preparing is what comes next.
  const stepOf: Partial<Record<Order['status'], number>> = {
    AWAITING_CONFIRMATION: 1,
    CONFIRMED: 2,
    PREPARING: 2,
    OUT_FOR_DELIVERY: 3,
    DELIVERED: 5,
  };
  const now = stepOf[order.status];
  if (now === undefined) return null;
  const steps: Omit<NextStep, 'state'>[] = [
    {
      key: 'received',
      title: ['Order received', 'ऑर्डर मिल गया'],
      body: [
        `Order ${order.number} is with the shop. Keep this number for any question.`,
        `ऑर्डर ${order.number} दुकान को मिल गया है। कोई भी सवाल हो तो यह नंबर बताएँ।`,
      ],
    },
    {
      key: 'confirm',
      title: ['The shop confirms', 'Dukaan pakka karegi'],
      body: [
        'You get a message here when your order and day are confirmed. No need to call.',
        'Order aur din pakka hote hi yahan message aayega. Call karne ki zaroorat nahi.',
      ],
    },
    {
      key: 'preparing',
      title: ['Material is prepared', 'सामग्री तैयार होती है'],
      body: [
        'The shop gets your material ready for the vehicle.',
        'दुकान आपकी सामग्री गाड़ी के लिए तैयार करती है।',
      ],
    },
    {
      key: 'dispatched',
      title: ['On the way to your site', 'साइट के लिए रवाना'],
      body: [
        'Keep someone at the site to receive and check the material.',
        'सामग्री लेने और जाँचने के लिए साइट पर किसी को रखें।',
      ],
    },
    {
      key: 'delivered',
      title: ['Delivered · pay on delivery', 'डिलीवरी · पहुँचने पर भुगतान'],
      body: [
        'Check the material, then pay in cash or UPI at the site.',
        'सामग्री जाँचें, फिर साइट पर नकद या UPI से भुगतान करें।',
      ],
    },
  ];
  return steps.map((step, index) => ({
    ...step,
    state:
      order.status === 'DELIVERED' || index < now ? 'done' : index === now ? 'current' : 'todo',
  }));
}
