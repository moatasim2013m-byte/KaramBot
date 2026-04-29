# Restaurant MVP Flow

## Customer Journey

```
Customer: "أريد طلب شاورما"
    Bot:  "أهلاً! نعم بالتأكيد 😊 شاورما دجاج أم لحم؟"

Customer: "دجاج، اثنتين"
    Bot:  "تم إضافة 2x شاورما دجاج 🛒
           سلتك: شاورما دجاج × 2 = 5.00 JOD
           هل تريد إضافة شيء آخر؟"

Customer: "لا، بس هيك"
    Bot:  "ممتاز! هل تريد توصيل أم ستستلم بنفسك؟"

Customer: "توصيل"
    Bot:  "أرسل لي عنوانك من فضلك"

Customer: "شارع الرشيد، عمارة 5"
    Bot:  "شكراً! العنوان: شارع الرشيد، عمارة 5
           شاورما دجاج × 2 = 5.00 JOD
           رسوم التوصيل: 1.50 JOD
           الإجمالي: 6.50 JOD
           هل تؤكد الطلب؟"

Customer: "تمام"
    Bot:  "✅ تم تأكيد طلبك! سنبدأ التحضير فوراً."
          → Order created in DB with status: confirmed
          → Appears in dashboard Orders tab
```

## Confirmation Words

The system accepts these as explicit confirmation:
`yes, يس, اه, آه, أكد, تأكيد, confirm, تمام, موافق, حسنا, صح, نعم, اوكي, okay, ok`

## Staff Dashboard Flow

1. New order appears in **Orders** page (auto-refreshes every 15s)
2. Staff clicks order to expand details
3. Staff updates status: Confirmed → Preparing → Ready → Out for Delivery → Delivered
4. If needed, staff can take over inbox conversation manually

## Handoff to Human

Triggers automatically when customer says:
`موظف, انسان, مدير, مشكلة, شكوى`

Staff sees conversation in Inbox with orange "موظف" badge.
Staff can re-enable AI anytime via the toggle in inbox.
