import type { Metadata } from 'next';
import { pageMetadata } from '../../lib/language';
import { DeliveryPage } from '../../components/pages';
import { JsonLd } from '../../components/json-ld';

const copy = {
  en: {
    title: 'Delivery',
    description:
      'Check your site pincode for Shiv Cement Store’s delivery fee, minimum order and estimate. Cash on delivery. डिलीवरी शुल्क और अनुमान के लिए अपना पिनकोड जाँचें।',
  },
  hi: {
    title: 'डिलीवरी',
    description:
      'अपनी साइट का पिनकोड डालकर शिव सीमेंट स्टोर का डिलीवरी शुल्क, न्यूनतम ऑर्डर और अनुमान देखें। भुगतान डिलीवरी पर नकद।',
  },
};
export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata('/delivery', copy);
}
// Both answers are printed on the page itself, word for word.
const faq = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'How does delivery work?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Check your site pincode. Checkout shows the current delivery fee, minimum order and delivery estimate before you confirm.',
      },
    },
    {
      '@type': 'Question',
      name: 'Is a quotation the same as an order?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'For a bulk requirement, build a material list and request a quotation. An estimate or accepted quotation is not a confirmed order; the shop must convert the agreed offer.',
      },
    },
  ],
};
export default function Page() {
  return (
    <>
      <JsonLd data={faq} />
      <DeliveryPage />
    </>
  );
}
