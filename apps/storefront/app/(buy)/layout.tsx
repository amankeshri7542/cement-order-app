import type { ReactNode } from 'react';
import { CommerceAlert, CommerceFeedback, CommerceProvider } from '../../components/buy/commerce';
import './buy.css';

// translate="no" here: React updates these pages often, and page translation rewrites the text it
// is updating. Public pages allow the browser to translate (decision 29).
export default function BuyLayout({ children }: { children: ReactNode }) {
  return (
    <CommerceProvider>
      <div translate="no">
        <CommerceAlert />
        {children}
        <CommerceFeedback />
      </div>
    </CommerceProvider>
  );
}
