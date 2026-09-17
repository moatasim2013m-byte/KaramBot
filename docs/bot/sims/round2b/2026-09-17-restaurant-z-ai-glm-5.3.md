# Sim — صاحب مطعم في إربد — مستعجل ومتشكك

- Customer model: `z-ai/glm-5.3` (OpenRouter)
- Bot: the real SHIFT pipeline on `gemini-3.6-flash` (fake DB, fake WhatsApp, in-memory calendar)
- Clock anchored at 2026-09-17T07:00:00.000Z
- Started 2026-09-17T07:00:00.076Z

- Bot turns: 8; latency min 3ms, median 5585ms, max 30009ms

## Transcript

### Turn 1 — text — 2026-09-17T07:00:45.863Z

**Customer**
> السلام عليكم
> شو هاي الخدمة اللي بتنزلوا عليها إعلان؟

**Bot** — 1 part(s), 14736ms
> وعليكم السلام، أهلاً وسهلاً أبو محمد 👋 أنا كرم، مساعد شِفت الذكي (shifts-ai.com) — نفس محرّك كرم اللي بنركّبه عندك بس هون بمعلومات شِفت. بنوفّر ذكاء اصطناعي لردود واتساب والحجوزات والأتمتة، شو مجال عملك؟

- result: reply/NONE · stage: `opening` · status: `open`
- gemini: 14619ms STOP
- calendar: freeBusy
- lead: {"name":"أبو محمد","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.372Z","confirmed":true}},"version":1,"score":0}

### Turn 2 — text — 2026-09-17T07:01:53.778Z

**Customer**
> عندي مطعم مندي في اربد
> بس حكايتكم كم بتكلف؟

**Bot** — 1 part(s), 30009ms
> (interactive) معلش، تأخر ردّي شوي. رسالتك وصلت، وفريق شِفت بيكمّل معك هون. وإذا بتحب نرتّب مكالمة قصيرة، اختار وقت:
> أزرار: [اليوم 12:30 الظهر](book:2026-09-17T09:30:00.000Z) [الأحد 9:00 الصبح](book:2026-09-20T06:00:00.000Z) [وقت ثاني](slot:other)

- result: fallback/AI_FAILURE · stage: `opening` · status: `pending`
- gemini: FAILED [GoogleGenerativeAI Error]: Request aborted when fetching https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: This operation was aborted | FAILED [GoogleGenerativeAI Error]: Request aborted when fetching https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: This operation was aborted
- calendar: freeBusy
- staff alert: ai_failure
- lead: {"name":"أبو محمد","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.372Z","confirmed":true}},"version":1,"score":0}

### Turn 3 — text — 2026-09-17T07:03:16.226Z

**Customer**
> لسا ما جاوبتني على السعر
> كم بتكلف بالشهر؟

**Bot** — 1 part(s), 23264ms
> حقك أستاذ أبو محمد. ما عندي سعر معتمد أقدر أعطيك إياه هون، وما بدي أخمّن. بدك كرم يغطي المنيو والاستفسارات بس، ولا كمان استقبال طلبات التوصيل؟

سجّلت طلب العرض بقائمة فريق شِفت ✅ لسه ما استلمه حدا — بيرجعولك على هالرقم ضمن الدوام (الأحد–الخميس 9–6). لحد ما يردوا أنا هون لأي سؤال.

- result: reply/FLAG_FOR_TEAM · stage: `objection` · status: `pending`
- gemini: 13451ms MAX_TOKENS | 9784ms STOP
- calendar: freeBusy
- staff alert: quote
- lead: {"name":"أبو محمد","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.372Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:22.728Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:22.728Z","confirmed":true}},"version":2,"score":3,"sector":"restaurant","sector_text":"مطعم مندي Object status: confirmed from transcript previousl"}

### Turn 4 — text — 2026-09-17T07:04:32.865Z

**Customer**
> المطعم كله
> بس خليني قلك
> عندي موظف بيرد عالرسائل

**Bot** — 1 part(s), 5585ms
> تمام أستاذ أبو محمد، كرم بيشتغل كمساعد للموظف مش بديل عنه، بيغطي وقت ضغط الطلبات والردود المتأخرة بعد الدوام. مين بيرد عندكم على رسائل الواتساب بعد الساعة 10 بالليل؟

- result: reply/NONE · stage: `objection` · status: `pending`
- gemini: 5570ms STOP
- calendar: freeBusy
- lead: {"name":"أبو محمد","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.372Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:22.728Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:22.728Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:04:40.868Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:04:40.868Z","confirmed":true}},"version":3,"score":3,"sector":"restaurant","sector_text":"مطعم مندي Object status: confirmed from transcript previousl","products":["karam"],"objections":["staff"]}

### Turn 5 — text — 2026-09-17T07:05:34.116Z

**Customer**
> والله محد بيرد بالليل
> بس بده يصرف معي مصاري؟

**Bot** — 1 part(s), 2338ms
> بالعكس أستاذ أبو محمد، هدفه يمسك الطلبات اللي بتضيع بالليل عشان ما تروح عليك أرباحها. شو اسم مطعمك الكريم؟ (بنستخدم اللي بتكتبه عشان نرد عليك ونرتّب متابعة الفريق — التفاصيل: shifts-ai.com/privacy)

- result: reply/NONE · stage: `objection` · status: `pending`
- gemini: 2328ms STOP
- lead: {"name":"أبو محمد","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.372Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:22.728Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:22.728Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:04:40.868Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000g","at":"2026-09-17T07:05:40.617Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000g","at":"2026-09-17T07:05:40.617Z","confirmed":true}},"version":4,"score":3,"sector":"restaurant","sector_text":"مطعم مندي Object status: confirmed from transcript previousl","products":["karam"],"objections":["staff","price"],"need":["طلبات بعد الساعة 10 بالليل بتضيع لأن محدش بيرد"]}

### Turn 6 — text — 2026-09-17T07:06:29.293Z

**Customer**
> مطعم بيت المندي في اربد
> طيب اذا بيرد بالليل بجرب

**Bot** — 1 part(s), 4353ms
> (interactive) ممتاز أستاذ أبو محمد، عشان نرتّب التجربة مع الفريق، منكمّل نرتّبها هون ولا بتحب بطلبلك مكالمة قصيرة؟
> أزرار: [اليوم 12:30 الظهر](book:2026-09-17T09:30:00.000Z) [الأحد 9:00 الصبح](book:2026-09-20T06:00:00.000Z) [وقت ثاني](slot:other)

- result: reply/NONE · stage: `objection` · status: `pending`
- gemini: 4343ms STOP
- calendar: freeBusy
- lead: {"name":"أبو محمد","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.372Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:22.728Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:22.728Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:04:40.868Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000g","at":"2026-09-17T07:05:40.617Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000g","at":"2026-09-17T07:05:40.617Z","confirmed":true},"business_name":{"source":"model","source_msg_id":"cfake00000j","at":"2026-09-17T07:06:35.795Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake00000j","at":"2026-09-17T07:06:35.795Z","confirmed":true}},"version":5,"score":5,"sector":"restaurant","sector_text":"مطعم مندي Object status: confirmed from transcript previousl","products":["karam"],"objections":["staff","price"],"need":["طلبات بعد الساعة 10 بالليل بتضيع لأن محدش بيرد"],"business_name":"بيت المندي","city":"إربد"}

### Turn 7 — tap — 2026-09-17T07:07:25.921Z

**Customer**
> 🔘 tapped «الأحد 9:00 الصبح» → `book:2026-09-20T06:00:00.000Z`

**Bot** — 1 part(s), 8ms
> (interactive) ثبّتنا مكالمتك مع فريق شِفت: الأحد 20/9 الساعة 9:00 الصبح بتوقيت عمّان. رح نذكّرك قبلها.
> أزرار: [تمام](book_ok) [غيّر الموعد](book_change) [ألغِ المكالمة](book_cancel)

- result: — · stage: `captured` · status: `pending`
- gemini: not called (deterministic path)
- calendar: freeBusy, insertEvent shj3pjmihfqq97jakjqjur0eep
- staff alert: booking_booked, hot_lead
- booking: {"event_id":"shj3pjmihfqq97jakjqjur0eep","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:07:30.923Z","seq":1,"offer_id":"book:2026-09-20T06:00:00.000Z","source_msg_id":"cfake00000l","lang":"ar","reminders":{},"details_pending":false,"details_missing":[],"history":[{"status":"booked","start":"2026-09-20T06:00:00.000Z","at":"2026-09-17T07:07:30.923Z"}]}
- lead: {"name":"أبو محمد","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.372Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:22.728Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:22.728Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:04:40.868Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000g","at":"2026-09-17T07:05:40.617Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000g","at":"2026-09-17T07:05:40.617Z","confirmed":true},"business_name":{"source":"model","source_msg_id":"cfake00000j","at":"2026-09-17T07:06:35.795Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake00000j","at":"2026-09-17T07:06:35.795Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000l","at":"2026-09-17T07:07:30.923Z","confirmed":true}},"version":6,"score":8,"sector":"restaurant","sector_text":"مطعم مندي Object status: confirmed from transcript previousl","products":["karam"],"objections":["staff","price"],"need":["طلبات بعد الساعة 10 بالليل بتضيع لأن محدش بيرد"],"business_name":"بيت المندي","city":"إربد","preferred_time":{"text":"يوم الأحد بين 9 و9:30 (20/9)","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-20T06:00:00.000Z"}}

### Turn 8 — tap — 2026-09-17T07:08:16.748Z

**Customer**
> 🔘 tapped «تمام» → `book_ok`

**Bot** — 1 part(s), 3ms
> تمام 👍 منحكي معك الأحد 20/9 الساعة 9:00 الصبح بتوقيت عمّان.

- result: — · stage: `captured` · status: `pending`
- gemini: not called (deterministic path)
- booking: {"event_id":"shj3pjmihfqq97jakjqjur0eep","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:07:30.923Z","seq":1,"offer_id":"book:2026-09-20T06:00:00.000Z","source_msg_id":"cfake00000l","lang":"ar","reminders":{},"details_pending":false,"details_missing":[],"history":[{"status":"booked","start":"2026-09-20T06:00:00.000Z","at":"2026-09-17T07:07:30.923Z"}]}
- lead: {"name":"أبو محمد","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.372Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:22.728Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:03:22.728Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:04:40.868Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000g","at":"2026-09-17T07:05:40.617Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000g","at":"2026-09-17T07:05:40.617Z","confirmed":true},"business_name":{"source":"model","source_msg_id":"cfake00000j","at":"2026-09-17T07:06:35.795Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake00000j","at":"2026-09-17T07:06:35.795Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000l","at":"2026-09-17T07:07:30.923Z","confirmed":true}},"version":6,"score":8,"sector":"restaurant","sector_text":"مطعم مندي Object status: confirmed from transcript previousl","products":["karam"],"objections":["staff","price"],"need":["طلبات بعد الساعة 10 بالليل بتضيع لأن محدش بيرد"],"business_name":"بيت المندي","city":"إربد","preferred_time":{"text":"يوم الأحد بين 9 و9:30 (20/9)","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-20T06:00:00.000Z"}}

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
        "at": "2026-09-17T07:00:52.372Z",
        "confirmed": true
      },
      "sector": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:03:22.728Z",
        "confirmed": true
      },
      "sector_text": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:03:22.728Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake00000d",
        "at": "2026-09-17T07:04:40.868Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000g",
        "at": "2026-09-17T07:05:40.617Z",
        "confirmed": true
      },
      "need": {
        "source": "model",
        "source_msg_id": "cfake00000g",
        "at": "2026-09-17T07:05:40.617Z",
        "confirmed": true
      },
      "business_name": {
        "source": "model",
        "source_msg_id": "cfake00000j",
        "at": "2026-09-17T07:06:35.795Z",
        "confirmed": true
      },
      "city": {
        "source": "model",
        "source_msg_id": "cfake00000j",
        "at": "2026-09-17T07:06:35.795Z",
        "confirmed": true
      },
      "preferred_time": {
        "source": "booking",
        "source_msg_id": "cfake00000l",
        "at": "2026-09-17T07:07:30.923Z",
        "confirmed": true
      }
    },
    "version": 6,
    "score": 8,
    "sector": "restaurant",
    "sector_text": "مطعم مندي Object status: confirmed from transcript previousl",
    "products": [
      "karam"
    ],
    "objections": [
      "staff",
      "price"
    ],
    "need": [
      "طلبات بعد الساعة 10 بالليل بتضيع لأن محدش بيرد"
    ],
    "business_name": "بيت المندي",
    "city": "إربد",
    "preferred_time": {
      "text": "يوم الأحد بين 9 و9:30 (20/9)",
      "start": "2026-09-20T06:00:00.000Z",
      "end": "2026-09-20T06:30:00.000Z",
      "tz": "Asia/Amman",
      "slot_id": "book:2026-09-20T06:00:00.000Z"
    }
  },
  "booking": {
    "event_id": "shj3pjmihfqq97jakjqjur0eep",
    "calendar_id": "sim-sales-calendar@group.calendar.google.invalid",
    "start": "2026-09-20T06:00:00.000Z",
    "end": "2026-09-20T06:30:00.000Z",
    "tz": "Asia/Amman",
    "status": "booked",
    "booked_at": "2026-09-17T07:07:30.923Z",
    "seq": 1,
    "offer_id": "book:2026-09-20T06:00:00.000Z",
    "source_msg_id": "cfake00000l",
    "lang": "ar",
    "reminders": {},
    "details_pending": false,
    "details_missing": [],
    "history": [
      {
        "status": "booked",
        "start": "2026-09-20T06:00:00.000Z",
        "at": "2026-09-17T07:07:30.923Z"
      }
    ]
  },
  "calendarEvents": [
    {
      "id": "shj3pjmihfqq97jakjqjur0eep",
      "status": "confirmed",
      "summary": "مكالمة شِفت — بيت المندي (+962790000555)",
      "start": {
        "dateTime": "2026-09-20T06:00:00.000Z",
        "timeZone": "Asia/Amman"
      },
      "end": {
        "dateTime": "2026-09-20T06:30:00.000Z",
        "timeZone": "Asia/Amman"
      },
      "description": "الاسم: أبو محمد\nالمنشأة: بيت المندي\nالقطاع: مطعم/كافيه — مطعم مندي Object status: confirmed from transcript previousl\nالاحتياج: طلبات بعد الساعة 10 بالليل بتضيع لأن محدش بيرد\nواتساب: +962790000555\nالملف الشخصي: أبو محمد\n\nInbox: https://inbox.sim.test\nconversation=cfake000001"
    }
  ],
  "calendarOps": [
    {
      "at": "2026-09-17T07:00:52.409Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:02:00.285Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:03:22.732Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:04:40.871Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:06:35.799Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:07:30.925Z",
      "op": "freeBusy",
      "timeMin": "2026-09-20T06:00:00.000Z",
      "timeMax": "2026-09-20T06:30:00.000Z",
      "busy": 0
    },
    {
      "at": "2026-09-17T07:07:30.926Z",
      "op": "insertEvent",
      "eventId": "shj3pjmihfqq97jakjqjur0eep",
      "summary": "مكالمة شِفت — بيت المندي (+962790000555)",
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
    "ai_failure",
    "quote",
    "booking_booked",
    "hot_lead"
  ],
  "gemini": {
    "calls": 8,
    "failures": 2,
    "blocked": 0
  },
  "openrouter": {
    "calls": 8,
    "promptTokens": 9883,
    "completionTokens": 436,
    "cost": 0.01217956
  }
}
```

<details><summary>full workflow_data</summary>

```json
{
  "bot_turns": 6,
  "disclosed_at": "2026-09-17T07:00:52.372Z",
  "nudge": null,
  "msgs_since_interest": 0,
  "last_ask": null,
  "last_bot": {
    "stage": "captured",
    "next_step": "confirmed",
    "at": "2026-09-17T07:08:21.749Z",
    "action": "BOOKING",
    "button_id": "book_ok"
  },
  "lead": {
    "name": "أبو محمد",
    "_prov": {
      "name": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:52.372Z",
        "confirmed": true
      },
      "sector": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:03:22.728Z",
        "confirmed": true
      },
      "sector_text": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:03:22.728Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake00000d",
        "at": "2026-09-17T07:04:40.868Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000g",
        "at": "2026-09-17T07:05:40.617Z",
        "confirmed": true
      },
      "need": {
        "source": "model",
        "source_msg_id": "cfake00000g",
        "at": "2026-09-17T07:05:40.617Z",
        "confirmed": true
      },
      "business_name": {
        "source": "model",
        "source_msg_id": "cfake00000j",
        "at": "2026-09-17T07:06:35.795Z",
        "confirmed": true
      },
      "city": {
        "source": "model",
        "source_msg_id": "cfake00000j",
        "at": "2026-09-17T07:06:35.795Z",
        "confirmed": true
      },
      "preferred_time": {
        "source": "booking",
        "source_msg_id": "cfake00000l",
        "at": "2026-09-17T07:07:30.923Z",
        "confirmed": true
      }
    },
    "version": 6,
    "score": 8,
    "sector": "restaurant",
    "sector_text": "مطعم مندي Object status: confirmed from transcript previousl",
    "products": [
      "karam"
    ],
    "objections": [
      "staff",
      "price"
    ],
    "need": [
      "طلبات بعد الساعة 10 بالليل بتضيع لأن محدش بيرد"
    ],
    "business_name": "بيت المندي",
    "city": "إربد",
    "preferred_time": {
      "text": "يوم الأحد بين 9 و9:30 (20/9)",
      "start": "2026-09-20T06:00:00.000Z",
      "end": "2026-09-20T06:30:00.000Z",
      "tz": "Asia/Amman",
      "slot_id": "book:2026-09-20T06:00:00.000Z"
    }
  },
  "slot_offers": [],
  "needs_team": {
    "reason": "meeting",
    "summary": "مكالمة محجوزة: يوم الأحد بين 9 و9:30 (20/9)",
    "at": "2026-09-17T07:07:30.923Z",
    "resolved_at": null,
    "sla_note_sent_at": null,
    "claimed_at": null,
    "claimed_by": null
  },
  "booking": {
    "event_id": "shj3pjmihfqq97jakjqjur0eep",
    "calendar_id": "sim-sales-calendar@group.calendar.google.invalid",
    "start": "2026-09-20T06:00:00.000Z",
    "end": "2026-09-20T06:30:00.000Z",
    "tz": "Asia/Amman",
    "status": "booked",
    "booked_at": "2026-09-17T07:07:30.923Z",
    "seq": 1,
    "offer_id": "book:2026-09-20T06:00:00.000Z",
    "source_msg_id": "cfake00000l",
    "lang": "ar",
    "reminders": {},
    "details_pending": false,
    "details_missing": [],
    "history": [
      {
        "status": "booked",
        "start": "2026-09-20T06:00:00.000Z",
        "at": "2026-09-17T07:07:30.923Z"
      }
    ]
  },
  "capture_pending": null
}
```

</details>