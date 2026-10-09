'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { API_URL, productResponse, publicGet } from '../lib/api';
import { price } from '../lib/catalog';
import { useCommerce } from './commerce';
import { useLanguage } from './language';

const assistantProduct = z.object({
  id: z.string().max(100),
  name: z.string().max(120),
  brand: z.string().max(80),
  grade: z.string().max(40),
  unit: z.string().max(50),
  packSize: z.string().max(100),
  minQuantity: z.number().int().positive(),
  quantityStep: z.number().int().positive(),
  pricePaise: z.number().int().nonnegative(),
  priceVersion: z.number().int().positive(),
  stock: z.number().int().nonnegative(),
});
const answerSchema = z.object({
  mode: z.enum(['fallback', 'live', 'simulation']),
  text: z.string().max(6000),
  products: z.array(assistantProduct).max(6),
  sources: z
    .array(z.object({ title: z.string().max(100), href: z.enum(['/products', '/#delivery']) }))
    .max(4),
  reason: z.enum(['budget', 'timeout', 'unavailable']).optional(),
});
const turnsSchema = z
  .array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().max(6000),
      answer: answerSchema.optional(),
    }),
  )
  .max(8);
type Turn = z.infer<typeof turnsSchema>[number];
type Speech = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Speech;
  webkitSpeechRecognition?: new () => Speech;
};

export default function AssistantPanel({
  context,
  close,
}: {
  context: { id: string; name: string } | null;
  close: () => void;
}) {
  const c = useCommerce();
  const { t, language } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState('');
  const [retry, setRetry] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const request = useRef<AbortController | null>(null);
  const speech = useRef<Speech | null>(null);
  const beforeSpeech = useRef('');
  const epoch = useRef(0);
  const mounted = useRef(false);
  const storageKey = `shiv_assistant_${c.user?.id || 'guest'}`;
  function abortSpeech() {
    const recognition = speech.current;
    speech.current = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.abort();
    } catch {
      /* Some engines already ended the recognition. */
    }
  }
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = dialog.current;
    try {
      const saved = turnsSchema.safeParse(JSON.parse(sessionStorage.getItem(storageKey) || '[]'));
      if (saved.success) setTurns(saved.data);
    } catch {
      /* Conversation works without storage. */
    }
    modal?.showModal();
    input.current?.focus();
    return () => {
      mounted.current = false;
      epoch.current++;
      request.current?.abort();
      abortSpeech();
      modal?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [storageKey]);
  useEffect(() => {
    if (context) setText(t(`Tell me about ${context.name}`, `${context.name} के बारे में बताएँ`));
  }, [context, t]);
  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'auto' });
  }, [turns, busy]);
  function remember(next: Turn[]) {
    const bounded = next.slice(-8);
    setTurns(bounded);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(bounded));
    } catch {
      /* Session remains usable without persistence. */
    }
  }
  function cancel() {
    epoch.current++;
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setError(
      t(
        'Reply cancelled. Your question is ready to retry.',
        'जवाब रोक दिया। सवाल फिर भेज सकते हैं।',
      ),
    );
  }
  async function send(value = text) {
    const question = value.trim();
    if (
      !question ||
      question.length > 600 ||
      request.current ||
      speech.current ||
      busy ||
      recording
    )
      return;
    const current = ++epoch.current;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    setAnnouncement('');
    setRetry(question);
    setText('');
    const history = turns.at(-1)?.role === 'user' ? turns.slice(0, -1) : turns;
    const next: Turn[] = [...history, { role: 'user', content: question }];
    remember(next);
    try {
      const response = await fetch(`${API_URL}/assistant`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: question,
          language,
          ...(context ? { productId: context.id } : {}),
          history: history
            .slice(-6)
            .map((turn) => ({ role: turn.role, content: turn.content.slice(0, 1200) })),
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(18_000)]),
      });
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? t(
                'The assistant limit has been reached. Try later; materials and checkout remain available.',
                'सहायक की सीमा पूरी है। बाद में कोशिश करें; सामग्री और चेकआउट उपलब्ध हैं।',
              )
            : t(
                'The assistant is unavailable. Try again or browse the materials.',
                'सहायक उपलब्ध नहीं है। फिर कोशिश करें या सामग्री देखें।',
              ),
        );
      const answer = answerSchema.parse(await response.json());
      if (mounted.current && current === epoch.current) {
        remember([...next, { role: 'assistant', content: answer.text, answer }]);
        setRetry('');
        setAnnouncement(
          `${t('Shiv Assistant reply ready.', 'शिव सहायक का जवाब तैयार है।')} ${answer.text}`,
        );
      }
    } catch (e) {
      if (mounted.current && current === epoch.current)
        setError(
          controller.signal.aborted
            ? t('Reply cancelled.', 'जवाब रोक दिया।')
            : e instanceof Error && e.name === 'TimeoutError'
              ? t(
                  'The reply took too long. Retry your question.',
                  'जवाब में बहुत समय लगा। सवाल फिर भेजें।',
                )
              : e instanceof Error
                ? e.message
                : t('Could not connect.', 'संपर्क नहीं हो सका।'),
        );
    } finally {
      if (mounted.current && current === epoch.current) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  function stopVoice(discard = false) {
    if (discard) {
      abortSpeech();
      setText(beforeSpeech.current);
      setVoiceMessage(t('Recording cancelled.', 'रिकॉर्डिंग रद्द हुई।'));
      setRecording(false);
    } else {
      if (!speech.current) return;
      setVoiceMessage(
        t(
          'Finishing the transcript… You can review it before sending.',
          'सवाल लिखना पूरा हो रहा है… भेजने से पहले जाँच सकते हैं।',
        ),
      );
      try {
        speech.current.stop();
      } catch {
        abortSpeech();
        setRecording(false);
        setVoiceMessage(
          t(
            'Voice stopped. Review or edit your question before sending.',
            'आवाज़ रुक गई। भेजने से पहले सवाल जाँचें या बदलें।',
          ),
        );
      }
    }
  }
  function startVoice() {
    if (speech.current || request.current) return;
    const SpeechRecognition =
      (window as SpeechWindow).SpeechRecognition ||
      (window as SpeechWindow).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceMessage(
        t(
          'Voice is not supported in this browser. Type your question below.',
          'इस ब्राउज़र में आवाज़ उपलब्ध नहीं है। नीचे सवाल लिखें।',
        ),
      );
      return;
    }
    beforeSpeech.current = text;
    const prefix = text;
    const recognition = new SpeechRecognition();
    speech.current = recognition;
    recognition.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = true;
    const isCurrent = () => mounted.current && speech.current === recognition;
    recognition.onresult = (event) => {
      if (!isCurrent()) return;
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || '')
        .join(' ');
      setText(`${prefix} ${transcript}`.trim().slice(0, 600));
    };
    recognition.onerror = (event) => {
      if (!isCurrent()) return;
      abortSpeech();
      setRecording(false);
      setVoiceMessage(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? t(
              'Microphone permission was denied. Use text, or allow it in browser settings and try again.',
              'माइक्रोफ़ोन की अनुमति नहीं मिली। लिखें, या ब्राउज़र सेटिंग में अनुमति देकर फिर कोशिश करें।',
            )
          : t(
              'Voice input stopped. Check your microphone or type the question.',
              'आवाज़ से लिखना रुक गया। माइक्रोफ़ोन जाँचें या सवाल लिखें।',
            ),
      );
    };
    recognition.onend = () => {
      if (isCurrent()) {
        speech.current = null;
        setRecording(false);
        setVoiceMessage(
          t(
            'Review and edit the transcript, then choose Send.',
            'लिखा सवाल जाँचें और बदलें, फिर भेजें चुनें।',
          ),
        );
        input.current?.focus({ preventScroll: true });
      }
    };
    try {
      setRecording(true);
      setVoiceMessage(
        t(
          'Listening… Nothing is sent to Shiv Assistant until you choose Send. Your browser may process speech through its speech service.',
          'सुन रहे हैं… भेजें चुनने तक शिव सहायक को कुछ नहीं जाता। ब्राउज़र अपनी आवाज़ सेवा से पहचान कर सकता है।',
        ),
      );
      recognition.start();
    } catch {
      abortSpeech();
      setRecording(false);
      setVoiceMessage(
        t('Could not start voice. Type your question.', 'आवाज़ शुरू नहीं हुई। सवाल लिखें।'),
      );
    }
  }
  async function productAction(id: string, quote = false) {
    const current = epoch.current;
    try {
      const product = await publicGet(`/products/${encodeURIComponent(id)}`, productResponse);
      if (!mounted.current || current !== epoch.current) return;
      if (quote) c.quoteQuantity(product, product.minQuantity);
      else await c.quantity(product, product.minQuantity, true);
    } catch (e) {
      if (mounted.current && current === epoch.current) c.showError(e);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="assistant-dialog"
      aria-labelledby="assistant-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) {
          const box = dialog.current.getBoundingClientRect();
          if (
            e.clientX < box.left ||
            e.clientX > box.right ||
            e.clientY < box.top ||
            e.clientY > box.bottom
          )
            close();
        }
      }}
    >
      <header>
        <div>
          <p className="eyebrow">{t('AT YOUR MATERIALS COUNTER', 'आपकी सामग्री की दुकान पर')}</p>
          <h2 id="assistant-title">{t('Shiv Assistant', 'शिव सहायक')}</h2>
        </div>
        <button aria-label={t('Close assistant', 'सहायक बंद करें')} onClick={close}>
          ×
        </button>
      </header>
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clipPath: 'inset(50%)',
          whiteSpace: 'nowrap',
        }}
      >
        {announcement}
      </span>
      <div className="assistant-scroll" ref={scroll}>
        <p className="assistant-intro">
          {t(
            'Ask about materials, selling units or delivery in English, Hindi or Hinglish. An engineer should advise on structural work.',
            'सामग्री, बिक्री इकाई या डिलीवरी के बारे में हिंदी, अंग्रेज़ी या हिंग्लिश में पूछें। ढाँचे के काम पर इंजीनियर से सलाह लें।',
          )}
        </p>
        {context && <p className="context-chip">{context.name}</p>}
        {turns.length === 0 && (
          <div className="assistant-prompts">
            {(
              [
                [
                  context
                    ? `What is the selling unit for ${context.name}?`
                    : 'How do I compare cement packs?',
                  context
                    ? `${context.name} की बिक्री इकाई क्या है?`
                    : 'सीमेंट के पैक की तुलना कैसे करूँ?',
                ],
                ['How do bulk quotations work?', 'थोक भाव कैसे माँगें?'],
                ['How do I check delivery?', 'डिलीवरी कैसे जाँचें?'],
              ] as const
            ).map(([en, hi]) => (
              <button key={en} onClick={() => void send(t(en, hi))}>
                {t(en, hi)} ↗
              </button>
            ))}
          </div>
        )}
        {turns.map((turn, index) => (
          <article className={`chat-turn chat-${turn.role}`} key={index}>
            <strong>
              {turn.role === 'user' ? t('You', 'आप') : t('Shiv Assistant', 'शिव सहायक')}
            </strong>
            {turn.answer && (
              <span className="answer-mode">
                {turn.answer.mode === 'live'
                  ? t('AI reply · check current product terms', 'AI जवाब · मौजूदा शर्तें जाँचें')
                  : turn.answer.mode === 'simulation'
                    ? t('Labelled test simulation', 'चिह्नित परीक्षण सिमुलेशन')
                    : t('Catalogue & approved FAQ help', 'सामग्री सूची और मंज़ूर जानकारी')}
              </span>
            )}
            {turn.answer?.reason && (
              <p className="assistant-reason">
                {turn.answer.reason === 'budget'
                  ? t(
                      'AI budget reached; showing shop information.',
                      'AI बजट पूरा; दुकान की जानकारी दिखाई जा रही है।',
                    )
                  : turn.answer.reason === 'timeout'
                    ? t(
                        'AI timed out; showing shop information.',
                        'AI में देरी हुई; दुकान की जानकारी दिखाई जा रही है।',
                      )
                    : t(
                        'AI is unavailable; showing shop information.',
                        'AI उपलब्ध नहीं; दुकान की जानकारी दिखाई जा रही है।',
                      )}
              </p>
            )}
            <p>{turn.content}</p>
            {turn.answer?.products.map((p) => (
              <div className="assistant-product" key={p.id}>
                <Link href={`/products/${encodeURIComponent(p.id)}`} onClick={close}>
                  <strong>{p.name} ↗</strong>
                  <span>
                    {price(p.pricePaise)} / {p.unit} ·{' '}
                    {p.packSize || t('Pack not specified', 'पैक दर्ज नहीं')}
                  </span>
                </Link>
                <div>
                  <button
                    onClick={() => void productAction(p.id)}
                    disabled={c.busy || p.stock < p.minQuantity}
                  >
                    {t('Add minimum to basket', 'न्यूनतम मात्रा जोड़ें')}
                  </button>
                  <button onClick={() => void productAction(p.id, true)}>
                    {t('Build quote', 'भाव बनाएँ')}
                  </button>
                </div>
              </div>
            ))}
            {turn.answer?.sources.map((source) => (
              <Link className="text-link" key={source.href} href={source.href} onClick={close}>
                {source.title} ↗
              </Link>
            ))}
          </article>
        ))}
        {busy && (
          <p role="status">{t('Checking shop information…', 'दुकान की जानकारी जाँच रहे हैं…')}</p>
        )}
        {error && <p role="alert">{error}</p>}
        {retry && !busy && (
          <button className="text-link" onClick={() => void send(retry)}>
            {t('Retry question', 'सवाल फिर भेजें')}
          </button>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="assistant-question">
          {t('Your question / editable voice transcript', 'आपका सवाल / आवाज़ से लिखा सवाल')}
        </label>
        <textarea
          ref={input}
          id="assistant-question"
          maxLength={600}
          readOnly={recording}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('Ask about your material…', 'अपनी सामग्री के बारे में पूछें…')}
        />
        <div className="assistant-controls">
          {recording ? (
            <>
              <button type="button" onClick={() => stopVoice()}>
                {t('Stop recording', 'रिकॉर्डिंग रोकें')}
              </button>
              <button type="button" onClick={() => stopVoice(true)}>
                {t('Cancel recording', 'रिकॉर्डिंग रद्द करें')}
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={startVoice}>
              {t('Use voice', 'आवाज़ से लिखें')}
            </button>
          )}
          {busy ? (
            <button type="button" onClick={cancel}>
              {t('Cancel reply', 'जवाब रोकें')}
            </button>
          ) : (
            <button className="button" disabled={!text.trim() || recording}>
              {t('Send', 'भेजें')} ↑
            </button>
          )}
        </div>
        {voiceMessage && (
          <p className="voice-status" role="status">
            {voiceMessage}
          </p>
        )}
        <button
          type="button"
          className="text-link"
          onClick={() => {
            cancel();
            stopVoice(true);
            remember([]);
            setText('');
            setError('');
            setRetry('');
            setAnnouncement('');
          }}
        >
          {t('Clear conversation', 'बातचीत साफ करें')}
        </button>
      </form>
    </dialog>
  );
}
