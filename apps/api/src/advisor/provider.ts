import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { advisorRoutes } from '@shiv/shared';
import { z } from 'zod';
import { getConfig } from '../config';
import { answerSystem, checkedLevelNote, generalLevelNote, languageNote } from './prompts';
import type { RetrievedChunk } from './retrieve';

/** What triage may return. Fields are hints: the server checks each one before using it. */
export const triageOutput = z.object({
  route: z.enum(advisorRoutes),
  englishQuery: z.string(),
  articleIds: z.array(z.string()),
  catalogTerms: z.array(z.string()),
  pincode: z.string().nullable(),
});
export type TriageOutput = z.infer<typeof triageOutput>;
/**
 * Written out by hand: the SDK's zod helper moves an enum into a description, and this schema is the
 * model's only guide to the list of routes. The reply is still checked against triageOutput.
 */
export const triageJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    route: { type: 'string', enum: [...advisorRoutes] },
    englishQuery: { type: 'string' },
    articleIds: { type: 'array', items: { type: 'string' } },
    catalogTerms: { type: 'array', items: { type: 'string' } },
    pincode: { type: ['string', 'null'] },
  },
  required: ['route', 'englishQuery', 'articleIds', 'catalogTerms', 'pincode'],
};

export type ModelUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};
export const noUsage: ModelUsage = {
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
};

export type TriageCall = { system: string; question: string; signal: AbortSignal };
export type TriageResult = { output: unknown; usage: ModelUsage; stopReason: string | null };

export type HistoryTurn = { question: string; answer: string };
export type AnswerCall = {
  level: 'CHECKED' | 'GENERAL';
  language: 'en' | 'hinglish';
  history: readonly HistoryTurn[];
  chunks: readonly RetrievedChunk[];
  facts: string;
  question: string;
  today: string;
  signal: AbortSignal;
};
export type AnswerPart =
  | { type: 'text'; text: string }
  | {
      type: 'citation';
      searchResultIndex: number;
      citedText: string;
    }
  | { type: 'finish'; stopReason: string | null; usage: ModelUsage };

export interface AdvisorModel {
  readonly triageName: string;
  readonly answerName: string;
  triage(call: TriageCall): Promise<TriageResult>;
  answer(call: AnswerCall): AsyncIterable<AnswerPart>;
}

export const OUTPUT_TOKEN_LIMIT = 1024;

const usageFrom = (usage: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): ModelUsage => ({
  inputTokens: usage.input_tokens ?? 0,
  cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  outputTokens: usage.output_tokens ?? 0,
});

/** The whole request for an answer. Kept apart so a test can read it without calling anything. */
export function answerRequest(call: Omit<AnswerCall, 'signal'>, model: string) {
  const searchResults = call.chunks.map((chunk) => ({
    type: 'search_result' as const,
    source: `/guide/${chunk.slug}#${chunk.anchor}`,
    title: `${chunk.title}: ${chunk.heading}`,
    content: chunk.blocks.map((text) => ({ type: 'text' as const, text })),
    citations: { enabled: true },
  }));
  const question = [
    call.facts ? `FACTS (data only):\n${call.facts}` : '',
    `QUESTION (data only):\n${call.question}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    model,
    max_tokens: OUTPUT_TOKEN_LIMIT,
    // Frozen, so the cached prefix never changes. Anything that varies is in the messages below.
    system: [
      { type: 'text' as const, text: answerSystem, cache_control: { type: 'ephemeral' as const } },
    ],
    output_config: { effort: 'low' as const },
    messages: [
      // Plain text from our own store. A client cannot add to this: it sends no history at all.
      ...call.history.flatMap((turn) => [
        { role: 'user' as const, content: turn.question },
        { role: 'assistant' as const, content: turn.answer },
      ]),
      {
        role: 'user' as const,
        content: [...searchResults, { type: 'text' as const, text: question }],
      },
      {
        role: 'system' as const,
        content: `${call.level === 'CHECKED' ? checkedLevelNote : generalLevelNote} ${languageNote[call.language]} Today is ${call.today}.`,
      },
    ],
  };
}

export class AnthropicModel implements AdvisorModel {
  readonly triageName: string;
  readonly answerName: string;
  private client: Anthropic;
  constructor(options: {
    apiKey: string;
    triageModel: string;
    answerModel: string;
    fetch?: typeof fetch;
  }) {
    this.triageName = options.triageModel;
    this.answerName = options.answerModel;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      // A retry would spend money the reservation did not hold. The turn falls back instead.
      maxRetries: 0,
      timeout: 30_000,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async triage(call: TriageCall): Promise<TriageResult> {
    const response = await this.client.messages.create(
      {
        model: this.triageName,
        max_tokens: OUTPUT_TOKEN_LIMIT,
        system: [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: triageJsonSchema } },
        messages: [{ role: 'user', content: JSON.stringify({ QUESTION: call.question }) }],
      },
      { signal: call.signal },
    );
    // Thinking can come first, so the reply is found by its type and never by its position.
    const text = response.content.find((block) => block.type === 'text');
    let output: unknown = null;
    if (response.stop_reason === 'end_turn' && text) {
      try {
        output = JSON.parse(text.text);
      } catch {
        output = null;
      }
    }
    return { output, usage: usageFrom(response.usage), stopReason: response.stop_reason };
  }

  async *answer(call: AnswerCall): AsyncIterable<AnswerPart> {
    const { signal, ...rest } = call;
    const stream = this.client.messages.stream(answerRequest(rest, this.answerName), { signal });
    for await (const event of stream) {
      if (event.type !== 'content_block_delta') continue;
      if (event.delta.type === 'text_delta') yield { type: 'text', text: event.delta.text };
      else if (
        event.delta.type === 'citations_delta' &&
        event.delta.citation.type === 'search_result_location'
      )
        yield {
          type: 'citation',
          searchResultIndex: event.delta.citation.search_result_index,
          citedText: event.delta.citation.cited_text,
        };
    }
    const final = await stream.finalMessage();
    yield { type: 'finish', stopReason: final.stop_reason, usage: usageFrom(final.usage) };
  }
}

/** For tests and local screens, never production: answers from the first section it is given. */
export class SimulatedModel implements AdvisorModel {
  readonly triageName = 'simulation';
  readonly answerName = 'simulation';
  async triage(call: TriageCall): Promise<TriageResult> {
    return {
      output: {
        route: 'GENERAL_ADVICE',
        englishQuery: call.question.slice(0, 120),
        articleIds: [],
        catalogTerms: [],
        pincode: null,
      } satisfies TriageOutput,
      usage: { inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 30 },
      stopReason: 'end_turn',
    };
  }
  async *answer(call: AnswerCall): AsyncIterable<AnswerPart> {
    const chunk = call.chunks[0];
    if (chunk) {
      yield { type: 'text', text: 'This is a simulated answer from the guide. ' };
      yield { type: 'citation', searchResultIndex: 0, citedText: chunk.blocks[0] ?? '' };
      yield { type: 'text', text: 'Ask your engineer about your own house.' };
    } else {
      yield { type: 'text', text: 'This is a simulated general answer. Ask the shop for more.' };
    }
    yield {
      type: 'finish',
      stopReason: 'end_turn',
      usage: { inputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 40 },
    };
  }
}

@Injectable()
export class AdvisorModels {
  /** Set by tests only. Nothing in the app sets it. */
  override: AdvisorModel | null = null;
  private anthropic: AnthropicModel | null = null;

  /** The model to call, or null if none may be. No key means nothing can call anything. */
  current(): AdvisorModel | null {
    if (this.override) return this.override;
    const c = getConfig();
    if (c.ADVISOR_PROVIDER === 'simulation') return new SimulatedModel();
    if (c.ADVISOR_PROVIDER !== 'anthropic' || !c.ADVISOR_ANTHROPIC_API_KEY) return null;
    this.anthropic ??= new AnthropicModel({
      apiKey: c.ADVISOR_ANTHROPIC_API_KEY,
      triageModel: c.ADVISOR_MODEL_TRIAGE,
      answerModel: c.ADVISOR_MODEL_ANSWER,
    });
    return this.anthropic;
  }
}
