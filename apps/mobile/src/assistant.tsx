import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { money, radius, space, textSize } from '@shiv/shared';
import { api } from './api';
import { useStore } from './store';
import { Button, C, Icon, IconButton, Notice, s } from './ui';

type AssistantProduct = {
  id: string;
  name: string;
  brand: string;
  unit: string;
  pricePaise: number;
  stock: number;
  minQuantity: number;
};
type Answer = {
  mode: 'fallback' | 'live' | 'simulation';
  text: string;
  products: AssistantProduct[];
  sources: { title: string; href: string }[];
};
type Turn = { role: 'user' | 'assistant'; content: string; answer?: Answer };

function speechAvailable() {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

/**
 * Shiv Sahayak: answers questions about materials, units, delivery and quotes from the shop's
 * own catalogue. Advice never replaces an engineer, and the reply says so when it matters.
 */
export function Assistant() {
  const { t, language, navigate, say } = useStore();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState('');
  const [canSpeak] = useState(speechAvailable);
  const scroll = useRef<ScrollView>(null);
  const beforeSpeech = useRef('');
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      if (canSpeak) ExpoSpeechRecognitionModule.abort();
    },
    [canSpeak],
  );
  useSpeechRecognitionEvent('result', (event) => {
    const heard = event.results[0]?.transcript || '';
    setText(
      `${beforeSpeech.current}${beforeSpeech.current && heard ? ' ' : ''}${heard}`.slice(0, 600),
    );
  });
  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    setVoiceNote(t('Check the words, then send.', 'शब्द जाँचें, फिर भेजें।'));
  });
  useSpeechRecognitionEvent('error', (event) => {
    setListening(false);
    setVoiceNote(
      event.error === 'not-allowed'
        ? t(
            'Microphone permission is off. You can type your question instead.',
            'माइक की अनुमति बंद है। सवाल लिखकर भी पूछ सकते हैं।',
          )
        : event.error === 'no-speech' || event.error === 'speech-timeout'
          ? t(
              'Nothing was heard. Tap the mic and speak again.',
              'कुछ सुनाई नहीं दिया। माइक दबाकर फिर बोलें।',
            )
          : t(
              'Voice input stopped. You can type instead.',
              'आवाज़ से लिखना रुक गया। आप लिख सकते हैं।',
            ),
    );
  });
  async function listen() {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    setVoiceNote('');
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setVoiceNote(
        t(
          'Microphone permission is off. You can type your question instead.',
          'माइक की अनुमति बंद है। सवाल लिखकर भी पूछ सकते हैं।',
        ),
      );
      return;
    }
    beforeSpeech.current = text.trim();
    setListening(true);
    ExpoSpeechRecognitionModule.start({
      lang: language === 'hi' ? 'hi-IN' : 'en-IN',
      interimResults: true,
      continuous: false,
      addsPunctuation: true,
    });
  }
  async function ask(question = text.trim()) {
    if (!question || busy) return;
    if (listening) ExpoSpeechRecognitionModule.stop();
    setBusy(true);
    setError('');
    setText('');
    setVoiceNote('');
    const history = turns
      .slice(-6)
      .map((turn) => ({ role: turn.role, content: turn.content.slice(0, 1200) }));
    setTurns((old) => [...old, { role: 'user', content: question }]);
    try {
      const answer = await api<Answer>('/assistant', 'POST', {
        message: question,
        language,
        history,
      });
      if (!mounted.current) return;
      setTurns((old) =>
        [...old, { role: 'assistant' as const, content: answer.text, answer }].slice(-8),
      );
    } catch (e) {
      if (!mounted.current) return;
      setError(say(e));
      setText(question);
      setTurns((old) => old.slice(0, -1));
    } finally {
      if (mounted.current) setBusy(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    }
  }
  const starters = [
    t(
      'How many bags of cement for a 10×10 ft slab?',
      '10×10 फ़ुट की छत में कितनी बोरी सीमेंट लगेगी?',
    ),
    t('Which cement is best for plaster?', 'प्लास्टर के लिए कौन सा सीमेंट अच्छा है?'),
    t('Do you deliver to my pincode?', 'क्या मेरे पिनकोड पर डिलीवरी है?'),
  ];
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[s.screen, { maxWidth: 720 }]}
      >
        <View style={s.row}>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: radius.control,
              backgroundColor: C.ink,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="chatbubbles" color={C.onInkMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.h2} accessibilityRole="header">
              {t('Shiv Sahayak', 'शिव सहायक')}
            </Text>
            <Text style={s.small}>
              {t(
                'Answers from our catalogue. For structural design, ask your engineer.',
                'हमारी सूची से जवाब। ढाँचे के डिज़ाइन के लिए अपने इंजीनियर से पूछें।',
              )}
            </Text>
          </View>
        </View>
        {!turns.length && (
          <View style={{ gap: space.sm }}>
            {starters.map((starter) => (
              <Pressable
                key={starter}
                accessibilityRole="button"
                onPress={() => void ask(starter)}
                style={({ pressed }) => [
                  s.card,
                  { padding: space.md },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[s.body, { color: C.ink }]}>{starter}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {turns.map((turn, index) => (
          <View
            key={index}
            style={{
              alignSelf: turn.role === 'user' ? 'flex-end' : 'stretch',
              maxWidth: turn.role === 'user' ? '86%' : '100%',
              backgroundColor: turn.role === 'user' ? C.ink : C.surface,
              borderRadius: radius.control,
              padding: space.md,
              gap: space.sm,
            }}
          >
            <Text
              selectable
              style={{
                color: turn.role === 'user' ? C.onInk : C.ink,
                fontSize: textSize.body,
                lineHeight: 24,
              }}
            >
              {turn.content}
            </Text>
            {turn.answer?.products.map((product) => (
              <Pressable
                key={product.id}
                accessibilityRole="button"
                onPress={() => navigate({ screen: 'Product', id: product.id })}
                style={[
                  s.between,
                  { backgroundColor: C.paper, borderRadius: radius.control, padding: space.md },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.body, { color: C.ink, fontWeight: '700' }]}>{product.name}</Text>
                  <Text style={s.small}>
                    {money(product.pricePaise)} / {product.unit}
                  </Text>
                </View>
                <Icon name="chevron-forward" color={C.ink} />
              </Pressable>
            ))}
          </View>
        ))}
        {busy && (
          <View style={[s.row, { padding: space.md }]}>
            <ActivityIndicator color={C.ink} />
            <Text style={s.body}>{t('Thinking…', 'सोच रहा है…')}</Text>
          </View>
        )}
        {error ? (
          <View style={{ gap: space.sm }}>
            <Notice error>{error}</Notice>
            <Button secondary onPress={() => void ask()}>
              {t('Ask again', 'फिर पूछें')}
            </Button>
          </View>
        ) : null}
      </ScrollView>
      <View style={[s.footer, { gap: space.xs }]}>
        {voiceNote ? <Text style={s.small}>{voiceNote}</Text> : null}
        {listening && (
          <Text
            accessibilityLiveRegion="polite"
            style={[s.small, { color: C.ink, fontWeight: '700', textDecorationLine: 'underline' }]}
          >
            {t('Listening… tap the mic to stop', 'सुन रहा है… रोकने के लिए माइक दबाएँ')}
          </Text>
        )}
        <View style={[s.row, { gap: space.xs }]}>
          <TextInput
            accessibilityLabel={t('Your question', 'आपका सवाल')}
            placeholder={t(
              'Ask about cement, steel, delivery…',
              'सीमेंट, सरिया, डिलीवरी के बारे में पूछें…',
            )}
            placeholderTextColor={C.muted}
            value={text}
            maxLength={600}
            multiline
            onChangeText={setText}
            style={[s.input, { flex: 1, maxHeight: 120 }]}
          />
          {canSpeak && (
            <IconButton
              icon={listening ? 'stop-circle' : 'mic'}
              label={
                listening
                  ? t('Stop voice input', 'आवाज़ रोकें')
                  : t('Speak your question', 'सवाल बोलें')
              }
              color={listening ? C.onAccent : C.ink}
              background={listening ? C.accent : C.surface}
              onPress={() => void listen()}
            />
          )}
          <IconButton
            icon="send"
            label={t('Send question', 'सवाल भेजें')}
            color={C.onAccent}
            background={C.accent}
            disabled={!text.trim() || busy}
            onPress={() => void ask()}
          />
        </View>
      </View>
    </View>
  );
}
