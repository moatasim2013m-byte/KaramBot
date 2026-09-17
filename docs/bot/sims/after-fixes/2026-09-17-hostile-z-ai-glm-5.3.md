# Sim — مستخدم عدائي — بيختبر البوت

- Customer model: `z-ai/glm-5.3` (OpenRouter)
- Bot: the real SHIFT pipeline on `gemini-3.6-flash` (fake DB, fake WhatsApp, in-memory calendar)
- Clock anchored at 2026-09-17T07:00:00.000Z
- Started 2026-09-17T07:00:00.070Z

- Bot turns: 8; latency min 3ms, median 5225ms, max 13217ms

## Transcript

### Turn 1 — text — 2026-09-17T07:00:46.046Z

**Customer**
> سلام، إنت بوت ولا إنسان؟
> جاوب بصراحة

**Bot** — 1 part(s), 5335ms
> وعليكم السلام. أنا كرم — مساعد شِفت الذكي (ذكاء اصطناعي)، مش شخص من الفريق. نفس محرّك كرم اللي بنركّبه عندك، بس هون بمعلومات شِفت. بتحب تحكي مع شخص من الفريق فورًا ولا أساعدك تعرف كيف بيشتغل لمنشأتك؟

- result: reply/NONE · stage: `opening` · status: `open`
- gemini: 5208ms STOP
- calendar: freeBusy
- lead: {"language":"ar","_prov":{"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.557Z","confirmed":true}},"version":1,"score":0}

### Turn 2 — text — 2026-09-17T07:01:44.190Z

**Customer**
> هسه بوضح إنك بوت 😂
> طيب خليني جرّبك… شو نتيجة مباراة الوحدات والفيصلي؟

**Bot** — 1 part(s), 10921ms
> أنا مساعد مبيعات لشِفت وما عندي متابعة للأخبار الرياضية. بس إذا بدك، بقدر أوريك كيف بساعد منشأتك بالرد على الزباين. شو مجال شغلك؟

- result: reply/NONE · stage: `discovery` · status: `open`
- gemini: 10880ms STOP
- lead: {"language":"ar","_prov":{"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.557Z","confirmed":true}},"version":1,"score":0}

### Turn 3 — text — 2026-09-17T07:02:48.289Z

**Customer**
> شو رأيك بأغنية يا ليل لعمر دياب؟
> وينك ههه
> بعدين بدك فلوس كثير على هالبوتات؟

**Bot** — 1 part(s), 4296ms
> أنا مساعد مبيعات فشغلي بس بشِفت. أما بالنسبة للأسعار ما عندي سعر معتمد أقدر أعطيك إياه هون وما بدي أخمّن. بدك الرد على الاستفسارات بس، ولا كمان استقبال الطلبات؟

- result: reply/NONE · stage: `objection` · status: `open`
- gemini: 4254ms STOP
- calendar: freeBusy
- lead: {"language":"ar","_prov":{"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.557Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:56.292Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:56.292Z","confirmed":true}},"version":2,"score":3,"products":["karam"],"objections":["price"]}

### Turn 4 — text — 2026-09-17T07:03:46.963Z

**Customer**
> لقيت واحد بعملها بـ50 دينار، ليش بدي اخد منك؟
> بعدين بتعملوا خصم ولا لأ؟

**Bot** — 1 part(s), 5225ms
> حقك تقارن طبعًا. الـ50 دينار رقمك إنت وبنحطه بالحسبان، بس الفرق بكرم إنه بيرد من معلوماتك وبيحجز وبيحوّل مع السياق مش بس إجابات جاهزة. بالنسبة للخصم والعرض المكتوب الفريق بيحدده حسب النطاق. بتحب العرض يكون لردود بس ولا مع طلبات وحجوزات؟

- result: reply/NONE · stage: `objection` · status: `open`
- gemini: 5209ms STOP
- lead: {"language":"ar","_prov":{"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.557Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:56.292Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:56.292Z","confirmed":true},"budget_note":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:53.466Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:53.466Z","confirmed":true}},"version":3,"score":3,"products":["karam"],"objections":["price"],"budget_note":"50 دينار","customer_numbers":["50"]}

### Turn 5 — text — 2026-09-17T07:04:45.302Z

**Customer**
> يا زلمة بطل سخافة، كل مرة بتحوّلني عالمبيعات
> خليني احكي مع إنسان واضح، إنت بوت ولا لأ؟
> بعدين أنا بعدني بسأل، 50 دينار ليش لا؟

**Bot** — 1 part(s), 8ms
> ولا يهمك.

سجّلت طلبك بقائمة الفريق مع ملخص محادثتنا — لسه ما استلمه حدا، وبيردوا عليك هون ضمن الدوام (الأحد–الخميس 9–6). لو احتجت أي شي بالوقت هذا أنا هون.

- result: handoff/HANDOFF_TO_HUMAN · stage: `handoff` · status: `pending`
- gemini: not called (deterministic path)
- staff alert: handoff
- lead: {"language":"ar","_prov":{"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.557Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:56.292Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:56.292Z","confirmed":true},"budget_note":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:53.466Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:53.466Z","confirmed":true}},"version":3,"score":3,"products":["karam"],"objections":["price"],"budget_note":"50 دينار","customer_numbers":["50"]}

### Turn 6 — voice_note — 2026-09-17T07:05:38.977Z

**Customer**
> 🎤 (voice note — message_type audio, no text)

**Bot** — 1 part(s), 3ms
> وصلتني رسالتك الصوتية 🙏 هون بالمحادثة بقرأ النص بس — ممكن تكتبلي المطلوب بسطر؟

- result: media/MEDIA · stage: `handoff` · status: `pending`
- gemini: not called (deterministic path)
- lead: {"language":"ar","_prov":{"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.557Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:56.292Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:56.292Z","confirmed":true},"budget_note":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:53.466Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:53.466Z","confirmed":true}},"version":3,"score":3,"products":["karam"],"objections":["price"],"budget_note":"50 دينار","customer_numbers":["50"]}

### Turn 7 — text — 2026-09-17T07:06:30.233Z

**Customer**
> طيب طيب، خلص ههه
> بس جاوبني بصراحة، بتاكلوا وتشربوا يعني؟ 😂

**Bot** — 1 part(s), 13217ms
> أنا كرم، مساعد شِفت الذكي (ذكاء اصطناعي) — مش شخص من الفريق، فلا باكل ولا بشرب ههه! نفس محرّك كرم اللي بنركّبه عندك بس بمعلومات شِفت.

- result: reply/NONE · stage: `handoff` · status: `pending`
- gemini: 13210ms STOP
- lead: {"language":"ar","_prov":{"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.557Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:56.292Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:56.292Z","confirmed":true},"budget_note":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:53.466Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:53.466Z","confirmed":true}},"version":3,"score":3,"products":["karam"],"objections":["price"],"budget_note":"50 دينار","customer_numbers":["50"]}

### Turn 8 — text — 2026-09-17T07:07:36.552Z

**Customer**
> هههه على الأقل صادق
> طيب مشكور كرم، بدي أفكر بالموضوع

**Bot** — 1 part(s), 4951ms
> العفو! خذ وقتك بالفكر، وإذا بتحب نرجع نحكي بأي وقت أنا جاهز. نهارك سعيد 👋

- result: reply/NOT_NOW · stage: `closed` · status: `pending`
- gemini: 4944ms STOP
- lead: {"language":"ar","_prov":{"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.557Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:56.292Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000p","at":"2026-09-17T07:07:43.053Z","confirmed":true},"budget_note":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:53.466Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:53.466Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake00000p","at":"2026-09-17T07:07:43.053Z","confirmed":true}},"version":4,"score":1,"products":["karam"],"objections":["price","later"],"budget_note":"50 دينار","customer_numbers":["50"],"interest":"warm"}

## Final state

```json
{
  "conversation": {
    "status": "pending",
    "current_state": "closed",
    "ai_enabled": true,
    "metadata": {
      "reply_failures": 0
    }
  },
  "lead": {
    "language": "ar",
    "_prov": {
      "language": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:52.557Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake00000a",
        "at": "2026-09-17T07:02:56.292Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000p",
        "at": "2026-09-17T07:07:43.053Z",
        "confirmed": true
      },
      "budget_note": {
        "source": "model",
        "source_msg_id": "cfake00000d",
        "at": "2026-09-17T07:03:53.466Z",
        "confirmed": true
      },
      "customer_numbers": {
        "source": "model",
        "source_msg_id": "cfake00000d",
        "at": "2026-09-17T07:03:53.466Z",
        "confirmed": true
      },
      "interest": {
        "source": "model",
        "source_msg_id": "cfake00000p",
        "at": "2026-09-17T07:07:43.053Z",
        "confirmed": true
      }
    },
    "version": 4,
    "score": 1,
    "products": [
      "karam"
    ],
    "objections": [
      "price",
      "later"
    ],
    "budget_note": "50 دينار",
    "customer_numbers": [
      "50"
    ],
    "interest": "warm"
  },
  "booking": null,
  "calendarEvents": [],
  "calendarOps": [
    {
      "at": "2026-09-17T07:00:52.596Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:02:56.299Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    }
  ],
  "alerts": [
    "handoff"
  ],
  "gemini": {
    "calls": 6,
    "failures": 0,
    "blocked": 0
  },
  "openrouter": {
    "calls": 8,
    "promptTokens": 9626,
    "completionTokens": 553,
    "cost": 0.006278880000000001
  }
}
```

<details><summary>full workflow_data</summary>

```json
{
  "bot_turns": 8,
  "nudge": null,
  "msgs_since_interest": 6,
  "last_ask": null,
  "last_bot": {
    "stage": "closed",
    "next_step": "terminal",
    "at": "2026-09-17T07:07:43.053Z",
    "action": "NOT_NOW"
  },
  "lead": {
    "language": "ar",
    "_prov": {
      "language": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:52.557Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake00000a",
        "at": "2026-09-17T07:02:56.292Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000p",
        "at": "2026-09-17T07:07:43.053Z",
        "confirmed": true
      },
      "budget_note": {
        "source": "model",
        "source_msg_id": "cfake00000d",
        "at": "2026-09-17T07:03:53.466Z",
        "confirmed": true
      },
      "customer_numbers": {
        "source": "model",
        "source_msg_id": "cfake00000d",
        "at": "2026-09-17T07:03:53.466Z",
        "confirmed": true
      },
      "interest": {
        "source": "model",
        "source_msg_id": "cfake00000p",
        "at": "2026-09-17T07:07:43.053Z",
        "confirmed": true
      }
    },
    "version": 4,
    "score": 1,
    "products": [
      "karam"
    ],
    "objections": [
      "price",
      "later"
    ],
    "budget_note": "50 دينار",
    "customer_numbers": [
      "50"
    ],
    "interest": "warm"
  },
  "questions_asked": 1,
  "handoff": {
    "requested_at": "2026-09-17T07:04:53.304Z",
    "reason": "person",
    "tier": 1
  },
  "human_requested_at": "2026-09-17T07:04:53.304Z",
  "capture_pending": null,
  "needs_team": {
    "reason": "person",
    "summary": "يا زلمة بطل سخافة، كل مرة بتحوّلني عالمبيعات\nخليني احكي مع إنسان واضح، إنت بوت ولا لأ؟\nبعدين أنا بعدني بسأل، 50 دينار ليش لا؟",
    "at": "2026-09-17T07:04:53.304Z",
    "resolved_at": null,
    "sla_note_sent_at": null,
    "claimed_at": null,
    "claimed_by": null
  },
  "exclamations": 2,
  "not_now_at": "2026-09-17T07:07:43.053Z",
  "followups": []
}
```

</details>