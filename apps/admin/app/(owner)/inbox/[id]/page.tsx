import { InboxOne } from '../../../../components/owner/inbox';
export default async function InboxCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InboxOne id={id} />;
}
