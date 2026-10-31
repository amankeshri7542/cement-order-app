import type { Metadata } from 'next';
import { pageMetadata } from '../../lib/language';
import { ContactPage } from '../../components/pages';

const copy = {
  en: {
    title: 'Contact the shop',
    description:
      'Ask Shiv Cement Store, Patna about a material, its selling unit or delivery. Leave your number and the shop will contact you. दुकान से पूछताछ करें।',
  },
  hi: {
    title: 'दुकान से संपर्क',
    description:
      'किसी सामग्री, उसकी बिक्री इकाई या डिलीवरी के बारे में शिव सीमेंट स्टोर, पटना से पूछें। अपना नंबर छोड़ें, दुकान आपसे संपर्क करेगी।',
  },
};
export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata('/contact', copy);
}
export default function Page() {
  return <ContactPage />;
}
