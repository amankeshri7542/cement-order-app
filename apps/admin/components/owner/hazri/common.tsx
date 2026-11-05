'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Coffee, Eye, Minus } from 'lucide-react';
import { Button, Sheet, Skeleton } from '@shiv/design';
import type { DayStatus } from '@shiv/shared';
import { api, apiBlob, ApiError } from '../../../lib/api';
import { useT, useWords } from '../../../lib/i18n';
import { useOwner } from '../../../lib/owner';
import { Problem } from '../common';
import css from '../owner.module.css';
import { qrPath, startCodeLoop } from './code-loop';
import own from './hazri.module.css';
import type { WallData } from './types';
import { statusKey } from './words';

const looks: Record<DayStatus, { Mark: typeof Check; tone: string }> = {
  PRESENT: { Mark: Check, tone: own.toneOk! },
  REVIEW: { Mark: Eye, tone: own.toneLook! },
  ABSENT: { Mark: Minus, tone: own.toneQuiet! },
  WEEKLY_OFF: { Mark: Coffee, tone: own.toneQuiet! },
};
/** A status with a shape as well as a colour, so it reads in sun and for anyone who cannot see red. */
export function HazriStatus({ status }: { status: DayStatus }) {
  const t = useT();
  const { Mark, tone } = looks[status];
  return (
    <span className={`${own.status} ${tone}`}>
      <Mark size={16} aria-hidden="true" />
      {t(statusKey[status])}
    </span>
  );
}

/** A private picture, read with this person's session. It never gets an address of its own. */
export function EvidencePhoto({ id, later = false }: { id: string; later?: boolean }) {
  const t = useT();
  const words = useWords();
  const [asked, setAsked] = useState(!later);
  const photo = useQuery({
    enabled: asked,
    // Each read goes on the record, so one card reads it once.
    queryKey: ['evidence', id],
    queryFn: () => apiBlob(`/admin/evidence/${id}`),
    staleTime: Infinity,
    gcTime: 5 * 60000,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!photo.data) return;
    const made = URL.createObjectURL(photo.data);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [photo.data]);
  if (!asked)
    return (
      <Button variant="secondary" onClick={() => setAsked(true)}>
        {t('owner.evidence.show')}
      </Button>
    );
  if (photo.error)
    return (
      <p className={css.hint} role="status">
        {photo.error instanceof ApiError && photo.error.code === 'NOT_FOUND'
          ? t('owner.evidence.gone')
          : words.error(photo.error)}
      </p>
    );
  if (!url) return <Skeleton label={t('owner.loading')} />;
  return <img className={own.photo} src={url} alt={t('owner.evidence.alt')} />;
}

/** The rotating code as big black squares. Drawn, not injected, so the CSP has nothing to object to. */
export function QrCode({ text, className }: { text: string; className?: string }) {
  const t = useT();
  const { path, box } = useMemo(() => qrPath(text), [text]);
  return (
    <svg
      className={className}
      viewBox={`0 0 ${box} ${box}`}
      role="img"
      aria-label={t('owner.screen.qrLabel')}
      shapeRendering="crispEdges"
    >
      <rect width={box} height={box} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

/**
 * "Yahan QR dikhao": a dead screen must not stop the shop. Lives only while this sheet is open, and
 * the record shows the scan came from this person's code.
 */
export function ShowHere({
  locationId,
  shopName,
  close,
}: {
  locationId: string;
  shopName: string;
  close: () => void;
}) {
  const t = useT();
  const { offline } = useOwner();
  const [wall, setWall] = useState<WallData | null>(null);
  const [trouble, setTrouble] = useState<unknown>(null);
  const [refused, setRefused] = useState<unknown>(null);
  useEffect(() => {
    const started = startCodeLoop({
      load: () => api<WallData>(`/admin/screens/here/${locationId}`),
      onWall: (next) => {
        setWall(next);
        setTrouble(null);
      },
      onTrouble: setTrouble,
      onGone: setRefused,
      isGone: (error) =>
        error instanceof ApiError &&
        ['FORBIDDEN', 'UNAUTHORIZED', 'NOT_FOUND'].includes(error.code),
    });
    return () => started.stop();
  }, [locationId]);
  return (
    <Sheet
      title={t('owner.hazri.here.title', { shop: shopName })}
      closeLabel={t('owner.close')}
      onClose={close}
    >
      <div className={css.stack}>
        <p className={css.hint}>{t('owner.hazri.here.body')}</p>
        <Problem error={refused} />
        {!refused && wall && <QrCode text={wall.qr} className={own.hereQr} />}
        {!refused && !wall && !trouble && <Skeleton label={t('owner.loading')} />}
        {!refused && (trouble || offline) ? (
          <p className={own.lookBlock} role="status">
            {t('owner.screen.offline')}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
