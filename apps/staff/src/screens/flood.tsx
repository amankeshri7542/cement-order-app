import { useEffect, useRef } from 'react';
import type { Outcome, OutcomeAction } from '../logic/outcome';
import { Btn, Flood, type BtnKind } from '../ui';
import { colors, floodHoldMs } from '../ui/tokens';
import { useApp } from '../core';
import { confirmHaptic } from '../platform/feedback';

const icons = { check: 'check', clock: 'clock', alert: 'alert-triangle' } as const;

/** Shows one outcome, whatever made it, so a confirmation looks the same everywhere. */
export function OutcomeFlood(props: {
  outcome: Outcome;
  on: Partial<Record<OutcomeAction, () => void>>;
  testID?: string;
}) {
  const { tr } = useApp();
  const { outcome, on } = props;
  const home = useRef(on.home);
  home.current = on.home;
  // One buzz, when the green arrives. Green goes back by itself; nothing else does.
  useEffect(() => {
    if (outcome.tone === 'ok') confirmHaptic();
    if (!outcome.autoReturn) return;
    const timer = setTimeout(() => home.current?.(), floodHoldMs);
    return () => clearTimeout(timer);
  }, [outcome.tone, outcome.title, outcome.autoReturn]);
  const solid = outcome.tone === 'amber';
  const textOn = solid ? undefined : colors.onSolid;
  const labelFor: Record<OutcomeAction, string> = {
    home: tr('staff.common.ok'),
    rescan: tr('staff.result.rescan'),
    problem: tr('staff.hazri.problem'),
    settings: tr('staff.common.settings'),
    relink: tr('staff.common.ok'),
  };
  const kindFor = (index: number): BtnKind => {
    if (index === 0) return solid ? 'solid' : outcome.tone === 'red' ? 'white' : 'line';
    return solid ? 'line' : 'line';
  };
  return (
    <Flood
      tone={outcome.tone}
      icon={icons[outcome.icon]}
      title={outcome.title}
      lines={outcome.lines}
      {...(props.testID ? { testID: props.testID } : {})}
      actions={outcome.actions.map((action, index) => {
        const kind = kindFor(index);
        return (
          <Btn
            key={action}
            testID={`flood-${action}`}
            kind={kind}
            label={labelFor[action]}
            onPress={on[action]}
            {...(kind === 'line' && textOn ? { on: textOn } : {})}
          />
        );
      })}
    />
  );
}
