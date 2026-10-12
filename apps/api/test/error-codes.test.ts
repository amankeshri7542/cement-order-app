import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { errorCodes } from '@shiv/shared';

// The app and website translate errors from the shared catalogue. A new code thrown by the API
// must be added there (with Hindi text if customers can see it) or this test fails.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('error code catalogue', () => {
  it('contains every code the API throws', () => {
    const thrown = new Set<string>();
    for (const file of sources(join(__dirname, '../src'))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/fail\(\s*'([A-Z_]+)'/g)) thrown.add(match[1]!);
      for (const match of text.matchAll(/\bcode: '([A-Z_]+)'/g)) thrown.add(match[1]!);
    }
    expect(thrown.size).toBeGreaterThan(50);
    const known = new Set<string>(errorCodes);
    expect([...thrown].filter((code) => !known.has(code)).sort()).toEqual([]);
  });
});
