import { API_URL } from './api';
export class CustomerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}
let refreshing: Promise<void> | null = null;
export async function customerApi<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  accountId?: string,
  retry = true,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(accountId ? { 'X-Shiv-Account': accountId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new CustomerError(
      'NETWORK_ERROR',
      'The response could not be confirmed. Check your connection and retry.',
    );
  }
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    if (!refreshing)
      refreshing = customerApi('/auth/refresh', 'POST', {}, undefined, false)
        .then(() => {})
        .finally(() => {
          refreshing = null;
        });
    try {
      await refreshing;
    } catch (error) {
      if (error instanceof CustomerError && error.status === 401)
        window.dispatchEvent(new CustomEvent('shiv-session-expired', { detail: { accountId } }));
      throw error;
    }
    return customerApi(path, method, body, accountId, false);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new CustomEvent('shiv-session-expired', { detail: { accountId } }));
    if (data?.error?.code === 'ACCOUNT_CHANGED')
      window.dispatchEvent(new CustomEvent('shiv-session-expired', { detail: { accountId } }));
    throw new CustomerError(
      data?.error?.code || 'REQUEST_FAILED',
      data?.error?.message || 'Could not complete the request.',
      response.status,
    );
  }
  if (data === null || typeof data !== 'object')
    throw new CustomerError(
      'NETWORK_ERROR',
      'The response could not be confirmed. Check your connection and retry.',
    );
  return data as T;
}
export function errorText(error: unknown, hi: boolean) {
  const code = error instanceof CustomerError ? error.code : '';
  const messages: Record<string, [string, string]> = {
    NETWORK_ERROR: [
      'The response could not be confirmed. Check your connection and retry.',
      'जवाब की पुष्टि नहीं हुई। इंटरनेट जाँचकर फिर कोशिश करें।',
    ],
    UNAUTHORIZED: [
      'Your session ended. Sign in again to continue.',
      'सत्र समाप्त हुआ। जारी रखने के लिए फिर साइन इन करें।',
    ],
    ACCOUNT_CHANGED: [
      'The signed-in account changed. Sign in again.',
      'साइन इन खाता बदल गया। फिर साइन इन करें।',
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
    PRICE_CHANGED: [
      'Selling terms changed. Review the current details and confirm again.',
      'बिक्री की शर्तें बदल गईं। मौजूदा जानकारी जाँचकर फिर पुष्टि करें।',
    ],
    CART_CHANGED: ['Your basket changed. Review it again.', 'आपकी टोकरी बदल गई। फिर जाँचें।'],
    REVIEW_EXPIRED: [
      'Your review expired. Get a fresh review before confirming.',
      'जाँच का समय समाप्त हुआ। पुष्टि से पहले फिर जाँचें।',
    ],
    INVALID_ADDRESS: ['Choose one of your saved addresses.', 'अपने सहेजे हुए पतों में से चुनें।'],
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
    EMPTY_CART: [
      'Add materials to your basket before checkout.',
      'चेकआउट से पहले टोकरी में सामग्री जोड़ें।',
    ],
    ADDRESS_LIMIT: [
      'Remove an unused address before saving another.',
      'नया पता सहेजने से पहले अनुपयोगी पता हटाएँ।',
    ],
    CART_LIMIT: [
      'Your basket has reached its material limit.',
      'टोकरी में सामग्री की सीमा पूरी हो गई है।',
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
    INVALID_TRANSITION: [
      'This action is no longer available. Refresh the order.',
      'यह काम अब उपलब्ध नहीं है। ऑर्डर फिर लोड करें।',
    ],
    IDEMPOTENCY_CONFLICT: [
      'The saved request conflicts with an earlier submission. Keep its reference and contact the shop.',
      'सहेजा अनुरोध पुराने अनुरोध से मेल नहीं खाता। संदर्भ सुरक्षित रखकर दुकान से बात करें।',
    ],
    FORBIDDEN: [
      'This action is not available for this account.',
      'यह काम इस खाते के लिए उपलब्ध नहीं है।',
    ],
  };
  if (messages[code]) return messages[code][hi ? 1 : 0];
  return hi
    ? 'अनुरोध पूरा नहीं हुआ। जानकारी जाँचें और फिर कोशिश करें।'
    : error instanceof CustomerError
      ? error.message
      : 'Could not complete the request. Check the entered details and try again.';
}
