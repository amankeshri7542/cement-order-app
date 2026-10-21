import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { firstOrderSteps, nextSteps, pick, space, type Order } from '@shiv/shared';
import { api } from './api';
import { enableOrderPush, pushKeys } from './push';
import { readSaved, useStore, writeSaved } from './store';
import { Button, C, headingScale, Icon, s, teko } from './ui';

// First-run guidance: the "first order in 3 steps" card on Home and the "what happens next"
// panel on an order. The words come from packages/shared/src/first-run.ts, as on the website.

type ShopContact = { contactApproved: boolean; phone: string; whatsapp: string };
let contactRequest: Promise<ShopContact | null> | null = null;
let contactAskedAt = 0;
// The last answer the store gave, kept when a later ask fails (no signal) so the buttons stay.
let contactKnown: ShopContact | null = null;
/** A withdrawn or changed number must not stay on a phone that never closes the app. */
const contactMaxAge = 10 * 60 * 1000;
/**
 * The shop's published contact details. Call and WhatsApp buttons appear only once the family
 * has approved the number (apps/api/src/public-content.ts); until then nothing is shown. The
 * answer is asked for again once it is ten minutes old, whenever a screen that shows it opens.
 */
export function useShopContact() {
  const [contact, setContact] = useState<{ phone: string; whatsapp: string } | null>(null);
  useEffect(() => {
    let active = true;
    if (!contactRequest || Date.now() - contactAskedAt > contactMaxAge) {
      contactAskedAt = Date.now();
      const request = api<ShopContact>('/shop-content')
        .then((answer) => {
          contactKnown = answer;
          return answer;
        })
        .catch(() => {
          if (contactRequest === request) contactRequest = null;
          return contactKnown;
        });
      contactRequest = request;
    }
    void contactRequest.then((shop) => {
      const valid = (value?: string) => (value && /^\+91[6-9]\d{9}$/.test(value) ? value : '');
      if (!active) return;
      setContact(
        shop?.contactApproved && (valid(shop.phone) || valid(shop.whatsapp))
          ? { phone: valid(shop.phone), whatsapp: valid(shop.whatsapp) }
          : null,
      );
    });
    return () => {
      active = false;
    };
  }, []);
  return contact;
}

/**
 * "Order by phone": most customers still call or WhatsApp the shop. It appears only once the
 * family has approved the number (useShopContact), on Home above the rates and under every empty
 * state. No promise of a time or a reply is made.
 */
export function CallToOrder() {
  const { t, setToast } = useStore();
  const contact = useShopContact();
  if (!contact) return null;
  const open = (url: string) =>
    void Linking.openURL(url).catch(() => setToast(t('Could not open this.', 'यह खुल नहीं सका।')));
  return (
    <View style={[s.paper, { gap: space.sm }]} testID="call-to-order">
      <Text style={s.h3} accessibilityRole="header">
        {t('Prefer to order by phone?', 'फ़ोन पर ऑर्डर करना है?')}
      </Text>
      <Text style={s.small}>
        {t(
          'Call or WhatsApp the shop and say what you need.',
          'दुकान को फ़ोन या WhatsApp करें और बताएँ क्या चाहिए।',
        )}
      </Text>
      <View style={[s.row, { gap: space.sm, flexWrap: 'wrap' }]}>
        {contact.phone ? (
          <Button
            secondary
            icon="call"
            style={{ flexGrow: 1, flexBasis: 140 }}
            onPress={() => open(`tel:${contact.phone}`)}
          >
            {t('Call the shop', 'दुकान पर फ़ोन करें')}
          </Button>
        ) : null}
        {contact.whatsapp ? (
          <Button
            secondary
            icon="logo-whatsapp"
            style={{ flexGrow: 1, flexBasis: 140 }}
            onPress={() =>
              open(
                `https://wa.me/${contact.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(
                  t('Hello, I want to order materials.', 'नमस्ते, मुझे सामग्री मँगानी है।'),
                )}`,
              )
            }
          >
            WhatsApp
          </Button>
        ) : null}
      </View>
    </View>
  );
}

/**
 * One question right after an order: get its updates as notifications on this phone? It is asked
 * once on Android (the answer is remembered either way); Account keeps the switch for later.
 */
export function NotifyPrompt() {
  const { t, setToast, user } = useStore();
  const userId = user?.id;
  // Hidden until storage says this person was never asked on this phone.
  const [asked, setAsked] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android' || !userId) return;
    let active = true;
    void readSaved<boolean>(pushKeys.asked(userId))
      .then((value) => {
        if (active) setAsked(value === true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [userId]);
  if (Platform.OS !== 'android' || asked || !user || user.role === 'ADMIN') return null;
  async function answer(turnOn: boolean) {
    if (!userId) return;
    setBusy(true);
    try {
      await writeSaved(pushKeys.asked(userId), true).catch(() => {});
      setAsked(true);
      if (!turnOn) return;
      const result = await enableOrderPush(t('Order updates', 'ऑर्डर की जानकारी'));
      if (result === 'on') await writeSaved(pushKeys.on(userId), true).catch(() => {});
      // No signal is not an answer: the question comes back next time.
      if (result === 'offline') {
        await writeSaved(pushKeys.asked(userId), null).catch(() => {});
        setAsked(false);
      }
      setToast(
        result === 'on'
          ? t('Order notifications are on', 'ऑर्डर की सूचनाएँ चालू हैं')
          : result === 'denied'
            ? t(
                'Notifications are off. You can still see every update in Orders.',
                'सूचनाएँ बंद हैं। ऑर्डर में हर जानकारी फिर भी दिखेगी।',
              )
            : result === 'offline'
              ? t(
                  'No connection right now. Try again when you are online.',
                  'अभी कनेक्शन नहीं है। इंटरनेट आने पर फिर कोशिश करें।',
                )
              : t(
                  'Notifications are not available in this build yet. Updates are shown in Orders.',
                  'इस ऐप में सूचनाएँ अभी उपलब्ध नहीं हैं। जानकारी ऑर्डर में दिखेगी।',
                ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={[s.card, { gap: space.sm }]} testID="notify-prompt">
      <Text style={s.h3} accessibilityRole="header">
        {t('Get order updates on this phone?', 'इस फ़ोन पर ऑर्डर की जानकारी पाएँ?')}
      </Text>
      <Text style={s.small}>
        {t(
          'We send a short message when your order moves to the next step.',
          'ऑर्डर अगले कदम पर पहुँचे तो हम छोटा संदेश भेजेंगे।',
        )}
      </Text>
      <View style={[s.row, { gap: space.sm, flexWrap: 'wrap' }]}>
        <Button
          icon="notifications"
          loading={busy}
          style={{ flexGrow: 1, flexBasis: 140 }}
          onPress={() => void answer(true)}
        >
          {t('Turn on', 'चालू करें')}
        </Button>
        <Button kind="quiet" disabled={busy} onPress={() => void answer(false)}>
          {t('Not now', 'अभी नहीं')}
        </Button>
      </View>
    </View>
  );
}

/** Shown on Home until the customer has any order, or closes it. */
export function FirstOrderCard() {
  const { t, language, navigate, showFirstOrderTip, hideFirstOrderTip } = useStore();
  if (!showFirstOrderTip) return null;
  return (
    <View style={[s.paper, { gap: space.md }]}>
      <View style={[s.row, { alignItems: 'flex-start' }]}>
        <Text
          style={[s.h2, { flex: 1 }]}
          maxFontSizeMultiplier={headingScale}
          accessibilityRole="header"
        >
          {t('Your first order in 3 steps', 'पहला ऑर्डर, 3 आसान कदम')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Hide these steps', 'ये कदम छिपाएँ')}
          onPress={hideFirstOrderTip}
          hitSlop={4}
          style={({ pressed }) => [
            { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Icon name="close" color={C.muted} />
        </Pressable>
      </View>
      {firstOrderSteps.map((step, index) => (
        <View key={index} style={[s.row, { alignItems: 'flex-start' }]}>
          <Text
            style={[{ width: 28, color: C.accentInk }, teko(30)]}
            maxFontSizeMultiplier={headingScale}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            {index + 1}
          </Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.h3}>{pick(language, step.title)}</Text>
            <Text style={s.body}>{pick(language, step.body)}</Text>
          </View>
        </View>
      ))}
      <Button icon="arrow-forward" onPress={() => navigate({ screen: 'Products' })}>
        {t('Choose materials', 'सामग्री चुनें')}
      </Button>
    </View>
  );
}

/** What happens after an order, step by step, from its real status. No times are promised. */
export function NextSteps({ order }: { order: Order }) {
  const { t, language, setToast } = useStore();
  const contact = useShopContact();
  const steps = nextSteps(order);
  if (!steps) return null;
  const open = (url: string) =>
    void Linking.openURL(url).catch(() => setToast(t('Could not open this.', 'यह खुल नहीं सका।')));
  return (
    <View style={[s.card, { gap: space.md }]}>
      <Text style={s.h2} maxFontSizeMultiplier={headingScale} accessibilityRole="header">
        {t('What happens next', 'आगे क्या होगा')}
      </Text>
      <View>
        {steps.map((step, index) => {
          const done = step.state === 'done';
          const now = step.state === 'current';
          return (
            <View
              key={step.key}
              style={[s.row, { alignItems: 'flex-start', paddingVertical: space.sm }]}
              accessibilityLabel={`${pick(language, step.title)}. ${
                done ? t('Done.', 'हो गया।') : now ? t('Now.', 'अभी।') : t('Next.', 'आगे।')
              } ${now || !done ? pick(language, step.body) : ''}`}
            >
              <View
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: done ? C.ok : now ? C.accent : C.tab1,
                }}
              >
                {done ? (
                  <Icon name="checkmark" size={16} color={C.surface} />
                ) : (
                  <Text
                    style={{ color: now ? C.onAccent : C.ink2, fontWeight: '800' }}
                    maxFontSizeMultiplier={1.3}
                  >
                    {index + 1}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  style={[
                    s.body,
                    { color: done || now ? C.ink : C.muted, fontWeight: now ? '800' : '600' },
                  ]}
                >
                  {pick(language, step.title)}
                </Text>
                {now || !done ? <Text style={s.small}>{pick(language, step.body)}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
      {contact ? (
        <View style={[s.row, { gap: space.sm, flexWrap: 'wrap' }]}>
          {contact.phone ? (
            <Button
              secondary
              icon="call"
              style={{ flexGrow: 1, flexBasis: 140 }}
              onPress={() => open(`tel:${contact.phone}`)}
            >
              {t('Call the shop', 'दुकान पर फ़ोन करें')}
            </Button>
          ) : null}
          {contact.whatsapp ? (
            <Button
              secondary
              icon="logo-whatsapp"
              style={{ flexGrow: 1, flexBasis: 140 }}
              onPress={() =>
                open(
                  `https://wa.me/${contact.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(
                    t(`About my order ${order.number}`, `मेरे ऑर्डर ${order.number} के बारे में`),
                  )}`,
                )
              }
            >
              WhatsApp
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
