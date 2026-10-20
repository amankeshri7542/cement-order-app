import { OwnerProvider } from '../../lib/owner';
export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return <OwnerProvider>{children}</OwnerProvider>;
}
