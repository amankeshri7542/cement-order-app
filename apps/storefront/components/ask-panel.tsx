'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { API_URL } from '../lib/api';
import { ASK_DEVICE_KEY, askWords, checkedMonth, parseEvents } from '../lib/ask-words';
import { rupees } from '../lib/format';
import { list, validInput, type ListInput } from '../lib/list-store';
import { unitWords } from '../lib/units';
import s from './ask.module.css';

type Product = {
  id: string;
  name: string;
  brand: string;
  grade: string;
  unit: string;
  minQuantity: number;
  quantityStep: number;
  pricePaise: number | null;
  isSample: boolean;
  availability: string;
};
type Citation = { slug: string; title: string; href: string; checkedOn: string | null };
type Article = { slug: string; title: string; summary: string; href: string };
type Turn = {
  id: string;
  status: string;
  level: string;
  label: keyof typeof askWords.labels | null;
  text: string;
  products: Product[];
  nudge: string | null;
  delivery: { pincode: string; serviceable: boolean; deliveryFeePaise: number | null } | null;
  estimate: {
    status: string;
    note?: string;
    problem?: string;
    result?: { bricks?: number; bricksWithWaste?: number; kgPerMetre?: number; totalKg?: number };
  } | null;
  citations: Citation[];
  articles: Article[];
  followups: string[];
  limit: string | null;
  whatsappUrl: string | null;
  feedback: string | null;
};
type Shown = {
  key: string;
  question: string;
  sentences: string[];
  turn: Turn | null;
  turnId: string;
  failed: boolean;
};
type Status = 'idle' | 'waiting' | 'slow' | 'very-slow';

/** At a limit nothing breaks: the guide is still there, and the shop. */
const limited = (old: Shown): Shown => ({
  ...old,
  sentences: ['You have asked a lot today. The guide is still here, or ask the shop.'],
  turn: {
    id: '',
    status: 'CANCELLED',
    level: 'FIXED',
    label: null,
    text: '',
    products: [],
    nudge: null,
    delivery: null,
    estimate: null,
    citations: [],
    articles: [{ slug: 'guide', title: 'Open the guide', summary: '', href: '/guide' }],
    followups: [],
    limit: 'DEVICE',
    whatsappUrl: null,
    feedback: null,
  },
});

const DEVICE_KEY = ASK_DEVICE_KEY;
const safeHref = (href: string) =>
  /^\/guide(\/[a-z0-9-]+)?(#[\w-]+)?$/.test(href) ? href : '/guide';
const safeWhatsApp = (url: string | null) =>
  url && /^https:\/\/wa\.me\/\d*(\?|$)/.test(url) ? url : null;
const random = () => crypto.randomUUID().replace(/-/g, '');

async function deviceToken(fresh = false) {
  try {
    const saved = fresh ? null : localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
  } catch {
    /* Storage blocked: one token for this visit. */
  }
  const response = await fetch(`${API_URL}/advisor/device`, {
    method: 'POST',
    credentials: 'omit',
  });
  if (!response.ok) throw new Error(String(response.status));
  const { deviceToken: token } = (await response.json()) as { deviceToken: string };
  try {
    localStorage.setItem(DEVICE_KEY, token);
  } catch {
    /* As above. */
  }
  return token;
}
const headers = (token: string) => ({
  'Content-Type': 'application/json',
  [askWords.deviceHeader]: token,
});

/** Voice gives a draft the customer can read and change. It never sends anything by itself. */
type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult: (event: { results: { 0: { transcript: string } }[] }) => void;
  onerror: () => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};
const speech = () => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

function ProductRow({ product }: { product: Product }) {
  const input: ListInput | null = validInput({
    i: product.id,
    n: product.name,
    u: unitWords(product.unit).long,
    m: product.minQuantity,
    s: product.quantityStep,
    r: product.pricePaise,
    h: `/products/${product.id}`,
  });
  const [on, setOn] = useState(false);
  useEffect(() => setOn(list.quantityOf(product.id) > 0), [product.id]);
  return (
    <li className={s.product}>
      <span>
        {product.name}
        <small>
          {[product.grade, unitWords(product.unit).short].filter(Boolean).join(', ')}
          {product.isSample && product.pricePaise !== null ? ', sample rate' : ''}
        </small>
      </span>
      <b className="num">
        {product.pricePaise === null ? 'Ask for the rate' : rupees(product.pricePaise)}
      </b>
      {input && product.availability === 'IN_STOCK' ? (
        <button
          type="button"
          className="add"
          aria-pressed={on}
          onClick={() => {
            list.toggle(input);
            setOn(list.quantityOf(product.id) > 0);
          }}
        >
          {on ? 'Added' : 'Add to list'}
        </button>
      ) : null}
    </li>
  );
}

function Answer({
  shown,
  feedback,
  ask,
}: {
  shown: Shown;
  feedback: (shown: Shown, value: string, reason?: string) => void;
  ask: (question: string) => void;
}) {
  const [notRight, setNotRight] = useState(false);
  const { turn } = shown;
  const label = turn?.label ? askWords.labels[turn.label] : null;
  const whatsapp = safeWhatsApp(turn?.whatsappUrl ?? null);
  return (
    <article className={s.answer}>
      <p className={s.question}>{shown.question}</p>
      <p className={s.speaker}>
        {askWords.speaker}
        {label ? (
          <span className={s.tag} data-level={turn?.label}>
            {label}
          </span>
        ) : null}
      </p>
      {/* Sentences appear whole; a screen reader gets the whole answer once, when it is done. */}
      {turn?.text ? (
        <p className="sr" role="status">
          {turn.text}
        </p>
      ) : null}
      {shown.sentences.length ? (
        <div className={s.words} aria-hidden={Boolean(turn?.text)}>
          {shown.sentences.map((sentence, index) => (
            <p key={index}>{sentence}</p>
          ))}
        </div>
      ) : null}
      {shown.failed ? (
        <p role="alert">
          The connection was lost and the answer could not be fetched.{' '}
          <button type="button" className="link" onClick={() => ask(shown.question)}>
            Try again
          </button>
        </p>
      ) : null}
      {turn?.products.length ? (
        <>
          <ul className={s.products}>
            {turn.products.map((product) => (
              <ProductRow product={product} key={product.id} />
            ))}
          </ul>
          {turn.nudge ? <p className={s.fine}>{turn.nudge}</p> : null}
        </>
      ) : null}
      {turn?.delivery ? (
        <p className={s.fine}>
          Pincode {turn.delivery.pincode}:{' '}
          {turn.delivery.serviceable
            ? turn.delivery.deliveryFeePaise !== null
              ? `delivery ${rupees(turn.delivery.deliveryFeePaise)}.`
              : 'the shop lists it.'
            : 'the shop does not list it yet.'}
        </p>
      ) : null}
      {turn?.estimate?.status === 'OK' && turn.estimate.result ? (
        <p className={s.fine} data-estimate>
          {turn.estimate.result.bricksWithWaste !== undefined
            ? `About ${turn.estimate.result.bricks} bricks, or ${turn.estimate.result.bricksWithWaste} with extra for breakage.`
            : `About ${turn.estimate.result.totalKg} kg.`}{' '}
          {turn.estimate.note}
        </p>
      ) : null}
      {turn?.citations.map((citation) => (
        <p className={s.fine} key={citation.href}>
          {citation.checkedOn ? (
            <>
              {askWords.sourceLine
                .replace('{title}', citation.title)
                .replace('{month}', checkedMonth(citation.checkedOn))}{' '}
            </>
          ) : (
            <>From our guide: {citation.title}. </>
          )}
          <Link className="link" href={safeHref(citation.href)}>
            Open it
          </Link>
        </p>
      ))}
      {turn?.articles.length ? (
        <ul className={s.articles}>
          {turn.articles.map((article) => (
            <li key={article.slug}>
              <Link href={safeHref(article.href)}>{article.title}</Link>
            </li>
          ))}
        </ul>
      ) : null}
      {whatsapp && (turn?.limit || turn?.articles.length) ? (
        <p>
          <a className="btn btn-line" href={whatsapp} target="_blank" rel="noopener noreferrer">
            {askWords.askShop}
          </a>
        </p>
      ) : turn?.limit ? (
        <p>
          {/* No WhatsApp number is approved yet, and a limit must still leave a way to the shop. */}
          <Link className="btn btn-line" href="/contact" prefetch={false}>
            Contact the shop
          </Link>
        </p>
      ) : null}
      {turn?.followups.length ? (
        <p className={s.followups}>
          {turn.followups.slice(0, 2).map((question) => (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => ask(question)}
              key={question}
            >
              {question}
            </button>
          ))}
        </p>
      ) : null}
      {turn?.status === 'DONE' && !turn.limit ? (
        turn.feedback ? (
          <p className={s.fine}>Thank you.</p>
        ) : notRight ? (
          <p className={s.followups}>
            {(
              [
                ['WRONG', 'Wrong'],
                ['DID_NOT_ANSWER', 'Did not answer'],
                ['HARD_TO_UNDERSTAND', 'Hard to understand'],
              ] as const
            ).map(([reason, words]) => (
              <button
                type="button"
                className="btn btn-quiet"
                key={reason}
                onClick={() => feedback(shown, 'NOT_RIGHT', reason)}
              >
                {words}
              </button>
            ))}
          </p>
        ) : (
          <p className={s.followups}>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => feedback(shown, 'HELPED')}
            >
              This helped
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setNotRight(true)}>
              Not right
            </button>
          </p>
        )
      ) : null}
    </article>
  );
}

/** The whole of Ask. The client keeps no history: what is on screen goes when the panel closes. */
export default function AskPanel({
  seed = '',
  sendNow = false,
  productId,
}: {
  seed?: string;
  sendNow?: boolean;
  productId?: string;
}) {
  const inputId = useId();
  const [text, setText] = useState(seed);
  const [turns, setTurns] = useState<Shown[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [online, setOnline] = useState(true);
  const [problem, setProblem] = useState('');
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const abort = useRef<AbortController | null>(null);
  const currentTurn = useRef('');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const started = useRef(false);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener('online', on);
    addEventListener('offline', off);
    return () => {
      removeEventListener('online', on);
      removeEventListener('offline', off);
      abort.current?.abort();
      timers.current.forEach(clearTimeout);
      recognition.current?.stop();
    };
  }, []);
  const update = (key: string, change: (old: Shown) => Shown) =>
    setTurns((old) => old.map((item) => (item.key === key ? change(item) : item)));

  const ask = useCallback(
    async (question: string) => {
      const asked = question.trim();
      if (!asked || abort.current) return;
      if (!navigator.onLine) {
        setProblem('You are offline. Your question stays here.');
        return;
      }
      setProblem('');
      setText('');
      const key = random();
      const clientTurnId = key.slice(0, 32);
      setTurns((old) => [
        ...old,
        { key, question: asked, sentences: [], turn: null, turnId: '', failed: false },
      ]);
      setStatus('waiting');
      timers.current = [
        setTimeout(() => setStatus('slow'), 3000),
        setTimeout(() => setStatus('very-slow'), 12000),
      ];
      const controller = new AbortController();
      abort.current = controller;
      const stopWaiting = () => {
        timers.current.forEach(clearTimeout);
        setStatus('idle');
        abort.current = null;
      };
      const body = JSON.stringify({
        clientTurnId,
        text: asked,
        channel: 'WEB',
        languageHint: 'en',
        ...(productId ? { productId } : {}),
      });
      try {
        let token = await deviceToken();
        let response = await fetch(`${API_URL}/advisor/turns`, {
          method: 'POST',
          credentials: 'include',
          headers: { ...headers(token), Accept: 'text/event-stream' },
          body,
          signal: controller.signal,
        });
        if (response.status === 401) {
          // The token went bad. The same question id means nothing can run twice.
          token = await deviceToken(true);
          response = await fetch(`${API_URL}/advisor/turns`, {
            method: 'POST',
            credentials: 'include',
            headers: { ...headers(token), Accept: 'text/event-stream' },
            body,
            signal: controller.signal,
          });
        }
        if (response.status === 429) {
          update(key, limited);
          return;
        }
        if (!response.ok || !response.body) throw new Error(String(response.status));
        // Nothing sent to the AI after this point can be charged twice: the id above is the key.
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finished = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseEvents(buffer);
          buffer = parsed.rest;
          for (const raw of parsed.events) {
            const event = raw as { type: string } & Record<string, unknown>;
            if (event.type === 'status') {
              currentTurn.current = String(event.turnId);
              update(key, (old) => ({ ...old, turnId: String(event.turnId) }));
            } else if (event.type === 'text')
              update(key, (old) => ({ ...old, sentences: [...old.sentences, String(event.text)] }));
            else if (event.type === 'replace')
              update(key, (old) => ({ ...old, sentences: [String(event.text)] }));
            else if (event.type === 'done') {
              finished = true;
              const turn = event.turn as Turn;
              update(key, (old) => ({
                ...old,
                turn,
                turnId: turn.id,
                sentences: turn.text ? turn.text.split(/(?<=[.?!])\s+/) : old.sentences,
              }));
            }
          }
        }
        if (!finished) throw new Error('cut off');
      } catch (error) {
        if ((error as Error).message === '429') {
          // Too many new devices from one network: the same honest answer as any other limit.
          update(key, limited);
          return;
        }
        if ((error as Error).name === 'AbortError') {
          update(key, (old) => ({
            ...old,
            sentences: old.sentences.length ? old.sentences : ['Stopped.'],
          }));
          return;
        }
        // A dropped connection does not stop the answer: it is waiting on the server.
        const show = (turn: Turn) =>
          update(key, (old) => ({
            ...old,
            turn,
            turnId: turn.id,
            sentences: turn.text.split(/(?<=[.?!])\s+/),
          }));
        try {
          const token = await deviceToken();
          let id = currentTurn.current;
          if (!id) {
            // It dropped before the answer's id came. The same question id finds it and runs nothing twice.
            const again = await fetch(`${API_URL}/advisor/turns`, {
              method: 'POST',
              credentials: 'include',
              headers: headers(token),
              body,
            });
            if (again.ok) {
              const turn = (await again.json()) as Turn;
              if (turn.status !== 'PENDING') {
                show(turn);
                return;
              }
              id = turn.id;
            }
          }
          for (let attempt = 0; id && attempt < 5; attempt++) {
            const response = await fetch(`${API_URL}/advisor/turns/${encodeURIComponent(id)}`, {
              headers: headers(token),
              credentials: 'include',
            });
            if (!response.ok) break;
            const turn = (await response.json()) as Turn;
            if (turn.status !== 'PENDING') {
              show(turn);
              return;
            }
            await new Promise((done) => setTimeout(done, 1500));
          }
        } catch {
          /* Shown below. */
        }
        update(key, (old) => ({ ...old, failed: true }));
      } finally {
        currentTurn.current = '';
        stopWaiting();
      }
    },
    [productId],
  );
  useEffect(() => {
    if (sendNow && seed && !started.current) {
      started.current = true;
      void ask(seed);
    }
  }, [sendNow, seed, ask]);

  async function cancel() {
    const id = currentTurn.current;
    abort.current?.abort();
    if (!id) return;
    try {
      const token = await deviceToken();
      await fetch(`${API_URL}/advisor/turns/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        headers: headers(token),
        credentials: 'include',
      });
    } catch {
      /* The server stops by itself. */
    }
  }
  async function feedback(shown: Shown, value: string, reason?: string) {
    if (!shown.turnId) return;
    update(shown.key, (old) =>
      old.turn ? { ...old, turn: { ...old.turn, feedback: value } } : old,
    );
    try {
      const token = await deviceToken();
      await fetch(`${API_URL}/advisor/turns/${encodeURIComponent(shown.turnId)}/feedback`, {
        method: 'POST',
        headers: headers(token),
        credentials: 'include',
        body: JSON.stringify({ value, ...(reason ? { reason } : {}) }),
      });
    } catch {
      /* A lost thank-you costs nothing. */
    }
  }
  function listen() {
    const Speech = speech();
    if (!Speech) return;
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const session = new Speech();
    session.lang = 'en-IN';
    session.interimResults = false;
    session.onresult = (event) => {
      const words = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(' ');
      // A draft to read and change. Sending stays the customer's own tap.
      setText((old) => `${old} ${words}`.trim().slice(0, 600));
    };
    session.onerror = () => setListening(false);
    session.onend = () => setListening(false);
    recognition.current = session;
    setListening(true);
    session.start();
  }
  const busy = status !== 'idle';
  const canSpeak = Boolean(speech());
  return (
    <div className={s.panel} translate="no">
      {turns.length ? null : (
        <div className={s.first}>
          <h2>{askWords.title}</h2>
          <p>{askWords.firstOpen}</p>
          <p className={s.followups}>
            {askWords.starters.map((starter) => (
              <button
                type="button"
                className="btn btn-quiet"
                key={starter}
                onClick={() => void ask(starter)}
              >
                {starter}
              </button>
            ))}
          </p>
        </div>
      )}
      <div className={s.turns}>
        {turns.map((shown) => (
          <Answer
            key={shown.key}
            shown={shown}
            feedback={feedback}
            ask={(question) => void ask(question)}
          />
        ))}
      </div>
      {busy ? (
        <p className={s.waiting} role="status">
          {status === 'very-slow'
            ? 'This is slow on your network. Keep waiting or try again.'
            : status === 'slow'
              ? 'Still checking…'
              : askWords.checking}{' '}
          <button type="button" className="link" onClick={() => void cancel()}>
            Cancel
          </button>
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className={s.fine}>
          {problem}
        </p>
      ) : null}
      <form
        className={s.box}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void ask(text);
        }}
      >
        <label className="sr" htmlFor={inputId}>
          Your question
        </label>
        <textarea
          id={inputId}
          rows={2}
          maxLength={600}
          value={text}
          placeholder="Type your question"
          onChange={(event) => setText(event.target.value)}
        />
        <div className={s.boxActions}>
          {canSpeak ? (
            <button
              type="button"
              className="btn btn-quiet"
              aria-pressed={listening}
              onClick={listen}
            >
              {listening ? 'Listening…' : 'Speak'}
            </button>
          ) : null}
          <button className="btn btn-solid" disabled={busy || !online || !text.trim()}>
            Ask
          </button>
        </div>
      </form>
      {!online ? <p className={s.fine}>You are offline. Your question stays here.</p> : null}
      <p className={s.fine}>{askWords.underBox}</p>
    </div>
  );
}
