import { useEffect, useState } from 'react';
import { Panel, Ltr } from '../../components/shared/Primitives';
import api from '../../utils/api';

/**
 * Platform settings — SHIFT's own configuration, not a business's.
 *
 * Deliberately read-only for now: the values that matter (app id, config id, Graph version)
 * are served by the backend from environment and Secret Manager, and editing them here would
 * mean writing secrets from a browser. What this page is for is answering "what is this
 * deployment actually pointed at" without opening a terminal.
 */
export default function PlatformSettingsPage() {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/whatsapp/embedded-signup/config')
      .then((res) => setConfig(res.data))
      .catch(() => setError('تعذّر تحميل إعدادات المنصة'));
  }, []);

  const rows = [
    ['تطبيق Meta', config?.app_id],
    ['إعداد تسجيل الدخول', config?.config_id],
    ['إصدار واجهة Graph', config?.graph_version],
  ];

  return (
    <div className="space-y-4 max-w-[900px]">
      <div>
        <h1 className="text-lg font-bold text-gray-900">إعدادات المنصة</h1>
        <p className="text-xs text-gray-500 mt-0.5">إعدادات شِفت نفسها — لا تخصّ أي حساب شركة</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

      <Panel title="اتصال WhatsApp Business">
        <dl className="divide-y divide-gray-50">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between px-4 h-10">
              <dt className="text-[13px] text-gray-600">{label}</dt>
              <dd className="text-[13px] text-gray-900"><Ltr className="font-mono text-xs">{value || '—'}</Ltr></dd>
            </div>
          ))}
        </dl>
      </Panel>

      <p className="text-[11px] text-gray-400 px-1">
        الأسرار (رمز التطبيق، رمز التحقق) تُقرأ من Secret Manager وقت التشغيل ولا تظهر هنا أبدًا.
      </p>
    </div>
  );
}
