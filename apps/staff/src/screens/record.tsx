import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api, fetchFresh, now, useApp } from '../core';
import {
  dayLines,
  emptyMonth,
  monthGrid,
  shiftMonth,
  type DayEventRow,
  type DayMark,
  type MonthDay,
} from '../logic/record';
import { dayText, istDay, monthText } from '../logic/time';
import { useNav } from '../nav';
import { Band, Btn, Card, Field, Flood, Icon, Row, Screen, Shape, Tag, Txt, useOnce } from '../ui';
import { colors, space } from '../ui/tokens';
import { BackBtn, TopBar, Waiting } from './shell';

const markLook: Record<
  DayMark,
  { kind: 'square' | 'triangle' | 'hollow' | 'dash' | 'diamond'; color: string } | null
> = {
  present: { kind: 'square', color: colors.ok },
  late: { kind: 'triangle', color: colors.warn },
  absent: { kind: 'hollow', color: colors.danger },
  review: { kind: 'diamond', color: colors.warn },
  off: { kind: 'dash', color: colors.ink2 },
  none: null,
};
const weekHeads = ['0', '1', '2', '3', '4', '5', '6'] as const;

export function RecordScreen() {
  const { tr, today } = useApp();
  const nav = useNav();
  const nowMs = now();
  const todayDay = nowMs === null ? (today?.day ?? '') : istDay(nowMs);
  const [month, setMonth] = useState(todayDay.slice(0, 7));
  const [rows, setRows] = useState<MonthDay[] | null>(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    void fetchFresh<{ days: MonthDay[] }, MonthDay[]>(
      `month:${month}`,
      `staff/me/attendance?month=${month}`,
      (reply) => reply.days,
    ).then((result) => {
      if (live) setRows(result.value ?? []);
    });
    return () => {
      live = false;
    };
  }, [month]);
  const offs = today?.schedule?.weeklyOffs ?? [];
  const cells = monthGrid(month, rows ?? [], todayDay, offs);
  const legend: { mark: DayMark; label: string }[] = [
    { mark: 'present', label: tr('staff.record.present') },
    { mark: 'late', label: tr('staff.record.late') },
    { mark: 'absent', label: tr('staff.record.absent') },
    { mark: 'review', label: tr('staff.record.review') },
    { mark: 'off', label: tr('staff.record.off') },
  ];
  const canNext = month < todayDay.slice(0, 7);
  return (
    <Screen testID="screen-record" top={<TopBar />} footer={<BackBtn />}>
      <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          testID="month-prev"
          accessibilityRole="button"
          accessibilityLabel={tr('staff.record.prev')}
          onPress={() => setMonth(shiftMonth(month, -1))}
          style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevron-left" size={32} />
        </Pressable>
        <Txt kind="body" center style={{ flex: 1 }} testID="month-title">
          {tr('staff.record.title', { month: monthText(month, tr) })}
        </Txt>
        <Pressable
          testID="month-next"
          accessibilityRole="button"
          accessibilityLabel={tr('staff.record.next')}
          accessibilityState={{ disabled: !canNext }}
          disabled={!canNext}
          onPress={() => setMonth(shiftMonth(month, 1))}
          style={{
            width: 56,
            height: 56,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: canNext ? 1 : 0.3,
          }}
        >
          <Icon name="chevron-right" size={32} />
        </Pressable>
      </Row>
      {rows === null ? (
        <Waiting />
      ) : (
        <>
          <View style={{ flexDirection: 'row' }}>
            {weekHeads.map((day) => (
              <Txt key={day} kind="small" center style={{ width: `${100 / 7}%` }}>
                {tr(`staff.weekday.${day}`).slice(0, 2)}
              </Txt>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {cells.map((cell, index) => {
              if (!cell)
                return <View key={`blank-${index}`} style={{ width: `${100 / 7}%`, height: 56 }} />;
              const look = markLook[cell.mark];
              return (
                <View key={cell.day} style={{ width: `${100 / 7}%`, padding: 1 }}>
                  <Pressable
                    testID={`day-${cell.day}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${cell.date} ${tr(`staff.record.${cell.mark === 'none' ? 'off' : cell.mark}`)}`}
                    onPress={() => nav.push('day', { day: cell.day })}
                    style={{
                      height: 54,
                      backgroundColor: colors.well,
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 2,
                    }}
                  >
                    <Txt>{cell.date}</Txt>
                    {look ? <Shape kind={look.kind} color={look.color} size={10} /> : null}
                  </Pressable>
                </View>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            {legend.map((item) => {
              const look = markLook[item.mark]!;
              return (
                <View
                  key={item.mark}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}
                >
                  <Shape kind={look.kind} color={look.color} />
                  <Txt kind="small">{item.label}</Txt>
                </View>
              );
            })}
          </View>
          {emptyMonth(rows) ? <Band testID="month-empty" text={tr('staff.record.empty')} /> : null}
        </>
      )}
    </Screen>
  );
}

export function DayScreen({ params }: { params?: Record<string, unknown> }) {
  const { tr } = useApp();
  const nav = useNav();
  const day = params?.day as string;
  const [events, setEvents] = useState<DayEventRow[] | null>(null);
  useEffect(() => {
    let live = true;
    void fetchFresh<{ events: DayEventRow[] }, DayEventRow[]>(
      `day:${day}`,
      `staff/me/attendance/${day}`,
      (reply) => reply.events,
    ).then((result) => {
      if (live) setEvents(result.value ?? []);
    });
    return () => {
      live = false;
    };
  }, [day]);
  const lines = events ? dayLines(events, tr) : [];
  return (
    <Screen
      testID="screen-day"
      top={<TopBar />}
      footer={
        <>
          <Btn
            testID="day-wrong"
            kind="line"
            label={tr('staff.record.wrong')}
            onPress={() => nav.push('query', { day })}
          />
          <BackBtn />
        </>
      }
    >
      <Txt kind="head">{dayText(day, tr)}</Txt>
      {events === null ? <Waiting /> : null}
      {events !== null && !lines.length ? <Txt>{tr('staff.record.noDay')}</Txt> : null}
      {lines.map((line) => (
        <Card key={line.id} testID="day-line">
          {line.tone === 'plain' ? (
            <Txt>{line.title}</Txt>
          ) : (
            <Tag tone={line.tone === 'ok' ? 'ok' : 'warn'} text={line.title} />
          )}
          {line.detail.map((text, index) => (
            <Txt key={`${index}-${text}`} kind="small">
              {text}
            </Txt>
          ))}
        </Card>
      ))}
    </Screen>
  );
}

export function QueryScreen({ params }: { params?: Record<string, unknown> }) {
  const { tr } = useApp();
  const nav = useNav();
  const day = params?.day as string;
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const { busy, once } = useOnce();
  const send = async () => {
    if (note.trim().length < 2) {
      setError(tr('staff.record.queryShort'));
      return;
    }
    setError(null);
    try {
      await api.request('POST', 'staff/me/query', { day, note: note.trim() });
      setSent(true);
    } catch {
      setError(tr('staff.common.noSignal'));
    }
  };
  if (sent)
    return (
      <Flood
        tone="amber"
        icon="clock"
        testID="flood-query"
        title={tr('staff.record.querySent')}
        lines={[tr('staff.problem.sentLine')]}
        actions={
          <Btn
            testID="flood-home"
            kind="solid"
            label={tr('staff.common.ok')}
            onPress={() => nav.pop()}
          />
        }
      />
    );
  return (
    <Screen
      testID="screen-query"
      top={<TopBar />}
      footer={
        <>
          <Btn
            testID="query-send"
            kind="lamp"
            label={tr('staff.record.querySend')}
            disabled={busy}
            onPress={() => once(send)}
          />
          <BackBtn />
        </>
      }
    >
      <Txt kind="head">{dayText(day, tr)}</Txt>
      <Field
        testID="query-note"
        label={tr('staff.record.queryLabel')}
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={300}
        style={{ minHeight: 120, textAlignVertical: 'top', paddingTop: space.sm }}
      />
      {error ? <Band tone="danger" text={error} /> : null}
    </Screen>
  );
}
