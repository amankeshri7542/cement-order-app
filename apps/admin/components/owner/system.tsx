'use client';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, StatusPill } from '@shiv/design';
import { momentLabel } from '@shiv/shared';
import { isMessageKey } from '@shiv/i18n';
import { api } from '../../lib/api';
import { useLanguage, useT } from '../../lib/i18n';
import { useAction, useOwner } from '../../lib/owner';
import { MoreRows, PageHeader, Problem, QueryStatus, usePaged } from './common';
import { NotYourPage } from './not-your-page';
import css from './owner.module.css';
import own from './settings.module.css';

type SecurityStatus = {
  pendingCod: number;
  pendingQuotes: number;
  overdueCod: number;
  workers: { lane: string; lastRunAt: string; lastOkAt: string | null; lastStep: string }[];
  warnings: {
    createdAt: string;
    entityId: string;
    details: { count?: number; limit?: number } | null;
  }[];
};
type WaHealth = {
  mode: string;
  paused: boolean;
  lastWebhookAt: string | null;
  today: { inbound: number; gated: number; byRules: number; byModel: number; noAnswer: number };
  numbersOff: number;
  monthSpentMicroUsd: number;
  monthCapMicroUsd: number;
};
type Message = {
  id: string;
  template: string;
  recipient: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
  attempts: number;
  lastError: string | null;
  createdAt: string;
};
const messagesKey = ['owner-system', 'messages'];
/** The slowest lane runs every 5 minutes, so three times that means it has stopped. */
const LANE_STOPPED_AFTER_MS = 15 * 60000;

function WorkWaiting() {
  const t = useT();
  const { language } = useLanguage();
  const status = useQuery({
    queryKey: ['owner-system', 'status'],
    queryFn: () => api<SecurityStatus>('/admin/security-status'),
    refetchInterval: 60000,
  });
  const data = status.data;
  const laneName = (lane: string) => {
    const key = `owner.system.lane.${lane}`;
    return isMessageKey(key) ? t(key) : lane;
  };
  return (
    <>
      <section className={`${css.card} ${own.section}`}>
        <h2>{t('owner.system.work')}</h2>
        <QueryStatus query={status} />
        {data && (
          <dl className={own.facts}>
            <dt>{t('owner.system.pendingCod')}</dt>
            <dd>{data.pendingCod}</dd>
            <dt>{t('owner.system.overdueCod')}</dt>
            <dd>{data.overdueCod}</dd>
            <dt>{t('owner.system.pendingQuotes')}</dt>
            <dd>{data.pendingQuotes}</dd>
          </dl>
        )}
      </section>
      {data && (
        <section className={`${css.card} ${own.section}`}>
          <h2>{t('owner.system.lanes')}</h2>
          {data.workers.length ? (
            <ul className={own.rows}>
              {data.workers.map((worker) => {
                const stopped =
                  Date.now() - new Date(worker.lastRunAt).getTime() > LANE_STOPPED_AFTER_MS;
                return (
                  <li key={worker.lane}>
                    <div className={own.rowHead}>
                      <strong>{laneName(worker.lane)}</strong>
                      <StatusPill
                        tone={stopped ? 'red' : 'green'}
                        label={t(stopped ? 'owner.system.laneStopped' : 'owner.system.laneOk')}
                      />
                    </div>
                    <p className={css.date}>
                      {t('owner.system.laneLast', {
                        when: momentLabel(worker.lastRunAt, language),
                      })}
                    </p>
                    {worker.lastStep && (
                      <p className={css.warnText}>
                        {t('owner.system.laneProblem', { step: worker.lastStep })}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>{t('owner.system.noLanes')}</p>
          )}
        </section>
      )}
      {data && (
        <section className={`${css.card} ${own.section}`}>
          <h2>{t('owner.system.warnings')}</h2>
          {data.warnings.length ? (
            <ul className={own.rows}>
              {data.warnings.map((warning, index) => (
                <li key={`${warning.entityId}:${index}`}>
                  <span>
                    {t('owner.system.warningLine', {
                      scope: warning.entityId,
                      count: warning.details?.count ?? '-',
                      limit: warning.details?.limit ?? '-',
                    })}
                  </span>
                  <p className={css.date}>{momentLabel(warning.createdAt, language)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t('owner.system.noWarnings')}</p>
          )}
        </section>
      )}
    </>
  );
}

function WhatsAppCounts() {
  const t = useT();
  const { language } = useLanguage();
  const health = useQuery({
    queryKey: ['owner-system', 'whatsapp'],
    queryFn: () => api<WaHealth>('/admin/wa/health'),
    refetchInterval: 60000,
  });
  const data = health.data;
  return (
    <section className={`${css.card} ${own.section}`}>
      <h2>{t('owner.system.whatsapp')}</h2>
      <QueryStatus query={health} />
      {data && (
        <>
          <p>{t(data.mode === 'off' ? 'owner.wa.modeOff' : 'owner.wa.modeShadow')}</p>
          {data.paused && (
            <p>
              <StatusPill tone="red" label={t('owner.wa.paused')} />
            </p>
          )}
          <dl className={own.facts}>
            <dt>{t('owner.system.lastIn')}</dt>
            <dd>
              {data.lastWebhookAt
                ? momentLabel(data.lastWebhookAt, language)
                : t('owner.system.neverIn')}
            </dd>
            <dt>{t('owner.system.inbound')}</dt>
            <dd>{data.today.inbound}</dd>
            <dt>{t('owner.system.gated')}</dt>
            <dd>{data.today.gated}</dd>
            <dt>{t('owner.system.byRules')}</dt>
            <dd>{data.today.byRules}</dd>
            <dt>{t('owner.system.byModel')}</dt>
            <dd>{data.today.byModel}</dd>
            <dt>{t('owner.system.noAnswer')}</dt>
            <dd>{data.today.noAnswer}</dd>
            <dt>{t('owner.system.numbersOff')}</dt>
            <dd>{data.numbersOff}</dd>
          </dl>
          <p className={css.hint}>
            {t('owner.wa.monthSpend', {
              spent: (data.monthSpentMicroUsd / 1_000_000).toFixed(2),
              cap: (data.monthCapMicroUsd / 1_000_000).toFixed(2),
            })}
          </p>
        </>
      )}
    </section>
  );
}

function Messages() {
  const t = useT();
  const { language } = useLanguage();
  const messages = usePaged<Message>(messagesKey, '/admin/alerts/messages?limit=20');
  const again = useAction(
    (id: string) => api(`/admin/alerts/messages/${id}/retry`, 'POST', {}),
    [messagesKey],
    'owner.system.sentAgain',
  );
  const rows = messages.data?.pages.flatMap((page) => page.items) ?? [];
  const notSent = rows.filter((row) => row.status === 'FAILED' || row.status === 'SKIPPED').length;
  const templateName = (template: string) => {
    const key = `owner.system.template.${template}`;
    return isMessageKey(key) ? t(key) : template;
  };
  return (
    <section className={`${css.card} ${own.section}`}>
      <h2>{t('owner.system.messages')}</h2>
      <p>{t('owner.system.messagesHelp')}</p>
      <QueryStatus query={messages} />
      {notSent > 0 && (
        <p>
          <StatusPill tone="red" label={t('owner.system.notSent', { count: notSent })} />
        </p>
      )}
      <Problem error={again.error} />
      {messages.data && !rows.length && <EmptyState title={t('owner.system.noMessages')} />}
      {!!rows.length && (
        <ul className={own.rows}>
          {rows.map((row) => {
            const failed = row.status === 'FAILED' || row.status === 'SKIPPED';
            return (
              <li key={row.id}>
                <div className={own.rowHead}>
                  <strong>{templateName(row.template)}</strong>
                  <StatusPill
                    tone={failed ? 'red' : row.status === 'SENT' ? 'green' : 'neutral'}
                    label={t(`owner.system.status.${row.status}`)}
                  />
                </div>
                <p className={css.hint}>
                  {row.recipient}
                  {row.attempts > 1 && ` · ${t('owner.system.tries', { count: row.attempts })}`}
                </p>
                {row.lastError && row.status !== 'SENT' && (
                  <p className={own.problemText}>{row.lastError}</p>
                )}
                <p className={css.date}>{momentLabel(row.createdAt, language)}</p>
                {failed && (
                  <div className={css.actions}>
                    <Button
                      variant="secondary"
                      disabled={again.isPending}
                      onClick={() => again.mutate(row.id)}
                    >
                      {t('owner.system.sendAgain')}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <MoreRows query={messages} />
    </section>
  );
}

/** Is everything running. Nothing here touches money, rates or stock. */
export function SystemPage() {
  const t = useT();
  const { can } = useOwner();
  const status = can('system.ops');
  const whatsapp = can('wa.admin');
  const messages = can('alerts.manage');
  if (!status && !whatsapp && !messages) return <NotYourPage />;
  return (
    <div className={css.stack}>
      <PageHeader title={t('owner.system.title')} sub={t('owner.system.subtitle')} />
      <div className={own.board}>
        <div className={own.column}>
          {status && <WorkWaiting />}
          {whatsapp && <WhatsAppCounts />}
        </div>
        {messages && (
          <div className={own.column}>
            <Messages />
          </div>
        )}
      </div>
    </div>
  );
}
