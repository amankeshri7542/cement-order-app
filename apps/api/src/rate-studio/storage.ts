import { Injectable } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { fail } from '../http';

const maxBytes = 5 * 1024 * 1024;
const maxPixels = 20_000_000;
const extensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const localDirectory = resolve(process.cwd(), '.local/rate-sources');

@Injectable()
export class RateStorage {
  async validate(bytes: Buffer, claimedType: string) {
    if (!bytes.length || bytes.length > maxBytes)
      fail('RATE_SOURCE_SIZE', 'Choose an image between 1 byte and 5 MiB.', 413);
    const detected = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      ? 'image/png'
      : bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
        ? 'image/jpeg'
        : bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
            bytes.subarray(8, 12).toString('ascii') === 'WEBP'
          ? 'image/webp'
          : null;
    if (!detected || detected !== claimedType)
      fail('RATE_SOURCE_TYPE', 'Upload a JPEG, PNG or WebP image matching its declared type.');
    try {
      const image = sharp(bytes, { limitInputPixels: maxPixels, failOn: 'warning' }).timeout({
        seconds: 5,
      });
      const metadata = await image.metadata();
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width * metadata.height > maxPixels ||
        (metadata.pages || 1) !== 1 ||
        `image/${metadata.format}` !== detected
      )
        throw new Error('Invalid source dimensions or format');
      // Metadata alone does not decode pixels; stats also rejects damaged/truncated image data.
      await image.stats();
    } catch {
      fail(
        'RATE_SOURCE_INVALID',
        'Choose a valid, single-frame image no larger than 20 megapixels.',
      );
    }
    return { contentType: detected, size: bytes.length, sha256: digest(bytes) };
  }

  private key(key: string) {
    if (!/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(key))
      fail('RATE_SOURCE_KEY', 'Invalid source identifier.');
    return key;
  }

  private remote() {
    const env = process.env;
    if (!env.RATE_SOURCE_BUCKET) {
      if (env.NODE_ENV === 'production')
        fail(
          'RATE_STORAGE_NOT_CONFIGURED',
          'Configure private rate-sheet storage before uploading.',
          503,
        );
      return null;
    }
    if (
      !env.R2_ENDPOINT ||
      !env.R2_ACCESS_KEY_ID ||
      !env.R2_SECRET_ACCESS_KEY ||
      env.RATE_SOURCE_BUCKET === env.R2_BUCKET
    )
      fail(
        'RATE_STORAGE_NOT_CONFIGURED',
        'Configure a separate private rate-sheet bucket and credentials.',
        503,
      );
    const endpoint = new URL(env.R2_ENDPOINT);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password)
      fail(
        'RATE_STORAGE_NOT_CONFIGURED',
        'Private storage requires a trusted HTTPS endpoint.',
        503,
      );
    return {
      bucket: env.RATE_SOURCE_BUCKET,
      client: new S3Client({
        region: 'auto',
        endpoint: endpoint.toString(),
        credentials: {
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        },
      }),
    };
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    this.key(key);
    if (
      !bytes.length ||
      bytes.length > maxBytes ||
      !extensions[contentType] ||
      key !== `${digest(bytes)}.${extensions[contentType]}`
    )
      fail('RATE_SOURCE_INVALID', 'Source bytes do not match the validated image.');
    const remote = this.remote();
    try {
      if (remote) {
        await remote.client.send(
          new PutObjectCommand({
            Bucket: remote.bucket,
            Key: key,
            Body: bytes,
            ContentType: contentType,
            ContentLength: bytes.length,
            CacheControl: 'private, no-store',
          }),
          { abortSignal: AbortSignal.timeout(30000) },
        );
      } else {
        await mkdir(localDirectory, { recursive: true, mode: 0o700 });
        const temporary = resolve(localDirectory, `.${key}.${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
          await rename(temporary, resolve(localDirectory, key));
        } finally {
          await rm(temporary, { force: true }).catch(() => {});
        }
      }
    } catch {
      fail(
        'RATE_STORAGE_WRITE_FAILED',
        'Could not save the private source. Please retry the upload.',
        503,
      );
    } finally {
      remote?.client.destroy();
    }
  }

  async get(key: string): Promise<Buffer> {
    this.key(key);
    const remote = this.remote();
    try {
      let bytes: Buffer;
      if (remote) {
        const response = await remote.client.send(
          new GetObjectCommand({ Bucket: remote.bucket, Key: key }),
          { abortSignal: AbortSignal.timeout(30000) },
        );
        if (!response.Body || (response.ContentLength || 0) > maxBytes)
          throw new Error('Invalid stored source');
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
          size += chunk.length;
          if (size > maxBytes) throw new Error('Stored source exceeds limit');
          chunks.push(Buffer.from(chunk));
        }
        bytes = Buffer.concat(chunks);
      } else {
        const chunks: Buffer[] = [];
        for await (const chunk of createReadStream(resolve(localDirectory, key), { end: maxBytes }))
          chunks.push(Buffer.from(chunk));
        bytes = Buffer.concat(chunks);
      }
      if (!bytes.length || bytes.length > maxBytes || digest(bytes) !== key.split('.')[0])
        throw new Error('Stored source integrity check failed');
      return bytes;
    } catch {
      return fail(
        'RATE_STORAGE_READ_FAILED',
        'The private source could not be read. Please try again.',
        503,
      );
    } finally {
      remote?.client.destroy();
    }
  }
}
