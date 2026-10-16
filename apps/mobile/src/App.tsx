import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { radius, space, textSize } from '@shiv/shared';
import { StoreProvider, tabs, useStore, type Route, type Tab } from './store';
import { Button, C, Icon, IconButton, Stamp, type IconName } from './ui';
import { Home, Catalogue, ProductDetail } from './catalog';
import { Cart, Checkout } from './checkout';
import { Account, Addresses, Login } from './account';
import { Orders, OrderDetail } from './orders';
import { Quotes, QuoteRequest } from './quotes';
import { Compare } from './compare';
import { Assistant } from './assistant';
import { UpdateGate } from './update';
import { ErrorBoundary } from './boundary';

// Staging, preview and development builds say so, so a test install is never mistaken for the
// real shop (and a closed-test build promoted by mistake is noticed at once).
const testBuild = Constants.expoConfig?.extra?.appEnv !== 'production';

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <StoreProvider>
          <UpdateGate>
            <Shell />
          </UpdateGate>
        </StoreProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

function TabScreen({ route }: { route: Route }) {
  switch (route.screen) {
    case 'Products':
      return <Catalogue />;
    case 'Cart':
      return <Cart />;
    case 'Orders':
      return <Orders />;
    case 'Account':
      return <Account />;
    default:
      return <Home />;
  }
}
function DetailScreen({ route }: { route: Route }) {
  switch (route.screen) {
    case 'Product':
      return <ProductDetail key={route.id} />;
    case 'Checkout':
      return <Checkout />;
    case 'Order':
      return <OrderDetail key={route.id} />;
    case 'Addresses':
      return <Addresses key={route.id || 'all'} />;
    case 'Quotes':
      return <Quotes />;
    case 'QuoteRequest':
      return <QuoteRequest key={route.id || 'new'} />;
    case 'Compare':
      return <Compare />;
    case 'Assistant':
      return <Assistant />;
    default:
      return null;
  }
}

const isTab = (route: Route) => (tabs as readonly string[]).includes(route.screen);

function Shell() {
  const {
    route,
    navigate,
    goBack,
    t,
    language,
    languageState,
    setLanguage,
    basket,
    settings,
    toast,
    setToast,
    pendingCheckout,
    refreshCurrent,
    refreshing,
    error,
    refreshCatalog,
  } = useStore();
  // The last tab stays mounted under detail screens, so Back keeps search and scroll.
  const [tabRoute, setTabRoute] = useState<Route>({ screen: 'Home' });
  useEffect(() => {
    if (isTab(route)) setTabRoute(route);
  }, [route]);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => goBack());
    return () => listener.remove();
  }, [goBack]);
  useEffect(() => {
    if (Platform.OS === 'web')
      document.title = t('Shiv Cement Store · Patna', 'शिव सीमेंट स्टोर · पटना');
  }, [t]);
  // Edge-to-edge Android does not resize for the keyboard, so the content avoids it itself and
  // the tab bar steps aside while typing.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setTyping(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  const basketCount = basket.reduce((total, line) => total + line.quantity, 0);
  const activeTab: Tab = isTab(route) ? (route.screen as Tab) : (tabRoute.screen as Tab);
  const detail = isTab(route) ? null : route;
  function open(url: string) {
    void Linking.openURL(url).catch(() =>
      setToast(
        t(
          'Could not open this. Please call the store directly.',
          'यह खुल नहीं सका। कृपया दुकान पर सीधे फ़ोन करें।',
        ),
      ),
    );
  }
  if (languageState === 'loading')
    return (
      <SafeAreaView style={[a.app, a.center]}>
        <Stamp size={64} />
        <ActivityIndicator color={C.accent} style={{ marginTop: space.xl }} />
      </SafeAreaView>
    );
  if (languageState === 'unset') return <LanguageChooser choose={setLanguage} />;
  const phone = settings?.phone.replace(/\D/g, '');
  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={[a.app, { backgroundColor: C.ink }]}
    >
      <StatusBar barStyle="light-content" backgroundColor={C.ink} />
      <View style={a.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Shiv Cement Store home', 'शिव सीमेंट स्टोर होम')}
          style={a.brand}
          onPress={() => navigate({ screen: 'Home' })}
        >
          <Stamp size={40} />
          <View style={{ flexShrink: 1 }}>
            <Text style={a.brandName} numberOfLines={1} maxFontSizeMultiplier={1.15}>
              {t('Shiv Cement', 'शिव सीमेंट')}
            </Text>
            <Text style={a.brandPlace} numberOfLines={1} maxFontSizeMultiplier={1.15}>
              {t('Store · Patna, Bihar', 'स्टोर · पटना, बिहार')}
            </Text>
          </View>
          {testBuild ? (
            <View style={a.testMark}>
              <Text style={a.testMarkText} maxFontSizeMultiplier={1.15}>
                TEST
              </Text>
            </View>
          ) : null}
        </Pressable>
        {Platform.OS === 'web' && (
          <IconButton
            icon="refresh"
            color={C.onInk}
            label={t('Refresh current screen', 'यह पेज रीफ़्रेश करें')}
            disabled={refreshing}
            onPress={() => void refreshCurrent()}
          />
        )}
        {phone ? (
          <>
            <IconButton
              icon="call"
              color={C.onInk}
              label={t('Call the store', 'दुकान पर फ़ोन करें')}
              onPress={() => open(`tel:+${phone}`)}
            />
            <IconButton
              icon="logo-whatsapp"
              color={C.onInk}
              label={t('WhatsApp the store', 'दुकान को WhatsApp करें')}
              onPress={() => open(`https://wa.me/${phone}`)}
            />
          </>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Switch language to Hindi', 'भाषा अंग्रेज़ी में बदलें')}
          onPress={() => setLanguage(language === 'en' ? 'hi' : 'en')}
          style={a.languageTarget}
        >
          <View style={a.language}>
            <Text style={a.languageText}>{language === 'en' ? 'हिं' : 'EN'}</Text>
          </View>
        </Pressable>
      </View>
      {detail && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Back', 'वापस')}
          onPress={goBack}
          style={a.back}
        >
          <Icon name="arrow-back" size={22} />
          <Text style={a.backText}>{t('Back', 'वापस')}</Text>
        </Pressable>
      )}
      {Boolean(error) && (
        <View accessibilityRole="alert" style={a.offline}>
          <Icon name="cloud-offline-outline" color={C.danger} />
          <Text style={a.offlineText}>{error}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void refreshCatalog()}
            style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm }}
          >
            <Text style={[a.offlineText, { fontWeight: '800', textDecorationLine: 'underline' }]}>
              {t('Retry', 'फिर से')}
            </Text>
          </Pressable>
        </View>
      )}
      {pendingCheckout && route.screen !== 'Checkout' && route.screen !== 'Order' && (
        <Pressable
          accessibilityRole="button"
          onPress={() => navigate({ screen: 'Checkout' })}
          style={a.pending}
        >
          <Icon name="time-outline" color={C.warn} />
          <Text style={a.pendingText}>
            {t(
              'Your last order request needs its result checked. Tap to check.',
              'आपके पिछले ऑर्डर का परिणाम जाँचना बाकी है। जाँचने के लिए दबाएँ।',
            )}
          </Text>
        </Pressable>
      )}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'web' ? undefined : 'padding'}
        style={{ flex: 1, backgroundColor: C.ground }}
      >
        <View style={[{ flex: 1 }, detail ? a.hidden : null]}>
          <TabScreen route={tabRoute} />
        </View>
        {detail && (
          <View style={{ flex: 1 }}>
            <DetailScreen route={detail} />
          </View>
        )}
        {toast ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Dismiss message', 'संदेश हटाएँ')}
            onPress={() => setToast('')}
            style={a.toast}
          >
            <Text accessibilityLiveRegion="polite" style={a.toastText}>
              {toast}
            </Text>
            <Icon name="close" color={C.onInk} size={18} />
          </Pressable>
        ) : null}
      </KeyboardAvoidingView>
      <View style={[a.nav, typing && a.hidden]} accessibilityRole="tablist">
        {(
          [
            ['Home', t('Home', 'होम'), 'home'],
            ['Products', t('Materials', 'सामग्री'), 'grid'],
            ['Cart', t('Basket', 'टोकरी'), 'basket'],
            ['Orders', t('Orders', 'ऑर्डर'), 'receipt'],
            ['Account', t('Account', 'खाता'), 'person'],
          ] as [Tab, string, string][]
        ).map(([name, label, icon]) => {
          const selected = !detail && activeTab === name;
          return (
            <Pressable
              key={name}
              accessibilityRole="tab"
              accessibilityLabel={
                name === 'Cart' && basketCount ? `${label}, ${basketCount}` : label
              }
              accessibilityState={{ selected }}
              onPress={() => navigate({ screen: name })}
              style={a.navItem}
            >
              <View style={[a.navMark, selected && { backgroundColor: C.accent }]} />
              <View style={a.navIcon}>
                <Icon
                  name={(selected ? icon : `${icon}-outline`) as IconName}
                  size={24}
                  color={selected ? C.ink : C.muted}
                />
                {name === 'Cart' && basketCount > 0 && (
                  <View style={a.navBadge}>
                    <Text style={a.navBadgeText}>{basketCount > 999 ? '999+' : basketCount}</Text>
                  </View>
                )}
              </View>
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
                style={[a.navLabel, selected && { color: C.ink, fontWeight: '800' }]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Login />
    </SafeAreaView>
  );
}

/** Asked once, on first launch: the whole app follows this choice. */
function LanguageChooser({ choose }: { choose: (language: 'hi' | 'en') => void }) {
  return (
    <SafeAreaView style={[a.app, a.center, { backgroundColor: C.ink, padding: space.xl }]}>
      <StatusBar barStyle="light-content" backgroundColor={C.ink} />
      <Stamp size={72} />
      <Text style={a.chooserTitle}>शिव सीमेंट स्टोर</Text>
      <Text style={a.chooserSub}>Shiv Cement Store · पटना</Text>
      <Text style={a.chooserAsk}>अपनी भाषा चुनें · Choose your language</Text>
      <View style={{ alignSelf: 'stretch', gap: space.md, marginTop: space.xl }}>
        <Button onPress={() => choose('hi')} label="हिंदी चुनें" style={{ minHeight: 64 }}>
          हिंदी
        </Button>
        <Button
          kind="paper"
          onPress={() => choose('en')}
          label="Choose English"
          style={{ minHeight: 64 }}
        >
          English
        </Button>
      </View>
      <Text style={a.chooserNote}>
        आप इसे कभी भी ऊपर से बदल सकते हैं · You can change this anytime from the top bar
      </Text>
    </SafeAreaView>
  );
}

const a = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.ground },
  center: { alignItems: 'center', justifyContent: 'center' },
  hidden: { display: 'none' },
  header: {
    backgroundColor: C.ink,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: 2,
  },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  brandName: { color: C.onInk, fontSize: textSize.lead, lineHeight: 26, fontWeight: '800' },
  brandPlace: { color: C.onInkMuted, fontSize: textSize.small, lineHeight: 18 },
  testMark: {
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: C.onInkMuted,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  testMarkText: { color: C.onInkMuted, fontSize: textSize.small, fontWeight: '800' },
  languageTarget: { minWidth: 52, height: 48, alignItems: 'center', justifyContent: 'center' },
  language: {
    minWidth: 48,
    height: 44,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: C.muted,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  languageText: { color: C.onInk, fontSize: textSize.body, fontWeight: '800' },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.lg,
    backgroundColor: C.surface,
  },
  backText: { color: C.ink, fontSize: textSize.body, fontWeight: '700' },
  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    backgroundColor: C.paper,
  },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    backgroundColor: C.dangerSoft,
  },
  offlineText: { flex: 1, color: C.danger, fontSize: textSize.small, lineHeight: 20 },
  pendingText: {
    flex: 1,
    color: C.warn,
    fontSize: textSize.small,
    lineHeight: 20,
    fontWeight: '700',
  },
  // Paper tabs on the cement ground; the open tab is ink with a sindoor mark.
  nav: { flexDirection: 'row', backgroundColor: C.paper, paddingBottom: 6 },
  navItem: { flex: 1, alignItems: 'center', gap: 2, minHeight: 60 },
  navMark: { alignSelf: 'stretch', height: 3, marginHorizontal: space.md, marginBottom: 5 },
  navIcon: { width: 52, height: 28, alignItems: 'center', justifyContent: 'center' },
  navLabel: { fontSize: textSize.small, color: C.muted, fontWeight: '600' },
  navBadge: {
    position: 'absolute',
    top: -6,
    right: 0,
    minWidth: 20,
    height: 20,
    borderRadius: radius.pill,
    paddingHorizontal: 4,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBadgeText: {
    color: C.onAccent,
    fontSize: textSize.small,
    lineHeight: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  // Messages appear at the top of the screen so they never cover a screen's main button.
  toast: {
    position: 'absolute',
    top: space.sm,
    alignSelf: 'center',
    width: '92%',
    maxWidth: 560,
    backgroundColor: C.ink,
    padding: space.lg,
    borderRadius: radius.control,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    // Toasts, menus and dialogs are the only raised objects.
    elevation: 6,
    shadowColor: C.ink,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  toastText: { flex: 1, color: C.onInk, fontSize: textSize.body, lineHeight: 24 },
  chooserTitle: {
    color: C.onInk,
    fontSize: textSize.head,
    lineHeight: 42,
    fontWeight: '800',
    marginTop: space.xl,
    textAlign: 'center',
  },
  chooserSub: { color: C.onInkMuted, fontSize: textSize.body, marginTop: 4, textAlign: 'center' },
  chooserAsk: {
    color: C.onInk,
    fontSize: textSize.lead,
    lineHeight: 28,
    fontWeight: '700',
    marginTop: space.xxl,
    textAlign: 'center',
  },
  chooserNote: {
    color: C.onInkMuted,
    fontSize: textSize.small,
    textAlign: 'center',
    marginTop: space.xl,
    lineHeight: 21,
  },
});
