import { pick, type Bilingual, type Language } from './i18n';

// Every error code the API or clients can produce. apps/api/test/error-codes.test.ts fails if
// the API throws a code that is missing here, so new codes cannot reach customers unnoticed.
export const errorCodes = [
  'ACCOUNT_CHANGED',
  'ACTIVE_ORDERS',
  'ADDRESS_LIMIT',
  'ADMIN_SETUP_REQUIRED',
  'ALIAS_CONFLICT',
  'ASSISTANT_TOOL_DENIED',
  'ASSISTANT_TOOL_INVALID',
  'BATCH_CONFLICT',
  'BATCH_LOCKED',
  'BATCH_NOT_PUBLISHED',
  'BATCH_PROCESSING',
  'CARD_PRICES_CHANGED',
  'CARD_RENDER_FAILED',
  'CART_CHANGED',
  'CART_LIMIT',
  'CONFLICT',
  'CUSTOMER_DELETED',
  'DATABASE_UNAVAILABLE',
  'DELIVERY_ACTION_REQUIRED',
  'DELIVERY_CONFIRMATION_REQUIRED',
  'DELIVERY_MINIMUM',
  'DEMAND_PAUSED',
  'DEMAND_REVIEW_REQUIRED',
  'DRAINING',
  'DUPLICATE_PRODUCTS',
  'EMPTY_BATCH',
  'EMPTY_CART',
  'EVENT_CONFLICT',
  'EXTRACTION_BUDGET',
  'EXTRACTION_BUSY',
  'EXTRACTION_EXISTS',
  'EXTRACTION_LIMIT',
  'EXTRACTION_PAUSED',
  'FORBIDDEN',
  'IDEMPOTENCY_CONFLICT',
  'INTERNAL_ERROR',
  'INVALID_ADDRESS',
  'INVALID_ADJUSTMENT',
  'INVALID_BODY',
  'INVALID_CONTRACTOR',
  'INVALID_CREDENTIALS',
  'INVALID_CURSOR',
  'INVALID_DELIVERY_ACTION',
  'INVALID_DELIVERY_DATE',
  'INVALID_EVENT',
  'INVALID_EXPIRY',
  'INVALID_FILENAME',
  'INVALID_FILTER',
  'INVALID_FORMAT',
  'INVALID_IMAGE',
  'INVALID_INPUT',
  'INVALID_OTP',
  'INVALID_OWNER',
  'INVALID_PAGE',
  'INVALID_PAYMENT_STATE',
  'INVALID_PINCODE',
  'INVALID_PRICE',
  'INVALID_PRODUCTS',
  'INVALID_QUANTITY',
  'INVALID_ROW',
  'INVALID_SIGNATURE',
  'INVALID_TRANSITION',
  'INVALID_VERSION',
  'NETWORK_ERROR',
  'NOT_FOUND',
  'NOT_SERVICEABLE',
  'ORDER_NOT_FOUND',
  'OTP_UNAVAILABLE',
  'OUT_OF_STOCK',
  'PAYMENTS_NOT_CONFIGURED',
  'PAYMENTS_UNAVAILABLE',
  'PAYMENT_CONFLICT',
  'PAYMENT_GATEWAY_ERROR',
  'PAYMENT_MISMATCH',
  'PAYMENT_NOT_FOUND',
  'PAYMENT_PENDING',
  'PRICE_CHANGED',
  'PRODUCT_CONFLICT',
  'PUSH_UNAVAILABLE',
  'QUOTE_CHANGED',
  'RATE_LIMITED',
  'RATE_SOURCE_INVALID',
  'RATE_SOURCE_KEY',
  'RATE_SOURCE_SIZE',
  'RATE_SOURCE_TYPE',
  'RATE_STORAGE_NOT_CONFIGURED',
  'RATE_STORAGE_READ_FAILED',
  'RATE_STORAGE_WRITE_FAILED',
  'REFUND_REVIEW_REQUIRED',
  'REQUEST_FAILED',
  'RESOURCE_BUSY',
  'RESOURCE_LIMIT',
  'RETRY_DATE_REQUIRED',
  'RETURN_COUNTS_REQUIRED',
  'REVIEW_EXPIRED',
  'REVIEW_REQUIRED',
  'SOURCE_LOCKED',
  'SOURCE_REQUIRED',
  'SOURCE_UPLOAD_FAILED',
  'STAFF_ACCOUNT',
  'STOCK_CONFLICT',
  'STORAGE_NOT_CONFIGURED',
  'STORAGE_UNAVAILABLE',
  'UNAPPROVED_ASSET',
  'UNAUTHORIZED',
  'UPLOADS_PAUSED',
  'UPLOAD_TOO_LARGE',
  'USE_INVENTORY_MOVEMENT',
  // Money and stock records.
  'ORDER_TOO_LARGE',
  // Infra hardening: owner-desk web push.
  'INVALID_PUSH_ENDPOINT',
] as const;
export type ErrorCode = (typeof errorCodes)[number];

// Codes a customer can meet in the app or on the website. Each must read naturally in both
// languages: they tell the customer what happened and what to do next.
export const customerErrorCodes = [
  'NETWORK_ERROR',
  'REQUEST_FAILED',
  'INTERNAL_ERROR',
  'DATABASE_UNAVAILABLE',
  'DRAINING',
  'UNAUTHORIZED',
  'ACCOUNT_CHANGED',
  'FORBIDDEN',
  'OUT_OF_STOCK',
  'INVALID_QUANTITY',
  'RESOURCE_LIMIT',
  'RESOURCE_BUSY',
  'DEMAND_REVIEW_REQUIRED',
  'PRICE_CHANGED',
  'CART_CHANGED',
  'CART_LIMIT',
  'EMPTY_CART',
  'REVIEW_EXPIRED',
  'INVALID_ADDRESS',
  'ADDRESS_LIMIT',
  'INVALID_PINCODE',
  'NOT_SERVICEABLE',
  'DELIVERY_MINIMUM',
  'INVALID_DELIVERY_DATE',
  'INVALID_OTP',
  'OTP_UNAVAILABLE',
  'RATE_LIMITED',
  'NOT_FOUND',
  'ORDER_NOT_FOUND',
  'QUOTE_CHANGED',
  'INVALID_INPUT',
  'INVALID_BODY',
  'INVALID_TRANSITION',
  'IDEMPOTENCY_CONFLICT',
  'CONFLICT',
  'PAYMENTS_UNAVAILABLE',
  'STAFF_ACCOUNT',
  'CUSTOMER_DELETED',
  'ACTIVE_ORDERS',
  'DEMAND_PAUSED',
  // Money and stock records.
  'ORDER_TOO_LARGE',
  // Infra hardening: owner-desk web push.
  'INVALID_PUSH_ENDPOINT',
] as const satisfies readonly ErrorCode[];
export type CustomerErrorCode = (typeof customerErrorCodes)[number];

// Replies to "place order" that prove no order was created, so the app and website may forget the
// pending request. The API checks these inside the order transaction before it writes anything.
// Every other failure (network, 5xx, CONFLICT, IDEMPOTENCY_CONFLICT) keeps the request so the
// customer can check the result instead of ordering twice.
export const checkoutRefusalCodes = [
  'PRICE_CHANGED',
  'OUT_OF_STOCK',
  'REVIEW_EXPIRED',
  'CART_CHANGED',
  'PAYMENTS_UNAVAILABLE',
  'INVALID_DELIVERY_DATE',
  'EMPTY_CART',
  'INVALID_ADDRESS',
  'NOT_SERVICEABLE',
  'DELIVERY_MINIMUM',
  'INVALID_QUANTITY',
  'ORDER_TOO_LARGE',
  // Booking limits and the owner's pause switch (apps/api/src/abuse.ts).
  'DEMAND_REVIEW_REQUIRED',
  'DEMAND_PAUSED',
  'RESOURCE_LIMIT',
] as const satisfies readonly CustomerErrorCode[];

export function isCheckoutRefusal(code: string | undefined) {
  return (checkoutRefusalCodes as readonly string[]).includes(code ?? '');
}

export const customerErrors: Record<CustomerErrorCode, Bilingual> = {
  NETWORK_ERROR: [
    'The response could not be confirmed. Check your connection and retry.',
    'जवाब की पुष्टि नहीं हुई। इंटरनेट जाँचकर फिर कोशिश करें।',
  ],
  REQUEST_FAILED: [
    'Could not complete the request. Check the entered details and try again.',
    'अनुरोध पूरा नहीं हुआ। जानकारी जाँचें और फिर कोशिश करें।',
  ],
  INTERNAL_ERROR: [
    'Something went wrong at the shop’s end. Please try again.',
    'दुकान की ओर से कुछ गड़बड़ हुई। कृपया फिर कोशिश करें।',
  ],
  DATABASE_UNAVAILABLE: [
    'The shop’s system is busy for a moment. Try again shortly.',
    'दुकान का सिस्टम कुछ देर के लिए व्यस्त है। थोड़ी देर बाद कोशिश करें।',
  ],
  DRAINING: [
    'The shop’s system is restarting. Try again in a few seconds.',
    'दुकान का सिस्टम फिर से शुरू हो रहा है। कुछ सेकंड बाद कोशिश करें।',
  ],
  UNAUTHORIZED: [
    'Your session ended. Sign in again to continue.',
    'सत्र समाप्त हुआ। जारी रखने के लिए फिर साइन इन करें।',
  ],
  ACCOUNT_CHANGED: [
    'The signed-in account changed. Sign in again.',
    'साइन इन खाता बदल गया। फिर साइन इन करें।',
  ],
  FORBIDDEN: [
    'This action is not available for this account.',
    'यह काम इस खाते के लिए उपलब्ध नहीं है।',
  ],
  OUT_OF_STOCK: [
    'There is not enough stock for this quantity. Update your basket.',
    'इस मात्रा का पर्याप्त स्टॉक नहीं है। अपनी टोकरी बदलें।',
  ],
  INVALID_QUANTITY: [
    'Use the displayed minimum and quantity increment.',
    'दिखाई गई न्यूनतम मात्रा और बढ़ोतरी का पालन करें।',
  ],
  RESOURCE_LIMIT: [
    'The request limit is reached. Try later or contact the shop.',
    'अनुरोध सीमा पूरी है। बाद में कोशिश करें या दुकान से बात करें।',
  ],
  RESOURCE_BUSY: [
    'Many requests are arriving right now. Try again shortly.',
    'अभी बहुत अनुरोध आ रहे हैं। थोड़ी देर बाद कोशिश करें।',
  ],
  DEMAND_REVIEW_REQUIRED: [
    'The shop needs to review your earlier requests first. Please call or WhatsApp the shop.',
    'दुकान पहले आपके पिछले अनुरोध देखेगी। कृपया दुकान पर फ़ोन या WhatsApp करें।',
  ],
  PRICE_CHANGED: [
    'Selling terms changed. Review the current details and confirm again.',
    'बिक्री की शर्तें बदल गईं। मौजूदा जानकारी जाँचकर फिर पुष्टि करें।',
  ],
  CART_CHANGED: ['Your basket changed. Review it again.', 'आपकी टोकरी बदल गई। फिर जाँचें।'],
  CART_LIMIT: [
    'Your basket has reached its material limit.',
    'टोकरी में सामग्री की सीमा पूरी हो गई है।',
  ],
  EMPTY_CART: [
    'Add materials to your basket before checkout.',
    'चेकआउट से पहले टोकरी में सामग्री जोड़ें।',
  ],
  REVIEW_EXPIRED: [
    'Your review expired. Get a fresh review before confirming.',
    'जाँच का समय समाप्त हुआ। पुष्टि से पहले फिर जाँचें।',
  ],
  INVALID_ADDRESS: ['Choose one of your saved addresses.', 'अपने सहेजे हुए पतों में से चुनें।'],
  ADDRESS_LIMIT: [
    'Remove an unused address before saving another.',
    'नया पता सहेजने से पहले अनुपयोगी पता हटाएँ।',
  ],
  INVALID_PINCODE: ['Enter a six-digit pincode.', 'छह अंकों का पिनकोड लिखें।'],
  NOT_SERVICEABLE: [
    'This pincode is outside current delivery areas.',
    'यह पिनकोड मौजूदा डिलीवरी क्षेत्र में नहीं है।',
  ],
  DELIVERY_MINIMUM: [
    'Your basket is below the delivery minimum. Review the delivery terms.',
    'आपकी टोकरी डिलीवरी की न्यूनतम राशि से कम है। डिलीवरी शर्तें जाँचें।',
  ],
  INVALID_DELIVERY_DATE: [
    'Choose a valid future delivery date.',
    'आने वाली सही डिलीवरी तारीख चुनें।',
  ],
  INVALID_OTP: [
    'That code is invalid or expired. Request a new code.',
    'कोड गलत है या समय समाप्त है। नया कोड माँगें।',
  ],
  OTP_UNAVAILABLE: [
    'Sign-in codes are unavailable. Try again later.',
    'साइन इन कोड अभी उपलब्ध नहीं हैं। बाद में कोशिश करें।',
  ],
  RATE_LIMITED: [
    'Too many requests. Wait before trying again.',
    'बहुत अनुरोध हुए। थोड़ी देर बाद फिर कोशिश करें।',
  ],
  NOT_FOUND: [
    'This item is no longer available. Refresh and update your request.',
    'यह सामग्री अब उपलब्ध नहीं है। फिर लोड करके अनुरोध बदलें।',
  ],
  ORDER_NOT_FOUND: [
    'This order is not available in your account.',
    'यह ऑर्डर आपके खाते में उपलब्ध नहीं है।',
  ],
  QUOTE_CHANGED: [
    'The offer changed or expired. Review the latest revision before accepting.',
    'प्रस्ताव बदल गया या समय समाप्त हुआ। स्वीकार करने से पहले नया संस्करण जाँचें।',
  ],
  INVALID_INPUT: [
    'Check the required fields and selling terms.',
    'ज़रूरी जानकारी और बिक्री की शर्तें जाँचें।',
  ],
  INVALID_BODY: [
    'This request could not be read. Refresh the page and try again.',
    'यह अनुरोध पढ़ा नहीं जा सका। पेज फिर लोड करके कोशिश करें।',
  ],
  INVALID_TRANSITION: [
    'This action is no longer available. Refresh the order.',
    'यह काम अब उपलब्ध नहीं है। ऑर्डर फिर लोड करें।',
  ],
  IDEMPOTENCY_CONFLICT: [
    'The saved request conflicts with an earlier submission. Keep its reference and contact the shop.',
    'सहेजा अनुरोध पुराने अनुरोध से मेल नहीं खाता। संदर्भ सुरक्षित रखकर दुकान से बात करें।',
  ],
  CONFLICT: [
    'This changed while you were working. Refresh and try again.',
    'आपके काम करते समय यह बदल गया। फिर लोड करके कोशिश करें।',
  ],
  PAYMENTS_UNAVAILABLE: [
    'Online payment is unavailable. Choose cash on delivery.',
    'ऑनलाइन भुगतान उपलब्ध नहीं है। डिलीवरी पर भुगतान चुनें।',
  ],
  STAFF_ACCOUNT: [
    'Contact the store owner to close a staff account.',
    'स्टाफ खाता बंद करने के लिए दुकान मालिक से बात करें।',
  ],
  ACTIVE_ORDERS: [
    'Complete or cancel open orders and refunds before deleting your account.',
    'खाता हटाने से पहले चालू ऑर्डर और वापसी पूरी या रद्द करें।',
  ],
  DEMAND_PAUSED: [
    'New requests are paused for now. Please call or WhatsApp the shop.',
    'नई बुकिंग अभी रुकी है। कृपया दुकान पर फ़ोन या WhatsApp करें।',
  ],
  CUSTOMER_DELETED: ['This customer account has been removed.', 'यह ग्राहक खाता हटा दिया गया है।'],
  // Money and stock records.
  ORDER_TOO_LARGE: [
    'This order is larger than the shop can accept online. Split it or call the shop.',
    'यह ऑर्डर ऑनलाइन लेने के लिए बहुत बड़ा है। इसे बाँटें या दुकान पर फ़ोन करें।',
  ],
  // Infra hardening: owner-desk web push.
  INVALID_PUSH_ENDPOINT: [
    'This browser’s alert service is not supported. Use Chrome, Edge, Firefox or Safari.',
    'इस ब्राउज़र की अलर्ट सेवा समर्थित नहीं है। Chrome, Edge, Firefox या Safari इस्तेमाल करें।',
  ],
};

/**
 * Customer-facing message for an error code. Unknown codes fall back to the server's own
 * message in English (it may be more specific) and to a general message in Hindi.
 */
export function errorText(code: string | undefined, language: Language, serverMessage?: string) {
  const known = code ? customerErrors[code as CustomerErrorCode] : undefined;
  if (known) return pick(language, known);
  if (language === 'en' && serverMessage) return serverMessage;
  return pick(language, customerErrors.REQUEST_FAILED);
}
