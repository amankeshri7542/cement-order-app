import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { bridgeMessage, bridgeProtocol } from '@shiv/shared';
import type { NextFunction, Request, Response } from 'express';
import { createPublicKey, verify } from 'node:crypto';
import { Db } from '../db';
import { fail, hash } from '../http';

/** A captured request stops working after this, and a slow clock is told the real time in the reply. */
export const bridgeTimeWindowMs = 15 * 60000;
const open = new Set(['/api/v1/bridge/pair', '/api/v1/bridge/time']);

export type BridgeCall = { deviceId: string; seq: bigint; bodySha256: string };
export type BridgeRequest = Request & { bridge?: BridgeCall; requestId?: string };

export function ed25519Verify(publicKeyBase64: string, message: string, signature: string) {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    if (key.asymmetricKeyType !== 'ed25519') return false;
    return verify(null, Buffer.from(message), key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

function headers(req: Request) {
  const read = (name: string) => {
    const value = req.headers[name];
    return typeof value === 'string' ? value : '';
  };
  const device = read('x-bridge-device');
  const time = read('x-bridge-time');
  const seq = read('x-bridge-seq');
  const signature = read('x-bridge-signature');
  const bodySha256 = read('x-bridge-body-sha256');
  if (
    !/^[A-Za-z0-9_-]{5,64}$/.test(device) ||
    !/^\d{10,14}$/.test(time) ||
    !/^\d{1,18}$/.test(seq) ||
    !/^[A-Za-z0-9+/=]{40,200}$/.test(signature) ||
    !/^[a-f0-9]{64}$/.test(bodySha256)
  )
    return null;
  return { device, time, seq, signature, bodySha256 };
}

/**
 * Runs before any body is read, as uploadGate does. The PC signs the body's hash, so its signature
 * can be checked now: only a real, unrevoked PC can make the server read up to 5 MB. Everyone else
 * gets their answer at once, with nothing read and nothing said about which part was wrong.
 */
export function bridgeGate(db: Pick<Db, 'tallyDevice'>) {
  return (req: BridgeRequest, res: Response, next: NextFunction) => {
    res.setHeader('X-Bridge-Server-Time', String(Date.now()));
    const path = req.originalUrl.split('?')[0]!;
    if (req.method === 'OPTIONS' || open.has(path)) return next();
    const refuse = (status: number, code: string, message: string, details?: object) => {
      // A body we refuse to read must not stay half-sent on a connection someone else may reuse.
      res.setHeader('Connection', 'close');
      res.status(status).json({
        error: {
          code,
          message,
          requestId: req.requestId,
          serverNow: new Date().toISOString(),
          ...(details ? { details } : {}),
        },
      });
    };
    const call = headers(req);
    if (!call) return refuse(401, 'BRIDGE_UNSIGNED', 'This PC did not sign its request.');
    if (req.headers['x-bridge-protocol'] !== String(bridgeProtocol))
      return refuse(400, 'BRIDGE_OLD_PROTOCOL', 'This program needs updating.');
    if (Math.abs(Date.now() - Number(call.time)) > bridgeTimeWindowMs)
      return refuse(401, 'BRIDGE_CLOCK', 'This PC’s clock is too far from the server’s.');
    db.tallyDevice
      .findUnique({
        where: { id: call.device },
        select: { id: true, publicKey: true, revokedAt: true, lastSeq: true },
      })
      .then((device) => {
        const message = bridgeMessage(
          req.method,
          req.originalUrl,
          call.time,
          call.seq,
          call.bodySha256,
        );
        if (!device || !ed25519Verify(device.publicKey, message, call.signature))
          return refuse(401, 'BRIDGE_BAD_SIGNATURE', 'This PC could not prove itself.');
        if (device.revokedAt)
          return refuse(401, 'BRIDGE_REVOKED', 'This PC has been disconnected.');
        const seq = BigInt(call.seq);
        if (seq <= device.lastSeq)
          return refuse(409, 'BRIDGE_REPLAY', 'This request was already used.', {
            lastSeq: String(device.lastSeq),
          });
        req.bridge = { deviceId: device.id, seq, bodySha256: call.bodySha256 };
        next();
      })
      .catch(next);
  };
}

/**
 * Runs after the body is read: the bytes must be the ones signed, and this request's number is taken
 * in one statement, so a captured request cannot run twice even if both copies arrive together.
 */
@Injectable()
export class BridgeGuard implements CanActivate {
  constructor(@Inject(Db) private db: Db) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<BridgeRequest>();
    const call = req.bridge;
    if (!call) fail('BRIDGE_UNSIGNED', 'This PC did not sign its request.', 401);
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (hash(body) !== call.bodySha256)
      fail('BRIDGE_BAD_BODY', 'What arrived is not what this PC signed.', 400);
    const moved = await this.db.tallyDevice.updateMany({
      where: { id: call.deviceId, revokedAt: null, lastSeq: { lt: call.seq } },
      data: { lastSeq: call.seq },
    });
    if (moved.count) return true;
    const device = await this.db.tallyDevice.findUnique({
      where: { id: call.deviceId },
      select: { revokedAt: true, lastSeq: true },
    });
    if (!device || device.revokedAt) fail('BRIDGE_REVOKED', 'This PC has been disconnected.', 401);
    return fail('BRIDGE_REPLAY', 'This request was already used.', 409, {
      lastSeq: String(device.lastSeq),
    });
  }
}
