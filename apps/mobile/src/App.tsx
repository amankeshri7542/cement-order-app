import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StoreProvider, useStore } from './store';
import { C, Icon, Notice, Button, s } from './ui';
import { Home, Catalogue, ProductDetail } from './catalog';
import { Cart, Checkout } from './checkout';
import { Account, Addresses, Login } from './account';
import { Orders, OrderDetail } from './orders';
import { Quotes, QuoteRequest } from './quotes';
export default function App() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </SafeAreaProvider>
  );
}
function Shell() {
  const {
    route,
    navigate,
    t,
    language,
    setLanguage,
    cart,
    user,
    error,
    loading,
    refreshCatalog,
    toast,
    setToast,
    setLoginVisible,
  } = useStore();
  const scroll = useRef<ScrollView>(null);
  const { width } = useWindowDimensions();
  const primary = ['Home', 'Products', 'Orders', 'Account'].includes(route.screen);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [route]);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.screen === 'Home') return false;
      navigate({ screen: 'Home' });
      return true;
    });
    return () => listener.remove();
  }, [route, navigate]);
  useEffect(() => {
    if (Platform.OS === 'web') document.title = 'Shiv Cement Store · Build with confidence';
  }, []);
  const screen =
    route.screen === 'Home' ? (
      <Home />
    ) : route.screen === 'Products' ? (
      <Catalogue key={route.category || 'all'} />
    ) : route.screen === 'Product' ? (
      <ProductDetail key={route.id} />
    ) : route.screen === 'Cart' ? (
      <Cart />
    ) : route.screen === 'Checkout' ? (
      <Checkout />
    ) : route.screen === 'Orders' ? (
      <Orders />
    ) : route.screen === 'Order' ? (
      <OrderDetail key={route.id} />
    ) : route.screen === 'Addresses' ? (
      <Addresses />
    ) : route.screen === 'Quotes' ? (
      <Quotes />
    ) : route.screen === 'QuoteRequest' ? (
      <QuoteRequest key={route.id || 'new'} />
    ) : (
      <Account />
    );
  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={a.app}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <View style={a.header}>
        <View style={[a.headerInner, width < 600 && { paddingHorizontal: 20 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Shiv Cement Store home"
            style={s.row}
            onPress={() => navigate({ screen: 'Home' })}
          >
            <View style={a.logo}>
              <Icon name="business-outline" color={C.navy} size={26} />
            </View>
            <View>
              <Text style={a.brand}>SHIV</Text>
              <Text style={a.brandSmall}>CEMENT STORE</Text>
            </View>
          </Pressable>
          <View style={a.headerActions}>
            {width > 650 && (
              <View style={[s.row, { marginRight: 15 }]}>
                <Icon name="location-outline" color="#7e94a5" size={20} />
                <View>
                  <Text style={{ color: '#93a1ab', fontSize: 9 }}>BUILDING MATERIALS</Text>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: C.ink, marginTop: 4 }}>
                    Patna & Bihar
                  </Text>
                </View>
              </View>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Switch language"
              onPress={() => setLanguage(language === 'en' ? 'hi' : 'en')}
              style={a.language}
            >
              <Text style={{ color: C.ink, fontSize: 12 }}>
                {language === 'en' ? 'हिंदी' : 'EN'}
              </Text>
            </Pressable>
            {width > 600 && !user && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setLoginVisible(true)}
                style={{ padding: 10 }}
              >
                <Text style={s.link}>{t('signin')}</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('cart')}, ${cart.length} products`}
              onPress={() => navigate({ screen: 'Cart' })}
              style={a.cartButton}
            >
              <Icon name="bag-outline" size={23} />
              {cart.length > 0 && (
                <View style={a.cartCount}>
                  <Text style={{ fontSize: 8, fontWeight: '800', color: C.navy }}>
                    {cart.length}
                  </Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>
      </View>
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={() => void refreshCatalog()} />
        }
      >
        <View
          style={[
            a.content,
            {
              maxWidth: ['Home', 'Products'].includes(route.screen) ? 1110 : 720,
              paddingHorizontal: width < 550 ? 19 : 32,
            },
          ]}
        >
          {!primary && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('back')}
              onPress={() =>
                navigate({
                  screen:
                    route.screen === 'Checkout'
                      ? 'Cart'
                      : route.screen === 'Product'
                        ? 'Products'
                        : route.screen === 'Order'
                          ? 'Orders'
                          : 'Account',
                })
              }
              style={a.back}
            >
              <Icon name="arrow-back" size={19} />
              <Text style={s.link}>{t('back')}</Text>
            </Pressable>
          )}
          {Boolean(error) && (
            <View style={[s.stack, { marginBottom: 20 }]}>
              <Notice error>{error}</Notice>
              <Button secondary onPress={() => void refreshCatalog()}>
                {t('retry')}
              </Button>
            </View>
          )}
          {loading ? (
            <View style={a.loading}>
              <ActivityIndicator color={C.navy} size="large" />
              <Text style={s.body}>{t('loading')}</Text>
            </View>
          ) : error ? null : (
            screen
          )}
        </View>
      </ScrollView>
      <View style={a.nav}>
        <View style={a.navInner}>
          {[
            { name: 'Home', label: 'home', icon: 'home-outline', selectedIcon: 'home' },
            { name: 'Products', label: 'products', icon: 'grid-outline', selectedIcon: 'grid' },
            { name: 'Orders', label: 'orders', icon: 'receipt-outline', selectedIcon: 'receipt' },
            { name: 'Account', label: 'account', icon: 'person-outline', selectedIcon: 'person' },
          ].map((x) => {
            const selected = x.name === route.screen;
            return (
              <Pressable
                key={x.name}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() =>
                  navigate({ screen: x.name as 'Home' | 'Products' | 'Orders' | 'Account' })
                }
                style={a.navItem}
              >
                <View style={[a.navIcon, selected && { backgroundColor: '#fcf1cf' }]}>
                  <Icon
                    name={(selected ? x.selectedIcon : x.icon) as 'home'}
                    size={21}
                    color={selected ? C.navy : '#8c9daa'}
                  />
                </View>
                <Text
                  style={{
                    color: selected ? C.navy : '#8c9daa',
                    fontSize: 10,
                    fontWeight: selected ? '700' : '400',
                  }}
                >
                  {t(x.label as 'home')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {toast ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          onPress={() => setToast('')}
          style={a.toast}
        >
          <Text
            accessibilityLiveRegion="polite"
            style={{ color: '#fff', fontSize: 12, lineHeight: 18 }}
          >
            {toast}
          </Text>
          <Icon name="close" color="#fff" size={16} />
        </Pressable>
      ) : null}
      <Login />
    </SafeAreaView>
  );
}
const a = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.paper },
  header: { backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.line },
  headerInner: {
    width: '100%',
    maxWidth: 1110,
    marginHorizontal: 'auto',
    height: 83,
    paddingHorizontal: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logo: {
    height: 43,
    width: 43,
    borderRadius: 7,
    backgroundColor: C.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: { fontSize: 25, fontWeight: '900', letterSpacing: 1.8, color: C.navy, lineHeight: 28 },
  brandSmall: {
    fontSize: 8,
    letterSpacing: 1.7,
    color: '#8494a0',
    fontWeight: '700',
    marginTop: 2,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  language: { minWidth: 39, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  cartButton: { position: 'relative', padding: 10, minWidth: 44, minHeight: 44 },
  cartCount: {
    position: 'absolute',
    top: 3,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: C.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { width: '100%', alignSelf: 'center', paddingTop: 25, paddingBottom: 35 },
  nav: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.line },
  navInner: {
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 7,
  },
  navItem: { alignItems: 'center', justifyContent: 'center', gap: 5, minWidth: 70, minHeight: 53 },
  navIcon: {
    width: 45,
    height: 29,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
    minHeight: 35,
    alignSelf: 'flex-start',
  },
  loading: { paddingVertical: 100, alignItems: 'center', gap: 20 },
  toast: {
    position: 'absolute',
    bottom: 85,
    alignSelf: 'center',
    width: '88%',
    maxWidth: 550,
    backgroundColor: C.navy,
    padding: 16,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
});
