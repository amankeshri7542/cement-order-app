import { cookies } from 'next/headers';
import { readLanguage } from '@shiv/i18n';
import { OwnerProvider } from '../../lib/owner';
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  // The page is drawn in the person's language from the start (the cookie lib/i18n.tsx writes).
  const language = readLanguage((await cookies()).get('shiv_lang')?.value);
  return <OwnerProvider language={language}>{children}</OwnerProvider>;
}
