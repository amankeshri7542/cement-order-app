import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { fetchFresh, newId, runStep, useApp, type StepResult } from '../core';
import { rupees } from '../logic/kaam';
import {
  answerOf,
  askWords,
  payIsEmpty,
  paymentToAsk,
  rowWords,
  slipLines,
  slipRow,
  slipTitle,
  type MyPay,
  type PayPayment,
  type Slip,
} from '../logic/paisa';
import { useNav } from '../nav';
import { Band, Btn, Card, Choice, Row, Screen, Tag, Txt, useOnce } from '../ui';
import { space } from '../ui/tokens';
import { BackBtn, Bands, TabBar, TopBar, Waiting } from './shell';
import { StepFlood } from './stock';

function Figure(props: { label: string; amount: number; testID: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <Txt kind="small">{props.label}</Txt>
      <Txt testID={props.testID}>{rupees(props.amount)}</Txt>
    </Row>
  );
}

export function PaisaHome() {
  const { tr, entries } = useApp();
  const nav = useNav();
  const [pay, setPay] = useState<MyPay | null>(null);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<{ step: StepResult; answer: 'GOT' | 'NOT_GOT' } | null>(
    null,
  );
  const { busy, once } = useOnce();
  const load = useCallback(() => {
    void fetchFresh<MyPay>('pay', 'staff/me/pay').then((reply) => {
      setPay(reply.value);
      setLoading(false);
    });
  }, []);
  useEffect(load, [load]);
  const answer = async (payment: PayPayment, value: 'GOT' | 'NOT_GOT') => {
    const key = newId();
    const step = await runStep({
      id: key,
      kind: 'payAck',
      method: 'POST',
      path: `staff/me/payments/${payment.id}/ack`,
      body: { answer: value },
      claimsAge: false,
      replaceKey: `ack:${payment.id}`,
    });
    setResult({ step, answer: value });
    load();
  };
  if (result)
    return (
      <StepFlood
        result={result.step}
        title={tr(result.answer === 'GOT' ? 'staff.paisa.tagGot' : 'staff.paisa.tagNotGot')}
        {...(result.answer === 'NOT_GOT'
          ? { lines: [tr('staff.paisa.notGotTold')], amberWhenSent: true }
          : {})}
        onDone={() => setResult(null)}
      />
    );
  const ask = paymentToAsk(pay, entries);
  const empty = payIsEmpty(pay);
  return (
    <Screen
      testID="screen-paisa"
      top={<TopBar />}
      band={<Bands />}
      tabs={<TabBar />}
      {...(ask
        ? {
            footer: (
              <Row>
                <Btn
                  testID="pay-got"
                  flex
                  kind="lamp"
                  label={tr('staff.paisa.got')}
                  disabled={busy}
                  onPress={() => once(() => answer(ask, 'GOT'))}
                />
                <Btn
                  testID="pay-not-got"
                  flex
                  kind="line"
                  label={tr('staff.paisa.notGot')}
                  disabled={busy}
                  onPress={() => once(() => answer(ask, 'NOT_GOT'))}
                />
              </Row>
            ),
          }
        : {})}
    >
      <Txt kind="head">{tr('staff.paisa.title')}</Txt>
      {loading ? <Waiting /> : null}
      {!loading && empty ? (
        <View testID="paisa-empty" style={{ gap: space.xs }}>
          <Txt>{tr('staff.paisa.empty')}</Txt>
          <Txt kind="small">{tr('staff.paisa.emptyLine')}</Txt>
        </View>
      ) : null}
      {ask ? (
        <Txt kind="head" testID="pay-ask">
          {askWords(ask, tr)}
        </Txt>
      ) : null}
      {!loading && !empty && pay ? (
        <Card>
          {pay.monthlyPaise !== null ? (
            <Figure
              testID="pay-monthly"
              label={tr('staff.paisa.monthly')}
              amount={pay.monthlyPaise}
            />
          ) : null}
          {pay.wagesDuePaise > 0 ? (
            <Figure testID="pay-due" label={tr('staff.paisa.due')} amount={pay.wagesDuePaise} />
          ) : null}
          {pay.advancePaise > 0 ? (
            <Figure
              testID="pay-advance"
              label={tr('staff.paisa.advance')}
              amount={pay.advancePaise}
            />
          ) : null}
        </Card>
      ) : null}
      {pay?.slips.length ? <Txt>{tr('staff.paisa.slips')}</Txt> : null}
      {pay?.slips.map((slip) => (
        <Choice
          key={slip.month}
          testID={`slip-${slip.month}`}
          icon="file-text"
          label={slipRow(slip, tr)}
          onPress={() => nav.push('slip', { month: slip.month })}
        />
      ))}
      {pay?.payments.length ? <Txt>{tr('staff.paisa.payments')}</Txt> : null}
      {pay?.payments.map((payment) => {
        const state = answerOf(payment, entries);
        return (
          <Card quiet key={payment.id} testID={`payment-${payment.id}`}>
            <Txt>{rowWords(payment, tr)}</Txt>
            {state.waiting ? (
              <Tag tone="warn" text={tr('staff.common.notSent')} />
            ) : state.answer === 'GOT' ? (
              <Tag tone="ok" text={tr('staff.paisa.tagGot')} />
            ) : state.answer === 'NOT_GOT' ? (
              <>
                <Tag tone="danger" text={tr('staff.paisa.tagNotGot')} />
                <Txt kind="small">{tr('staff.paisa.notGotTold')}</Txt>
                <Btn
                  testID={`pay-got-now-${payment.id}`}
                  kind="line"
                  label={tr('staff.paisa.gotNow')}
                  disabled={busy}
                  onPress={() => once(() => answer(payment, 'GOT'))}
                />
              </>
            ) : (
              <Tag tone="off" text={tr('staff.paisa.tagAsk')} />
            )}
          </Card>
        );
      })}
    </Screen>
  );
}

export function SlipScreen({ params }: { params?: Record<string, unknown> }) {
  const { tr } = useApp();
  const month = params?.month as string;
  const [slip, setSlip] = useState<Slip | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void fetchFresh<{ slip: Slip }, Slip>(
      `slip:${month}`,
      `staff/me/slips/${month}`,
      (reply) => reply.slip,
    ).then((reply) => {
      setSlip(reply.value);
      setLoading(false);
    });
  }, [month]);
  const lines = slip ? slipLines(slip, tr) : [];
  return (
    <Screen testID="screen-slip" top={<TopBar />} footer={<BackBtn />}>
      <Txt kind="head">{slipTitle(month, tr)}</Txt>
      {loading ? <Waiting /> : null}
      {!loading && !slip ? <Band testID="slip-none" text={tr('staff.paisa.slip.none')} /> : null}
      {lines.map((line) => (
        <Row
          key={line.label}
          style={{ justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'baseline' }}
        >
          <Txt kind={line.big ? 'head' : 'small'} style={{ flexShrink: 1 }}>
            {line.label}
          </Txt>
          <Txt
            kind={line.big ? 'number' : 'body'}
            testID={line.big ? 'slip-net' : (undefined as never)}
          >
            {line.amount}
          </Txt>
        </Row>
      ))}
      {slip ? <Txt kind="small">{tr('staff.paisa.slip.notice')}</Txt> : null}
    </Screen>
  );
}
