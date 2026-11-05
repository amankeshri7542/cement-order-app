import { StyleSheet, Text, View, Pressable } from 'react-native';
import { openSheet } from '../../state/nav';
import { sitesStore } from '../../state/sites';
import { useSelect } from '../../state/use';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Empty } from '../../ui/Notice';
import { Screen, TopBar } from '../../ui/Screen';
import { C, space, T } from '../../ui/tokens';
import { w } from '../../words';

/** Sites from Account: read from the phone while offline, and adding one needs internet. */
export function SitesScreen() {
  const sites = useSelect(sitesStore, (state) => state.items);
  return (
    <Screen
      topBar={<TopBar title={w('sites.title')} />}
      footer={
        <Button icon="add" onPress={() => openSheet({ sheet: 'site-form', purpose: 'browse' })}>
          {w('sites.add')}
        </Button>
      }
    >
      {!sites.length ? <Empty title={w('sites.none')} body={w('sites.noneBody')} /> : null}
      <View style={styles.rows}>
        {sites.map((site) => (
          <Pressable
            key={site.id}
            accessibilityRole="button"
            accessibilityLabel={w('sites.editLabel', { site: site.label })}
            onPress={() => openSheet({ sheet: 'site-form', id: site.id, purpose: 'browse' })}
            style={styles.row}
          >
            <View style={styles.flex}>
              <Text style={T.body}>{site.label}</Text>
              <Text style={[T.small, styles.quiet]}>
                {[site.name, site.line1, site.area, site.pincode].filter(Boolean).join(', ')}
              </Text>
              {site.lat != null ? (
                <Text style={[T.small, styles.quiet]}>{w('sites.hasPin')}</Text>
              ) : null}
            </View>
            <Icon name="chevron-forward" size={18} />
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rows: { gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: C.up,
    padding: space[3],
  },
  flex: { flex: 1, minWidth: 0 },
  quiet: { color: C.ink2 },
});
