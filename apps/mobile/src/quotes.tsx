import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  dateLabel,
  dayLabel,
  deliveryDateOptions,
  momentLabel,
  money,
  quantityProblem,
  quoteStatusText,
  space,
  type Page,
  type Product,
  type Quote,
} from '@shiv/shared';
import { ApiError, api } from './api';
import { useStore } from './store';
import { Button, C, Chip, Empty, Field, Icon, Notice, Screen, Section, Tag, s } from './ui';
import { MaterialArt, Quantity } from './catalog';
import { confirm } from './orders';

export function Quotes() {
  const { navigate, t, language, registerRefresh, say } = useStore();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  // Consent is per revision: a new offer from the shop needs a fresh tick.
  const [consents, setConsents] = useState<Record<string, number>>({});
  const load = useCallback(
    async (after?: string) => {
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
        setError(say(e));
      } finally {
        setLoading(false);
      }
    },
    [say],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => registerRefresh(() => load()), [load, registerRefresh]);
  async function respond(q: Quote, status: 'ACCEPTED' | 'REJECTED') {
    if (status === 'ACCEPTED' && consents[q.id] !== q.revision) return;
    if (
      status === 'REJECTED' &&
      !(await confirm(
        t('Reject this offer revision?', 'प्रस्ताव का यह संस्करण अस्वीकार करें?'),
        language,
        t('Reject', 'अस्वीकार करें'),
        t('Keep', 'रखें'),
      ))
    )
      return;
    setBusy(q.id);
    try {
      await api(`/quotes/${q.id}/respond`, 'POST', { revision: q.revision, status });
      await load();
    } catch (e) {
      setError(say(e));
      await load();
    } finally {
      setBusy('');
    }
  }
  return (
    <Screen
      footer={
        <Button icon="add" onPress={() => navigate({ screen: 'QuoteRequest' })}>
          {t('New bulk quote request', 'नया थोक भाव अनुरोध')}
        </Button>
      }
    >
      <Text style={s.h1} accessibilityRole="header">
        {t('Bulk quotes', 'थोक भाव')}
      </Text>
      {Boolean(error) && <Notice error>{error}</Notice>}
      {loading && !quotes.length && <Text style={s.body}>{t('Loading…', 'लोड हो रहा है…')}</Text>}
      {!loading && !quotes.length && (
        <Empty
          icon="document-text-outline"
          title={t('A bigger build deserves a written price', 'बड़े काम के लिए लिखित भाव')}
          body={t(
            'Send your material list and site. The shop replies with prices, freight and delivery terms.',
            'अपनी सामग्री सूची और साइट भेजें। दुकान भाव, भाड़ा और डिलीवरी शर्तें भेजेगी।',
          )}
        />
      )}
      {quotes.map((q) => {
        const expired =
          q.status === 'SENT' && q.validUntil && new Date(q.validUntil).getTime() <= Date.now();
        const status = expired ? 'EXPIRED' : q.status;
        return (
          <View key={q.id} style={[s.card, { gap: space.sm }]}>
            <View style={s.between}>
              <View>
                <Text style={s.h3}>{q.number}</Text>
                <Text style={s.small}>
                  {t('Revision', 'संस्करण')} {q.revision}
                </Text>
              </View>
              <Tag tone={status === 'ACCEPTED' ? 'green' : status === 'SENT' ? 'clay' : 'grey'}>
                {quoteStatusText(status, language)}
              </Tag>
            </View>
            {q.items.map((i) => (
              <View key={i.productId} style={[s.between, { alignItems: 'flex-start' }]}>
                <Text style={[s.body, { flex: 1, color: C.ink }]}>
                  {i.name} · {i.quantity} {i.unit}
                </Text>
                <Text style={[s.small, { textAlign: 'right' }]}>
                  {i.unitPricePaise === null
                    ? t('Price pending', 'भाव बाकी')
                    : `${money(i.unitPricePaise)} / ${i.unit}`}
                </Text>
              </View>
            ))}
            <Text style={s.small}>
              {q.address.line1}, {q.address.area}, {q.address.city} {q.address.pincode}
              {'\n'}
              {t('Requested delivery', 'चाही डिलीवरी')}: {dayLabel(q.deliveryDate, language)} ·{' '}
              {q.deliveryConfirmed
                ? t('delivery terms confirmed by the shop', 'दुकान ने डिलीवरी शर्तें पक्की कीं')
                : t('delivery terms not confirmed yet', 'डिलीवरी शर्तें अभी पक्की नहीं')}
            </Text>
            {q.totalPaise !== null && (
              <>
                <View style={s.divider} />
                <View style={s.between}>
                  <Text style={s.body}>{t('Freight', 'भाड़ा')}</Text>
                  <Text style={s.body}>{money(q.deliveryFeePaise)}</Text>
                </View>
                <View style={s.between}>
                  <Text style={s.h3}>{t('Quoted total', 'कुल भाव')}</Text>
                  <Text style={s.price}>{money(q.totalPaise)}</Text>
                </View>
              </>
            )}
            {q.validUntil && (
              <Text style={s.small}>
                {t('Offer valid until', 'प्रस्ताव की अंतिम तारीख')}:{' '}
                {momentLabel(q.validUntil, language)}
              </Text>
            )}
            {q.adminNote ? <Notice>{q.adminNote}</Notice> : null}
            {status === 'SENT' && (
              <>
                <Pressable
                  accessibilityRole="checkbox"
                  aria-checked={consents[q.id] === q.revision}
                  accessibilityState={{ checked: consents[q.id] === q.revision }}
                  onPress={() =>
                    setConsents({
                      ...consents,
                      [q.id]: consents[q.id] === q.revision ? 0 : q.revision,
                    })
                  }
                  style={[s.row, { minHeight: 56, alignItems: 'flex-start' }]}
                >
                  <Icon
                    name={consents[q.id] === q.revision ? 'checkbox' : 'square-outline'}
                    color={C.clay}
                    size={28}
                  />
                  <Text style={[s.body, { flex: 1, color: C.ink }]}>
                    {t(
                      'I reviewed this revision’s items, unit prices, freight, delivery terms, expiry and total.',
                      'मैंने इस संस्करण की सामग्री, इकाई भाव, भाड़ा, डिलीवरी शर्तें, अंतिम तारीख और कुल राशि जाँच ली है।',
                    )}
                  </Text>
                </Pressable>
                <Button
                  loading={busy === q.id}
                  disabled={consents[q.id] !== q.revision}
                  onPress={() => void respond(q, 'ACCEPTED')}
                >
                  {t('Accept this revision', 'यह संस्करण स्वीकार करें')} · {money(q.totalPaise!)}
                </Button>
                <Button
                  kind="quiet"
                  disabled={busy === q.id}
                  onPress={() => void respond(q, 'REJECTED')}
                >
                  {t('Reject offer', 'प्रस्ताव अस्वीकार करें')}
                </Button>
              </>
            )}
            {q.decisionSource && (
              <Text style={s.small}>
                {q.decisionSource === 'CUSTOMER'
                  ? t('Decision made by you', 'फ़ैसला आपने किया')
                  : t('Decision recorded by the shop', 'फ़ैसला दुकान ने दर्ज किया')}
                {q.decisionNote ? ` · ${q.decisionNote}` : ''}
              </Text>
            )}
            {status === 'ACCEPTED' &&
              (q.order ? (
                <Button secondary onPress={() => navigate({ screen: 'Order', id: q.order!.id })}>
                  {t('View order', 'ऑर्डर देखें')} · {q.order.number}
                </Button>
              ) : (
                <Notice>
                  {t(
                    'Acceptance is recorded. The shop confirms stock and delivery, then turns this into an order. Nothing is charged now.',
                    'स्वीकृति दर्ज है। दुकान स्टॉक और डिलीवरी जाँचकर इससे ऑर्डर बनाएगी। अभी कोई पैसा नहीं लिया जाता।',
                  )}
                </Notice>
              ))}
          </View>
        );
      })}
      {cursor && (
        <Button secondary loading={loading} onPress={() => void load(cursor)}>
          {t('Load more', 'और दिखाएँ')}
        </Button>
      )}
    </Screen>
  );
}

const quoteQuantity = (product: Product, wanted = 100) =>
  Math.ceil(Math.max(wanted, product.minQuantity) / product.quantityStep) * product.quantityStep;

export function QuoteRequest() {
  const {
    products: homeProducts,
    addresses,
    route,
    t,
    language,
    navigate,
    quoteDraft,
    updateQuoteDraft,
    resetQuoteDraft,
    draftsLoading,
    openAddresses,
    registerRefresh,
    setToast,
    say,
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
  const [products, setProducts] = useState<Product[]>(homeProducts);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Product[]>(homeProducts);
  const [searchError, setSearchError] = useState('');
  const [searchVersion, setSearchVersion] = useState(0);
  const [moreOpen, setMoreOpen] = useState(Boolean(company || gstin || notes));
  const searchRequest = useRef(0);
  useEffect(() => {
    let live = true;
    const current = ++searchRequest.current;
    const timer = setTimeout(() => {
      void api<Page<Product>>(`/products?limit=24&q=${encodeURIComponent(search)}`)
        .then((page) => {
          if (live && current === searchRequest.current) {
            setFound(page.items);
            setSearchError('');
            setProducts((old) => [
              ...new Map([...old, ...page.items].map((p) => [p.id, p])).values(),
            ]);
          }
        })
        .catch((e) => {
          if (live && current === searchRequest.current) setSearchError(say(e));
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
            [p.id]: quoteQuantity(p, draftRef.current.lines[p.id] || 100),
          });
        })
        .catch((e) => {
          if (active) setSearchError(say(e));
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
        setSearchError(
          t(
            'Some chosen materials could not be refreshed. Try again before sending.',
            'कुछ चुनी सामग्री अपडेट नहीं हो सकी। भेजने से पहले फिर कोशिश करें।',
          ),
        );
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
      setToast(
        t(
          'Request sent. The shop will reply with a written quote.',
          'अनुरोध भेज दिया। दुकान लिखित भाव भेजेगी।',
        ),
      );
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
        setError(say(e));
      } else
        setError(
          t(
            `The result is not confirmed yet. Check this same request before starting another. ${say(e)}`,
            `परिणाम अभी पक्का नहीं है। नया अनुरोध शुरू करने से पहले यही अनुरोध जाँचें। ${say(e)}`,
          ),
        );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (draftsLoading)
    return (
      <Screen>
        <Text style={s.body}>
          {t('Restoring your request…', 'आपका अनुरोध वापस लाया जा रहा है…')}
        </Text>
      </Screen>
    );
  if (locked)
    return (
      <Screen
        footer={
          <Button loading={busy} onPress={() => void submit()}>
            {t('Check request result', 'अनुरोध का परिणाम जाँचें')}
          </Button>
        }
      >
        <Text style={s.h1}>{t('Check your bulk request', 'अपना थोक अनुरोध जाँचें')}</Text>
        <Notice>
          {t(
            'Your request is saved. Checking sends the same request, so it is never submitted twice.',
            'आपका अनुरोध सहेजा है। जाँचने पर वही अनुरोध जाता है, दो बार नहीं भेजा जाएगा।',
          )}
        </Notice>
        {Boolean(error) && <Notice error>{error}</Notice>}
        <Button secondary disabled={busy} onPress={() => navigate({ screen: 'Quotes' })}>
          {t('View quotes', 'भाव देखें')}
        </Button>
      </Screen>
    );
  const dates = deliveryDateOptions(new Date(), 1, 21);
  const invalid =
    !addressId ||
    !Object.keys(lines).length ||
    Object.entries(lines).some(([id, quantity]) => {
      const product = products.find((item) => item.id === id);
      return !product || !product.active || quantityProblem(product, quantity, 100000) !== null;
    });
  return (
    <Screen
      footer={
        <Button disabled={invalid} loading={busy} onPress={() => void submit()} icon="send">
          {t('Send bulk request', 'थोक अनुरोध भेजें')}
        </Button>
      }
    >
      <Text style={s.h1} accessibilityRole="header">
        {t('Ask for a bulk quote', 'थोक भाव माँगें')}
      </Text>
      <Text style={s.body}>
        {t(
          'No payment now. The shop sends a written price with freight and a validity date.',
          'अभी कोई भुगतान नहीं। दुकान भाड़े और अंतिम तारीख के साथ लिखित भाव भेजेगी।',
        )}
      </Text>
      <Section title={t('1. Materials and quantity', '1. सामग्री और मात्रा')} />
      {Object.entries(lines).map(([id, n]) => {
        const product = products.find((item) => item.id === id);
        return (
          <View key={id} style={[s.card, { gap: space.sm }]}>
            <View style={s.row}>
              {product && <MaterialArt product={product} size={44} />}
              <View style={{ flex: 1 }}>
                <Text style={s.h3}>{product?.name || t('Loading…', 'लोड हो रहा है…')}</Text>
                {product && (
                  <Text style={s.small}>
                    {t(
                      `per ${product.unit} · minimum ${product.minQuantity}, steps of ${product.quantityStep}`,
                      `प्रति ${product.unit} · कम से कम ${product.minQuantity}, ${product.quantityStep} के गुणक`,
                    )}
                  </Text>
                )}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Remove quote product', 'भाव से सामग्री हटाएँ')}
                onPress={() => {
                  const next = { ...lines };
                  delete next[id];
                  setLines(next);
                }}
                style={{ padding: space.md }}
              >
                <Icon name="trash-outline" color={C.muted} />
              </Pressable>
            </View>
            <Quantity
              value={n}
              min={product?.minQuantity || 1}
              step={product?.quantityStep || 1}
              max={100000}
              disabled={!product}
              change={(value) => setLines({ ...lines, [id]: value })}
            />
          </View>
        );
      })}
      <Field
        label={t('Find a material to add', 'जोड़ने के लिए सामग्री खोजें')}
        value={search}
        onChangeText={setSearch}
        placeholder={t('Cement, TMT, bricks…', 'सीमेंट, सरिया, ईंट…')}
      />
      {searchError ? (
        <View style={{ gap: space.sm }}>
          <Notice error>{searchError}</Notice>
          <Button secondary onPress={() => setSearchVersion((value) => value + 1)}>
            {t('Try again', 'फिर कोशिश करें')}
          </Button>
        </View>
      ) : null}
      <View style={{ gap: space.sm }}>
        {found
          .filter((p) => !lines[p.id])
          .slice(0, 8)
          .map((p) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('Add to quote', 'भाव सूची में जोड़ें')}: ${p.name}`}
              key={p.id}
              onPress={() => setLines({ ...lines, [p.id]: quoteQuantity(p) })}
              style={({ pressed }) => [
                s.card,
                s.row,
                { padding: space.md },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Icon name="add-circle" color={C.clay} size={26} />
              <Text style={[s.body, { color: C.ink, flex: 1 }]}>{p.name}</Text>
              <Text style={s.small}>{p.unit}</Text>
            </Pressable>
          ))}
      </View>
      <Section
        title={t('2. Delivery site', '2. डिलीवरी साइट')}
        action={t('Add address', 'पता जोड़ें')}
        onAction={() => openAddresses()}
      />
      {!addresses.length && (
        <Notice>
          {t('Save a site address before sending.', 'भेजने से पहले साइट का पता सहेजें।')}
        </Notice>
      )}
      {addresses.map((a) => (
        <Pressable
          key={a.id}
          accessibilityRole="radio"
          aria-checked={addressId === a.id}
          accessibilityState={{ checked: addressId === a.id }}
          onPress={() => update({ addressId: a.id })}
          style={[s.card, s.row, addressId === a.id && { borderColor: C.ink, borderWidth: 2 }]}
        >
          <Icon name={addressId === a.id ? 'radio-button-on' : 'radio-button-off'} color={C.clay} />
          <Text style={[s.body, { flex: 1, color: C.ink }]}>
            {a.label} · {a.line1}, {a.city}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('Edit', 'बदलें')} ${a.label}`}
            onPress={(event) => {
              event.stopPropagation();
              openAddresses(a.id);
            }}
            style={{ padding: space.md }}
          >
            <Icon name="create-outline" />
          </Pressable>
        </Pressable>
      ))}
      <Section title={t('3. When do you need it?', '3. कब चाहिए?')} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.sm }}
      >
        {dates.map((value) => (
          <Chip
            key={value}
            role="radio"
            label={dayLabel(value, language).split(',')[0] ?? ''}
            detail={dateLabel(`${value}T12:00:00+05:30`, language).replace(/,? \d{4}$/, '')}
            accessibilityLabel={dayLabel(value, language)}
            selected={date === value}
            onPress={() => update({ date: value })}
          />
        ))}
      </ScrollView>
      {moreOpen ? (
        <View style={s.stack}>
          <Field
            label={t('Company (optional)', 'कंपनी (वैकल्पिक)')}
            value={company}
            onChangeText={(value) => update({ company: value })}
            maxLength={150}
          />
          <Field
            label={t('GSTIN (optional)', 'GSTIN (वैकल्पिक)')}
            value={gstin}
            onChangeText={(v) => update({ gstin: v.toUpperCase() })}
            autoCapitalize="characters"
            maxLength={15}
          />
          <Field
            label={t('About your project', 'आपके काम के बारे में')}
            value={notes}
            onChangeText={(value) => update({ notes: value })}
            multiline
            maxLength={1500}
            placeholder={t(
              'Grade, unloading, floors, project size…',
              'ग्रेड, उतराई, मंज़िल, काम का आकार…',
            )}
          />
        </View>
      ) : (
        <Button kind="quiet" icon="add" onPress={() => setMoreOpen(true)}>
          {t('Add company, GSTIN or notes', 'कंपनी, GSTIN या जानकारी जोड़ें')}
        </Button>
      )}
      {Boolean(error) && <Notice error>{error}</Notice>}
    </Screen>
  );
}
