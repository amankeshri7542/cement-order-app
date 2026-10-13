// Isolated browser-test server. Never used by the production entry point.
import { RateProviders, RateProviderError } from '../src/rate-studio/providers';
import { createApp } from '../src/app';
import sharp from 'sharp';
async function main() {
  if (
    process.env.NODE_ENV !== 'test' ||
    !new URL(process.env.DATABASE_URL || '').pathname.endsWith('_test')
  )
    throw new Error('Mock provider server requires isolated test database.');
  process.env.GOOGLE_VISION_API_KEY = 'browser-fixture-only';
  process.env.OPENAI_API_KEY = 'browser-fixture-only';
  process.env.RATE_OPENAI_MODEL = 'browser-fixture-model';
  const app = await createApp();
  const provider = app.get(RateProviders);
  provider.ocr = async (bytes) => ({
    text:
      (await sharp(bytes).metadata()).width === 2
        ? 'FAIL_PROVIDER'
        : 'UltraTech Super PPC ₹480 per 50 kg bag',
    layout: [],
    usage: { images: 1 },
  });
  provider.interpret = async (text) => {
    if (text === 'FAIL_PROVIDER') throw new RateProviderError('INTERPRETATION_UNAVAILABLE');
    return {
      extraction: {
        rows: [
          {
            brand: 'UltraTech',
            product: 'UltraTech Super',
            category: 'Cement',
            size: null,
            specification: 'PPC',
            price: '480',
            unit: '50 kg bag',
            weight: null,
            effectiveDate: null,
            deliveryNotes: null,
            confidence: 0.45,
            sourceText: text,
            sourceReference: 'row 1',
          },
        ],
      },
      usage: { input_tokens: 10, output_tokens: 10 },
    };
  };
  await app.listen(Number(process.env.PORT || 4010), '127.0.0.1');
}
void main();
