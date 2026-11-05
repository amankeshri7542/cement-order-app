// Only approved public copy belongs here. See docs/V2_CUSTOMER_FEATURE_PARITY.md for provenance.
export const shopContent = {
  name: 'Shiv Cement Store',
  city: 'Patna, Bihar',
  story: {
    en: 'A family shop for the materials your next project needs.',
    hi: 'आपके अगले निर्माण के लिए सामग्री की पारिवारिक दुकान।',
  },
  contactApproved: false,
  phone: '',
  whatsapp: '',
  address: '',
  hours: '',
  directionsUrl: '',
  family: [] as { name: string; role: string; image: string }[],
  gallery: [] as { title: string; image: string; alt: string }[],
  credentials: [] as { title: string; issuer: string; image: string }[],
  pending: ['family history', 'shop photographs', 'credentials', 'contact details'],
};
