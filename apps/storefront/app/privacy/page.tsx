import type { Metadata } from 'next';
import { pageMetadata } from '../../lib/language';
import { PrivacyPage } from '../../components/pages';

const copy = {
  en: {
    title: 'Privacy',
    description:
      'What Shiv Cement Store collects, why, how long it is kept and how to delete your account. निजता और खाता हटाने की जानकारी।',
  },
  hi: {
    title: 'निजता',
    description:
      'शिव सीमेंट स्टोर कौन सी जानकारी रखता है, क्यों, कितने समय तक, और अपना खाता कैसे हटाएँ।',
  },
};
export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata('/privacy', copy);
}
export default function Page() {
  return <PrivacyPage />;
}
