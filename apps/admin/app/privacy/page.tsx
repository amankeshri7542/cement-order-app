export const metadata = { title: 'Privacy · Shiv Cement Store' };
export default function Privacy() {
  return (
    <main className="policy-page">
      <a href="/">SHIV CEMENT STORE</a>
      <p className="eyebrow">YOUR DATA</p>
      <h1>Privacy, in plain language.</h1>
      <p>
        Last updated 2 October 2026. Shiv Cement Store operates this ordering service for its
        customers in Patna and Bihar.
      </p>
      <h2>What we collect and why</h2>
      <p>
        We use your mobile number for sign-in and order updates; your name and delivery address to
        fulfil orders; and your cart, order and quotation details to provide prices, deliveries and
        support. Contractor verification is a store decision; the app does not offer automatic
        credit.
      </p>
      <p>
        If you enable Android notifications, we store the device notification token. Signing out or
        revoking a session removes its notification devices. We store protected session credentials
        and limited device/browser labels for account security. OTP abuse counters use hashed
        network identifiers rather than raw IP addresses.
      </p>
      <h2>Service providers</h2>
      <p>
        When configured, our SMS provider processes sign-in messages, Razorpay processes online
        payments, Firebase delivers notifications, and our hosting and image-storage providers
        operate the service. We do not collect card numbers or UPI PINs. Delivery details are shared
        with the store and people fulfilling your delivery. We do not sell customer data or use
        advertising trackers in this app.
      </p>
      <h2>Your choices</h2>
      <p>
        You can edit your profile, remove saved addresses, disable notifications in your device
        settings, review signed-in devices and revoke sessions. Use Account → Delete account in the
        app or the public deletion page below to close your account.
      </p>
      <h2>Deletion and retained records</h2>
      <p>
        Account deletion removes sign-in sessions, notification tokens, saved addresses, cart and
        notifications, anonymizes your profile, and clears personal contact/address fields and notes
        in saved order and quotation snapshots. De-identified order totals, line items, payment
        references and audit events remain for reconciliation and record keeping. Provider records
        and backup copies follow their retention schedules. Do not enter unnecessary sensitive
        information in order notes.
      </p>
      <p>
        Open orders and refunds must be resolved first; contact the store for help. The store must
        document its legal retention period and backup expiry with its hosting/payment providers
        before public launch. This policy must match that deployed configuration.
      </p>
      <h2>Contact</h2>
      <p>
        For privacy questions or help with an unavailable phone number, use the store contact shown
        in the app. The current setup contact is <a href="tel:+919297513707">9297513707</a>.
      </p>
      <p>
        <a className="primary" href="/delete-account">
          Request account deletion
        </a>
      </p>
    </main>
  );
}
