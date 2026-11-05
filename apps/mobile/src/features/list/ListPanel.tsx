import { useEffect, useRef, useState } from 'react';
import { Keyboard, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { timeLabel } from '@shiv/shared';
import { money } from '../../logic/money';
import { linesKey, makeKey } from '../../logic/panel-core';
import { api } from '../../state/api';
import { catalogStore } from '../../state/catalog';
import { checkoutStore, checkPending, placeReviewed, updateDraft } from '../../state/checkout';
import { closeSheet, goToTab, openSheet, push } from '../../state/nav';
import { say } from '../../state/net';
import { refreshReplies } from '../../state/orders';
import { requireSignIn } from '../../state/session';
import { refreshSites, sitesStore } from '../../state/sites';
import { refreshShop, shopStore } from '../../state/shop';
import { showToast } from '../../state/ui';
import { useSelect } from '../../state/use';
import { tap } from '../../platform/haptics';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Notice } from '../../ui/Notice';
import { Sheet } from '../../ui/Sheet';
import { C, space, T } from '../../ui/tokens';
import { w } from '../../words';
import { ChoiceRow, ClearAfterWhatsApp, friendlyDay, listLink } from './PanelParts';
import { PanelLine } from './PanelLine';
import { usePanel } from './usePanel';

/** Your list and Order again: one panel. Reached from Order again, it shows only Place order. */
export function ListPanel({ repeat, onClosed }: { repeat?: string; onClosed: () => void }) {
  const panel = usePanel(repeat);
  const sample = useSelect(catalogStore, (state) => state.sampleRates);
  const whatsapp = useSelect(shopStore, (state) => state.whatsapp);
  const byId = useSelect(catalogStore, (state) => state.byId);
  const [placing, setPlacing] = useState(false);
  const [noteOpen, setNoteOpen] = useState(Boolean(panel.notes));
  const [noteDraft, setNoteDraft] = useState(panel.notes);
  const [sent, setSent] = useState(false);
  const [asking, setAsking] = useState(false);
  const submitting = useRef(false);
  const rateAsk = useRef({ key: makeKey(), lines: '' });
  useEffect(() => {
    void refreshShop();
    return () => {
      // A site chosen for this list becomes the usual one. A repeat never moves it.
      const { panelSite } = checkoutStore.get();
      if (panelSite && !repeat) updateDraft({ addressId: panelSite });
      checkoutStore.patch({ panelSite: null });
    };
  }, [repeat]);
  const { user, lines, site, review } = panel;
  const staff = user?.role === 'ADMIN';
  const changes = new Map(review?.changes.map((item) => [item.productId, item.oldPricePaise]));
  const total = review ? review.totalPaise : panel.subtotal + (panel.guestDelivery ?? 0);

  function chooseSite() {
    openSheet(
      panel.sites.length
        ? { sheet: 'sites-picker', purpose: 'panel' }
        : { sheet: 'site-form', purpose: 'panel' },
    );
  }
  function signInThenContinue() {
    requireSignIn(() => {
      void refreshSites()
        .then(() => {
          if (!sitesStore.get().items.length) openSheet({ sheet: 'site-form', purpose: 'panel' });
        })
        .catch(() => {});
    });
  }
  async function afterPlace(result: Awaited<ReturnType<typeof placeReviewed>>) {
    if (result.kind === 'placed') {
      tap();
      closeSheet('list');
      push({ screen: 'order', id: result.order.id });
      return;
    }
    if (result.kind === 'refused') {
      // The reason, a new total, and the button live again. Never places silently.
      panel.setProblem(say(result.error));
      panel.askAgain();
      return;
    }
    panel.setProblem(w('panel.notSure'));
  }
  async function place() {
    if (submitting.current || !review) return;
    // A tap with the keyboard up only finishes the typing, so the customer sees the new total first.
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
      return;
    }
    submitting.current = true;
    setPlacing(true);
    panel.setProblem('');
    try {
      const placedLines = repeat
        ? undefined
        : review.items.map(({ productId, quantity }) => ({ productId, quantity }));
      await afterPlace(await placeReviewed(review, makeKey(), placedLines));
    } finally {
      submitting.current = false;
      setPlacing(false);
    }
  }
  async function check() {
    if (submitting.current) return;
    submitting.current = true;
    setPlacing(true);
    panel.setProblem('');
    try {
      const result = await checkPending();
      if (result) await afterPlace(result);
      if (result?.kind === 'refused') panel.setProblem(w('panel.didNotReach'));
    } finally {
      submitting.current = false;
      setPlacing(false);
    }
  }
  function sendOnWhatsApp() {
    const link = listLink(
      whatsapp,
      lines,
      byId,
      site ? `${site.label} ${site.pincode}` : undefined,
    );
    if (!link) return;
    void Linking.openURL(link)
      .then(() => setSent(true))
      .catch(() => showToast(w('common.couldNotOpen')));
  }
  async function askForRate() {
    if (!user) return signInThenContinue();
    if (!panel.siteId) return chooseSite();
    setAsking(true);
    // The same list keeps its key, so a lost reply cannot send it twice; a changed list is a new one.
    const asked = linesKey(lines);
    if (rateAsk.current.lines !== asked) rateAsk.current = { key: makeKey(), lines: asked };
    try {
      await api('/quotes', 'POST', {
        idempotencyKey: rateAsk.current.key,
        items: lines.map(({ productId, quantity }) => ({ productId, quantity })),
        addressId: panel.siteId,
        deliveryDate: panel.date,
        company: '',
        gstin: '',
        notes: panel.notes,
      });
      void refreshReplies();
      showToast(w('panel.listSent'));
      closeSheet('list');
      goToTab('orders');
    } catch (error) {
      panel.setProblem(say(error));
    } finally {
      setAsking(false);
    }
  }

  const title = repeat ? w('orders.again') : w('list.title');
  let footer: React.ReactNode;
  if (panel.pending)
    footer = (
      <Button kind="lamp" loading={placing} onPress={() => void check()}>
        {w('panel.check')}
      </Button>
    );
  else if (!lines.length) footer = null;
  else if (!user)
    footer = (
      <Button kind="lamp" onPress={signInThenContinue}>
        {w('panel.signInToOrder')}
      </Button>
    );
  else if (staff) footer = null;
  else if (!panel.siteId)
    footer = (
      <Button kind="lamp" onPress={chooseSite} icon="location-outline">
        {panel.sites.length ? w('panel.chooseSite') : w('panel.addSite')}
      </Button>
    );
  else if (panel.problem && !review && !panel.checking)
    footer = (
      <Button onPress={panel.askAgain} disabled={!panel.online}>
        {w('panel.checkAgain')}
      </Button>
    );
  else
    footer = (
      <Button
        kind="lamp"
        loading={placing}
        disabled={!panel.canPlace}
        onPress={() => void place()}
        testID="place-order"
      >
        {panel.checking && !review
          ? w('panel.checkingRates')
          : panel.canPlace
            ? w('panel.place', { total: money(review!.totalPaise) })
            : !panel.online
              ? w('panel.needsInternetShort')
              : w('panel.checkingRates')}
      </Button>
    );

  return (
    <Sheet title={title} onClosed={onClosed} footer={footer}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        {panel.pending ? (
          <Notice tone="warn">
            {w('panel.pendingExplain', { total: money(panel.pending.totalPaise) })}
          </Notice>
        ) : null}
        {!panel.pending && !lines.length ? (
          <Text style={[T.body, styles.quiet]}>{w('list.empty')}</Text>
        ) : null}
        {lines.map((line) => (
          <PanelLine
            key={line.productId}
            productId={line.productId}
            name={panel.oldOrder?.items.find((item) => item.productId === line.productId)?.name}
            unit={panel.oldOrder?.items.find((item) => item.productId === line.productId)?.unit}
            quantity={line.quantity}
            rate={panel.rateOf(line.productId)}
            was={changes.get(line.productId)}
            leftOut={panel.missing.get(line.productId)}
            off={!user && panel.guestMissing(line.productId)}
            onChange={panel.changeLine}
          />
        ))}
        {lines.length && user ? (
          <View style={styles.choices}>
            <ChoiceRow
              label={w('panel.deliverTo')}
              value={
                site ? site.label : panel.sites.length ? w('panel.chooseSite') : w('panel.noSite')
              }
              onPress={chooseSite}
            />
            <ChoiceRow
              label={w('panel.day')}
              value={friendlyDay(panel.date)}
              onPress={() => openSheet({ sheet: 'day' })}
            />
            <ChoiceRow label={w('panel.pay')} value={w('panel.cod')} />
          </View>
        ) : null}
        {lines.length ? (
          <View style={styles.sums}>
            <View style={styles.sum}>
              <Text style={[T.body, styles.quiet]}>{w('panel.materials')}</Text>
              <Text style={T.rateSmall}>
                {money(review ? review.subtotalPaise : panel.subtotal)}
              </Text>
            </View>
            {review || panel.guestDelivery !== null ? (
              <View style={styles.sum}>
                <Text style={[T.body, styles.quiet]}>{w('panel.delivery')}</Text>
                <Text style={T.rateSmall}>
                  {money(review ? review.deliveryFeePaise : panel.guestDelivery!)}
                </Text>
              </View>
            ) : (
              <Text style={[T.small, styles.quiet]}>{w('panel.deliveryLater')}</Text>
            )}
            <View style={styles.sum}>
              <Text style={T.title}>{review ? w('panel.total') : w('panel.totalAbout')}</Text>
              <Text style={T.rateBig} maxFontSizeMultiplier={1.4}>
                {money(total)}
              </Text>
            </View>
          </View>
        ) : null}
        {lines.length && sample ? (
          <Text style={[T.small, styles.quiet]}>{w('panel.sampleRates')}</Text>
        ) : null}
        {panel.slow ? <Notice tone="warn">{w('panel.slow')}</Notice> : null}
        {panel.problem ? <Notice tone="error">{panel.problem}</Notice> : null}
        {!panel.online && lines.length ? (
          <Notice tone="warn">{whatsapp ? w('panel.offlineWhatsApp') : w('panel.offline')}</Notice>
        ) : null}
        {staff ? <Notice>{w('account.staff')}</Notice> : null}
        {panel.sameOrder ? (
          <Text style={[T.small, styles.warn]}>
            {w('panel.sameOrder', { time: timeLabel(panel.sameOrder.createdAt) })}
          </Text>
        ) : null}
        {lines.length && user && !noteOpen ? (
          <Button kind="link" onPress={() => setNoteOpen(true)}>
            {w('panel.addNote')}
          </Button>
        ) : null}
        {noteOpen ? (
          <Field
            label={w('panel.note')}
            value={noteDraft}
            onChangeText={setNoteDraft}
            onBlur={() => {
              panel.setNotes(noteDraft.trim());
              if (!repeat) updateDraft({ notes: noteDraft.trim() });
            }}
            multiline
            maxLength={500}
            autoFocus
          />
        ) : null}
        {lines.length ? (
          <Text style={[T.small, styles.quiet]}>{w('panel.shopConfirms')}</Text>
        ) : null}
        {lines.length && !repeat && !panel.pending ? (
          <View style={styles.exits}>
            <Button kind="line" loading={asking} onPress={() => void askForRate()}>
              {w('panel.askRate')}
            </Button>
            {whatsapp ? (
              <Button kind="quiet" icon="logo-whatsapp" onPress={sendOnWhatsApp}>
                {w('panel.sendWhatsApp')}
              </Button>
            ) : null}
            {sent ? (
              <View style={styles.sentRow}>
                <Text style={[T.small, styles.flex]}>{w('panel.sentQuestion')}</Text>
                <ClearAfterWhatsApp onDone={() => setSent(false)} />
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space[4], paddingBottom: space[4], gap: space[3] },
  quiet: { color: C.ink2 },
  warn: { color: C.warn },
  flex: { flex: 1, minWidth: 0 },
  choices: { gap: 2 },
  sums: { gap: space[1] },
  sum: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  exits: { gap: space[2], paddingTop: space[2] },
  sentRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
});
