import sharp from 'sharp';
import type { Prisma } from '@prisma/client';
import { RateStorage } from './rate-studio/storage';
import { getConfig } from './config';
import { fail } from './http';

export async function productPhoto(bytes: Buffer, contentType: string) {
  if (!Buffer.isBuffer(bytes)) fail('INVALID_IMAGE', 'Upload image bytes.');
  await new RateStorage().validate(bytes, contentType);
  try {
    // Re-encoding removes metadata, trailing payloads and the original container.
    return await sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'warning' })
      .timeout({ seconds: 5 })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    fail('INVALID_IMAGE', 'Choose an undamaged single-frame photo under 20 megapixels.');
  }
}

export async function approvedAssets(tx: Prisma.TransactionClient, images: string[]) {
  for (const value of images) {
    const base = getConfig().R2_PUBLIC_URL;
    let valid = false;
    try {
      const url = new URL(value);
      valid =
        !!base &&
        url.origin === new URL(base).origin &&
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        /^\/products\/[a-f0-9-]{36}\.webp$/.test(url.pathname);
    } catch {
      /* Reject malformed URLs with the same public error. */
    }
    if (!valid || !(await tx.productAsset.findUnique({ where: { url: value } })))
      fail('UNAPPROVED_ASSET', 'Upload a validated photo to store storage before publishing it.');
  }
}
