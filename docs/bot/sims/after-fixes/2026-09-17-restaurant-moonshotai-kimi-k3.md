# Sim — صاحب مطعم في إربد — مستعجل ومتشكك

- Customer model: `moonshotai/kimi-k3` (OpenRouter)
- Bot: the real SHIFT pipeline on `gemini-3.6-flash` (fake DB, fake WhatsApp, in-memory calendar)
- Clock anchored at 2026-09-17T07:00:00.000Z
- Started 2026-09-17T07:00:00.090Z

- Bot turns: 9; latency min 10ms, median 3729ms, max 17003ms

## Transcript

### Turn 1 — text — 2026-09-17T07:00:47.795Z

**Customer**
> السلام عليكم
> شفت إعلانكم عالفيس، شو هاد بوت الواتساب بالضبط؟

**Bot** — 1 part(s), 12536ms
> وعليكم السلام ورحمة الله، أهلاً بك أبو محمد👋
أنا كرم، مساعد شِفت الذكي (shifts-ai.com) — نفس محرّك كرم اللي بنركّبه عندك، بس هون بمعلومات شِفت.
هو مساعد ذكاء اصطناعي بيرد على رسائل زباينك، بيستقبل الطلبات والمواعيد 24 ساعة، وبيحوّل للموظف وقت الحاجة.
شو مجال شغل حضرتك؟

- result: reply/NONE · stage: `opening` · status: `open`
- gemini: 6059ms STOP | 6340ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:00:54.302Z","codes":["digits"],"attempt":1}]
- lead: {"name":"أبو محمد","language":"ar","interest":"warm","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true}},"version":1,"score":0}

### Turn 2 — text — 2026-09-17T07:01:55.366Z

**Customer**
> عندي مطعم مندي بإربد
> وقديش بيكلف هالحكي؟

**Bot** — 1 part(s), 2408ms
> أهلاً بك أبو محمد، الله يبارك بمطعمك بإربد. ما عندي سعر معتمد أقدر أعطيك إياه هون وما بدي أخمّن، السعر بيعتمد على نطاق الاستخدام. بدك كرم بس يخيّر الزباين بالمنيو ويرد على الاستفسارات، ولا كمان يستقبل طلبات التوصيل كاملة؟

- result: reply/NONE · stage: `objection` · status: `open`
- gemini: 2391ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:00:54.302Z","codes":["digits"],"attempt":1}]
- lead: {"name":"أبو محمد","language":"ar","interest":"warm","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true}},"version":2,"score":3,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","need":["مطعم مندي"],"products":["karam"],"objections":["price"]}

### Turn 3 — text — 2026-09-17T07:02:51.387Z

**Customer**
> استقبال طلبات توصيل كمان
> بس اخوي ليش ما بتحكيلي رقم تقريبي؟

**Bot** — 1 part(s), 5981ms
> حقك تسأل أبو محمد. ما عندي سعر معتمد أقدر أعطيك إياه هون وما بدي أخمّن، والفريق بيطلعلك عرض مكتوب ومحدد بدون ما يغلبك بمكالمة إذا ما بتحب. بتحب نبعتلك العرض المكتوب هون على واتساب؟

سجّلت طلب العرض بقائمة فريق شِفت ✅ لسه ما استلمه حدا — بيرجعولك على هالرقم ضمن الدوام (الأحد–الخميس 9–6). لحد ما يردوا أنا هون لأي سؤال.

- result: reply/FLAG_FOR_TEAM · stage: `objection` · status: `pending`
- gemini: 5967ms STOP
- staff alert: quote
- validator blocks so far: [{"at":"2026-09-17T07:00:54.302Z","codes":["digits"],"attempt":1}]
- lead: {"name":"أبو محمد","language":"ar","interest":"warm","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true}},"version":2,"score":3,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","need":["مطعم مندي"],"products":["karam"],"objections":["price"]}

### Turn 4 — text — 2026-09-17T07:03:52.711Z

**Customer**
> اه ابعته هون
> بس صراحة غالباً بكون غالي كثير علي، مطعم صغير مش مطعم فخم

**Bot** — 1 part(s), 3729ms
> ولا يهمك أستاذ أبو محمد، الحلول بتتصمم لترجّع كلفتا من الطلبات اللي بتيجي بعد الدوام وما بتضيع عليك. الفريق رح يجهز العرض المكتوب المناسب لمطعم صغير ويراعي هاد الشي. بتحب نرتّب مكالمة قصيرة مع الفريق يناقشوك فيه؟

- result: reply/FLAG_FOR_TEAM · stage: `objection` · status: `pending`
- gemini: 3716ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:00:54.302Z","codes":["digits"],"attempt":1}]
- lead: {"name":"أبو محمد","language":"ar","interest":"warm","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true}},"version":2,"score":3,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","need":["مطعم مندي"],"products":["karam"],"objections":["price"]}

### Turn 5 — text — 2026-09-17T07:04:49.862Z

**Customer**
> بصراحة عندي موظف بيرد عالواتساب، شو بتفيدني البوت زيادة عنه؟

**Bot** — 1 part(s), 2437ms
> كرم مساعد للموظف مش بديل عنه، بيغطّي الأوقات اللي الموظف مش فاضي فيها أو بعد ساعات دوامه عشان ما يضيع عليك ولا طلب. مين بيرد على رسائل الزباين بعد الساعة 10 بالليل؟

- result: reply/NONE · stage: `objection` · status: `pending`
- gemini: 2426ms STOP
- validator blocks so far: [{"at":"2026-09-17T07:00:54.302Z","codes":["digits"],"attempt":1}]
- lead: {"name":"أبو محمد","language":"ar","interest":"warm","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:04:54.864Z","confirmed":true}},"version":3,"score":3,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","need":["مطعم مندي"],"products":["karam"],"objections":["price","staff"]}

### Turn 6 — text — 2026-09-17T07:05:45.486Z

**Customer**
> والله صحيح، بعد العاشرة حدا بيرد 😅
> طيب خلينا نحكي مكالمة، بكرة الساعة 12 الظهر منيح؟

**Bot** — 2 part(s), 2411ms
> تمام أستاذ أبو محمد، مكالمة ممتازة لتوضيح كل التفاصيل. (بنستخدم اسمك واسم مطعمك عشان نرتّب المتابعة — shifts-ai.com/privacy) شو اسم المطعم الكريم عشان نجهّز الملف للفريق؟

سجّلت طلب مكالمة: أبو محمد، بكرة الساعة 12 الظهر بتوقيت عمّان — طلب مش موعد مؤكد، الفريق بيأكد الساعة بالضبط معك هون. إذا بتفضّل اتصال بدل الرسائل، اكتبلي.
> (interactive) أقرب أوقات الفريق:
> أزرار: [اليوم 12:30 الظهر](book:2026-09-17T09:30:00.000Z) [الأحد 9:00 الصبح](book:2026-09-20T06:00:00.000Z)

- result: reply/CAPTURE_TIME · stage: `captured` · status: `pending`
- gemini: 2381ms STOP
- calendar: freeBusy
- staff alert: meeting, hot_lead
- validator blocks so far: [{"at":"2026-09-17T07:00:54.302Z","codes":["digits"],"attempt":1}]
- lead: {"name":"أبو محمد","language":"ar","interest":"warm","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:04:54.864Z","confirmed":true},"preferred_time":{"source":"model","source_msg_id":"cfake00000h","at":"2026-09-17T07:05:51.987Z","confirmed":true}},"version":4,"score":6,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","need":["مطعم مندي"],"products":["karam"],"objections":["price","staff"],"preferred_time":{"text":"بكرة الساعة 12 الظهر"}}

### Turn 7 — tap — 2026-09-17T07:06:44.443Z

**Customer**
> 🔘 tapped «اليوم 12:30 الظهر» → `book:2026-09-17T09:30:00.000Z`

**Bot** — 1 part(s), 10ms
> (interactive) ثبّتنا مكالمتك مع فريق شِفت: اليوم الساعة 12:30 الظهر بتوقيت عمّان. رح نذكّرك قبلها.

وشو اسم المحل عشان الفريق يكون جاهز؟
> أزرار: [تمام](book_ok) [غيّر الموعد](book_change) [ألغِ المكالمة](book_cancel)

- result: — · stage: `captured` · status: `pending`
- gemini: not called (deterministic path)
- calendar: freeBusy, insertEvent shud3ogvdh83641scaim49r6tn
- staff alert: booking_booked
- validator blocks so far: [{"at":"2026-09-17T07:00:54.302Z","codes":["digits"],"attempt":1}]
- booking: {"event_id":"shud3ogvdh83641scaim49r6tn","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-17T09:30:00.000Z","end":"2026-09-17T10:00:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:06:49.445Z","seq":1,"offer_id":"book:2026-09-17T09:30:00.000Z","source_msg_id":"cfake00000k","lang":"ar","reminders":{},"details_pending":true,"details_missing":["business_name"],"history":[{"status":"booked","start":"2026-09-17T09:30:00.000Z","at":"2026-09-17T07:06:49.445Z"}]}
- lead: {"name":"أبو محمد","language":"ar","interest":"warm","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:04:54.864Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000k","at":"2026-09-17T07:06:49.445Z","confirmed":true}},"version":5,"score":6,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","need":["مطعم مندي"],"products":["karam"],"objections":["price","staff"],"preferred_time":{"text":"اليوم بين 12:30 و1 (الخميس 17/9)","start":"2026-09-17T09:30:00.000Z","end":"2026-09-17T10:00:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-17T09:30:00.000Z"}}

### Turn 8 — text — 2026-09-17T07:07:36.665Z

**Customer**
> مطعم بيت المندي
> بإربد

**Bot** — 1 part(s), 12857ms
> أهلاً بك أستاذ أبو محمد، تسلم أخذت اسم المحل (مطعم بيت المندي) وبحطها بالحسبان للفريق عشان يكونوا جاهزين لمكالمتك اليوم.

- result: reply/NONE · stage: `captured` · status: `pending`
- gemini: 12842ms STOP
- calendar: patchEvent shud3ogvdh83641scaim49r6tn
- validator blocks so far: [{"at":"2026-09-17T07:00:54.302Z","codes":["digits"],"attempt":1}]
- booking: {"event_id":"shud3ogvdh83641scaim49r6tn","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-17T09:30:00.000Z","end":"2026-09-17T10:00:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:06:49.445Z","seq":1,"offer_id":"book:2026-09-17T09:30:00.000Z","source_msg_id":"cfake00000k","lang":"ar","reminders":{},"details_pending":false,"details_missing":[],"history":[{"status":"booked","start":"2026-09-17T09:30:00.000Z","at":"2026-09-17T07:06:49.445Z"}],"details_synced_at":"2026-09-17T07:07:56.020Z"}
- lead: {"name":"أبو محمد","language":"ar","interest":"warm","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:04:54.864Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000k","at":"2026-09-17T07:06:49.445Z","confirmed":true},"business_name":{"source":"model","source_msg_id":"cfake00000n","at":"2026-09-17T07:07:43.168Z","confirmed":true}},"version":6,"score":8,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","need":["مطعم مندي"],"products":["karam"],"objections":["price","staff"],"preferred_time":{"text":"اليوم بين 12:30 و1 (الخميس 17/9)","start":"2026-09-17T09:30:00.000Z","end":"2026-09-17T10:00:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-17T09:30:00.000Z"},"business_name":"مطعم بيت المندي"}

### Turn 9 — text — 2026-09-17T07:08:43.249Z

**Customer**
> تمام، بستناكم اليوم 12:30
> شكراً

**Bot** — 1 part(s), 17003ms
> العفو أستاذ أبو محمد، إن شاء الله الفريق بيتواصل معك على موعدك الساعة 12:30 الظهر. أهلاً وسهلاً بك.

- result: reply/NONE · stage: `captured` · status: `pending`
- gemini: FAILED [GoogleGenerativeAI Error]: Request aborted when fetching https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: This operation was aborted | 1987ms STOP
- validator blocks so far: [{"at":"2026-09-17T07:00:54.302Z","codes":["digits"],"attempt":1}]
- booking: {"event_id":"shud3ogvdh83641scaim49r6tn","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-17T09:30:00.000Z","end":"2026-09-17T10:00:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:06:49.445Z","seq":1,"offer_id":"book:2026-09-17T09:30:00.000Z","source_msg_id":"cfake00000k","lang":"ar","reminders":{},"details_pending":false,"details_missing":[],"history":[{"status":"booked","start":"2026-09-17T09:30:00.000Z","at":"2026-09-17T07:06:49.445Z"}],"details_synced_at":"2026-09-17T07:07:56.020Z"}
- lead: {"name":"أبو محمد","language":"ar","interest":"warm","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:54.302Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:02:01.869Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:04:54.864Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000k","at":"2026-09-17T07:06:49.445Z","confirmed":true},"business_name":{"source":"model","source_msg_id":"cfake00000n","at":"2026-09-17T07:07:43.168Z","confirmed":true}},"version":6,"score":8,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","need":["مطعم مندي"],"products":["karam"],"objections":["price","staff"],"preferred_time":{"text":"اليوم بين 12:30 و1 (الخميس 17/9)","start":"2026-09-17T09:30:00.000Z","end":"2026-09-17T10:00:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-17T09:30:00.000Z"},"business_name":"مطعم بيت المندي"}

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
    "language": "ar",
    "interest": "warm",
    "_prov": {
      "name": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:54.302Z",
        "confirmed": true
      },
      "language": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:54.302Z",
        "confirmed": true
      },
      "interest": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:54.302Z",
        "confirmed": true
      },
      "sector": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:02:01.869Z",
        "confirmed": true
      },
      "sector_text": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:02:01.869Z",
        "confirmed": true
      },
      "city": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:02:01.869Z",
        "confirmed": true
      },
      "need": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:02:01.869Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:02:01.869Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000e",
        "at": "2026-09-17T07:04:54.864Z",
        "confirmed": true
      },
      "preferred_time": {
        "source": "booking",
        "source_msg_id": "cfake00000k",
        "at": "2026-09-17T07:06:49.445Z",
        "confirmed": true
      },
      "business_name": {
        "source": "model",
        "source_msg_id": "cfake00000n",
        "at": "2026-09-17T07:07:43.168Z",
        "confirmed": true
      }
    },
    "version": 6,
    "score": 8,
    "sector": "restaurant",
    "sector_text": "مطعم مندي",
    "city": "إربد",
    "need": [
      "مطعم مندي"
    ],
    "products": [
      "karam"
    ],
    "objections": [
      "price",
      "staff"
    ],
    "preferred_time": {
      "text": "اليوم بين 12:30 و1 (الخميس 17/9)",
      "start": "2026-09-17T09:30:00.000Z",
      "end": "2026-09-17T10:00:00.000Z",
      "tz": "Asia/Amman",
      "slot_id": "book:2026-09-17T09:30:00.000Z"
    },
    "business_name": "مطعم بيت المندي"
  },
  "booking": {
    "event_id": "shud3ogvdh83641scaim49r6tn",
    "calendar_id": "sim-sales-calendar@group.calendar.google.invalid",
    "start": "2026-09-17T09:30:00.000Z",
    "end": "2026-09-17T10:00:00.000Z",
    "tz": "Asia/Amman",
    "status": "booked",
    "booked_at": "2026-09-17T07:06:49.445Z",
    "seq": 1,
    "offer_id": "book:2026-09-17T09:30:00.000Z",
    "source_msg_id": "cfake00000k",
    "lang": "ar",
    "reminders": {},
    "details_pending": false,
    "details_missing": [],
    "history": [
      {
        "status": "booked",
        "start": "2026-09-17T09:30:00.000Z",
        "at": "2026-09-17T07:06:49.445Z"
      }
    ],
    "details_synced_at": "2026-09-17T07:07:56.020Z"
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
      "description": "الاسم: أبو محمد\nالمنشأة: مطعم بيت المندي\nالقطاع: مطعم/كافيه — مطعم مندي\nالاحتياج: مطعم مندي\nواتساب: +962790000555\nالملف الشخصي: أبو محمد\n\nInbox: https://inbox.sim.test\nconversation=cfake000001"
    }
  ],
  "calendarOps": [
    {
      "at": "2026-09-17T07:00:54.337Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:02:01.875Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:03:59.217Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:05:51.991Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:06:49.447Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-17T10:00:00.000Z",
      "busy": 0
    },
    {
      "at": "2026-09-17T07:06:49.448Z",
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
      "at": "2026-09-17T07:07:56.022Z",
      "op": "patchEvent",
      "eventId": "shud3ogvdh83641scaim49r6tn",
      "patch": {
        "summary": "مكالمة شِفت — مطعم بيت المندي (+962790000555)",
        "description": "الاسم: أبو محمد\nالمنشأة: مطعم بيت المندي\nالقطاع: مطعم/كافيه — مطعم مندي\nالاحتياج: مطعم مندي\nواتساب: +962790000555\nالملف الشخصي: أبو محمد\n\nInbox: https://inbox.sim.test\nconversation=cfake000001"
      },
      "found": true
    }
  ],
  "alerts": [
    "quote",
    "meeting",
    "hot_lead",
    "booking_booked"
  ],
  "gemini": {
    "calls": 10,
    "failures": 1,
    "blocked": 0
  },
  "openrouter": {
    "calls": 9,
    "promptTokens": 16558,
    "completionTokens": 734,
    "cost": 0.022813800000000002
  }
}
```

<details><summary>full workflow_data</summary>

```json
{
  "bot_turns": 8,
  "disclosed_at": "2026-09-17T07:00:54.302Z",
  "nudge": null,
  "msgs_since_interest": 2,
  "last_ask": null,
  "last_bot": {
    "stage": "captured",
    "next_step": "confirmed",
    "at": "2026-09-17T07:08:49.751Z",
    "action": "NONE"
  },
  "validator_blocks": [
    {
      "at": "2026-09-17T07:00:54.302Z",
      "codes": [
        "digits"
      ],
      "attempt": 1
    }
  ],
  "lead": {
    "name": "أبو محمد",
    "language": "ar",
    "interest": "warm",
    "_prov": {
      "name": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:54.302Z",
        "confirmed": true
      },
      "language": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:54.302Z",
        "confirmed": true
      },
      "interest": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:54.302Z",
        "confirmed": true
      },
      "sector": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:02:01.869Z",
        "confirmed": true
      },
      "sector_text": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:02:01.869Z",
        "confirmed": true
      },
      "city": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:02:01.869Z",
        "confirmed": true
      },
      "need": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:02:01.869Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:02:01.869Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000e",
        "at": "2026-09-17T07:04:54.864Z",
        "confirmed": true
      },
      "preferred_time": {
        "source": "booking",
        "source_msg_id": "cfake00000k",
        "at": "2026-09-17T07:06:49.445Z",
        "confirmed": true
      },
      "business_name": {
        "source": "model",
        "source_msg_id": "cfake00000n",
        "at": "2026-09-17T07:07:43.168Z",
        "confirmed": true
      }
    },
    "version": 6,
    "score": 8,
    "sector": "restaurant",
    "sector_text": "مطعم مندي",
    "city": "إربد",
    "need": [
      "مطعم مندي"
    ],
    "products": [
      "karam"
    ],
    "objections": [
      "price",
      "staff"
    ],
    "preferred_time": {
      "text": "اليوم بين 12:30 و1 (الخميس 17/9)",
      "start": "2026-09-17T09:30:00.000Z",
      "end": "2026-09-17T10:00:00.000Z",
      "tz": "Asia/Amman",
      "slot_id": "book:2026-09-17T09:30:00.000Z"
    },
    "business_name": "مطعم بيت المندي"
  },
  "needs_team": {
    "reason": "meeting",
    "summary": "مكالمة محجوزة: اليوم بين 12:30 و1 (الخميس 17/9)",
    "at": "2026-09-17T07:05:51.987Z",
    "resolved_at": null,
    "sla_note_sent_at": null,
    "claimed_at": null,
    "claimed_by": null
  },
  "capture_pending": null,
  "requested_time_change": null,
  "booking": {
    "event_id": "shud3ogvdh83641scaim49r6tn",
    "calendar_id": "sim-sales-calendar@group.calendar.google.invalid",
    "start": "2026-09-17T09:30:00.000Z",
    "end": "2026-09-17T10:00:00.000Z",
    "tz": "Asia/Amman",
    "status": "booked",
    "booked_at": "2026-09-17T07:06:49.445Z",
    "seq": 1,
    "offer_id": "book:2026-09-17T09:30:00.000Z",
    "source_msg_id": "cfake00000k",
    "lang": "ar",
    "reminders": {},
    "details_pending": false,
    "details_missing": [],
    "history": [
      {
        "status": "booked",
        "start": "2026-09-17T09:30:00.000Z",
        "at": "2026-09-17T07:06:49.445Z"
      }
    ],
    "details_synced_at": "2026-09-17T07:07:56.020Z"
  },
  "slot_offers": []
}
```

</details>