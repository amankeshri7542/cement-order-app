import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  advisorTestEnv,
  aiOn,
  ask,
  clearAdvisor,
  clearGuide,
  newDevice,
  setConfig,
  signedForTest,
  sync,
  type Harness,
  startAdvisor,
} from './advisor-helper';
import type { AdvisorTurnView } from '@shiv/shared';
import { resetConfigForTests } from '../src/config';

// Spoofing x-forwarded-for, on an API set up as it is in production: real OTP, one trusted proxy.
// Mock OTP refuses any forwarded request outright, so this file runs with a real OTP provider.
advisorTestEnv('advisor-proxy-test-only-secret-not-for-production');
process.env.OTP_PROVIDER = 'twilio';
process.env.TWILIO_ACCOUNT_SID = 'test-only';
process.env.TWILIO_AUTH_TOKEN = 'test-only';
process.env.TWILIO_VERIFY_SERVICE_SID = 'test-only';
resetConfigForTests();

let h: Harness;
beforeAll(async () => {
  process.env.TRUST_PROXY_HOPS = '1';
  resetConfigForTests();
  h = await startAdvisor();
}, 30000);
afterAll(async () => {
  await h?.app.close();
  delete process.env.TRUST_PROXY_HOPS;
  delete process.env.OTP_PROVIDER;
});
beforeEach(async () => {
  aiOn();
  setConfig({ ADVISOR_QUESTIONS_PER_IP_DAY: 3, ADVISOR_QUESTIONS_PER_DEVICE_DAY: 100 });
  h.fake.reset();
  await clearAdvisor(h.db);
  await clearGuide(h.db);
  await sync(h.db, signedForTest(['cement-storage']));
}, 30000);

const question = (index: number) => `Storing cement at site question number ${index}?`;

describe('behind one trusted proxy', () => {
  it('addresses a client makes up do not buy more questions', async () => {
    const device = await newDevice(h.server);
    const turns: AdvisorTurnView[] = [];
    for (let index = 0; index < 5; index++) {
      const response = await ask(h.server, device, question(index))
        // The proxy adds the real address last. Everything before it came from the client.
        .set('X-Forwarded-For', `10.0.0.${index}, 8.8.${index}.${index}, 203.0.113.7`);
      turns.push(response.body as AdvisorTurnView);
    }
    expect(turns.slice(0, 3).every((turn) => turn.limit === null)).toBe(true);
    expect(turns[3]!.limit).toBe('NETWORK');
    expect(turns[4]!.limit).toBe('NETWORK');
  });

  it('a different real address has its own count', async () => {
    const device = await newDevice(h.server);
    for (let index = 0; index < 3; index++)
      await ask(h.server, device, question(index)).set('X-Forwarded-For', '203.0.113.7');
    const stopped = await ask(h.server, device, question(4)).set('X-Forwarded-For', '203.0.113.7');
    expect(stopped.body.limit).toBe('NETWORK');
    const other = await ask(h.server, device, question(5)).set('X-Forwarded-For', '203.0.113.99');
    expect(other.body.limit).toBeNull();
  });

  it('getting a new token cannot be used to get round the count', async () => {
    setConfig({ ADVISOR_DEVICES_PER_IP_DAY: 2 });
    const mint = (spoof: string) => newDeviceVia(spoof);
    await mint('1.1.1.1, 203.0.113.50');
    await mint('2.2.2.2, 203.0.113.50');
    const { default: request } = await import('supertest');
    await request(h.server)
      .post('/api/v1/advisor/device')
      .set('X-Forwarded-For', '3.3.3.3, 203.0.113.50')
      .send({})
      .expect(429);
  });
});

const newDeviceVia = async (forwarded: string) => {
  const { default: request } = await import('supertest');
  const { body } = await request(h.server)
    .post('/api/v1/advisor/device')
    .set('X-Forwarded-For', forwarded)
    .send({})
    .expect(201);
  return body.deviceToken as string;
};

describe('with no trusted proxy', () => {
  it('x-forwarded-for is ignored altogether', async () => {
    await h.app.close();
    process.env.TRUST_PROXY_HOPS = '0';
    resetConfigForTests();
    h = await startAdvisor();
    aiOn();
    setConfig({ ADVISOR_QUESTIONS_PER_IP_DAY: 2, ADVISOR_QUESTIONS_PER_DEVICE_DAY: 100 });
    await clearAdvisor(h.db);
    const device = await newDevice(h.server);
    const turns: AdvisorTurnView[] = [];
    for (let index = 0; index < 4; index++) {
      const response = await ask(h.server, device, question(index)).set(
        'X-Forwarded-For',
        `198.51.100.${index}`,
      );
      turns.push(response.body as AdvisorTurnView);
    }
    expect(turns[1]!.limit).toBeNull();
    expect(turns[2]!.limit).toBe('NETWORK');
    expect(turns[3]!.limit).toBe('NETWORK');
  });
});
