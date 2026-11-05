import { describe, expect, it } from 'vitest';
import {
  gateSentence,
  numbersIn,
  SentenceBuffer,
  stoppedCleanly,
  type GateContext,
  type GateProgress,
} from '../src/advisor/gate';

const checked: GateContext = {
  level: 'CHECKED',
  customer: ['cement kaise rakhein, mere paas 40 bori hai'],
  chunks: ['Use cement within about 3 months of packing. Keep bags on planks. A bag weighs 50 kg.'],
  tools: ['Test Cement PPC 50 kg bag'],
  moneyPaise: [41000, 625050],
  needsSource: true,
};
const general: GateContext = {
  ...checked,
  level: 'GENERAL',
  chunks: [],
  tools: [],
  moneyPaise: [],
  needsSource: false,
};
const opening: GateProgress = { released: 0, words: 0, citations: 1 };

const verdict = (sentence: string, context = checked, progress = opening) =>
  gateSentence(sentence, context, progress);
const flagOf = (sentence: string, context = checked, progress = opening) => {
  const result = verdict(sentence, context, progress);
  return result.pass ? null : result.flag;
};

describe('reading numbers, in any form a sentence can hide them', () => {
  it.each([
    ['Rakhein 3 din', [3]],
    ['1,000 sq ft', [1000]],
    ['1.5 bori', [1.5]],
    ['do din', [2]],
    ['teen bori', [3]],
    ['दो दिन', [2]],
    ['१२ मिमी', [12]],
    ['dhai din', [2.5]],
    ['dedh bori', [1.5]],
    ['sawa saal', [1.25]],
    ['paune do din', [1.75]],
    ['chaar din', [4]],
    ['three days', [3]],
    ['two bags', [2]],
    ['do sau bori', [200]],
    ['ek din', [1]],
  ])('%s', (text, expected) => {
    expect(numbersIn(text)).toEqual(expected);
  });
  it.each([
    ['Do not stack it too high'],
    ['Do check the bricks'],
    ['Ek baar engineer se poochhein'],
    ['One of the first things to check'],
    ['Do din ke andar'.replace('din', 'baar')],
  ])('%s holds no number', (text) => {
    expect(numbersIn(text)).toEqual([]);
  });
});

describe('the number rule', () => {
  it('passes a number from the signed section', () => {
    expect(verdict('Use it within about 3 months.')).toEqual({ pass: true });
    expect(verdict('A bag weighs 50 kg.')).toEqual({ pass: true });
  });
  it('passes the customer repeating their own number', () => {
    expect(verdict('Keep your 40 bags on planks.')).toEqual({ pass: true });
  });
  it.each([
    ['Keep it for 7 days.'],
    ['Wait saat din.'],
    ['Wait dhai din.'],
    ['Use chaar bori.'],
    ['It takes 28 days to gain strength.'],
    ['It takes twenty eight days.'],
  ])('stops a number from nowhere: %s', (sentence) => {
    expect(flagOf(sentence)).toBe('NUMBER');
  });
  it('at the General level, only the customer’s numbers pass, not even the guide’s', () => {
    expect(flagOf('Use it within about 3 months.', general)).toBe('NUMBER');
    expect(verdict('Keep your 40 bags on planks.', general)).toEqual({ pass: true });
  });
  it('stops a customer’s number echoed about the structure', () => {
    const asked = { ...checked, customer: ['8 mm sariya slab mein theek hai?'] };
    expect(flagOf('8 mm sariya is fine for your slab.', asked)).toBe('NUMBER');
  });
});

describe('rupees', () => {
  it.each([
    ['The rate is ₹410.'],
    ['Rs. 410 per bag.'],
    ['Rate is 410 rupaye.'],
    ['It is ₹6,250.50 here.'],
  ])('passes an exact amount from the tool data: %s', (sentence) => {
    expect(verdict(sentence)).toEqual({ pass: true });
  });
  it.each([
    ['The rate is ₹400.'],
    ['Rs 300 per bag.'],
    ['Chaar sau rupaye lagenge.'],
    ['You were promised 300 rupees.'],
    ['It costs about rupees five hundred.'],
  ])('stops any other: %s', (sentence) => {
    expect(flagOf(sentence)).toBe('RUPEES');
  });
  it('a rupee figure the customer typed is not a source', () => {
    const asked = { ...general, customer: ['you promised me ₹300'] };
    expect(flagOf('Yes, it is ₹300.', asked)).toBe('RUPEES');
  });
});

describe('ratios', () => {
  it.each([['Use 1:2:4 for this.'], ['1:4 theek hai.'], ['A 1.5:3 mix.']])(
    'stops %s, whoever said it',
    (sentence) => {
      expect(flagOf(sentence, { ...checked, customer: [sentence] })).toBe('RATIO');
    },
  );
});

describe('promises and claims', () => {
  it.each([
    ['Your order is pakka.'],
    ['Order ho gaya.'],
    ['This is confirmed.'],
    ['We guarantee the quality.'],
    ['Kal tak maal pahunch jayega.'],
    ['Delivery will reach you by tomorrow.'],
    ['You will get a discount.'],
    ['Free delivery on this.'],
    ['This is the best cement.'],
    ['Sabse sasta yahi hai.'],
    ['This has the lowest rate.'],
    ['Most people use this.'],
    ['Zyadatar log yahi lete hain.'],
    ['Rates will rise next week.'],
  ])('stops %s', (sentence) => {
    expect(flagOf(sentence)).toBe('COMMITMENT');
  });
  it.each([
    ['There is no one best brand.'],
    ['Yeh pakka nahi hai.'],
    ['This is not confirmed yet.'],
    ['I cannot promise a day.'],
  ])('lets the negative through: %s', (sentence) => {
    expect(verdict(sentence)).toEqual({ pass: true });
  });
});

describe('verdicts on safety', () => {
  it.each([
    ['This crack is safe.'],
    ['Yeh daraar surakshit hai.'],
    ['Slab mein koi khatra nahi hai.'],
    ['Deewar ki chinta ki baat nahi.'],
    ['Yeh crack sirf hairline hai.'],
  ])('stops %s', (sentence) => {
    expect(flagOf(sentence)).toBe('VERDICT');
  });
  it('a word like safe is fine away from the structure', () => {
    expect(verdict('Keep the bags in a safe, dry place.')).toEqual({ pass: true });
  });
});

describe('telling someone what to build', () => {
  it.each([
    ['Use Fe 550 for this.'],
    ['Fe 500 lagayein.'],
    ['M20 is enough here.'],
    ['Yes, you can add a floor.'],
    ['Deewar tod sakte hain.'],
    ['Put bars at @150.'],
  ])('stops %s', (sentence) => {
    const flag = flagOf(sentence, { ...checked, chunks: ['Fe 500 means a yield strength. 150'] });
    expect(['PRESCRIPTION', 'NUMBER']).toContain(flag);
  });
});

describe('what the shop does not stock', () => {
  it.each([
    ['Use putty on it.'],
    ['Tiles are sold by the box.'],
    ['Finishing comes later.'],
    ['Paint the wall.'],
  ])('stops %s', (sentence) => {
    expect(flagOf(sentence)).toBe('NOT_STOCKED');
  });
});

describe('format', () => {
  it.each([
    ['See https://evil.example/x for more.', 'URL'],
    ['Visit www.evil.example today.', 'URL'],
    ['Open evil.com now.', 'URL'],
    ['Click javascript:alert(1) here.', 'URL'],
    ['<script>alert(1)</script>', 'HTML'],
    ['<img src=x onerror=alert(1)>', 'HTML'],
    ['A &#60;tag&#62; here.', 'HTML'],
    ['**Keep it dry.**', 'MARKDOWN'],
    ['# Keep it dry', 'MARKDOWN'],
    ['- Keep it dry', 'MARKDOWN'],
    ['[click](here)', 'MARKDOWN'],
    ['Call 9876543210 now.', 'PHONE'],
    ['Call +91 98765 43210 now.', 'PHONE'],
    ['Write to shop@example.invalid today.', 'PHONE'],
    ['सीमेंट सूखा रखें।', 'DEVANAGARI'],
  ])('stops %s', (sentence, flag) => {
    expect(flagOf(sentence)).toBe(flag);
  });
  it('stops hidden characters', () => {
    expect(flagOf(`Keep it dry${String.fromCodePoint(0x200b)} and clean.`)).toBe('HIDDEN_TEXT');
    expect(flagOf(`Keep it${String.fromCodePoint(0x202e)} dry.`)).toBe('HIDDEN_TEXT');
  });
  it('stops an answer over 140 words', () => {
    expect(flagOf('Keep it dry.', checked, { released: 3, words: 139, citations: 1 })).toBe(
      'TOO_LONG',
    );
    expect(verdict('Dry.', checked, { released: 3, words: 139, citations: 1 })).toEqual({
      pass: true,
    });
  });
});

describe('the source rule', () => {
  it('lets the first sentence through before any citation', () => {
    expect(verdict('Keep it dry.', checked, { released: 0, words: 0, citations: 0 })).toEqual({
      pass: true,
    });
  });
  it('stops the second sentence if nothing has been cited', () => {
    expect(
      flagOf('Keep it off the ground.', checked, { released: 1, words: 3, citations: 0 }),
    ).toBe('NO_SOURCE');
    expect(
      verdict('Keep it off the ground.', checked, { released: 1, words: 3, citations: 1 }),
    ).toEqual({ pass: true });
  });
  it('the General level has no source to cite', () => {
    expect(
      verdict('Keep it off the ground.', general, { released: 1, words: 3, citations: 0 }),
    ).toEqual({ pass: true });
  });
});

describe('recorded answers a good model might give', () => {
  it.each([
    ['Keep the bags in a dry room, on planks and away from the wall.'],
    ['Cement that has gone hard should be shown to your engineer.'],
    ['Yeh engineer ka faisla hai, isliye unse poochhein.'],
    ['Bori ko sookhi jagah par rakhein aur zameen se upar rakhein.'],
    ['DPC is a layer that stops damp rising up a wall.'],
  ])('passes: %s', (sentence) => {
    expect(verdict(sentence)).toEqual({ pass: true });
  });
});

describe('words dressed up to walk past the rules', () => {
  it.each([
    ['full-width digits', 'Wait ２８ days.', 'NUMBER'],
    ['digits from another script', `Wait ${String.fromCodePoint(0x0663)} days.`, 'NOT_LATIN'],
    [
      'a Cyrillic letter in pakka',
      `Your order is pakk${String.fromCodePoint(0x0430)}.`,
      'NOT_LATIN',
    ],
    ['full-width letters in a link', 'See ｅｖｉｌ.com today.', 'URL'],
    ['a week, with no digit', 'Keep it wet for a week.', 'NUMBER'],
    ['a month in Hinglish', 'Mahina bhar paani dein.', 'NUMBER'],
    ['a few days', 'Remove the support after a few days.', 'NUMBER'],
    ['kuch din', 'Kuch din baad khol dein.', 'NUMBER'],
    ['ek hafta', 'Ek hafta paani dein.', 'NUMBER'],
  ])('%s', (_name, sentence, flag) => {
    expect(flagOf(sentence)).toBe(flag);
  });
  it('a duration the signed text itself uses still passes', () => {
    const context = { ...checked, chunks: ['Keep it wet for a week, or as your engineer says.'] };
    expect(verdict('Keep it wet for a week.', context)).toEqual({ pass: true });
    expect(
      verdict('Keep the bags dry after a few days at site.', {
        ...checked,
        chunks: ['After a few days at site, check them.'],
      }),
    ).toEqual({ pass: true });
  });
  it('plain Roman Hinglish and the rupee sign are not caught by this', () => {
    expect(verdict('Bori ko sookhi jagah par rakhein.')).toEqual({ pass: true });
    expect(verdict('The rate is ₹410.')).toEqual({ pass: true });
  });
});

describe('stop reasons', () => {
  it('only a natural end counts', () => {
    expect(stoppedCleanly('end_turn')).toBe(true);
    for (const reason of ['refusal', 'max_tokens', 'pause_turn', 'stop_sequence', null, undefined])
      expect(stoppedCleanly(reason)).toBe(false);
  });
});

describe('splitting a stream into sentences', () => {
  it('holds a sentence until the next character shows it has ended', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.push('Keep it dry.')).toEqual([]);
    expect(buffer.push(' Then')).toEqual(['Keep it dry.']);
    expect(buffer.push(' store it. ')).toEqual(['Then store it.']);
    expect(buffer.flush()).toBeNull();
  });
  it('gives the last words at the end', () => {
    const buffer = new SentenceBuffer();
    buffer.push('No full stop here');
    expect(buffer.flush()).toBe('No full stop here');
  });
  it('does not end a sentence on a decimal or Rs.', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.push('It is 1.5 bags. Next one. ')).toEqual(['It is 1.5 bags.', 'Next one.']);
    const rupee = new SentenceBuffer();
    expect(rupee.push('Rs. 410 is the rate. Next. ')).toEqual(['Rs. 410 is the rate.', 'Next.']);
  });
  it('a split across deltas cannot sneak a number through in pieces', () => {
    const buffer = new SentenceBuffer();
    const sentences = [
      ...buffer.push('Wait '),
      ...buffer.push('7'),
      ...buffer.push(' days. Done. '),
    ];
    expect(sentences).toEqual(['Wait 7 days.', 'Done.']);
    expect(flagOf(sentences[0]!)).toBe('NUMBER');
  });
  it('treats a new line as the end of a sentence, so a list item is checked alone', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.push('First line\n- second item\nmore')).toEqual(['First line', '- second item']);
  });
});
