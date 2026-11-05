/**
 * Customer words in Devanagari, so a question in Hindi is understood. This file only reads input:
 * Ask always answers in Roman script, and there is no Hindi fixed text (decision 12). It is a
 * permanent exception to the Devanagari check in plan 11, as it matches what customers type.
 */
const words: Record<string, string> = {
  // Materials and the building.
  सरिया: 'sariya',
  सीमेंट: 'cement',
  ईंट: 'eent',
  बालू: 'balu',
  रेत: 'balu',
  गिट्टी: 'gitti',
  छत: 'chhat',
  नींव: 'neev',
  नीव: 'neev',
  बीम: 'beam',
  कॉलम: 'column',
  कालम: 'column',
  खंभा: 'khamba',
  पिलर: 'pillar',
  लेंटर: 'lenter',
  लिंटर: 'lintel',
  स्लैब: 'slab',
  दीवार: 'deewar',
  दिवार: 'deewar',
  प्लास्टर: 'plaster',
  मंजिल: 'manzil',
  मंज़िल: 'manzil',
  फुटिंग: 'footing',
  मसाला: 'masala',
  मिश्रण: 'mix',
  शटरिंग: 'shuttering',
  सेंटरिंग: 'centering',
  बोरी: 'bori',
  ट्रॉली: 'trolley',
  // Trouble.
  दरार: 'daraar',
  दरारें: 'daraar',
  सीलन: 'seelan',
  झुक: 'jhuk',
  झुकी: 'jhuk',
  झुका: 'jhuk',
  गिर: 'gir',
  गिरना: 'gir',
  गिरने: 'gir',
  बढ़: 'badh',
  बढ़ती: 'badh',
  बढ़ना: 'badh',
  बिजली: 'bijli',
  करंट: 'current',
  तार: 'taar',
  आँख: 'aankh',
  आंख: 'aankh',
  चोट: 'chot',
  खून: 'khoon',
  खतरनाक: 'khatarnak',
  ख़तरनाक: 'khatarnak',
  खतरा: 'khatra',
  सुरक्षित: 'surakshit',
  // Asking how much, and doing.
  कितना: 'kitna',
  कितनी: 'kitni',
  कितने: 'kitne',
  गहरी: 'gehri',
  गहरा: 'gehra',
  गहराई: 'gehrai',
  मोटाई: 'motai',
  लगेगा: 'lagega',
  लगेगी: 'lagegi',
  लगता: 'lagta',
  लगाएं: 'lagayein',
  खोद: 'khod',
  खोदनी: 'khodni',
  खोदना: 'khodna',
  तोड़: 'tod',
  तोड़ना: 'tod',
  तोड़कर: 'tod',
  हटा: 'hata',
  हटाना: 'hata',
  रखें: 'rakhein',
  रखना: 'rakhna',
  रखे: 'rakhe',
  रखूं: 'rakhun',
  जांच: 'jaanch',
  जाँच: 'jaanch',
  // Shop, money and people.
  भाव: 'bhav',
  रेट: 'rate',
  दाम: 'daam',
  कीमत: 'rate',
  वेतन: 'salary',
  तनख्वाह: 'salary',
  कर्मचारी: 'staff',
  हाजिरी: 'attendance',
  मुनाफा: 'margin',
  दूसरे: 'doosre',
  दूसरा: 'doosre',
  दूसरी: 'doosri',
  दिखाओ: 'dikhao',
  उधार: 'udhaar',
  बाकी: 'baaki',
  खाता: 'khata',
  ऑर्डर: 'order',
  आर्डर: 'order',
  चाहिए: 'chahiye',
  छूट: 'discount',
  डिलीवरी: 'delivery',
  पिनकोड: 'pincode',
  दुकान: 'dukaan',
  नंबर: 'number',
  पता: 'pata',
  खुलती: 'khulti',
  खुलेगी: 'khulegi',
  स्टॉक: 'stock',
  इंजीनियर: 'engineer',
  मिस्त्री: 'mistri',
  ठेकेदार: 'thekedar',
  डॉक्टर: 'doctor',
  वकील: 'vakeel',
  लोन: 'loan',
  वास्तु: 'vastu',
  // Small words, so the question reads in Roman as a whole.
  क्या: 'kya',
  है: 'hai',
  हैं: 'hain',
  में: 'mein',
  और: 'aur',
  का: 'ka',
  की: 'ki',
  के: 'ke',
  को: 'ko',
  पर: 'par',
  से: 'se',
  लिए: 'liye',
  कैसे: 'kaise',
  कब: 'kab',
  कहां: 'kahan',
  कहाँ: 'kahan',
  कौन: 'kaun',
  कौनसा: 'kaunsa',
  नहीं: 'nahi',
  बताओ: 'batao',
  बताएं: 'batayein',
  सिर्फ: 'sirf',
  अंदाजा: 'andaza',
  नमस्ते: 'namaste',
  // Number words, which the sentence gate must count as numbers.
  एक: 'ek',
  दो: 'do',
  तीन: 'teen',
  चार: 'char',
  पांच: 'paanch',
  पाँच: 'paanch',
  छह: 'chhah',
  सात: 'saat',
  आठ: 'aath',
  नौ: 'nau',
  दस: 'das',
  बीस: 'bees',
  सौ: 'sau',
  हजार: 'hazaar',
  हज़ार: 'hazaar',
  डेढ़: 'dedh',
  ढाई: 'dhai',
  सवा: 'sawa',
  पौने: 'paune',
  दिन: 'din',
  दिनों: 'din',
  हफ्ते: 'hafte',
  महीने: 'mahine',
  साल: 'saal',
  इंच: 'inch',
  फीट: 'feet',
};

// NFKC splits some Devanagari letters with dots, so the table must be in the same form as the text.
const table = new Map(
  Object.entries(words).map(([hindi, roman]) => [hindi.normalize('NFKC'), roman]),
);
const longestFirst = [...table.keys()].sort((a, b) => b.length - a.length);

/** The Roman reading of each Hindi word this file knows. Unknown words stay as they are. */
export function romanizeHindi(text: string): string {
  return text.replace(/[\p{Script=Devanagari}\p{M}]+/gu, (word) => {
    const exact = table.get(word);
    if (exact) return exact;
    // "दीवारों", "खोदनी": the stem carries the meaning.
    const stem =
      word.length > 2
        ? longestFirst.find((known) => known.length > 2 && word.startsWith(known))
        : undefined;
    return stem ? table.get(stem)! : word;
  });
}

/** Devanagari digits as plain digits, so a phone number or a size cannot hide in them. */
export const plainDigits = (text: string) =>
  text.replace(/\p{Script=Devanagari}/gu, (char) => {
    const code = char.codePointAt(0)!;
    return code >= 0x0966 && code <= 0x096f ? String(code - 0x0966) : char;
  });

export const hasDevanagari = (text: string) => /\p{Script=Devanagari}/u.test(text);
