'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  ageLabel,
  errorText,
  momentLabel,
  orderStatusText,
  paymentStatusText,
  quoteStatusText,
  type Language,
} from '@shiv/shared';
import { ApiError } from './api';

// Hindi wording for errors only staff meet. Customer-facing codes come from the shared list;
// anything missing here keeps the server's reason after a Hindi prefix.
const deskErrors: Record<string, string> = {
  CONFLICT: 'किसी और ने अभी यह बदला है। रीफ़्रेश करके फिर करें।',
  INVALID_VERSION: 'यह जानकारी अभी बदली है। रीफ़्रेश करके फिर करें।',
  PRODUCT_CONFLICT: 'सामग्री अभी किसी और ने बदली है। रीफ़्रेश करके फिर करें।',
  QUOTE_CHANGED: 'भाव अभी बदला है। रीफ़्रेश करके फिर देखें।',
  STOCK_CONFLICT: 'स्टॉक अभी बदला है। रीफ़्रेश करके फिर करें।',
  INVALID_TRANSITION: 'ऑर्डर अब इस चरण में नहीं जा सकता। रीफ़्रेश करके स्थिति देखें।',
  USE_INVENTORY_MOVEMENT: 'स्टॉक बदलने के लिए "स्टॉक खाता" में एंट्री करें।',
  INVALID_ADJUSTMENT: 'यह एंट्री सही नहीं है। मात्रा और प्रकार जाँचें।',
  INVALID_PRICE: 'भाव सही नहीं है। रकम जाँचें।',
  INVALID_INPUT: 'कुछ जानकारी सही नहीं है। भरे हुए खाने जाँचें।',
  INVALID_BODY: 'कुछ जानकारी सही नहीं है। भरे हुए खाने जाँचें।',
  NOT_FOUND: 'यह चीज़ नहीं मिली। रीफ़्रेश करें।',
  INVALID_PINCODE: 'पिनकोड 6 अंकों का होना चाहिए।',
  INVALID_EXPIRY: 'भाव की आख़िरी तारीख़ आगे की होनी चाहिए।',
  INVALID_PAYMENT_STATE: 'भुगतान अब इस स्थिति में नहीं बदल सकता। रीफ़्रेश करें।',
  PAYMENT_PENDING: 'पहले पैसा मिलना दर्ज करें, फिर डिलीवर करें।',
  REFUND_REVIEW_REQUIRED: 'पैसा लौटाने से पहले भुगतान जाँचना ज़रूरी है।',
  DELIVERY_ACTION_REQUIRED: 'पहले डिलीवरी की समस्या का हल चुनें।',
  DELIVERY_CONFIRMATION_REQUIRED: 'आगे बढ़ने से पहले पुष्टि का बॉक्स चुनें।',
  INVALID_DELIVERY_ACTION: 'यह डिलीवरी कदम अभी नहीं हो सकता।',
  RETRY_DATE_REQUIRED: 'दोबारा डिलीवरी की तारीख़ चुनें।',
  RETURN_COUNTS_REQUIRED: 'हर सामग्री की वापस आई मात्रा लिखें।',
  DUPLICATE_PRODUCTS: 'एक सामग्री दो बार है। एक हटाएँ।',
  INVALID_CONTRACTOR: 'यह ठेकेदार फ़ैसला अभी नहीं हो सकता।',
  INVALID_OWNER: 'यह काम सिर्फ़ स्टाफ़ को दिया जा सकता है।',
  INVALID_CREDENTIALS: 'मोबाइल, कोड या पासफ़्रेज़ ग़लत है।',
  INVALID_OTP: 'कोड ग़लत है या पुराना हो गया। नया कोड लें।',
  OTP_UNAVAILABLE: 'अभी कोड नहीं भेज सके। थोड़ी देर बाद कोशिश करें।',
  UPLOAD_TOO_LARGE: 'फ़ाइल बहुत बड़ी है। छोटी फ़ाइल चुनें।',
  INVALID_IMAGE: 'यह फ़ोटो नहीं चल सकती। PNG, JPG या WebP चुनें।',
  STORAGE_NOT_CONFIGURED: 'फ़ोटो रखने की जगह अभी सेट नहीं है। तकनीकी व्यक्ति से बात करें।',
  PUSH_UNAVAILABLE: 'इस फ़ोन पर अलर्ट अभी सर्वर पर सेट नहीं हैं। तकनीकी व्यक्ति से बात करें।',
  PUSH_UNSUPPORTED: 'यह ब्राउज़र अलर्ट नहीं दिखा सकता। Android पर Chrome इस्तेमाल करें।',
  PUSH_DENIED: 'अलर्ट बंद हैं। ब्राउज़र की सेटिंग में Notifications चालू करें।',
};

// The owner desk speaks Hindi by default; the top bar switches every screen to English.
type LanguageValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (en: string, hi: string) => string;
};
const LanguageContext = createContext<LanguageValue | null>(null);
const key = 'shiv-owner-language';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setState] = useState<Language>('hi');
  useEffect(() => {
    try {
      setState(localStorage.getItem(key) === 'en' ? 'en' : 'hi');
    } catch {
      /* Keep this visit usable when browser storage is disabled. */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const setLanguage = useCallback((next: Language) => {
    setState(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      /* Keep this visit usable when browser storage is disabled. */
    }
  }, []);
  const t = useCallback((en: string, hi: string) => (language === 'hi' ? hi : en), [language]);
  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('LanguageProvider missing');
  return value;
}

/** Words the desk shows for statuses, ages and errors, in the chosen language. */
export function useWords() {
  const { language, t } = useLanguage();
  return {
    t,
    language,
    status: (value: string) =>
      orderStatusText(value, language) !== value
        ? orderStatusText(value, language)
        : quoteStatusText(value, language) !== value
          ? quoteStatusText(value, language)
          : paymentStatusText(value, language),
    age: (since: string | Date) => ageLabel(since, language),
    moment: (value: string) => momentLabel(value, language),
    // Owner-only errors may have no Hindi wording yet; the server's reason is kept, not hidden.
    error: (e: unknown) => {
      if (e instanceof ApiError) {
        const desk = deskErrors[e.code];
        if (language === 'hi' && desk) return desk;
        const text = errorText(e.code, language, e.message);
        return language === 'hi' && text === errorText('REQUEST_FAILED', 'hi') && e.message
          ? `काम नहीं हो सका: ${e.message}`
          : text;
      }
      // The desk's own checks throw plain errors; keep their reason rather than a generic line.
      if (e instanceof Error && e.message && !(e instanceof TypeError))
        return language === 'en' || /[\u0900-\u097F]/.test(e.message)
          ? e.message
          : `काम नहीं हो सका: ${e.message}`;
      return t('Connection failed. Please try again.', 'संपर्क नहीं हो सका। फिर कोशिश करें।');
    },
  };
}
