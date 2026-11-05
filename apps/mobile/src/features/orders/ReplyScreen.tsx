import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { dayLabel, momentLabel, quoteStatusText, type Quote } from '@shiv/shared';
import { money } from '../../logic/money';
import { api } from '../../state/api';
import { say } from '../../state/net';
import { refreshReplies } from '../../state/orders';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';
import { Screen, TopBar } from '../../ui/Screen';
import { C, space, T } from '../../ui/tokens';
import { w } from '../../words';
import { sure } from './OrderScreen';

/** The shop's reply to a list: its rates, delivery and until when they hold. */
export function ReplyScreen({ id }: { id: string }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setQuote(await api<Quote>(`/quotes/${encodeURIComponent(id)}`));
      setError('');
    } catch (e) {
      setError(say(e));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  async function respond(status: 'ACCEPTED' | 'REJECTED') {
    if (!quote) return;
    const asked = status === 'ACCEPTED' ? w('reply.acceptSure') : w('reply.rejectSure');
    const yes = status === 'ACCEPTED' ? w('reply.accept') : w('reply.reject');
    if (!(await sure(asked, yes, w('reply.notNow')))) return;
    setBusy(true);
    try {
      // The revision is the one on screen, so a newer offer from the shop is never accepted unseen.
      await api(`/quotes/${quote.id}/respond`, 'POST', { revision: quote.revision, status });
      void refreshReplies();
      await load();
    } catch (e) {
      setError(say(e));
      await load();
    } finally {
      setBusy(false);
    }
  }
  const expired =
    quote?.status === 'SENT' && quote.validUntil && Date.parse(quote.validUntil) <= Date.now();
  return (
    <Screen topBar={<TopBar title={quote?.number ?? w('reply.title')} />}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!quote ? (
        error ? (
          <Button onPress={() => void load()}>{w('common.retry')}</Button>
        ) : (
          <Text style={[T.body, styles.quiet]}>{w('common.loading')}</Text>
        )
      ) : (
        <>
          <Text style={T.head} accessibilityRole="header">
            {expired
              ? w('reply.expired')
              : quote.status === 'ACCEPTED'
                ? w('reply.accepted')
                : quoteStatusText(quote.status, 'en')}
          </Text>
          <View style={styles.bill}>
            {quote.items.map((item) => (
              <View key={item.productId} style={styles.line}>
                <Text style={[T.body, styles.flex]}>
                  {item.quantity} × {item.name}
                </Text>
                {item.unitPricePaise !== null ? (
                  <Text style={T.rateSmall}>{`${money(item.unitPricePaise)} / ${item.unit}`}</Text>
                ) : null}
              </View>
            ))}
            {quote.totalPaise !== null ? (
              <>
                <View style={styles.line}>
                  <Text style={[T.body, styles.flex]}>{w('panel.delivery')}</Text>
                  <Text style={T.rateSmall}>{money(quote.deliveryFeePaise)}</Text>
                </View>
                <View style={[styles.line, styles.totalLine]}>
                  <Text style={[T.bodyStrong, styles.flex]}>{w('panel.total')}</Text>
                  <Text style={T.rate}>{money(quote.totalPaise)}</Text>
                </View>
              </>
            ) : (
              <Text style={[T.small, styles.quiet]}>{w('orders.gotList')}</Text>
            )}
          </View>
          <Text style={[T.small, styles.quiet]}>
            {[quote.address.line1, quote.address.area, quote.address.pincode]
              .filter(Boolean)
              .join(', ')}
            {'\n'}
            {w('reply.dayAsked', { day: dayLabel(quote.deliveryDate, 'en') })}
          </Text>
          {quote.validUntil ? (
            <Text style={[T.small, styles.quiet]}>
              {w('reply.holds', { until: momentLabel(quote.validUntil, 'en') })}
            </Text>
          ) : null}
          {quote.deliveryTerms ? <Text style={T.small}>{quote.deliveryTerms}</Text> : null}
          {quote.adminNote ? <Notice>{quote.adminNote}</Notice> : null}
          {quote.status === 'SENT' && !expired ? (
            <View style={styles.actions}>
              <Button kind="lamp" loading={busy} onPress={() => void respond('ACCEPTED')}>
                {w('reply.accept')}
              </Button>
              <Button kind="quiet" disabled={busy} onPress={() => void respond('REJECTED')}>
                {w('reply.reject')}
              </Button>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  quiet: { color: C.ink2 },
  bill: { backgroundColor: C.up, padding: space[3], gap: space[2] },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  totalLine: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.rule,
    paddingTop: space[2],
  },
  actions: { gap: space[2] },
});
