'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { customerApi, errorText, localPhone } from '../lib/customer-api';
import { Delivery } from './delivery';
import { EnquiryForm } from './enquiry';
import { useLanguage } from './language';
import { ReviewNote, ShopContact, ShopContent } from './shop-content';

// The public information pages. Every sentence here describes something the system really does
// today: nothing about the shop's history, awards, speed or reach is claimed until the family has
// approved it (apps/api/src/public-content.ts, docs/FAMILY_CONTENT_CHECKLIST.md).

function Heading({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="page-heading">
      <h1>{title}</h1>
      {lead ? <p>{lead}</p> : null}
    </div>
  );
}
function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="info-block" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

export function AboutPage() {
  const { t } = useLanguage();
  return (
    <div className="info-page">
      <Heading
        title={t('About Shiv Cement Store', 'शिव सीमेंट स्टोर के बारे में')}
        lead={t(
          'A shop in Patna for the materials your next project needs, with the rate and the selling unit in plain sight.',
          'पटना की दुकान, आपके अगले निर्माण की सामग्री के लिए, भाव और बिक्री इकाई साफ़ दिखाते हुए।',
        )}
      />
      <Block id="sell" title={t('What we sell', 'हम क्या बेचते हैं')}>
        <p>
          {t(
            'Cement, steel bars, bricks, sand and stone chips. Each material shows its brand, grade, pack size and selling unit beside the price, so you can compare like with like.',
            'सीमेंट, सरिया, ईंट, बालू और गिट्टी। हर सामग्री के भाव के साथ उसका ब्रांड, ग्रेड, पैक और बिक्री इकाई दिखती है, ताकि बराबर की चीज़ों की तुलना हो सके।',
          )}
        </p>
        <p>
          <Link className="text-link" href="/products">
            {t('See all materials', 'सारी सामग्री देखें')} →
          </Link>
        </p>
      </Block>
      <Block id="buy" title={t('How buying works', 'खरीदना कैसे होता है')}>
        <ol className="steps">
          <li>
            {t(
              'Check the rate and your site’s pincode. The delivery fee, minimum order and estimate for that pincode are shown before you order.',
              'भाव देखें और अपनी साइट का पिनकोड जाँचें। उस पिनकोड का डिलीवरी शुल्क, न्यूनतम ऑर्डर और अनुमान ऑर्डर से पहले दिखता है।',
            )}
          </li>
          <li>
            {t(
              'Add materials to the basket. The full total, delivery included, is shown before you confirm. Basket orders are paid in cash on delivery.',
              'सामग्री टोकरी में डालें। पक्का करने से पहले डिलीवरी सहित पूरा कुल दिखता है। टोकरी के ऑर्डर का भुगतान डिलीवरी पर नकद होता है।',
            )}
          </li>
          <li>
            {t(
              'For truck-sized quantities, send one list. The shop replies in writing with item prices, freight and an expiry date.',
              'ट्रक भर मात्रा के लिए एक सूची भेजें। दुकान हर सामग्री का भाव, भाड़ा और समय-सीमा लिखकर जवाब देती है।',
            )}
          </li>
        </ol>
      </Block>
      <Block id="guide" title={t('Before you choose', 'चुनने से पहले')}>
        {/* The same wording as the shop's approved answers in apps/api/src/public-content.ts. */}
        <p>
          {t(
            'Compare the same grade, pack size and selling unit. A bag, kilogram, tonne and piece are different units; ask the shop if the pack is not specified.',
            'समान ग्रेड, पैक और बिक्री इकाई की तुलना करें। बैग, किलो, टन और पीस अलग इकाइयाँ हैं। पैक दर्ज न हो तो दुकान से पूछें।',
          )}
        </p>
        <p>
          {t(
            'For structural design, mix proportions, load-bearing work or reinforcement selection, ask a qualified engineer. Product availability is not engineering approval.',
            'ढाँचे, मिक्स अनुपात, भार उठाने वाले काम या सरिया चुनने के लिए योग्य इंजीनियर से सलाह लें। सामग्री उपलब्ध होना तकनीकी मंज़ूरी नहीं है।',
          )}
        </p>
      </Block>
      <ShopContent />
    </div>
  );
}

export function DeliveryPage() {
  const { t } = useLanguage();
  return (
    <div className="info-page">
      <Heading
        title={t('Delivery', 'डिलीवरी')}
        lead={t(
          'Enter your site’s pincode to see whether the shop delivers there, and what it costs.',
          'अपनी साइट का पिनकोड डालें और देखें कि दुकान वहाँ डिलीवरी करती है या नहीं, और कितने में।',
        )}
      />
      <Delivery />
      <Block id="how" title={t('How delivery works', 'डिलीवरी कैसे होती है')}>
        <p>
          {t(
            'Check your site pincode. Checkout shows the current delivery fee, minimum order and delivery estimate before you confirm.',
            'काम की जगह का पिनकोड जाँचें। पुष्टि से पहले चेकआउट में मौजूदा डिलीवरी शुल्क, न्यूनतम ऑर्डर और डिलीवरी का अनुमान दिखता है।',
          )}
        </p>
        <p>
          {t(
            'Basket orders are paid in cash on delivery. The delivery estimate shown for your pincode is set by the shop.',
            'टोकरी के ऑर्डर का भुगतान डिलीवरी पर नकद होता है। आपके पिनकोड के लिए दिखने वाला डिलीवरी का अनुमान दुकान तय करती है।',
          )}
        </p>
        <p>
          {t(
            'For a bulk requirement, build a material list and request a quotation. An estimate or accepted quotation is not a confirmed order; the shop must convert the agreed offer.',
            'थोक ज़रूरत के लिए सामग्री सूची बनाकर भाव माँगें। अनुमान या स्वीकार किया भाव पक्का ऑर्डर नहीं है; दुकान सहमत प्रस्ताव से ऑर्डर बनाती है।',
          )}
        </p>
        <p className="action-row">
          <Link className="button" href="/products">
            {t('Shop materials', 'सामग्री खरीदें')} →
          </Link>
          <Link className="button secondary" href="/quotes">
            {t('Request bulk quote', 'थोक भाव माँगें')}
          </Link>
        </p>
      </Block>
    </div>
  );
}

export function ContactPage() {
  const { t } = useLanguage();
  return (
    <div className="info-page">
      <Heading
        title={t('Contact the shop', 'दुकान से संपर्क')}
        lead={t(
          'Ask about a material, its selling unit or delivery. Leave your number and the shop will contact you.',
          'किसी सामग्री, उसकी बिक्री इकाई या डिलीवरी के बारे में पूछें। अपना नंबर छोड़ें, दुकान आपसे संपर्क करेगी।',
        )}
      />
      <ShopContact />
      <section className="info-block" id="enquiry" aria-labelledby="enquiry-title">
        <h2 id="enquiry-title">{t('Send an enquiry', 'पूछताछ भेजें')}</h2>
        <Suspense>
          <EnquiryForm />
        </Suspense>
        <ReviewNote>
          Enquiries reach the owner desk’s Today screen. Phone numbers, address, opening hours and
          directions appear above only once the family sets <code>contactApproved: true</code> in{' '}
          <code>apps/api/src/public-content.ts</code>.
        </ReviewNote>
      </section>
    </div>
  );
}

export function PrivacyPage() {
  const { t } = useLanguage();
  return (
    <div className="info-page">
      <Heading
        title={t('Privacy, in plain language', 'निजता, सरल भाषा में')}
        lead={t('Last updated 21 October 2026.', 'आख़िरी बदलाव: 21 अक्टूबर 2026।')}
      />
      <Block id="collect" title={t('What we collect and why', 'हम क्या लेते हैं और क्यों')}>
        <p>
          {t(
            'Shiv Cement Store runs this website and the customer app for its customers in Patna and Bihar. We use your mobile number to sign you in and to send order updates; your name and delivery address to fulfil orders; and your basket, orders and quotation requests to give you prices, deliveries and support.',
            'शिव सीमेंट स्टोर यह वेबसाइट और ग्राहक ऐप पटना और बिहार के ग्राहकों के लिए चलाती है। आपका मोबाइल नंबर साइन इन और ऑर्डर की जानकारी के लिए, नाम और डिलीवरी का पता ऑर्डर पूरा करने के लिए, और आपकी टोकरी, ऑर्डर व भाव के अनुरोध भाव, डिलीवरी और सहायता देने के लिए इस्तेमाल होते हैं।',
          )}
        </p>
        <p>
          {t(
            'If you send an enquiry through the Contact page, we keep your name, number, pincode and message so the shop can reply. A handled enquiry is deleted after 180 days and an unanswered one after one year.',
            'अगर आप संपर्क पेज से पूछताछ भेजते हैं, तो दुकान के जवाब देने के लिए आपका नाम, नंबर, पिनकोड और संदेश रखा जाता है। जवाब दी जा चुकी पूछताछ 180 दिन बाद और बिना जवाब वाली एक साल बाद हटा दी जाती है।',
          )}
        </p>
        <p>
          {t(
            'If you turn on Android notifications, we store the notification token of your phone. Signing out removes it. We keep protected session credentials and limited device or browser labels for account security. Sign-in abuse counters use hashed network identifiers, not raw IP addresses.',
            'अगर आप Android सूचनाएँ चालू करते हैं, तो आपके फ़ोन का सूचना टोकन रखा जाता है; साइन आउट करने पर वह हट जाता है। खाते की सुरक्षा के लिए सुरक्षित सत्र की जानकारी और डिवाइस या ब्राउज़र का सीमित नाम रखा जाता है। साइन इन के दुरुपयोग की गिनती में असली IP पता नहीं, हैश किया हुआ पहचान-चिह्न इस्तेमाल होता है।',
          )}
        </p>
      </Block>
      <Block id="cookies" title={t('Cookies and storage', 'कुकी और स्टोरेज')}>
        <p>
          {t(
            'The website uses only what it needs: sign-in cookies when you sign in, a cookie and local storage that remember your language, and local storage for your basket and last checked pincode. There are no advertising or tracking cookies.',
            'वेबसाइट सिर्फ़ ज़रूरी चीज़ें इस्तेमाल करती है: साइन इन करने पर साइन इन कुकी, आपकी भाषा याद रखने के लिए एक कुकी और लोकल स्टोरेज, और आपकी टोकरी व आख़िरी जाँचे पिनकोड के लिए लोकल स्टोरेज। विज्ञापन या ट्रैकिंग कुकी नहीं हैं।',
          )}
        </p>
      </Block>
      <Block id="providers" title={t('Service providers', 'सेवा देने वाली कंपनियाँ')}>
        <p>
          {t(
            'When configured, an SMS provider delivers sign-in codes, Firebase delivers app notifications, an error-reporting service receives crash reports with personal details removed, and our hosting and storage providers run the service. Delivery details are shared with the shop and the people delivering your order. We do not sell customer data or use advertising trackers.',
            'चालू होने पर, एक SMS कंपनी साइन इन कोड भेजती है, Firebase ऐप की सूचनाएँ पहुँचाता है, एक त्रुटि-रिपोर्ट सेवा निजी जानकारी हटाकर क्रैश रिपोर्ट लेती है, और हमारी होस्टिंग व स्टोरेज कंपनियाँ सेवा चलाती हैं। डिलीवरी की जानकारी दुकान और आपका ऑर्डर पहुँचाने वालों के साथ साझा होती है। हम ग्राहकों का डेटा बेचते नहीं हैं और विज्ञापन ट्रैकर इस्तेमाल नहीं करते।',
          )}
        </p>
        <p>
          {t(
            'Basket orders are paid in cash on delivery, so we do not collect card numbers or UPI PINs.',
            'टोकरी के ऑर्डर का भुगतान डिलीवरी पर नकद होता है, इसलिए हम कार्ड नंबर या UPI PIN नहीं लेते।',
          )}
        </p>
        <p>
          {t(
            'Shiv Assistant answers questions about materials. If the shop switches on its AI service, the question you type or speak is sent as text to OpenAI to prepare the answer, without your name, number or account, and OpenAI is asked not to store it. Please do not include personal details in a question.',
            'शिव सहायक सामग्री के बारे में सवालों के जवाब देता है। अगर दुकान इसकी AI सेवा चालू करती है, तो आपका लिखा या बोला सवाल जवाब तैयार करने के लिए लिखित रूप में OpenAI को भेजा जाता है, आपके नाम, नंबर या खाते के बिना, और OpenAI से इसे न रखने को कहा जाता है। कृपया सवाल में निजी जानकारी न लिखें।',
          )}
        </p>
      </Block>
      <Block id="choices" title={t('Your choices', 'आपके विकल्प')}>
        <p>
          {t(
            'You can edit your profile, remove saved addresses, turn off notifications in your phone’s settings, review signed-in devices and sign them out. To close your account, use Account → Delete account in the app, or the deletion page below.',
            'आप अपनी प्रोफ़ाइल बदल सकते हैं, सहेजे पते हटा सकते हैं, फ़ोन की सेटिंग में सूचनाएँ बंद कर सकते हैं, साइन इन डिवाइस देखकर उन्हें साइन आउट कर सकते हैं। खाता बंद करने के लिए ऐप में खाता → खाता हटाएँ, या नीचे दिया हटाने का पेज इस्तेमाल करें।',
          )}
        </p>
        <p>
          <Link className="button secondary" href="/delete-account">
            {t('Request account deletion', 'खाता हटाने का अनुरोध')}
          </Link>
        </p>
      </Block>
      <Block id="deletion" title={t('Deletion and what is kept', 'हटाना और क्या रखा जाता है')}>
        <p>
          {t(
            'Deleting your account signs out every device and removes your saved addresses, basket, notifications and profile details, and clears personal contact and address details and notes from saved orders and quotations. Order totals, items, payment references and audit entries stay without your personal details, for the shop’s accounts and records. Provider records and backup copies follow their own retention schedules. Open orders and refunds, and any khata (credit) balance, must be settled first; contact the shop for help.',
            'खाता हटाने पर हर डिवाइस साइन आउट हो जाता है, और आपके सहेजे पते, टोकरी, सूचनाएँ और प्रोफ़ाइल की जानकारी हट जाती है; सहेजे ऑर्डर और भाव के अनुरोधों से निजी संपर्क, पता और नोट साफ़ हो जाते हैं। ऑर्डर का कुल, सामान, भुगतान के संदर्भ और ऑडिट की प्रविष्टियाँ आपकी निजी जानकारी के बिना दुकान के हिसाब और रिकॉर्ड के लिए रहती हैं। कंपनियों के रिकॉर्ड और बैकअप अपनी अवधि के हिसाब से रहते हैं। खुले ऑर्डर और रिफ़ंड, और खाते (उधार) का कोई भी बाकी पहले निपटाना होगा; मदद के लिए दुकान से संपर्क करें।',
          )}
        </p>
      </Block>
      <Block id="contact" title={t('Contact', 'संपर्क')}>
        <p>
          {t(
            'For privacy questions, or help if you no longer have the phone number on your account, use the Contact page.',
            'निजता के सवालों के लिए, या अगर खाते वाला फ़ोन नंबर अब आपके पास नहीं है, तो संपर्क पेज इस्तेमाल करें।',
          )}{' '}
          <Link className="text-link" href="/contact">
            {t('Contact the shop', 'दुकान से संपर्क')} →
          </Link>
        </p>
        <ReviewNote>
          The shop must document its legal retention period and backup expiry with its providers
          before launch, and this page must match what is deployed
          (docs/FAMILY_CONTENT_CHECKLIST.md, C9 and C10).
        </ReviewNote>
      </Block>
    </div>
  );
}

export function TermsPage() {
  const { t } = useLanguage();
  return (
    <div className="info-page">
      <Heading
        title={t('How ordering works', 'ऑर्डर कैसे काम करता है')}
        lead={t(
          'The terms of this service in plain language. Last updated 21 October 2026.',
          'इस सेवा की शर्तें सरल भाषा में। आख़िरी बदलाव: 21 अक्टूबर 2026।',
        )}
      />
      <Block id="prices" title={t('Prices and availability', 'भाव और उपलब्धता')}>
        <p>
          {t(
            'Prices and stock shown on the website and in the app are the shop’s current ones. The total you pay, with delivery, is shown before you confirm an order. If a price or stock changes while you are ordering, you are asked to review the new total before it is placed.',
            'वेबसाइट और ऐप पर दिखने वाले भाव और स्टॉक दुकान के मौजूदा हैं। ऑर्डर पक्का करने से पहले डिलीवरी सहित कुल दिखता है। ऑर्डर देते समय भाव या स्टॉक बदले, तो ऑर्डर लगने से पहले नया कुल देखने को कहा जाता है।',
          )}
        </p>
      </Block>
      <Block id="payment" title={t('Payment', 'भुगतान')}>
        <p>
          {t(
            'Basket orders are paid in cash on delivery. Online payment is not offered.',
            'टोकरी के ऑर्डर का भुगतान डिलीवरी पर नकद होता है। ऑनलाइन भुगतान की सुविधा नहीं है।',
          )}
        </p>
      </Block>
      <Block id="delivery" title={t('Delivery', 'डिलीवरी')}>
        <p>
          {t(
            'Each pincode has its own delivery fee, minimum order and estimate, shown on the Delivery page and in the basket before you confirm.',
            'हर पिनकोड का अपना डिलीवरी शुल्क, न्यूनतम ऑर्डर और अनुमान है, जो डिलीवरी पेज पर और पक्का करने से पहले टोकरी में दिखता है।',
          )}
        </p>
      </Block>
      <Block id="cancel" title={t('Cancelling and returns', 'रद्द करना और वापसी')}>
        <p>
          {t(
            'You can cancel an order yourself in the app or on the website until the shop starts preparing it. After that, contact the shop. If a delivery cannot be completed, or goods come back, the shop records what happened and what returned to stock.',
            'दुकान के माल तैयार करना शुरू करने तक आप ऐप या वेबसाइट पर ऑर्डर खुद रद्द कर सकते हैं। उसके बाद दुकान से संपर्क करें। अगर डिलीवरी पूरी न हो सके या माल वापस आए, तो दुकान दर्ज करती है कि क्या हुआ और कितना माल वापस स्टॉक में गया।',
          )}
        </p>
      </Block>
      <Block id="quotes" title={t('Bulk quotes', 'थोक भाव')}>
        <p>
          {t(
            'A quotation request is not an order. The shop replies in writing with item prices, freight and an expiry date. An accepted quotation becomes an order only when the shop converts the agreed offer; a changed offer needs your approval again.',
            'भाव का अनुरोध ऑर्डर नहीं है। दुकान हर सामग्री का भाव, भाड़ा और समय-सीमा लिखकर जवाब देती है। स्वीकार किया भाव तभी ऑर्डर बनता है जब दुकान सहमत प्रस्ताव से ऑर्डर बनाए; प्रस्ताव बदले तो आपकी मंज़ूरी फिर चाहिए।',
          )}
        </p>
      </Block>
      <Block id="advice" title={t('Technical advice', 'तकनीकी सलाह')}>
        <p>
          {t(
            'For structural design, mix proportions, load-bearing work or reinforcement selection, ask a qualified engineer. A material being available is not engineering approval.',
            'ढाँचे, मिक्स अनुपात, भार उठाने वाले काम या सरिया चुनने के लिए योग्य इंजीनियर से सलाह लें। सामग्री उपलब्ध होना तकनीकी मंज़ूरी नहीं है।',
          )}
        </p>
      </Block>
      <Block id="account" title={t('Your account', 'आपका खाता')}>
        <p>
          {t(
            'You sign in with your mobile number and a code sent by SMS. Keep the code to yourself. You can delete your account at any time (see the privacy page).',
            'आप मोबाइल नंबर और SMS से आए कोड से साइन इन करते हैं। कोड किसी को न बताएँ। आप कभी भी अपना खाता हटा सकते हैं (निजता पेज देखें)।',
          )}{' '}
          <Link className="text-link" href="/privacy">
            {t('Privacy', 'निजता')} →
          </Link>
        </p>
        <ReviewNote>
          Plain-language summary of the service as it works today. The family should approve it, or
          replace it with the shop’s own terms, before launch (docs/FAMILY_CONTENT_CHECKLIST.md,
          C10).
        </ReviewNote>
      </Block>
    </div>
  );
}

/** Public account deletion: the Play Store link and anyone without the app can use it. */
export function DeleteAccountPage() {
  const { t, language } = useLanguage();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [sent, setSent] = useState(false);
  const [signedInAs, setSignedInAs] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  // Each step takes keyboard and screen-reader users to what it asks for next.
  const codeRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (sent) codeRef.current?.focus();
  }, [sent]);
  useEffect(() => {
    if (signedInAs) confirmRef.current?.focus();
  }, [signedInAs]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (signedInAs) {
        await customerApi('/me/delete', 'POST', { confirmation });
        setDone(true);
        setSignedInAs('');
      } else if (sent) {
        const result = await customerApi<{ user: { phone: string } }>('/auth/otp/verify', 'POST', {
          phone: `+91${phone}`,
          code,
        });
        setSignedInAs(result.user.phone);
      } else {
        const result = await customerApi<{ devCode?: string }>('/auth/otp/request', 'POST', {
          phone: `+91${phone}`,
        });
        setDevCode(result.devCode || '');
        setSent(true);
      }
    } catch (e) {
      setError(errorText(e, language === 'hi'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="info-page">
      <Heading
        title={t('Delete your account', 'अपना खाता हटाएँ')}
        lead={t(
          'You can make this request here without installing the app. Verify the mobile number of the account you want to delete.',
          'आप यह अनुरोध यहीं कर सकते हैं, ऐप के बिना। जिस खाते को हटाना है उसका मोबाइल नंबर सत्यापित करें।',
        )}
      />
      <p>
        {t(
          'Deleting your account signs out every device and removes your saved addresses, basket, notifications and profile details. De-identified order and audit records remain. Open deliveries and refunds, and any khata (credit) balance with the shop, must be settled first.',
          'खाता हटाने पर हर डिवाइस साइन आउट हो जाता है और आपके सहेजे पते, टोकरी, सूचनाएँ और प्रोफ़ाइल की जानकारी हट जाती है। निजी जानकारी के बिना ऑर्डर और ऑडिट रिकॉर्ड रहते हैं। खुली डिलीवरी और रिफ़ंड, और दुकान के साथ खाते (उधार) का कोई भी बाकी पहले निपटाना होगा।',
        )}{' '}
        <Link className="text-link" href="/privacy">
          {t('Read the privacy page', 'निजता पेज पढ़ें')}
        </Link>
      </p>
      {done ? (
        <p className="account-form" role="status" ref={doneRef} tabIndex={-1}>
          {t(
            'Your account has been deleted and its sessions ended.',
            'आपका खाता हटा दिया गया है और उसके सभी सत्र बंद हो गए हैं।',
          )}
        </p>
      ) : (
        <form className="account-form" onSubmit={(event) => void submit(event)} aria-busy={busy}>
          {!signedInAs ? (
            <>
              <label>
                {t('Mobile number (+91)', 'मोबाइल नंबर (+91)')}
                <input
                  type="tel"
                  autoComplete="tel"
                  placeholder="9876543210"
                  required
                  pattern="[6-9][0-9]{9}"
                  disabled={!ready || sent || busy}
                  value={phone}
                  onChange={(event) => setPhone(localPhone(event.target.value))}
                />
              </label>
              {sent && (
                <label>
                  {t('Verification code', 'सत्यापन कोड')}
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    ref={codeRef}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </label>
              )}
              {devCode && (
                <p className="local-notice">
                  {t(
                    'Local test only. No SMS sent. Test code:',
                    'केवल स्थानीय परीक्षण। SMS नहीं भेजा गया। परीक्षण कोड:',
                  )}{' '}
                  <strong>{devCode}</strong>
                </p>
              )}
            </>
          ) : (
            <>
              <p>
                {t(
                  `Signed in as ${signedInAs}. This cannot be undone.`,
                  `${signedInAs} से साइन इन। यह वापस नहीं हो सकता।`,
                )}
              </p>
              <label>
                {t('Type DELETE to confirm', 'पक्का करने के लिए DELETE लिखें')}
                <input
                  ref={confirmRef}
                  value={confirmation}
                  pattern="DELETE"
                  required
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
            </>
          )}
          {error && (
            <p className="error-text" role="alert" ref={errorRef} tabIndex={-1}>
              {error}
            </p>
          )}
          <button className="button" disabled={!ready || busy}>
            {busy
              ? t('Please wait…', 'कृपया रुकें…')
              : signedInAs
                ? t('Delete my account', 'मेरा खाता हटाएँ')
                : sent
                  ? t('Verify the number', 'नंबर सत्यापित करें')
                  : t('Get verification code', 'सत्यापन कोड पाएँ')}
          </button>
          {sent && !signedInAs && (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setSent(false);
                setCode('');
                setDevCode('');
              }}
            >
              {t('Change number / resend code', 'नंबर बदलें / फिर कोड भेजें')}
            </button>
          )}
        </form>
      )}
    </div>
  );
}
