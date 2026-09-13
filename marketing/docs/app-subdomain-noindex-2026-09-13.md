# إصلاح أرشفة `app.shifts-ai.store` — 2026-09-13

## الحالة
| البند | الحالة |
|---|---|
| الإصلاح مكتوب ومجرّب على قناة معاينة | ✅ |
| النشر على الموقع الحقيقي (live) | ✅ 2026-09-13 — النسخة `2f37e5f43e7a3174` |
| التحقق بعد النشر | ✅ (النتائج أدناه) |

## نتيجة التحقق على الموقع الحقيقي (2026-09-13 10:06 UTC)
```
app.shifts-ai.store/robots.txt       200  text/plain  "Disallow: /"   x-robots-tag: noindex, nofollow
app.shifts-ai.store/                 200  text/html                   x-robots-tag: noindex, nofollow
app.shifts-ai.store/login            200  text/html                   x-robots-tag: noindex, nofollow
app.shifts-ai.store/nonexistent-xyz  200  text/html                   x-robots-tag: noindex, nofollow
app.shifts-ai.store/health           200  {"status":"ok"}
app.shifts-ai.store/assets/*.js      200  application/javascript
POST app.shifts-ai.store/api/auth/login (جسم فارغ)  400  ← الـ API يستقبل الطلبات
shifts-ai.store/                     200  بدون x-robots-tag   ← الموقع التعريفي لم يتأثر
shifts-ai.store/robots.txt           Allow: / + Sitemap        ← لم يتأثر
karambots.com/                       200  بدون x-robots-tag   ← لم يتأثر
karambot run.app/health (webhook)    200  ok                   ← لم يتأثر
```

## المشكلة
`app.shifts-ai.store` هو لوحة التحكم، وكان مفتوحاً لمحركات البحث:

```
/robots.txt        200  text/html   ← صفحة HTML بدل ملف robots
/                  200  text/html   ← بدون noindex
/nonexistent-xyz   200  text/html   ← أي رابط وهمي يرجع 200 (soft-404)
X-Robots-Tag:      غير موجود
```

جوجل يقرأ هذا على أنه «لا يوجد robots.txt، ازحف على كل شيء»، فيجد عدداً لا نهائياً
من الصفحات المكررة. هذا قد يضعف ثقة جوجل بالنطاق كله، ومنه الموقع الأساسي `shifts-ai.store`.

## اكتشاف غيّر الخطة
التقدير السابق كان أن `app.` مربوط مباشرة على Cloud Run، وهذا **غير صحيح**:

| النطاق | يمرّ عبر | الدليل |
|---|---|---|
| `app.shifts-ai.store` | Firebase Hosting (الموقع `shifts-ai-app`) ← Cloud Run `karambot` | `CNAME → shifts-ai-app.web.app`، وترويسات `x-served-by` و`vary: x-fh-requested-host` |
| `karambots.com` | Cloud Run مباشرة (domain mapping) | `gcloud beta run domain-mappings list` |

لذلك الإصلاح يتم **في إعدادات الاستضافة**:
- **لا** يحتاج نشر خدمة واتساب `karambot`.
- **لا** يؤثّر على `karambots.com`.
- **لا** يغيّر رابط الـ webhook.

## ما الذي يتغير
السكربت: `marketing/deploy_app_noindex.py`

- ملف ثابت `/robots.txt`:
  ```
  User-agent: *
  Disallow: /
  ```
- ترويسة `X-Robots-Tag: noindex, nofollow` على كل ردّ.
- توجيه `**` إلى Cloud Run `karambot` (europe-west1) **كما هو تماماً**.
- ترويسة `Cache-Control` الخاصة بـ `/assets/**` كما هي.

## نتيجة التجربة على المعاينة
القناة: `https://shifts-ai-app--noindex-test-aa9f8abc.web.app` (مدتها 24 ساعة)، النسخة `d6c0468eadb797ea`

```
/robots.txt        200  text/plain   "User-agent: * / Disallow: /"
/                  200  text/html    التطبيق يعمل
/login             200  text/html    التطبيق يعمل
/health            200  {"status":"ok"}
```

ملاحظة: قنوات المعاينة تضيف `X-Robots-Tag: noindex` بنفسها، فالتحقق من أن ترويستنا
تصل فعلاً إلى ردود Cloud Run يتم على الموقع الحقيقي بعد النشر.

## النشر (المالك)
```
python3 marketing/deploy_app_noindex.py live
```

### التحقق بعد النشر
```
curl -sI https://app.shifts-ai.store/robots.txt   # 200 text/plain
curl -s  https://app.shifts-ai.store/robots.txt   # Disallow: /
curl -sI https://app.shifts-ai.store/login        # x-robots-tag: noindex, nofollow
curl -s  https://app.shifts-ai.store/health       # {"status":"ok"}
curl -sI https://shifts-ai.store/                 # 200 و بدون x-robots-tag
curl -sI https://karambots.com/                   # 200 و بدون تغيير
```

### التراجع
يُعاد إطلاق النسخة السابقة `sites/shifts-ai-app/versions/0ed8681cf6d96bff`:
```
TOKEN=$(gcloud auth print-access-token)
curl -X POST -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: karam-bot" \
  "https://firebasehosting.googleapis.com/v1beta1/sites/shifts-ai-app/releases?versionName=sites/shifts-ai-app/versions/0ed8681cf6d96bff"
```

---

## ⚠️ تنبيه: الدمج على `main` ينشر خدمة واتساب تلقائياً

### ماذا يعني هذا
في مشروع `karam-bot` يوجد Cloud Build trigger:

```
الاسم:   cloudrun-karambot-europe-west1-moatasim2013m-byte-KaramBot-mrqg
المستودع: moatasim2013m-byte/KaramBot
الشرط:   push إلى الفرع main
```

**أي دمج أو push إلى `main`** يعمل تلقائياً وبدون أي سؤال:
1. يبني صورة Docker جديدة من الكود.
2. ينشرها على `karambot`، وهي نفس الخدمة التي تستقبل رسائل واتساب من Meta وترد على العملاء.

### ما حدث فعلاً
| الوقت (UTC) | الحدث |
|---|---|
| 2026-09-12 20:58:17 | دمج PR #16 (شغل الموقع التعريفي) |
| 2026-09-12 20:58:21 | بدأ البناء `26096c25…` على commit الدمج `4122c32` |
| 2026-09-12 21:00:41 | نُشرت النسخة `karambot-00050-gpm` وتستقبل 100% من الزيارات |

الخدمة شغالة (`/health` = ok في 2026-09-13). لكن PR #16 كان عن الموقع التعريفي
في الأساس، ومع ذلك نزل على خدمة الإنتاج بدون فحص.

### لماذا يهم
- الـ repo **لا يحتوي أي CI أو اختبارات** قبل الدمج. لو دخل خطأ في `backend/`، يصل مباشرة
  إلى البوت الذي يرد على العملاء.
- حتى تغيير في `marketing/` وحده يعيد بناء ونشر `karambot`، لأن البناء يستخدم الـ repo
  كاملاً (`docker build -f backend/Dockerfile .`).

### القرار (2026-09-13): **إبقاؤه كما هو**
المالك اختار الخيار 1. الـ trigger لم يُعدَّل. لذلك قبل أي دمج على `main` يجب التعامل معه كنشر
لخدمة الإنتاج `karambot`.

الخيارات التي عُرضت:
1. **إبقاؤه كما هو**، مع العلم أن كل دمج يساوي نشر. ← المُختار
2. **تقييد الـ trigger بالمسارات** (`includedFiles: backend/**`) حتى لا يعيد تغيير
   `marketing/` نشر البوت.
3. **جعل الـ trigger يدوياً أو بموافقة** (Cloud Build: "Require approval").
