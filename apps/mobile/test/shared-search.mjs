import { loadTs } from './load-ts.mjs';

// The shared search code, loaded the way the phone's own files are, so tests run the exact source
// the app bundles. search-cases.ts is test data that lives beside it.
const shared = '../../packages/shared/src';
const glossary = loadTs(`${shared}/glossary.ts`);
const quantity = loadTs(`${shared}/quantity.ts`);
export const searchShared = loadTs(
  `${shared}/search-normalise.ts`,
  {},
  {
    './glossary': glossary,
    './quantity': quantity,
  },
);
export const { searchCatalogue, searchQueries } = loadTs(`${shared}/search-cases.ts`);
export const phoneSearch = loadTs('src/logic/search.ts', {}, { '@shiv/shared': searchShared });
