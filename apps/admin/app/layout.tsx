import { connection } from 'next/server';
import type { Metadata } from 'next';
import './styles.css';
import './rate-studio.css';
export const metadata: Metadata = {
  title: 'Shiv Cement Store · Store desk',
  description: 'Orders, inventory and delivery for Shiv Cement Store.',
};
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
