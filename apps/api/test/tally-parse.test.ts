import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
  answerLimits,
  cleanText,
  decodeEscapes,
  FlatRows,
  readAnswer,
  readCompanyList,
  readSmall,
  TallyAnswerError,
} from '../src/tally/parse';

const utf16 = (text: string) => Buffer.from(text, 'utf16le');
const part = (text: string | Buffer) => gzipSync(typeof text === 'string' ? utf16(text) : text);
const voucher = (...cells: string[]) =>
  cells
    .map((cell, index) => {
      const tag = `F${String(index + 1).padStart(2, '0')}`;
      return `<${tag}>${cell}</${tag}>`;
    })
    .join('');
const refusedWith = async (run: () => Promise<unknown>, problem: string) => {
  const error = await run().catch((caught) => caught);
  expect(error).toBeInstanceOf(TallyAnswerError);
  expect((error as TallyAnswerError).problem).toBe(problem);
};

describe('the shapes Tally answers in', () => {
  it('reads flat rows, where F01 starts each row', async () => {
    const rows = await readAnswer('groups', [
      part(
        `<ENVELOPE>\n${voucher('g1', '5', 'Debtors', 'Assets')}\n${voucher('g2', '6', 'Sales', '')}\n</ENVELOPE>`,
      ),
    ]);
    expect(rows).toEqual([
      { guid: 'g1', alterId: '5', name: 'Debtors', parent: 'Assets' },
      { guid: 'g2', alterId: '6', name: 'Sales', parent: '' },
    ]);
  });
  it('an empty envelope is no rows, not an error', async () => {
    expect(await readAnswer('groups', [part('<ENVELOPE></ENVELOPE>')])).toEqual([]);
    expect(await readAnswer('groups', [part('<ENVELOPE>\n\n</ENVELOPE>\n')])).toEqual([]);
  });
  it('takes UTF-16 with a mark, without one, and plain UTF-8', async () => {
    const body = `<ENVELOPE>${voucher('g1', '5', 'शिव ट्रेडर्स', '')}</ENVELOPE>`;
    const expected = [{ guid: 'g1', alterId: '5', name: 'शिव ट्रेडर्स', parent: '' }];
    expect(await readAnswer('groups', [part(body)])).toEqual(expected);
    expect(
      await readAnswer('groups', [
        gzipSync(Buffer.concat([Buffer.from([0xff, 0xfe]), utf16(body)])),
      ]),
    ).toEqual(expected);
    expect(await readAnswer('groups', [gzipSync(Buffer.from(body, 'utf8'))])).toEqual(expected);
  });
  it('refuses big-endian UTF-16 rather than reading it as rubbish', async () => {
    await refusedWith(
      () => readAnswer('groups', [gzipSync(Buffer.from([0xfe, 0xff, 0, 0x3c]))]),
      'BAD_ENCODING',
    );
  });
  it('reads an answer cut anywhere: mid-tag, mid-letter, mid-surrogate, in any number of parts', async () => {
    const body = `<ENVELOPE>${voucher('g1', '5', 'राम 😀 & Co &amp; Sons', 'x')}${voucher('g2', '6', 'B', 'y')}</ENVELOPE>`;
    const bytes = utf16(body);
    for (const size of [1, 2, 3, 7, 19, 64]) {
      const parts: Buffer[] = [];
      for (let at = 0; at < bytes.length; at += size)
        parts.push(gzipSync(bytes.subarray(at, at + size)));
      const rows = await readAnswer('groups', parts);
      expect(rows.map((row) => row.name)).toEqual(['राम 😀 & Co & Sons', 'B']);
    }
  });
  it('a blank field and a missing field both read as empty', async () => {
    const rows = await readAnswer('groups', [
      part('<ENVELOPE><F01>g1</F01><F02/><F03></F03></ENVELOPE>'),
    ]);
    expect(rows[0]).toEqual({ guid: 'g1', alterId: '', name: '', parent: '' });
  });
  it('ignores the blank field the plan’s exploded lines carry', async () => {
    const rows = await readAnswer('voucherLines', [
      part(
        `<ENVELOPE><FLDBLANK></FLDBLANK>${voucher('v1', 'Cash', '-100.00')}<FLDBLANK></FLDBLANK>${voucher('v1', 'Sales', '100.00')}</ENVELOPE>`,
      ),
    ]);
    expect(rows.map((row) => row.ledger)).toEqual(['Cash', 'Sales']);
  });
  it('an xml declaration and a comment are harmless', async () => {
    const rows = await readAnswer('groups', [
      part(
        '<?xml version="1.0" encoding="utf-16"?><!-- hello --><ENVELOPE><F01>g1</F01></ENVELOPE>',
      ),
    ]);
    expect(rows).toHaveLength(1);
  });
  it('more fields than the read has are dropped, not trusted', async () => {
    const rows = await readAnswer('voucherTypes', [
      part(`<ENVELOPE>${voucher('t1', 'Sales', 'Sales', 'EXTRA')}</ENVELOPE>`),
    ]);
    expect(rows[0]).toEqual({ guid: 't1', name: 'Sales', parent: 'Sales' });
  });
  it('reads a count', async () => {
    expect(
      await readSmall('count', part('<ENVELOPE><F01>42</F01></ENVELOPE>').toString('base64')),
    ).toEqual([{ count: '42' }]);
  });
  it('reads Tally’s own list of companies for names, and nothing else', async () => {
    const list = part(
      '<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="A &amp; B"><NAME>A &amp; B</NAME></COMPANY><COMPANY NAME="राम"/></COLLECTION></DATA></BODY></ENVELOPE>',
    );
    expect(await readCompanyList(list.toString('base64'))).toEqual(['A & B', 'राम']);
  });
});

describe('text inside a field', () => {
  it('turns the five escapes and numeric references into letters', () => {
    expect(decodeEscapes('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;')).toBe(
      `a & b <c> "d" 'e'`,
    );
    expect(decodeEscapes('&#2325;&#x915;')).toBe('कक');
  });
  it('drops Tally’s &#4; style control escapes', () => {
    expect(cleanText(decodeEscapes('&#4;Sales&#4; Account'))).toBe('Sales Account');
    expect(cleanText(decodeEscapes('&#13;&#10;Line'))).toBe('Line');
  });
  it('an escape that is no character at all reads as nothing', () => {
    expect(decodeEscapes('a&#xD800;b')).toBe('ab');
    expect(decodeEscapes('a&#1114112;b')).toBe('a b');
    expect(decodeEscapes('a&#0;b')).toBe('a b');
  });
  it('an unknown name never expands: it stays as the plain text it is', () => {
    expect(decodeEscapes('&lol9; &xxe;')).toBe('&lol9; &xxe;');
  });
  it('a name cannot disguise itself with hidden characters', () => {
    expect(cleanText('Evil\u202Egnp.exe')).toBe('Evilgnp.exe');
    expect(cleanText('A\u200BB')).toBe('AB');
    expect(cleanText('a\u0000b\u0007c')).toBe('abc');
  });
  it('keeps the joiners Hindi needs, and every script', () => {
    expect(cleanText('क्\u200Dया')).toBe('क्\u200Dया');
    expect(cleanText('  राम   सीमेंट  ')).toBe('राम सीमेंट');
  });
  it('a formula or a script is text, kept as written, and never run', async () => {
    const rows = await readAnswer('groups', [
      part(
        `<ENVELOPE>${voucher('g1', '5', '=HYPERLINK(&quot;http://x&quot;)', '&lt;script&gt;alert(1)&lt;/script&gt;')}</ENVELOPE>`,
      ),
    ]);
    expect(rows[0]!.name).toBe('=HYPERLINK("http://x")');
    expect(rows[0]!.parent).toBe('<script>alert(1)</script>');
  });
});

describe('answers that must not be trusted', () => {
  it('cut off: no closing envelope', async () => {
    await refusedWith(
      () => readAnswer('groups', [part(`<ENVELOPE>${voucher('g1', '5', 'A', 'B')}`)]),
      'CUT_OFF',
    );
    await refusedWith(() => readAnswer('groups', [part('')]), 'CUT_OFF');
    await refusedWith(() => readAnswer('groups', []), 'CUT_OFF');
    await refusedWith(() => readAnswer('groups', [part('<ENVELOPE><F01>half')]), 'CUT_OFF');
  });
  it('garbled tags', async () => {
    for (const body of [
      '<ENVELOPE><F01>a</F02></ENVELOPE>',
      '<ENVELOPE><F01><F02>nested</F02></F01></ENVELOPE>',
      '<ENVELOPE><F01>a</F01></WRONG>',
      '<ENVELOPE><<>>',
      '<ENVELOPE><1bad></1bad></ENVELOPE>',
      '<ENVELOPE></ENVELOPE><F01>after</F01>',
      '<ENVELOPE></ENVELOPE>trailing',
    ])
      await refusedWith(() => readAnswer('groups', [part(body)]), 'BAD_XML');
  });
  it('binary rubbish is not an envelope', async () => {
    await refusedWith(() => readAnswer('groups', [part('not xml at all')]), 'NOT_ENVELOPE');
    await refusedWith(
      () => readAnswer('groups', [part('<RESPONSE>Unknown Request</RESPONSE>')]),
      'NOT_ENVELOPE',
    );
  });
  it('a part that is not gzip', async () => {
    await refusedWith(() => readAnswer('groups', [Buffer.from('plain text')]), 'BAD_XML');
  });
  it('Tally’s own error, naming a company it does not have', async () => {
    await refusedWith(
      () =>
        readAnswer('groups', [
          part(
            "<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>0</STATUS></HEADER><BODY><DATA><LINEERROR>Could not set 'SVCurrentCompany' to 'X'</LINEERROR></DATA></BODY></ENVELOPE>",
          ),
        ]),
      'COMPANY_MISSING',
    );
  });
  it('any other error Tally writes', async () => {
    await refusedWith(
      () =>
        readAnswer('groups', [
          part('<ENVELOPE><BODY><LINEERROR>Something else broke</LINEERROR></BODY></ENVELOPE>'),
        ]),
      'TALLY_ERROR',
    );
  });
});

describe('attacks', () => {
  const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]><ENVELOPE><F01>&lol3;</F01></ENVELOPE>`;
  it('an XML bomb is refused at its first word', async () => {
    await refusedWith(() => readAnswer('groups', [part(laughs)]), 'XML_DTD_REFUSED');
  });
  it('an external entity is refused, and nothing is fetched or read', async () => {
    for (const body of [
      '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><ENVELOPE><F01>&xxe;</F01></ENVELOPE>',
      '<!DOCTYPE foo SYSTEM "http://169.254.169.254/latest/meta-data/"><ENVELOPE/>',
      '<ENVELOPE><!ENTITY xxe SYSTEM "file:///etc/passwd"><F01>&xxe;</F01></ENVELOPE>',
    ])
      await refusedWith(() => readAnswer('groups', [part(body)]), 'XML_DTD_REFUSED');
  });
  it('a DOCTYPE split across parts is still refused', async () => {
    const bytes = utf16(laughs);
    await refusedWith(
      () =>
        readAnswer('groups', [
          gzipSync(bytes.subarray(0, 50)),
          gzipSync(bytes.subarray(50, 90)),
          gzipSync(bytes.subarray(90)),
        ]),
      'XML_DTD_REFUSED',
    );
  });
  it('a DOCTYPE too long to hold is still refused, not misread', async () => {
    await refusedWith(
      () => readAnswer('groups', [part(`<!DOCTYPE x [${'a'.repeat(answerLimits.tagChars * 2)}`)]),
      'XML_DTD_REFUSED',
    );
  });
  it('an entity reference with no DTD stays as plain text', async () => {
    const rows = await readAnswer('groups', [
      part(`<ENVELOPE>${voucher('g1', '5', '&xxe;', '')}</ENVELOPE>`),
    ]);
    expect(rows[0]!.name).toBe('&xxe;');
  });
  it('a stylesheet instruction is refused', async () => {
    await refusedWith(
      () => readAnswer('groups', [part('<?xml-stylesheet href="http://evil"?><ENVELOPE/>')]),
      'BAD_XML',
    );
  });
  it('CDATA is refused', async () => {
    await refusedWith(
      () => readAnswer('groups', [part('<ENVELOPE><F01><![CDATA[x]]></F01></ENVELOPE>')]),
      'BAD_XML',
    );
  });
  it('a compression bomb stops at the cap for one part', async () => {
    const bomb = gzipSync(Buffer.alloc(answerLimits.partBytes + 1024, 0x20));
    expect(bomb.length).toBeLessThan(1024 * 1024);
    await refusedWith(() => readAnswer('groups', [bomb]), 'TOO_BIG');
  }, 30000);
  it('many small parts still stop at the cap for one answer', async () => {
    const blank = gzipSync(Buffer.alloc(answerLimits.partBytes, 0x20));
    const count = Math.ceil(answerLimits.answerBytes / answerLimits.partBytes) + 1;
    await refusedWith(
      () =>
        readAnswer(
          'groups',
          Array.from({ length: count }, () => blank),
        ),
      'TOO_BIG',
    );
  }, 60000);
  it('one enormous field is refused', async () => {
    await refusedWith(
      () =>
        readAnswer('groups', [
          part(`<ENVELOPE><F01>${'x'.repeat(answerLimits.fieldChars + 10)}</F01></ENVELOPE>`),
        ]),
      'FIELD_TOO_LONG',
    );
  });
  it('an enormous tag is refused', async () => {
    await refusedWith(
      () => readAnswer('groups', [part(`<ENVELOPE><F01 ${'a'.repeat(5000)}>x</F01></ENVELOPE>`)]),
      'BAD_XML',
    );
  });
  it('tags nested too deep are refused', async () => {
    const open = '<A>'.repeat(answerLimits.depth + 5);
    await refusedWith(() => readAnswer('groups', [part(`<ENVELOPE>${open}`)]), 'BAD_XML');
  });
  it('too many rows are refused', () => {
    const parser = new FlatRows(['guid']);
    const saved = answerLimits.rows;
    answerLimits.rows = 3;
    try {
      expect(() => parser.write(`<ENVELOPE>${'<F01>x</F01>'.repeat(10)}</ENVELOPE>`)).toThrow(
        TallyAnswerError,
      );
    } finally {
      answerLimits.rows = saved;
    }
  });
  it('a heartbeat’s small answer cannot be a bomb either', async () => {
    const bomb = gzipSync(Buffer.alloc(2 * 1024 * 1024, 0x20));
    await refusedWith(() => readSmall('companies', bomb.toString('base64')), 'TOO_BIG');
    await refusedWith(() => readCompanyList(bomb.toString('base64')), 'TOO_BIG');
  });
  it('the company list refuses a DTD as well', async () => {
    await refusedWith(
      () => readCompanyList(part('<!DOCTYPE x><ENVELOPE/>').toString('base64')),
      'XML_DTD_REFUSED',
    );
  });
});
