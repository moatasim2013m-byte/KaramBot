# Sim — صاحب مطعم في إربد — مستعجل ومتشكك

- Customer model: `z-ai/glm-5.3` (OpenRouter)
- Bot: the real SHIFT pipeline on `gemini-3.6-flash` (fake DB, fake WhatsApp, in-memory calendar)
- Clock anchored at 2026-09-17T07:00:00.000Z
- Started 2026-09-17T07:00:00.081Z

- Bot turns: 11; latency min 5ms, median 4139ms, max 19131ms

## Transcript

### Turn 1 — text — 2026-09-17T07:00:46.040Z

**Customer**
> سلام، شو هاي البوتات اللي بتبيعوها؟

**Bot** — 1 part(s), 4431ms
> وعليكم السلام يا أهلاً. أنا كرم، مساعد شِفت الذكي (shifts-ai.com) — نفس محرّك كرم اللي بنركّبه عندك بس هون بمعلومات شِفت. بنبني وكلاء ذكاء اصطناعي على واتساب يردّوا على زباينك، ياخدوا الطلبات والمواعيد، ويتابعوا معهم ليل ونهار.

شو مجال شغلك أو نشاطك التجارى؟

- result: reply/NONE · stage: `discovery` · status: `open`
- gemini: 4313ms STOP
- calendar: freeBusy
- lead: {"name":"أبو محمد","language":"ar","need":["استفسار عن البوتات وكيف بتشتغل"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true}},"version":1,"score":0}

### Turn 2 — text — 2026-09-17T07:01:41.731Z

**Customer**
> عندي مطعم مندي بإربد
> بس كم بتكلف هالخدمة؟

**Bot** — 1 part(s), 5811ms
> أهلاً أستاذ أبو محمد، والأنعام بك وبأهل إربد. ما عندي سعر معتمد أقدر أعطيك إياه هون، وما بدي أخمّن. بدك البوت بس يرد على الاستفسارات والمنيو، ولا كمان يستقبل طلبات التوصيل بالكامل؟

- result: reply/NONE · stage: `objection` · status: `open`
- gemini: 5779ms STOP
- lead: {"name":"أبو محمد","language":"ar","need":["استفسار عن البوتات وكيف بتشتغل","مطعم مندي واستفسار عن السعر والنطاق"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true}},"version":2,"score":3,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","interest":"hot","products":["karam"],"objections":["price"]}

### Turn 3 — text — 2026-09-17T07:02:40.584Z

**Customer**
> مش مهم التفاصيل
> بدي اعرف السعر تقريباً
> غالي بنصير؟

**Bot** — 1 part(s), 4488ms
> ما عندي سعر معتمد أقدر أعطيك إياه هون، وما بدي أخمّن. الأسعار بيحددها الفريق حسب احتياج مطعمك، وبنبعثلك عرض مكتوب بدون ما ندخل بتفاصيل مش لزمتك. بتحب يتواصل معك الفريق بعرض سعر مكتوب، ولا نرتّب مكالمة قصيرة؟

سجّلت طلب العرض بقائمة فريق شِفت ✅ لسه ما استلمه حدا — بيرجعولك على هالرقم ضمن الدوام (الأحد–الخميس 9–6). لحد ما يردوا أنا هون لأي سؤال.

- result: reply/FLAG_FOR_TEAM · stage: `objection` · status: `pending`
- gemini: 4462ms STOP
- calendar: freeBusy
- staff alert: quote
- lead: {"name":"أبو محمد","language":"ar","need":["استفسار عن البوتات وكيف بتشتغل","مطعم مندي واستفسار عن السعر والنطاق"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true}},"version":2,"score":3,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","interest":"hot","products":["karam"],"objections":["price"]}

### Turn 4 — text — 2026-09-17T07:03:39.930Z

**Customer**
> يعني ما بتعرف السعر بالمره؟
> شكلك غاليين بزات
> عندي موظف بيرد عالرسائل، شو بتفيدني انا؟

**Bot** — 1 part(s), 2448ms
> كرم مساعد للموظف مش بديل عنه — بيغطي الوقت اللي مش موجود فيه، زي بعد الدوام أو وقت الضغط عشان ما يضيع أي زبون. بالنسبة للسعر الفريق ببيّن كل التفاصيل بالعرض المكتوب. مين بيرد عندكم على رسائل المطعم بعد الساعة 10 بالليل؟

- result: reply/NONE · stage: `objection` · status: `pending`
- gemini: 2434ms STOP
- lead: {"name":"أبو محمد","language":"ar","need":["استفسار عن البوتات وكيف بتشتغل","مطعم مندي واستفسار عن السعر والنطاق"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:47.933Z","confirmed":true}},"version":3,"score":3,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","interest":"hot","products":["karam"],"objections":["price","staff"]}

### Turn 5 — text — 2026-09-17T07:04:36.511Z

**Customer**
> والله ما حدا بيرد بعد الدوام
> بس هالكلام غالي كثير ما بصرف معي
> كم بتاخدوا عالشهر تقريباً؟

**Bot** — 1 part(s), 18672ms
> حقك تهتم بالتكلفة، وعشان هيك بنبدأ بشي محدد وما بنحمّلك أجزاء ما بتلزمك. ما عندي سعر معتمد أقدر أعطيك إياه هون وما بدي أخمّن، بس الفريق بيطلعلك عرض مكتوب حسَب احتياجك. بدك كرم يرد على استفسارات المنيو والتوصيل بس، ولا كمان يربط مع نقاط البيع؟

- result: reply/FLAG_FOR_TEAM · stage: `objection` · status: `pending`
- gemini: FAILED [GoogleGenerativeAI Error]: Request aborted when fetching https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: This operation was aborted | 3652ms STOP
- calendar: freeBusy
- lead: {"name":"أبو محمد","language":"ar","need":["استفسار عن البوتات وكيف بتشتغل","مطعم مندي واستفسار عن السعر والنطاق"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:47.933Z","confirmed":true}},"version":3,"score":3,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","interest":"hot","products":["karam"],"objections":["price","staff"]}

### Turn 6 — text — 2026-09-17T07:05:49.213Z

**Customer**
> بس المنيو والتوصيل
> طيب اذا بعتولي عرض بدي اشوفه بس اذا كان كتير غالي بوخذ خاطرك

**Bot** — 1 part(s), 2710ms
> تمام، حددنا النطاق على المنيو والتوصيل بس وهاد بيخلي العرض المكتوب واضح ومناسب. الفريق رح يجهز العرض ويوصلك هون، وحقك تماماً تشوفه وتقرر براحتك بدون أي التزام. بتحب نرتّب مكالمة قصيرة مع الفريق لشرح العرض لما يجهز، ولا بتفضل يوصلك مكتوب وبس؟

- result: reply/FLAG_FOR_TEAM · stage: `objection` · status: `pending`
- gemini: 2696ms STOP
- calendar: freeBusy
- lead: {"name":"أبو محمد","language":"ar","need":["استفسار عن البوتات وكيف بتشتغل","مطعم مندي واستفسار عن السعر والنطاق","رد على استفسارات المنيو واستقبال طلبات التوصيل فقط"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000k","at":"2026-09-17T07:05:55.715Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:47.933Z","confirmed":true}},"version":4,"score":3,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","interest":"hot","products":["karam"],"objections":["price","staff"]}

### Turn 7 — text — 2026-09-17T07:06:44.261Z

**Customer**
> خليها مكتوب احسن
> بس اذا بدي مكالمة بخليها بعد العصر
> انا مشغول هلق وما بفرغ الا وقتا

**Bot** — 1 part(s), 19131ms
> (interactive) ولا يهمك أبو محمد، بيوصلك العرض مكتوب هون بدون أي إحراج، وإذا حبيت نحكي بعد العصر الفريق جاهز. أقرب أوقات الفريق:
> أزرار: [اليوم 12:30 الظهر](book:2026-09-17T09:30:00.000Z) [الأحد 9:00 الصبح](book:2026-09-20T06:00:00.000Z) [وقت ثاني](slot:other)

- result: reply/FLAG_FOR_TEAM · stage: `objection` · status: `pending`
- gemini: FAILED [GoogleGenerativeAI Error]: Request aborted when fetching https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: This operation was aborted | 4106ms STOP
- staff alert: hot_lead
- validator blocks so far: [{"at":"2026-09-17T07:06:52.263Z","codes":["dangling_colon"],"attempt":1}]
- lead: {"name":"أبو محمد","language":"ar","need":["استفسار عن البوتات وكيف بتشتغل","مطعم مندي واستفسار عن السعر والنطاق","رد على استفسارات المنيو واستقبال طلبات التوصيل فقط"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000k","at":"2026-09-17T07:05:55.715Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:47.933Z","confirmed":true},"preferred_time":{"source":"model","source_msg_id":"cfake00000o","at":"2026-09-17T07:06:52.263Z","confirmed":true}},"version":5,"score":6,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","interest":"hot","products":["karam"],"objections":["price","staff"],"preferred_time":{"text":"بعد العصر"}}

### Turn 8 — tap — 2026-09-17T07:08:07.622Z

**Customer**
> 🔘 tapped «وقت ثاني» → `slot:other`

**Bot** — 1 part(s), 5ms
> تمام — أي يوم وساعة بتريحك؟

- result: — · stage: `close` · status: `pending`
- gemini: not called (deterministic path)
- validator blocks so far: [{"at":"2026-09-17T07:06:52.263Z","codes":["dangling_colon"],"attempt":1}]
- capture_pending: {"slot_id":"other","time_text":null,"at":"2026-09-17T07:08:12.623Z"}
- lead: {"name":"أبو محمد","language":"ar","need":["استفسار عن البوتات وكيف بتشتغل","مطعم مندي واستفسار عن السعر والنطاق","رد على استفسارات المنيو واستقبال طلبات التوصيل فقط"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000k","at":"2026-09-17T07:05:55.715Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:47.933Z","confirmed":true},"preferred_time":{"source":"model","source_msg_id":"cfake00000o","at":"2026-09-17T07:06:52.263Z","confirmed":true}},"version":5,"score":6,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","interest":"hot","products":["karam"],"objections":["price","staff"],"preferred_time":{"text":"بعد العصر"}}

### Turn 9 — text — 2026-09-17T07:08:58.570Z

**Customer**
> خلوها بكرة بعد العصر
> من 4 لحد 6

**Bot** — 2 part(s), 4139ms
> سجّلت طلب مكالمة: أبو محمد، بكرة بعد العصر من 4 لحد 6 بتوقيت عمّان — طلب مش موعد مؤكد، الفريق بيأكد الساعة بالضبط معك هون. إذا بتفضّل اتصال بدل الرسائل، اكتبلي.
> (interactive) أقرب أوقات الفريق:
> أزرار: [اليوم 12:30 الظهر](book:2026-09-17T09:30:00.000Z) [الأحد 9:00 الصبح](book:2026-09-20T06:00:00.000Z)

- result: reply/CAPTURE_TIME · stage: `captured` · status: `pending`
- gemini: 4119ms STOP
- calendar: freeBusy
- staff alert: meeting
- validator blocks so far: [{"at":"2026-09-17T07:06:52.263Z","codes":["dangling_colon"],"attempt":1}]
- lead: {"name":"أبو محمد","language":"ar","need":["استفسار عن البوتات وكيف بتشتغل","مطعم مندي واستفسار عن السعر والنطاق","رد على استفسارات المنيو واستقبال طلبات التوصيل فقط"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000k","at":"2026-09-17T07:05:55.715Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:47.933Z","confirmed":true},"preferred_time":{"source":"model","source_msg_id":"cfake00000t","at":"2026-09-17T07:09:05.071Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000t","at":"2026-09-17T07:09:05.071Z","confirmed":true}},"version":6,"score":6,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","interest":"hot","products":["karam"],"objections":["price","staff"],"preferred_time":{"text":"بكرة بعد العصر من 4 لحد 6"},"customer_numbers":["4","6"]}

### Turn 10 — text — 2026-09-17T07:09:55.045Z

**Customer**
> تمام، بانتظار اتصالكم بكرة
> بس نبهوني قبل الرنة بشوي

**Bot** — 1 part(s), 2890ms
> ولا يهمك أستاذ أبو محمد، بحط ملاحظة للتنبيه قبل الاتصال بالحسبان.

- result: reply/NONE · stage: `captured` · status: `pending`
- gemini: 2880ms STOP
- validator blocks so far: [{"at":"2026-09-17T07:06:52.263Z","codes":["dangling_colon"],"attempt":1}]
- lead: {"name":"أبو محمد","language":"ar","need":["استفسار عن البوتات وكيف بتشتغل","مطعم مندي واستفسار عن السعر والنطاق","رد على استفسارات المنيو واستقبال طلبات التوصيل فقط"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000k","at":"2026-09-17T07:05:55.715Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:47.933Z","confirmed":true},"preferred_time":{"source":"model","source_msg_id":"cfake00000t","at":"2026-09-17T07:09:05.071Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000t","at":"2026-09-17T07:09:05.071Z","confirmed":true}},"version":6,"score":6,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","interest":"hot","products":["karam"],"objections":["price","staff"],"preferred_time":{"text":"بكرة بعد العصر من 4 لحد 6"},"customer_numbers":["4","6"]}

### Turn 11 — text — 2026-09-17T07:10:52.907Z

**Customer**
> تمام، يسلمو

**Bot** — 1 part(s), 3868ms
> الله يسلمك أستاذ أبو محمد، يوماً سعيداً 👋

- result: reply/NONE · stage: `captured` · status: `pending`
- gemini: 3860ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:06:52.263Z","codes":["dangling_colon"],"attempt":1}]
- lead: {"name":"أبو محمد","language":"ar","need":["استفسار عن البوتات وكيف بتشتغل","مطعم مندي واستفسار عن السعر والنطاق","رد على استفسارات المنيو واستقبال طلبات التوصيل فقط"],"_prov":{"name":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"language":{"source":"model","source_msg_id":"cfake000002","at":"2026-09-17T07:00:51.046Z","confirmed":true},"need":{"source":"model","source_msg_id":"cfake00000k","at":"2026-09-17T07:05:55.715Z","confirmed":true},"sector":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"city":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake000005","at":"2026-09-17T07:01:48.234Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000d","at":"2026-09-17T07:03:47.933Z","confirmed":true},"preferred_time":{"source":"model","source_msg_id":"cfake00000t","at":"2026-09-17T07:09:05.071Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000t","at":"2026-09-17T07:09:05.071Z","confirmed":true}},"version":6,"score":6,"sector":"restaurant","sector_text":"مطعم مندي","city":"إربد","interest":"hot","products":["karam"],"objections":["price","staff"],"preferred_time":{"text":"بكرة بعد العصر من 4 لحد 6"},"customer_numbers":["4","6"]}

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
    "need": [
      "استفسار عن البوتات وكيف بتشتغل",
      "مطعم مندي واستفسار عن السعر والنطاق",
      "رد على استفسارات المنيو واستقبال طلبات التوصيل فقط"
    ],
    "_prov": {
      "name": {
        "source": "model",
        "source_msg_id": "cfake000002",
        "at": "2026-09-17T07:00:51.046Z",
        "confirmed": true
      },
      "language": {
        "source": "model",
        "source_msg_id": "cfake000002",
        "at": "2026-09-17T07:00:51.046Z",
        "confirmed": true
      },
      "need": {
        "source": "model",
        "source_msg_id": "cfake00000k",
        "at": "2026-09-17T07:05:55.715Z",
        "confirmed": true
      },
      "sector": {
        "source": "model",
        "source_msg_id": "cfake000005",
        "at": "2026-09-17T07:01:48.234Z",
        "confirmed": true
      },
      "sector_text": {
        "source": "model",
        "source_msg_id": "cfake000005",
        "at": "2026-09-17T07:01:48.234Z",
        "confirmed": true
      },
      "city": {
        "source": "model",
        "source_msg_id": "cfake000005",
        "at": "2026-09-17T07:01:48.234Z",
        "confirmed": true
      },
      "interest": {
        "source": "model",
        "source_msg_id": "cfake000005",
        "at": "2026-09-17T07:01:48.234Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake000005",
        "at": "2026-09-17T07:01:48.234Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000d",
        "at": "2026-09-17T07:03:47.933Z",
        "confirmed": true
      },
      "preferred_time": {
        "source": "model",
        "source_msg_id": "cfake00000t",
        "at": "2026-09-17T07:09:05.071Z",
        "confirmed": true
      },
      "customer_numbers": {
        "source": "model",
        "source_msg_id": "cfake00000t",
        "at": "2026-09-17T07:09:05.071Z",
        "confirmed": true
      }
    },
    "version": 6,
    "score": 6,
    "sector": "restaurant",
    "sector_text": "مطعم مندي",
    "city": "إربد",
    "interest": "hot",
    "products": [
      "karam"
    ],
    "objections": [
      "price",
      "staff"
    ],
    "preferred_time": {
      "text": "بكرة بعد العصر من 4 لحد 6"
    },
    "customer_numbers": [
      "4",
      "6"
    ]
  },
  "booking": null,
  "calendarEvents": [],
  "calendarOps": [
    {
      "at": "2026-09-17T07:00:51.082Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:02:48.596Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:04:44.521Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:05:55.721Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:09:05.082Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:10:57.911Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    }
  ],
  "alerts": [
    "quote",
    "hot_lead",
    "meeting"
  ],
  "gemini": {
    "calls": 12,
    "failures": 2,
    "blocked": 0
  },
  "openrouter": {
    "calls": 11,
    "promptTokens": 16536,
    "completionTokens": 617,
    "cost": 0.01120024
  }
}
```

<details><summary>full workflow_data</summary>

```json
{
  "bot_turns": 10,
  "disclosed_at": "2026-09-17T07:00:51.046Z",
  "nudge": null,
  "questions_asked": 1,
  "msgs_since_interest": 2,
  "last_ask": null,
  "last_bot": {
    "stage": "captured",
    "next_step": "confirmed",
    "at": "2026-09-17T07:10:57.908Z",
    "action": "NONE"
  },
  "lead": {
    "name": "أبو محمد",
    "language": "ar",
    "need": [
      "استفسار عن البوتات وكيف بتشتغل",
      "مطعم مندي واستفسار عن السعر والنطاق",
      "رد على استفسارات المنيو واستقبال طلبات التوصيل فقط"
    ],
    "_prov": {
      "name": {
        "source": "model",
        "source_msg_id": "cfake000002",
        "at": "2026-09-17T07:00:51.046Z",
        "confirmed": true
      },
      "language": {
        "source": "model",
        "source_msg_id": "cfake000002",
        "at": "2026-09-17T07:00:51.046Z",
        "confirmed": true
      },
      "need": {
        "source": "model",
        "source_msg_id": "cfake00000k",
        "at": "2026-09-17T07:05:55.715Z",
        "confirmed": true
      },
      "sector": {
        "source": "model",
        "source_msg_id": "cfake000005",
        "at": "2026-09-17T07:01:48.234Z",
        "confirmed": true
      },
      "sector_text": {
        "source": "model",
        "source_msg_id": "cfake000005",
        "at": "2026-09-17T07:01:48.234Z",
        "confirmed": true
      },
      "city": {
        "source": "model",
        "source_msg_id": "cfake000005",
        "at": "2026-09-17T07:01:48.234Z",
        "confirmed": true
      },
      "interest": {
        "source": "model",
        "source_msg_id": "cfake000005",
        "at": "2026-09-17T07:01:48.234Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake000005",
        "at": "2026-09-17T07:01:48.234Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000d",
        "at": "2026-09-17T07:03:47.933Z",
        "confirmed": true
      },
      "preferred_time": {
        "source": "model",
        "source_msg_id": "cfake00000t",
        "at": "2026-09-17T07:09:05.071Z",
        "confirmed": true
      },
      "customer_numbers": {
        "source": "model",
        "source_msg_id": "cfake00000t",
        "at": "2026-09-17T07:09:05.071Z",
        "confirmed": true
      }
    },
    "version": 6,
    "score": 6,
    "sector": "restaurant",
    "sector_text": "مطعم مندي",
    "city": "إربد",
    "interest": "hot",
    "products": [
      "karam"
    ],
    "objections": [
      "price",
      "staff"
    ],
    "preferred_time": {
      "text": "بكرة بعد العصر من 4 لحد 6"
    },
    "customer_numbers": [
      "4",
      "6"
    ]
  },
  "needs_team": {
    "reason": "meeting",
    "summary": "بكرة بعد العصر من 4 لحد 6",
    "at": "2026-09-17T07:09:05.071Z",
    "resolved_at": null,
    "sla_note_sent_at": null,
    "claimed_at": null,
    "claimed_by": null
  },
  "validator_blocks": [
    {
      "at": "2026-09-17T07:06:52.263Z",
      "codes": [
        "dangling_colon"
      ],
      "attempt": 1
    }
  ],
  "capture_pending": null,
  "requested_time_change": null
}
```

</details>