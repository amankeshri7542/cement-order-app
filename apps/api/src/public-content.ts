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

export const materialFaqs = [
  {
    id: 'units',
    en: 'Compare the same grade, pack size and selling unit. A bag, kilogram, tonne and piece are different units; ask the shop if the pack is not specified.',
    hi: 'समान ग्रेड, पैक और बिक्री इकाई की तुलना करें। बैग, किलो, टन और पीस अलग इकाइयाँ हैं। पैक दर्ज न हो तो दुकान से पूछें।',
  },
  {
    id: 'delivery',
    en: 'Check your site pincode. Checkout shows the current delivery fee, minimum order and delivery estimate before you confirm.',
    hi: 'काम की जगह का पिनकोड जाँचें। पुष्टि से पहले चेकआउट में मौजूदा डिलीवरी शुल्क, न्यूनतम ऑर्डर और अनुमान दिखता है।',
  },
  {
    id: 'quotes',
    en: 'For a bulk requirement, build a material list and request a quotation. An estimate or accepted quotation is not a confirmed order; the shop must convert the agreed offer.',
    hi: 'थोक ज़रूरत के लिए सामग्री सूची बनाकर भाव माँगें। अनुमान या स्वीकार किया भाव पक्का ऑर्डर नहीं है; दुकान सहमत प्रस्ताव से ऑर्डर बनाती है।',
  },
  {
    id: 'engineering',
    en: 'For structural design, mix proportions, load-bearing work or reinforcement selection, ask a qualified engineer. Product availability is not engineering approval.',
    hi: 'ढाँचे, मिक्स अनुपात, भार उठाने वाले काम या सरिया चुनने के लिए योग्य इंजीनियर से सलाह लें। सामग्री उपलब्ध होना तकनीकी मंज़ूरी नहीं है।',
  },
] as const;
