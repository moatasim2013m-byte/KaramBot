# Customer walkthrough — 24 September 2026

Two personas, played by outside models, went through the **real** handover flow against the
deployed app: redeemed a real activation link, signed in, saw the dashboard as the API renders
it for their login, attempted three tasks, and gave a verdict. SHIFT's admin panel was then read
to see what it had recorded about each of them.

| Persona | Played by | Bought | Score |
|---|---|---|---|
| د. ليان النور — dentist, Irbid | Kimi K3 | Karam Bot, 120 JOD/month | **4 / 10** |
| أبو خالد الشامي — grill restaurant, Irbid | GLM 5.3 | Automation + Karam Bot, 300 JOD/quarter, **late on payment** | **4 / 10** |

Both would phone SHIFT before doing anything else. Both for the same reason.

## What worked

- **The handover itself.** Both redeemed the link, chose a password, and were signed straight in
  (`200`, session valid). The activation page was understood by both.
- **Navigation is guessable.** Both went to «المحادثات» for customer messages, «الإعدادات» for the
  WhatsApp connection, and the vertical page («العيادة» / «القائمة») to see what the bot would say.
  Those are the right guesses. The layout drew no complaints — "نظيفة ومرتبة" from both.
- **The admin side recorded everything correctly.** For each: owner signed in ✓, lifecycle
  `onboarding`, connection «بدون رمز وصول» (true — the test rows have no token), contract shown
  with the right solution and status, and the attention queue raised exactly what it should:
  `critical connection` for both, `due_soon` for the clinic, `overdue` for the restaurant.

## What both said, independently

**1. «وين واتساب؟» — the customer cannot see whether the thing they pay for is connected.**
Both looked in Settings for a WhatsApp status and found nothing, because that card is admin-only.
The dentist: *"like buying a washing machine with no power button."* The restaurant owner: *"the
bot could have been dead for a week and I'd be losing orders without knowing."* This was the
first complaint from both and the reason both would call.

**2. No way to try the bot before a real customer does.** Both asked for a «جرّب البوت» button
— send a test question, see the reply. The dentist's fear is wrong prices to patients; the
restaurant owner's is the old price of the mixed plate, which he changed a month ago.

**3. All zeros mean nothing.** Four stat cards at 0 cannot distinguish *not connected yet*, *no
messages today*, and *service cut off*. The restaurant owner, late on his payment, read the zeros
as possibly the last of those — and nothing on screen told him otherwise.

**4. «المحادثات» vs «الطلبات».** Both asked where a WhatsApp booking or order actually appears —
in one, the other, or both.

## What each said alone

- **Dentist:** wants a place to enter hours, services, prices and appointment length so the bot
  cannot invent answers. (The «العيادة» page exists; the empty dashboard gave no hint of it.)
- **Restaurant owner:** wants to see his own subscription and payments — *"am I cut off or will
  they warn me?"* — and asked, reasonably, who resets his password if he forgets it, given the
  page promised nobody at SHIFT can see it.

## The activation page

Trust 6/10 from both. Three specific frictions:
- The page says **شِفت**; the contract said **كرم بوت**. Both wondered if it was the same company.
- The reassurance *«لن يطّلع أحد في شِفت على كلمة مرورك»* made both **more** worried, not less —
  it implied that seeing passwords is a thing that happens.
- Both were shown an email they never gave (a placeholder in the test). Real customers will
  often have no email at all; the page should lead with the business name and phone.

## Two things the run itself proved

- The **re-invite guard works.** One persona's login had already been activated by an earlier,
  interrupted run; the API refused a fresh link for it (`409`), and the documented recovery —
  disable, then re-invite — was what got it going again.
- The **same-second session bug** was real and is fixed: the first attempt to use a freshly
  activated session answered `401 Session expired`. Every customer would have hit it.

## What to build, in this order

1. **A WhatsApp status strip on the customer's Settings** — «متصل / غير موصول بعد / بانتظار طريقة
   دفع» — read-only, from the same state the admin panel already computes. Both personas' #1.
2. **«جرّب البوت» for the customer**, once the dry-run runs the real workflow (today it runs the
   model only, which would mislead — see `admin.js` test-message).
3. **Honest empty states on the overview:** if not connected, say so where the zeros are; if
   connected and quiet, say that instead.
4. **Show the customer their contract and payments**, and what happens when a payment is late.
5. **Activation page copy:** «شِفت — الشركة المطوِّرة لكرم بوت»; replace the password line with
   «أنت وحدك تختار كلمة مرورك»; show the business name and phone, not a placeholder email.
6. A one-line explainer under «الطلبات»: bookings and orders made in chat land here.

## Method notes

- Screens were rendered as text from live API responses; the personas could not click, so each
  round asked which sidebar item they would choose and why. Their choices matched the real
  navigation, which is itself a finding.
- Test rows: `عيادة النور` (`noor-clinic-sim`) and `مطعم الشام` (`sham-restaurant-sim`), with their
  owner logins and contracts, remain in the platform for the owner to open and compare. They
  carry no WhatsApp token and receive no traffic.
- Harness: `backend/scripts/sim-customer-walkthrough.mjs`; secrets in git-ignored `backend/.sim/`.
