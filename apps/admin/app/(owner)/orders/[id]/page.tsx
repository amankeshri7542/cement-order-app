import { OrderDetails } from '../../../../components/owner/orders';
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderDetails id={id} />;
}
