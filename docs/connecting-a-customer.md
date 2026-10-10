# Connecting a customer — the runbook

What to click, with the customer, to take an account from sold to answering. Written for
whoever is doing it — SHIFT staff or Cowork — not for an engineer. The engineering detail lives
in `whatsapp-embedded-signup.md`.

**Time:** about 20 minutes with the customer beside you or on a call, plus whatever Meta takes.
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
`/admin/accounts` → **إضافة حساب شركة**. Only **اسم الحساب** and **نوع النشاط** are needed. Leave
**الرابط المختصر** empty and the server makes one. Leave the Meta ids empty too: the connect
step fills them.

**Pick the type carefully — it decides which agent they get:**

| Type | What the agent does |
|---|---|
| `restaurant` | Reads the menu, builds a cart, confirms orders |
| `clinic` | Reads services and doctors, offers slots, books appointments |
| anything else | Answers from **معلومات المنشأة** you enter, and hands over for anything else |

A pharmacy, a gym, a workshop or a shop is the third row. It is not a lesser option — it just
answers rather than books.

### 2 · Connect WhatsApp
Open the account. The **الحالة** tab opens first, and the top panel is **ربط واتساب**. Read its
grey note out loud: «سلّم الشاشة لصاحب المحل: يدخل بحساب فيسبوك الخاص به. لا تطلب كلمة مروره أبدًا.»

Wait until the line «جارٍ تجهيز نافذة فيسبوك…» disappears, then press
**اربط واتساب لهذا الحساب**. The button is greyed out until Facebook has loaded. That is
deliberate: the press must open Meta's window straight away, or the browser blocks it.

**On `app.shifts-ai.com` only.** That is the domain in Meta's Allowed Domains and Valid OAuth
redirect URIs. On any other host Meta refuses the window. Use Chrome or Safari on a laptop. Do
not use the browser inside WhatsApp, Facebook or Instagram: the panel detects those and shows
«افتح الرابط في Chrome أو Safari لتتمكن من ربط واتساب» instead of the button.

Meta's window opens in Arabic. Our page now says «أكمل الخطوات في نافذة فيسبوك — لا تغلق هذه
الصفحة». **Hand the screen to the customer.** They:

1. Log into their own Facebook
2. Select or create their **Meta Business portfolio** — this is the step that decides they own it
3. Select or create the **WhatsApp Business Account** and the display name
4. Enter the phone number and type the SMS or voice code

When the window closes, the panel shows «جارٍ الربط…» with four lines:
«وصلت موافقتك» → «تحققنا أن الرقم يخصك» → «ربطنا الرقم بكرم بوت» → «سجّلنا الرقم لدى واتساب».
About a minute later it reads **واتساب متصل: ‎+962 …**, with «الاسم الذي يراه الزبائن» under it
and Meta's review state (usually «قيد المراجعة» for a day or two). The checklist and
**ما تقوله Meta** below it refresh on their own, and SHIFT gets a WhatsApp alert.

### 3 · If it stops part-way
**Reloading is safe.** The panel reads where the signup stopped from the server, so after a
reload it shows **أكمل الربط**, not a fresh start. If the server already holds the customer's
approval, **أكمل الربط** carries on without opening Meta's window again. If it does not, the
button opens the window again.

| What you see | What it means | What to do |
|---|---|---|
| «منع المتصفح نافذة فيسبوك — اضغط مرة أخرى» | The browser blocked the popup | Press again. If it happens twice, allow pop-ups for the site or switch browser |
| «تعذّر تحميل فيسبوك…» | An ad blocker or the network stopped Facebook's script | Turn the blocker off for the site, then «حاول التحميل مرة أخرى» |
| «توقفت عند: … لم يضِع شيء — أكمل من هنا» | The customer closed Meta's window. The step is logged | **أكمل الربط** |
| «أبلغت Meta عن خطأ: …» | Meta itself refused something | Read Meta's sentence to them. **نسخ رمز الجلسة للدعم** copies the id Meta support asks for |
| «توقف الربط عند: …» with the four lines, one marked ✗ | Our server stopped after Meta (connect or register failed) | **أكمل الربط** resumes from that step |
| «رمز التحقق بخطوتين لرقمك» field | The number already has a two-step PIN | The customer types *their* 6-digit PIN, then **أكمل الربط**. If they do not know it: WhatsApp Manager ← الرقم ← التحقق بخطوتين |
| «هذا الرقم مربوط بحساب آخر على شِفت…» | The number belongs to another shop here | Stop. Nothing was changed. Find out which shop, then talk to the owner |
| «هذا الرقم لا يتبع الحساب الذي دخلت به في فيسبوك.» | The ids do not belong to the Facebook account that signed in | Stop. SHIFT gets a critical alert. Check that they logged into the right Facebook |
| «وصلتنا موافقتك لكن لم نحدد الرقم…» | Meta did not say which number, or the account has several | Nothing for the customer to redo. Finish it from **ربط بدون حساب** (below) |

### «ربط بدون حساب» — finishing by hand
On **نظرة عامة** (`/admin/overview`), the section **ربط بدون حساب** appears only when there is
something in it: a signup our server could not finish on its own, or a Meta notice that a
business added SHIFT when we have no account for it. Each row shows the Meta name, the number
when known and when it arrived. It has two buttons:

- **اربطه بزبون…** → pick the account from the list → **اربط**. Use it when the signup is not
  linked to an account here.
- **أكمل الربط** (rows of a shop with no number yet) → pick the number from the WABA's list, or,
  when Meta cannot be asked, paste its id (WhatsApp Manager ← Phone numbers ← the number) → **أكمل**.

### 4 · The payment card — theirs, not ours
Once connected, the panel shows an amber note: **بدون بطاقة دفع مؤكدة لدى Meta**, with the link
**افتح إعدادات الدفع في WhatsApp Manager**.

**This step is the customer's and it is not optional.** Meta bills service messages, which
are the bot's replies to a customer who wrote first, to the shop's own card. It refuses to
deliver them for an account with no payment method. Without a card, the bot goes silent.

Open the link with them and watch them add the card. When you see it in WhatsApp Manager, press
**رأيتها مضافة — أكّد** in the checklist. Do not end the call before the card is added or a time
is set to add it. If Meta later refuses a reply for payment (error 131042), the note turns red on
its own.

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
| **بدون بطاقة دفع مؤكدة لدى Meta** | Nobody has confirmed a card — Meta may refuse the bot's replies |
| **رفضت واتساب ردود البوت — طريقة الدفع لدى Meta** | Meta refused a reply for payment (131042) — the customer must fix the card |
| **رسالة بدون رد** | A customer has been waiting; the agent is not answering |
| **بدون معلومات** | The agent greets and stops — nothing was entered |
| **دفعة متأخرة** | They are behind on payment |

For "the bot said something wrong", open the account → **فحص المحادثات**: read-only, and every
read is logged against your name.
