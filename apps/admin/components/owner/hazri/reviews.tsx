'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Field, Sheet, StatusPill } from '@shiv/design';
import { istToday, momentLabel } from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { ApiError, api } from '../../../lib/api';
import { useLanguage, useT } from '../../../lib/i18n';
import { useAction, useOwner } from '../../../lib/owner';
import { Problem, QueryStatus } from '../common';
import css from '../owner.module.css';
import { EvidencePhoto } from './common';
import { mapLink } from './fixes';
import own from './hazri.module.css';
import { hazriKey, PersonDay } from './today';
import type { ReviewCard, Reviews, RosterRow } from './types';
import { reasonLines, stamp, takenAt, wasOffline } from './words';

type Decision = 'ACCEPT' | 'REJECT' | 'TO_OWNER';
const decided: Record<Decision, MessageKey> = {
  ACCEPT: 'owner.hazri.review.accepted',
  REJECT: 'owner.hazri.review.rejected',
  TO_OWNER: 'owner.hazri.review.sentUp',
};
/** Someone got there first: that is good news, not an error. */
const alreadyDone = (error: unknown) =>
  error instanceof ApiError && error.code === 'ALREADY_DECIDED';
/** The card moved on while it sat on this screen, up to an owner or off the list altogether. */
const noLongerHere = (error: unknown) =>
  error instanceof ApiError && ['FORBIDDEN', 'NOT_FOUND'].includes(error.code);

/** A roster row is all the person's day sheet needs, and a card knows enough to make one. */
const asRow = (card: ReviewCard): RosterRow => ({
  userId: card.userId,
  name: card.name,
  role: 'HELPER',
  status: 'REVIEW',
  firstInAt: null,
  lastOutAt: null,
  minutes: null,
  lateMinutes: 0,
  flags: [],
  linked: true,
  noPhone: false,
});

function Card({ card }: { card: ReviewCard }) {
  const t = useT();
  const { language } = useLanguage();
  const { notice, can } = useOwner();
  const [why, setWhy] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const decide = useAction(
    async ({ decision, note }: { decision: Decision; note?: string }) => {
      try {
        await api(`/admin/attendance/reviews/${card.id}/decide`, 'POST', {
          decision,
          ...(note ? { note } : {}),
        });
        notice(t(decided[decision], { name: card.name }));
      } catch (error) {
        if (alreadyDone(error)) notice(t('owner.hazri.alreadyDone'));
        else if (noLongerHere(error)) notice(t('owner.hazri.review.movedOn'));
        else throw error;
      }
      setWhy(null);
    },
    [hazriKey],
  );
  const lines = reasonLines(card, language);
  const offline = wasOffline(card.claimedAgeMs);
  const mayOwn = can('attendance.correct') && can('device.approve.change');
  const shopId = card.locationId ?? '';
  return (
    <article className={own.reviewCard}>
      <div className={css.row}>
        <h3>{card.name}</h3>
        {card.toOwner && <StatusPill label={t('owner.hazri.review.withOwner')} />}
      </div>
      <p className={css.sub}>
        {[
          card.shopName,
          card.punch === 'OUT'
            ? t('owner.hazri.event.OUT')
            : card.punch === 'IN'
              ? t('owner.hazri.event.IN')
              : '',
          t('owner.hazri.review.serverTime', { time: momentLabel(card.serverAt, language) }),
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {(lines.length ? lines : [{ key: 'owner.hazri.why.other' as MessageKey }]).map(
        ({ key, params }: { key: MessageKey; params?: Record<string, string | number> }) => (
          <p key={key}>{t(key, params)}</p>
        ),
      )}
      {card.weakThisMonth > 0 && (
        <p>{t('owner.hazri.review.weakMonth', { count: card.weakThisMonth })}</p>
      )}
      {/* What someone typed stays plain text. */}
      {card.note && <p className={css.said}>{card.note}</p>}
      {offline && (
        <p className={css.hint}>
          {t('owner.hazri.review.offlineCounts', {
            time: stamp(takenAt(card.serverAt, card.claimedAgeMs), card.serverAt, language),
          })}
        </p>
      )}
      {card.evidenceId && <EvidencePhoto id={card.evidenceId} />}
      <div className={own.links}>
        {card.position && (
          <a
            className={css.inlineLink}
            href={mapLink(card.position.lat, card.position.lng)}
            target="_blank"
            rel="noreferrer"
          >
            {t('owner.hazri.review.map')}
          </a>
        )}
        <button type="button" className={own.linkish} onClick={() => setLooking(true)}>
          {t('owner.hazri.review.seeDay')}
        </button>
      </div>
      <div className={css.actions}>
        <Button disabled={decide.isPending} onClick={() => decide.mutate({ decision: 'ACCEPT' })}>
          {t('owner.hazri.review.accept')}
        </Button>
        <Button variant="secondary" disabled={decide.isPending} onClick={() => setWhy('')}>
          {t('owner.hazri.review.reject')}
        </Button>
        {!mayOwn && !card.toOwner && (
          <Button
            variant="secondary"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ decision: 'TO_OWNER' })}
          >
            {t('owner.hazri.review.toOwner')}
          </Button>
        )}
      </div>
      {why === null && <Problem error={decide.error} />}
      {why !== null && (
        <Sheet
          title={t('owner.hazri.review.rejectTitle', { name: card.name })}
          closeLabel={t('owner.close')}
          onClose={() => {
            if (!decide.isPending) setWhy(null);
          }}
        >
          <form
            className={css.stack}
            onSubmit={(event) => {
              event.preventDefault();
              decide.mutate({ decision: 'REJECT', note: why.trim() });
            }}
          >
            <p>{t('owner.hazri.review.rejectBody')}</p>
            <Field label={t('owner.hazri.review.rejectWhy')}>
              <input
                required
                minLength={2}
                maxLength={200}
                value={why}
                onChange={(event) => setWhy(event.target.value)}
              />
            </Field>
            <Problem error={decide.error} />
            <Button className={css.wide} disabled={decide.isPending}>
              {t('owner.hazri.review.reject')}
            </Button>
          </form>
        </Sheet>
      )}
      {looking && (
        <PersonDay
          open={{ row: asRow(card), shopId }}
          day={istToday(new Date(card.serverAt))}
          close={() => setLooking(false)}
        />
      )}
    </article>
  );
}

/** "Dukaan ka net band tha": many at once, with one reason for all of them. */
function BulkAccept({ cards, close }: { cards: ReviewCard[]; close: () => void }) {
  const t = useT();
  const { language } = useLanguage();
  const { notice } = useOwner();
  // Only cards whose one finding is the missing internet start ticked. Anything else, a person picks.
  const [chosen, setChosen] = useState<string[]>(() =>
    cards
      .filter((card) => card.reasons.length === 1 && card.reasons[0] === 'OFFLINE')
      .map((card) => card.id),
  );
  const [reason, setReason] = useState(t('owner.hazri.bulk.defaultReason'));
  const save = useAction(async () => {
    const { accepted } = await api<{ accepted: number }>('/admin/attendance/reviews/bulk', 'POST', {
      ids: chosen,
      note: reason.trim(),
    });
    notice(
      accepted === chosen.length
        ? t('owner.hazri.bulk.done', { count: accepted })
        : t('owner.hazri.bulk.someDone', { count: accepted, done: chosen.length - accepted }),
    );
    close();
  }, [hazriKey]);
  const toggle = (id: string) =>
    setChosen(chosen.includes(id) ? chosen.filter((entry) => entry !== id) : [...chosen, id]);
  return (
    <Sheet
      title={t('owner.hazri.bulk.title')}
      closeLabel={t('owner.close')}
      onClose={() => {
        if (!save.isPending) close();
      }}
    >
      <form
        className={css.stack}
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(undefined);
        }}
      >
        <p>{t('owner.hazri.bulk.body')}</p>
        <Field label={t('owner.hazri.bulk.reason')}>
          <input
            required
            minLength={2}
            maxLength={200}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <fieldset className={css.formFieldset}>
          <legend>{t('owner.hazri.bulk.which')}</legend>
          {cards.map((card) => (
            <label className={css.check} key={card.id}>
              <input
                type="checkbox"
                checked={chosen.includes(card.id)}
                onChange={() => toggle(card.id)}
              />
              <span>
                {card.name} · {card.shopName} · {momentLabel(card.serverAt, language)}
              </span>
            </label>
          ))}
        </fieldset>
        <Problem error={save.error} />
        <Button className={css.wide} disabled={save.isPending || !chosen.length}>
          {t('owner.hazri.bulk.save', { count: chosen.length })}
        </Button>
      </form>
    </Sheet>
  );
}

/** What the checks could not settle alone. A person looks, and nothing here accuses anybody. */
export function HazriReviews() {
  const t = useT();
  const { shopId, can } = useOwner();
  const shop = shopId && can('attendance.review', shopId) ? shopId : null;
  const reviews = useQuery({
    queryKey: [...hazriKey, 'reviews', shop],
    queryFn: () =>
      api<Reviews>(
        `/admin/attendance/reviews${shop ? `?locationId=${encodeURIComponent(shop)}` : ''}`,
      ),
    refetchInterval: 30000,
  });
  const [bulk, setBulk] = useState(false);
  const cards = reviews.data?.items ?? [];
  return (
    <div className={css.stack}>
      <QueryStatus query={reviews} />
      {reviews.data && !cards.length && <EmptyState title={t('owner.hazri.review.empty')} />}
      {cards.length > 1 && (
        <Button variant="secondary" onClick={() => setBulk(true)}>
          {t('owner.hazri.bulk.title')}
        </Button>
      )}
      {cards.map((card) => (
        <Card key={card.id} card={card} />
      ))}
      {bulk && <BulkAccept cards={cards} close={() => setBulk(false)} />}
    </div>
  );
}
