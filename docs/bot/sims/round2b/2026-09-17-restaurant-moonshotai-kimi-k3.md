# Sim — صاحب مطعم في إربد — مستعجل ومتشكك

- Customer model: `moonshotai/kimi-k3` (OpenRouter)
- Bot: the real SHIFT pipeline on `gemini-3.6-flash` (fake DB, fake WhatsApp, in-memory calendar)
- Clock anchored at 2026-09-17T07:00:00.000Z
- Started 2026-09-17T07:00:00.077Z

- Bot turns: 10; latency min 4ms, median 5144ms, max 20447ms

## Transcript

### Turn 1 — text — 2026-09-17T07:00:47.641Z

**Customer**
> السلام عليكم
> شفت إعلانكم، شو هاي خدمة البوت بالضبط؟

**Bot** — 1 part(s), 2704ms
> وعليكم السلام ورحمة الله، أهلاً بك أبو محمد👋 أنا كرم، مساعد شِفت الذكي (shifts-ai.com) — نفس محرّك كرم اللي بنركّبه عندك بس هون بمعلومات شِفت. هو وكيل ذكاء اصطناعي على واتساب بيرد على زباينك، بيأخذ الطلبات والمواعيد 24/7. شو نوع نشاطك التجاري؟

- result: reply/NONE · stage: `opening` · status: `open`
- gemini: 2584ms STOP
- calendar: freeBusy

### Turn 2 — text — 2026-09-17T07:01:44.178Z

**Customer**
> عندي مطعم مندي بإربد
> وقديش بيكلف هالحكي؟

**Bot** — 1 part(s), 20447ms
> أهلاً بك وبأهل إربد. ما عندي سعر معتمد أقدر أعطيك إياه هون وما بدي أخمّن. بدك كرم يرد على المنيو والأسعار بس، ولا كمان يستقبل الطلبات والعناوين؟ بنقدر بنفس الوقت نبعثلك عرض مكتوب أو نجرب مثال.

سجّلت طلب العرض بقائمة فريق شِفت ✅ لسه ما استلمه حدا — بيرجعولك على هالرقم ضمن الدوام (الأحد–الخميس 9–6). لحد ما يردوا أنا هون لأي سؤال.

- result: reply/FLAG_FOR_TEAM · stage: `objection` · status: `pending`
- gemini: FAILED [GoogleGenerativeAI Error]: Request aborted when fetching https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: This operation was aborted | 5411ms STOP
- staff alert: quote
- lead: {"business_name":"مطعم مندي","sector":"restaurant","sector_text":"مطعم مندي package/type: restaurant, city: إربد, interest: ho","_prov":{"business_name":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true}},"version":1,"score":5}

### Turn 3 — text — 2026-09-17T07:02:59.797Z

**Customer**
> يعني ما في سعر واضح؟
> بصراحة عندي موظف بيرد على الواتساب، شو بتفيدني زيادة؟

**Bot** — 1 part(s), 17188ms
> حقك تسأل. كرم بيشتغل كمساعد للموظف مش بديل عنه — بيغطي أوقات الضغط والليل لما الموظف ما يلحق أو يكون مجاز. مين بيرد على طلبات زباينكم بعد الساعة 10 بالليل؟

- result: reply/NONE · stage: `objection` · status: `pending`
- gemini: FAILED [GoogleGenerativeAI Error]: Request aborted when fetching https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: This operation was aborted | 2173ms STOP
- calendar: freeBusy
- lead: {"business_name":"مطعم مندي","sector":"restaurant","sector_text":"مطعم مندي package/type: restaurant, city: إربد, interest: ho","_prov":{"business_name":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:06.299Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:06.299Z","confirmed":true}},"version":2,"score":5,"products":["karam"],"objections":["staff"]}

### Turn 4 — text — 2026-09-17T07:04:12.348Z

**Customer**
> والله بصير في طلبات بالليل
> بس بظل حاسس إنه غالي علي، مطعم صغير ما بصرف معي

**Bot** — 1 part(s), 5144ms
> فهّمت عليك أبو محمد، وإذا المطعم صغير والرسائل قليلة فالتأجيل قرار صح. كرم بيغطي طلبات الليل عشان ما تضيع، بس بدك نجرّب مثال كزبون وتشوف كيف بيشتغل قبل ما تقرر؟

- result: reply/NONE · stage: `objection` · status: `pending`
- gemini: 5132ms STOP
- calendar: freeBusy
- lead: {"business_name":"مطعم مندي","sector":"restaurant","sector_text":"مطعم مندي package/type: restaurant, city: إربد, interest: ho","_prov":{"business_name":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:06.299Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000c","at":"2026-09-17T07:04:18.851Z","confirmed":true}},"version":3,"score":5,"products":["karam"],"objections":["staff","price"]}

### Turn 5 — text — 2026-09-17T07:05:15.596Z

**Customer**
> خلاص، خليني أحكي مع حدا من فريقكم
> متى بقدر أعمل مكالمة؟

**Bot** — 1 part(s), 6ms
> ولا يهمك.

سجّلت طلبك بقائمة الفريق مع ملخص محادثتنا — لسه ما استلمه حدا، وبيردوا عليك هون ضمن الدوام (الأحد–الخميس 9–6). لو احتجت أي شي بالوقت هذا أنا هون.

- result: handoff/HANDOFF_TO_HUMAN · stage: `handoff` · status: `pending`
- gemini: not called (deterministic path)
- staff alert: handoff
- lead: {"business_name":"مطعم مندي","sector":"restaurant","sector_text":"مطعم مندي package/type: restaurant, city: إربد, interest: ho","_prov":{"business_name":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:06.299Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000c","at":"2026-09-17T07:04:18.851Z","confirmed":true}},"version":3,"score":5,"products":["karam"],"objections":["staff","price"]}

### Turn 6 — text — 2026-09-17T07:06:09.518Z

**Customer**
> تمام، بكرة الساعة 11 الصبح منيح علي
> خبروني قبلها بشوي

**Bot** — 1 part(s), 2179ms
> تمام أبو محمد، بحط بكرة الجمعة الساعة 11 الصبح بالحسبان وبخبرهم ينبهوك قبلها.

سجّلت طلب مكالمة: مطعم مندي، بكرة الساعة 11 الصبح بتوقيت عمّان — طلب مش موعد مؤكد، الفريق بيأكد الساعة بالضبط معك هون. إذا بتفضّل اتصال بدل الرسائل، اكتبلي.

- result: reply/CAPTURE_TIME · stage: `captured` · status: `pending`
- gemini: 2158ms STOP
- staff alert: meeting, hot_lead
- lead: {"business_name":"مطعم مندي","sector":"restaurant","sector_text":"مطعم مندي package/type: restaurant, city: إربد, interest: ho","_prov":{"business_name":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:06.299Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000c","at":"2026-09-17T07:04:18.851Z","confirmed":true},"preferred_time":{"source":"model","source_msg_id":"cfake00000i","at":"2026-09-17T07:06:16.020Z","confirmed":true}},"version":4,"score":8,"products":["karam"],"objections":["staff","price"],"preferred_time":{"text":"بكرة الساعة 11 الصبح"}}

### Turn 7 — text — 2026-09-17T07:07:06.253Z

**Customer**
> بكرة جمعة، مو دوام عندكم؟
> المهم حدا يحكي معي ويقلي السعر

**Bot** — 1 part(s), 7856ms
> (interactive) صح عليك أستاذ، الجمعة عطلة الفريق فبنخلي المتابعة يوم الأحد الساعة 11 الصبح أول الدوام، وبنخبرهم عن تفاصيل السعر (بنستخدم اسمك واسم منشأتك لتنظيم المتابعة — shifts-ai.com/privacy). بحكي مع أستاذ أبو محمد، صح؟

أقرب أوقات الفريق:
> أزرار: [اليوم 12:30 الظهر](book:2026-09-17T09:30:00.000Z) [الأحد 9:00 الصبح](book:2026-09-20T06:00:00.000Z) [وقت ثاني](slot:other)

- result: reply/NONE · stage: `captured` · status: `pending`
- gemini: 7833ms STOP
- calendar: freeBusy
- lead: {"business_name":"مطعم مندي","sector":"restaurant","sector_text":"مطعم مندي package/type: restaurant, city: إربد, interest: ho","_prov":{"business_name":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:06.299Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000c","at":"2026-09-17T07:04:18.851Z","confirmed":true},"preferred_time":{"source":"model","source_msg_id":"cfake00000i","at":"2026-09-17T07:06:16.020Z","confirmed":true},"name":{"source":"model","source_msg_id":"cfake00000l","at":"2026-09-17T07:07:12.755Z","confirmed":true}},"version":5,"score":8,"products":["karam"],"objections":["staff","price"],"preferred_time":{"text":"بكرة الساعة 11 الصبح"},"name":"أبو محمد"}

### Turn 8 — tap — 2026-09-17T07:08:09.779Z

**Customer**
> 🔘 tapped «الأحد 9:00 الصبح» → `book:2026-09-20T06:00:00.000Z`

**Bot** — 1 part(s), 10ms
> (interactive) ثبّتنا مكالمتك مع فريق شِفت: الأحد 20/9 الساعة 9:00 الصبح بتوقيت عمّان. رح نذكّرك قبلها.
> أزرار: [تمام](book_ok) [غيّر الموعد](book_change) [ألغِ المكالمة](book_cancel)

- result: — · stage: `captured` · status: `pending`
- gemini: not called (deterministic path)
- calendar: freeBusy, insertEvent shj3pjmihfqq97jakjqjur0eep
- staff alert: booking_booked
- booking: {"event_id":"shj3pjmihfqq97jakjqjur0eep","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:08:14.781Z","seq":1,"offer_id":"book:2026-09-20T06:00:00.000Z","source_msg_id":"cfake00000n","lang":"ar","reminders":{},"details_pending":false,"details_missing":[],"history":[{"status":"booked","start":"2026-09-20T06:00:00.000Z","at":"2026-09-17T07:08:14.781Z"}]}
- lead: {"business_name":"مطعم مندي","sector":"restaurant","sector_text":"مطعم مندي package/type: restaurant, city: إربد, interest: ho","_prov":{"business_name":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:06.299Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000c","at":"2026-09-17T07:04:18.851Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000n","at":"2026-09-17T07:08:14.781Z","confirmed":true},"name":{"source":"model","source_msg_id":"cfake00000l","at":"2026-09-17T07:07:12.755Z","confirmed":true}},"version":6,"score":8,"products":["karam"],"objections":["staff","price"],"preferred_time":{"text":"يوم الأحد بين 9 و9:30 (20/9)","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-20T06:00:00.000Z"},"name":"أبو محمد"}

### Turn 9 — tap — 2026-09-17T07:09:01.717Z

**Customer**
> 🔘 tapped «تمام» → `book_ok`

**Bot** — 1 part(s), 4ms
> تمام 👍 منحكي معك الأحد 20/9 الساعة 9:00 الصبح بتوقيت عمّان.

- result: — · stage: `captured` · status: `pending`
- gemini: not called (deterministic path)
- booking: {"event_id":"shj3pjmihfqq97jakjqjur0eep","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:08:14.781Z","seq":1,"offer_id":"book:2026-09-20T06:00:00.000Z","source_msg_id":"cfake00000n","lang":"ar","reminders":{},"details_pending":false,"details_missing":[],"history":[{"status":"booked","start":"2026-09-20T06:00:00.000Z","at":"2026-09-17T07:08:14.781Z"}]}
- lead: {"business_name":"مطعم مندي","sector":"restaurant","sector_text":"مطعم مندي package/type: restaurant, city: إربد, interest: ho","_prov":{"business_name":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:06.299Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000c","at":"2026-09-17T07:04:18.851Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000n","at":"2026-09-17T07:08:14.781Z","confirmed":true},"name":{"source":"model","source_msg_id":"cfake00000l","at":"2026-09-17T07:07:12.755Z","confirmed":true}},"version":6,"score":8,"products":["karam"],"objections":["staff","price"],"preferred_time":{"text":"يوم الأحد بين 9 و9:30 (20/9)","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-20T06:00:00.000Z"},"name":"أبو محمد"}

### Turn 10 — text — 2026-09-17T07:09:54.441Z

**Customer**
> تمام، بانتظاركم يوم الأحد
> يعطيكم العافية

**Bot** — 1 part(s), 13826ms
> الله يعافيك أستاذ أبو محمد، بتنورنا وإن شاء الله الفريق بيتواصل معك بالموعد المحدد.

- result: reply/NONE · stage: `captured` · status: `pending`
- gemini: 13818ms STOP
- booking: {"event_id":"shj3pjmihfqq97jakjqjur0eep","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:08:14.781Z","seq":1,"offer_id":"book:2026-09-20T06:00:00.000Z","source_msg_id":"cfake00000n","lang":"ar","reminders":{},"details_pending":false,"details_missing":[],"history":[{"status":"booked","start":"2026-09-20T06:00:00.000Z","at":"2026-09-17T07:08:14.781Z"}]}
- lead: {"business_name":"مطعم مندي","sector":"restaurant","sector_text":"مطعم مندي package/type: restaurant, city: إربد, interest: ho","_prov":{"business_name":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:50.680Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:06.299Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000c","at":"2026-09-17T07:04:18.851Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000n","at":"2026-09-17T07:08:14.781Z","confirmed":true},"name":{"source":"model","source_msg_id":"cfake00000l","at":"2026-09-17T07:07:12.755Z","confirmed":true}},"version":6,"score":8,"products":["karam"],"objections":["staff","price"],"preferred_time":{"text":"يوم الأحد بين 9 و9:30 (20/9)","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-20T06:00:00.000Z"},"name":"أبو محمد"}

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
    "business_name": "مطعم مندي",
    "sector": "restaurant",
    "sector_text": "مطعم مندي package/type: restaurant, city: إربد, interest: ho",
    "_prov": {
      "business_name": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:50.680Z",
        "confirmed": true
      },
      "sector": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:50.680Z",
        "confirmed": true
      },
      "sector_text": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:50.680Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:03:06.299Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000c",
        "at": "2026-09-17T07:04:18.851Z",
        "confirmed": true
      },
      "preferred_time": {
        "source": "booking",
        "source_msg_id": "cfake00000n",
        "at": "2026-09-17T07:08:14.781Z",
        "confirmed": true
      },
      "name": {
        "source": "model",
        "source_msg_id": "cfake00000l",
        "at": "2026-09-17T07:07:12.755Z",
        "confirmed": true
      }
    },
    "version": 6,
    "score": 8,
    "products": [
      "karam"
    ],
    "objections": [
      "staff",
      "price"
    ],
    "preferred_time": {
      "text": "يوم الأحد بين 9 و9:30 (20/9)",
      "start": "2026-09-20T06:00:00.000Z",
      "end": "2026-09-20T06:30:00.000Z",
      "tz": "Asia/Amman",
      "slot_id": "book:2026-09-20T06:00:00.000Z"
    },
    "name": "أبو محمد"
  },
  "booking": {
    "event_id": "shj3pjmihfqq97jakjqjur0eep",
    "calendar_id": "sim-sales-calendar@group.calendar.google.invalid",
    "start": "2026-09-20T06:00:00.000Z",
    "end": "2026-09-20T06:30:00.000Z",
    "tz": "Asia/Amman",
    "status": "booked",
    "booked_at": "2026-09-17T07:08:14.781Z",
    "seq": 1,
    "offer_id": "book:2026-09-20T06:00:00.000Z",
    "source_msg_id": "cfake00000n",
    "lang": "ar",
    "reminders": {},
    "details_pending": false,
    "details_missing": [],
    "history": [
      {
        "status": "booked",
        "start": "2026-09-20T06:00:00.000Z",
        "at": "2026-09-17T07:08:14.781Z"
      }
    ]
  },
  "calendarEvents": [
    {
      "id": "shj3pjmihfqq97jakjqjur0eep",
      "status": "confirmed",
      "summary": "مكالمة شِفت — مطعم مندي (+962790000555)",
      "start": {
        "dateTime": "2026-09-20T06:00:00.000Z",
        "timeZone": "Asia/Amman"
      },
      "end": {
        "dateTime": "2026-09-20T06:30:00.000Z",
        "timeZone": "Asia/Amman"
      },
      "description": "الاسم: أبو محمد\nالمنشأة: مطعم مندي\nالقطاع: مطعم/كافيه — مطعم مندي package/type: restaurant, city: إربد, interest: ho\nواتساب: +962790000555\nالملف الشخصي: أبو محمد\n\nInbox: https://inbox.sim.test\nconversation=cfake000001"
    }
  ],
  "calendarOps": [
    {
      "at": "2026-09-17T07:00:54.184Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:03:06.304Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:04:18.854Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:07:12.767Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:08:14.783Z",
      "op": "freeBusy",
      "timeMin": "2026-09-20T06:00:00.000Z",
      "timeMax": "2026-09-20T06:30:00.000Z",
      "busy": 0
    },
    {
      "at": "2026-09-17T07:08:14.783Z",
      "op": "insertEvent",
      "eventId": "shj3pjmihfqq97jakjqjur0eep",
      "summary": "مكالمة شِفت — مطعم مندي (+962790000555)",
      "start": {
        "dateTime": "2026-09-20T06:00:00.000Z",
        "timeZone": "Asia/Amman"
      },
      "end": {
        "dateTime": "2026-09-20T06:30:00.000Z",
        "timeZone": "Asia/Amman"
      }
    }
  ],
  "alerts": [
    "quote",
    "handoff",
    "meeting",
    "hot_lead",
    "booking_booked"
  ],
  "gemini": {
    "calls": 9,
    "failures": 2,
    "blocked": 0
  },
  "openrouter": {
    "calls": 10,
    "promptTokens": 18624,
    "completionTokens": 868,
    "cost": 0.031713
  }
}
```

<details><summary>full workflow_data</summary>

```json
{
  "bot_turns": 8,
  "disclosed_at": "2026-09-17T07:00:54.149Z",
  "nudge": null,
  "msgs_since_interest": 1,
  "last_ask": null,
  "last_bot": {
    "stage": "captured",
    "next_step": "confirmed",
    "at": "2026-09-17T07:10:00.943Z",
    "action": "NONE"
  },
  "needs_team": {
    "reason": "person",
    "summary": "خلاص، خليني أحكي مع حدا من فريقكم\nمتى بقدر أعمل مكالمة؟",
    "at": "2026-09-17T07:05:22.099Z",
    "resolved_at": null,
    "sla_note_sent_at": null,
    "claimed_at": null,
    "claimed_by": null
  },
  "lead": {
    "business_name": "مطعم مندي",
    "sector": "restaurant",
    "sector_text": "مطعم مندي package/type: restaurant, city: إربد, interest: ho",
    "_prov": {
      "business_name": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:50.680Z",
        "confirmed": true
      },
      "sector": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:50.680Z",
        "confirmed": true
      },
      "sector_text": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:50.680Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:03:06.299Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000c",
        "at": "2026-09-17T07:04:18.851Z",
        "confirmed": true
      },
      "preferred_time": {
        "source": "booking",
        "source_msg_id": "cfake00000n",
        "at": "2026-09-17T07:08:14.781Z",
        "confirmed": true
      },
      "name": {
        "source": "model",
        "source_msg_id": "cfake00000l",
        "at": "2026-09-17T07:07:12.755Z",
        "confirmed": true
      }
    },
    "version": 6,
    "score": 8,
    "products": [
      "karam"
    ],
    "objections": [
      "staff",
      "price"
    ],
    "preferred_time": {
      "text": "يوم الأحد بين 9 و9:30 (20/9)",
      "start": "2026-09-20T06:00:00.000Z",
      "end": "2026-09-20T06:30:00.000Z",
      "tz": "Asia/Amman",
      "slot_id": "book:2026-09-20T06:00:00.000Z"
    },
    "name": "أبو محمد"
  },
  "handoff": {
    "requested_at": "2026-09-17T07:05:22.099Z",
    "reason": "person",
    "tier": 1
  },
  "human_requested_at": "2026-09-17T07:05:22.099Z",
  "capture_pending": null,
  "requested_time_change": null,
  "slot_offers": [],
  "booking": {
    "event_id": "shj3pjmihfqq97jakjqjur0eep",
    "calendar_id": "sim-sales-calendar@group.calendar.google.invalid",
    "start": "2026-09-20T06:00:00.000Z",
    "end": "2026-09-20T06:30:00.000Z",
    "tz": "Asia/Amman",
    "status": "booked",
    "booked_at": "2026-09-17T07:08:14.781Z",
    "seq": 1,
    "offer_id": "book:2026-09-20T06:00:00.000Z",
    "source_msg_id": "cfake00000n",
    "lang": "ar",
    "reminders": {},
    "details_pending": false,
    "details_missing": [],
    "history": [
      {
        "status": "booked",
        "start": "2026-09-20T06:00:00.000Z",
        "at": "2026-09-17T07:08:14.781Z"
      }
    ]
  }
}
```

</details>