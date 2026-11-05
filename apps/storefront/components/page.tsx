import Link from 'next/link';
import type { ReactNode } from 'react';
import s from './page.module.css';

export { s as pageStyles };

export function PageHead({
  title,
  lead,
  crumbs,
  children,
}: {
  title: string;
  lead?: ReactNode;
  crumbs?: { href?: string; label: string }[];
  children?: ReactNode;
}) {
  return (
    <div className={s.head}>
      {crumbs?.length ? (
        <nav className={s.crumbs} aria-label="You are here">
          {crumbs.map((crumb, index) => (
            <span key={crumb.label}>
              {crumb.href ? (
                <Link href={crumb.href} prefetch={false}>
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current="page">{crumb.label}</span>
              )}
              {index < crumbs.length - 1 ? <span aria-hidden="true">&nbsp;/</span> : null}
            </span>
          ))}
        </nav>
      ) : null}
      <h1>{title}</h1>
      {lead ? <p className={s.lead}>{lead}</p> : null}
      {children}
    </div>
  );
}
