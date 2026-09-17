# Sim — صاحبة عيادة — فضولية، بدها عيّنة وتجربة

- Customer model: `z-ai/glm-5.3` (OpenRouter)
- Bot: the real SHIFT pipeline on `gemini-3.6-flash` (fake DB, fake WhatsApp, in-memory calendar)
- Clock anchored at 2026-09-17T07:00:00.000Z
- Started 2026-09-17T07:00:00.203Z

- Bot turns: 10; latency min 5ms, median 2236ms, max 25010ms

## Transcript

### Turn 1 — text — 2026-09-17T07:00:47.873Z

**Customer**
> مرحبا
> سمعت عن البوتات اللي بتبيعوها، فيني اعرف شو بتعمل بالضبط؟

**Bot** — 1 part(s), 2236ms
> أهلًا وسهلًا بك دكتورة رنا 👋 أنا كرم، مساعد شِفت الذكي (shifts-ai.com) — نفس محرّك كرم اللي بنركّبه عندك، بس هون بمعلومات شِفت. كرم بيستقبل الرسائل 24/7، بيجاوب على الاستفسارات، وبيحجز المواعيد بالتقويم آليًا. شو طبيعة عمل منشأتك لتشوف كيف بيخدمك؟

- result: reply/NONE · stage: `opening` · status: `open`
- gemini: 2088ms STOP
- calendar: freeBusy
- lead: {"name":"د. رنا","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.386Z","confirmed":true}},"version":1,"score":0}

### Turn 2 — text — 2026-09-17T07:01:43.510Z

**Customer**
> عيادة أسنان بعمان، اسمها سمايل كير
> بيقصد بيجاوب على استفسارات المرضى؟

**Bot** — 1 part(s), 25010ms
> (interactive) معلش، تأخر ردّي شوي. رسالتك وصلت، وفريق شِفت بيكمّل معك هون. وإذا بتحب نرتّب مكالمة قصيرة، اختار وقت:
> أزرار: [اليوم 12:30 الظهر](book:2026-09-17T09:30:00.000Z) [الأحد 9:00 الصبح](book:2026-09-20T06:00:00.000Z) [وقت ثاني](slot:other)

- result: fallback/AI_FAILURE · stage: `opening` · status: `pending`
- gemini: FAILED [GoogleGenerativeAI Error]: Request aborted when fetching https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: This operation was aborted | FAILED [GoogleGenerativeAI Error]: Request aborted when fetching https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: This operation was aborted
- staff alert: ai_failure
- lead: {"name":"د. رنا","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.386Z","confirmed":true}},"version":1,"score":0}

### Turn 3 — text — 2026-09-17T07:03:03.205Z

**Customer**
> قبل المكالمة، فيني اشوف مثال حقيقي؟
> جربلي بوت وين بيسألني زبونة عن حجز موعد

**Bot** — 1 part(s), 1703ms
> أكيد دكتورة رنا، بتشرفنا! اللي بتحكي معه هلأ هو نفس محرّك كرم — اسأليني أي سؤال كمرضية بتسأل عن حجز موعد بعيادة «سمايل كير»، وأنا برد عليكِ مباشرة.

- result: reply/NONE · stage: `sample` · status: `pending`
- gemini: 1684ms STOP
- calendar: freeBusy
- lead: {"name":"د. رنا","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.386Z","confirmed":true},"business_name":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true}},"version":2,"score":2,"business_name":"سمايل كير","sector":"clinic","sector_text":"عيادة أسنان بعمان"}

### Turn 4 — text — 2026-09-17T07:03:58.407Z

**Customer**
> مرحبا، بحجز موعد تنظيف اسنان
> في شي متوفر بداية الاسبوع الجاي؟

**Bot** — 1 part(s), 10986ms
> أهلًا وسهلًا بكِ 👋 العيادة بتفتح الأحد، وأقرب موعد متوفر هو الأحد الساعة 10:00 الصبح. بتحبي أثبتلك الموعد باسمك؟

- result: reply/NONE · stage: `sample` · status: `pending`
- gemini: 6093ms STOP | 4869ms STOP
- validator blocks so far: [{"at":"2026-09-17T07:04:04.909Z","codes":["digits"],"attempt":1}]
- lead: {"name":"د. رنا","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.386Z","confirmed":true},"business_name":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true}},"version":2,"score":2,"business_name":"سمايل كير","sector":"clinic","sector_text":"عيادة أسنان بعمان"}

### Turn 5 — text — 2026-09-17T07:05:03.091Z

**Customer**
> ايه ثبتي ب اسمي
> وبقدش اعرف شو هديك الاسعار للتنضيف؟

**Bot** — 1 part(s), 7174ms
> ولا يهمك، الموعد الأحد الساعة 10:00 الصبح باسم د. رنا بحطه بالحسبان. بالنسبة لسعر تنظيف الأسنان هاد بيحدده الدكتور بالعيادة وتفاصيله المكتوبة.

منكمل تجربتنا هون، ولا بتحبي ننسق مكالمة قصيرة مع الفريق؟

- result: reply/NONE · stage: `sample` · status: `pending`
- gemini: 5248ms STOP | 1915ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:04:04.909Z","codes":["digits"],"attempt":1},{"at":"2026-09-17T07:05:09.593Z","codes":["claimed_action"],"attempt":1}]
- lead: {"name":"د. رنا","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.386Z","confirmed":true},"business_name":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true}},"version":2,"score":2,"business_name":"سمايل كير","sector":"clinic","sector_text":"عيادة أسنان بعمان"}

### Turn 6 — text — 2026-09-17T07:06:03.535Z

**Customer**
> جميل، واضح كيف بيشتغل
> خلينا نرتّب مكالمة اذا ممكن
> متى افضل وقت هالأسبوع؟

**Bot** — 1 part(s), 13598ms
> (interactive) أقرب أوقات الفريق:
> أزرار: [اليوم 12:30 الظهر](book:2026-09-17T09:30:00.000Z) [الأحد 9:00 الصبح](book:2026-09-20T06:00:00.000Z) [وقت ثاني](slot:other)

- result: reply/NONE · stage: `close` · status: `pending`
- gemini: 13587ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:04:04.909Z","codes":["digits"],"attempt":1},{"at":"2026-09-17T07:05:09.593Z","codes":["claimed_action"],"attempt":1}]
- lead: {"name":"د. رنا","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.386Z","confirmed":true},"business_name":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake00000j","at":"2026-09-17T07:06:11.537Z","confirmed":true}},"version":3,"score":2,"business_name":"سمايل كير","sector":"clinic","sector_text":"عيادة أسنان بعمان","interest":"hot"}

### Turn 7 — tap — 2026-09-17T07:07:11.263Z

**Customer**
> 🔘 tapped «الأحد 9:00 الصبح» → `book:2026-09-20T06:00:00.000Z`

**Bot** — 1 part(s), 21ms
> (interactive) ثبّتنا مكالمتك مع فريق شِفت: الأحد 20/9 الساعة 9:00 الصبح بتوقيت عمّان. رح نذكّرك قبلها.
> أزرار: [تمام](book_ok) [غيّر الموعد](book_change) [ألغِ المكالمة](book_cancel)

- result: — · stage: `captured` · status: `pending`
- gemini: not called (deterministic path)
- calendar: freeBusy, insertEvent shj3pjmihfqq97jakjqjur0eep
- staff alert: booking_booked
- validator blocks so far: [{"at":"2026-09-17T07:04:04.909Z","codes":["digits"],"attempt":1},{"at":"2026-09-17T07:05:09.593Z","codes":["claimed_action"],"attempt":1}]
- booking: {"event_id":"shj3pjmihfqq97jakjqjur0eep","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:07:16.269Z","seq":1,"offer_id":"book:2026-09-20T06:00:00.000Z","source_msg_id":"cfake00000l","lang":"ar","reminders":{},"details_pending":false,"details_missing":[],"history":[{"status":"booked","start":"2026-09-20T06:00:00.000Z","at":"2026-09-17T07:07:16.269Z"}]}
- lead: {"name":"د. رنا","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.386Z","confirmed":true},"business_name":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake00000j","at":"2026-09-17T07:06:11.537Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000l","at":"2026-09-17T07:07:16.269Z","confirmed":true}},"version":4,"score":5,"business_name":"سمايل كير","sector":"clinic","sector_text":"عيادة أسنان بعمان","interest":"hot","preferred_time":{"text":"يوم الأحد بين 9 و9:30 (20/9)","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-20T06:00:00.000Z"}}

### Turn 8 — tap — 2026-09-17T07:08:03.939Z

**Customer**
> 🔘 tapped «غيّر الموعد» → `book_change`

**Bot** — 1 part(s), 7ms
> (interactive) أكيد. أقرب أوقات الفريق:
> أزرار: [اليوم 12:30 الظهر](book:2026-09-17T09:30:00.000Z) [الأحد 9:30 الصبح](book:2026-09-20T06:30:00.000Z) [وقت ثاني](slot:other)

- result: — · stage: `captured` · status: `pending`
- gemini: not called (deterministic path)
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:04:04.909Z","codes":["digits"],"attempt":1},{"at":"2026-09-17T07:05:09.593Z","codes":["claimed_action"],"attempt":1}]
- booking: {"event_id":"shj3pjmihfqq97jakjqjur0eep","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:07:16.269Z","seq":1,"offer_id":"book:2026-09-20T06:00:00.000Z","source_msg_id":"cfake00000l","lang":"ar","reminders":{},"details_pending":false,"details_missing":[],"history":[{"status":"booked","start":"2026-09-20T06:00:00.000Z","at":"2026-09-17T07:07:16.269Z"}]}
- lead: {"name":"د. رنا","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.386Z","confirmed":true},"business_name":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake00000j","at":"2026-09-17T07:06:11.537Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000l","at":"2026-09-17T07:07:16.269Z","confirmed":true}},"version":4,"score":5,"business_name":"سمايل كير","sector":"clinic","sector_text":"عيادة أسنان بعمان","interest":"hot","preferred_time":{"text":"يوم الأحد بين 9 و9:30 (20/9)","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-20T06:00:00.000Z"}}

### Turn 9 — tap — 2026-09-17T07:08:55.401Z

**Customer**
> 🔘 tapped «الأحد 9:30 الصبح» → `book:2026-09-20T06:30:00.000Z`

**Bot** — 1 part(s), 10ms
> (interactive) غيّرنا موعد مكالمتك مع فريق شِفت: صار الأحد 20/9 الساعة 9:30 الصبح بتوقيت عمّان. رح نذكّرك قبلها.
> أزرار: [تمام](book_ok) [غيّر الموعد](book_change) [ألغِ المكالمة](book_cancel)

- result: — · stage: `captured` · status: `pending`
- gemini: not called (deterministic path)
- calendar: freeBusy, patchEvent shj3pjmihfqq97jakjqjur0eep
- staff alert: booking_rescheduled
- validator blocks so far: [{"at":"2026-09-17T07:04:04.909Z","codes":["digits"],"attempt":1},{"at":"2026-09-17T07:05:09.593Z","codes":["claimed_action"],"attempt":1}]
- booking: {"event_id":"shj3pjmihfqq97jakjqjur0eep","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-20T06:30:00.000Z","end":"2026-09-20T07:00:00.000Z","tz":"Asia/Amman","status":"rescheduled","booked_at":"2026-09-17T07:07:16.269Z","rescheduled_at":"2026-09-17T07:09:00.403Z","seq":1,"offer_id":"book:2026-09-20T06:30:00.000Z","source_msg_id":"cfake00000p","lang":"ar","reminders":{},"details_pending":false,"details_missing":[],"history":[{"status":"booked","start":"2026-09-20T06:00:00.000Z","at":"2026-09-17T07:07:16.269Z"},{"status":"rescheduled","start":"2026-09-20T06:30:00.000Z","at":"2026-09-17T07:09:00.403Z"}]}
- lead: {"name":"د. رنا","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.386Z","confirmed":true},"business_name":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake00000j","at":"2026-09-17T07:06:11.537Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000p","at":"2026-09-17T07:09:00.403Z","confirmed":true}},"version":5,"score":5,"business_name":"سمايل كير","sector":"clinic","sector_text":"عيادة أسنان بعمان","interest":"hot","preferred_time":{"text":"يوم الأحد بين 9:30 و10 (20/9)","start":"2026-09-20T06:30:00.000Z","end":"2026-09-20T07:00:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-20T06:30:00.000Z"}}

### Turn 10 — tap — 2026-09-17T07:09:47.092Z

**Customer**
> 🔘 tapped «تمام» → `book_ok`

**Bot** — 1 part(s), 5ms
> تمام 👍 منحكي معك الأحد 20/9 الساعة 9:30 الصبح بتوقيت عمّان.

- result: — · stage: `captured` · status: `pending`
- gemini: not called (deterministic path)
- validator blocks so far: [{"at":"2026-09-17T07:04:04.909Z","codes":["digits"],"attempt":1},{"at":"2026-09-17T07:05:09.593Z","codes":["claimed_action"],"attempt":1}]
- booking: {"event_id":"shj3pjmihfqq97jakjqjur0eep","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-20T06:30:00.000Z","end":"2026-09-20T07:00:00.000Z","tz":"Asia/Amman","status":"rescheduled","booked_at":"2026-09-17T07:07:16.269Z","rescheduled_at":"2026-09-17T07:09:00.403Z","seq":1,"offer_id":"book:2026-09-20T06:30:00.000Z","source_msg_id":"cfake00000p","lang":"ar","reminders":{},"details_pending":false,"details_missing":[],"history":[{"status":"booked","start":"2026-09-20T06:00:00.000Z","at":"2026-09-17T07:07:16.269Z"},{"status":"rescheduled","start":"2026-09-20T06:30:00.000Z","at":"2026-09-17T07:09:00.403Z"}]}
- lead: {"name":"د. رنا","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.386Z","confirmed":true},"business_name":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:09.707Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake00000j","at":"2026-09-17T07:06:11.537Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000p","at":"2026-09-17T07:09:00.403Z","confirmed":true}},"version":5,"score":5,"business_name":"سمايل كير","sector":"clinic","sector_text":"عيادة أسنان بعمان","interest":"hot","preferred_time":{"text":"يوم الأحد بين 9:30 و10 (20/9)","start":"2026-09-20T06:30:00.000Z","end":"2026-09-20T07:00:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-20T06:30:00.000Z"}}

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
    "name": "د. رنا",
    "_prov": {
      "name": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:54.386Z",
        "confirmed": true
      },
      "business_name": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:03:09.707Z",
        "confirmed": true
      },
      "sector": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:03:09.707Z",
        "confirmed": true
      },
      "sector_text": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:03:09.707Z",
        "confirmed": true
      },
      "interest": {
        "source": "model",
        "source_msg_id": "cfake00000j",
        "at": "2026-09-17T07:06:11.537Z",
        "confirmed": true
      },
      "preferred_time": {
        "source": "booking",
        "source_msg_id": "cfake00000p",
        "at": "2026-09-17T07:09:00.403Z",
        "confirmed": true
      }
    },
    "version": 5,
    "score": 5,
    "business_name": "سمايل كير",
    "sector": "clinic",
    "sector_text": "عيادة أسنان بعمان",
    "interest": "hot",
    "preferred_time": {
      "text": "يوم الأحد بين 9:30 و10 (20/9)",
      "start": "2026-09-20T06:30:00.000Z",
      "end": "2026-09-20T07:00:00.000Z",
      "tz": "Asia/Amman",
      "slot_id": "book:2026-09-20T06:30:00.000Z"
    }
  },
  "booking": {
    "event_id": "shj3pjmihfqq97jakjqjur0eep",
    "calendar_id": "sim-sales-calendar@group.calendar.google.invalid",
    "start": "2026-09-20T06:30:00.000Z",
    "end": "2026-09-20T07:00:00.000Z",
    "tz": "Asia/Amman",
    "status": "rescheduled",
    "booked_at": "2026-09-17T07:07:16.269Z",
    "rescheduled_at": "2026-09-17T07:09:00.403Z",
    "seq": 1,
    "offer_id": "book:2026-09-20T06:30:00.000Z",
    "source_msg_id": "cfake00000p",
    "lang": "ar",
    "reminders": {},
    "details_pending": false,
    "details_missing": [],
    "history": [
      {
        "status": "booked",
        "start": "2026-09-20T06:00:00.000Z",
        "at": "2026-09-17T07:07:16.269Z"
      },
      {
        "status": "rescheduled",
        "start": "2026-09-20T06:30:00.000Z",
        "at": "2026-09-17T07:09:00.403Z"
      }
    ]
  },
  "calendarEvents": [
    {
      "id": "shj3pjmihfqq97jakjqjur0eep",
      "status": "confirmed",
      "summary": "مكالمة شِفت — سمايل كير (+962790000555)",
      "start": {
        "dateTime": "2026-09-20T06:30:00.000Z",
        "timeZone": "Asia/Amman"
      },
      "end": {
        "dateTime": "2026-09-20T07:00:00.000Z",
        "timeZone": "Asia/Amman"
      },
      "description": "الاسم: د. رنا\nالمنشأة: سمايل كير\nالقطاع: عيادة — عيادة أسنان بعمان\nواتساب: +962790000555\nالملف الشخصي: د. رنا\n\nInbox: https://inbox.sim.test\nconversation=cfake000001"
    }
  ],
  "calendarOps": [
    {
      "at": "2026-09-17T07:00:54.454Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:03:09.712Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:05:09.597Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:06:11.541Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:07:16.275Z",
      "op": "freeBusy",
      "timeMin": "2026-09-20T06:00:00.000Z",
      "timeMax": "2026-09-20T06:30:00.000Z",
      "busy": 0
    },
    {
      "at": "2026-09-17T07:07:16.276Z",
      "op": "insertEvent",
      "eventId": "shj3pjmihfqq97jakjqjur0eep",
      "summary": "مكالمة شِفت — سمايل كير (+962790000555)",
      "start": {
        "dateTime": "2026-09-20T06:00:00.000Z",
        "timeZone": "Asia/Amman"
      },
      "end": {
        "dateTime": "2026-09-20T06:30:00.000Z",
        "timeZone": "Asia/Amman"
      }
    },
    {
      "at": "2026-09-17T07:08:08.944Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 3
    },
    {
      "at": "2026-09-17T07:09:00.403Z",
      "op": "freeBusy",
      "timeMin": "2026-09-20T06:30:00.000Z",
      "timeMax": "2026-09-20T07:00:00.000Z",
      "busy": 0
    },
    {
      "at": "2026-09-17T07:09:00.404Z",
      "op": "patchEvent",
      "eventId": "shj3pjmihfqq97jakjqjur0eep",
      "patch": {
        "start": {
          "dateTime": "2026-09-20T06:30:00.000Z",
          "timeZone": "Asia/Amman"
        },
        "end": {
          "dateTime": "2026-09-20T07:00:00.000Z",
          "timeZone": "Asia/Amman"
        }
      },
      "found": true
    }
  ],
  "alerts": [
    "ai_failure",
    "booking_booked",
    "booking_rescheduled"
  ],
  "gemini": {
    "calls": 9,
    "failures": 2,
    "blocked": 0
  },
  "openrouter": {
    "calls": 10,
    "promptTokens": 13267,
    "completionTokens": 518,
    "cost": 0.007602679399999999
  }
}
```

<details><summary>full workflow_data</summary>

```json
{
  "bot_turns": 6,
  "disclosed_at": "2026-09-17T07:00:54.386Z",
  "nudge": null,
  "msgs_since_interest": 0,
  "last_ask": null,
  "last_bot": {
    "stage": "captured",
    "next_step": "confirmed",
    "at": "2026-09-17T07:09:52.093Z",
    "action": "BOOKING",
    "button_id": "book_ok"
  },
  "lead": {
    "name": "د. رنا",
    "_prov": {
      "name": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:54.386Z",
        "confirmed": true
      },
      "business_name": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:03:09.707Z",
        "confirmed": true
      },
      "sector": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:03:09.707Z",
        "confirmed": true
      },
      "sector_text": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:03:09.707Z",
        "confirmed": true
      },
      "interest": {
        "source": "model",
        "source_msg_id": "cfake00000j",
        "at": "2026-09-17T07:06:11.537Z",
        "confirmed": true
      },
      "preferred_time": {
        "source": "booking",
        "source_msg_id": "cfake00000p",
        "at": "2026-09-17T07:09:00.403Z",
        "confirmed": true
      }
    },
    "version": 5,
    "score": 5,
    "business_name": "سمايل كير",
    "sector": "clinic",
    "sector_text": "عيادة أسنان بعمان",
    "interest": "hot",
    "preferred_time": {
      "text": "يوم الأحد بين 9:30 و10 (20/9)",
      "start": "2026-09-20T06:30:00.000Z",
      "end": "2026-09-20T07:00:00.000Z",
      "tz": "Asia/Amman",
      "slot_id": "book:2026-09-20T06:30:00.000Z"
    }
  },
  "slot_offers": [],
  "needs_team": {
    "reason": "meeting",
    "summary": "تغيّر موعد المكالمة: يوم الأحد بين 9:30 و10 (20/9)",
    "at": "2026-09-17T07:07:16.269Z",
    "resolved_at": null,
    "sla_note_sent_at": null,
    "claimed_at": null,
    "claimed_by": null
  },
  "exclamations": 1,
  "validator_blocks": [
    {
      "at": "2026-09-17T07:04:04.909Z",
      "codes": [
        "digits"
      ],
      "attempt": 1
    },
    {
      "at": "2026-09-17T07:05:09.593Z",
      "codes": [
        "claimed_action"
      ],
      "attempt": 1
    }
  ],
  "booking": {
    "event_id": "shj3pjmihfqq97jakjqjur0eep",
    "calendar_id": "sim-sales-calendar@group.calendar.google.invalid",
    "start": "2026-09-20T06:30:00.000Z",
    "end": "2026-09-20T07:00:00.000Z",
    "tz": "Asia/Amman",
    "status": "rescheduled",
    "booked_at": "2026-09-17T07:07:16.269Z",
    "rescheduled_at": "2026-09-17T07:09:00.403Z",
    "seq": 1,
    "offer_id": "book:2026-09-20T06:30:00.000Z",
    "source_msg_id": "cfake00000p",
    "lang": "ar",
    "reminders": {},
    "details_pending": false,
    "details_missing": [],
    "history": [
      {
        "status": "booked",
        "start": "2026-09-20T06:00:00.000Z",
        "at": "2026-09-17T07:07:16.269Z"
      },
      {
        "status": "rescheduled",
        "start": "2026-09-20T06:30:00.000Z",
        "at": "2026-09-17T07:09:00.403Z"
      }
    ]
  },
  "capture_pending": null
}
```

</details>