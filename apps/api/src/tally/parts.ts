import { Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fail } from '../http';

const localDirectory = resolve(process.cwd(), '.local/tally-parts');

/**
 * Where the raw gzip parts live for 7 days: the private bucket that already holds rate sheets, under
 * its own prefix. Never in a public bucket, and in production never on a local disk. The key is built
 * by us from ids we made and a hash we checked, and this refuses anything else.
 */
@Injectable()
export class TallyParts {
  private key(key: string) {
    if (!/^tally-parts\/[A-Za-z0-9_-]{5,64}\/\d{1,4}-[a-f0-9]{64}\.gz$/.test(key))
      fail('BRIDGE_BAD_PART', 'That part is not ours.', 400);
    return key;
  }
  private remote() {
    const env = process.env;
    if (!env.RATE_SOURCE_BUCKET) {
      if (env.NODE_ENV === 'production')
        fail('TALLY_STORAGE_NOT_CONFIGURED', 'Configure private storage for Tally parts.', 503);
      return null;
    }
    if (
      !env.R2_ENDPOINT ||
      !env.R2_ACCESS_KEY_ID ||
      !env.R2_SECRET_ACCESS_KEY ||
      env.RATE_SOURCE_BUCKET === env.R2_BUCKET ||
      new URL(env.R2_ENDPOINT).protocol !== 'https:'
    )
      fail('TALLY_STORAGE_NOT_CONFIGURED', 'Configure private storage for Tally parts.', 503);
    return {
      bucket: env.RATE_SOURCE_BUCKET,
      client: new S3Client({
        region: 'auto',
        endpoint: env.R2_ENDPOINT,
        credentials: {
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        },
      }),
    };
  }
  async put(key: string, bytes: Buffer) {
    this.key(key);
    const remote = this.remote();
    if (remote) {
      await remote.client.send(
        new PutObjectCommand({
          Bucket: remote.bucket,
          Key: key,
          Body: bytes,
          ContentType: 'application/gzip',
          ContentLength: bytes.length,
          CacheControl: 'private, no-store',
        }),
        { abortSignal: AbortSignal.timeout(60000) },
      );
      return;
    }
    const path = resolve(localDirectory, key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  }
  async get(key: string) {
    this.key(key);
    const remote = this.remote();
    if (remote) {
      const reply = await remote.client.send(
        new GetObjectCommand({ Bucket: remote.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(60000) },
      );
      return Buffer.from(await reply.Body!.transformToByteArray());
    }
    return readFile(resolve(localDirectory, key));
  }
  async remove(key: string) {
    this.key(key);
    const remote = this.remote();
    if (remote) {
      await remote.client.send(new DeleteObjectCommand({ Bucket: remote.bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(30000),
      });
      return;
    }
    await rm(resolve(localDirectory, key), { force: true });
  }
}
