import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { tallyColumns, type TallyReadName } from '@shiv/shared';

/**
 * Reads Tally's answers. Tally's own reports come back flat: <F01>..</F01><F02>..</F02><F01>.. inside
 * one ENVELOPE. So this is a small streaming scanner, not a general XML parser: it never builds a
 * tree, and it has no notion of a DTD, so an entity can never expand and nothing outside the answer
 * can ever be fetched. It refuses a DOCTYPE outright, and takes no text it was not asked for.
 */
export type AnswerProblem =
  | 'XML_DTD_REFUSED'
  | 'BAD_XML'
  | 'BAD_ENCODING'
  | 'CUT_OFF'
  | 'TOO_BIG'
  | 'TOO_MANY_ROWS'
  | 'FIELD_TOO_LONG'
  | 'TALLY_ERROR'
  | 'COMPANY_MISSING'
  | 'NOT_ENVELOPE';
export class TallyAnswerError extends Error {
  constructor(readonly problem: AnswerProblem) {
    super(problem);
  }
}

export type Row = Record<string, string>;
export const answerLimits = {
  /** Plan 10: a compression bomb stops here. Each gzip part unpacks to at most this. */
  partBytes: 64 * 1024 * 1024,
  /** One answer across all its parts. */
  answerBytes: 256 * 1024 * 1024,
  rows: 250_000,
  fieldChars: 8192,
  tagChars: 1024,
  depth: 16,
};

const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Character escapes only. An unknown name stays as plain text: it can never expand. */
export function decodeEscapes(raw: string) {
  return raw.replace(
    /&(#[xX][0-9a-fA-F]{1,8}|#\d{1,10}|[a-zA-Z]{1,8});/g,
    (whole, body: string) => {
      if (body[0] !== '#') return named[body] ?? whole;
      const code = /^#[xX]/.test(body) ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      // Tally writes &#4; and the like into text. They mean nothing, as the community loader found.
      if (!Number.isInteger(code) || code < 32 || code > 0x10ffff) return ' ';
      if (code >= 0xd800 && code <= 0xdfff) return '';
      return String.fromCodePoint(code);
    },
  );
}
/**
 * The same rule as the desk's plainText: no control, direction-override or zero-width character that
 * could disguise a name, keeping the two joiners Hindi keyboards need. Letters of any script stay.
 */
export const cleanText = (text: string) =>
  text
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[^\P{C}\u200C\u200D]/gu, '')
    .replace(/ {2,}/g, ' ')
    .trim();

const COMPANY_ERROR = /SVCurrentCompany|company/i;

/** Feed it text in pieces, in order. Every <Fnn> becomes a cell, and F01 starts a new row. */
export class FlatRows {
  readonly rows: Row[] = [];
  private buffer = '';
  private stack: string[] = [];
  private cell: { index: number; text: string } | null = null;
  private row: Row | null = null;
  private lineError: string | null = null;
  private inLineError = false;
  private ended = false;
  private rooted = false;

  constructor(private columns: readonly string[]) {}

  write(text: string) {
    this.buffer += text;
    let at = 0;
    for (;;) {
      const open = this.buffer.indexOf('<', at);
      if (open < 0) {
        this.text(this.buffer.slice(at));
        at = this.buffer.length;
        break;
      }
      this.text(this.buffer.slice(at, open));
      at = open;
      if (this.buffer.startsWith('<!--', open)) {
        const end = this.buffer.indexOf('-->', open + 4);
        if (end < 0) {
          if (this.buffer.length - open > answerLimits.tagChars * 16)
            throw new TallyAnswerError('BAD_XML');
          break;
        }
        at = end + 3;
        continue;
      }
      const close = this.buffer.indexOf('>', open);
      if (close < 0) {
        if (this.buffer.length - open > answerLimits.tagChars) {
          if (/^<!(DOCTYPE|ENTITY)/i.test(this.buffer.slice(open, open + 10)))
            throw new TallyAnswerError('XML_DTD_REFUSED');
          throw new TallyAnswerError('BAD_XML');
        }
        // A partial "<!DOCTYPE" is refused the moment its name is whole.
        if (/^<!(DOCTYPE|ENTITY)/i.test(this.buffer.slice(open, open + 10)))
          throw new TallyAnswerError('XML_DTD_REFUSED');
        break;
      }
      if (close - open > answerLimits.tagChars) {
        if (/^<!(DOCTYPE|ENTITY)/i.test(this.buffer.slice(open, open + 10)))
          throw new TallyAnswerError('XML_DTD_REFUSED');
        throw new TallyAnswerError('BAD_XML');
      }
      this.tag(this.buffer.slice(open + 1, close));
      at = close + 1;
    }
    this.buffer = this.buffer.slice(at);
    if (this.cell && this.cell.text.length > answerLimits.fieldChars)
      throw new TallyAnswerError('FIELD_TOO_LONG');
  }

  private text(text: string) {
    if (!text) return;
    if (this.ended && /\S/.test(text)) throw new TallyAnswerError('BAD_XML');
    if (this.cell) {
      this.cell.text += text;
      if (this.cell.text.length > answerLimits.fieldChars)
        throw new TallyAnswerError('FIELD_TOO_LONG');
    } else if (this.inLineError && (this.lineError ?? '').length < 400) {
      this.lineError = (this.lineError ?? '') + text;
    } else if (!this.stack.length && /\S/.test(text)) throw new TallyAnswerError('NOT_ENVELOPE');
  }

  private tag(body: string) {
    if (body.startsWith('?')) {
      if (!/^\?xml\s/i.test(body) || !body.endsWith('?')) throw new TallyAnswerError('BAD_XML');
      return;
    }
    if (body.startsWith('!')) {
      if (/^!(DOCTYPE|ENTITY|ELEMENT|ATTLIST|NOTATION)/i.test(body))
        throw new TallyAnswerError('XML_DTD_REFUSED');
      throw new TallyAnswerError('BAD_XML');
    }
    if (this.ended) throw new TallyAnswerError('BAD_XML');
    if (body.startsWith('/')) {
      const name = body.slice(1).trim();
      if (this.stack.pop() !== name) throw new TallyAnswerError('BAD_XML');
      if (this.cell && /^F\d{2,3}$/.test(name)) {
        this.finishCell();
      } else if (name === 'LINEERROR') this.inLineError = false;
      if (!this.stack.length) this.ended = true;
      return;
    }
    const selfClosed = body.endsWith('/');
    const match = /^([A-Za-z_][A-Za-z0-9_.:-]*)(\s[^<]*)?$/.exec(
      selfClosed ? body.slice(0, -1) : body,
    );
    if (!match) throw new TallyAnswerError('BAD_XML');
    const name = match[1]!;
    if (!this.rooted) {
      this.rooted = true;
      if (name !== 'ENVELOPE') throw new TallyAnswerError('NOT_ENVELOPE');
    }
    if (this.cell) throw new TallyAnswerError('BAD_XML');
    if (this.stack.length >= answerLimits.depth) throw new TallyAnswerError('BAD_XML');
    const field = /^F(\d{2,3})$/.exec(name);
    if (field) {
      const index = Number(field[1]);
      if (index === 1) this.startRow();
      if (!selfClosed) this.cell = { index, text: '' };
      else if (!this.row) this.startRow();
    }
    if (name === 'LINEERROR' && !selfClosed) this.inLineError = true;
    if (!selfClosed) this.stack.push(name);
    else if (!this.stack.length) this.ended = true;
  }

  private startRow() {
    this.pushRow();
    this.row = {};
  }
  private pushRow() {
    if (!this.row) return;
    if (this.rows.length >= answerLimits.rows) throw new TallyAnswerError('TOO_MANY_ROWS');
    for (const column of this.columns) this.row[column] ??= '';
    this.rows.push(this.row);
    this.row = null;
  }
  private finishCell() {
    const { index, text } = this.cell!;
    this.cell = null;
    if (!this.row) this.row = {};
    const column = this.columns[index - 1];
    if (column) this.row[column] = cleanText(decodeEscapes(text));
  }

  /** Answers end with </ENVELOPE>, or they are not to be trusted (plan 09, checks on every answer). */
  end() {
    if (this.lineError !== null)
      throw new TallyAnswerError(
        COMPANY_ERROR.test(this.lineError) ? 'COMPANY_MISSING' : 'TALLY_ERROR',
      );
    if (!this.ended) throw new TallyAnswerError('CUT_OFF');
    this.pushRow();
    return this.rows;
  }
}

const unzip = promisify(gunzip);
/** Tally answers in the request's encoding, which is UTF-16. A BOM may or may not be there. */
function decoderFor(head: Buffer) {
  if (head[0] === 0xfe && head[1] === 0xff) throw new TallyAnswerError('BAD_ENCODING');
  if (head[0] === 0xff && head[1] === 0xfe)
    return new TextDecoder('utf-16le', { ignoreBOM: false });
  if (head[1] === 0 && head[0] !== 0) return new TextDecoder('utf-16le', { ignoreBOM: false });
  return new TextDecoder('utf-8', { ignoreBOM: false });
}

export async function unzipPart(part: Buffer) {
  try {
    return await unzip(part, { maxOutputLength: answerLimits.partBytes });
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE')
      throw new TallyAnswerError('TOO_BIG');
    throw new TallyAnswerError('BAD_XML');
  }
}

/** Rows from one whole answer, given its gzip parts in order. Yields to other work between parts. */
export async function readAnswer(
  read: TallyReadName | 'count',
  parts: AsyncIterable<Buffer> | Iterable<Buffer>,
) {
  const parser = new FlatRows(tallyColumns[read]);
  let decoder: TextDecoder | null = null;
  let head: Buffer = Buffer.alloc(0);
  let total = 0;
  for await (const part of parts) {
    const raw = await unzipPart(part);
    total += raw.length;
    if (total > answerLimits.answerBytes) throw new TallyAnswerError('TOO_BIG');
    // The encoding shows in the first two bytes, and a part may be shorter than that.
    head = head.length < 2 ? Buffer.concat([head, raw]) : head;
    if (!decoder && head.length < 2) continue;
    const fresh: Buffer = decoder ? raw : head;
    decoder ??= decoderFor(head);
    for (let at = 0; at < fresh.length; at += 1 << 20) {
      parser.write(decoder.decode(fresh.subarray(at, at + (1 << 20)), { stream: true }));
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  if (decoder) parser.write(decoder.decode());
  else if (head.length) parser.write(head.toString('latin1'));
  return parser.end();
}

/** A small answer carried in a heartbeat or a finish, gzipped and in base64. */
export async function readSmall(read: TallyReadName | 'count', base64: string) {
  const part = Buffer.from(base64, 'base64');
  const raw = await unzipPart(part);
  if (raw.length > 1 << 20) throw new TallyAnswerError('TOO_BIG');
  const parser = new FlatRows(tallyColumns[read]);
  const decoder = decoderFor(raw);
  parser.write(decoder.decode(raw));
  return parser.end();
}

/** "List of Companies" comes back as ordinary tags, not flat rows: names only are all we want. */
export async function readCompanyList(base64: string) {
  const raw = await unzipPart(Buffer.from(base64, 'base64'));
  if (raw.length > 1 << 20) throw new TallyAnswerError('TOO_BIG');
  const text = decoderFor(raw).decode(raw);
  if (/<!(DOCTYPE|ENTITY)/i.test(text)) throw new TallyAnswerError('XML_DTD_REFUSED');
  return [...text.matchAll(/<COMPANY\s+NAME="([^"<]{1,300})"/g)].map((match) =>
    cleanText(decodeEscapes(match[1]!)),
  );
}
