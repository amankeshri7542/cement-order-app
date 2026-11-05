import { readFileSync } from 'node:fs';
import ts from 'typescript';

/**
 * Loads one source file under Node: transpiled to CommonJS and run in this realm, so arrays and
 * objects it returns compare equal to the test's own. `globals` supplies the timers or clock the file needs, and `modules` the
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
  const names = Object.keys(globals);
  new Function('exports', 'require', ...names, compiled)(
    exports,
    require,
    ...names.map((name) => globals[name]),
  );
  return exports;
}
