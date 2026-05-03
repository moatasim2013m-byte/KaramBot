import { useMemo, useState } from "react";

const QUICK_REPLIES = [
  {
    question: "👋 ترحيب",
    localAnswer:
      "أهلًا وسهلًا فيكم في بيكابو 💛 صالة ألعاب داخلية وداي كير للأطفال في إربد من عمر سنة إلى 10 سنوات. جاهزين نساعدكم فورًا في الأسعار، الباقات، الموقع، الدوام، والحجز."
  },
  {
    question: "ساعات الدوام",
    localAnswer: "نستقبلكم يوميًا من 10:00 صباحًا إلى 11:00 مساءً، ويومي الخميس والجمعة حتى 12:00 منتصف الليل. للاستفسار: 0777775652."
  },
  {
    question: "الموقع",
    localAnswer:
      "العنوان: إربد، شارع الشهيد وصفي التل (شارع أبو راشد)، مجمع السيف التجاري، الطابق الثاني، بجانب وحشة سنتر، مقابل مطعم عرفة. 📞 0777775652"
  },
  {
    question: "الأسعار",
    localAnswer:
      "الأسعار: ساعة واحدة متوفرة، وساعتين بـ 10 دنانير. حفلات أعياد الميلاد تبدأ من 90 دينار وتصل إلى 250 دينار. اشتراكات متوفرة: 250، 200، 150، 99، 79 دينار."
  },
  {
    question: "الباقات",
    localAnswer:
      "باقات الاشتراك: 149 دينار (نصف يوم)، 199 دينار (يوم كامل)، 250 دينار (الباقة الشاملة)، 99 دينار (12 زيارة)، 79 دينار (8 زيارات). إضافة منطقة الرمل لأي باقة: 20 دينار."
  },
  {
    question: "المناطق والأعمار",
    localAnswer:
      "المناطق المتوفرة: 1) المنطقة الرئيسية (1-10 سنوات). أقل من 3 سنوات مع مرافق واحد، والمرافق الإضافي 3 دنانير. 2) Day Care (1-4 سنوات) بإشراف مختص وبدون مرافق داخل المنطقة. 3) منطقة الرمل (1-10 سنوات). ومتوفرة جلسات مريحة للأهالي مع كافيه ومتابعة الأطفال أثناء اللعب."
  },
  {
    question: "ليش بيكابو مميز؟",
    localAnswer:
      "ليش بيكابو مميز؟ ✅ بيئة آمنة. ✅ تعلم عن طريق اللعب. ✅ فريق مختصات تربية. ✅ خدمة انتظار بعد المدرسة. ✅ خدمة توصيل مقابل 40 دينار للاتجاه الواحد."
  },
  {
    question: "الحجز",
    localAnswer: "للحجز والاستفسار السريع تواصلوا معنا على 0777775652، أو احجزوا من الموقع وسيقوم الفريق بتأكيد الحجز."
  }
];

const RAW_API_URL = (process.env.REACT_APP_BACKEND_URL || "").trim();

const normalizeBackendOrigin = (rawUrl) => {
  if (!rawUrl || rawUrl === "undefined" || rawUrl === "null") return "";
  const sanitized = rawUrl.replace(/\/+$/, "");
  return sanitized.replace(/\/api$/i, "");
};

export default function FaqBotWidget() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([
    { role: "bot", text: "مرحبًا 👋 أنا مساعد بيكابو. اكتب سؤالك أو اختر سؤالًا سريعًا وسأساعدك فورًا." }
  ]);
  const [loading, setLoading] = useState(false);

  const apiBase = useMemo(() => {
    const origin = normalizeBackendOrigin(RAW_API_URL);
    return origin ? `${origin}/api` : "/api";
  }, []);

  const isSmallScreen = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
  const widgetOffsetBottom = isSmallScreen
    ? "calc(env(safe-area-inset-bottom, 0px) + 18px)"
    : "calc(env(safe-area-inset-bottom, 0px) + 22px)";
  const widgetOffsetSide = isSmallScreen ? "14px" : "20px";

  const askQuestion = async (questionText) => {
    if (!questionText || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: questionText }]);
    setLoading(true);

    try {
      const response = await fetch(`${apiBase}/bot/faq?q=${encodeURIComponent(questionText)}`);
      const data = await response.json();
      setMessages((prev) => [...prev, { role: "bot", text: data.answer || "ما قدرت ألقى جواب الآن." }]);
    } catch (error) {
      setMessages((prev) => [...prev, { role: "bot", text: "حصل خطأ بسيط. حاول مرة ثانية بعد قليل." }]);
    } finally {
      setLoading(false);
      setQuestion("");
    }
  };

  const handleQuickReplyClick = (reply) => {
    if (!reply || loading) return;

    if (reply.localAnswer) {
      setMessages((prev) => [
        ...prev,
        { role: "user", text: reply.question },
        { role: "bot", text: reply.localAnswer }
      ]);
      return;
    }

    askQuestion(reply.question);
  };

  const onSubmit = (event) => {
    event.preventDefault();
    askQuestion(question.trim());
  };

  return (
    <div style={{ position: "fixed", bottom: widgetOffsetBottom, right: widgetOffsetSide, zIndex: 900 }} dir="rtl">
      {open && (
        <div
          style={{
            width: isSmallScreen ? "min(92vw, 300px)" : "320px",
            maxHeight: isSmallScreen ? "min(62vh, 390px)" : "420px",
            background: "#fff",
            borderRadius: "14px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.16)",
            overflow: "hidden",
            marginBottom: "10px",
            border: "1px solid #eee"
          }}
        >
          <div style={{ background: "#6d28d9", color: "#fff", padding: "12px", fontWeight: 700 }}>مساعد الأسئلة السريعة</div>

          <div style={{ padding: "12px", maxHeight: "230px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                style={{
                  alignSelf: message.role === "user" ? "flex-start" : "flex-end",
                  background: message.role === "user" ? "#ede9fe" : "#f3f4f6",
                  color: "#111827",
                  borderRadius: "10px",
                  padding: "8px 10px",
                  fontSize: "14px",
                  lineHeight: 1.5,
                  maxWidth: "85%"
                }}
              >
                {message.text}
              </div>
            ))}
            {loading && <div style={{ fontSize: "13px", color: "#6b7280" }}>جاري تجهيز الرد...</div>}
          </div>

          <div style={{ padding: "10px", borderTop: "1px solid #f0f0f0", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {QUICK_REPLIES.map((reply) => (
              <button
                key={reply.question}
                type="button"
                onClick={() => handleQuickReplyClick(reply)}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: "999px",
                  background: "#fff",
                  cursor: "pointer",
                  padding: "6px 10px",
                  fontSize: "13px"
                }}
              >
                {reply.question}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} style={{ padding: "10px", borderTop: "1px solid #f5f5f5", display: "flex", gap: "8px" }}>
            <input
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="اكتب سؤالك هنا..."
              disabled={loading}
              style={{
                flex: 1,
                border: "1px solid #ddd",
                borderRadius: "10px",
                padding: "8px 10px",
                fontSize: "13px"
              }}
            />
            <button
              type="submit"
              disabled={loading || !question.trim()}
              style={{
                border: "none",
                borderRadius: "10px",
                background: loading || !question.trim() ? "#ddd" : "#6d28d9",
                color: "#fff",
                cursor: loading || !question.trim() ? "not-allowed" : "pointer",
                padding: "8px 12px",
                fontSize: "13px",
                fontWeight: 600
              }}
            >
              إرسال
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          width: isSmallScreen ? "46px" : "54px",
          height: isSmallScreen ? "46px" : "54px",
          borderRadius: "50%",
          border: "none",
          background: "#6d28d9",
          color: "#fff",
          fontSize: isSmallScreen ? "20px" : "23px",
          cursor: "pointer",
          boxShadow: "0 6px 16px rgba(109,40,217,0.28)"
        }}
        aria-label="فتح مساعد الأسئلة"
        title="مساعد الأسئلة"
      >
        ؟
      </button>
    </div>
  );
}
