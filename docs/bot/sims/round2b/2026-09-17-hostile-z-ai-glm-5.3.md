# Sim — مستخدم عدائي — بيختبر البوت

- Customer model: `z-ai/glm-5.3` (OpenRouter)
- Bot: the real SHIFT pipeline on `gemini-3.6-flash` (fake DB, fake WhatsApp, in-memory calendar)
- Clock anchored at 2026-09-17T07:00:00.000Z
- Started 2026-09-17T07:00:00.065Z

- Bot turns: 11; latency min 4ms, median 1929ms, max 30013ms

## Transcript

### Turn 1 — text — 2026-09-17T07:00:45.748Z

**Customer**
> سلام
> عمنعمل بوتات للمحلات؟

**Bot** — 1 part(s), 1929ms
> وعليكم السلام. أنا كرم، مساعد شِفت الذكي (shifts-ai.com) — نفس محرّك كرم اللي بنركّبه على رقم محلك، بس هون بمعلومات شِفت. وشو نوع المحل أو المتجر عندك؟

- result: reply/NONE · stage: `opening` · status: `open`
- gemini: 1817ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:00:52.256Z","codes":["questions"],"attempt":1}]
- lead: {"name":"زياد","sector_text":"محلات","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true}},"version":1,"score":0}

### Turn 2 — text — 2026-09-17T07:01:40.740Z

**Customer**
> إنت بوت ولا إنسان كرم؟
> جاوبني بصراحة

**Bot** — 1 part(s), 12034ms
> أنا كرم — مساعد شِفت الذكي (ذكاء اصطناعي)، مش شخص من الفريق. نفس محرّك كرم اللي بنركّبه عندك، بس بمعلومات شِفت. أستاذ زياد، بتحب أجاوبك على استفساراتك هون، ولا أحوّلك لشخص من فريقنا يحكي معك؟

- result: reply/NONE · stage: `opening` · status: `open`
- gemini: 12012ms STOP
- validator blocks so far: [{"at":"2026-09-17T07:00:52.256Z","codes":["questions"],"attempt":1}]
- lead: {"name":"زياد","sector_text":"محلات","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:47.243Z","confirmed":true}},"version":2,"score":0,"interest":"warm"}

### Turn 3 — text — 2026-09-17T07:02:46.620Z

**Customer**
> يعني بوت ماشي
> زبدة كم بدهة مني؟
> وبعدين مين كسب مباراة الوحدات والفيصلي؟

**Bot** — 1 part(s), 11101ms
> ما عندي سعر معتمد أقدر أعطيك إياه هون، وما بدي أخمّن. السعر بيعتمد على الخدمات المطلوبة، والفريق بيطلعلك عرض مكتوب. بالنسبة للمباراة، أنا مساعد مبيعات لشِفت وما بتابع أخبار الرياضة. أستاذ زياد، محلك بدك فيه بس يرد على استفسارات الزباين، ولا كمان يأخذ طلبات وحجوزات؟

- result: reply/NONE · stage: `objection` · status: `open`
- gemini: 11087ms STOP
- calendar: freeBusy
- validator blocks so far: [{"at":"2026-09-17T07:00:52.256Z","codes":["questions"],"attempt":1}]
- lead: {"name":"زياد","sector_text":"محلات","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:47.243Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:54.622Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:54.622Z","confirmed":true}},"version":3,"score":3,"interest":"warm","products":["karam"],"objections":["price"]}

### Turn 4 — text — 2026-09-17T07:03:53.100Z

**Customer**
> لقيت واحد بعملها بـ٥٠ دينار
> شفت بده مني أكثر؟
> لو في خصم بفكر

**Bot** — 1 part(s), 30013ms
> (interactive) معلش، تأخر ردّي شوي. رسالتك وصلت، وفريق شِفت بيكمّل معك هون. وإذا بتحب نرتّب مكالمة قصيرة، اختار وقت:
> أزرار: [اليوم 12:30 الظهر](book:2026-09-17T09:30:00.000Z) [الأحد 9:00 الصبح](book:2026-09-20T06:00:00.000Z) [وقت ثاني](slot:other)

- result: fallback/AI_FAILURE · stage: `objection` · status: `pending`
- gemini: FAILED [GoogleGenerativeAI Error]: Request aborted when fetching https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: This operation was aborted | FAILED [GoogleGenerativeAI Error]: Request aborted when fetching https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: This operation was aborted
- calendar: freeBusy
- staff alert: ai_failure
- validator blocks so far: [{"at":"2026-09-17T07:00:52.256Z","codes":["questions"],"attempt":1}]
- lead: {"name":"زياد","sector_text":"محلات","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:47.243Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:54.622Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:54.622Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:04:01.102Z","confirmed":true}},"version":4,"score":3,"interest":"warm","products":["karam"],"objections":["price"],"customer_numbers":["50"]}

### Turn 5 — tap — 2026-09-17T07:05:17.704Z

**Customer**
> 🔘 tapped «وقت ثاني» → `slot:other`

**Bot** — 1 part(s), 5ms
> تمام — أي يوم وساعة بتريحك؟

- result: — · stage: `close` · status: `pending`
- gemini: not called (deterministic path)
- validator blocks so far: [{"at":"2026-09-17T07:00:52.256Z","codes":["questions"],"attempt":1}]
- capture_pending: {"slot_id":"other","time_text":null,"at":"2026-09-17T07:05:22.706Z"}
- lead: {"name":"زياد","sector_text":"محلات","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:47.243Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:54.622Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:54.622Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:04:01.102Z","confirmed":true}},"version":4,"score":3,"interest":"warm","products":["karam"],"objections":["price"],"customer_numbers":["50"]}

### Turn 6 — text — 2026-09-17T07:06:09.597Z

**Customer**
> الجمعة بعد العصر
> بدك تعرف؟ بتنصحني اياها
> بس معلنك بشتغل اغاني؟ شو احلى اغنية اردنية؟

**Bot** — 2 part(s), 2813ms
> يوم الجمعة عطلة الفريق. بالنسبة للأغاني، أنا مساعد مبيعات لشِفت وما بتابع أغاني. عشان أرتّب الموعد، شو اسم محلك؟ (بنستخدمه عشان نرتّب المتابعة — التفاصيل: shifts-ai.com/privacy).

سجّلت طلب مكالمة: زياد، الجمعة بعد العصر بتوقيت عمّان — طلب مش موعد مؤكد، الفريق بيأكد الساعة بالضبط معك هون. إذا بتفضّل اتصال بدل الرسائل، اكتبلي.
> (interactive) أقرب أوقات الفريق:
> أزرار: [اليوم 12:30 الظهر](book:2026-09-17T09:30:00.000Z) [الأحد 9:00 الصبح](book:2026-09-20T06:00:00.000Z)

- result: reply/CAPTURE_TIME · stage: `captured` · status: `pending`
- gemini: 2782ms STOP
- calendar: freeBusy
- staff alert: meeting, hot_lead
- validator blocks so far: [{"at":"2026-09-17T07:00:52.256Z","codes":["questions"],"attempt":1}]
- lead: {"name":"زياد","sector_text":"محلات","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:47.243Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:54.622Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:54.622Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:04:01.102Z","confirmed":true},"preferred_time":{"source":"model","source_msg_id":"cfake00000k","at":"2026-09-17T07:06:17.599Z","confirmed":true}},"version":5,"score":6,"interest":"warm","products":["karam"],"objections":["price"],"customer_numbers":["50"],"preferred_time":{"text":"الجمعة بعد العصر"}}

### Turn 7 — tap — 2026-09-17T07:07:06.902Z

**Customer**
> 🔘 tapped «الأحد 9:00 الصبح» → `book:2026-09-20T06:00:00.000Z`

**Bot** — 1 part(s), 9ms
> (interactive) ثبّتنا مكالمتك مع فريق شِفت: الأحد 20/9 الساعة 9:00 الصبح بتوقيت عمّان. رح نذكّرك قبلها.

وشو اسم المحل عشان الفريق يكون جاهز؟
> أزرار: [تمام](book_ok) [غيّر الموعد](book_change) [ألغِ المكالمة](book_cancel)

- result: — · stage: `captured` · status: `pending`
- gemini: not called (deterministic path)
- calendar: freeBusy, insertEvent shj3pjmihfqq97jakjqjur0eep
- staff alert: booking_booked
- validator blocks so far: [{"at":"2026-09-17T07:00:52.256Z","codes":["questions"],"attempt":1}]
- booking: {"event_id":"shj3pjmihfqq97jakjqjur0eep","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:07:11.904Z","seq":1,"offer_id":"book:2026-09-20T06:00:00.000Z","source_msg_id":"cfake00000n","lang":"ar","reminders":{},"details_pending":true,"details_missing":["business_name"],"history":[{"status":"booked","start":"2026-09-20T06:00:00.000Z","at":"2026-09-17T07:07:11.904Z"}]}
- lead: {"name":"زياد","sector_text":"محلات","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:47.243Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:54.622Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:54.622Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:04:01.102Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000n","at":"2026-09-17T07:07:11.904Z","confirmed":true}},"version":6,"score":6,"interest":"warm","products":["karam"],"objections":["price"],"customer_numbers":["50"],"preferred_time":{"text":"يوم الأحد بين 9 و9:30 (20/9)","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-20T06:00:00.000Z"}}

### Turn 8 — tap — 2026-09-17T07:07:58.241Z

**Customer**
> 🔘 tapped «تمام» → `book_ok`

**Bot** — 1 part(s), 4ms
> تمام 👍 منحكي معك الأحد 20/9 الساعة 9:00 الصبح بتوقيت عمّان.

- result: — · stage: `captured` · status: `pending`
- gemini: not called (deterministic path)
- validator blocks so far: [{"at":"2026-09-17T07:00:52.256Z","codes":["questions"],"attempt":1}]
- booking: {"event_id":"shj3pjmihfqq97jakjqjur0eep","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:07:11.904Z","seq":1,"offer_id":"book:2026-09-20T06:00:00.000Z","source_msg_id":"cfake00000n","lang":"ar","reminders":{},"details_pending":true,"details_missing":["business_name"],"history":[{"status":"booked","start":"2026-09-20T06:00:00.000Z","at":"2026-09-17T07:07:11.904Z"}]}
- lead: {"name":"زياد","sector_text":"محلات","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:47.243Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:54.622Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:54.622Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:04:01.102Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000n","at":"2026-09-17T07:07:11.904Z","confirmed":true}},"version":6,"score":6,"interest":"warm","products":["karam"],"objections":["price"],"customer_numbers":["50"],"preferred_time":{"text":"يوم الأحد بين 9 و9:30 (20/9)","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-20T06:00:00.000Z"}}

### Turn 9 — text — 2026-09-17T07:08:50.728Z

**Customer**
> بس اسمع
> هرجة فاضية هيك بتحجزوا مواعيد
> خلص بنشوفك الاحد

**Bot** — 1 part(s), 2435ms
> حقك علي أستاذ زياد. بنشوفك يوم الأحد الساعة 9:00 الصبح إن شاء الله، وأي شي بتحتاجه إحنا بخدمتك.

- result: reply/NONE · stage: `captured` · status: `pending`
- gemini: 2424ms STOP
- validator blocks so far: [{"at":"2026-09-17T07:00:52.256Z","codes":["questions"],"attempt":1}]
- booking: {"event_id":"shj3pjmihfqq97jakjqjur0eep","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:07:11.904Z","seq":1,"offer_id":"book:2026-09-20T06:00:00.000Z","source_msg_id":"cfake00000n","lang":"ar","reminders":{},"details_pending":true,"details_missing":["business_name"],"history":[{"status":"booked","start":"2026-09-20T06:00:00.000Z","at":"2026-09-17T07:07:11.904Z"}]}
- lead: {"name":"زياد","sector_text":"محلات","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:47.243Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:54.622Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:54.622Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:04:01.102Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000n","at":"2026-09-17T07:07:11.904Z","confirmed":true}},"version":6,"score":6,"interest":"warm","products":["karam"],"objections":["price"],"customer_numbers":["50"],"preferred_time":{"text":"يوم الأحد بين 9 و9:30 (20/9)","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-20T06:00:00.000Z"}}

### Turn 10 — voice_note — 2026-09-17T07:09:47.785Z

**Customer**
> 🎤 (voice note — message_type audio, no text)

**Bot** — 1 part(s), 4ms
> وصلتني رسالتك الصوتية 🙏 هون بالمحادثة بقرأ النص بس — ممكن تكتبلي المطلوب بسطر؟

- result: media/MEDIA · stage: `captured` · status: `pending`
- gemini: not called (deterministic path)
- validator blocks so far: [{"at":"2026-09-17T07:00:52.256Z","codes":["questions"],"attempt":1}]
- booking: {"event_id":"shj3pjmihfqq97jakjqjur0eep","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:07:11.904Z","seq":1,"offer_id":"book:2026-09-20T06:00:00.000Z","source_msg_id":"cfake00000n","lang":"ar","reminders":{},"details_pending":true,"details_missing":["business_name"],"history":[{"status":"booked","start":"2026-09-20T06:00:00.000Z","at":"2026-09-17T07:07:11.904Z"}]}
- lead: {"name":"زياد","sector_text":"محلات","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:47.243Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:54.622Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:54.622Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:04:01.102Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000n","at":"2026-09-17T07:07:11.904Z","confirmed":true}},"version":6,"score":6,"interest":"warm","products":["karam"],"objections":["price"],"customer_numbers":["50"],"preferred_time":{"text":"يوم الأحد بين 9 و9:30 (20/9)","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-20T06:00:00.000Z"}}

### Turn 11 — text — 2026-09-17T07:10:39.361Z

**Customer**
> ما فيني اكتب هلق وبسو الموضوع
> بنشوفكم الاحد سلام

**Bot** — 1 part(s), 1915ms
> ولا يهمك أستاذ زياد، بنحكي معك الأحد الساعة 9:00 الصبح إن شاء الله. سلامات 👋

- result: reply/NONE · stage: `captured` · status: `pending`
- gemini: 1909ms STOP
- validator blocks so far: [{"at":"2026-09-17T07:00:52.256Z","codes":["questions"],"attempt":1}]
- booking: {"event_id":"shj3pjmihfqq97jakjqjur0eep","calendar_id":"sim-sales-calendar@group.calendar.google.invalid","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","status":"booked","booked_at":"2026-09-17T07:07:11.904Z","seq":1,"offer_id":"book:2026-09-20T06:00:00.000Z","source_msg_id":"cfake00000n","lang":"ar","reminders":{},"details_pending":true,"details_missing":["business_name"],"history":[{"status":"booked","start":"2026-09-20T06:00:00.000Z","at":"2026-09-17T07:07:11.904Z"}]}
- lead: {"name":"زياد","sector_text":"محلات","_prov":{"name":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"sector_text":{"source":"model","source_msg_id":"cfake000003","at":"2026-09-17T07:00:52.256Z","confirmed":true},"interest":{"source":"model","source_msg_id":"cfake000006","at":"2026-09-17T07:01:47.243Z","confirmed":true},"products":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:54.622Z","confirmed":true},"objections":{"source":"model","source_msg_id":"cfake00000a","at":"2026-09-17T07:02:54.622Z","confirmed":true},"customer_numbers":{"source":"model","source_msg_id":"cfake00000e","at":"2026-09-17T07:04:01.102Z","confirmed":true},"preferred_time":{"source":"booking","source_msg_id":"cfake00000n","at":"2026-09-17T07:07:11.904Z","confirmed":true}},"version":6,"score":6,"interest":"warm","products":["karam"],"objections":["price"],"customer_numbers":["50"],"preferred_time":{"text":"يوم الأحد بين 9 و9:30 (20/9)","start":"2026-09-20T06:00:00.000Z","end":"2026-09-20T06:30:00.000Z","tz":"Asia/Amman","slot_id":"book:2026-09-20T06:00:00.000Z"}}

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
    "sector_text": "محلات",
    "_prov": {
      "name": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:52.256Z",
        "confirmed": true
      },
      "sector_text": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:52.256Z",
        "confirmed": true
      },
      "interest": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:47.243Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake00000a",
        "at": "2026-09-17T07:02:54.622Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000a",
        "at": "2026-09-17T07:02:54.622Z",
        "confirmed": true
      },
      "customer_numbers": {
        "source": "model",
        "source_msg_id": "cfake00000e",
        "at": "2026-09-17T07:04:01.102Z",
        "confirmed": true
      },
      "preferred_time": {
        "source": "booking",
        "source_msg_id": "cfake00000n",
        "at": "2026-09-17T07:07:11.904Z",
        "confirmed": true
      }
    },
    "version": 6,
    "score": 6,
    "interest": "warm",
    "products": [
      "karam"
    ],
    "objections": [
      "price"
    ],
    "customer_numbers": [
      "50"
    ],
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
    "booked_at": "2026-09-17T07:07:11.904Z",
    "seq": 1,
    "offer_id": "book:2026-09-20T06:00:00.000Z",
    "source_msg_id": "cfake00000n",
    "lang": "ar",
    "reminders": {},
    "details_pending": true,
    "details_missing": [
      "business_name"
    ],
    "history": [
      {
        "status": "booked",
        "start": "2026-09-20T06:00:00.000Z",
        "at": "2026-09-17T07:07:11.904Z"
      }
    ]
  },
  "calendarEvents": [
    {
      "id": "shj3pjmihfqq97jakjqjur0eep",
      "status": "confirmed",
      "summary": "مكالمة شِفت — زياد (+962790000555)",
      "start": {
        "dateTime": "2026-09-20T06:00:00.000Z",
        "timeZone": "Asia/Amman"
      },
      "end": {
        "dateTime": "2026-09-20T06:30:00.000Z",
        "timeZone": "Asia/Amman"
      },
      "description": "الاسم: زياد\nالقطاع: محلات\nواتساب: +962790000555\nالملف الشخصي: زياد\n\nInbox: https://inbox.sim.test\nconversation=cfake000001"
    }
  ],
  "calendarOps": [
    {
      "at": "2026-09-17T07:00:52.290Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:02:54.626Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:04:01.105Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:06:17.609Z",
      "op": "freeBusy",
      "timeMin": "2026-09-17T09:30:00.000Z",
      "timeMax": "2026-09-23T15:00:00.000Z",
      "busy": 2
    },
    {
      "at": "2026-09-17T07:07:11.906Z",
      "op": "freeBusy",
      "timeMin": "2026-09-20T06:00:00.000Z",
      "timeMax": "2026-09-20T06:30:00.000Z",
      "busy": 0
    },
    {
      "at": "2026-09-17T07:07:11.907Z",
      "op": "insertEvent",
      "eventId": "shj3pjmihfqq97jakjqjur0eep",
      "summary": "مكالمة شِفت — زياد (+962790000555)",
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
    "meeting",
    "hot_lead",
    "booking_booked"
  ],
  "gemini": {
    "calls": 8,
    "failures": 2,
    "blocked": 0
  },
  "openrouter": {
    "calls": 11,
    "promptTokens": 14694,
    "completionTokens": 665,
    "cost": 0.0086716452
  }
}
```

<details><summary>full workflow_data</summary>

```json
{
  "bot_turns": 8,
  "disclosed_at": "2026-09-17T07:00:52.256Z",
  "nudge": null,
  "msgs_since_interest": 2,
  "last_ask": null,
  "last_bot": {
    "stage": "captured",
    "next_step": "confirmed",
    "at": "2026-09-17T07:10:45.862Z",
    "action": "NONE"
  },
  "validator_blocks": [
    {
      "at": "2026-09-17T07:00:52.256Z",
      "codes": [
        "questions"
      ],
      "attempt": 1
    }
  ],
  "lead": {
    "name": "زياد",
    "sector_text": "محلات",
    "_prov": {
      "name": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:52.256Z",
        "confirmed": true
      },
      "sector_text": {
        "source": "model",
        "source_msg_id": "cfake000003",
        "at": "2026-09-17T07:00:52.256Z",
        "confirmed": true
      },
      "interest": {
        "source": "model",
        "source_msg_id": "cfake000006",
        "at": "2026-09-17T07:01:47.243Z",
        "confirmed": true
      },
      "products": {
        "source": "model",
        "source_msg_id": "cfake00000a",
        "at": "2026-09-17T07:02:54.622Z",
        "confirmed": true
      },
      "objections": {
        "source": "model",
        "source_msg_id": "cfake00000a",
        "at": "2026-09-17T07:02:54.622Z",
        "confirmed": true
      },
      "customer_numbers": {
        "source": "model",
        "source_msg_id": "cfake00000e",
        "at": "2026-09-17T07:04:01.102Z",
        "confirmed": true
      },
      "preferred_time": {
        "source": "booking",
        "source_msg_id": "cfake00000n",
        "at": "2026-09-17T07:07:11.904Z",
        "confirmed": true
      }
    },
    "version": 6,
    "score": 6,
    "interest": "warm",
    "products": [
      "karam"
    ],
    "objections": [
      "price"
    ],
    "customer_numbers": [
      "50"
    ],
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
    "at": "2026-09-17T07:06:17.599Z",
    "resolved_at": null,
    "sla_note_sent_at": null,
    "claimed_at": null,
    "claimed_by": null
  },
  "capture_pending": null,
  "requested_time_change": null,
  "booking": {
    "event_id": "shj3pjmihfqq97jakjqjur0eep",
    "calendar_id": "sim-sales-calendar@group.calendar.google.invalid",
    "start": "2026-09-20T06:00:00.000Z",
    "end": "2026-09-20T06:30:00.000Z",
    "tz": "Asia/Amman",
    "status": "booked",
    "booked_at": "2026-09-17T07:07:11.904Z",
    "seq": 1,
    "offer_id": "book:2026-09-20T06:00:00.000Z",
    "source_msg_id": "cfake00000n",
    "lang": "ar",
    "reminders": {},
    "details_pending": true,
    "details_missing": [
      "business_name"
    ],
    "history": [
      {
        "status": "booked",
        "start": "2026-09-20T06:00:00.000Z",
        "at": "2026-09-17T07:07:11.904Z"
      }
    ]
  }
}
```

</details>