import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { AdvisorTurn } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  advisorChrome,
  advisorSpeaker,
  advisorWords,
  istToday,
  termsIn,
  type AdvisorArticleLink,
  type AdvisorCitation,
  type AdvisorDelivery,
  type AdvisorEvent,
  type AdvisorFeedbackInput,
  type AdvisorLabel,
  type AdvisorLanguage,
  type AdvisorLevel,
  type AdvisorLimit,
  type AdvisorProduct,
  type AdvisorRoute,
  type AdvisorTextKey,
  type AdvisorTurnInput,
  type AdvisorTurnView,
  type EstimateResult,
} from '@shiv/shared';
import { leased } from '../abuse';
import { getConfig } from '../config';
import { Db } from '../db';
import { errorCause, fail } from '../http';
import { shopContent } from '../public-content';
import { AdvisorBudgets, costOf, databaseBusy, worstCaseCost, type Reservation } from './budgets';
import { floorCheck, floorText } from './floor';
import {
  gateSentence,
  SentenceBuffer,
  stoppedCleanly,
  wordCount,
  type GateContext,
  type GateFlag,
} from './gate';
import {
  detectLanguage,
  languageRequest,
  localRoute,
  type EstimateAsk,
  type GapKind,
  type LocalRoute,
} from './local-route';
import { ADVISOR_PROMPT_VERSION, triageSystem } from './prompts';
import {
  AdvisorModels,
  answerRequest,
  OUTPUT_TOKEN_LIMIT,
  triageOutput,
  type AdvisorModel,
  type HistoryTurn,
  type ModelUsage,
} from './provider';
import { AdvisorReadiness } from './readiness';
import { AdvisorRetrieve, type RetrievedChunk } from './retrieve';
import { cleanInput, questionKey, scrub } from './scrub';
import { AdvisorTools, shopWhatsappUrl } from './tools';

const dayMs = 86_400_000;
/** The privacy page says 30 days, or 90 if the customer marked it not right or the gate stopped it. */
export const KEEP_DAYS = 30;
export const KEEP_FLAGGED_DAYS = 90;
/** A pause longer than this starts a new conversation, so old talk does not leak into new doubts. */
const CONVERSATION_IDLE_MS = 6 * 3_600_000;
const TRIAGE_TIMEOUT_MS = 2_500;
const ANSWER_TIMEOUT_MS = 25_000;
const MAX_NEW_GAPS = 2_000;
const CACHE_DAYS = 7;

export type TurnContext = {
  input: AdvisorTurnInput;
  ip: string;
  userId: string | null;
};
export type Emit = (event: AdvisorEvent) => void;

/** What the turn has come to so far. Written to its row at the end. */
type Outcome = {
  route: AdvisorRoute;
  level: AdvisorLevel;
  label: AdvisorLabel | null;
  text: string;
  products: AdvisorProduct[];
  nudge: boolean;
  delivery: AdvisorDelivery | null;
  estimate: EstimateResult | null;
  citations: AdvisorCitation[];
  articleSlugs: string[];
  followups: string[];
  limit: AdvisorLimit | null;
  gateFlags: string[];
  articleSetHash: string | null;
  modelTriage: string | null;
  modelAnswer: string | null;
  usage: ModelUsage;
  costMicroUsd: number;
  cancelled: boolean;
};

const addUsage = (a: ModelUsage, b: ModelUsage): ModelUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

const citationOf = (chunk: RetrievedChunk, citedText: string): AdvisorCitation => ({
  slug: chunk.slug,
  title: `${chunk.title}: ${chunk.heading}`,
  href: `/guide/${chunk.slug}#${chunk.anchor}`,
  citedText,
  checkedOn: chunk.checkedOn,
});

const wordsOnly = /[^\p{L}\p{N}]+/gu;
const notMaterial = new Set([
  'rate',
  'cft',
  'bhada',
  'kanta',
  'thekedar',
  'mistri',
  'seelan',
  'daraar',
  'rakhna',
  'jaanch',
  'neev',
  'dhalai',
  'jodai',
]);
const notProductWord =
  /^(rate|rates|price|prices|bhav|bhaav|daam|keemat|kimat|kitna|kitni|kitne|kya|hai|hain|ka|ki|ke|ko|mein|aaj|today|what|how|much|many|the|is|of|in|a|an|do|you|have|sell|stock|available|milta|milti|milte|milega|milegi|aapke|yahan|apke|per|kilo|kg|bag|bori|aur|ya|or|and|for|mera|please|bataiye|batao|your|shop|dukaan|current|now|abhi)$/;

/** The material words in a question, as the catalogue search wants them. */
export function catalogQueries(question: string): string[] {
  const text = floorText(question);
  const known = termsIn(text)
    .filter((term) => !notMaterial.has(term.word))
    .map((term) => term.word);
  // "Bori" means cement unless something more exact was named.
  const named = known.filter((word) => word !== 'bori');
  if (named.length) return named.slice(0, 3);
  if (known.length) return ['cement'];
  return text
    .split(wordsOnly)
    .filter((word) => word.length >= 3 && !notProductWord.test(word) && !/^\d+$/.test(word))
    .slice(0, 2);
}

@Injectable()
export class AdvisorCore {
  private running = new Map<string, AbortController>();

  constructor(
    @Inject(Db) private db: Db,
    @Inject(AdvisorTools) private tools: AdvisorTools,
    @Inject(AdvisorRetrieve) private retrieve: AdvisorRetrieve,
    @Inject(AdvisorBudgets) private budgets: AdvisorBudgets,
    @Inject(AdvisorReadiness) private readiness: AdvisorReadiness,
    @Inject(AdvisorModels) private models: AdvisorModels,
  ) {}

  // ---- Opening a turn ---------------------------------------------------------------------------

  /**
   * Stores the question, scrubbed, before anything else happens. A repeated clientTurnId returns the
   * same turn, so a dropped network never pays twice. The same id with different words is refused.
   */
  async begin(
    input: AdvisorTurnInput,
    tokenHash: string,
    ip: string,
  ): Promise<{ turn: AdvisorTurn; replay: boolean }> {
    const question = scrub(cleanInput(input.text));
    // Nothing but invisible characters is not a question, whatever the length check saw.
    if (!question) fail('INVALID_INPUT', 'Please type your question.', 400);
    const seen = await this.findByClientId(tokenHash, input.clientTurnId);
    if (seen) return this.replayed(seen, question);
    await this.budgets.flood(tokenHash, ip);
    try {
      // The unique index stops a replay. Each conversation's row lock keeps its count right.
      const turn = await this.db.$transaction(async (tx) => {
        const recent = await tx.advisorConversation.findFirst({
          where: { tokenHash, lastAt: { gt: new Date(Date.now() - CONVERSATION_IDLE_MS) } },
          orderBy: { lastAt: 'desc' },
        });
        const asked = languageRequest(question);
        const locked = recent?.language.endsWith('!') ?? false;
        const previous = recent?.language.replace('!', '') as AdvisorLanguage | undefined;
        const language: AdvisorLanguage = asked
          ? asked.language
          : locked && previous
            ? previous
            : detectLanguage(question, input.languageHint ?? previous ?? 'en');
        const stored = `${language}${asked || locked ? '!' : ''}`;
        const conversation = recent
          ? await tx.advisorConversation.update({
              where: { id: recent.id },
              data: { turns: { increment: 1 }, lastAt: new Date(), language: stored },
            })
          : await tx.advisorConversation.create({
              data: { tokenHash, channel: input.channel, language: stored, turns: 1 },
            });
        return tx.advisorTurn.create({
          data: {
            conversationId: conversation.id,
            tokenHash,
            clientTurnId: input.clientTurnId,
            ordinal: conversation.turns - 1,
            question,
            questionKey: questionKey(question, language),
            route: 'GENERAL_ADVICE',
            level: 'FIXED',
            language,
            promptVersion: ADVISOR_PROMPT_VERSION,
            purgeAt: new Date(Date.now() + KEEP_DAYS * dayMs),
          },
        });
      });
      return { turn, replay: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.findByClientId(tokenHash, input.clientTurnId);
        if (raced) return this.replayed(raced, question);
      }
      if (databaseBusy(error))
        fail('RESOURCE_BUSY', 'Service is busy. Please try again shortly.', 429);
      throw error;
    }
  }

  private findByClientId(tokenHash: string, clientTurnId: string) {
    return this.db.advisorTurn.findUnique({
      where: { tokenHash_clientTurnId: { tokenHash, clientTurnId } },
    });
  }

  private replayed(turn: AdvisorTurn, question: string) {
    if (turn.question !== question)
      fail(
        'ADVISOR_TURN_REUSED',
        'This question id was already used for a different question.',
        409,
      );
    return { turn, replay: true };
  }

  // ---- Answering --------------------------------------------------------------------------------

  /** Answers an open turn. Never throws: any failure ends in honest text, not an error. */
  async run(
    turn: AdvisorTurn,
    context: TurnContext,
    emit: Emit = () => {},
  ): Promise<AdvisorTurnView> {
    const started = Date.now();
    const cancel = new AbortController();
    this.running.set(turn.id, cancel);
    const language = turn.language as AdvisorLanguage;
    const outcome: Outcome = {
      route: 'GENERAL_ADVICE',
      level: 'FIXED',
      label: null,
      text: '',
      products: [],
      nudge: false,
      delivery: null,
      estimate: null,
      citations: [],
      articleSlugs: [],
      followups: [],
      limit: null,
      gateFlags: [],
      articleSetHash: null,
      modelTriage: null,
      modelAnswer: null,
      usage: { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      costMicroUsd: 0,
      cancelled: false,
    };
    emit({
      type: 'status',
      turnId: turn.id,
      clientTurnId: turn.clientTurnId,
      text: advisorChrome.statusChecking[language],
    });
    try {
      await this.decide(turn, context, outcome, emit, cancel.signal);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'ADVISOR_TURN_FAILED',
          turnId: turn.id,
          ...errorCause(error),
          timestamp: new Date().toISOString(),
        }),
      );
      await this.askPerson(outcome, language, turn.question, emit);
    } finally {
      this.running.delete(turn.id);
    }
    const view = await this.finish(turn, outcome, Date.now() - started);
    emit({ type: 'done', turn: view });
    return view;
  }

  private async decide(
    turn: AdvisorTurn,
    context: TurnContext,
    out: Outcome,
    emit: Emit,
    signal: AbortSignal,
  ) {
    const language = turn.language as AdvisorLanguage;
    // "English mein batao": the same question again, in the language asked for.
    const asked = languageRequest(turn.question);
    let question = turn.question;
    if (asked?.only) {
      const before = await this.db.advisorTurn.findFirst({
        where: {
          conversationId: turn.conversationId,
          ordinal: { lt: turn.ordinal },
          status: 'DONE',
        },
        orderBy: { ordinal: 'desc' },
        select: { question: true },
      });
      if (!before) return this.fixed(out, 'SMALL_TALK', 'SMALL_TALK', language, emit);
      question = before.question;
    }

    // The floor comes first, whatever else is true: limits, models and settings do not change it.
    const floor = floorCheck(question);
    if (floor) {
      out.gateFlags.push(`FLOOR:${floor.rule}`);
      return this.fixed(out, floor.route, floor.text, language, emit);
    }
    if (turn.ordinal >= getConfig().ADVISOR_TURNS_PER_CONVERSATION) {
      out.limit = 'CONVERSATION';
      return this.fixed(out, 'OUT_OF_SCOPE', 'START_NEW', language, emit);
    }
    const local = localRoute(question);
    if (local.confident) return this.answerLocally(local, question, turn, context, out, emit);
    return this.advice(local, question, turn, context, out, emit, signal);
  }

  /** Answers that need no model: fixed text, rate cards, delivery terms, sums and shop facts. */
  private async answerLocally(
    local: LocalRoute,
    question: string,
    turn: AdvisorTurn,
    context: TurnContext,
    out: Outcome,
    emit: Emit,
  ) {
    const language = turn.language as AdvisorLanguage;
    if (local.estimate) return this.estimate(local.estimate, language, out, emit);
    if (local.wants === 'DELIVERY' && local.pincode) {
      const delivery = (await this.tools.tool('delivery', {
        pincode: local.pincode,
      })) as AdvisorDelivery;
      out.delivery = delivery;
      emit({ type: 'delivery', delivery });
      return this.fixed(
        out,
        'CATALOG',
        delivery.serviceable ? 'DELIVERY_YES' : 'DELIVERY_NO',
        language,
        emit,
      );
    }
    if (local.wants === 'RATES' || local.wants === 'AVAILABILITY')
      return this.catalog(
        local.wants,
        catalogQueries(question),
        context.input.productId,
        question,
        language,
        out,
        emit,
      );
    if (local.wants === 'SHOP') return this.shopFact(question, language, out, emit);
    if (local.gap) await this.recordGap(local.gap, question);
    return this.fixed(out, local.route, local.text ?? 'ASK_PERSON', language, emit);
  }

  private async catalog(
    wants: 'RATES' | 'AVAILABILITY',
    queries: readonly string[],
    productId: string | undefined,
    question: string,
    language: AdvisorLanguage,
    out: Outcome,
    emit: Emit,
  ) {
    let products: AdvisorProduct[] = [];
    if (productId)
      products = (await this.tools.tool('products', {
        query: '',
        id: productId,
      })) as AdvisorProduct[];
    else if (queries.length) {
      const found = new Map<string, AdvisorProduct>();
      for (const query of queries)
        for (const product of (await this.tools.tool('products', {
          query: query.slice(0, 80),
          id: '',
        })) as AdvisorProduct[])
          found.set(product.id, product);
      products = [...found.values()].slice(0, 6);
    } else products = (await this.tools.tool('rates', {})) as AdvisorProduct[];
    if (!products.length) {
      await this.recordGap('NOT_LISTED', question);
      return this.fixed(out, 'CATALOG', 'NOT_LISTED', language, emit);
    }
    out.products = products;
    emit({ type: 'products', products, nudge: null });
    return this.fixed(
      out,
      'CATALOG',
      wants === 'RATES' ? 'CATALOG_LINE' : 'AVAILABILITY_LINE',
      language,
      emit,
    );
  }

  private async estimate(ask: EstimateAsk, language: AdvisorLanguage, out: Outcome, emit: Emit) {
    if (ask.kind === 'LATER')
      return this.fixed(out, 'ESTIMATE', 'ESTIMATE_NOT_AVAILABLE', language, emit);
    let result: EstimateResult | null = null;
    if (ask.kind === 'BRICKS' && ask.wall)
      result = (await this.tools.tool('estimate', {
        kind: 'BRICKS',
        ...ask.wall,
      })) as EstimateResult;
    if (ask.kind === 'SARIYA_WEIGHT' && ask.diameterMm && ask.lengthM)
      result = (await this.tools.tool('estimate', {
        kind: 'SARIYA_WEIGHT',
        diameterMm: ask.diameterMm,
        lengthM: ask.lengthM,
        ...(ask.rods ? { rods: ask.rods } : {}),
      })) as EstimateResult;
    if (!result) return this.fixed(out, 'ESTIMATE', 'ESTIMATE_NEEDS_INPUT', language, emit);
    out.estimate = result;
    emit({ type: 'estimate', estimate: result });
    return this.fixed(
      out,
      'ESTIMATE',
      result.status === 'OK'
        ? 'ESTIMATE_DONE'
        : result.status === 'NOT_AVAILABLE'
          ? 'ESTIMATE_NOT_AVAILABLE'
          : 'ESTIMATE_NEEDS_INPUT',
      language,
      emit,
    );
  }

  /** Only what the family has approved. Otherwise the honest "not added yet", and a note for them. */
  private async shopFact(question: string, language: AdvisorLanguage, out: Outcome, emit: Emit) {
    const [answer] = await this.retrieve.search(question, { kind: 'SHOP', limit: 1 });
    if (answer) {
      // The shop's own words, not a guide page, so there is nothing to link to.
      const text = answer.blocks.join(' ');
      return this.say(out, 'SHOP_FACT', 'FIXED', null, text, language, emit);
    }
    const content = shopContent as {
      contactApproved: boolean;
      hours: string;
      address: string;
      phone: string;
    };
    const lower = floorText(question);
    if (content.contactApproved) {
      const fact = /\b(kab|timing|hours|open|close|khul|band)\b/.test(lower)
        ? content.hours
        : /\b(address|location|kahan|kaha|pata)\b/.test(lower)
          ? content.address
          : /\b(number|phone|contact|whatsapp)\b/.test(lower)
            ? content.phone
            : '';
      if (fact) return this.say(out, 'SHOP_FACT', 'FIXED', null, fact, language, emit);
    }
    await this.recordGap('SHOP_FACT', question);
    return this.fixed(out, 'SHOP_FACT', 'SHOP_NOT_ADDED', language, emit);
  }

  /** A doubt about building. This is the only path that can reach a model. */
  private async advice(
    local: LocalRoute,
    question: string,
    turn: AdvisorTurn,
    context: TurnContext,
    out: Outcome,
    emit: Emit,
    signal: AbortSignal,
  ) {
    const language = turn.language as AdvisorLanguage;
    const ready = await this.readiness.check();
    const model = this.models.current();
    out.route = local.route;
    if (!ready.ok || !model) return this.fromGuide(question, language, 'FROM_GUIDE', out, emit);
    // An answer about one product page is not an answer to everyone who asks in the same words, so
    // it is neither read from the cache nor left in it.
    const cacheable = question === turn.question && !context.input.productId;
    if (cacheable) out.articleSetHash = ready.articleSetHash;

    // The same question, already answered from the same checked articles, costs nothing again.
    if (cacheable && (await this.fromCache(turn, ready.articleSetHash, out, emit))) return;

    const reached = await this.budgets.question(turn.tokenHash, context.userId, context.ip);
    if (reached) {
      out.limit = reached;
      out.route = local.route;
      out.articleSlugs = (await this.retrieve.articleLinks(question)).map((link) => link.slug);
      return this.say(
        out,
        local.route,
        'FALLBACK',
        null,
        advisorWords('LIMIT', language),
        language,
        emit,
      );
    }
    try {
      await leased(this.db, 'advisor', getConfig().ADVISOR_CONCURRENCY, 40_000, () =>
        this.withModel(model, local, question, turn, context, out, emit, signal),
      );
    } catch (error) {
      // Too many at once. The customer still gets the guide, and nothing was spent.
      if (error instanceof HttpException && error.getStatus() === 429) {
        out.gateFlags.push('BUSY');
        return this.fromGuide(question, language, 'AI_BUSY', out, emit);
      }
      if (databaseBusy(error)) {
        out.gateFlags.push('BUSY');
        return this.fromGuide(question, language, 'AI_BUSY', out, emit);
      }
      throw error;
    }
  }

  private async fromCache(turn: AdvisorTurn, articleSetHash: string, out: Outcome, emit: Emit) {
    const hit = await this.db.advisorTurn.findFirst({
      where: {
        questionKey: turn.questionKey,
        id: { not: turn.id },
        status: 'DONE',
        level: 'CHECKED',
        ordinal: 0,
        articleSetHash,
        promptVersion: ADVISOR_PROMPT_VERSION,
        gateFlags: { isEmpty: true },
        createdAt: { gt: new Date(Date.now() - CACHE_DAYS * dayMs) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!hit?.answer || turn.ordinal !== 0) return false;
    out.modelAnswer = 'cache';
    out.citations = hit.citations as unknown as AdvisorCitation[];
    out.articleSlugs = hit.articleIds;
    out.followups = hit.followups as unknown as string[];
    this.say(
      out,
      hit.route as AdvisorRoute,
      'CHECKED',
      'CHECKED',
      hit.answer,
      hit.language as AdvisorLanguage,
      emit,
    );
    for (const citation of out.citations) emit({ type: 'cite', citation });
    if (out.followups.length) emit({ type: 'followups', followups: out.followups });
    return true;
  }

  private async withModel(
    model: AdvisorModel,
    local: LocalRoute,
    question: string,
    turn: AdvisorTurn,
    context: TurnContext,
    out: Outcome,
    emit: Emit,
    cancel: AbortSignal,
  ) {
    const language = turn.language as AdvisorLanguage;
    const index = await this.retrieve.index();
    const system = triageSystem(index);

    // Triage is a hint. Failure or a slow reply means floor rules plus search, and on we go.
    let route = local.route;
    let englishQuery = '';
    let picks: string[] = [];
    let catalogTerms: string[] = [];
    let triagePincode: string | null = null;
    const triageReservation = await this.budgets.reserve(
      worstCaseCost(
        Buffer.byteLength(system) + Buffer.byteLength(question) + 256,
        OUTPUT_TOKEN_LIMIT,
      ),
    );
    if (!triageReservation) return this.capReached(question, language, out, emit);
    try {
      out.modelTriage = model.triageName;
      const result = await model.triage({
        system,
        question,
        signal: AbortSignal.any([cancel, AbortSignal.timeout(TRIAGE_TIMEOUT_MS)]),
      });
      await this.spend(triageReservation, result.usage, out);
      const parsed = stoppedCleanly(result.stopReason)
        ? triageOutput.safeParse(result.output)
        : null;
      if (parsed?.success) {
        const known = new Set(index.map((article) => article.slug));
        route = parsed.data.route;
        englishQuery = scrub(cleanInput(parsed.data.englishQuery, 200));
        picks = parsed.data.articleIds.filter((slug) => known.has(slug)).slice(0, 3);
        catalogTerms = parsed.data.catalogTerms.map((term) => term.slice(0, 40)).slice(0, 3);
        triagePincode = /^[1-9]\d{5}$/.test(parsed.data.pincode ?? '') ? parsed.data.pincode : null;
      } else out.gateFlags.push('TRIAGE_INVALID');
    } catch {
      // Not knowing what the provider charged, the reservation stays spent.
      await this.budgets.settle(triageReservation, null);
      out.costMicroUsd += triageReservation.microUsd;
      if (cancel.aborted) {
        out.cancelled = true;
        return;
      }
      out.gateFlags.push('TRIAGE_FAILED');
    }

    // Routes decide. Most of these stop here and never reach the answer call.
    if (route === 'DANGER_NOW') return this.fixed(out, route, 'DANGER_NOW', language, emit);
    if (route === 'STRUCTURAL') return this.fixed(out, route, 'STRUCTURAL', language, emit);
    if (route === 'OTHER_PROFESSIONAL')
      return this.fixed(out, route, 'OTHER_PROFESSIONAL', language, emit);
    if (route === 'PRIVATE_OR_ATTACK') return this.fixed(out, route, 'ATTACK', language, emit);
    if (route === 'OUT_OF_SCOPE') return this.fixed(out, route, 'OUT_OF_SCOPE', language, emit);
    if (route === 'SMALL_TALK') return this.fixed(out, route, 'SMALL_TALK', language, emit);
    if (route === 'ORDER_INTENT') return this.fixed(out, route, 'ORDER_INTENT', language, emit);
    if (route === 'MY_ACCOUNT') return this.fixed(out, route, 'MY_ACCOUNT', language, emit);
    if (route === 'SHOP_FACT') return this.shopFact(question, language, out, emit);
    if (route === 'ESTIMATE')
      return this.estimate(local.estimate ?? { kind: 'LATER' }, language, out, emit);
    if (route === 'CATALOG') {
      if (triagePincode) {
        const delivery = (await this.tools.tool('delivery', {
          pincode: triagePincode,
        })) as AdvisorDelivery;
        out.delivery = delivery;
        emit({ type: 'delivery', delivery });
        return this.fixed(
          out,
          'CATALOG',
          delivery.serviceable ? 'DELIVERY_YES' : 'DELIVERY_NO',
          language,
          emit,
        );
      }
      return this.catalog(
        'RATES',
        catalogTerms.length ? catalogTerms : catalogQueries(question),
        context.input.productId,
        question,
        language,
        out,
        emit,
      );
    }

    const settings = await this.readiness.settings();
    const chunks = await this.retrieve.search(`${englishQuery} ${question}`.trim(), { picks });
    out.route = route;
    if (!chunks.length && !settings.generalEnabled)
      return this.askPerson(out, language, question, emit);
    await this.answer(model, route, question, chunks, turn, context, out, emit, cancel);
  }

  /** The answer call. Every sentence passes the gate before the customer sees it. */
  private async answer(
    model: AdvisorModel,
    route: AdvisorRoute,
    question: string,
    chunks: RetrievedChunk[],
    turn: AdvisorTurn,
    context: TurnContext,
    out: Outcome,
    emit: Emit,
    cancel: AbortSignal,
  ) {
    const language = turn.language as AdvisorLanguage;
    const level = chunks.length ? 'CHECKED' : 'GENERAL';
    const before = await this.db.advisorTurn.findMany({
      where: {
        conversationId: turn.conversationId,
        ordinal: { lt: turn.ordinal },
        status: 'DONE',
        answer: { not: null },
      },
      orderBy: { ordinal: 'desc' },
      take: 2,
      select: { question: true, answer: true },
    });
    const history: HistoryTurn[] = before
      .reverse()
      .map((row) => ({ question: row.question, answer: row.answer ?? '' }));
    // A product page sends which item it is about. Its card goes in as data, read live.
    const onPage = context.input.productId
      ? ((await this.tools.tool('products', {
          query: '',
          id: context.input.productId,
        })) as AdvisorProduct[])
      : [];
    const facts = onPage.length
      ? JSON.stringify(onPage.map(({ priceUpdatedAt: _, ...rest }) => rest))
      : '';
    const call = { level, language, history, chunks, facts, question, today: istToday() } as const;
    const body = JSON.stringify(answerRequest(call, model.answerName));
    const reservation = await this.budgets.reserve(
      worstCaseCost(Buffer.byteLength(body), OUTPUT_TOKEN_LIMIT),
    );
    if (!reservation) return this.capReached(question, language, out, emit);

    const stop = new AbortController();
    const signal = AbortSignal.any([cancel, stop.signal, AbortSignal.timeout(ANSWER_TIMEOUT_MS)]);
    const gate: GateContext = {
      level,
      customer: [before[before.length - 1]?.question ?? '', question].filter(Boolean),
      chunks: chunks.map((chunk) => `${chunk.heading}\n${chunk.blocks.join('\n')}`),
      tools: onPage.map(
        (product) => `${product.name} ${product.grade} ${product.packSize} ${product.unit}`,
      ),
      moneyPaise: onPage.flatMap((product) =>
        product.pricePaise === null ? [] : [product.pricePaise],
      ),
      needsSource: level === 'CHECKED',
    };
    out.modelAnswer = model.answerName;
    emit({ type: 'route', route, level, language });
    const buffer = new SentenceBuffer();
    const released: string[] = [];
    const cited = new Map<string, { citation: AdvisorCitation; chunk: RetrievedChunk }>();
    let words = 0;
    let blocked: GateFlag | null = null;
    let settled = false;

    const release = (sentence: string) => {
      const verdict = gateSentence(sentence, gate, {
        released: released.length,
        words,
        citations: cited.size,
      });
      if (!verdict.pass) {
        blocked = verdict.flag;
        return false;
      }
      released.push(sentence);
      words += wordCount(sentence);
      emit({ type: 'text', text: sentence });
      return true;
    };

    try {
      stream: for await (const part of model.answer({ ...call, signal })) {
        if (part.type === 'text') {
          for (const sentence of buffer.push(part.text)) if (!release(sentence)) break stream;
        } else if (part.type === 'citation') {
          // A citation that points at nothing we sent is not a source.
          const chunk = chunks[part.searchResultIndex];
          if (!chunk) continue;
          const key = `${chunk.slug}#${chunk.anchor}`;
          if (!cited.has(key)) {
            const citation = citationOf(chunk, part.citedText.slice(0, 600));
            cited.set(key, { citation, chunk });
            emit({ type: 'cite', citation });
          }
        } else {
          await this.spend(reservation, part.usage, out);
          settled = true;
          // A refusal or a cut-off answer is never read, whatever text came with it.
          if (!stoppedCleanly(part.stopReason)) {
            blocked = 'STOP_REASON';
            break stream;
          }
          const last = buffer.flush();
          if (last && !release(last)) break stream;
          if (!released.length) blocked = 'NO_TEXT';
          else if (gate.needsSource && !cited.size) blocked = 'NO_SOURCE';
        }
      }
    } catch {
      if (cancel.aborted) {
        out.cancelled = true;
      } else {
        out.gateFlags.push('ANSWER_FAILED');
        blocked ??= 'NO_TEXT';
      }
    } finally {
      // Stopped early, the call may still bill. Hold the whole reservation rather than guess low.
      stop.abort();
      if (!settled) {
        await this.budgets.settle(reservation, null);
        out.costMicroUsd += reservation.microUsd;
      }
    }
    if (out.cancelled) {
      out.text = released.join(' ');
      out.level = level;
      return;
    }
    if (blocked) {
      out.gateFlags.push(`GATE:${blocked}`);
      return this.replaceBlocked(chunks, route, question, language, out, emit);
    }
    out.level = level;
    out.label = level === 'CHECKED' ? 'CHECKED' : 'GENERAL';
    out.text = released.join(' ');
    out.citations = [...cited.values()].map((entry) => entry.citation);
    out.articleSlugs = [...new Set([...cited.values()].map((entry) => entry.chunk.slug))];
    if (level === 'GENERAL') await this.recordGap('NO_ARTICLE', question);
    const first = [...cited.values()][0]?.chunk;
    if (first) {
      out.followups = first.relatedQuestions.slice(0, 2).map((item) => item[language]);
      if (out.followups.length) emit({ type: 'followups', followups: out.followups });
      await this.nudge(first, turn, language, out, emit);
    }
  }

  /** Answer first, then at most one group of materials, chosen by the article and never the model. */
  private async nudge(
    article: RetrievedChunk,
    turn: AdvisorTurn,
    language: AdvisorLanguage,
    out: Outcome,
    emit: Emit,
  ) {
    const material = article.materials[0];
    if (!material) return;
    const products = (
      (await this.tools.tool('products', { query: material, id: '' })) as AdvisorProduct[]
    ).slice(0, 3);
    if (!products.length) return;
    const already = await this.db.advisorTurn.count({
      where: { conversationId: turn.conversationId, nudge: true },
    });
    out.products = products;
    out.nudge = already === 0;
    emit({ type: 'products', products, nudge: out.nudge ? advisorChrome.nudge[language] : null });
  }

  private async spend(reservation: Reservation, usage: ModelUsage, out: Outcome) {
    const spent = costOf(usage);
    await this.budgets.settle(reservation, spent);
    out.usage = addUsage(out.usage, usage);
    out.costMicroUsd += spent;
  }

  // ---- Endings ----------------------------------------------------------------------------------

  private say(
    out: Outcome,
    route: AdvisorRoute,
    level: AdvisorLevel,
    label: AdvisorLabel | null,
    text: string,
    language: AdvisorLanguage,
    emit: Emit,
  ) {
    out.route = route;
    out.level = level;
    out.label = label;
    out.text = text;
    emit({ type: 'route', route, level, language });
    emit({ type: 'text', text });
  }

  private fixed(
    out: Outcome,
    route: AdvisorRoute,
    key: AdvisorTextKey,
    language: AdvisorLanguage,
    emit: Emit,
  ) {
    out.route = route;
    out.level = 'FIXED';
    out.label = null;
    out.text = advisorWords(key, language);
    emit({ type: 'route', route, level: 'FIXED', language });
    emit({ type: 'text', text: out.text });
  }

  private async askPerson(out: Outcome, language: AdvisorLanguage, question: string, emit: Emit) {
    await this.recordGap('NO_ARTICLE', question).catch(() => {});
    out.citations = [];
    out.products = [];
    out.nudge = false;
    this.fixed(out, out.route, 'ASK_PERSON', language, emit);
  }

  /** Signed article text, word for word, labelled honestly. If nothing fits, who to ask. */
  private async fromGuide(
    question: string,
    language: AdvisorLanguage,
    label: 'FROM_GUIDE' | 'AI_BUSY',
    out: Outcome,
    emit: Emit,
  ) {
    const [best] = await this.retrieve.search(question, { limit: 1 });
    if (!best) return this.askPerson(out, language, question, emit);
    this.useChunk(best, label, language, out);
    emit({ type: 'route', route: out.route, level: 'FALLBACK', language });
    emit({ type: 'text', text: out.text });
    for (const citation of out.citations) emit({ type: 'cite', citation });
    if (out.followups.length) emit({ type: 'followups', followups: out.followups });
  }

  private useChunk(
    best: RetrievedChunk,
    label: 'FROM_GUIDE' | 'AI_BUSY',
    language: AdvisorLanguage,
    out: Outcome,
  ) {
    const text = best.blocks.join(' ');
    out.level = 'FALLBACK';
    out.label = label;
    out.text = text;
    out.citations = [citationOf(best, text)];
    out.articleSlugs = [best.slug];
    out.followups = best.relatedQuestions.slice(0, 2).map((item) => item[language]);
  }

  /** The gate stopped the answer. What was shown is taken back with no alarm wording. */
  private async replaceBlocked(
    chunks: RetrievedChunk[],
    route: AdvisorRoute,
    question: string,
    language: AdvisorLanguage,
    out: Outcome,
    emit: Emit,
  ) {
    out.route = route;
    const best = chunks[0];
    if (best) {
      this.useChunk(best, 'AI_BUSY', language, out);
      emit({ type: 'replace', text: out.text, level: 'FALLBACK', label: 'AI_BUSY' });
      for (const citation of out.citations) emit({ type: 'cite', citation });
      return;
    }
    await this.recordGap('NO_ARTICLE', question).catch(() => {});
    out.level = 'FIXED';
    out.label = null;
    out.text = advisorWords('ASK_PERSON', language);
    out.citations = [];
    emit({ type: 'replace', text: out.text, level: 'FIXED', label: null });
  }

  /** The shop's money for the day or month has gone. Nothing breaks. */
  private async capReached(question: string, language: AdvisorLanguage, out: Outcome, emit: Emit) {
    out.limit = 'SHOP';
    const [best] = await this.retrieve.search(question, { limit: 1 });
    out.articleSlugs = (await this.retrieve.articleLinks(question)).map((link) => link.slug);
    if (best) {
      this.useChunk(best, 'AI_BUSY', language, out);
      emit({ type: 'route', route: out.route, level: 'FALLBACK', language });
      emit({ type: 'text', text: out.text });
      for (const citation of out.citations) emit({ type: 'cite', citation });
      return;
    }
    this.say(
      out,
      out.route,
      'FALLBACK',
      null,
      advisorWords('SHOP_LIMIT', language),
      language,
      emit,
    );
  }

  private async finish(turn: AdvisorTurn, out: Outcome, ms: number) {
    const flagged = out.gateFlags.some((flag) => flag.startsWith('GATE:'));
    const data: Prisma.AdvisorTurnUpdateManyMutationInput = {
      status: out.cancelled ? 'CANCELLED' : 'DONE',
      answer: out.text,
      route: out.route,
      level: out.level,
      label: out.label,
      articleIds: out.articleSlugs,
      citations: out.citations as unknown as Prisma.InputJsonValue,
      gateFlags: out.gateFlags,
      productIds: out.products.map((product) => product.id),
      delivery: out.delivery ? (out.delivery as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      estimate: out.estimate ? (out.estimate as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      followups: out.followups,
      limitReached: out.limit,
      nudge: out.nudge,
      articleSetHash: out.articleSetHash,
      modelTriage: out.modelTriage,
      modelAnswer: out.modelAnswer,
      inputTokens: out.usage.inputTokens + out.usage.cacheWriteTokens,
      cachedTokens: out.usage.cacheReadTokens,
      outputTokens: out.usage.outputTokens,
      costMicroUsd: out.costMicroUsd,
      ms,
      ...(flagged ? { purgeAt: new Date(Date.now() + KEEP_FLAGGED_DAYS * dayMs) } : {}),
    };
    // Only an open turn: Cancel or Clear may have got there first. A row that has gone stays gone.
    await this.db.advisorTurn.updateMany({ where: { id: turn.id, status: 'PENDING' }, data });
    console.log(
      JSON.stringify({
        // Numbers and labels only. Never the customer's words or the answer.
        event: 'ADVISOR_TURN',
        turnId: turn.id,
        route: out.route,
        level: out.level,
        limit: out.limit,
        flags: out.gateFlags,
        inputTokens: out.usage.inputTokens,
        cachedTokens: out.usage.cacheReadTokens,
        outputTokens: out.usage.outputTokens,
        costMicroUsd: out.costMicroUsd,
        ms,
        timestamp: new Date().toISOString(),
      }),
    );
    const fresh = await this.db.advisorTurn.findUnique({ where: { id: turn.id } });
    return this.view(fresh ?? ({ ...turn, ...(data as object), status: 'DONE' } as AdvisorTurn));
  }

  // ---- Gaps -------------------------------------------------------------------------------------

  /** A question the guide could not answer, in scrubbed words, for the family and for new articles. */
  async recordGap(kind: GapKind, question: string) {
    const canonical = question.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!canonical) return;
    try {
      await this.db.$transaction(async (tx) => {
        const existing = await tx.advisorGap.findUnique({
          where: { canonical_kind: { canonical, kind } },
        });
        if (existing) {
          const samples = existing.samples as string[];
          await tx.advisorGap.update({
            where: { id: existing.id },
            data: {
              count: { increment: 1 },
              lastSeen: new Date(),
              ...(samples.length < 5 && !samples.includes(question)
                ? { samples: [...samples, question] }
                : {}),
            },
          });
          return;
        }
        // A flood of made-up questions must not bury the real ones or fill the table.
        if ((await tx.advisorGap.count({ where: { status: 'NEW' } })) >= MAX_NEW_GAPS) return;
        await tx.advisorGap.create({ data: { canonical, kind, samples: [question] } });
      });
    } catch (error) {
      // Losing a note about a question must never lose the customer's answer.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
    }
  }

  // ---- After the answer -------------------------------------------------------------------------

  /** Only the device that asked can read a turn. Anyone else gets the same answer as for no turn. */
  private async owned(id: string, tokenHash: string) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id))
      fail('NOT_FOUND', 'This answer could not be found.', 404);
    const turn = await this.db.advisorTurn.findFirst({ where: { id, tokenHash } });
    if (!turn) fail('NOT_FOUND', 'This answer could not be found.', 404);
    return turn;
  }

  async read(id: string, tokenHash: string) {
    return this.view(await this.owned(id, tokenHash));
  }

  /** Cancel stops the model and keeps the money reservation, as the provider may already have billed. */
  async cancel(id: string, tokenHash: string) {
    const turn = await this.owned(id, tokenHash);
    if (turn.status === 'PENDING') {
      await this.db.advisorTurn.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      this.running.get(id)?.abort();
    }
    return this.read(id, tokenHash);
  }

  async feedback(id: string, tokenHash: string, input: AdvisorFeedbackInput) {
    const turn = await this.owned(id, tokenHash);
    const first = turn.feedback === null;
    await this.db.advisorTurn.update({
      where: { id },
      data: {
        feedback: input.value,
        feedbackReason: input.reason ?? null,
        // Kept longer so someone can read what went wrong, and never served from the cache again.
        ...(input.value === 'NOT_RIGHT'
          ? { purgeAt: new Date(Date.now() + KEEP_FLAGGED_DAYS * dayMs) }
          : {}),
      },
    });
    if (input.value === 'NOT_RIGHT') {
      await this.db.advisorTurn.updateMany({
        where: { questionKey: turn.questionKey },
        data: { articleSetHash: null },
      });
      if (first) await this.recordGap('DISLIKED', turn.question);
    }
    return this.read(id, tokenHash);
  }

  /** Clear removes this phone's questions and answers at once. Limits are not touched by it. */
  async clear(tokenHash: string) {
    const { count } = await this.db.advisorConversation.deleteMany({ where: { tokenHash } });
    return { cleared: count };
  }

  /** What a client sees. Cards are read again each time, so a stored answer never shows an old rate. */
  async view(turn: AdvisorTurn): Promise<AdvisorTurnView> {
    const products = await this.tools.productsById(turn.productIds);
    const links = turn.articleIds.length ? await this.articleLinks(turn.articleIds) : [];
    return {
      id: turn.id,
      clientTurnId: turn.clientTurnId,
      status: turn.status as AdvisorTurnView['status'],
      speaker: advisorSpeaker,
      route: turn.route as AdvisorRoute,
      level: turn.level as AdvisorLevel,
      label: (turn.label as AdvisorLabel | null) ?? null,
      language: turn.language as AdvisorLanguage,
      text: turn.answer ?? '',
      products,
      nudge: turn.nudge ? advisorChrome.nudge[turn.language as AdvisorLanguage] : null,
      delivery: (turn.delivery as unknown as AdvisorDelivery | null) ?? null,
      estimate: (turn.estimate as unknown as EstimateResult | null) ?? null,
      citations: (turn.citations as unknown as AdvisorCitation[]) ?? [],
      articles: links,
      followups: (turn.followups as unknown as string[]) ?? [],
      limit: (turn.limitReached as AdvisorLimit | null) ?? null,
      whatsappUrl: shopWhatsappUrl(),
      feedback: (turn.feedback as AdvisorTurnView['feedback']) ?? null,
      createdAt: turn.createdAt.toISOString(),
    };
  }

  /** Links for articles that are live right now. An article withdrawn since is simply not linked. */
  private async articleLinks(slugs: readonly string[]): Promise<AdvisorArticleLink[]> {
    const rows = await this.db.knowledgeArticle.findMany({
      where: {
        slug: { in: [...slugs] },
        kind: 'GUIDE',
        status: 'PUBLISHED',
        reviewerKey: { not: null },
        reviewDueAt: { gt: new Date() },
      },
      select: { slug: true, titleEn: true, titleHinglish: true, summary: true },
    });
    return rows.map((row) => ({
      slug: row.slug,
      title: row.titleEn,
      titleHinglish: row.titleHinglish,
      summary: row.summary,
      href: `/guide/${row.slug}`,
    }));
  }
}

/** Forgets on schedule, as the privacy page says, and closes turns a crash left open. */
export async function purgeAdvisor(db: Db, now = Date.now()) {
  const turns = await db.advisorTurn.deleteMany({ where: { purgeAt: { lt: new Date(now) } } });
  const conversations = await db.advisorConversation.deleteMany({
    where: { records: { none: {} }, lastAt: { lt: new Date(now - 3_600_000) } },
  });
  const gaps = await db.advisorGap.deleteMany({
    where: { status: { not: 'NEW' }, lastSeen: { lt: new Date(now - 365 * dayMs) } },
  });
  const stuck = await db.advisorTurn.findMany({
    where: { status: 'PENDING', createdAt: { lt: new Date(now - 120_000) } },
    select: { id: true, language: true },
    take: 100,
  });
  for (const turn of stuck)
    await db.advisorTurn.updateMany({
      where: { id: turn.id, status: 'PENDING' },
      data: {
        status: 'DONE',
        level: 'FIXED',
        answer: advisorWords('SHOP_LIMIT', turn.language as AdvisorLanguage),
      },
    });
  return {
    turns: turns.count,
    conversations: conversations.count,
    gaps: gaps.count,
    closed: stuck.length,
  };
}
