declare module 'react-native-razorpay' {
  const Razorpay: {
    open(options: {
      key: string;
      order_id: string;
      amount: number;
      currency: string;
      name: string;
      prefill: { contact: string };
      theme: { color: string };
    }): Promise<{
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
    }>;
  };
  export default Razorpay;
}
