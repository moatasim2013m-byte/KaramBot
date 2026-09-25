# Connecting a customer — the runbook

What to click, with the customer, to take an account from sold to answering. Written for
whoever is doing it — SHIFT staff or Cowork — not for an engineer. The engineering detail lives
in `whatsapp-embedded-signup.md`.

**Time:** about 20 minutes with the customer on a call, plus whatever Meta takes.
**You need them present:** they log into *their* Facebook, not you. That is deliberate — it is
what makes the WhatsApp account theirs.

---

## Before the call

**1. The number.** It must satisfy all three, or the call is wasted:

- **No WhatsApp on it now.** A number registered on WhatsApp Messenger or the WhatsApp Business
  app cannot be registered for Cloud API until that account is deleted.
- **It can receive a code** — SMS or a voice call. A landline works (choose "Call me"); a
  landline *with an extension* does not.
- **It is not already on Cloud API** anywhere.

⚠️ **Irreversible:** taking a number off the WhatsApp Business app loses its chat history, and
it cannot go back to that app unless it is later deregistered from Cloud API. If the customer
runs their business on that number today, stop and talk about it before continuing.

Safest: a fresh SIM they are not using yet.

**2. Their Facebook.** They need a Facebook account that administers a Meta Business portfolio —
or is willing to create one in the popup, which works. They will need their password and
whatever 2FA is on it. **Never take their password.** If they cannot log in, reschedule.

**3. Their business details**, so you are not asking mid-call: opening hours, services and
prices, the three questions their customers ask most.

---

## The steps

### 1 · Create the account
`/admin/accounts` → **إضافة حساب شركة**. Name, slug, type.

**Pick the type carefully — it decides which agent they get:**

| Type | What the agent does |
|---|---|
| `restaurant` | Reads the menu, builds a cart, confirms orders |
| `clinic` | Reads services and doctors, offers slots, books appointments |
| anything else | Answers from **معلومات المنشأة** you enter, and hands over for anything else |

A pharmacy, a gym, a workshop or a shop is the third row. It is not a lesser option — it just
answers rather than books.

### 2 · Connect WhatsApp
Open the account → **الحالة** tab → **Connect WhatsApp**.

**On `karambots.com` or `app.shifts-ai.com` only.** Both are in Meta's Allowed Domains. Other
hosts are blocked by Meta and the button will fail with no useful message.

A Facebook window opens. **Hand the screen to the customer.** They:

1. Log into their own Facebook
2. Select or create their **Meta Business portfolio** — this is the step that decides they own it
3. Select or create the **WhatsApp Business Account**
4. Enter the phone number and complete the verification code

Back on our page the button shows progress: `Connecting…` → the step it reached → `Connected`.

### 3 · If it fails
**Do not press Connect again.** The server records which step it reached, and **Try again**
resumes from there. Re-running the Meta flow starts over for nothing.

| What you see | What it means | What to do |
|---|---|---|
| Fails immediately, popup never opens | Wrong domain, or a blocked pop-up | Use `karambots.com`; allow pop-ups |
| Cancelled at a step | They closed the popup | **Try again** |
| PIN / two-step verification error | The number already has a PIN set elsewhere | **Try again** with *their* existing 6-digit PIN — the retry accepts it |
| Something else | Read the error on the card | It is recorded on the account; send it to the KaramBot session |

### 4 · The payment method — theirs, not ours
When it connects, the card shows an amber note: **أضف طريقة دفع في WhatsApp Manager**.

**This one is the customer's own step and it is not optional.** From 1 October 2026 Meta charges
for service messages — the bot *replying to a customer who wrote first* — and **stops delivering
them for any account with no payment method on file**. Without a card, the bot goes silent.

Walk them to <https://business.facebook.com/wa/manage/home/> and watch them add it. Do not end
the call before this is done or scheduled.

### 5 · Teach the agent
Still on **الحالة**:

- **restaurant** → enter the menu (القائمة)
- **clinic** → enter services and doctors (العيادة)
- **anything else** → **معلومات المنشأة**: opening hours first, then the three questions their
  customers actually ask, then prices and policies. Write it the way they would say it on the
  phone.

Then **جرّب البوت** — type what a customer would type and read the answer out loud to them. It
runs their real agent and sends nothing. Fix what sounds wrong before anyone else sees it.

An account with nothing entered answers with its greeting and stops. The panel says so:
**بدون معلومات**.

### 6 · Hand it over
**الدخول** tab → **إضافة مستخدم** → their name, email, role **صاحب المنشأة**.

You get a **one-time link, valid 72 hours**. Send it to them on WhatsApp. They open it, choose
their own password, and land in their dashboard. **You never see or set their password.**

If they never use it, **رابط جديد** issues another. If they have *already* signed in and are
locked out, the re-invite is refused on purpose — disable their login first, then invite again.
That refusal is what stops staff quietly setting a live customer's password.

### 7 · Check the account is actually done
**الحالة** tab, the checklist. All of these green:

رقم واتساب مرتبط · حساب واتساب للأعمال · رمز وصول محفوظ · الرقم مُسجَّل لدى Meta ·
**طريقة دفع مضافة** · رسالة ترحيب مضبوطة · معلومات المنشأة مُدخلة · حساب دخول لصاحب المنشأة ·
**صاحب المنشأة دخل فعليًا** · أول رسالة واردة · أول رد من الوكيل

The last two only go green once a real message arrives. **Send one yourself from a phone that
has never messaged them** — it also proves the new-customer alert reaches you and your brother.

### 8 · Record the contract
**العقد** tab → the solution, the amount, the cycle, the start date. Without it the fleet view
shows **لا يوجد عقد مسجّل** and you have no record of what they agreed to pay.

---

## What the customer sees afterwards

Their own dashboard, scoped to their business alone:

- **ملخص النشاط** — one honest line about their WhatsApp, then the day's numbers
- **المحادثات** — their customers' chats, where they can reply by hand or take over from the bot
- **الإعدادات** — their WhatsApp status, معلومات المنشأة, and جرّب البوت

They never see the admin panel, and they never see another customer's anything.

---

## When something breaks later

The fleet view raises it before they call you:

| It says | Meaning |
|---|---|
| **الحساب بدون رمز وصول** | Not connected — no message will arrive |
| **بدون طريقة دفع — مهلة 30 أيلول** | The bot will stop replying on 1 October |
| **رسالة بدون رد** | A customer has been waiting; the agent is not answering |
| **بدون معلومات** | The agent greets and stops — nothing was entered |
| **دفعة متأخرة** | They are behind on payment |

For "the bot said something wrong", open the account → **فحص المحادثات**: read-only, and every
read is logged against your name.
