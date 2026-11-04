# Connecting the shop's WhatsApp for silent reading

This connects the shop's number so the system can read messages and learn. **Nothing is sent to anyone at this stage.** The configuration has no reply mode, so no setting can turn sending on.

Do these in order, and stop if any step fails. Nothing here needs the phone to change hands for long, and the owner keeps using the WhatsApp Business app as normal.

## Before connecting

1. The owner has agreed, after being told plainly that every one-to-one chat on the number passes through Meta, the partner and our server.
2. WhatsApp Business app version 2.24.17 or newer on the phone.
3. A partner has confirmed in writing: Coexistence works for +91, incoming messages and typed replies (echoes) reach our webhook, a signing secret exists, the price, and how to leave.
4. The privacy pages name the partner. Set `NEXT_PUBLIC_WHATSAPP_PARTNER` on both web apps and redeploy. Have a lawyer or accountant check the page for an hour.
5. A server exists with a real HTTPS address (`docs/SERVER_SETUP.md`). The Catalyst demo must never hold this.

## Settings on the server

Put these in the secret store, never in the repo.

| Setting                                                                    | Value                                                |
| -------------------------------------------------------------------------- | ---------------------------------------------------- |
| `WA_MODE`                                                                  | `shadow`                                             |
| `WA_WEBHOOK_PROVIDER`                                                      | `ycloud`, `d360` or `meta`                           |
| `WA_PARTNER_NAME`                                                          | The partner's name, the same as on the privacy pages |
| `WA_BUSINESS_PHONE`                                                        | The shop's number, as `+91...`                       |
| `WHATSAPP_WEBHOOK_SECRET`                                                  | The partner's signing secret (`ycloud`, `d360`)      |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | For `meta`. `d360` also needs the phone number ID    |

Webhook address: `https://<api host>/api/v1/whatsapp/webhook`. For `d360`, send the secret in the `x-shiv-webhook-secret` header.

**Check before trusting a partner's format.** The `ycloud` format was built from its published examples, not from a real delivery. On the spare number, send one message and one typed reply, and confirm both appear on the desk under More, WhatsApp reading. If the shape differs, fix `apps/api/src/whatsapp/provider.ts` before going near the real number. Also delete one message and edit one on the spare number, and confirm the desk follows. How YCloud sends those two is not in its published examples, so the code assumes Cloud API's shape.

## The AI reader (optional at first)

Plain typed orders are read by rules for free, and that works with no key at all. For the rest:

| Setting                                                                           | Value                                                                                                                                                    |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WA_READER_PROVIDER`                                                              | `gemini`                                                                                                                                                 |
| `WA_READER_MODEL`                                                                 | A pinned model name, chosen by the bake-off below                                                                                                        |
| `GEMINI_API_KEY`                                                                  | From a **billed** Google Cloud project. Also set a budget alert in Google                                                                                |
| `WA_READER_PAID_KEY`                                                              | `true`, once you have confirmed the key is on the paid tier. Google's free tier may use what it reads to improve its products, which Meta's terms forbid |
| `WA_READER_INPUT_MICRO_USD_PER_MILLION`, `WA_READER_OUTPUT_MICRO_USD_PER_MILLION` | Today's prices. $0.25 is `250000`                                                                                                                        |
| `WA_READER_MONTHLY_BUDGET_MICRO_USD`                                              | `5200000` is about ₹500. Past it, a person reads the original words                                                                                      |

## The bake-off

Put real masked messages in a file outside the repo, one JSON object per line. Real messages never enter the repo.

```json
{
  "text": "50 bori ultratech sipara",
  "intent": "ORDER",
  "lines": [{ "productId": "...", "quantity": 50 }]
}
```

Then, from `apps/api`, with the database reachable so the catalogue can load:

```bash
GEMINI_API_KEY=... WA_EVAL_MODEL=gemini-3.1-flash-lite WA_EVAL_INPUT=250000 WA_EVAL_OUTPUT=1500000 npm run wa:eval -- /path/to/messages.jsonl
```

It prints intent accuracy, line accuracy and cost for that model. Run it for each candidate. Take the highest line accuracy, and within 2 points the cheaper. Re-run it before any model change.

## After connecting

1. Choose **do not share chat history**.
2. Open More, WhatsApp reading. Mark family and personal numbers as not to be read. Their words are never kept, and anything kept before is wiped.
3. Turn off greeting and away messages in the Business app.
4. Add the shop's delivery areas under More, Delivery areas. Plain rules only accept a place they know from there; any other word sends the message to the AI reader, or to a person if the reader is off.
5. Read and mark at least 200 real messages over 14 days. The desk shows the gate numbers. Also check the list of chats the owner answered where no order was read, as a missed order counts against the reader.
6. Ask three customers if anything seemed odd.

## Stopping

- **All reading, at once:** More, WhatsApp reading, Stop all reading. Effective from the next message, and anything waiting is wiped.
- **Completely:** set `WA_MODE=off` and restart. The webhook then refuses everything, and the partner retries for a while.
- The owner's phone is unaffected by either. If this system dies, it is just normal WhatsApp again.

## What is kept

Words of shop-related text messages for `WA_TEXT_RETENTION_DAYS` (30). If you change this, change the privacy pages too. Voice notes, photos, greetings, a stranger's message with no shop words, the owner's typed replies and anything from a number marked off keep no words at all.
