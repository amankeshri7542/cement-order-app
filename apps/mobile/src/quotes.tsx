import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Quote, Page, Product, money, statusLabel } from '@shiv/shared';
import { ApiError, api, message } from './api';
import { useStore } from './store';
import { Button, C, Empty, Field, Icon, Notice, Section, Tag, s } from './ui';
import { Quantity } from './catalog';
export function Quotes() {
  const { navigate, t, registerRefresh } = useStore();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const load = useCallback(async (after?: string) => {
    setLoading(true);
    try {
      const page = await api<Page<Quote>>(
        `/quotes?limit=24${after ? '&cursor=' + encodeURIComponent(after) : ''}`,
      );
      setQuotes((old) =>
        after
          ? [...new Map([...old, ...page.items].map((quote) => [quote.id, quote])).values()]
          : page.items,
      );
      setCursor(page.nextCursor);
      setError('');
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => registerRefresh(() => load()), [load, registerRefresh]);
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
                {i.packSize ? `${i.packSize} · ` : ''}
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
          {q.status === 'ACCEPTED' &&
            (q.order ? (
              <Button onPress={() => navigate({ screen: 'Order', id: q.order!.id })}>
                View order · {q.order.number}
              </Button>
            ) : (
              <Notice>
                The store will contact you to arrange your order and payment. Accepting this quote
                does not charge you.
              </Notice>
            ))}
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
  const {
    products: homeProducts,
    addresses,
    route,
    t,
    navigate,
    quoteDraft,
    updateQuoteDraft,
    resetQuoteDraft,
    draftsLoading,
    openAddresses,
    registerRefresh,
    setToast,
  } = useStore();
  const draftRef = useRef(quoteDraft);
  draftRef.current = quoteDraft;
  const { lines, date, company, gstin, notes } = quoteDraft;
  const addressId =
    quoteDraft.submitted || addresses.some((address) => address.id === quoteDraft.addressId)
      ? quoteDraft.addressId
      : addresses[0]?.id || '';
  const locked = Boolean(quoteDraft.submitted);
  function update(patch: Partial<typeof quoteDraft>) {
    draftRef.current = { ...draftRef.current, ...patch };
    return updateQuoteDraft(patch);
  }
  const setLines = (value: Record<string, number>) => update({ lines: value });
  const setAddress = (value: string) => update({ addressId: value });
  const setDate = (value: string) => update({ date: value });
  const setCompany = (value: string) => update({ company: value });
  const setGstin = (value: string) => update({ gstin: value });
  const setNotes = (value: string) => update({ notes: value });
  const [products, setProducts] = useState<Product[]>(homeProducts);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Product[]>(homeProducts);
  const [more, setMore] = useState<string | null>(null);
  const [searchError, setSearchError] = useState('');
  const [searchVersion, setSearchVersion] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const searchRequest = useRef(0);
  useEffect(() => {
    let live = true;
    const current = ++searchRequest.current;
    const timer = setTimeout(() => {
      void api<Page<Product>>(`/products?limit=24&q=${encodeURIComponent(search)}`)
        .then((page) => {
          if (live && current === searchRequest.current) {
            setFound(page.items);
            setMore(page.nextCursor);
            setSearchError('');
            setProducts((old) => [
              ...new Map([...old, ...page.items].map((p) => [p.id, p])).values(),
            ]);
          }
        })
        .catch((e) => {
          if (live && current === searchRequest.current) setSearchError(message(e));
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search, searchVersion]);
  useEffect(
    () =>
      registerRefresh(async () => {
        setSearchVersion((value) => value + 1);
      }),
    [registerRefresh],
  );
  useEffect(() => {
    let active = true;
    if (route.id && !draftsLoading && !draftRef.current.submitted)
      void api<Product>(`/products/${route.id}`)
        .then((p) => {
          if (!active) return;
          setProducts((old) => [...old.filter((x) => x.id !== p.id), p]);
          setLines({
            ...draftRef.current.lines,
            [p.id]:
              Math.ceil(
                Math.max(draftRef.current.lines[p.id] || 100, p.minQuantity) / p.quantityStep,
              ) * p.quantityStep,
          });
        })
        .catch((e) => {
          if (active) setSearchError(message(e));
        });
    return () => {
      active = false;
    };
  }, [route.id, draftsLoading]);
  const selectedIds = Object.keys(lines).sort().join(',');
  useEffect(() => {
    let active = true;
    if (draftsLoading || !selectedIds) return;
    void Promise.allSettled(
      selectedIds.split(',').map((id) => api<Product>(`/products/${encodeURIComponent(id)}`)),
    ).then((results) => {
      if (!active) return;
      const loaded = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      setProducts((old) => [
        ...new Map([...old, ...loaded].map((product) => [product.id, product])).values(),
      ]);
      if (results.some((result) => result.status === 'rejected'))
        setSearchError('Some selected materials could not be refreshed. Retry before sending.');
    });
    return () => {
      active = false;
    };
  }, [selectedIds, draftsLoading, searchVersion]);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await update({ addressId, submitted: true });
      await api('/quotes', 'POST', {
        items: Object.entries(lines)
          .filter(([, n]) => n > 0)
          .map(([productId, quantity]) => ({ productId, quantity })),
        addressId,
        deliveryDate: date,
        company,
        gstin,
        notes,
        idempotencyKey: quoteDraft.idempotencyKey,
      });
      resetQuoteDraft();
      setToast('Bulk request received. The store will prepare your quote.');
      navigate({ screen: 'Quotes' });
    } catch (e) {
      if (
        e instanceof ApiError &&
        [
          'INVALID_INPUT',
          'INVALID_ADDRESS',
          'INVALID_QUANTITY',
          'INVALID_DELIVERY_DATE',
          'NOT_FOUND',
        ].includes(e.code)
      ) {
        await update({ submitted: false }).catch(() => {});
        setError(message(e));
      } else
        setError(
          `The result is not confirmed yet. Retry this same request before starting another. ${message(e)}`,
        );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (draftsLoading) return <Text style={s.body}>Restoring your quotation…</Text>;
  if (locked)
    return (
      <View style={s.stack}>
        <Text style={s.title}>Check bulk request</Text>
        <Notice>Your request is saved. Check the same request to avoid submitting it twice.</Notice>
        {Boolean(error) && <Notice error>{error}</Notice>}
        <Button loading={busy} onPress={() => void submit()}>
          Check bulk request result
        </Button>
        <Button secondary disabled={busy} onPress={() => navigate({ screen: 'Quotes' })}>
          View quotations
        </Button>
      </View>
    );
  return (
    <View style={s.stack}>
      <Text style={s.title}>{t('requestQuote')}</Text>
      <Text style={s.body}>{t('bulkBody')}</Text>
      <Text style={s.h2}>Materials & quantities</Text>
      <Field label="Find a material" value={search} onChangeText={setSearch} />
      {searchError ? (
        <View style={s.stack}>
          <Notice error>{searchError}</Notice>
          <Button secondary onPress={() => setSearchVersion((value) => value + 1)}>
            Retry materials
          </Button>
        </View>
      ) : null}
      {more && (
        <Button
          secondary
          loading={loadingMore}
          onPress={() => {
            const current = searchRequest.current;
            setLoadingMore(true);
            void api<Page<Product>>(
              `/products?limit=24&q=${encodeURIComponent(search)}&cursor=${encodeURIComponent(more)}`,
            )
              .then((page) => {
                if (current !== searchRequest.current) return;
                setFound((old) => [
                  ...new Map(
                    [...old, ...page.items].map((product) => [product.id, product]),
                  ).values(),
                ]);
                setMore(page.nextCursor);
                setProducts((old) => [
                  ...new Map([...old, ...page.items].map((p) => [p.id, p])).values(),
                ]);
              })
              .catch((e) => {
                if (current === searchRequest.current) setSearchError(message(e));
              })
              .finally(() => setLoadingMore(false));
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
      {Object.entries(lines).map(([id, n]) => {
        const product = products.find((item) => item.id === id);
        return (
          <View key={id} style={[s.card, s.stack]}>
            <Text style={{ color: C.ink, fontWeight: '600' }}>
              {product?.name || 'Loading selected material…'}
            </Text>
            {product && (
              <Text style={s.body}>
                Minimum {product.minQuantity} · step {product.quantityStep}
              </Text>
            )}
            <View style={s.between}>
              <Quantity
                value={n}
                min={product?.minQuantity || 1}
                step={product?.quantityStep || 1}
                max={100000}
                disabled={!product}
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
        );
      })}
      <Section title="Delivery site" action="+ Add address" onAction={() => openAddresses()} />
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${a.label} address`}
            onPress={(event) => {
              event.stopPropagation();
              openAddresses(a.id);
            }}
            style={{ padding: 12 }}
          >
            <Icon name="create-outline" />
          </Pressable>
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
        disabled={
          !addressId ||
          !Object.keys(lines).length ||
          Object.entries(lines).some(([id, quantity]) => {
            const product = products.find((item) => item.id === id);
            return (
              !product ||
              !product.active ||
              quantity < product.minQuantity ||
              quantity % product.quantityStep !== 0
            );
          })
        }
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
