import type { Metadata } from 'next';
import { pageMetadata } from '../../lib/language';
import { TermsPage } from '../../components/pages';

const copy = {
  en: {
    title: 'How ordering works',
    description:
      'Prices, cash on delivery, delivery charges, cancelling, returns and bulk quotes at Shiv Cement Store, in plain language. ऑर्डर की शर्तें सरल भाषा में।',
  },
  hi: {
    title: 'ऑर्डर कैसे काम करता है',
    description:
      'शिव सीमेंट स्टोर पर भाव, डिलीवरी पर नकद भुगतान, डिलीवरी शुल्क, ऑर्डर रद्द करना, वापसी और थोक भाव, सरल भाषा में।',
  },
};
export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata('/terms', copy);
}
export default function Page() {
  return <TermsPage />;
}
