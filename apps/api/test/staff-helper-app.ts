import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { Server } from 'node:http';
import { punchMessage } from '@shiv/shared';
import request from 'supertest';

/** A pretend phone: a real P-256 key, signing the way the Android Keystore does. */
export function makePhone() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    sign: (message: string) => sign('sha256', Buffer.from(message), privateKey).toString('base64'),
  };
}
export type Phone = ReturnType<typeof makePhone>;

export async function otpFor(server: Server, phone: string) {
  const sent = await request(server).post('/api/v1/auth/otp/request').send({ phone }).expect(201);
  return sent.body.devCode as string;
}
export function linkPhone(server: Server, phone: string, device: Phone, extra: object = {}) {
  const sent = (async () => {
    const code = await otpFor(server, phone);
    return request(server)
      .post('/api/v1/staff-auth/verify')
      .send({
        phone,
        code,
        publicKey: device.publicKey,
        signature: device.sign(`link-verify|${phone}|${code}`),
        model: 'Test phone',
        sdk: 34,
        ...extra,
      });
  })();
  // Reads like supertest at the call, though asking for the code comes first.
  return Object.assign(sent, {
    expect: async (status: number) => {
      const res = await sent;
      if (res.status !== status)
        throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
      return res;
    },
  });
}
export function signedPunch(device: Phone, qr: string, extra: Record<string, unknown> = {}) {
  const body = {
    captureId: randomUUID(),
    qr,
    kind: 'IN' as const,
    lat: 25.6,
    lng: 85.1,
    accuracyM: 15,
    mocked: false,
    location: 'OK' as const,
    ...extra,
  };
  return { ...body, signature: device.sign(punchMessage(body as never)) };
}
