import { Suspense } from 'react';
import { TallyPage } from '../../../components/owner/tally';

export default function Tally() {
  return (
    <Suspense>
      <TallyPage />
    </Suspense>
  );
}
