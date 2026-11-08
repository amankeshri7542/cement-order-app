import { type ReactNode, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { isMessageKey, type MessageKey } from '@shiv/i18n';
import { dismissFailure, setLanguage, useApp } from '../core';
import { tabsFor, type TabKey } from '../logic/kaam';
import { useNav } from '../nav';
import { Band, Btn, Icon, Mark, Txt, type IconName } from '../ui';
import { colors, space, touchStaff } from '../ui/tokens';

/** The mark and the name, with the language switch in the same place on every screen. */
export function TopBar() {
  const { tr, language } = useApp();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: space.lg,
        minHeight: 48,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Mark />
        <Txt>Shiv Staff</Txt>
      </View>
      <Pressable
        testID="language-switch"
        accessibilityRole="button"
        onPress={() => void setLanguage(language === 'en' ? 'hinglish' : 'en')}
        hitSlop={8}
        style={{ minHeight: 48, justifyContent: 'center', paddingLeft: space.md }}
      >
        <Txt kind="small">{tr('staff.lang.other')}</Txt>
      </Pressable>
    </View>
  );
}

const tabIcon: Record<TabKey, IconName> = { hazri: 'qr', kaam: 'box', paisa: 'rupee' };
export function TabBar() {
  const { tr, today } = useApp();
  const nav = useNav();
  const tabs = tabsFor(today?.access ?? []);
  if (tabs.length < 2) return null;
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row' }}>
      {tabs.map((tab) => {
        const on = nav.tab === tab;
        const color = on ? colors.ink : colors.ink2;
        return (
          <Pressable
            key={tab}
            testID={`tab-${tab}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => nav.setTab(tab)}
            style={{
              flex: 1,
              minHeight: touchStaff,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: space.xs,
              backgroundColor: on ? colors.paper : colors.well,
            }}
          >
            <Icon name={tabIcon[tab]} size={24} color={color} />
            <Txt color={color}>{tr(`staff.tab.${tab}`)}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Says when there is no signal, and anything sent that the server would not take. */
export function Bands() {
  const { offline, failures, tr } = useApp();
  const failure = failures[0];
  if (!offline && !failure) return null;
  // A code with no words of its own still says something a person can act on.
  const whyKey = failure ? `staff.failed.why.${failure.code}` : '';
  const why = isMessageKey(whyKey) ? whyKey : 'staff.failed.why.default';
  const whatKey = failure ? `staff.failed.kind.${failure.kind}` : '';
  return (
    <View>
      {offline ? (
        <Band testID="offline-band" icon="wifi-off" text={tr('staff.common.offlineBand')} />
      ) : null}
      {failure ? (
        <Band
          testID="failed-band"
          tone="danger"
          text={tr('staff.failed.line', {
            what: isMessageKey(whatKey) ? tr(whatKey) : '',
            why: tr(why as MessageKey),
          })}
          action={{
            testID: 'failed-ok',
            label: tr('staff.common.ok'),
            onPress: () => void dismissFailure(failure.id),
          }}
        />
      ) : null}
    </View>
  );
}
export function BackBtn({ onPress }: { onPress?: () => void }) {
  const { tr } = useApp();
  const nav = useNav();
  return (
    <Btn
      testID="back"
      kind="quiet"
      icon="chevron-left"
      label={tr('staff.common.back')}
      onPress={onPress ?? (() => nav.pop())}
    />
  );
}
/** A list still arriving is a still block, not a spinner. */
export function Waiting() {
  const { tr } = useApp();
  return (
    <View style={{ minHeight: touchStaff * 2, backgroundColor: colors.well, padding: space.md }}>
      <Txt kind="small">{tr('staff.common.wait')}</Txt>
    </View>
  );
}
export function useServerClockTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
}
export type WithChildren = { children: ReactNode };
