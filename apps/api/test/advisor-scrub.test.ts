import { describe, expect, it } from 'vitest';
import { cleanInput, questionKey, scrub } from '../src/advisor/scrub';

describe('scrubbing a question before it is stored or sent', () => {
  it.each([
    ['call me on 9876543210 please', 'call me on [removed] please'],
    ['+91 98765 43210', '[removed]'],
    ['+91-98765-43210', '[removed]'],
    ['098765 43210', '[removed]'],
    ['(0091) 98765 43210', '(0091) [removed]'],
    ['98.76.54.32.10', '[removed]'],
    ['ramesh@example.com par bhejo', '[removed] par bhejo'],
    ['upi ramesh@okhdfc', 'upi [removed]'],
    ['aadhaar 1234 5678 9012', 'aadhaar [removed]'],
    ['aadhaar 123456789012', 'aadhaar [removed]'],
    ['pan ABCDE1234F', 'pan [removed]'],
    ['gst 10ABCDE1234F1Z5', 'gst [removed]'],
    ['account 12345678901234', 'account [removed]'],
    ['landline 0612 2345678', 'landline [removed]'],
  ])('%s', (input, expected) => {
    expect(scrub(input)).toBe(expected);
  });
  it('catches a number written in Devanagari digits', () => {
    expect(scrub(cleanInput('मेरा नंबर ९८७६५४३२१० है'))).toBe('मेरा नंबर [removed] है');
  });
  it.each([
    ['delivery to 800020'],
    ['30 ft lambi, 10 ft oonchi, 9 inch deewar'],
    ['12 mm sariya, 500 bori'],
    ['1000 sq ft ki chhat'],
    ['2 baje utha lenge'],
  ])('leaves %s alone', (input) => {
    expect(scrub(input)).toBe(input);
  });
});

describe('cleaning what arrives', () => {
  it('removes invisible and control characters that could hide a word', () => {
    const hidden = `sar${String.fromCodePoint(0x200b)}iya${String.fromCodePoint(0x202e)} kitna${String.fromCodePoint(0)}`;
    expect(cleanInput(hidden)).toBe('sariya kitna');
  });
  it('folds lookalike characters and spacing', () => {
    expect(cleanInput('ｓａｒｉｙａ   kitna\n\nlagega')).toBe('sariya kitna lagega');
  });
  it('never returns more than its limit', () => {
    expect(cleanInput('x'.repeat(5000)).length).toBe(600);
  });
});

describe('the same question, for the cache', () => {
  it('ignores case, spacing and punctuation', () => {
    expect(questionKey('How do I store cement?', 'en')).toBe(
      questionKey('how do i  store cement', 'en'),
    );
  });
  it('a different language or words is a different question', () => {
    expect(questionKey('store cement', 'en')).not.toBe(questionKey('store cement', 'hinglish'));
    expect(questionKey('store cement', 'en')).not.toBe(questionKey('store sand', 'en'));
  });
});
