'use client';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@shiv/design';
import type { Page } from '@shiv/shared';
import { api } from '../../lib/api';
import { useLanguage, useT } from '../../lib/i18n';
import { useAction } from '../../lib/owner';
import { ContactActions } from './common';
import css from './owner.module.css';

/** A question a visitor sent from the website's Contact page (apps/api/src/web-enquiries.ts). */
export type Enquiry = {
  id: string;
  createdAt: string;
  name: string;
  phone: string;
  pincode: string | null;
  message: string;
  interest: string | null;
  status: 'NEW' | 'HANDLED';
};

export function useNewEnquiries() {
  return useQuery({
    queryKey: ['enquiries', 'new'],
    queryFn: () => api<Page<Enquiry>>('/admin/enquiries?status=NEW&limit=20'),
  });
}

function EnquiryCard({ enquiry }: { enquiry: Enquiry }) {
  const t = useT();
  const { language } = useLanguage();
  const handle = useAction(
    (id: string) => api(`/admin/enquiries/${id}/handle`, 'POST', {}),
    [['enquiries']],
    'owner.enquiryHandledDone',
  );
  const when = new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(enquiry.createdAt));
  return (
    <article className={css.card}>
      <div className={css.row}>
        <div>
          <h3>{enquiry.name}</h3>
          <p>
            <time dateTime={enquiry.createdAt}>{when}</time>
            {enquiry.pincode ? ` · ${t('owner.enquiryPincode', { pincode: enquiry.pincode })}` : ''}
          </p>
        </div>
      </div>
      {enquiry.interest ? (
        <p>
          <strong>{t('owner.enquiryAbout', { interest: enquiry.interest })}</strong>
        </p>
      ) : null}
      <p style={{ whiteSpace: 'pre-wrap' }}>{enquiry.message}</p>
      <ContactActions
        phone={enquiry.phone}
        text={t('owner.enquiryReply', { name: enquiry.name.split(/\s+/)[0] ?? '' })}
      />
      <Button
        variant="secondary"
        className={css.wide}
        disabled={handle.isPending}
        onClick={() => handle.mutate(enquiry.id)}
      >
        {t('owner.enquiryHandled')}
      </Button>
    </article>
  );
}

export function EnquiryCards({ items }: { items: Enquiry[] }) {
  const t = useT();
  if (!items.length) return null;
  return (
    <section className={css.stack} aria-label={t('owner.enquiries')}>
      <h2>{t('owner.enquiries')}</h2>
      {items.map((enquiry) => (
        <EnquiryCard key={enquiry.id} enquiry={enquiry} />
      ))}
    </section>
  );
}
