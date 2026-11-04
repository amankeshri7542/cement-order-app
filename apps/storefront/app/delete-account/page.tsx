import type { Metadata } from 'next';
import { pageMetadata } from '../../lib/language';
import { DeleteAccountPage } from '../../components/pages';

// The Google Play listing links here. The page is for people to open from the listing, not to
// find in a search, so it is left out of search results.
const copy = {
  en: {
    title: 'Delete your account',
    description: 'Delete your Shiv Cement Store account without installing the app.',
  },
  hi: {
    title: 'अपना खाता हटाएँ',
    description: 'ऐप इंस्टॉल किए बिना अपना शिव सीमेंट स्टोर खाता हटाएँ।',
  },
};
export async function generateMetadata(): Promise<Metadata> {
  return {
    ...(await pageMetadata('/delete-account', copy)),
    robots: { index: false, follow: false },
  };
}
export default function Page() {
  return <DeleteAccountPage />;
}
