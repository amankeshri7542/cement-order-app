import { CustomerDetails } from '../../../../components/owner/customers';
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerDetails id={id} />;
}
