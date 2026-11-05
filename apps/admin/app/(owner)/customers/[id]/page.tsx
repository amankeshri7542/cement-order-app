import { CustomerDetails } from '../../../../components/owner/customers';
export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  return <CustomerDetails id={id} startTab={tab === 'tally' ? 'tally' : undefined} />;
}
