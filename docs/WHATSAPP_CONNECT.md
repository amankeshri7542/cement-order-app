# Connecting the shop's WhatsApp

This connects the shop's number so the system can read messages and learn, and later answer with fixed sentences. **Nothing is sent to anyone until an owner moves the stage up on the desk**, and that is refused until the reader has passed on real messages. None of this has been tried on a real number: the reader has never read a real message, and no reply has ever reached a real phone.

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
| `WA_MODE`                                                                  | `shadow` (reads only). `reply` comes later, below    |
| `WA_WEBHOOK_PROVIDER`                                                      | `ycloud`, `d360` or `meta`                           |
| `WA_PARTNER_NAME`                                                          | The partner's name, the same as on the privacy pages |
| `WA_BUSINESS_PHONE`                                                        | The shop's number, as `+91...`                       |
| `WHATSAPP_WEBHOOK_SECRET`                                                  | The partner's signing secret (`ycloud`, `d360`)      |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | For `meta`. `d360` also needs the phone number ID    |

Webhook address: `https://<api host>/api/v1/whatsapp/webhook`. For `d360`, send the secret in the `x-shiv-webhook-secret` header.

**Check before trusting a partner's format.** The `ycloud` format was built from its published examples, not from a real delivery. On the spare number, send one message and one typed reply, and confirm both appear on the desk under More, WhatsApp orders. If the shape differs, fix `apps/api/src/whatsapp/provider.ts` before going near the real number. Also delete one message and edit one on the spare number, and confirm the desk follows. How YCloud sends those two is not in its published examples, so the code assumes Cloud API's shape.

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
2. Open More, WhatsApp orders. Mark family and personal numbers as not to be read. Their words are never kept, and anything kept before is wiped.
3. Turn off greeting and away messages in the Business app.
4. Add the shop's delivery areas under More, Delivery areas. Plain rules only accept a place they know from there; any other word sends the message to the AI reader, or to a person if the reader is off.
5. Read and mark at least 200 real messages over 14 days. The desk shows the gate numbers. Also check the list of chats the owner answered where no order was read, as a missed order counts against the reader.
6. Ask three customers if anything seemed odd.

## Replies: how a stage moves

Replies need all of this. Any one missing means silence.

| Setting                      | Value                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `WA_MODE`                    | `reply`                                                                                                        |
| `WA_REPLY_PROVIDER`          | `ycloud`, `d360` or `meta`. `off` means nothing can leave. `fake` is for tests and refused in production       |
| `WA_REPLY_API_KEY`           | The partner's key (`ycloud`, `d360`). `meta` uses `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`       |
| `WA_PRIVACY_URL`             | The privacy page, as `https://...`. It goes in the first notice                                                |
| `WA_SECOND_NUMBER`           | The spare number, as `+91...`. Set only once it is really verified (below)                                     |
| `WA_APPEAL_ROUTE`            | Where an appeal goes, in a few words or a link. Set only once you have it in writing (below)                   |
| `WA_TEMPLATES_APPROVED`      | `true` once `shiv_order_confirmed_v1` and `shiv_order_refused_v1` are approved, and still in the UTILITY class |
| `WA_REPLY_TEMPLATE_LANGUAGE` | `en_IN`                                                                                                        |

Limits have defaults: `WA_REPLIES_PER_THREAD_HOUR` (3), `WA_REPLIES_PER_THREAD_DAY` (8), `WA_REPLY_MAX_AGE_MINUTES` (30), `WA_THREAD_MESSAGES_PER_HOUR` (60), `WA_PASTES_PER_HOUR` (60).

The stage lives in the database, starts at **Off** on every fresh database, and only an owner moves it, under More, WhatsApp orders. It goes up one step at a time: **Off, Test numbers (up to 5), Known customers, Everyone**. Going down needs no check and can be any distance. Every move is in the activity log.

Moving up is refused unless all of these hold. The screen shows each one.

1. The reader's gate on 200 or more real messages a person marked (`docs/plan-v3/07-whatsapp-orders.md` section 9). The paste box, the try box and a practice reader do not count towards it.
2. `WA_MODE=reply` with a sender set, and a real reader, not `fake`.
3. The stop-all switch is off.
4. A second number, the appeal route and approved templates are in place.
5. For Test numbers: at least one number on the list. For Everyone: at least 7 days at Known customers.

**The order to do it in.** Read the replies aloud with Papa first, in all three languages (`apps/api/src/whatsapp/replies.ts` and `decisions.ts`). His words win. Update both privacy pages to say the AI now answers. Then Test numbers with family phones, on the spare number before Papa's. Then Known customers, which means someone the shop has actually sold to. Then Everyone.

**What always stops a reply, checked again at the moment of sending:** the stop-all switch, a number marked off or one that wrote STOP (one acknowledgement, then nothing), a stage below that number, Papa having typed after the message (and for the quiet time after, a setting from 30 to 60 minutes, except a receipt for a new order with no open draft), the night hours, someone who asked for the shop, a message over 30 minutes old, and a closed 24-hour window. A person's own confirmation goes as its template outside the window. **No reply can confirm an order.** Only a person's tap on the card makes an order, and the database refuses a confirmation with nobody's name on it.

**Not built yet, on purpose:** voice and photos (they need the private file store, so they stay a plain message in Papa's app), the one-tap button on a lock screen for a card (a notification opens the card), WhatsApp approval buttons to Chacha, a holiday list for counting shop days, and sending to someone hiding their number.

## Second number and appeal route

Have both before any reply goes. The number is the shop's lifeline, and a restriction is the worst thing that can happen to it.

**Second number**

1. Buy a SIM in the shop's name. Keep it in the shop, charged, in an old phone. Never give it out.
2. Register it on the WhatsApp Business app, and open that app at least every two weeks.
3. Verify it with the partner on the same business portfolio, as a spare, with no traffic. This is also the number to rehearse on, and the spare in the test-number stage.
4. Set `WA_SECOND_NUMBER`. It stays in the secret store, never in the repo.

If Papa's number is ever restricted, customers are told the spare number by a person, and it is connected the same way. Do not move Papa's number off the Business app.

**Appeal route**

1. Ask the partner in writing: who do we contact when a number is restricted, how fast do they answer, and what do they need from us? Keep the answer outside the repo.
2. Find the review button: Meta Business Suite, Account quality, Request review. Papa and Aman are the only portfolio admins, so check Aman can reach it.
3. Set `WA_APPEAL_ROUTE` to where the appeal goes.
4. Write the steps on the paper card kept with the family.

**If a warning arrives:** on the desk, Turn replies off. Then `WA_MODE=shadow` and restart. Do not delete anything. Send the appeal the same day. Reading can go on, and Papa's phone is unaffected.

## The AI-off switch, with Papa

The tests cover this against a fake partner. It still has to be done once on the spare number, with Papa holding the phone:

1. From a family phone, send `50 bori ultratech`. See the card and the reply.
2. Mark that number off from its card. Send again. No reply, no card, and its words are gone from the desk.
3. Turn it back on. Send STOP. One acknowledgement. Send again: nothing.
4. Press Stop all reading. Send from another test number. Nothing goes, and nothing queued goes either. Press it again and try once more.
5. Type a reply yourself in the Business app while a card is open. The AI goes quiet, and the card moves to "Papa ne jawab diya, order banao".

## The paste box

More, WhatsApp orders, Paste a message. It works with WhatsApp not connected. It uses the same plain rules and reader, makes the same card marked as pasted, and never sends anything to anyone. A number marked off or the stop-all switch means no reader runs, and past the monthly cap the card shows only the original words.

## Measuring it

Fill in the paper call tally on the same screen: before going live, then at weeks 2, 4 and 8, for the same three normal days each time. It works out confirmation calls per 10 WhatsApp orders. Plan 07 proposes half by week 8, or stop and find out why before adding anything.

## Stopping

- **Replies only:** More, WhatsApp orders, Turn replies off. Reading goes on.
- **All reading, at once:** More, WhatsApp orders, Stop all reading. Effective from the next message, and anything waiting is wiped, including replies in the queue.
- **Completely:** set `WA_MODE=off` and restart. The webhook then refuses everything, and the partner retries for a while. The paste box goes on working.
- The owner's phone is unaffected by any of these. If this system dies, it is just normal WhatsApp again.

## What is kept

Words of shop-related text messages, the cards made from them and the replies sent, for `WA_TEXT_RETENTION_DAYS` (30). If you change this, change the privacy pages too. Voice notes, photos, greetings, a stranger's message with no shop words, the owner's typed replies and anything from a number marked off keep no words at all. A card Papa answered stays until someone acts on it, with the customer's words gone once their time is up. The partner's name, phone numbers and keys stay in the environment only, the test numbers stay in the database, and real messages never enter the repo.
