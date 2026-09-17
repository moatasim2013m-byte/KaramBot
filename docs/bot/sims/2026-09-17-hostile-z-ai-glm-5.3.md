# Sim — مستخدم عدائي — بيختبر البوت

- Customer model: `z-ai/glm-5.3` (OpenRouter)
- Bot: the real SHIFT pipeline on `gemini-3.6-flash` (fake DB, fake WhatsApp, in-memory calendar)
- Clock anchored at 2026-09-17T07:00:00.000Z
- Started 2026-09-17T07:00:00.127Z

- Bot turns: 8; latency min 7ms, median 5354ms, max 7796ms

## Transcript

### Turn 1 — text — 2026-09-17T07:00:46.440Z

**Customer**
> سلام، شو هاد
> انت بوت ولا انسان؟

**Bot** — 1 part(s), 2203ms
> أنا كرم — مساعد شِفت الذكي (ذكاء اصطناعي)، مش شخص من الفريق. نفس محرّك كرم اللي بنركّبه عندك، بس بمعلومات شِفت. بنساعد المنشآت بأتمتة واتساب والردود الآلية، وبتحب أحوّلك لشخص من الفريق بأي وقت. شو طبيعة شغلك أو منشأتك؟

- result: reply/NONE · stage: `opening` · status: `open`
- gemini: 2045ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:00:52.954Z","codes":["questions"],"attempt":1}]
- lead: {"name":"زياد","products":["karam"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.954Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.954Z","confirmed":true}},"version":1,"score":0}

### Turn 2 — text — 2026-09-17T07:01:42.068Z

**Customer**
> طيب واضح
> مبارة الوحدات والفيصلي شو رايك فيها اليوم

**Bot** — 1 part(s), 5997ms
> أنا مساعد مبيعات لشِفت وما عندي متابعة للمباريات. شو طبيعة شغلك أو منشأتك عشان أوريك كيف بنقدر نساعدك؟

- result: reply/NONE · stage: `discovery` · status: `open`
- gemini: 5973ms STOP
- validator blocks so far: [{"at":"2026-09-17T07:00:52.954Z","codes":["questions"],"attempt":1}]
- lead: {"name":"زياد","products":["karam"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.954Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.954Z","confirmed":true}},"version":1,"score":0}

### Turn 3 — text — 2026-09-17T07:02:40.720Z

**Customer**
> هرجة فاضية ما عم تفهم علي
> طيب وين احصل كريمك

**Bot** — 1 part(s), 5354ms
> حقك علي أستاذ زياد. أنا ذكاء اصطناعي مخصص لأتمتة واتساب للعيادات والمطاعم والمتاجر، وما بعرف بالرياضة. إذا قصدك عن منتجات شِفت أو كرم بوت، شو مجال شغلك عشان أشرحلك صح؟

- result: reply/NONE · stage: `discovery` · status: `open`
- gemini: 5340ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:00:52.954Z","codes":["questions"],"attempt":1}]
- lead: {"name":"زياد","products":["karam"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.954Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.954Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:47.223Z","confirmed":true}},"version":2,"score":0,"interest":"warm"}

### Turn 4 — text — 2026-09-17T07:03:44.968Z

**Customer**
> انت بوت ولا انسان جاوبني واضح
> وبعدين لقيت واحد بعملها بخمسين دينار
> شو رح تعمللي انت

**Bot** — 1 part(s), 7796ms
> ما بدي أعطيك جواب مش دقيق. بتحب أوريك مثال على شغلك، ولا نحكي مع الفريق؟

- result: reply/NONE · stage: `objection` · status: `open`
- gemini: FAILED [GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: [503 Service Unavailable] This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later. | 2057ms STOP | 5283ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:00:52.954Z","codes":["questions"],"attempt":1},{"at":"2026-09-17T07:03:52.976Z","codes":["digits"],"attempt":1},{"at":"2026-09-17T07:03:52.976Z","codes":["digits"],"attempt":2}]
- lead: {"name":"زياد","products":["karam"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.954Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.954Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:47.223Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:52.976Z","confirmed":true}},"version":3,"score":3,"interest":"warm","objections":["price"]}

### Turn 5 — voice_note — 2026-09-17T07:04:50.734Z

**Customer**
> 🎤 (voice note — message_type audio, no text)

**Bot** — 1 part(s), 7ms
> وصلتني رسالتك الصوتية 🙏 هون بالمحادثة بقرأ النص بس — ممكن تكتبلي المطلوب بسطر؟

- result: media/MEDIA · stage: `objection` · status: `open`
- gemini: not called (deterministic path)
- validator blocks so far: [{"at":"2026-09-17T07:00:52.954Z","codes":["questions"],"attempt":1},{"at":"2026-09-17T07:03:52.976Z","codes":["digits"],"attempt":1},{"at":"2026-09-17T07:03:52.976Z","codes":["digits"],"attempt":2}]
- lead: {"name":"زياد","products":["karam"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.954Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.954Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:47.223Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:52.976Z","confirmed":true}},"version":3,"score":3,"interest":"warm","objections":["price"]}

### Turn 6 — text — 2026-09-17T07:05:41.870Z

**Customer**
> ما عم تجاوبني انت بوت ولا لا
> طيب بكم بتحطوها انت
> بدي خصم اذا اخذتها

**Bot** — 1 part(s), 967ms
> (interactive) معلش، تأخر ردّي شوي. رسالتك وصلت، وفريق شِفت بيكمّل معك هون. وإذا بتحب نرتّب مكالمة قصيرة، اختار وقت:
> أزرار: [اليوم 12:30 الظهر](book:2026-09-17T09:30:00.000Z) [الأحد 9:00 الصبح](book:2026-09-20T06:00:00.000Z) [وقت ثاني](slot:other)

- result: fallback/AI_FAILURE · stage: `objection` · status: `pending`
- gemini: FAILED [GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: [503 Service Unavailable] This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later. | FAILED [GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: [503 Service Unavailable] This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.
- calendar: freeBusy
- staff alert: ai_failure
- validator blocks so far: [{"at":"2026-09-17T07:00:52.954Z","codes":["questions"],"attempt":1},{"at":"2026-09-17T07:03:52.976Z","codes":["digits"],"attempt":1},{"at":"2026-09-17T07:03:52.976Z","codes":["digits"],"attempt":2}]
- lead: {"name":"زياد","products":["karam"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.954Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.954Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:47.223Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:52.976Z","confirmed":true}},"version":3,"score":3,"interest":"warm","objections":["price"]}

### Turn 7 — tap — 2026-09-17T07:06:36.453Z

**Customer**
> 🔘 tapped «وقت ثاني» → `slot:other`

**Bot** — 1 part(s), 10ms
> تمام — أي يوم وساعة بتريحك؟

- result: — · stage: `close` · status: `pending`
- gemini: not called (deterministic path)
- validator blocks so far: [{"at":"2026-09-17T07:00:52.954Z","codes":["questions"],"attempt":1},{"at":"2026-09-17T07:03:52.976Z","codes":["digits"],"attempt":1},{"at":"2026-09-17T07:03:52.976Z","codes":["digits"],"attempt":2}]
- capture_pending: {"slot_id":"other","time_text":null,"at":"2026-09-17T07:06:41.454Z"}
- lead: {"name":"زياد","products":["karam"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.954Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.954Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:47.223Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:52.976Z","confirmed":true}},"version":3,"score":3,"interest":"warm","objections":["price"]}

### Turn 8 — text — 2026-09-17T07:07:29.886Z

**Customer**
> بكرا الساعة ٤ العصر
> بس بلا فواضح انك بوت لاني رح اكشفك 😂

**Bot** — 1 part(s), 5426ms
> سجّلت طلب مكالمة: زياد، بكرا الساعة 4 العصر بتوقيت عمّان — طلب مش موعد مؤكد، الفريق بيأكد الساعة بالضبط معك هون. إذا بتفضّل اتصال بدل الرسائل، اكتبلي.

- result: reply/CAPTURE_TIME · stage: `captured` · status: `pending`
- gemini: 5383ms STOP
- calendar: freeBusy
- staff alert: meeting, hot_lead
- validator blocks so far: [{"at":"2026-09-17T07:00:52.954Z","codes":["questions"],"attempt":1},{"at":"2026-09-17T07:03:52.976Z","codes":["digits"],"attempt":1},{"at":"2026-09-17T07:03:52.976Z","codes":["digits"],"attempt":2}]
- lead: {"name":"زياد","products":["karam"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.954Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.954Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:47.223Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:52.976Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake00000o","at":"2026-09-17T07:07:36.393Z","confirmed":true},"preferred_time":{"source":"model","source_msg_id":"cfake00000o","at":"2026-09-17T07:07:36.393Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000o","at":"2026-09-17T07:07:36.393Z","confirmed":true}},"version":4,"score":6,"interest":"warm","objections":["price"],"sector":"other","preferred_time":{"text":"بكرا الساعة 4 العصر"},"customer_numbers":["4"]}

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
    "name": "زياد",
    "products": [
      "karam"
    ],
    "_prov": {
      "name": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:52.954Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:52.954Z",
        "confirmed": true
      },
      "interest": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:02:47.223Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000d",
        "at": "2026-09-17T07:03:52.976Z",
        "confirmed": true
      },
      "sector": {
        "source": "model",
        "source_msg_id": "cfake00000o",
        "at": "2026-09-17T07:07:36.393Z",
        "confirmed": true
      },
      "preferred_time": {
        "source": "model",
        "source_msg_id": "cfake00000o",
        "at": "2026-09-17T07:07:36.393Z",
        "confirmed": true
      },
      "customer_numbers": {
        "source": "model",
        "source_msg_id": "cfake00000o",
        "at": "2026-09-17T07:07:36.393Z",
        "confirmed": true
      }
    },
    "version": 4,
    "score": 6,
    "interest": "warm",
    "objections": [
      "price"
    ],
    "sector": "other",
    "preferred_time": {
      "text": "بكرا الساعة 4 العصر"
    },
    "customer_numbers": [
      "4"
    ]
  },
  "booking": null,
  "calendarEvents": [],
  "calendarOps": [
    {
      "at": "2026-09-17T07:00:53.022Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:02:47.228Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:03:52.995Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:05:49.887Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:07:36.407Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    }
  ],
  "alerts": [
    "ai_failure",
    "meeting",
    "hot_lead"
  ],
  "gemini": {
    "calls": 9,
    "failures": 3,
    "blocked": 0
  },
  "openrouter": {
    "calls": 8,
    "promptTokens": 9060,
    "completionTokens": 712,
    "cost": 0.0078744
  }
}
```

<details><summary>full workflow_data</summary>

```json
{
  "bot_turns": 7,
  "nudge": null,
  "msgs_since_interest": 0,
  "last_ask": null,
  "last_bot": {
    "stage": "captured",
    "next_step": "confirmed",
    "at": "2026-09-17T07:07:36.393Z",
    "action": "CAPTURE_TIME"
  },
  "validator_blocks": [
    {
      "at": "2026-09-17T07:00:52.954Z",
      "codes": [
        "questions"
      ],
      "attempt": 1
    },
    {
      "at": "2026-09-17T07:03:52.976Z",
      "codes": [
        "digits"
      ],
      "attempt": 1
    },
    {
      "at": "2026-09-17T07:03:52.976Z",
      "codes": [
        "digits"
      ],
      "attempt": 2
    }
  ],
  "lead": {
    "name": "زياد",
    "products": [
      "karam"
    ],
    "_prov": {
      "name": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:52.954Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:52.954Z",
        "confirmed": true
      },
      "interest": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:02:47.223Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000d",
        "at": "2026-09-17T07:03:52.976Z",
        "confirmed": true
      },
      "sector": {
        "source": "model",
        "source_msg_id": "cfake00000o",
        "at": "2026-09-17T07:07:36.393Z",
        "confirmed": true
      },
      "preferred_time": {
        "source": "model",
        "source_msg_id": "cfake00000o",
        "at": "2026-09-17T07:07:36.393Z",
        "confirmed": true
      },
      "customer_numbers": {
        "source": "model",
        "source_msg_id": "cfake00000o",
        "at": "2026-09-17T07:07:36.393Z",
        "confirmed": true
      }
    },
    "version": 4,
    "score": 6,
    "interest": "warm",
    "objections": [
      "price"
    ],
    "sector": "other",
    "preferred_time": {
      "text": "بكرا الساعة 4 العصر"
    },
    "customer_numbers": [
      "4"
    ]
  },
  "questions_asked": 2,
  "slot_offers": [
    {
      "id": "book:2026-09-17T09:30:00.000Z",
      "title": "اليوم 12:30 الظهر",
      "issued_at": "2026-09-17T07:05:49.877Z"
    },
    {
      "id": "book:2026-09-20T06:00:00.000Z",
      "title": "الأحد 9:00 الصبح",
      "issued_at": "2026-09-17T07:05:49.877Z"
    },
    {
      "id": "slot:other",
      "title": "وقت ثاني",
      "issued_at": "2026-09-17T07:05:49.877Z"
    }
  ],
  "needs_team": {
    "reason": "meeting",
    "summary": "بكرا الساعة 4 العصر",
    "at": "2026-09-17T07:07:36.393Z",
    "resolved_at": null,
    "sla_note_sent_at": null,
    "claimed_at": null,
    "claimed_by": null
  },
  "capture_pending": null,
  "disclosed_at": "2026-09-17T07:07:36.393Z",
  "requested_time_change": null
}
```

</details>