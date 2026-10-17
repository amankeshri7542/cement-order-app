import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { firstOrderSteps, nextSteps, pick, space, type Order } from '@shiv/shared';
import { api } from './api';
import { useStore } from './store';
import { Button, C, headingScale, Icon, s, teko } from './ui';

// First-run guidance: the "first order in 3 steps" card on Home and the "what happens next"
// panel on an order. The words come from packages/shared/src/first-run.ts, as on the website.

type ShopContact = { contactApproved: boolean; phone: string; whatsapp: string };
let contactRequest: Promise<ShopContact | null> | null = null;
/**
 * The shop's published contact details. Call and WhatsApp buttons appear only once the family
 * has approved the number (apps/api/src/public-content.ts); until then nothing is shown.
 */
export function useShopContact() {
  const [contact, setContact] = useState<{ phone: string; whatsapp: string } | null>(null);
  useEffect(() => {
    let active = true;
    contactRequest ??= api<ShopContact>('/shop-content').catch(() => {
      contactRequest = null;
      return null;
    });
    void contactRequest.then((shop) => {
      const valid = (value?: string) => (value && /^\+91[6-9]\d{9}$/.test(value) ? value : '');
      if (active && shop?.contactApproved && (valid(shop.phone) || valid(shop.whatsapp)))
        setContact({ phone: valid(shop.phone), whatsapp: valid(shop.whatsapp) });
    });
    return () => {
      active = false;
    };
  }, []);
  return contact;
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
            style={[{ width: 28, color: C.accent }, teko(30)]}
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
