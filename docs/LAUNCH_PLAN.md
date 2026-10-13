# Launch plan: the first 50–100 customers

The repository is a tested MVP, not a deployed production service. Start with a small, supervised COD pilot. Fifty to one hundred registered customers do not justify microservices; simultaneous checkout traffic and delivery capacity matter more than registration count.

## 1. Make store operations accurate

- Replace sample products, prices, stock and illustrations with your actual catalogue and permitted product photos. Confirm units, minimum quantities and unloading charges.
- Set the store contact (currently 9297513707), delivery charges and free-delivery threshold in admin. The current ₹500/₹50,000 values are development examples.
- Start with a delivery area your team can reliably fulfil, such as selected Patna pincodes. Expand across Bihar after proving transport costs and delivery times. Pincode zones now control serviceability and charges; they are not a distance quotation engine; confirm outstation transport before accepting an order.
- Publish delivery, cancellation, return/refund, privacy and support policies. Ask your accountant to confirm GST treatment and invoice requirements: current order summaries are not statutory GST invoices.
- Assign a person to verify stock, accept orders, reconcile collections and answer support calls each day. Document manual handling of bulk quotes, refunds and failed deliveries.

## 2. Prepare one simple production deployment

- Use one always-on API instance and managed PostgreSQL with automated backups and point-in-time recovery. A starting capacity to measure is 1–2 vCPU and 1–2 GB RAM for the API; it is not a load-tested guarantee. Keep staging and production databases separate.
- Host admin and customer web alongside the API using HTTPS sibling subdomains, following [deployment instructions](DEPLOYMENT.md). Keep exactly one API instance while rate limits, events and background workers remain local to the process.
- Keep production secrets in the host's secret configuration. Use separate provider credentials for staging and production, exact allowed origins and least-privilege database/storage access. Never use development OTP in production.
- Set up real SMS OTP with the provider's applicable Indian delivery/registration requirements. Restrict admin access to named staff, secure their phone accounts and review activity logs. Add stronger admin authentication before expanding staff access.
- Configure uptime/error alerts, database storage alerts and a daily backup check. Rehearse restoring a backup into an isolated database before launch. Agree on acceptable data loss and recovery time, then test that the backup arrangement meets them.
- Get actual hosting, database and SMS quotes. SMS volume and abuse controls can matter more than compute at this scale; set spend limits where supported. Do not add Redis, Kubernetes or multiple API replicas without a measured need.

## 3. Close release gaps before inviting customers

- Require green GitHub Actions, including the Docker build, and prove the deployed container starts, reaches the database and serves the health endpoint. Run database migrations as a controlled release step before starting the new API.
- Review and remediate or explicitly assess the remaining Expo dependency advisories. The previous local audit reported 11 affected packages (4 high, 7 moderate); re-run the audit because advisory counts change. API production dependencies had no reported advisories at that check.
- Test real Android devices and slow/disconnected networks. Verify sign-in, stock/price changes, duplicate taps, order cancellation and recovery after restarting the app. JavaScript exports are not signed native releases; build and test an APK/AAB before distribution.
- Android push, image uploads and SMS must be tested with live provider configuration. iOS push needs additional integration. Push can follow a browser/COD pilot if staff and customers can reliably check order status in the app.
- Test a representative workload, initially around 10–20 concurrent checkout attempts, including competition for the last stock. Check correctness, latency and error rates. Adjust capacity to observed results rather than promising a user limit.

## 4. Run a supervised COD pilot, then enable online payments

- Invite 10–20 known customers first. Complete real deliveries and reconcile cash collected against every order. Fix operational problems before expanding to 50–100 customers.
- Add real Razorpay configuration only after testing success, failure, duplicate webhooks, delayed capture, cancellation, expiry and full refunds. Reconcile gateway records with orders daily. Refund initiation and some exceptional reconciliation remain manual; give staff a written procedure.
- Expand invites after a week of reliable operations, with no unexplained stock, payment or collection discrepancies. Track order completion, delivery time, failed sign-ins, checkout errors, support requests and refunds.

## 5. Let evidence choose the next features

Pincode delivery zones, cursor pagination, and staff OTP plus passphrase are implemented. Prioritize transport quotations if outstation orders grow; statutory invoicing when your accountant requires it; quote-to-order checkout when manual bulk conversion causes friction; staff recovery procedures as the team expands. Improve Hindi coverage, accessibility and real-device usability based on customer feedback.

Revisit multiple API instances only when monitoring shows one instance cannot meet demand or availability requirements. First add shared rate limiting/event delivery and safe database worker claiming; the current architecture deliberately assumes a single instance.

## Pilot launch gate

Invite customers only when prices and delivery promises are accurate, real OTP works, admin access is controlled, a production order has completed end to end, backups have been restored successfully, alerts reach the operator, and the remaining integration/security limitations have been reviewed. Keep online payments disabled until their separate verification is complete.
