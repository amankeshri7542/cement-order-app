import { Platform } from 'react-native';
import { api } from './api';
type Options = {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  prefill: { contact: string };
  theme: { color: string };
};
type Result = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};
declare global {
  interface Window {
    Razorpay: new (
      options: Options & { handler: (result: Result) => void; modal: { ondismiss: () => void } },
    ) => { open: () => void; on: (name: string, handler: () => void) => void };
  }
}
export async function payOnline(orderId: string, phone: string) {
  const init = await api<{
    key: string;
    razorpayOrderId: string;
    amount: number;
    currency: string;
    name: string;
  }>(`/payments/orders/${orderId}`, 'POST');
  const options: Options = {
    key: init.key,
    order_id: init.razorpayOrderId,
    amount: init.amount,
    currency: init.currency,
    name: init.name,
    prefill: { contact: phone },
    theme: { color: '#142c43' },
  };
  let result: Result;
  if (Platform.OS === 'web') {
    if (!window.Razorpay)
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Payment checkout could not load.'));
        document.head.appendChild(script);
      });
    result = await new Promise<Result>((resolve, reject) => {
      const checkout = new window.Razorpay({
        ...options,
        handler: resolve,
        modal: {
          ondismiss: () =>
            reject(new Error('Payment not completed. Your order is awaiting payment.')),
        },
      });
      checkout.on('payment.failed', () =>
        reject(new Error('Payment failed. Check your order before trying again.')),
      );
      checkout.open();
    });
  } else {
    const Razorpay = (await import('react-native-razorpay')).default;
    result = await Razorpay.open(options);
  }
  return api<{ message: string }>('/payments/verify', 'POST', {
    orderId,
    razorpayOrderId: result.razorpay_order_id,
    razorpayPaymentId: result.razorpay_payment_id,
    signature: result.razorpay_signature,
  });
}
