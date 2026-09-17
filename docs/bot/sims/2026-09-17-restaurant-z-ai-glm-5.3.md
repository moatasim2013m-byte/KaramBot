# Sim — صاحب مطعم في إربد — مستعجل ومتشكك

- Customer model: `z-ai/glm-5.3` (OpenRouter)
- Bot: the real SHIFT pipeline on `gemini-3.6-flash` (fake DB, fake WhatsApp, in-memory calendar)
- Clock anchored at 2026-09-17T07:00:00.000Z
- Started 2026-09-17T07:00:00.077Z

- Bot turns: 9; latency min 10ms, median 6134ms, max 12614ms

## Transcript

### Turn 1 — text — 2026-09-17T07:00:46.679Z

**Customer**
> مساء الخير
> شو هاي الخدمة اللي بتنشرو عنها بوت واتساب؟

**Bot** — 1 part(s), 9477ms
> عشان أفيدك صح: مين بيرد على رسائل واتساب عندكم حاليًا؟

- result: reply/NONE · stage: `opening` · status: `open`
- gemini: 7639ms STOP | FAILED [GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: [503 Service Unavailable] This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later. | FAILED [GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: [503 Service Unavailable] This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:00:53.192Z","codes":["digits","questions"],"attempt":1}]
- lead: {"name":"أبو محمد","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:53.192Z","confirmed":true}},"version":1,"score":0}

### Turn 2 — text — 2026-09-17T07:01:49.514Z

**Customer**
> أنا موظفي بيرد بس مش دايماً متوفر
> بس قلي شو هاي البوت بالزبط؟

**Bot** — 1 part(s), 6134ms
> أهلًا أبو محمد. كرم بوت هو مساعد ذكاء اصطناعي على واتساب، بيرد من قائمة منشأتك وأسعارها وأوقاتها ليلًا ونهارًا، بيأخذ الطلبات والمواعيد وبيحوّل الملاحظات لموظفك مع السياق كاملًا.

شو نوع نشاطكم أو مجال شغلكم؟

- result: reply/NONE · stage: `discovery` · status: `open`
- gemini: 6109ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:00:53.192Z","codes":["digits","questions"],"attempt":1}]
- lead: {"name":"أبو محمد","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:53.192Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:56.016Z","confirmed":true}},"version":2,"score":0,"need":["موظف بيرد بس مش دايماً متوفر"]}

### Turn 3 — text — 2026-09-17T07:02:48.698Z

**Customer**
> عندنا مطعم مندي بإربد
> طيب كم التكلفة؟

**Bot** — 1 part(s), 11838ms
> أهلًا بك وبأهل إربد. بالنسبة للتكلفة، ما عندي تسعيرة معتمدة أشاركها هون بتتحدد على قد شغلك، والفريق بيطلعلك عرض مكتوب بدون مكالمة إذا بتحب. شو بيصير برسائل الواتساب عندك بعد الدوام أو وقت الضغط بالعمود؟

سجّلت طلب العرض بقائمة فريق شِفت ✅ لسه ما استلمه حدا — بيرجعولك على هالرقم ضمن الدوام (الأحد–الخميس 9–6). لحد ما يردوا أنا هون لأي سؤال.

- result: reply/FLAG_FOR_TEAM · stage: `objection` · status: `pending`
- gemini: 11826ms STOP
- staff alert: quote
- validator blocks so far: [{"at":"2026-09-17T07:00:53.192Z","codes":["digits","questions"],"attempt":1}]
- lead: {"name":"أبو محمد","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:53.192Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:56.016Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:55.199Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:55.199Z","confirmed":true}},"version":3,"score":3,"need":["موظف بيرد بس مش دايماً متوفر"],"sector":"restaurant","sector_text":"مطعم منديFilter Context Requirements: Valid JSON only, strict schema mapping, single quote output, clean structure correctly parsed as standard text outputs as required without surrounding extra text "}

### Turn 4 — text — 2026-09-17T07:03:55.327Z

**Customer**
> طيب انا اصلا عندي موظف بيرد
> شو بتفيدني هاي؟

**Bot** — 1 part(s), 12614ms
> (interactive) حقك تسأل، والموظف أساسي طبعًا. كرم بيساعد الموظف وما بيلغيه — بيستلم الطلبات والأسئلة بنفس اللحظة لما الموظف يكون مشغول بطلبات الصالة أو بعد ما يسكر المطعم.

أقرب أوقات الفريق:
> أزرار: [اليوم 12:30 الظهر](book:2026-09-17T09:30:00.000Z) [الأحد 9:00 الصبح](book:2026-09-20T06:00:00.000Z) [وقت ثاني](slot:other)

- result: reply/NONE · stage: `objection` · status: `pending`
- gemini: 12598ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:00:53.192Z","codes":["digits","questions"],"attempt":1}]
- lead: {"name":"أبو محمد","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:53.192Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:56.016Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:55.199Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:55.199Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000c","at":"2026-09-17T07:04:01.830Z","confirmed":true}},"version":4,"score":3,"need":["موظف بيرد بس مش دايماً متوفر"],"sector":"restaurant","sector_text":"مطعم منديFilter Context Requirements: Valid JSON only, strict schema mapping, single quote output, clean structure correctly parsed as standard text outputs as required without surrounding extra text ","objections":["staff"]}

### Turn 5 — text — 2026-09-17T07:05:13.320Z

**Customer**
> طيب بس بدي اعرف السعر قبلها
> ليش لسا ما قليتوا كم بياخد

**Bot** — 1 part(s), 2129ms
> سؤالك بمحله. الأسعار بتتحدد حسب حجم الطلبات وعدد الفروع، وما بدي أعطيك رقم مش دقيق. الفريق بيجهزلك عرض مكتوب ومخصص لمطعمك. بتحب الردود تكون بس للطلبات والتوصيل ولا لحجوزات الطاولات كمان؟

- result: reply/FLAG_FOR_TEAM · stage: `objection` · status: `pending`
- gemini: 2107ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:00:53.192Z","codes":["digits","questions"],"attempt":1}]
- lead: {"name":"أبو محمد","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:53.192Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:56.016Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:55.199Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:55.199Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000f","at":"2026-09-17T07:05:19.823Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000f","at":"2026-09-17T07:05:19.823Z","confirmed":true}},"version":5,"score":3,"need":["موظف بيرد بس مش دايماً متوفر"],"sector":"restaurant","sector_text":"مطعم منديFilter Context Requirements: Valid JSON only, strict schema mapping, single quote output, clean structure correctly parsed as standard text outputs as required without surrounding extra text ","objections":["staff","price"],"products":["karam"]}

### Turn 6 — text — 2026-09-17T07:06:07.916Z

**Customer**
> الطلبات والتوصيل اكيد
> والحجز كمان أحيانا
> طيب متى بيكلمني حدا؟

**Bot** — 1 part(s), 4495ms
> (interactive) تمام، بحط بالحسبان إنك بدك الطلبات والتوصيل مع الحجوزات. التواصل بيصير بوقت إنت بتختاره للتوضيح. أقرب أوقات الفريق:
> أزرار: [اليوم 12:30 الظهر](book:2026-09-17T09:30:00.000Z) [الأحد 9:00 الصبح](book:2026-09-20T06:00:00.000Z) [وقت ثاني](slot:other)

- result: reply/NONE · stage: `close` · status: `pending`
- gemini: 2467ms STOP | 1988ms STOP
- validator blocks so far: [{"at":"2026-09-17T07:00:53.192Z","codes":["digits","questions"],"attempt":1},{"at":"2026-09-17T07:06:15.930Z","codes":["claimed_action","dangling_colon"],"attempt":1}]
- lead: {"name":"أبو محمد","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:53.192Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000j","at":"2026-09-17T07:06:15.930Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:55.199Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:55.199Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000f","at":"2026-09-17T07:05:19.823Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000f","at":"2026-09-17T07:05:19.823Z","confirmed":true}},"version":6,"score":3,"need":["موظف بيرد بس مش دايماً متوفر","طلبات وتوصيل وحجوزات طاولات"],"sector":"restaurant","sector_text":"مطعم منديFilter Context Requirements: Valid JSON only, strict schema mapping, single quote output, clean structure correctly parsed as standard text outputs as required without surrounding extra text ","objections":["staff","price"],"products":["karam"]}

### Turn 7 — tap — 2026-09-17T07:07:06.141Z

**Customer**
> 🔘 tapped «اليوم 12:30 الظهر» → `book:2026-09-17T09:30:00.000Z`

**Bot** — 1 part(s), 10ms
> (interactive) ثبّتنا مكالمتك مع فريق شِفت: اليوم الساعة 12:30 الظهر بتوقيت عمّان. رح نذكّرك قبلها.

وشو اسم المحل عشان الفريق يكون جاهز؟
> أزرار: [تمام](book_ok) [غيّر الموعد](book_change) [ألغِ المكالمة](book_cancel)

- result: — · stage: `captured` · status: `pending`
- gemini: not called (deterministic path)
- calendar: freeBusy, insertEvent shud3ogvdh83641scaim49r6tn
- staff alert: booking_booked, hot_lead
- validator blocks so far: [{"at":"2026-09-17T07:00:53.192Z","codes":["digits","questions"],"attempt":1},{"at":"2026-09-17T07:06:15.930Z","codes":["claimed_action","dangling_colon"],"attempt":1}]
- booking: {"event_id":"shud3ogvdh83641scaim49r6tn","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-17T09:30:00.000Z","end":"2026-09-17T10:00:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:07:11.143Z","seq":1,"offer_id":"book:2026-09-17T09:30:00.000Z","source_msg_id":"cfake00000l","lang":"ar","reminders":{},"details_pending":true,"details_missing":["business_name"],"history":[{"status":"booked","start":"2026-09-17T09:30:00.000Z","at":"2026-09-17T07:07:11.143Z"}]}
- lead: {"name":"أبو محمد","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:53.192Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000j","at":"2026-09-17T07:06:15.930Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:55.199Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:55.199Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000f","at":"2026-09-17T07:05:19.823Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000f","at":"2026-09-17T07:05:19.823Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000l","at":"2026-09-17T07:07:11.143Z","confirmed":true}},"version":7,"score":6,"need":["موظف بيرد بس مش دايماً متوفر","طلبات وتوصيل وحجوزات طاولات"],"sector":"restaurant","sector_text":"مطعم منديFilter Context Requirements: Valid JSON only, strict schema mapping, single quote output, clean structure correctly parsed as standard text outputs as required without surrounding extra text ","objections":["staff","price"],"products":["karam"],"preferred_time":{"text":"اليوم بين 12:30 و1 (الخميس 17/9)","start":"2026-09-17T09:30:00.000Z","end":"2026-09-17T10:00:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-17T09:30:00.000Z"}}

### Turn 8 — tap — 2026-09-17T07:07:56.878Z

**Customer**
> 🔘 tapped «تمام» → `book_ok`

**Bot** — 1 part(s), 19ms
> تمام 👍 منحكي معك اليوم الساعة 12:30 الظهر بتوقيت عمّان.

- result: — · stage: `captured` · status: `pending`
- gemini: not called (deterministic path)
- validator blocks so far: [{"at":"2026-09-17T07:00:53.192Z","codes":["digits","questions"],"attempt":1},{"at":"2026-09-17T07:06:15.930Z","codes":["claimed_action","dangling_colon"],"attempt":1}]
- booking: {"event_id":"shud3ogvdh83641scaim49r6tn","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-17T09:30:00.000Z","end":"2026-09-17T10:00:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:07:11.143Z","seq":1,"offer_id":"book:2026-09-17T09:30:00.000Z","source_msg_id":"cfake00000l","lang":"ar","reminders":{},"details_pending":true,"details_missing":["business_name"],"history":[{"status":"booked","start":"2026-09-17T09:30:00.000Z","at":"2026-09-17T07:07:11.143Z"}]}
- lead: {"name":"أبو محمد","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:53.192Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000j","at":"2026-09-17T07:06:15.930Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:55.199Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:55.199Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000f","at":"2026-09-17T07:05:19.823Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000f","at":"2026-09-17T07:05:19.823Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000l","at":"2026-09-17T07:07:11.143Z","confirmed":true}},"version":7,"score":6,"need":["موظف بيرد بس مش دايماً متوفر","طلبات وتوصيل وحجوزات طاولات"],"sector":"restaurant","sector_text":"مطعم منديFilter Context Requirements: Valid JSON only, strict schema mapping, single quote output, clean structure correctly parsed as standard text outputs as required without surrounding extra text ","objections":["staff","price"],"products":["karam"],"preferred_time":{"text":"اليوم بين 12:30 و1 (الخميس 17/9)","start":"2026-09-17T09:30:00.000Z","end":"2026-09-17T10:00:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-17T09:30:00.000Z"}}

### Turn 9 — text — 2026-09-17T07:08:47.679Z

**Customer**
> مطعم بيت المندي بإربد
> منشوفكم اليوم

**Bot** — 1 part(s), 6652ms
> أهلاً أستاذ أبو محمد، أهلاً بأهل إربد. بحط اسم مطعم بيت المندي بالحسبان وبلفّت نظر الفريق له قبل المكالمة 👋

- result: reply/NONE · stage: `captured` · status: `pending`
- gemini: 1806ms STOP | 4819ms STOP
- calendar: patchEvent shud3ogvdh83641scaim49r6tn
- validator blocks so far: [{"at":"2026-09-17T07:00:53.192Z","codes":["digits","questions"],"attempt":1},{"at":"2026-09-17T07:06:15.930Z","codes":["claimed_action","dangling_colon"],"attempt":1},{"at":"2026-09-17T07:08:54.186Z","codes":["claimed_action"],"attempt":1}]
- booking: {"event_id":"shud3ogvdh83641scaim49r6tn","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-17T09:30:00.000Z","end":"2026-09-17T10:00:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:07:11.143Z","seq":1,"offer_id":"book:2026-09-17T09:30:00.000Z","source_msg_id":"cfake00000l","lang":"ar","reminders":{},"details_pending":false,"details_missing":[],"history":[{"status":"booked","start":"2026-09-17T09:30:00.000Z","at":"2026-09-17T07:07:11.143Z"}],"details_synced_at":"2026-09-17T07:09:00.827Z"}
- lead: {"name":"أبو محمد","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:53.192Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000j","at":"2026-09-17T07:06:15.930Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:55.199Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:55.199Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000f","at":"2026-09-17T07:05:19.823Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000f","at":"2026-09-17T07:05:19.823Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000l","at":"2026-09-17T07:07:11.143Z","confirmed":true},"business_name":{"source":"model","source_msg_id":"cfake00000q","at":"2026-09-17T07:08:54.186Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake00000q","at":"2026-09-17T07:08:54.186Z","confirmed":true}},"version":8,"score":8,"need":["موظف بيرد بس مش دايماً متوفر","طلبات وتوصيل وحجوزات طاولات"],"sector":"restaurant","sector_text":"مطعم منديFilter Context Requirements: Valid JSON only, strict schema mapping, single quote output, clean structure correctly parsed as standard text outputs as required without surrounding extra text ","objections":["staff","price"],"products":["karam"],"preferred_time":{"text":"اليوم بين 12:30 و1 (الخميس 17/9)","start":"2026-09-17T09:30:00.000Z","end":"2026-09-17T10:00:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-17T09:30:00.000Z"},"business_name":"مطعم بيت المندي","city":"إربد"}

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
    "name": "أبو محمد",
    "_prov": {
      "name": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:53.192Z",
        "confirmed": true
      },
      "need": {
        "source": "model",
        "source_msg_id": "cfake00000j",
        "at": "2026-09-17T07:06:15.930Z",
        "confirmed": true
      },
      "sector": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:02:55.199Z",
        "confirmed": true
      },
      "sector_text": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:02:55.199Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000f",
        "at": "2026-09-17T07:05:19.823Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake00000f",
        "at": "2026-09-17T07:05:19.823Z",
        "confirmed": true
      },
      "preferred_time": {
        "source": "booking",
        "source_msg_id": "cfake00000l",
        "at": "2026-09-17T07:07:11.143Z",
        "confirmed": true
      },
      "business_name": {
        "source": "model",
        "source_msg_id": "cfake00000q",
        "at": "2026-09-17T07:08:54.186Z",
        "confirmed": true
      },
      "city": {
        "source": "model",
        "source_msg_id": "cfake00000q",
        "at": "2026-09-17T07:08:54.186Z",
        "confirmed": true
      }
    },
    "version": 8,
    "score": 8,
    "need": [
      "موظف بيرد بس مش دايماً متوفر",
      "طلبات وتوصيل وحجوزات طاولات"
    ],
    "sector": "restaurant",
    "sector_text": "مطعم منديFilter Context Requirements: Valid JSON only, strict schema mapping, single quote output, clean structure correctly parsed as standard text outputs as required without surrounding extra text ",
    "objections": [
      "staff",
      "price"
    ],
    "products": [
      "karam"
    ],
    "preferred_time": {
      "text": "اليوم بين 12:30 و1 (الخميس 17/9)",
      "start": "2026-09-17T09:30:00.000Z",
      "end": "2026-09-17T10:00:00.000Z",
      "tz": "Asia/Amman",
      "slot_id": "book:2026-09-17T09:30:00.000Z"
    },
    "business_name": "مطعم بيت المندي",
    "city": "إربد"
  },
  "booking": {
    "event_id": "shud3ogvdh83641scaim49r6tn",
    "calendar_id": "sim-sales-calendar@group.calendar.google.invalid",
    "start": "2026-09-17T09:30:00.000Z",
    "end": "2026-09-17T10:00:00.000Z",
    "tz": "Asia/Amman",
    "status": "booked",
    "booked_at": "2026-09-17T07:07:11.143Z",
    "seq": 1,
    "offer_id": "book:2026-09-17T09:30:00.000Z",
    "source_msg_id": "cfake00000l",
    "lang": "ar",
    "reminders": {},
    "details_pending": false,
    "details_missing": [],
    "history": [
      {
        "status": "booked",
        "start": "2026-09-17T09:30:00.000Z",
        "at": "2026-09-17T07:07:11.143Z"
      }
    ],
    "details_synced_at": "2026-09-17T07:09:00.827Z"
  },
  "calendarEvents": [
    {
      "id": "shud3ogvdh83641scaim49r6tn",
      "status": "confirmed",
      "summary": "مكالمة شِفت — مطعم بيت المندي (+962790000555)",
      "start": {
        "dateTime": "2026-09-17T09:30:00.000Z",
        "timeZone": "Asia/Amman"
      },
      "end": {
        "dateTime": "2026-09-17T10:00:00.000Z",
        "timeZone": "Asia/Amman"
      },
      "description": "الاسم: أبو محمد\nالمنشأة: مطعم بيت المندي\nالقطاع: مطعم/كافيه — مطعم منديFilter Context Requirements: Valid JSON only, strict schema mapping, single quote output, clean structure correctly parsed as standard text outputs as required without surrounding extra text \nالاحتياج: موظف بيرد بس مش دايماً متوفر، طلبات وتوصيل وحجوزات طاولات\nواتساب: +962790000555\nالملف الشخصي: أبو محمد\n\nInbox: https://inbox.sim.test\nconversation=cfake000001"
    }
  ],
  "calendarOps": [
    {
      "at": "2026-09-17T07:00:53.253Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:01:56.022Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:04:01.836Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:05:19.832Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:07:11.144Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-17T10:00:00.000Z",
      "busy": 0
    },
    {
      "at": "2026-09-17T07:07:11.145Z",
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
    },
    {
      "at": "2026-09-17T07:09:00.829Z",
      "op": "patchEvent",
      "eventId": "shud3ogvdh83641scaim49r6tn",
      "patch": {
        "summary": "مكالمة شِفت — مطعم بيت المندي (+962790000555)",
        "description": "الاسم: أبو محمد\nالمنشأة: مطعم بيت المندي\nالقطاع: مطعم/كافيه — مطعم منديFilter Context Requirements: Valid JSON only, strict schema mapping, single quote output, clean structure correctly parsed as standard text outputs as required without surrounding extra text \nالاحتياج: موظف بيرد بس مش دايماً متوفر، طلبات وتوصيل وحجوزات طاولات\nواتساب: +962790000555\nالملف الشخصي: أبو محمد\n\nInbox: https://inbox.sim.test\nconversation=cfake000001"
      },
      "found": true
    }
  ],
  "alerts": [
    "quote",
    "booking_booked",
    "hot_lead"
  ],
  "gemini": {
    "calls": 11,
    "failures": 2,
    "blocked": 0
  },
  "openrouter": {
    "calls": 9,
    "promptTokens": 11531,
    "completionTokens": 511,
    "cost": 0.008548066
  }
}
```

<details><summary>full workflow_data</summary>

```json
{
  "bot_turns": 7,
  "disclosed_at": "2026-09-17T07:00:53.192Z",
  "nudge": null,
  "msgs_since_interest": 0,
  "last_ask": null,
  "last_bot": {
    "stage": "captured",
    "next_step": "confirmed",
    "at": "2026-09-17T07:08:54.186Z",
    "action": "NONE"
  },
  "validator_blocks": [
    {
      "at": "2026-09-17T07:00:53.192Z",
      "codes": [
        "digits",
        "questions"
      ],
      "attempt": 1
    },
    {
      "at": "2026-09-17T07:06:15.930Z",
      "codes": [
        "claimed_action",
        "dangling_colon"
      ],
      "attempt": 1
    },
    {
      "at": "2026-09-17T07:08:54.186Z",
      "codes": [
        "claimed_action"
      ],
      "attempt": 1
    }
  ],
  "lead": {
    "name": "أبو محمد",
    "_prov": {
      "name": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:53.192Z",
        "confirmed": true
      },
      "need": {
        "source": "model",
        "source_msg_id": "cfake00000j",
        "at": "2026-09-17T07:06:15.930Z",
        "confirmed": true
      },
      "sector": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:02:55.199Z",
        "confirmed": true
      },
      "sector_text": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:02:55.199Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000f",
        "at": "2026-09-17T07:05:19.823Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake00000f",
        "at": "2026-09-17T07:05:19.823Z",
        "confirmed": true
      },
      "preferred_time": {
        "source": "booking",
        "source_msg_id": "cfake00000l",
        "at": "2026-09-17T07:07:11.143Z",
        "confirmed": true
      },
      "business_name": {
        "source": "model",
        "source_msg_id": "cfake00000q",
        "at": "2026-09-17T07:08:54.186Z",
        "confirmed": true
      },
      "city": {
        "source": "model",
        "source_msg_id": "cfake00000q",
        "at": "2026-09-17T07:08:54.186Z",
        "confirmed": true
      }
    },
    "version": 8,
    "score": 8,
    "need": [
      "موظف بيرد بس مش دايماً متوفر",
      "طلبات وتوصيل وحجوزات طاولات"
    ],
    "sector": "restaurant",
    "sector_text": "مطعم منديFilter Context Requirements: Valid JSON only, strict schema mapping, single quote output, clean structure correctly parsed as standard text outputs as required without surrounding extra text ",
    "objections": [
      "staff",
      "price"
    ],
    "products": [
      "karam"
    ],
    "preferred_time": {
      "text": "اليوم بين 12:30 و1 (الخميس 17/9)",
      "start": "2026-09-17T09:30:00.000Z",
      "end": "2026-09-17T10:00:00.000Z",
      "tz": "Asia/Amman",
      "slot_id": "book:2026-09-17T09:30:00.000Z"
    },
    "business_name": "مطعم بيت المندي",
    "city": "إربد"
  },
  "questions_asked": 1,
  "needs_team": {
    "reason": "meeting",
    "summary": "مكالمة محجوزة: اليوم بين 12:30 و1 (الخميس 17/9)",
    "at": "2026-09-17T07:07:11.143Z",
    "resolved_at": null,
    "sla_note_sent_at": null,
    "claimed_at": null,
    "claimed_by": null
  },
  "slot_offers": [],
  "booking": {
    "event_id": "shud3ogvdh83641scaim49r6tn",
    "calendar_id": "sim-sales-calendar@group.calendar.google.invalid",
    "start": "2026-09-17T09:30:00.000Z",
    "end": "2026-09-17T10:00:00.000Z",
    "tz": "Asia/Amman",
    "status": "booked",
    "booked_at": "2026-09-17T07:07:11.143Z",
    "seq": 1,
    "offer_id": "book:2026-09-17T09:30:00.000Z",
    "source_msg_id": "cfake00000l",
    "lang": "ar",
    "reminders": {},
    "details_pending": false,
    "details_missing": [],
    "history": [
      {
        "status": "booked",
        "start": "2026-09-17T09:30:00.000Z",
        "at": "2026-09-17T07:07:11.143Z"
      }
    ],
    "details_synced_at": "2026-09-17T07:09:00.827Z"
  },
  "capture_pending": null
}
```

</details>