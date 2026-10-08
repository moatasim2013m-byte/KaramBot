import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Link2, CreditCard, Receipt, Send, Pause, Settings, Route as RouteIcon } from 'lucide-react';
import api from '../../utils/api';
import { fixFor, waLine, waLink } from './operatorView';

/**
 * The one fix button an attention row earns (operatorView.RULES), doing the fix where it can:
 *
 * - «راسله» opens WhatsApp to the owner with an Arabic line written for that rule.
 * - «اربط معه» opens the account's «الحالة», where SHIFT runs the attended connect.
 * - «أكّد البطاقة» confirms the payment card at Meta in place (the owner already said «أضفت»).
 * - «سجّل دفعة» opens «الاشتراكات والدفعات» with this shop's payment drawer open.
 * - «أعد إرسال الرابط» issues a new join link and opens WhatsApp with it, as the board does.
 * - «أوقف البوت مؤقتًا» asks for the reason the log needs, then pauses; the inbox keeps working.
 *
 * `owner` is {first_name, phone} from the fleet row, when there is one.
 */

const BTN = 'inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 h-7 text-[12px] text-gray-700 hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap';

const ICON = {
  message: MessageCircle, connect_with: Link2, confirm_card: CreditCard, record_payment: Receipt,
  resend_link: Send, pause_bot: Pause, platform_settings: Settings, open_onboarding: RouteIcon,
};

export default function FixButton({ item, owner, onDone, onNotice }) {
  const [busy, setBusy] = useState(false);
  const fix = fixFor(item);
  if (!fix) return null;
  const Icon = ICON[fix.kind] || MessageCircle;
  const id = item.account_id;
  const say = (tone, text) => onNotice && onNotice({ tone, text });
  const stop = (e) => e.stopPropagation();

  if (fix.kind === 'message') {
    const href = waLink(owner?.phone, waLine(item.rule, item.name, owner?.first_name));
    if (!href) {
      return <Link to={`/admin/accounts/${id}?tab=access`} onClick={stop} className={BTN} title="لا يوجد موبايل لصاحب المحل"><Icon size={12} /> {fix.label}</Link>;
    }
    return <a href={href} target="_blank" rel="noopener noreferrer" onClick={stop} className={BTN}><Icon size={12} /> {fix.label}</a>;
  }
  if (fix.kind === 'connect_with') {
    return <Link to={`/admin/accounts/${id}?tab=health`} onClick={stop} className={BTN}><Icon size={12} /> {fix.label}</Link>;
  }
  if (fix.kind === 'record_payment') {
    return <Link to={`/admin/billing?pay=${encodeURIComponent(id)}`} onClick={stop} className={BTN}><Icon size={12} /> {fix.label}</Link>;
  }
  if (fix.kind === 'platform_settings') {
    return <Link to="/admin/settings" onClick={stop} className={BTN}><Icon size={12} /> {fix.label}</Link>;
  }
  if (fix.kind === 'open_onboarding') {
    return <Link to="/admin/onboarding" onClick={stop} className={BTN}><Icon size={12} /> {fix.label}</Link>;
  }

  const run = async (e) => {
    stop(e);
    if (fix.kind === 'confirm_card') {
      if (!window.confirm(`تأكيد أن بطاقة الدفع مضافة عند Meta لـ${item.name || 'هذا المحل'}؟ تأكّد منها في WhatsApp Manager أولًا.`)) return;
      setBusy(true);
      try {
        await api.patch(`/admin/accounts/${id}/payment-method`, { payment_method_ok: true });
        say('ok', `أُكّدت بطاقة ${item.name || 'المحل'}.`);
        onDone?.();
      } catch (err) { say('error', err.response?.data?.error || 'تعذّر تأكيد البطاقة'); }
      finally { setBusy(false); }
      return;
    }
    if (fix.kind === 'resend_link') {
      // Opened inside the click, pointed at wa.me once the server answers: no popup blocker eats it.
      const tab = window.open('', '_blank');
      if (tab) tab.opener = null;
      setBusy(true);
      try {
        const res = await api.post(`/admin/accounts/${id}/join-link`);
        if (res.data?.wa_share_url && tab) tab.location.href = res.data.wa_share_url;
        else if (tab) tab.close();
        api.post(`/admin/accounts/${id}/events`, { type: 'invite_shared' }).catch(() => {});
        say('ok', `رابط جديد لـ${item.name || 'المحل'} — الرابط السابق لم يعد يعمل.`);
        onDone?.();
      } catch (err) {
        if (tab) tab.close();
        say('error', err.response?.data?.error || 'تعذّر إصدار رابط جديد');
      } finally { setBusy(false); }
      return;
    }
    if (fix.kind === 'pause_bot') {
      // The reason goes into the shop's log for whoever looks next, so it is required.
      const reason = window.prompt(`سبب إيقاف بوت ${item.name || 'المحل'} مؤقتًا؟ (رسائل الزبائن تبقى تصل لصندوق المحل)`, item.text || '');
      if (!reason || !reason.trim()) return;
      setBusy(true);
      try {
        await api.patch(`/admin/accounts/${id}/bot`, { enabled: false, reason: reason.trim().slice(0, 300) });
        say('ok', `أُوقف بوت ${item.name || 'المحل'} مؤقتًا.`);
        onDone?.();
      } catch (err) { say('error', err.response?.data?.error || 'تعذّر إيقاف البوت'); }
      finally { setBusy(false); }
    }
  };

  return (
    <button type="button" onClick={run} disabled={busy} className={BTN}>
      <Icon size={12} /> {busy ? 'جارٍ…' : fix.label}
    </button>
  );
}
