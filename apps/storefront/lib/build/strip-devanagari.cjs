// Webpack loader: empties every string literal holding Hindi script in the shared package, so the
// bundles this website ships carry none. English text and the code around it are untouched.
const HINDI = /[ऀ-ॿ]/;

/** Index just past the literal starting at `at`, or -1 for a lone quote that ends with its line. */
function endOfString(source, at) {
  const quote = source[at];
  for (let i = at + 1; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      i++;
    } else if (quote === '`' && c === '$' && source[i + 1] === '{') {
      i = endOfExpression(source, i + 2) - 1;
    } else if (c === quote) {
      return i + 1;
    } else if (c === '\n' && quote !== '`') {
      return -1;
    }
  }
  return -1;
}
/** Index just past the } closing a template's ${ ... }. */
function endOfExpression(source, at) {
  let depth = 1;
  for (let i = at; i < source.length; i++) {
    const c = source[i];
    if (c === "'" || c === '"' || c === '`') {
      const end = endOfString(source, i);
      if (end > 0) i = end - 1;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return source.length;
}

module.exports = function stripDevanagari(source) {
  if (!HINDI.test(source)) return source;
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end < 0 ? source.length : end;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      const end = endOfString(source, i);
      if (end < 0) {
        out += c;
        i++;
      } else {
        const literal = source.slice(i, end);
        out += HINDI.test(literal) ? "''" : literal;
        i = end;
      }
    } else {
      out += c;
      i++;
    }
  }
  // What is left is code, such as a regular expression: the same meaning, written in escapes.
  return out.replace(
    /[\u0900-\u097F]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
};
