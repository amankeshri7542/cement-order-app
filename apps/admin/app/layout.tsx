import type { Metadata } from 'next';
import './styles.css';
import './rate-studio.css';
export const metadata: Metadata = {
  title: 'Shiv Cement Store · Store desk',
  description: 'Orders, inventory and delivery for Shiv Cement Store.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
