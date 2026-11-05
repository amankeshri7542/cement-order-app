import type { ReactNode } from 'react';
import { contentReview } from '../lib/review';

/**
 * A clearly labelled placeholder for something only the family can give. It renders in development
 * and review builds, so it can be found and filled, and never in a build customers can reach.
 */
export function Placeholder({ children, id }: { children: ReactNode; id?: string }) {
  if (!contentReview) return null;
  return (
    <p className="review" data-placeholder={id}>
      <b>Placeholder, not shown to customers.</b> {children}
    </p>
  );
}
