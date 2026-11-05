// PLACEHOLDER: the family's awards. Nothing shows to customers until a real certificate is here.
//
// For each real certificate: photograph it straight on in daylight, put the file in
// apps/storefront/art/awards/, import it, and copy the brand, year and wording exactly as printed.
// Nothing is claimed beyond what the certificate says, and no separate logo wall is added.
//
//   import nuvoco2025 from '../art/awards/nuvoco-2025.avif';
//   { id: 'nuvoco-2025', brand: 'Nuvoco', year: '2025', wording: '...', photo: nuvoco2025, alt: '...' }
import type { StaticImageData } from 'next/image';

export type Certificate = {
  id: string;
  brand: string;
  year: string;
  /** The exact printed words. */
  wording: string;
  photo: StaticImageData;
  /** What the photo shows, for people who cannot see it. */
  alt: string;
};
export const certificates: Certificate[] = [];

/** What the family told us (plan 13). Shown only to reviewers, as the slots to fill. */
export const awardSlots = [
  {
    brand: 'Nuvoco',
    note: 'Top 5 in Bihar, as the family told us. Year and wording come from the certificate.',
  },
  {
    brand: 'Ambuja',
    note: 'Top 5 in Bihar, as the family told us. Year and wording come from the certificate.',
  },
  { brand: 'Other brands', note: 'Every certificate the family wants to show.' },
];
export const awardsLive = () => certificates.length > 0;
