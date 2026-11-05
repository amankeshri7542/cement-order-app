'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button, Field, Sheet } from '@shiv/design';
import { dayLabel, istToday, timeLabel } from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { API_URL, api } from '../../../lib/api';
import { useLanguage, useT, useWords } from '../../../lib/i18n';
import { useAction, useOwner } from '../../../lib/owner';
import { Problem, QueryStatus } from '../common';
import own from '../crm/crm.module.css';
import css from '../owner.module.css';
import {
  bytesWord,
  isOld,
  isVersion,
  justNow,
  pairCommand,
  pcGone,
  pcWord,
  roleWord,
  tieWord,
  type Tone,
} from './pure';
import tally from './tally.module.css';
import type { CompanyRole, TallyCompany, TallyPc, TallyStatus } from './types';

/** The health route adds jobs for those who hold it. Either way it is the same page of facts. */
export function useTallyStatus() {
  const { can } = useOwner();
  return useQuery({
    queryKey: ['tally', 'status'],
    queryFn: () =>
      api<TallyStatus>(can('tally.health') ? '/admin/tally/health' : '/admin/tally/status'),
    refetchInterval: 60000,
  });
}

const toneClass: Record<Tone, string> = {
  good: own.tagGood ?? '',
  look: own.tagLook ?? '',
  bad: own.tagBad ?? '',
  plain: '',
};
/** A word plus a shape, never colour alone. */
export function Tag({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`${own.tag} ${toneClass[tone]} ${tally.wrapTag}`}>{children}</span>;
}

/** The two lines the accountant follows, shown wherever Tally's own setting is the problem. */
function SettingLines() {
  const t = useT();
  return (
    <>
      <p className={tally.setting}>{t('owner.tally.port.prime')}</p>
      <p className={tally.setting}>{t('owner.tally.port.erp9')}</p>
    </>
  );
}

/** Until a PC is installed this is the whole page, so it says what to do next, for this person. */
function NotConnected({ onConnect }: { onConnect: () => void }) {
  const t = useT();
  const { can } = useOwner();
  const steps: MessageKey[] = [
    'owner.tally.empty.step1',
    'owner.tally.empty.step2',
    'owner.tally.empty.step3',
    'owner.tally.empty.step4',
  ];
  return (
    <section className={`${css.card} ${tally.cardBody}`} aria-label={t('owner.tally.pcs')}>
      <h2 className={tally.title}>{t('owner.crm.tally.notConnected')}</h2>
      <p className={tally.line}>{t('owner.tally.empty.body')}</p>
      {can('tally.devices') ? (
        <>
          <h3 className={tally.subtitle}>{t('owner.tally.empty.next')}</h3>
          <ol className={tally.steps}>
            {steps.map((step) => (
              <li key={step}>{t(step)}</li>
            ))}
          </ol>
          <div className={own.buttons}>
            <Button type="button" onClick={onConnect}>
              {t('owner.tally.connect')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className={tally.line}>{t('owner.tally.empty.notYours')}</p>
          {can('tally.match') && (
            <>
              <p className={tally.line}>{t('owner.tally.empty.prepare')}</p>
              <SettingLines />
            </>
          )}
        </>
      )}
    </section>
  );
}

/** The code exists on this screen and nowhere else: only its keyed hash is kept on the server. */
function PairSheet({ close }: { close: () => void }) {
  const t = useT();
  const { shops } = useOwner();
  const [name, setName] = useState('');
  const [shop, setShop] = useState('');
  const [made, setMade] = useState<{ code: string; expiresAt: string; name: string } | null>(null);
  const make = useAction(async () => {
    const result = await api<{ code: string; expiresAt: string }>(
      '/admin/tally/devices/pair',
      'POST',
      { name: name.trim(), ...(shop ? { locationId: shop } : {}) },
    );
    // Kept in this sheet's own state and not returned, so no cache ever holds it.
    setMade({ ...result, name: name.trim() });
  }, [['tally']]);
  return (
    <Sheet
      title={made ? t('owner.tally.pair.codeTitle', { pc: made.name }) : t('owner.tally.connect')}
      closeLabel={t('owner.close')}
      onClose={close}
    >
      {made ? (
        <div className={own.sheetBody}>
          <p className={tally.code} data-testid="pair-code">
            {made.code}
          </p>
          <p className={tally.line}>
            {t('owner.tally.pair.once', { time: timeLabel(made.expiresAt) })}
          </p>
          <p className={tally.line}>{t('owner.tally.pair.howTo')}</p>
          <pre className={tally.command}>{pairCommand(made.code, API_URL)}</pre>
          <p className={tally.line}>{t('owner.tally.pair.then')}</p>
          <Button type="button" className={css.wide} onClick={close}>
            {t('owner.tally.pair.done')}
          </Button>
        </div>
      ) : (
        <form
          className={own.sheetBody}
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) make.mutate();
          }}
        >
          <Field label={t('owner.tally.pair.name')}>
            <input
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {shops.length > 0 && (
            <Field label={t('owner.tally.pair.shop')}>
              <select value={shop} onChange={(event) => setShop(event.target.value)}>
                <option value="">{t('owner.tally.pair.noShop')}</option>
                {shops.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Problem error={make.error} />
          <Button className={css.wide} disabled={make.isPending || !name.trim()}>
            {t('owner.tally.pair.make')}
          </Button>
        </form>
      )}
    </Sheet>
  );
}

function PcCard({
  pc,
  companies,
  technical,
  serverNow,
}: {
  pc: TallyPc;
  companies: TallyCompany[];
  technical: boolean;
  serverNow: string;
}) {
  const t = useT();
  const words = useWords();
  const { can, confirm, shops } = useOwner();
  const mayAct = can('tally.devices');
  const word = pcWord(pc.state, technical);
  const shop = shops.find((row) => row.id === pc.locationId)?.name;
  const caps = pc.caps ?? {};
  const pause = useAction(
    async (paused: boolean) => {
      await api('/admin/tally/pause', 'POST', { paused, deviceId: pc.id });
    },
    [['tally']],
    'owner.saved',
  );
  const cut = useAction(
    async () => {
      await api(`/admin/tally/devices/${pc.id}/revoke`, 'POST');
    },
    [['tally']],
    'owner.tally.cutDone',
  );
  const facts = [
    shop,
    pc.version ? t('owner.tally.versionLine', { version: pc.version }) : '',
    pc.targetVersion && pc.targetVersion !== pc.version
      ? t('owner.tally.versionNext', { version: pc.targetVersion })
      : '',
  ].filter(Boolean);
  const missing = companies
    .filter((company) => company.ownerDeviceId === pc.id && company.role === 'PRIMARY')
    .map((company) => company.name)
    .join(', ');
  return (
    <article className={`${css.card} ${tally.cardBody}`}>
      <div className={own.spread}>
        <h3 className={tally.title}>{pc.name}</h3>
        <Tag tone={word.tone}>{t(word.tag)}</Tag>
      </div>
      {facts.length > 0 && <p className={own.quiet}>{facts.join(' · ')}</p>}
      {(pc.state === 'OK' || pc.state === 'BUSY') && pc.lastHeartbeatAt && (
        <p className={tally.line}>
          {justNow(pc.lastHeartbeatAt, serverNow)
            ? t('owner.tally.justHeard')
            : t('owner.tally.lastHeard', { age: words.age(pc.lastHeartbeatAt) })}
        </p>
      )}
      {pc.state === 'PC_ASLEEP' && pc.lastHeartbeatAt && (
        <p className={tally.line}>
          {t('owner.tally.state.PC_ASLEEPBody', { when: words.moment(pc.lastHeartbeatAt) })}
        </p>
      )}
      {pc.state === 'PC_SILENT' && (
        <p className={own.look}>
          {t('owner.tally.silent', {
            pc: pc.name,
            at: pc.lastGoodAt ? words.moment(pc.lastGoodAt) : '-',
          })}
        </p>
      )}
      {pc.state === 'COMPANY_MISSING' && (
        <p className={own.look}>
          {t('owner.tally.state.COMPANY_MISSINGBody', { name: missing || pc.name })}
        </p>
      )}
      {word.body && <p className={word.tone === 'look' ? own.look : tally.line}>{t(word.body)}</p>}
      {word.setting && <SettingLines />}
      {technical && pc.state === 'BUSY' && caps.slowMs !== undefined && (
        <p className={own.quiet}>
          {t('owner.tally.state.BUSYBody', { seconds: Math.round(caps.slowMs / 1000) })}
        </p>
      )}
      {caps.diskFreeMb !== undefined && caps.diskFreeMb < 1024 && (
        <p className={own.look}>{t('owner.tally.diskLow', { pc: pc.name })}</p>
      )}
      {caps.updateFailed && (
        <p className={own.look}>{t('owner.tally.updateFailed', { pc: pc.name })}</p>
      )}
      {!!caps.claimedElsewhere && (
        <p className={own.look}>{t('owner.tally.claimed', { pc: pc.name })}</p>
      )}
      {caps.releaseChangedOn === istToday() && (
        <p className={own.quiet}>{t('owner.tally.release', { pc: pc.name })}</p>
      )}
      {mayAct && (
        <div className={own.buttons}>
          <Button
            type="button"
            variant="secondary"
            disabled={pause.isPending}
            onClick={() => pause.mutate(!pc.paused)}
          >
            {t(pc.paused ? 'owner.tally.resumePc' : 'owner.tally.pausePc')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={cut.isPending}
            onClick={() =>
              void confirm({
                title: t('owner.tally.cutOffTitle', { pc: pc.name }),
                body: t('owner.tally.cutOffBody'),
                confirmLabel: t('owner.tally.cutOffYes'),
              }).then((yes) => {
                if (yes) cut.mutate();
              })
            }
          >
            {t('owner.tally.cutOff')}
          </Button>
        </div>
      )}
      <Problem error={pause.error ?? cut.error} />
    </article>
  );
}

function useSetCompany(company: TallyCompany) {
  const t = useT();
  const { confirm } = useOwner();
  const save = useAction(
    async (body: { role?: CompanyRole; ownerDeviceId?: string }) => {
      await api(`/admin/tally/companies/${company.id}`, 'POST', body);
    },
    // Whether this file counts decides the Tally numbers on every customer of it.
    [['tally'], ['customers', 'crm'], ['crm']],
    'owner.saved',
  );
  const choose = async (role: CompanyRole) => {
    if (role === company.role) return;
    const starts = role === 'PRIMARY';
    const leaves = company.role === 'PRIMARY';
    if (starts || leaves) {
      const yes = await confirm(
        starts
          ? {
              title: t('owner.tally.company.primaryTitle', { name: company.name }),
              body: t('owner.tally.company.primaryBody'),
              confirmLabel: t('owner.tally.company.primaryYes'),
            }
          : {
              title: t('owner.tally.company.leaveTitle', { name: company.name }),
              body: t('owner.tally.company.leaveBody'),
              confirmLabel: t('owner.tally.company.leaveYes'),
            },
      );
      if (!yes) return;
    }
    save.mutate({ role });
  };
  return { save, choose };
}

const roleButtons: { role: CompanyRole; word: MessageKey }[] = [
  { role: 'PRIMARY', word: 'owner.tally.company.setPrimary' },
  { role: 'BRANCH_COPY', word: 'owner.tally.company.setCopy' },
  { role: 'IGNORE', word: 'owner.tally.company.setIgnore' },
];

function CompanySheet({
  company,
  pcs,
  close,
}: {
  company: TallyCompany;
  pcs: TallyPc[];
  close: () => void;
}) {
  const t = useT();
  const { save, choose } = useSetCompany(company);
  const live = pcs.filter((pc) => !pc.revoked);
  return (
    <Sheet
      title={t('owner.tally.company.changeTitle', { name: company.name })}
      closeLabel={t('owner.close')}
      onClose={close}
    >
      <div className={own.sheetBody}>
        <div className={own.buttons}>
          {roleButtons.map(({ role, word }) => (
            <Button
              key={role}
              type="button"
              variant={role === company.role ? 'primary' : 'secondary'}
              aria-pressed={role === company.role}
              disabled={save.isPending}
              onClick={() => void choose(role)}
            >
              {t(word)}
            </Button>
          ))}
        </div>
        {live.length > 0 && (
          <Field label={t('owner.tally.company.whichPc')}>
            <select
              value={
                live.some((pc) => pc.id === company.ownerDeviceId) ? company.ownerDeviceId! : ''
              }
              disabled={save.isPending}
              onChange={(event) => {
                if (event.target.value) save.mutate({ ownerDeviceId: event.target.value });
              }}
            >
              {!live.some((pc) => pc.id === company.ownerDeviceId) && <option value="" />}
              {live.map((pc) => (
                <option key={pc.id} value={pc.id}>
                  {pc.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Problem error={save.error} />
        <Button type="button" variant="secondary" onClick={close}>
          {t('owner.close')}
        </Button>
      </div>
    </Sheet>
  );
}

function CompanyCard({
  company,
  pcs,
  serverNow,
}: {
  company: TallyCompany;
  pcs: TallyPc[];
  serverNow: string;
}) {
  const t = useT();
  const words = useWords();
  const { language } = useLanguage();
  const { can } = useOwner();
  const mayAct = can('tally.devices');
  const [changing, setChanging] = useState(false);
  const { save, choose } = useSetCompany(company);
  const pending = company.role === 'PENDING';
  const primary = company.role === 'PRIMARY';
  const tie = tieWord(company.tieOut);
  const phaseKey: MessageKey | null =
    company.phase === 'MASTERS'
      ? 'owner.tally.phase.MASTERS'
      : company.phase === 'BASELINE'
        ? 'owner.tally.phase.BASELINE'
        : company.phase === 'BACKFILL'
          ? 'owner.tally.phase.BACKFILL'
          : company.phase === 'LIVE'
            ? 'owner.tally.phase.LIVE'
            : null;
  return (
    <article className={`${css.card} ${tally.cardBody}`}>
      <div className={own.spread}>
        <h3 className={tally.title}>{company.name}</h3>
        {/* Green is for a tie-out that passed. Being the real books says nothing about its health. */}
        <Tag tone={pending ? 'look' : 'plain'}>{t(roleWord(company.role))}</Tag>
      </div>
      {company.sameNameAsId && <p className={own.look}>{t('owner.tally.company.sameName')}</p>}
      {pending && (
        <>
          <p className={own.look}>{t('owner.tally.company.pendingBody')}</p>
          <p className={tally.line}>
            {t(mayAct ? 'owner.tally.company.pendingAsk' : 'owner.tally.company.pendingNotYours')}
          </p>
          {mayAct && (
            <div className={own.buttons}>
              {roleButtons.map(({ role, word }) => (
                <Button
                  key={role}
                  type="button"
                  variant={role === 'PRIMARY' ? 'primary' : 'secondary'}
                  disabled={save.isPending}
                  onClick={() => void choose(role)}
                >
                  {t(word)}
                </Button>
              ))}
            </div>
          )}
        </>
      )}
      {primary && (
        <>
          {phaseKey && (
            <p className={tally.line}>{t(phaseKey, { percent: company.copiedPercent })}</p>
          )}
          {company.phase === 'BACKFILL' && (
            <>
              <progress
                className={tally.bar}
                max={100}
                value={company.copiedPercent}
                aria-label={t('owner.tally.phase.BACKFILL', { percent: company.copiedPercent })}
              />
              {company.copiedBackTo && (
                <p className={own.quiet}>
                  {t('owner.tally.phase.backTo', {
                    day: dayLabel(company.copiedBackTo, language),
                  })}
                </p>
              )}
            </>
          )}
          <p className={tally.line}>
            {company.freshAt
              ? t('owner.tally.fresh', { when: words.moment(company.freshAt) })
              : t('owner.tally.neverFresh')}
          </p>
          {company.freshAt && isOld(company.freshAt, serverNow) && (
            <p className={own.look}>
              {t('owner.tally.oldCopy', { when: words.moment(company.freshAt) })}
            </p>
          )}
          <div className={own.row}>
            <Tag tone={tie.tone}>
              {t(tie.word, {
                total: company.tieOut.total ?? 0,
                failed: company.tieOut.failed ?? 0,
              })}
            </Tag>
          </div>
          {company.vouchers > 0 && (
            <p className={own.quiet}>
              {t('owner.tally.company.vouchers', { count: company.vouchers })}
            </p>
          )}
          {company.failures >= 3 && (
            <p className={own.look}>
              {t('owner.tally.syncFailed', {
                company: company.name,
                at: company.freshAt ? words.moment(company.freshAt) : '-',
              })}
            </p>
          )}
          {pcGone(company, pcs) && <p className={own.look}>{t('owner.tally.company.pcGone')}</p>}
        </>
      )}
      <Problem error={save.error} />
      {mayAct && !pending && (
        <div className={own.buttons}>
          <Button type="button" variant="ghost" onClick={() => setChanging(true)}>
            {t('owner.tally.company.change')}
          </Button>
        </div>
      )}
      {changing && <CompanySheet company={company} pcs={pcs} close={() => setChanging(false)} />}
    </article>
  );
}

/** For whoever keeps the PCs running. A person chooses each version, and nothing updates alone. */
function VersionRow({ pc }: { pc: TallyPc }) {
  const t = useT();
  const [version, setVersion] = useState(pc.targetVersion ?? '');
  const [bad, setBad] = useState(false);
  const save = useAction(
    async (next: string | null) => {
      await api(`/admin/tally/devices/${pc.id}/release`, 'POST', { version: next });
    },
    [['tally']],
    'owner.saved',
  );
  return (
    <form
      className={tally.rowEnd}
      onSubmit={(event) => {
        event.preventDefault();
        const next = version.trim();
        setBad(!isVersion(next));
        if (isVersion(next)) save.mutate(next);
      }}
    >
      <Field
        label={t('owner.tally.tech.versionFor', { pc: pc.name })}
        error={bad ? t('owner.tally.tech.versionBad') : undefined}
      >
        <input
          className={tally.narrowField}
          value={version}
          maxLength={14}
          onChange={(event) => setVersion(event.target.value)}
        />
      </Field>
      <div className={own.buttons}>
        <Button variant="secondary" disabled={save.isPending}>
          {t('owner.tally.tech.versionSave')}
        </Button>
        {pc.targetVersion && (
          <Button
            type="button"
            variant="ghost"
            disabled={save.isPending}
            onClick={() => {
              setVersion('');
              setBad(false);
              save.mutate(null);
            }}
          >
            {t('owner.tally.tech.versionClear')}
          </Button>
        )}
      </div>
      <Problem error={save.error} />
    </form>
  );
}

function ReleaseUpload() {
  const t = useT();
  const { notice } = useOwner();
  const add = useAction(
    async (file: File) => {
      let release: { version?: unknown };
      try {
        // Above the route's own limit it could not be taken anyway.
        if (file.size > 8 * 1024 * 1024) throw new Error('Too big');
        release = JSON.parse(await file.text()) as { version?: unknown };
      } catch {
        notice(t('owner.tally.tech.releaseBad'), true);
        return;
      }
      await api('/admin/tally/releases', 'POST', release);
      notice(t('owner.tally.tech.releaseAdded', { version: String(release.version) }));
    },
    [['tally']],
  );
  return (
    <div className={tally.cardBody}>
      <h4 className={tally.subtitle}>{t('owner.tally.tech.release')}</h4>
      <Field label={t('owner.tally.tech.releaseFile')}>
        <input
          type="file"
          accept=".json,application/json"
          disabled={add.isPending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) add.mutate(file);
          }}
        />
      </Field>
      <Problem error={add.error} />
    </div>
  );
}

function TechnicalDetails({ status }: { status: TallyStatus }) {
  const t = useT();
  const words = useWords();
  const { can } = useOwner();
  const jobs = status.jobs ?? [];
  const live = status.devices.filter((pc) => !pc.revoked);
  return (
    <details className={`${css.card} ${tally.details}`}>
      <summary>{t('owner.tally.tech.title')}</summary>
      <div className={tally.cardBody}>
        <p className={own.quiet}>
          {t('owner.tally.tech.parts', {
            count: status.storedParts ?? 0,
            size: bytesWord(status.storedBytes ?? 0),
          })}
        </p>
        <h4 className={tally.subtitle}>{t('owner.tally.tech.jobs')}</h4>
        {jobs.length ? (
          <div className={own.scroll}>
            <table className={own.table}>
              <thead>
                <tr>
                  <th>{t('owner.tally.tech.kind')}</th>
                  <th>{t('owner.tally.tech.result')}</th>
                  <th>{t('owner.tally.tech.when')}</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.kind}</td>
                    <td>{[job.status, job.error].filter(Boolean).join(' · ')}</td>
                    <td>{words.moment(job.finishedAt ?? job.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={own.quiet}>{t('owner.tally.tech.noJobs')}</p>
        )}
        {can('tally.devices') && (
          <>
            {live.map((pc) => (
              <VersionRow key={pc.id} pc={pc} />
            ))}
            <ReleaseUpload />
          </>
        )}
      </div>
    </details>
  );
}

export function Haal() {
  const t = useT();
  const { can, confirm, notice } = useOwner();
  const status = useTallyStatus();
  const [pairing, setPairing] = useState(false);
  const mayAct = can('tally.devices');
  // Only the technical operator is told Tally is slow. Owners have nothing to do about it.
  const technical = can('tally.health') && !can('tally.numbers.view');
  const pause = useAction(
    async (paused: boolean) => {
      await api('/admin/tally/pause', 'POST', { paused });
      notice(t(paused ? 'owner.tally.paused' : 'owner.tally.resumed'));
    },
    [['tally']],
  );
  const data = status.data;
  if (!data) return <QueryStatus query={status} />;
  const live = data.devices.filter((pc) => !pc.revoked);
  const cut = data.devices.filter((pc) => pc.revoked);
  const allPaused = live.length > 0 && live.every((pc) => pc.paused);
  return (
    <div className={tally.page}>
      {technical && <p className={own.quiet}>{t('owner.tally.techOnly')}</p>}
      {live.length === 0 ? (
        <NotConnected onConnect={() => setPairing(true)} />
      ) : (
        <section className={tally.section} aria-label={t('owner.tally.pcs')}>
          <div className={own.spread}>
            <h2 className={tally.title}>{t('owner.tally.pcs')}</h2>
            {mayAct && (
              <div className={own.buttons}>
                <Button type="button" variant="secondary" onClick={() => setPairing(true)}>
                  {t('owner.tally.connect')}
                </Button>
                <Button
                  type="button"
                  variant={allPaused ? 'primary' : 'secondary'}
                  disabled={pause.isPending}
                  onClick={() => {
                    if (allPaused) {
                      pause.mutate(false);
                      return;
                    }
                    void confirm({
                      title: t('owner.tally.pauseAllTitle'),
                      body: t('owner.tally.pauseAllBody'),
                      confirmLabel: t('owner.tally.pauseAllYes'),
                    }).then((yes) => {
                      if (yes) pause.mutate(true);
                    });
                  }}
                >
                  {t(allPaused ? 'owner.tally.resumeAll' : 'owner.tally.pauseAll')}
                </Button>
              </div>
            )}
          </div>
          <Problem error={pause.error} />
          <div className={tally.cards}>
            {live.map((pc) => (
              <PcCard
                key={pc.id}
                pc={pc}
                companies={data.companies}
                technical={technical}
                serverNow={data.serverNow}
              />
            ))}
          </div>
        </section>
      )}
      {data.companies.length > 0 ? (
        <section className={tally.section} aria-label={t('owner.tally.companies')}>
          <h2 className={tally.title}>{t('owner.tally.companies')}</h2>
          {live.length === 0 && <p className={own.look}>{t('owner.tally.noPc')}</p>}
          <div className={tally.cards}>
            {data.companies.map((company) => (
              <CompanyCard
                key={company.id}
                company={company}
                pcs={data.devices}
                serverNow={data.serverNow}
              />
            ))}
          </div>
        </section>
      ) : (
        data.connected && <p className={own.look}>{t('owner.tally.company.none')}</p>
      )}
      {cut.length > 0 && (
        <details className={`${css.card} ${tally.details}`}>
          <summary>{t('owner.tally.cutPcs', { count: cut.length })}</summary>
          <ul className={own.lines}>
            {cut.map((pc) => (
              <li key={pc.id}>
                <span>{pc.name}</span>
                <span className={own.quiet}>{t('owner.tally.state.REVOKED')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {can('tally.numbers.view') && data.companies.some((row) => row.role === 'PRIMARY') && (
        <div>
          <Link className={css.inlineLink} href="/reports/hisaab?tab=suppliers">
            {t('owner.crm.report.suppliers')} <span aria-hidden="true">→</span>
          </Link>
        </div>
      )}
      {can('tally.health') && data.devices.length > 0 && <TechnicalDetails status={data} />}
      {pairing && <PairSheet close={() => setPairing(false)} />}
    </div>
  );
}
