import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { money, space, textSize, type Product } from '@shiv/shared';
import { useStore } from './store';
import { categoryName, MaterialArt } from './catalog';
import { Button, C, Icon, Notice, Screen, s } from './ui';

/** Side-by-side check of up to three materials: price per selling unit, pack, grade, rules. */
export function Compare() {
  const { compare, toggleCompare, clearCompare, products, knownProducts, add, t, language } =
    useStore();
  const [query, setQuery] = useState('');
  const pool = useMemo(() => {
    const all = new Map<string, Product>();
    for (const product of [...products, ...Object.values(knownProducts)])
      all.set(product.id, product);
    const words = query.trim().toLowerCase();
    return [...all.values()]
      .filter((product) => !compare.some((item) => item.id === product.id))
      .filter(
        (product) =>
          !words ||
          `${product.name} ${product.brand} ${product.category.name}`.toLowerCase().includes(words),
      )
      .slice(0, 8);
  }, [products, knownProducts, compare, query]);
  const units = new Set(compare.map((product) => product.unit));
  const rows: [string, (product: Product) => string][] = [
    [t('Price', 'भाव'), (p) => `${money(p.pricePaise)} / ${p.unit}`],
    [t('Brand', 'ब्रांड'), (p) => p.brand],
    [t('Material', 'सामग्री'), (p) => categoryName(p.category.slug, p.category.name, language)],
    [t('Type', 'प्रकार'), (p) => p.type || '—'],
    [t('Grade', 'ग्रेड'), (p) => p.grade || '—'],
    [t('Pack', 'पैक'), (p) => p.packSize || '—'],
    [
      t('Order rule', 'ऑर्डर नियम'),
      (p) =>
        t(
          `min ${p.minQuantity}, step ${p.quantityStep}`,
          `कम से कम ${p.minQuantity}, गुणक ${p.quantityStep}`,
        ),
    ],
    [
      t('Stock', 'स्टॉक'),
      (p) =>
        p.stock >= p.minQuantity ? t('In stock', 'स्टॉक में') : t('Out of stock', 'स्टॉक नहीं'),
    ],
  ];
  return (
    <Screen>
      <View style={s.between}>
        <Text style={s.h1} accessibilityRole="header">
          {t('Compare', 'तुलना करें')}
        </Text>
        {compare.length > 0 && (
          <Button kind="quiet" onPress={clearCompare}>
            {t('Clear', 'हटाएँ')}
          </Button>
        )}
      </View>
      {compare.length === 0 ? (
        <Text style={s.body}>
          {t(
            'Pick up to three materials to see their price per selling unit, pack and grade side by side.',
            'तीन तक सामग्री चुनें और उनका इकाई भाव, पैक और ग्रेड एक साथ देखें।',
          )}
        </Text>
      ) : (
        <>
          {units.size > 1 && (
            <Notice>
              {t(
                'These are sold in different units, so compare the price per unit, not the totals.',
                'ये अलग इकाइयों में बिकते हैं, इसलिए इकाई का भाव मिलाएँ, कुल नहीं।',
              )}
            </Notice>
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {compare.map((product) => (
                <View key={product.id} style={[s.card, { width: 200, gap: space.sm }]}>
                  <View style={s.between}>
                    <MaterialArt product={product} size={48} />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${t('Remove from comparison', 'तुलना से हटाएँ')}: ${product.name}`}
                      onPress={() => toggleCompare(product)}
                      style={{ padding: space.sm }}
                    >
                      <Icon name="close" />
                    </Pressable>
                  </View>
                  <Text style={s.h3} numberOfLines={3}>
                    {product.name}
                  </Text>
                  {rows.map(([label, value]) => (
                    <View key={label}>
                      <Text style={[s.small, { fontSize: 13 }]}>{label}</Text>
                      <Text
                        style={{
                          color: C.ink,
                          fontSize: textSize.body,
                          fontWeight: label === rows[0]?.[0] ? '800' : '500',
                        }}
                      >
                        {value(product)}
                      </Text>
                    </View>
                  ))}
                  {product.stock >= product.minQuantity && (
                    <Button icon="add" onPress={() => void add(product)}>
                      {t('Add', 'जोड़ें')}
                    </Button>
                  )}
                </View>
              ))}
            </View>
          </ScrollView>
        </>
      )}
      {compare.length < 3 && (
        <View style={{ gap: space.sm }}>
          <Text style={s.h3}>{t('Add a material', 'सामग्री जोड़ें')}</Text>
          <TextInput
            accessibilityLabel={t('Search materials to compare', 'तुलना के लिए सामग्री खोजें')}
            placeholder={t('Search by name or brand', 'नाम या ब्रांड से खोजें')}
            placeholderTextColor={C.muted}
            value={query}
            onChangeText={setQuery}
            style={s.input}
          />
          {pool.map((product) => (
            <Pressable
              key={product.id}
              accessibilityRole="button"
              accessibilityLabel={`${t('Add to comparison', 'तुलना में जोड़ें')}: ${product.name}`}
              onPress={() => toggleCompare(product)}
              style={({ pressed }) => [
                s.card,
                s.row,
                { padding: space.md },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Icon name="add-circle" color={C.clay} size={26} />
              <View style={{ flex: 1 }}>
                <Text style={[s.body, { color: C.ink, fontWeight: '700' }]}>{product.name}</Text>
                <Text style={s.small}>
                  {money(product.pricePaise)} / {product.unit}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
