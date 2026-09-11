# روابط الإعلانات — shifts-ai.store

كل رابط يفتح الصفحة على قطاع الإعلان مباشرة (`?b=`) ويحمل مصدر الحملة (`utm_*`).
عند ضغط زر واتساب يُضاف إلى نهاية الرسالة سطر قصير مثل «(المصدر: fb/karam-clinics)»،
فتعرف من المحادثة نفسها أي إعلان جلبها — حتى قبل أن تنظر إلى لوحة الإعلانات.

قواعد التسمية (ثابتة، بالإنجليزية الصغيرة، بلا مسافات):
- `utm_source`: `fb` (فيسبوك/إنستغرام عبر Meta) · `google` · `ig` إن كان منشورًا عضويًّا على إنستغرام
- `utm_medium`: `paid` للإعلان المموّل · `post` للمنشور العادي
- `utm_campaign`: `karam-<sector>` — `karam-clinics` · `karam-restaurants` · `karam-stores`
- `utm_content`: اسم الإعلان/التصميم للتمييز بين نسخ الحملة نفسها، مثل `night-scene` أو `v2`

## Meta (فيسبوك وإنستغرام) — إعلانات مموّلة

| القطاع | الرابط |
|---|---|
| العيادات | `https://shifts-ai.store/?b=clinic&utm_source=fb&utm_medium=paid&utm_campaign=karam-clinics` |
| المطاعم والكافيهات | `https://shifts-ai.store/?b=restaurant&utm_source=fb&utm_medium=paid&utm_campaign=karam-restaurants` |
| المتاجر الإلكترونية | `https://shifts-ai.store/?b=store&utm_source=fb&utm_medium=paid&utm_campaign=karam-stores` |

في Meta Ads Manager يمكنك بدل كتابة `utm_content` يدويًّا وضع هذا في حقل **URL parameters** للإعلان:
`utm_source=fb&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}`
(مع إبقاء `?b=<sector>` في رابط الموقع نفسه). وسمِّ الحملات في Ads Manager بالأسماء أعلاه
(`karam-clinics` …) حتى تبقى الرسائل والتقارير متطابقة.

## Google Ads

| القطاع | الرابط النهائي (Final URL) |
|---|---|
| العيادات | `https://shifts-ai.store/?b=clinic` |
| المطاعم والكافيهات | `https://shifts-ai.store/?b=restaurant` |
| المتاجر الإلكترونية | `https://shifts-ai.store/?b=store` |

وفي إعدادات الحملة ← **Final URL suffix**:
`utm_source=google&utm_medium=paid&utm_campaign={_campaign}&utm_content={creative}`
(Google تُضيف `gclid` تلقائيًّا؛ الصفحة تلتقطه أيضًا.) عرّف متغيّر `{_campaign}` في Custom parameters
بقيمة `karam-clinics` / `karam-restaurants` / `karam-stores`.

## منشورات عضوية (بلا تمويل)

| القطاع | الرابط |
|---|---|
| العيادات | `https://shifts-ai.store/?b=clinic&utm_source=fb&utm_medium=post&utm_campaign=karam-clinics` |
| المطاعم والكافيهات | `https://shifts-ai.store/?b=restaurant&utm_source=fb&utm_medium=post&utm_campaign=karam-restaurants` |
| المتاجر الإلكترونية | `https://shifts-ai.store/?b=store&utm_source=fb&utm_medium=post&utm_campaign=karam-stores` |

## ما يُقاس (بعد إضافة معرّفات Pixel وGA4)

| ما يفعله الزائر | Meta | GA4 | Google Ads |
|---|---|---|---|
| يفتح الصفحة | PageView | page_view | — |
| يضغط أي زر واتساب | **Lead** + Contact | **generate_lead** | **تحويل** (WhatsApp lead) |
| يختار قطاعًا / يشغّل تجربة | ViewContent | select_content | — |
| يضيف منتجًا إلى باقته | AddToWishlist | add_to_wishlist | — |

**حدث التحسين في Meta:** اختر **Lead** عند إنشاء الحملة (هدف Leads أو Sales ← Website).
**التحويل الأساسي في Google Ads:** «WhatsApp lead».

> ملاحظة صادقة: «Lead» هنا يعني *ضغطة* على زر واتساب، لا رسالة أُرسلت فعلًا — واتساب لا يُبلغ الموقع
> إن أرسل الزائر الرسالة أم لا. قارن عدد الـ Leads بعدد المحادثات الفعلية التي وصلت (سطر «(المصدر: …)» يساعدك)
> لتعرف نسبة من يُكمل.

## فحص قبل إطلاق أي حملة
1. افتح الرابط على جوالك ← تأكّد أن الصفحة فتحت على القطاع الصحيح.
2. اضغط زر واتساب ← تأكّد أن الرسالة تنتهي بـ «(المصدر: fb/karam-…)».
3. في Meta Events Manager ← Test events: يجب أن يظهر PageView ثم Lead.
4. في GA4 ← Realtime: يجب أن يظهر generate_lead.
