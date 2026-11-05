import type { Metadata } from 'next';
import Link from 'next/link';
import { pageStyles as s, PageHead } from '../../../components/page';
import { Placeholder } from '../../../components/review';
import { readClientConfig } from '../../../lib/public-data';
import { pageMeta } from '../../../lib/seo';
import { indexingOn } from '../../../lib/site';

export const metadata: Metadata = {
  ...pageMeta(
    '/privacy',
    'Privacy',
    'How Shiv Cement Store uses your number, your address and your list, in plain words.',
  ),
  robots: indexingOn ? { index: true, follow: true } : { index: false, follow: false },
};
const whatsappPartner = process.env.NEXT_PUBLIC_WHATSAPP_PARTNER;

export default async function PrivacyPage() {
  const config = await readClientConfig();
  return (
    <div className={s.page}>
      <PageHead title="Privacy, in plain language" lead="Last updated 5 November 2026." />
      <div className={s.prose} style={{ marginTop: '2rem' }}>
        <h2>What we collect and why</h2>
        <p>
          Shiv Cement Store runs this website and the customer app for its customers in Patna and
          Bihar. We use your mobile number to sign you in and to send order updates; your name and
          delivery address to fulfil orders; and your list, orders and rate requests to give you
          rates, deliveries and support.
        </p>
        <p>
          If you send a message or complaint through the Contact page, we keep your name, number,
          pincode and message so the shop can reply. A handled message is deleted after 180 days and
          an unanswered one after one year.
        </p>
        <p>
          If you turn on Android notifications, we store the notification token of your phone.
          Signing out removes it. We keep protected session credentials and limited device or
          browser labels for account security. Sign-in abuse counters use hashed network
          identifiers, not raw IP addresses.
        </p>
        <h2>Cookies and storage</h2>
        <p>
          The website uses only what it needs: sign-in cookies when you sign in, and local storage
          in your browser for your list and your last checked pincode. There are no advertising or
          tracking cookies. We count page speed and steps such as adding to a list, anonymously,
          with no cookie and no address stored.
        </p>
        <h2>WhatsApp messages to the shop</h2>
        <p>
          {whatsappPartner
            ? `Messages sent to the shop's WhatsApp number pass through Meta (WhatsApp) and our WhatsApp partner, ${whatsappPartner}, to our server.`
            : "The shop's WhatsApp number is not connected to this service yet. Before it is, this page will name the WhatsApp partner the messages pass through, along with Meta (WhatsApp)."}{' '}
          Once connected, a computer program reads messages about orders and rates and prepares a
          draft for a person at the shop. At this stage it sends you nothing and cannot confirm an
          order. Only a person at the shop confirms orders.
        </p>
        <p>
          Plain typed orders are read by our own rules. Other messages about the shop&apos;s
          business may go to Google&apos;s Gemini model, on a paid plan that does not use them to
          improve Google&apos;s products. Google receives the words of the message and our product
          list, not your name, number or account.
        </p>
        <p>
          We keep the words of these messages for 30 days and then delete them. We do not keep voice
          notes or photos. Messages that are not about the shop&apos;s business are not kept, and
          numbers the shop marks as family or personal are never read. Write STOP on WhatsApp to
          stop your messages being read, or ask the shop.
        </p>
        <h2>Service providers</h2>
        <p>
          When configured, an SMS provider delivers sign-in codes, Firebase delivers app
          notifications, an error-reporting service receives crash reports with personal details
          removed, and our hosting and storage providers run the service. Delivery details are
          shared with the shop and the people delivering your order. We do not sell customer data or
          use advertising trackers.
        </p>
        <p>
          Orders on the website are paid on delivery, so we do not collect card numbers or UPI PINs.
        </p>
        {config.askEnabled ? (
          <p>
            Shiv Cement AI answers questions about materials. The question you type or speak is sent
            as text to Anthropic to prepare the answer, without your name, number or account. Please
            do not include personal details in a question.
          </p>
        ) : null}
        <h2>Your choices</h2>
        <p>
          You can edit your profile, remove saved addresses, turn off notifications in your
          phone&apos;s settings, review signed-in devices and sign them out. To close your account,
          use Account, then Delete account in the app, or the deletion page.
        </p>
        <p>
          <Link className="btn btn-line" href="/delete-account" prefetch={false}>
            Request account deletion
          </Link>
        </p>
        <h2>Deletion and what is kept</h2>
        <p>
          Deleting your account signs out every device and removes your saved addresses, list,
          notifications and profile details, and clears personal contact and address details and
          notes from saved orders and rate requests. Order totals, items, payment references and
          audit entries stay without your personal details, for the shop&apos;s accounts and
          records. Provider records and backup copies follow their own retention schedules. Open
          orders and refunds, and any khata (credit) balance, must be settled first; contact the
          shop for help.
        </p>
        <h2>Contact</h2>
        <p>
          For privacy questions, or help if you no longer have the phone number on your account, use
          the{' '}
          <Link className="link" href="/contact" prefetch={false}>
            Contact page
          </Link>
          .
        </p>
        <Placeholder id="privacy-retention">
          The shop must document its legal retention period and backup expiry with its providers
          before launch, and this page must match what is deployed. A lawyer should also say whether
          a Hindi notice is needed by May 2027 (plan 03 question A2).
        </Placeholder>
      </div>
    </div>
  );
}
