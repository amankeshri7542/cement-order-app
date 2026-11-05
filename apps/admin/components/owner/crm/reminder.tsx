'use client';
import { useRef, useState } from 'react';
import { Button, Sheet } from '@shiv/design';
import { ApiError, api } from '../../../lib/api';
import { useT } from '../../../lib/i18n';
import { useAction, useOwner } from '../../../lib/owner';
import { Problem } from '../common';
import own from './crm.module.css';
import type { Reminder, ReminderBlock } from './types';

type Sent = { id: string; url: string | null; text: string; phone: string };

const blockWord = {
  NOT_SIGNED: 'owner.crm.block.notSigned',
  STOPPED: 'owner.crm.block.stopped',
  NO_BALANCE: 'owner.crm.block.noBalance',
  NO_PHONE: 'owner.crm.block.noPhone',
} as const;

/** Why this person's button is missing, in a word, so nobody hunts for it. */
export function ReminderBlocked({ reason }: { reason: ReminderBlock }) {
  const t = useT();
  return <span className={`${own.tag} ${own.tagLook}`}>{t(blockWord[reason])}</span>;
}

/**
 * One tap opens WhatsApp with the words filled in, and a person presses send. Nothing is ever sent
 * from here. The words and the amount come from the server, from the balance as it is now.
 */
export function YaadDilao({
  customerId,
  followUpId,
  purpose = 'PAYMENT',
  blocked = null,
  label,
  variant = 'secondary',
}: {
  customerId: string;
  followUpId?: string;
  purpose?: 'PAYMENT' | 'QUIET';
  blocked?: ReminderBlock | null;
  label?: string;
  variant?: 'primary' | 'secondary';
}) {
  const t = useT();
  const { can } = useOwner();
  const key = useRef(crypto.randomUUID());
  const [again, setAgain] = useState(false);
  const [warn, setWarn] = useState(false);
  const [blockedLink, setBlockedLink] = useState<string | null>(null);
  const send = useAction(
    async (wantAgain: boolean) => {
      const sent = await api<Sent>(`/admin/customers/${customerId}/reminder`, 'POST', {
        purpose,
        idempotencyKey: key.current,
        ...(followUpId ? { followUpId } : {}),
        ...(wantAgain ? { again: true } : {}),
      });
      key.current = crypto.randomUUID();
      setAgain(false);
      setWarn(false);
      if (!sent.url) return;
      const opened = window.open(sent.url, '_blank');
      if (opened) opened.opener = null;
      // A browser that blocks the new window still gets the link, one more tap away.
      else setBlockedLink(sent.url);
    },
    [
      ['customers', 'crm', customerId],
      ['customers', 'timeline', customerId],
      ['followups'],
      ['crm'],
    ],
  );
  if (blocked) return <ReminderBlocked reason={blocked} />;
  const sameDay = send.error instanceof ApiError && send.error.code === 'REMINDED_TODAY' && !again;
  const shown = send.error && !sameDay ? send.error : null;
  const tap = async () => {
    // Only someone who may see Tally can be warned about it, and nobody else slows down.
    if (purpose === 'PAYMENT' && can('tally.numbers.view')) {
      const preview = await api<Reminder>(`/admin/customers/${customerId}/reminder`).catch(
        () => null,
      );
      if (preview?.warnDifference) {
        setWarn(true);
        return;
      }
    }
    send.mutate(false);
  };
  return (
    <>
      <Button type="button" variant={variant} disabled={send.isPending} onClick={() => void tap()}>
        {label ?? t('owner.crm.remind')}
      </Button>
      <Problem error={shown} />
      {(sameDay || again) && (
        <Sheet
          title={t('owner.crm.remindedTodayTitle')}
          closeLabel={t('owner.close')}
          onClose={() => {
            setAgain(false);
            send.reset();
          }}
        >
          <p>{t('owner.crm.remindedTodayBody')}</p>
          <div className={own.buttons}>
            <Button
              disabled={send.isPending}
              onClick={() => {
                setAgain(true);
                send.mutate(true);
              }}
            >
              {t('owner.crm.remindAgain')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setAgain(false);
                send.reset();
              }}
            >
              {t('owner.crm.notNow')}
            </Button>
          </div>
        </Sheet>
      )}
      {warn && (
        <Sheet
          title={t('owner.crm.lookFirstTitle')}
          closeLabel={t('owner.close')}
          onClose={() => setWarn(false)}
        >
          <p className={own.look}>{t('owner.crm.lookFirstBody')}</p>
          <div className={own.buttons}>
            <Button disabled={send.isPending} onClick={() => send.mutate(false)}>
              {t('owner.crm.remindAnyway')}
            </Button>
            <Button variant="secondary" onClick={() => setWarn(false)}>
              {t('owner.crm.notNow')}
            </Button>
          </div>
        </Sheet>
      )}
      {blockedLink && (
        <Sheet
          title={t('owner.crm.remind')}
          closeLabel={t('owner.close')}
          onClose={() => setBlockedLink(null)}
        >
          <p>{t('owner.crm.openBelow')}</p>
          <a
            className={own.name}
            href={blockedLink}
            target="_blank"
            rel="noreferrer"
            onClick={() => setBlockedLink(null)}
          >
            {t('owner.crm.openWhatsapp')}
          </a>
        </Sheet>
      )}
    </>
  );
}
