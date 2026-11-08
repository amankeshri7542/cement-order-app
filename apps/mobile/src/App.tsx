import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { ErrorBoundary } from './boundary';
import { ArticleScreen } from './features/ask/ArticleScreen';
import { AskScreen } from './features/ask/AskScreen';
import { AccountScreen } from './features/account/AccountScreen';
import { AskShopSheet } from './features/account/AskShopSheet';
import { SignIn } from './features/auth/SignIn';
import { HomeScreen } from './features/home/HomeScreen';
import { ListBar } from './features/list/ListBar';
import { ListPanel } from './features/list/ListPanel';
import { OrderScreen } from './features/orders/OrderScreen';
import { OrdersScreen } from './features/orders/OrdersScreen';
import { ReplyScreen } from './features/orders/ReplyScreen';
import { ProductScreen } from './features/product/ProductScreen';
import { SearchScreen } from './features/search/SearchScreen';
import { DaySheet, PincodeSheet, SitesPicker } from './features/sites/SiteSheets';
import { SiteForm } from './features/sites/SiteForm';
import { SitesScreen } from './features/sites/SitesScreen';
import { PeopleScreen, UdhaarScreen } from './features/udhaar/UdhaarScreen';
import { UpdateGate } from './features/update/UpdateGate';
import { privateRoute, tabs, type Route, type SheetRoute, type Tab } from './logic/nav-core';
import { boot } from './state/boot';
import { catalogStore } from './state/catalog';
import { back, closeSheet, goToTab, navStore } from './state/nav';
import { requireSignIn, sessionStore } from './state/session';
import { useSelect } from './state/use';
import { Icon, type IconName } from './ui/Icon';
import { ease, reducedMotion } from './ui/motion';
import { Toast } from './ui/Toast';
import { useKeyboardHeight } from './ui/useKeyboard';
import { C, motion, space, T } from './ui/tokens';
import { w } from './words';
import { ThemeProvider } from './ui/theme';

// Staging, preview and development builds say so, so a test install is never mistaken for the real
// shop.
const testBuild = Constants.expoConfig?.extra?.appEnv !== 'production';

const tabLooks: Record<Tab, { icon: IconName; word: () => string }> = {
  home: { icon: 'home-outline', word: () => w('tabs.home') },
  ask: { icon: 'chatbubble-ellipses-outline', word: () => w('tabs.ask') },
  orders: { icon: 'receipt-outline', word: () => w('tabs.orders') },
  account: { icon: 'person-outline', word: () => w('tabs.account') },
};
const screens: Record<Tab, () => React.ReactNode> = {
  home: () => <HomeScreen />,
  ask: () => <AskScreen />,
  orders: () => <OrdersScreen />,
  account: () => <AccountScreen />,
};

/**
 * Keeps a screen mounted and its scroll where it was while something else is on top. Hidden with
 * opacity on a phone, because a view with display none leaves the native tree and loses its place;
 * hidden from the accessibility tree too, so TalkBack reads only what is on screen.
 */
const hiddenPane = Platform.select({
  web: { visibility: 'hidden' as never },
  default: { opacity: 0 },
});
function Pane({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <View
      collapsable={false}
      pointerEvents={active ? 'auto' : 'none'}
      accessibilityElementsHidden={!active}
      aria-hidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      style={[StyleSheet.absoluteFill, !active && hiddenPane]}
    >
      {children}
    </View>
  );
}

function PushedScreen({ route }: { route: Route }) {
  switch (route.screen) {
    case 'product':
      return <ProductScreen id={route.id} />;
    case 'search':
      return <SearchScreen />;
    case 'order':
      return <OrderScreen id={route.id} />;
    case 'reply':
      return <ReplyScreen id={route.id} />;
    case 'udhaar':
      return <UdhaarScreen />;
    case 'people':
      return <PeopleScreen />;
    case 'sites':
      return <SitesScreen />;
    case 'article':
      return <ArticleScreen slug={route.slug} />;
  }
}

/** A short rise as a screen comes on top. Nothing on tabs or lists. */
function Rising({ children }: { children: React.ReactNode }) {
  const value = useRef(new Animated.Value(reducedMotion() ? 1 : 0)).current;
  useEffect(() => ease(value, 1, motion.press + 40), [value]);
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        styles.ground,
        {
          opacity: value,
          transform: [
            { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

function SheetHost({ sheet }: { sheet: SheetRoute }) {
  const closed = () => closeSheet(sheet.sheet);
  switch (sheet.sheet) {
    case 'list':
      return <ListPanel repeat={sheet.repeat} onClosed={closed} />;
    case 'sites-picker':
      return <SitesPicker purpose={sheet.purpose} onClosed={closed} />;
    case 'site-form':
      return <SiteForm id={sheet.id} purpose={sheet.purpose} onClosed={closed} />;
    case 'day':
      return <DaySheet onClosed={closed} />;
    case 'sign-in':
      return <SignIn onClosed={closed} />;
    case 'pincode':
      return <PincodeSheet onClosed={closed} />;
    case 'ask-shop':
      return <AskShopSheet onClosed={closed} />;
  }
}

function TabBar({ shown }: { shown: readonly Tab[] }) {
  const tab = useSelect(navStore, (state) => state.tab);
  const onScreen = useSelect(navStore, (state) => state.stack.length === 0);
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {shown.map((name) => {
        const selected = onScreen && tab === name;
        const look = tabLooks[name];
        return (
          <Pressable
            key={name}
            accessibilityRole="tab"
            accessibilityLabel={look.word()}
            accessibilityState={{ selected }}
            aria-selected={selected}
            onPress={() => goToTab(name)}
            style={styles.tab}
          >
            <Icon name={look.icon} color={selected ? C.ink : C.ink2} />
            <Text
              style={[selected ? T.smallStrong : T.small, selected ? styles.onTab : styles.offTab]}
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
            >
              {look.word()}
            </Text>
            {selected ? <View style={styles.tabMark} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function Shell() {
  useEffect(() => boot(), []);
  const tab = useSelect(navStore, (state) => state.tab);
  const stack = useSelect(navStore, (state) => state.stack);
  const sheets = useSelect(navStore, (state) => state.sheets);
  const askEnabled = useSelect(catalogStore, (state) => state.askEnabled);
  const user = useSelect(sessionStore, (state) => state.user);
  const checked = useSelect(sessionStore, (state) => state.checked);
  // A tab mounts on its first visit and then stays; Home is ready from the start.
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(new Set<Tab>(['home']));
  useEffect(() => {
    setVisited((old) => (old.has(tab) ? old : new Set([...old, tab])));
  }, [tab]);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => back());
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (Platform.OS === 'web') document.title = w('app.fullName');
  }, []);
  // Edge-to-edge Android does not resize for the keyboard, so the content avoids it itself and the
  // tab bar steps aside while typing.
  const keyboard = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  // A link or a signed-out return to someone's own page asks for sign-in first, and nothing shows.
  const top = stack.at(-1);
  useEffect(() => {
    if (top && privateRoute(top) && checked && !user) {
      back();
      requireSignIn(() => navStore.patch({ stack: [...navStore.get().stack, top] }));
    }
  }, [top, checked, user]);
  const shownTabs = askEnabled ? tabs : tabs.filter((name) => name !== 'ask');
  // Ask off on the server while on its tab: back to Home, never a half-built screen.
  useEffect(() => {
    if (!askEnabled && tab === 'ask') goToTab('home');
  }, [askEnabled, tab]);
  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.app}>
      <StatusBar barStyle="dark-content" backgroundColor={C.ground} />
      {testBuild ? (
        <View pointerEvents="none" style={styles.testMark}>
          <Text style={[T.small, styles.testWord]} maxFontSizeMultiplier={1}>
            TEST
          </Text>
        </View>
      ) : null}
      <View style={[styles.fill, { paddingBottom: Math.max(0, keyboard - insets.bottom) }]}>
        <View style={styles.fill}>
          {tabs.map((name) =>
            visited.has(name) ? (
              // Screens with one person's details start afresh when the account changes. Ask keeps
              // its own store, which goes on sign-out.
              <Pane
                key={name === 'orders' || name === 'account' ? `${name}:${user?.id ?? ''}` : name}
                active={!stack.length && tab === name}
              >
                {screens[name]()}
              </Pane>
            ) : null,
          )}
          {stack.map((route, index) => (
            <Pane
              key={`${index}:${JSON.stringify(route)}:${user?.id ?? ''}`}
              active={index === stack.length - 1}
            >
              <Rising>
                <PushedScreen route={route} />
              </Rising>
            </Pane>
          ))}
          {!sheets.length ? <Toast /> : null}
        </View>
        {!stack.length && (tab === 'home' || tab === 'ask') ? <ListBar /> : null}
      </View>
      {!keyboard && !stack.length ? <TabBar shown={shownTabs} /> : null}
      {sheets.map((sheet) => (
        <SheetHost key={JSON.stringify(sheet)} sheet={sheet} />
      ))}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    // Light until the screens move to useStyles (phases B5 and G1); then "auto" follows the phone.
    <ThemeProvider choice="light">
      <SafeAreaProvider>
        <ErrorBoundary>
          <UpdateGate>
            <Shell />
          </UpdateGate>
        </ErrorBoundary>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.ground },
  fill: { flex: 1 },
  ground: { backgroundColor: C.ground },
  testMark: {
    position: 'absolute',
    top: 2,
    alignSelf: 'center',
    zIndex: 20,
    paddingHorizontal: space[1],
    backgroundColor: C.down,
  },
  testWord: { color: C.ink2, fontSize: 11, lineHeight: 14 },
  tabs: { flexDirection: 'row', backgroundColor: C.up },
  tab: {
    flex: 1,
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: space[1],
  },
  onTab: { color: C.ink },
  offTab: { color: C.ink2 },
  tabMark: { position: 'absolute', bottom: 3, width: 24, height: 2, backgroundColor: C.ink },
});
