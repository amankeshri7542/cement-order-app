// Measures a real model on real masked messages. Run by hand from your own machine, with a paid
// key. Real messages stay in a file outside this public repo, and are never printed here.
// See docs/WHATSAPP_CONNECT.md.
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { loadCatalog } from '../src/catalog-match';
import { promptBody, promptVersion } from '../src/whatsapp/reader';
import { finishReading, readerOutputSchema } from '../src/whatsapp/reading';
import { readByRules } from '../src/whatsapp/rules';

const caseSchema = z.object({
  text: z.string().min(1).max(2000),
  intent: z.string(),
  lines: z
    .array(z.object({ productId: z.string().nullable(), quantity: z.number().nullable() }))
    .default([]),
});
const path = process.argv[2];
const { GEMINI_API_KEY: key, WA_EVAL_MODEL: model, WA_EVAL_INPUT, WA_EVAL_OUTPUT } = process.env;
if (!path || !key || !model || !WA_EVAL_INPUT || !WA_EVAL_OUTPUT) {
  console.error(
    'Usage: GEMINI_API_KEY=... WA_EVAL_MODEL=... WA_EVAL_INPUT=<micro USD per million> WA_EVAL_OUTPUT=<micro USD per million> npm run wa:eval -- <messages.jsonl>',
  );
  process.exit(2);
}
const cases = readFileSync(path, 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => caseSchema.parse(JSON.parse(line)));

async function askModel(text: string, body: ReturnType<typeof promptBody>) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model!)}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key! },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) throw new Error(`Model answered ${response.status}`);
  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
    };
  };
  const usage = data.usageMetadata ?? {};
  return {
    output: readerOutputSchema.parse(
      JSON.parse(
        data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '',
      ),
    ),
    micro:
      ((usage.promptTokenCount ?? 0) * Number(WA_EVAL_INPUT) +
        ((usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)) *
          Number(WA_EVAL_OUTPUT)) /
      1_000_000,
  };
}

async function main() {
  const db = new PrismaClient();
  const catalog = await loadCatalog(db);
  await db.$disconnect();
  const score = {
    total: 0,
    byRules: 0,
    intent: 0,
    lines: 0,
    failed: 0,
    micro: 0,
    green: 0,
    greenRight: 0,
  };
  for (const item of cases) {
    score.total++;
    try {
      const rules = readByRules(item.text, catalog);
      if (rules) score.byRules++;
      const answer = rules
        ? { output: rules, micro: 0 }
        : await askModel(item.text, promptBody(item.text, catalog));
      score.micro += answer.micro;
      const reading = finishReading(answer.output, {
        catalog,
        text: item.text,
        sentAt: new Date(),
        truncated: false,
        bigOrderPaise: 15000000,
      });
      if (reading.intent === item.intent) score.intent++;
      const same =
        reading.lines.length === item.lines.length &&
        item.lines.every((line) =>
          reading.lines.some(
            (read) => read.productId === line.productId && read.quantity === line.quantity,
          ),
        );
      if (same) score.lines++;
      if (reading.band === 'GREEN') {
        score.green++;
        if (same) score.greenRight++;
      }
    } catch {
      score.failed++;
    }
  }
  const percent = (part: number, whole: number) =>
    whole ? `${((part * 100) / whole).toFixed(1)}%` : '-';
  console.log(
    JSON.stringify(
      {
        model,
        promptVersion,
        messages: score.total,
        readByRules: score.byRules,
        failed: score.failed,
        intent: percent(score.intent, score.total),
        linesExact: percent(score.lines, score.total),
        greenExact: percent(score.greenRight, score.green),
        costUsd: (score.micro / 1_000_000).toFixed(4),
      },
      null,
      2,
    ),
  );
}
void main();
