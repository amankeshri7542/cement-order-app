import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Quote, Page, Product, money, statusLabel } from '@shiv/shared';
import { api, message } from './api';
import { useStore } from './store';
import { Button, C, Empty, Field, Icon, Notice, Section, Tag, s } from './ui';
import { Quantity } from './catalog';
export function Quotes() {
  const { navigate, t } = useStore();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  async function load(after?: string) {
    setLoading(true);
    try {
      const page = await api<Page<Quote>>(
        `/quotes?limit=24${after ? '&cursor=' + encodeURIComponent(after) : ''}`,
      );
      setQuotes((old) => (after ? [...old, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setError('');
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function respond(q: Quote, status: 'ACCEPTED' | 'REJECTED') {
    setBusy(q.id);
    try {
      await api(`/quotes/${q.id}/respond`, 'POST', { revision: q.revision, status });
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  }
  return (
    <View style={s.stack}>
      <Section
        title={t('quotes')}
        action="+ New request"
        onAction={() => navigate({ screen: 'QuoteRequest' })}
      />
      {Boolean(error) && <Notice error>{error}</Notice>}
      {loading && <Text style={s.body}>{t('loading')}</Text>}
      {!loading && !quotes.length && (
        <Empty
          icon="document-text-outline"
          title={t('bulkTitle')}
          body={t('bulkBody')}
          action={t('requestQuote')}
          onAction={() => navigate({ screen: 'QuoteRequest' })}
        />
      )}
      {quotes.map((q) => (
        <View key={q.id} style={[s.card, s.stack]}>
          <View style={s.between}>
            <Text style={{ fontWeight: '700', color: C.ink }}>{q.number}</Text>
            <Tag tone={q.status === 'ACCEPTED' ? 'green' : 'yellow'}>{statusLabel(q.status)}</Tag>
          </View>
          <Text style={s.body}>
            {q.company || q.address.name} · {q.address.city}
            {'\n'}Requested delivery: {q.deliveryDate}
          </Text>
          {q.items.map((i) => (
            <View key={i.productId} style={s.between}>
              <Text style={[s.body, { flex: 1 }]}>
                {i.name} × {i.quantity}
              </Text>
              <Text style={{ color: C.ink, fontSize: 12 }}>
                {i.unitPricePaise === null ? 'Awaiting price' : `${money(i.unitPricePaise)} / unit`}
              </Text>
            </View>
          ))}
          {q.totalPaise !== null && (
            <>
              <View style={s.between}>
                <Text style={s.body}>Delivery</Text>
                <Text style={s.body}>{money(q.deliveryFeePaise)}</Text>
              </View>
              <View style={s.between}>
                <Text style={s.h2}>Quoted total</Text>
                <Text style={s.price}>{money(q.totalPaise)}</Text>
              </View>
              <Text style={[s.body, { fontSize: 11 }]}>
                Revision {q.revision} · Valid until{' '}
                {q.validUntil && new Date(q.validUntil).toLocaleString('en-IN')}
              </Text>
            </>
          )}
          {q.adminNote ? <Notice>{q.adminNote}</Notice> : null}
          {q.status === 'SENT' && (
            <>
              <Button loading={busy === q.id} onPress={() => void respond(q, 'ACCEPTED')}>
                Accept quote · {money(q.totalPaise!)}
              </Button>
              <Button
                secondary
                disabled={busy === q.id}
                onPress={() => void respond(q, 'REJECTED')}
              >
                Decline quote
              </Button>
            </>
          )}
          {q.decisionSource && (
            <Text style={s.body}>
              {q.decisionSource === 'CUSTOMER'
                ? 'Decision made by you'
                : 'Decision recorded by store'}
              {q.decisionNote ? ` · ${q.decisionNote}` : ''}
            </Text>
          )}
          {q.status === 'ACCEPTED' && (
            <Notice>
              The store will contact you to arrange your order and payment. Accepting this quote
              does not charge you.
            </Notice>
          )}
        </View>
      ))}
      {cursor && (
        <Button loading={loading} onPress={() => void load(cursor)}>
          Load more quotes
        </Button>
      )}
    </View>
  );
}
export function QuoteRequest() {
  const { products: homeProducts, addresses, route, t, navigate } = useStore();
  const [products, setProducts] = useState<Product[]>(homeProducts);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Product[]>(homeProducts);
  const [more, setMore] = useState<string | null>(null);
  const [searchError, setSearchError] = useState('');
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void api<Page<Product>>(`/products?limit=24&q=${encodeURIComponent(search)}`)
        .then((page) => {
          if (live) {
            setFound(page.items);
            setMore(page.nextCursor);
            setSearchError('');
            setProducts((old) => [
              ...new Map(
                [...old.filter((p) => lines[p.id]), ...page.items].map((p) => [p.id, p]),
              ).values(),
            ]);
          }
        })
        .catch((e) => {
          if (live) setSearchError(message(e));
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search]);
  useEffect(() => {
    if (route.id)
      void api<Product>(`/products/${route.id}`)
        .then((p) => {
          setProducts((old) => [...old.filter((x) => x.id !== p.id), p]);
          setLines((old) => ({
            ...old,
            [p.id]:
              Math.ceil(Math.max(old[p.id] || 100, p.minQuantity) / p.quantityStep) *
              p.quantityStep,
          }));
        })
        .catch((e) => setSearchError(message(e)));
  }, [route.id]);
  const [lines, setLines] = useState<Record<string, number>>(route.id ? { [route.id]: 100 } : {});
  const [addressId, setAddress] = useState(addresses[0]?.id || '');
  const [date, setDate] = useState(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [company, setCompany] = useState('');
  const [gstin, setGstin] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api('/quotes', 'POST', {
        items: Object.entries(lines)
          .filter(([, n]) => n > 0)
          .map(([productId, quantity]) => ({ productId, quantity })),
        addressId,
        deliveryDate: date,
        company,
        gstin,
        notes,
      });
      navigate({ screen: 'Quotes' });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={s.stack}>
      <Text style={s.title}>{t('requestQuote')}</Text>
      <Text style={s.body}>{t('bulkBody')}</Text>
      <Text style={s.h2}>Materials & quantities</Text>
      <Field label="Find a material" value={search} onChangeText={setSearch} />
      {searchError ? <Notice error>{searchError}</Notice> : null}
      {more && (
        <Button
          secondary
          onPress={() => {
            void api<Page<Product>>(
              `/products?limit=24&q=${encodeURIComponent(search)}&cursor=${encodeURIComponent(more)}`,
            )
              .then((page) => {
                setFound((old) => [...old, ...page.items]);
                setMore(page.nextCursor);
                setProducts((old) => [
                  ...new Map(
                    [...old.filter((p) => lines[p.id]), ...page.items].map((p) => [p.id, p]),
                  ).values(),
                ]);
              })
              .catch((e) => setSearchError(message(e)));
          }}
        >
          More materials
        </Button>
      )}
      <ScrollView
        horizontal
        contentContainerStyle={{ gap: 9 }}
        showsHorizontalScrollIndicator={false}
      >
        {found
          .filter((p) => !lines[p.id])
          .map((p) => (
            <Pressable
              accessibilityRole="button"
              key={p.id}
              onPress={() =>
                setLines({
                  ...lines,
                  [p.id]: Math.ceil(Math.max(100, p.minQuantity) / p.quantityStep) * p.quantityStep,
                })
              }
              style={[s.card, s.row, { padding: 13 }]}
            >
              <Icon name="add" size={17} />
              <Text style={{ fontSize: 12, color: C.ink }}>{p.name}</Text>
            </Pressable>
          ))}
      </ScrollView>
      {Object.entries(lines).map(([id, n]) => (
        <View key={id} style={[s.card, s.stack]}>
          <Text style={{ color: C.ink, fontWeight: '600' }}>
            {products.find((p) => p.id === id)?.name}
          </Text>
          <View style={s.between}>
            <Quantity
              value={n}
              max={100000}
              change={(value) => setLines({ ...lines, [id]: value })}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove quote product"
              onPress={() => {
                const next = { ...lines };
                delete next[id];
                setLines(next);
              }}
              style={{ padding: 12 }}
            >
              <Icon name="trash-outline" color={C.muted} />
            </Pressable>
          </View>
        </View>
      ))}
      <Section
        title="Delivery site"
        action="+ Add address"
        onAction={() => navigate({ screen: 'Addresses' })}
      />
      {!addresses.length && <Notice>Save a delivery address before requesting a quote.</Notice>}
      {addresses.map((a) => (
        <Pressable
          key={a.id}
          accessibilityRole="radio"
          aria-checked={addressId === a.id}
          accessibilityState={{ checked: addressId === a.id }}
          onPress={() => setAddress(a.id)}
          style={[s.card, s.row]}
        >
          <Icon name={addressId === a.id ? 'radio-button-on' : 'radio-button-off'} />
          <Text style={[s.body, { flex: 1 }]}>
            {a.label} · {a.line1}, {a.city}
          </Text>
        </Pressable>
      ))}
      <Field label="Expected delivery (YYYY-MM-DD)" value={date} onChangeText={setDate} />
      <Field label="Company (optional)" value={company} onChangeText={setCompany} maxLength={150} />
      <Field
        label="GSTIN (optional)"
        value={gstin}
        onChangeText={(v) => setGstin(v.toUpperCase())}
        autoCapitalize="characters"
        maxLength={15}
      />
      <Field
        label="Tell us about your project"
        value={notes}
        onChangeText={setNotes}
        multiline
        maxLength={1500}
        placeholder="Material grade, unloading, project size…"
      />
      {Boolean(error) && <Notice error>{error}</Notice>}
      <Button
        disabled={!addressId || !Object.keys(lines).length}
        loading={busy}
        onPress={() => void submit()}
        icon="arrow-forward"
      >
        Send bulk request
      </Button>
      <Text style={[s.body, { fontSize: 11 }]}>
        No payment is taken. The store will send you a quote with a validity period.
      </Text>
    </View>
  );
}
