import { memo, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  advisorChrome,
  advisorLabelText,
  advisorSpeaker,
  advisorStarters,
  checkedMonth,
  type AdvisorProduct,
} from '@shiv/shared';
import { money } from '../../logic/money';
import { askWhatsApp, reachedLimit, type AskTurn } from '../../logic/ask-core';
import { ask, askStore, cancelAsk, sendFeedback, setAskDraft } from '../../state/ask';
import { catalogStore } from '../../state/catalog';
import { addToList, listStore } from '../../state/list';
import { push } from '../../state/nav';
import { netStore } from '../../state/net';
import { showToast } from '../../state/ui';
import { useSelect } from '../../state/use';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Notice } from '../../ui/Notice';
import { Press } from '../../ui/Press';
import { C, headingScale, radius, space, T, touch } from '../../ui/tokens';
import { w } from '../../words';

const reasons = [
  ['WRONG', 'ask.reasonWrong'],
  ['DID_NOT_ANSWER', 'ask.reasonDidNot'],
  ['HARD_TO_UNDERSTAND', 'ask.reasonHard'],
  ['OFFENSIVE', 'ask.reasonOffensive'],
] as const;

function ProductCard({ product }: { product: AdvisorProduct }) {
  const known = useSelect(catalogStore, (state) => state.byId[product.id]);
  const inList = useSelect(listStore, (state) => (state.quantity[product.id] ?? 0) > 0);
  return (
    <View style={styles.product}>
      <View style={styles.flex}>
        <Text style={T.body} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={[T.small, styles.quiet]}>
          {product.pricePaise === null ? w('rates.askRate') : money(product.pricePaise)} /{' '}
          {product.unit}
          {product.isSample ? ` · ${w('ask.sample')}` : ''}
        </Text>
      </View>
      {inList ? (
        <View style={[styles.add, styles.added]}>
          <Text style={[T.smallStrong, { color: C.onDiya }]}>{w('rates.added')}</Text>
        </View>
      ) : (
        <Press
          accessibilityRole="button"
          accessibilityLabel={w('rates.addLabel', { name: product.name })}
          onPress={() => {
            if (known) addToList(known);
            else showToast(w('ask.cannotAdd'));
          }}
          style={styles.add}
        >
          <Text style={T.bodyStrong}>{w('rates.add')}</Text>
        </Press>
      )}
    </View>
  );
}

const Answer = memo(function Answer({ turn }: { turn: AskTurn }) {
  const [reporting, setReporting] = useState(false);
  const view = turn.view;
  const label = view?.label ? advisorLabelText[view.label].en : '';
  const whatsapp = askWhatsApp(turn);
  return (
    <View style={styles.answer} accessibilityLiveRegion={view ? 'polite' : 'none'}>
      <View style={styles.speakerRow}>
        <Text style={[T.smallStrong, styles.quiet]}>{advisorSpeaker}</Text>
        {label ? (
          <Text style={[T.small, view?.label === 'CHECKED' ? styles.ok : styles.warn]}>
            {label}
          </Text>
        ) : null}
      </View>
      {turn.status === 'asking' && !turn.sentences.length ? (
        <Text style={[T.body, styles.quiet]}>{advisorChrome.statusChecking.en}</Text>
      ) : null}
      {turn.status === 'lost' ? <Text style={[T.small, styles.quiet]}>{w('ask.lost')}</Text> : null}
      {turn.sentences.map((sentence, index) => (
        <Text key={index} selectable style={T.body}>
          {sentence}
        </Text>
      ))}
      {turn.status === 'failed' ? <Notice tone="warn">{w('ask.failed')}</Notice> : null}
      {turn.products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
      {view?.nudge ? <Text style={[T.small, styles.quiet]}>{view.nudge}</Text> : null}
      {view?.citations.map((citation) => (
        <Pressable
          key={citation.slug}
          accessibilityRole="link"
          onPress={() => push({ screen: 'article', slug: citation.slug })}
        >
          <Text style={[T.small, styles.quiet]}>
            {citation.checkedOn
              ? advisorChrome.sourceLine.en
                  .replace('{title}', citation.title)
                  .replace('{month}', checkedMonth(citation.checkedOn))
              : w('ask.fromShop', { title: citation.title })}
          </Text>
        </Pressable>
      ))}
      {reachedLimit(turn) || view?.articles.length ? (
        <View style={styles.links}>
          {view?.articles.map((article) => (
            <Button
              key={article.slug}
              kind="quiet"
              onPress={() => push({ screen: 'article', slug: article.slug })}
            >
              {article.title}
            </Button>
          ))}
        </View>
      ) : null}
      {whatsapp ? (
        <Button
          kind="line"
          icon="logo-whatsapp"
          onPress={() =>
            void Linking.openURL(whatsapp).catch(() => showToast(w('common.couldNotOpen')))
          }
        >
          {advisorChrome.askShopWhatsApp.en}
        </Button>
      ) : null}
      {view?.followups.map((question) => (
        <Button key={question} kind="link" onPress={() => void ask(question)}>
          {question}
        </Button>
      ))}
      {turn.status === 'done' && turn.turnId && !turn.feedback ? (
        <View style={styles.feedback}>
          <Button kind="link" onPress={() => void sendFeedback(turn, 'HELPED')}>
            {w('ask.helped')}
          </Button>
          <Button kind="link" onPress={() => setReporting(true)}>
            {w('ask.notRight')}
          </Button>
        </View>
      ) : null}
      {reporting && !turn.feedback ? (
        <View style={styles.report}>
          <Text style={T.bodyStrong}>{w('ask.report')}</Text>
          {reasons.map(([reason, word]) => (
            <Button
              key={reason}
              kind="quiet"
              onPress={() => {
                setReporting(false);
                void sendFeedback(turn, 'NOT_RIGHT', reason);
                showToast(w('ask.thanks'));
              }}
            >
              {w(word)}
            </Button>
          ))}
        </View>
      ) : null}
    </View>
  );
});

/** A tab, kept mounted, so the conversation and the box survive every other tab. */
export function AskScreen() {
  const turns = useSelect(askStore, (state) => state.turns);
  const draft = useSelect(askStore, (state) => state.draft);
  const busy = useSelect(askStore, (state) => state.busy);
  const online = useSelect(netStore, (state) => state.online);
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {
    if (turns.length) scroll.current?.scrollToEnd({ animated: false });
  }, [turns]);
  const send = () => {
    if (online && draft.trim() && !busy) void ask(draft);
  };
  return (
    <View style={styles.fill}>
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.body}
      >
        <Text style={T.display} accessibilityRole="header" maxFontSizeMultiplier={headingScale}>
          {w('tabs.ask')}
        </Text>
        {!turns.length ? (
          <>
            <Text style={T.head}>{advisorChrome.firstOpenTitle.en}</Text>
            <Text style={[T.body, styles.quiet]}>{advisorChrome.firstOpen.en}</Text>
            {advisorStarters.home.map((starter) => (
              <Press
                key={starter.en}
                accessibilityRole="button"
                disabled={!online}
                onPress={() => void ask(starter.en)}
                style={styles.starter}
              >
                <Text style={T.body}>{starter.en}</Text>
              </Press>
            ))}
          </>
        ) : null}
        {turns.map((turn) => (
          <View key={turn.clientTurnId} style={styles.turn}>
            <View style={styles.question}>
              <Text selectable style={T.body}>
                {turn.question}
              </Text>
            </View>
            <Answer turn={turn} />
          </View>
        ))}
        {busy ? (
          <Button kind="link" onPress={cancelAsk}>
            {w('ask.cancel')}
          </Button>
        ) : null}
      </ScrollView>
      <View style={styles.foot}>
        {!online ? <Text style={[T.small, styles.quiet]}>{w('ask.offline')}</Text> : null}
        <View style={styles.boxRow}>
          <TextInput
            accessibilityLabel={w('ask.boxLabel')}
            placeholder={w('ask.placeholder')}
            placeholderTextColor={C.ink2}
            value={draft}
            maxLength={600}
            multiline
            onChangeText={setAskDraft}
            style={[T.body, styles.input]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={w('ask.send')}
            accessibilityState={{ disabled: !online || !draft.trim() || busy }}
            disabled={!online || !draft.trim() || busy}
            onPress={send}
            style={[styles.send, (!online || !draft.trim() || busy) && styles.sendOff]}
          >
            <Icon
              name="paper-plane-outline"
              color={!online || !draft.trim() || busy ? C.ink2 : C.onNight}
            />
          </Pressable>
        </View>
        <Text style={[T.small, styles.quiet]}>{advisorChrome.underBox.en}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.ground },
  body: { padding: space[4], gap: space[3], paddingBottom: space[5] },
  flex: { flex: 1, minWidth: 0 },
  quiet: { color: C.ink2 },
  ok: { color: C.ok },
  warn: { color: C.warn },
  starter: { backgroundColor: C.up, padding: space[3], minHeight: touch, justifyContent: 'center' },
  turn: { gap: space[3] },
  question: {
    alignSelf: 'flex-end',
    maxWidth: '86%',
    backgroundColor: C.down,
    padding: space[3],
    borderRadius: radius.control,
  },
  answer: { gap: space[2] },
  speakerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'center' },
  product: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: C.up,
    padding: space[2],
    paddingLeft: space[3],
  },
  add: {
    width: 72,
    minHeight: touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    backgroundColor: C.down,
  },
  added: { backgroundColor: C.diya },
  links: { gap: space[2] },
  feedback: { flexDirection: 'row', gap: space[4] },
  report: { gap: space[2], backgroundColor: C.up, padding: space[3] },
  foot: { backgroundColor: C.up, padding: space[2], paddingHorizontal: space[3], gap: space[1] },
  boxRow: { flexDirection: 'row', gap: space[2], alignItems: 'flex-end' },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderWidth: 1.5,
    borderColor: C.ink,
    borderRadius: radius.control,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    color: C.ink,
    backgroundColor: C.up,
  },
  send: {
    width: touch,
    height: touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    backgroundColor: C.ink,
  },
  sendOff: { backgroundColor: C.down },
});
