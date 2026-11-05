import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { searchProducts } from '../../logic/search';
import { catalogStore } from '../../state/catalog';
import { goToTab, openSheet } from '../../state/nav';
import { useSelect } from '../../state/use';
import { Button } from '../../ui/Button';
import { TopBar } from '../../ui/Screen';
import { C, radius, space, T } from '../../ui/tokens';
import { w } from '../../words';
import { ListBar } from '../list/ListBar';
import { RateRow } from '../rates/RateRow';

const keyOf = (id: string) => id;
const renderRow = ({ item }: { item: string }) => <RateRow id={item} />;

/** Instant and on the phone: it works with no signal. Sariya, saria and rod all hit. */
export function SearchScreen() {
  const products = useSelect(catalogStore, (state) => state.products);
  const askEnabled = useSelect(catalogStore, (state) => state.askEnabled);
  const [query, setQuery] = useState('');
  const results = useMemo(
    () => searchProducts(products, query).map((product) => product.id),
    [products, query],
  );
  return (
    <View style={styles.fill}>
      <TopBar title={w('search.title')} />
      <View style={styles.box}>
        <TextInput
          accessibilityLabel={w('search.title')}
          placeholder={w('search.hint')}
          placeholderTextColor={C.ink2}
          value={query}
          onChangeText={setQuery}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          style={[T.body, styles.input]}
        />
      </View>
      <FlatList
        style={styles.fill}
        data={results}
        keyExtractor={keyOf}
        renderItem={renderRow}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          query.trim() ? (
            <View style={styles.none}>
              <Text style={T.title}>{w('home.notListed')}</Text>
              <Text style={[T.small, styles.quiet]}>{w('home.notListedDetail')}</Text>
              <Button kind="quiet" onPress={() => openSheet({ sheet: 'ask-shop' })}>
                {w('askShop.title')}
              </Button>
              {askEnabled ? (
                <Button kind="link" onPress={() => goToTab('ask')}>
                  {w('search.ask')}
                </Button>
              ) : null}
            </View>
          ) : null
        }
      />
      <ListBar />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.ground },
  box: {
    marginHorizontal: space[4],
    marginBottom: space[2],
    borderWidth: 1.5,
    borderColor: C.ink,
    borderRadius: radius.control,
    backgroundColor: C.up,
    paddingHorizontal: space[3],
  },
  input: { minHeight: 48, color: C.ink },
  none: { padding: space[4], gap: space[2] },
  quiet: { color: C.ink2 },
});
