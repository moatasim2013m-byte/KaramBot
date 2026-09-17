# Sim — صاحب مطعم في إربد — مستعجل ومتشكك

- Customer model: `moonshotai/kimi-k3` (OpenRouter)
- Bot: the real SHIFT pipeline on `gemini-3.6-flash` (fake DB, fake WhatsApp, in-memory calendar)
- Clock anchored at 2026-09-17T07:00:00.000Z
- Started 2026-09-17T07:00:00.110Z

- Bot turns: 9; latency min 4ms, median 2668ms, max 17320ms

## Transcript

### Turn 1 — text — 2026-09-17T07:00:47.567Z

**Customer**
> السلام عليكم
> شفت إعلانكم عالفيس.. شو هاد البوت بالضبط؟

**Bot** — 1 part(s), 4245ms
> وعليكم السلام أهلاً وسهلاً أستاذ أبو محمد 👋
أنا كرم، مساعد شِفت الذكي (shifts-ai.com) — نفس محرّك كرم اللي بنركّبه عندك بس هون بمعلومات شِفت.
كرم هو نظام ذكاء اصطناعي بيرد على واتساب منشأتك 24/7، بيجاوب الاستفسارات وبيسجّل الطلبات أو المواعيد تلقائياً.
شو طبيعة شغل منشأتك؟

- result: reply/NONE · stage: `discovery` · status: `open`
- gemini: 4127ms STOP
- calendar: freeBusy
- lead: {"language":"ar","interest":"warm","_prov":{"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.074Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.074Z","confirmed":true}},"version":1,"score":0}

### Turn 2 — text — 2026-09-17T07:01:45.730Z

**Customer**
> عندي مطعم مندي بإربد
> طيب وقديش بيكلف هالحكي؟

**Bot** — 1 part(s), 17320ms
> أهلاً بك وبأهل إربد أستاذ أبو محمد. ما عندي سعر معتمد أقدر أعطيك إياه هون وما بدي أخمّن، لأن التكلفة بتعتمد على احتياجك. بدك كرم بس للرد على الاستفسارات والمنيو، ولا كمان لاستقبال طلبات التوصيل بالكامل؟

- result: reply/NONE · stage: `objection` · status: `open`
- gemini: FAILED [GoogleGenerativeAI Error]: Request aborted when fetching https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: This operation was aborted | 2283ms STOP
- lead: {"language":"ar","interest":"warm","_prov":{"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.074Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.074Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true}},"version":2,"score":3,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","need":["مطعم مندي"],"products":["karam"],"objections":["price"]}

### Turn 3 — text — 2026-09-17T07:02:57.401Z

**Customer**
> الاتنين بصراحة
> بس قولي تقريباً، بخاف يطلع غالي وما بصرف معي

**Bot** — 1 part(s), 2668ms
> ما عندي سعر معتمد أقدر أعطيك إياه هون وما بدي أخمّن، وبنفس الوقت ما بنحب نكلّفك بإشي ما بيلزمك. الفريق بيطلعلك عرض مكتوب ومناسب لحجم شغلك بدون ما تحتاج مكالمة إذا بتحب. شو رأيك نجرّب مثال سريع لتشوف كيف بيرد على طلبات المندي، ولا بتحب يبعثولك العرض المكتوب؟

سجّلت طلب العرض بقائمة فريق شِفت ✅ لسه ما استلمه حدا — بيرجعولك على هالرقم ضمن الدوام (الأحد–الخميس 9–6). لحد ما يردوا أنا هون لأي سؤال.

- result: reply/FLAG_FOR_TEAM · stage: `objection` · status: `pending`
- gemini: 2655ms STOP
- calendar: freeBusy
- staff alert: quote
- lead: {"language":"ar","interest":"warm","_prov":{"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.074Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.074Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true}},"version":2,"score":3,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","need":["مطعم مندي"],"products":["karam"],"objections":["price"]}

### Turn 4 — text — 2026-09-17T07:03:53.285Z

**Customer**
> خليهم يبعتوا العرض
> بس صراحة أنا عندي موظف بيرد عالواتس، شو بيفيدني البوت؟

**Bot** — 1 part(s), 2963ms
> كرم بيشتغل كمساعد للموظف مش بديل عنه، بيغطي وقت الضغط والرسائل اللي بتوصل بعد الدوام لما يكون الموظف مش موجود. مين بيرد عندكم على رسائل الواتساب بعد الساعة 10 بالليل؟

- result: reply/FLAG_FOR_TEAM · stage: `objection` · status: `pending`
- gemini: 2952ms STOP
- lead: {"language":"ar","interest":"warm","_prov":{"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.074Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.074Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000c","at":"2026-09-17T07:03:59.787Z","confirmed":true}},"version":3,"score":3,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","need":["مطعم مندي"],"products":["karam"],"objections":["price","staff"]}

### Turn 5 — text — 2026-09-17T07:04:49.818Z

**Customer**
> بعد العاشرة ما حدا بيرد صراحة
> كتير طلبات بتروح علينا بالليل

**Bot** — 1 part(s), 2292ms
> تماماً، وهاد بالضبط المكان اللي كرم بفرق فيه معك — بيستقبل الطلبات وبيأكدها بالليل وبوقت أواعي الضغط بدون ما يضيع عليكم أي زبون. (بنستخدم اللي بتكتبه عشان نرد عليك ونرتّب متابعة الفريق — التفاصيل: shifts-ai.com/privacy) شو اسم المطعم أستاذ أبو محمد عشان يجهّزوا العرض باسمه؟

- result: reply/NONE · stage: `objection` · status: `pending`
- gemini: 2280ms STOP
- calendar: freeBusy
- lead: {"language":"ar","interest":"warm","_prov":{"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.074Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.074Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000f","at":"2026-09-17T07:04:56.320Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000c","at":"2026-09-17T07:03:59.787Z","confirmed":true}},"version":4,"score":3,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","need":["مطعم مندي","طلبات بتروح بالليل وبعيد عن أوقات الدوام"],"products":["karam"],"objections":["price","staff"]}

### Turn 6 — text — 2026-09-17T07:05:46.253Z

**Customer**
> مطعم بيت المندي
> بإربد قرب دوار الثقافة

**Bot** — 1 part(s), 6005ms
> (interactive) والنعم منك ومن مطعم بيت المندي. بحط العنوان بالحسبان لعرض السعر المكتوب. بتحب نرتّب مكالمة قصيرة مع الفريق يناقشوا معك العرض المكتوب وتفاصيله بوقته؟ أقرب أوقات الفريق:
> أزرار: [اليوم 12:30 الظهر](book:2026-09-17T09:30:00.000Z) [الأحد 9:00 الصبح](book:2026-09-20T06:00:00.000Z) [وقت ثاني](slot:other)

- result: reply/FLAG_FOR_TEAM · stage: `objection` · status: `pending`
- gemini: 3339ms STOP | 2650ms STOP
- validator blocks so far: [{"at":"2026-09-17T07:05:52.755Z","codes":["claimed_action"],"attempt":1},{"at":"2026-09-17T07:05:52.755Z","codes":["dangling_colon"],"attempt":2}]
- lead: {"language":"ar","interest":"warm","_prov":{"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.074Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.074Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000f","at":"2026-09-17T07:04:56.320Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000c","at":"2026-09-17T07:03:59.787Z","confirmed":true},"name":{"source":"model","source_msg_id":"cfake00000i","at":"2026-09-17T07:05:52.755Z","confirmed":true}},"version":5,"score":3,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","need":["مطعم مندي","طلبات بتروح بالليل وبعيد عن أوقات الدوام"],"products":["karam"],"objections":["price","staff"],"name":"أبو محمد"}

### Turn 7 — tap — 2026-09-17T07:06:44.943Z

**Customer**
> 🔘 tapped «اليوم 12:30 الظهر» → `book:2026-09-17T09:30:00.000Z`

**Bot** — 1 part(s), 8ms
> (interactive) ثبّتنا مكالمتك مع فريق شِفت: اليوم الساعة 12:30 الظهر بتوقيت عمّان. رح نذكّرك قبلها.

وشو اسم المحل عشان الفريق يكون جاهز؟
> أزرار: [تمام](book_ok) [غيّر الموعد](book_change) [ألغِ المكالمة](book_cancel)

- result: — · stage: `captured` · status: `pending`
- gemini: not called (deterministic path)
- calendar: freeBusy, insertEvent shud3ogvdh83641scaim49r6tn
- staff alert: booking_booked, hot_lead
- validator blocks so far: [{"at":"2026-09-17T07:05:52.755Z","codes":["claimed_action"],"attempt":1},{"at":"2026-09-17T07:05:52.755Z","codes":["dangling_colon"],"attempt":2}]
- booking: {"event_id":"shud3ogvdh83641scaim49r6tn","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-17T09:30:00.000Z","end":"2026-09-17T10:00:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:06:49.944Z","seq":1,"offer_id":"book:2026-09-17T09:30:00.000Z","source_msg_id":"cfake00000k","lang":"ar","reminders":{},"details_pending":true,"details_missing":["business_name"],"history":[{"status":"booked","start":"2026-09-17T09:30:00.000Z","at":"2026-09-17T07:06:49.944Z"}]}
- lead: {"language":"ar","interest":"warm","_prov":{"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.074Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.074Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000f","at":"2026-09-17T07:04:56.320Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000c","at":"2026-09-17T07:03:59.787Z","confirmed":true},"name":{"source":"model","source_msg_id":"cfake00000i","at":"2026-09-17T07:05:52.755Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000k","at":"2026-09-17T07:06:49.944Z","confirmed":true}},"version":6,"score":6,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","need":["مطعم مندي","طلبات بتروح بالليل وبعيد عن أوقات الدوام"],"products":["karam"],"objections":["price","staff"],"name":"أبو محمد","preferred_time":{"text":"اليوم بين 12:30 و1 (الخميس 17/9)","start":"2026-09-17T09:30:00.000Z","end":"2026-09-17T10:00:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-17T09:30:00.000Z"}}

### Turn 8 — tap — 2026-09-17T07:07:36.093Z

**Customer**
> 🔘 tapped «تمام» → `book_ok`

**Bot** — 1 part(s), 4ms
> تمام 👍 منحكي معك اليوم الساعة 12:30 الظهر بتوقيت عمّان.

- result: — · stage: `captured` · status: `pending`
- gemini: not called (deterministic path)
- validator blocks so far: [{"at":"2026-09-17T07:05:52.755Z","codes":["claimed_action"],"attempt":1},{"at":"2026-09-17T07:05:52.755Z","codes":["dangling_colon"],"attempt":2}]
- booking: {"event_id":"shud3ogvdh83641scaim49r6tn","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-17T09:30:00.000Z","end":"2026-09-17T10:00:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:06:49.944Z","seq":1,"offer_id":"book:2026-09-17T09:30:00.000Z","source_msg_id":"cfake00000k","lang":"ar","reminders":{},"details_pending":true,"details_missing":["business_name"],"history":[{"status":"booked","start":"2026-09-17T09:30:00.000Z","at":"2026-09-17T07:06:49.944Z"}]}
- lead: {"language":"ar","interest":"warm","_prov":{"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.074Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.074Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000f","at":"2026-09-17T07:04:56.320Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000c","at":"2026-09-17T07:03:59.787Z","confirmed":true},"name":{"source":"model","source_msg_id":"cfake00000i","at":"2026-09-17T07:05:52.755Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000k","at":"2026-09-17T07:06:49.944Z","confirmed":true}},"version":6,"score":6,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","need":["مطعم مندي","طلبات بتروح بالليل وبعيد عن أوقات الدوام"],"products":["karam"],"objections":["price","staff"],"name":"أبو محمد","preferred_time":{"text":"اليوم بين 12:30 و1 (الخميس 17/9)","start":"2026-09-17T09:30:00.000Z","end":"2026-09-17T10:00:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-17T09:30:00.000Z"}}

### Turn 9 — text — 2026-09-17T07:08:28.119Z

**Customer**
> ماشي، بانتظاركم
> يعطيكم العافية

**Bot** — 1 part(s), 2141ms
> الله يعافيك أستاذ أبو محمد، إن شاء الله بنحكي معك على الوقت.

- result: reply/NONE · stage: `captured` · status: `pending`
- gemini: 2128ms STOP
- validator blocks so far: [{"at":"2026-09-17T07:05:52.755Z","codes":["claimed_action"],"attempt":1},{"at":"2026-09-17T07:05:52.755Z","codes":["dangling_colon"],"attempt":2}]
- booking: {"event_id":"shud3ogvdh83641scaim49r6tn","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-17T09:30:00.000Z","end":"2026-09-17T10:00:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:06:49.944Z","seq":1,"offer_id":"book:2026-09-17T09:30:00.000Z","source_msg_id":"cfake00000k","lang":"ar","reminders":{},"details_pending":true,"details_missing":["business_name"],"history":[{"status":"booked","start":"2026-09-17T09:30:00.000Z","at":"2026-09-17T07:06:49.944Z"}]}
- lead: {"language":"ar","interest":"warm","_prov":{"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.074Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.074Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000f","at":"2026-09-17T07:04:56.320Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:52.234Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000c","at":"2026-09-17T07:03:59.787Z","confirmed":true},"name":{"source":"model","source_msg_id":"cfake00000i","at":"2026-09-17T07:05:52.755Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000k","at":"2026-09-17T07:06:49.944Z","confirmed":true}},"version":6,"score":6,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","need":["مطعم مندي","طلبات بتروح بالليل وبعيد عن أوقات الدوام"],"products":["karam"],"objections":["price","staff"],"name":"أبو محمد","preferred_time":{"text":"اليوم بين 12:30 و1 (الخميس 17/9)","start":"2026-09-17T09:30:00.000Z","end":"2026-09-17T10:00:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-17T09:30:00.000Z"}}

## Final state

```json
{
  "conversation": {
    "status": "pending",
    "current_state": "captured",
    "ai_enabled": true,
    "metadata": {
      "reply_failures": 0
    }
  },
  "lead": {
    "language": "ar",
    "interest": "warm",
    "_prov": {
      "language": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:54.074Z",
        "confirmed": true
      },
      "interest": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:54.074Z",
        "confirmed": true
      },
      "sector": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:52.234Z",
        "confirmed": true
      },
      "sector_text": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:52.234Z",
        "confirmed": true
      },
      "city": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:52.234Z",
        "confirmed": true
      },
      "need": {
        "source": "model",
        "source_msg_id": "cfake00000f",
        "at": "2026-09-17T07:04:56.320Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:52.234Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000c",
        "at": "2026-09-17T07:03:59.787Z",
        "confirmed": true
      },
      "name": {
        "source": "model",
        "source_msg_id": "cfake00000i",
        "at": "2026-09-17T07:05:52.755Z",
        "confirmed": true
      },
      "preferred_time": {
        "source": "booking",
        "source_msg_id": "cfake00000k",
        "at": "2026-09-17T07:06:49.944Z",
        "confirmed": true
      }
    },
    "version": 6,
    "score": 6,
    "sector": "restaurant",
    "sector_text": "مطعم مندي",
    "city": "إربد",
    "need": [
      "مطعم مندي",
      "طلبات بتروح بالليل وبعيد عن أوقات الدوام"
    ],
    "products": [
      "karam"
    ],
    "objections": [
      "price",
      "staff"
    ],
    "name": "أبو محمد",
    "preferred_time": {
      "text": "اليوم بين 12:30 و1 (الخميس 17/9)",
      "start": "2026-09-17T09:30:00.000Z",
      "end": "2026-09-17T10:00:00.000Z",
      "tz": "Asia/Amman",
      "slot_id": "book:2026-09-17T09:30:00.000Z"
    }
  },
  "booking": {
    "event_id": "shud3ogvdh83641scaim49r6tn",
    "calendar_id": "sim-sales-calendar@group.calendar.google.invalid",
    "start": "2026-09-17T09:30:00.000Z",
    "end": "2026-09-17T10:00:00.000Z",
    "tz": "Asia/Amman",
    "status": "booked",
    "booked_at": "2026-09-17T07:06:49.944Z",
    "seq": 1,
    "offer_id": "book:2026-09-17T09:30:00.000Z",
    "source_msg_id": "cfake00000k",
    "lang": "ar",
    "reminders": {},
    "details_pending": true,
    "details_missing": [
      "business_name"
    ],
    "history": [
      {
        "status": "booked",
        "start": "2026-09-17T09:30:00.000Z",
        "at": "2026-09-17T07:06:49.944Z"
      }
    ]
  },
  "calendarEvents": [
    {
      "id": "shud3ogvdh83641scaim49r6tn",
      "status": "confirmed",
      "summary": "مكالمة شِفت — أبو محمد (+962790000555)",
      "start": {
        "dateTime": "2026-09-17T09:30:00.000Z",
        "timeZone": "Asia/Amman"
      },
      "end": {
        "dateTime": "2026-09-17T10:00:00.000Z",
        "timeZone": "Asia/Amman"
      },
      "description": "الاسم: أبو محمد\nالقطاع: مطعم/كافيه — مطعم مندي\nالاحتياج: مطعم مندي، طلبات بتروح بالليل وبعيد عن أوقات الدوام\nواتساب: +962790000555\nالملف الشخصي: أبو محمد\n\nInbox: https://inbox.sim.test\nconversation=cfake000001"
    }
  ],
  "calendarOps": [
    {
      "at": "2026-09-17T07:00:54.112Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:03:03.908Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:04:56.324Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:06:49.946Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-17T10:00:00.000Z",
      "busy": 0
    },
    {
      "at": "2026-09-17T07:06:49.947Z",
      "op": "insertEvent",
      "eventId": "shud3ogvdh83641scaim49r6tn",
      "summary": "مكالمة شِفت — أبو محمد (+962790000555)",
      "start": {
        "dateTime": "2026-09-17T09:30:00.000Z",
        "timeZone": "Asia/Amman"
      },
      "end": {
        "dateTime": "2026-09-17T10:00:00.000Z",
        "timeZone": "Asia/Amman"
      }
    }
  ],
  "alerts": [
    "quote",
    "booking_booked",
    "hot_lead"
  ],
  "gemini": {
    "calls": 9,
    "failures": 1,
    "blocked": 0
  },
  "openrouter": {
    "calls": 9,
    "promptTokens": 16444,
    "completionTokens": 603,
    "cost": 0.031038
  }
}
```

<details><summary>full workflow_data</summary>

```json
{
  "bot_turns": 7,
  "disclosed_at": "2026-09-17T07:00:54.074Z",
  "nudge": null,
  "questions_asked": 1,
  "msgs_since_interest": 1,
  "last_ask": null,
  "last_bot": {
    "stage": "captured",
    "next_step": "confirmed",
    "at": "2026-09-17T07:08:34.621Z",
    "action": "NONE"
  },
  "lead": {
    "language": "ar",
    "interest": "warm",
    "_prov": {
      "language": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:54.074Z",
        "confirmed": true
      },
      "interest": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:54.074Z",
        "confirmed": true
      },
      "sector": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:52.234Z",
        "confirmed": true
      },
      "sector_text": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:52.234Z",
        "confirmed": true
      },
      "city": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:52.234Z",
        "confirmed": true
      },
      "need": {
        "source": "model",
        "source_msg_id": "cfake00000f",
        "at": "2026-09-17T07:04:56.320Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:52.234Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000c",
        "at": "2026-09-17T07:03:59.787Z",
        "confirmed": true
      },
      "name": {
        "source": "model",
        "source_msg_id": "cfake00000i",
        "at": "2026-09-17T07:05:52.755Z",
        "confirmed": true
      },
      "preferred_time": {
        "source": "booking",
        "source_msg_id": "cfake00000k",
        "at": "2026-09-17T07:06:49.944Z",
        "confirmed": true
      }
    },
    "version": 6,
    "score": 6,
    "sector": "restaurant",
    "sector_text": "مطعم مندي",
    "city": "إربد",
    "need": [
      "مطعم مندي",
      "طلبات بتروح بالليل وبعيد عن أوقات الدوام"
    ],
    "products": [
      "karam"
    ],
    "objections": [
      "price",
      "staff"
    ],
    "name": "أبو محمد",
    "preferred_time": {
      "text": "اليوم بين 12:30 و1 (الخميس 17/9)",
      "start": "2026-09-17T09:30:00.000Z",
      "end": "2026-09-17T10:00:00.000Z",
      "tz": "Asia/Amman",
      "slot_id": "book:2026-09-17T09:30:00.000Z"
    }
  },
  "needs_team": {
    "reason": "meeting",
    "summary": "مكالمة محجوزة: اليوم بين 12:30 و1 (الخميس 17/9)",
    "at": "2026-09-17T07:06:49.944Z",
    "resolved_at": null,
    "sla_note_sent_at": null,
    "claimed_at": null,
    "claimed_by": null
  },
  "validator_blocks": [
    {
      "at": "2026-09-17T07:05:52.755Z",
      "codes": [
        "claimed_action"
      ],
      "attempt": 1
    },
    {
      "at": "2026-09-17T07:05:52.755Z",
      "codes": [
        "dangling_colon"
      ],
      "attempt": 2
    }
  ],
  "booking": {
    "event_id": "shud3ogvdh83641scaim49r6tn",
    "calendar_id": "sim-sales-calendar@group.calendar.google.invalid",
    "start": "2026-09-17T09:30:00.000Z",
    "end": "2026-09-17T10:00:00.000Z",
    "tz": "Asia/Amman",
    "status": "booked",
    "booked_at": "2026-09-17T07:06:49.944Z",
    "seq": 1,
    "offer_id": "book:2026-09-17T09:30:00.000Z",
    "source_msg_id": "cfake00000k",
    "lang": "ar",
    "reminders": {},
    "details_pending": true,
    "details_missing": [
      "business_name"
    ],
    "history": [
      {
        "status": "booked",
        "start": "2026-09-17T09:30:00.000Z",
        "at": "2026-09-17T07:06:49.944Z"
      }
    ]
  },
  "slot_offers": [],
  "capture_pending": null
}
```

</details>