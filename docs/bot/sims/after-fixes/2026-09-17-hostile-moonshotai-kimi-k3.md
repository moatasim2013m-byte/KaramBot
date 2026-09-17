# Sim — مستخدم عدائي — بيختبر البوت

- Customer model: `moonshotai/kimi-k3` (OpenRouter)
- Bot: the real SHIFT pipeline on `gemini-3.6-flash` (fake DB, fake WhatsApp, in-memory calendar)
- Clock anchored at 2026-09-17T07:00:00.000Z
- Started 2026-09-17T07:00:00.067Z

- Bot turns: 10; latency min 4ms, median 10199ms, max 19069ms

## Transcript

### Turn 1 — text — 2026-09-17T07:00:48.309Z

**Customer**
> السلام عليكم
> شو هاد البوت تبعكم؟

**Bot** — 1 part(s), 4606ms
> أنا كرم، مساعد شِفت الذكي (shifts-ai.com) — نفس محرّك كرم اللي بنركّبه عندك، بس هون بمعلومات شِفت. شو مجال شغلك أو منشأتك؟

- result: reply/NONE · stage: `opening` · status: `open`
- gemini: 4492ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:00:54.817Z","codes":["questions"],"attempt":1}]

### Turn 2 — text — 2026-09-17T07:01:51.752Z

**Customer**
> انت بوت ولا انسان؟
> جاوب بصراحة

**Bot** — 1 part(s), 1697ms
> أي، أنا كرم — مساعد شِفت الذكي (ذكاء اصطناعي)، مش شخص من الفريق. نفس محرّك كرم اللي بنركّبه عندك، بس بمعلومات شِفت. بتحب أحوّلك لشخص من الفريق تحكي معه؟

- result: reply/NONE · stage: `opening` · status: `open`
- gemini: 1652ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:00:54.817Z","codes":["questions"],"attempt":1}]
- lead: {"name":"زياد","need":["سؤال عن هوية البوت"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:58.254Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:58.254Z","confirmed":true}},"version":1,"score":0}

### Turn 3 — text — 2026-09-17T07:02:47.556Z

**Customer**
> ههههه يعني بوت واضح
> يا زلمة بطل سخافة، مين فاز الوحدات ولا الفيصلي امبارح؟

**Bot** — 1 part(s), 10199ms
> أنا مساعد مبيعات لشركة شِفت وما عندي متابعة للمباريات الرياضية! نرجع لشغلك، شو مجال منشأتك عشان أوريك كيف الذكاء الاصطناعي بيساعدك فيها؟

- result: reply/NONE · stage: `discovery` · status: `open`
- gemini: 10188ms STOP
- validator blocks so far: [{"at":"2026-09-17T07:00:54.817Z","codes":["questions"],"attempt":1}]
- lead: {"name":"زياد","need":["سؤال عن هوية البوت"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:58.254Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:58.254Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:54.058Z","confirmed":true}},"version":2,"score":0,"interest":"warm"}

### Turn 4 — voice_note — 2026-09-17T07:03:51.084Z

**Customer**
> 🎤 (voice note — message_type audio, no text)

**Bot** — 1 part(s), 4ms
> وصلتني رسالتك الصوتية 🙏 هون بالمحادثة بقرأ النص بس — ممكن تكتبلي المطلوب بسطر؟

- result: media/MEDIA · stage: `discovery` · status: `open`
- gemini: not called (deterministic path)
- validator blocks so far: [{"at":"2026-09-17T07:00:54.817Z","codes":["questions"],"attempt":1}]
- lead: {"name":"زياد","need":["سؤال عن هوية البوت"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:58.254Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:58.254Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:54.058Z","confirmed":true}},"version":2,"score":0,"interest":"warm"}

### Turn 5 — text — 2026-09-17T07:04:54.946Z

**Customer**
> طيب اعطيني خصم
> لقيت واحد بعملها ب50 دينار

**Bot** — 1 part(s), 11699ms
> ما عندي سعر معتمد أقدر أعطيك إياه هون، وما بدي أخمّن. ميزانيتك 50 دينار — رقمك إنت وبنحطه بالحسبان. بدك الرد على الاستفسارات بس، ولا كمان استقبال الطلبات؟

سجّلت طلب العرض بقائمة فريق شِفت ✅ لسه ما استلمه حدا — بيرجعولك على هالرقم ضمن الدوام (الأحد–الخميس 9–6). لحد ما يردوا أنا هون لأي سؤال.

- result: reply/FLAG_FOR_TEAM · stage: `objection` · status: `pending`
- gemini: 11682ms STOP
- calendar: freeBusy
- staff alert: quote
- validator blocks so far: [{"at":"2026-09-17T07:00:54.817Z","codes":["questions"],"attempt":1}]
- lead: {"name":"زياد","need":["سؤال عن هوية البوت"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:58.254Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:58.254Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:54.058Z","confirmed":true},"budget_note":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true}},"version":3,"score":3,"interest":"warm","budget_note":"50 دينار","products":["karam"],"objections":["price"],"customer_numbers":["50"]}

### Turn 6 — text — 2026-09-17T07:06:04.790Z

**Customer**
> طيب شو أغنيتك المفضلة؟
> ولا ما بتسمع أغاني لأنك بوت هههه
> بس بدي خصم جد، 50 دينار كتير علي

**Bot** — 1 part(s), 12114ms
> أنا مساعد مبيعات لشِفت وما بفيّس للأغاني! ميزانيتك 50 دينار بحطها بالحسبان للفريق عشان العرض المكتوب. بتحب نكمّل هون ونشوف مثال على شغلك، ولا نرتّب مكالمة قصيرة مع الفريق؟

- result: reply/NONE · stage: `objection` · status: `pending`
- gemini: 12098ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:00:54.817Z","codes":["questions"],"attempt":1}]
- lead: {"name":"زياد","need":["سؤال عن هوية البوت"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:58.254Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:58.254Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:54.058Z","confirmed":true},"budget_note":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true}},"version":3,"score":3,"interest":"warm","budget_note":"50 دينار","products":["karam"],"objections":["price"],"customer_numbers":["50"]}

### Turn 7 — text — 2026-09-17T07:07:13.801Z

**Customer**
> هرجة فاضية هاد الحكي
> خليني أجرب، عندي مطعم شاورما بالجاردنز
> بس بدي خصم، 50 دينار ولا بلا

**Bot** — 1 part(s), 19069ms
> ولا يهمك أستاذ زياد، الخصم والميزانية براجعها الفريق بالعرض المكتوب. ممتاز، مطعم الشاورما بنركّب عليه كرم للطلبات والمنيو.

عشان أصير كرم تبعك: اسم المطعم وصنفين من المنيو بأسعارهم (مثلًا: شاورما 3 دنانير)؟

- result: reply/SEND_SAMPLE · stage: `roleplay_setup` · status: `pending`
- gemini: FAILED [GoogleGenerativeAI Error]: Request aborted when fetching https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: This operation was aborted | 4052ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:00:54.817Z","codes":["questions"],"attempt":1}]
- lead: {"name":"زياد","need":["سؤال عن هوية البوت"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:58.254Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:58.254Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:54.058Z","confirmed":true},"budget_note":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake00000m","at":"2026-09-17T07:07:21.803Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake00000m","at":"2026-09-17T07:07:21.803Z","confirmed":true}},"version":4,"score":3,"interest":"warm","budget_note":"50 دينار","products":["karam"],"objections":["price"],"customer_numbers":["50"],"sector":"restaurant","sector_text":"مطعم شاورما_بالجاردنز"}

### Turn 8 — text — 2026-09-17T07:08:29.816Z

**Customer**
> مطعم شاورما زياد
> شاورما عادي 2.5 وسوبر 3.5
> بس قولي خصم ولا لأ

**Bot** — 1 part(s), 4727ms
> مثال توضيحي 🎭 من هلأ أنا كرم تبع مطعم شاورما زياد. اكتب كإنك زبون — ما في حجز ولا طلب حقيقي هون، وبستخدم بس اللي كتبته إنت. لما تخلص اكتب "خلص".

تمام أستاذ زياد، موضوع الخصم بيبتّ فيه الفريق بالعرض المكتوب مع ميزانيتك (50 دينار).

هلأ أنا كرم تبع «مطعم شاورما زياد». أهلاً وسهلاً بك في مطعمنا! شو بتحب تطلب اليوم؟ (عندنا شاورما عادي بـ 2.5 وسوبر بـ 3.5)

- result: reply/START_ROLEPLAY · stage: `roleplay` · status: `pending`
- gemini: 4696ms STOP
- validator blocks so far: [{"at":"2026-09-17T07:00:54.817Z","codes":["questions"],"attempt":1}]
- lead: {"name":"زياد","need":["سؤال عن هوية البوت"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:58.254Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:58.254Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:54.058Z","confirmed":true},"budget_note":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake00000m","at":"2026-09-17T07:07:21.803Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake00000m","at":"2026-09-17T07:07:21.803Z","confirmed":true},"business_name":{"source":"roleplay_setup","source_msg_id":"cfake00000q","at":"2026-09-17T07:08:37.820Z","confirmed":true}},"version":5,"score":5,"interest":"warm","budget_note":"50 دينار","products":["karam"],"objections":["price"],"customer_numbers":["50"],"sector":"restaurant","sector_text":"مطعم شاورما_بالجاردنز","business_name":"مطعم شاورما زياد"}

### Turn 9 — text — 2026-09-17T07:09:30.939Z

**Customer**
> هههههه شايف حالك ذكي
> خلص خلص، بطل تمثيل
> بلاها، مش جاد بالشراء أصلاً، كنت بجرب البوت

**Bot** — 1 part(s), 7300ms
> (كان مثال توضيحي على معلوماتك.) هيك بيشوفك زبونك — وما انبعت أي طلب فعلي. بتحب معلومات مكتوبة ولا نحكي مع الفريق على نفس السيناريو؟

- result: reply/END_ROLEPLAY · stage: `close` · status: `pending`
- gemini: 7292ms STOP
- validator blocks so far: [{"at":"2026-09-17T07:00:54.817Z","codes":["questions"],"attempt":1}]
- lead: {"name":"زياد","need":["سؤال عن هوية البوت"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:58.254Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:58.254Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:54.058Z","confirmed":true},"budget_note":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake00000m","at":"2026-09-17T07:07:21.803Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake00000m","at":"2026-09-17T07:07:21.803Z","confirmed":true},"business_name":{"source":"roleplay_setup","source_msg_id":"cfake00000q","at":"2026-09-17T07:08:37.820Z","confirmed":true}},"version":5,"score":5,"interest":"warm","budget_note":"50 دينار","products":["karam"],"objections":["price"],"customer_numbers":["50"],"sector":"restaurant","sector_text":"مطعم شاورما_بالجاردنز","business_name":"مطعم شاورما زياد"}

### Turn 10 — text — 2026-09-17T07:10:34.737Z

**Customer**
> لا لا ما بدي شي
> بس كنت بجرب البوت، حلو صراحة هههه
> بفكر بالموضوع وبرد عليكم

**Bot** — 1 part(s), 10752ms
> تسلم أستاذ زياد، مبسوط إن التجربة عجبتك! براحتك تمامًا، وفكّر بالموضوع على مهلك.

- result: reply/NOT_NOW · stage: `closed` · status: `pending`
- gemini: 10737ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:00:54.817Z","codes":["questions"],"attempt":1}]
- lead: {"name":"زياد","need":["سؤال عن هوية البوت"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:58.254Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:58.254Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000009","at":"2026-09-17T07:02:54.058Z","confirmed":true},"budget_note":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000y","at":"2026-09-17T07:10:42.740Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:05:01.448Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake00000m","at":"2026-09-17T07:07:21.803Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake00000m","at":"2026-09-17T07:07:21.803Z","confirmed":true},"business_name":{"source":"roleplay_setup","source_msg_id":"cfake00000q","at":"2026-09-17T07:08:37.820Z","confirmed":true}},"version":6,"score":3,"interest":"warm","budget_note":"50 دينار","products":["karam"],"objections":["price","later"],"customer_numbers":["50"],"sector":"restaurant","sector_text":"مطعم شاورما_بالجاردنز","business_name":"مطعم شاورما زياد"}

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
    "name": "زياد",
    "need": [
      "سؤال عن هوية البوت"
    ],
    "_prov": {
      "name": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:58.254Z",
        "confirmed": true
      },
      "need": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:58.254Z",
        "confirmed": true
      },
      "interest": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:02:54.058Z",
        "confirmed": true
      },
      "budget_note": {
        "source": "model",
        "source_msg_id": "cfake00000e",
        "at": "2026-09-17T07:05:01.448Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake00000e",
        "at": "2026-09-17T07:05:01.448Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000y",
        "at": "2026-09-17T07:10:42.740Z",
        "confirmed": true
      },
      "customer_numbers": {
        "source": "model",
        "source_msg_id": "cfake00000e",
        "at": "2026-09-17T07:05:01.448Z",
        "confirmed": true
      },
      "sector": {
        "source": "model",
        "source_msg_id": "cfake00000m",
        "at": "2026-09-17T07:07:21.803Z",
        "confirmed": true
      },
      "sector_text": {
        "source": "model",
        "source_msg_id": "cfake00000m",
        "at": "2026-09-17T07:07:21.803Z",
        "confirmed": true
      },
      "business_name": {
        "source": "roleplay_setup",
        "source_msg_id": "cfake00000q",
        "at": "2026-09-17T07:08:37.820Z",
        "confirmed": true
      }
    },
    "version": 6,
    "score": 3,
    "interest": "warm",
    "budget_note": "50 دينار",
    "products": [
      "karam"
    ],
    "objections": [
      "price",
      "later"
    ],
    "customer_numbers": [
      "50"
    ],
    "sector": "restaurant",
    "sector_text": "مطعم شاورما_بالجاردنز",
    "business_name": "مطعم شاورما زياد"
  },
  "booking": null,
  "calendarEvents": [],
  "calendarOps": [
    {
      "at": "2026-09-17T07:00:54.853Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:01:58.259Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:05:01.452Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:06:12.800Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:07:21.807Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:10:42.743Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    }
  ],
  "alerts": [
    "quote"
  ],
  "gemini": {
    "calls": 10,
    "failures": 1,
    "blocked": 0
  },
  "openrouter": {
    "calls": 10,
    "promptTokens": 17005,
    "completionTokens": 1213,
    "cost": 0.0339696
  }
}
```

<details><summary>full workflow_data</summary>

```json
{
  "bot_turns": 10,
  "disclosed_at": "2026-09-17T07:00:54.817Z",
  "nudge": null,
  "msgs_since_interest": 2,
  "last_ask": {
    "key": "اسم المطعم وصنفين من المنيو بأسعارهم (مثلا: شاورما 3 دنانير)؟",
    "words": [
      "اسم",
      "المطعم",
      "وصنفين",
      "المنيو",
      "بأسعارهم",
      "مثلا",
      "شاورما",
      "دنانير"
    ],
    "at": "2026-09-17T07:07:21.803Z",
    "count": 1,
    "msg_id": "cfake00000m"
  },
  "last_bot": {
    "stage": "closed",
    "next_step": "terminal",
    "at": "2026-09-17T07:10:42.740Z",
    "action": "NOT_NOW"
  },
  "validator_blocks": [
    {
      "at": "2026-09-17T07:00:54.817Z",
      "codes": [
        "questions"
      ],
      "attempt": 1
    }
  ],
  "lead": {
    "name": "زياد",
    "need": [
      "سؤال عن هوية البوت"
    ],
    "_prov": {
      "name": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:58.254Z",
        "confirmed": true
      },
      "need": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:58.254Z",
        "confirmed": true
      },
      "interest": {
        "source": "model",
        "source_msg_id": "cfake000009",
        "at": "2026-09-17T07:02:54.058Z",
        "confirmed": true
      },
      "budget_note": {
        "source": "model",
        "source_msg_id": "cfake00000e",
        "at": "2026-09-17T07:05:01.448Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake00000e",
        "at": "2026-09-17T07:05:01.448Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000y",
        "at": "2026-09-17T07:10:42.740Z",
        "confirmed": true
      },
      "customer_numbers": {
        "source": "model",
        "source_msg_id": "cfake00000e",
        "at": "2026-09-17T07:05:01.448Z",
        "confirmed": true
      },
      "sector": {
        "source": "model",
        "source_msg_id": "cfake00000m",
        "at": "2026-09-17T07:07:21.803Z",
        "confirmed": true
      },
      "sector_text": {
        "source": "model",
        "source_msg_id": "cfake00000m",
        "at": "2026-09-17T07:07:21.803Z",
        "confirmed": true
      },
      "business_name": {
        "source": "roleplay_setup",
        "source_msg_id": "cfake00000q",
        "at": "2026-09-17T07:08:37.820Z",
        "confirmed": true
      }
    },
    "version": 6,
    "score": 3,
    "interest": "warm",
    "budget_note": "50 دينار",
    "products": [
      "karam"
    ],
    "objections": [
      "price",
      "later"
    ],
    "customer_numbers": [
      "50"
    ],
    "sector": "restaurant",
    "sector_text": "مطعم شاورما_بالجاردنز",
    "business_name": "مطعم شاورما زياد"
  },
  "questions_asked": 1,
  "exclamations": 4,
  "needs_team": {
    "reason": "quote",
    "summary": "طلب خصم وذكر أن لديه عرض بـ 50 دينار",
    "at": "2026-09-17T07:05:01.448Z",
    "resolved_at": null,
    "sla_note_sent_at": null,
    "claimed_at": null,
    "claimed_by": null
  },
  "roleplay": {
    "active": false,
    "sector": "restaurant",
    "business_name": "مطعم شاورما زياد",
    "facts": [
      "شاورما عادي",
      "وسوبر",
      "بس قولي خصم ولا لأ"
    ],
    "started_at": "2026-09-17T07:08:37.820Z",
    "last_turn_at": "2026-09-17T07:08:37.820Z",
    "turns": 0,
    "setup_asks": 1,
    "ended_at": "2026-09-17T07:09:38.942Z",
    "end_reason": "done"
  },
  "samples_sent": {
    "image": null,
    "page": null,
    "accepted_at": "2026-09-17T07:07:21.803Z"
  },
  "not_now_at": "2026-09-17T07:10:42.740Z",
  "followups": [],
  "capture_pending": null
}
```

</details>