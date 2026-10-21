import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/**
 * Loads one source file under Node, as the live-stream test does: transpiled to CommonJS and run
 * in its own context. `globals` supplies the timers or clock the file needs, and `modules` the
 * packages it imports (name -> module).
 */
export function loadTs(file, globals = {}, modules = {}) {
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const require = (name) => {
    if (!(name in modules)) throw new Error(`${file} imports ${name}; pass it in modules`);
    return modules[name];
  };
  runInNewContext(compiled, { exports, require, Promise, Number, Math, RegExp, ...globals });
  return exports;
}
