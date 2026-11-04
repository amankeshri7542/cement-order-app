import type { Metadata } from 'next';
import { pageMetadata } from '../../lib/language';
import { AboutPage } from '../../components/pages';

const copy = {
  en: {
    title: 'About',
    description:
      'Shiv Cement Store, Patna: cement, steel bars, bricks, sand and stone chips, with brand, grade, pack and selling unit beside every price. पटना की सीमेंट, सरिया, ईंट, बालू और गिट्टी की दुकान।',
  },
  hi: {
    title: 'शिव सीमेंट स्टोर के बारे में',
    description:
      'शिव सीमेंट स्टोर, पटना: सीमेंट, सरिया, ईंट, बालू और गिट्टी, हर भाव के साथ ब्रांड, ग्रेड, पैक और बिक्री इकाई।',
  },
};
export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata('/about', copy);
}
export default function Page() {
  return <AboutPage />;
}
