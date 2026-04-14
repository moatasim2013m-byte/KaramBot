import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Badge } from '../../../components/ui/badge';
import { toast } from 'sonner';

const INITIAL_FORM = {
  name: '',
  description: '',
  template_name: '',
  language_code: 'ar',
  audience_type: 'all',
  tags: '',
  segment: '',
  import_batch_id: '',
  components_json: '[]'
};

const getApiErrorMessage = (error, fallback = 'حدث خطأ') =>
  error?.response?.data?.error || error?.message || fallback;

export default function MarketingTab({ api }) {
  const [contacts, setContacts] = useState([]);
  const [imports, setImports] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignRecipients, setCampaignRecipients] = useState({});
  const [expandedCampaign, setExpandedCampaign] = useState('');
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ q: '', has_whatsapp_opt_in: 'all', is_opted_out: 'all' });
  const [campaignForm, setCampaignForm] = useState(INITIAL_FORM);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [previewCount, setPreviewCount] = useState(null);

  const refreshAll = async () => {
    try {
      setLoading(true);
      const [contactsRes, importsRes, campaignsRes] = await Promise.all([
        api.get('/admin/marketing/contacts', { params: { limit: 50, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v && v !== 'all')) } }),
        api.get('/admin/marketing/imports'),
        api.get('/admin/marketing/campaigns', { params: { limit: 30 } })
      ]);
      setContacts(contactsRes.data.items || []);
      setImports(importsRes.data.items || []);
      setCampaigns(campaignsRes.data.items || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'تعذر تحميل بيانات التسويق'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const importOptions = useMemo(() => imports.map((item) => ({ id: item._id, label: `${item.original_filename} (${item.total_rows || 0})` })), [imports]);

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      const form = new FormData();
      form.append('file', file);
      await api.post('/admin/marketing/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('تم استيراد الملف بنجاح');
      await refreshAll();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'فشل استيراد الملف'));
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handleCreateCampaign = async (e) => {
    e.preventDefault();
    let components = [];
    try {
      components = JSON.parse(campaignForm.components_json || '[]');
      if (!Array.isArray(components)) throw new Error('components_json must be array');
    } catch (_error) {
      toast.error('صيغة مكونات القالب JSON غير صحيحة');
      return;
    }

    const audienceFilter = {
      tags: campaignForm.tags,
      segment: campaignForm.segment,
      import_batch_id: campaignForm.import_batch_id || null
    };

    try {
      setSavingCampaign(true);
      await api.post('/admin/marketing/campaigns', {
        name: campaignForm.name,
        description: campaignForm.description,
        template_name: campaignForm.template_name,
        language_code: campaignForm.language_code,
        template_components: components,
        audience_type: campaignForm.audience_type,
        audience_filter: audienceFilter
      });
      toast.success('تم إنشاء الحملة');
      setCampaignForm(INITIAL_FORM);
      setPreviewCount(null);
      await refreshAll();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'فشل إنشاء الحملة'));
    } finally {
      setSavingCampaign(false);
    }
  };

  const previewAudience = async () => {
    try {
      const response = await api.get('/admin/marketing/campaigns/preview/count', {
        params: {
          audience_type: campaignForm.audience_type,
          tags: campaignForm.tags,
          segment: campaignForm.segment,
          import_batch_id: campaignForm.import_batch_id
        }
      });
      setPreviewCount(Number(response.data.total || 0));
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'تعذر احتساب المعاينة'));
    }
  };

  const queueCampaign = async (campaignId) => {
    try {
      await api.post(`/admin/marketing/campaigns/${campaignId}/queue`);
      toast.success('تمت جدولة الحملة');
      await refreshAll();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'تعذر جدولة الحملة'));
    }
  };

  const toggleOptOut = async (contact) => {
    try {
      if (contact.whatsapp_opted_out_at) {
        await api.post(`/admin/marketing/contacts/${contact._id}/opt-in`);
      } else {
        await api.post(`/admin/marketing/contacts/${contact._id}/opt-out`);
      }
      await refreshAll();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'تعذر تحديث حالة الاشتراك'));
    }
  };

  const loadRecipients = async (campaignId) => {
    try {
      const response = await api.get(`/admin/marketing/campaigns/${campaignId}/recipients`, { params: { limit: 40 } });
      setCampaignRecipients((prev) => ({ ...prev, [campaignId]: response.data.items || [] }));
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'تعذر تحميل المستلمين'));
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>استيراد جهات اتصال التسويق</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input type="file" accept=".csv,.xlsx" onChange={handleImport} disabled={uploading} />
          <p className="text-sm text-muted-foreground">CSV مدعوم بالكامل. XLSX مدعوم إذا كانت مكتبة القراءة متوفرة على الخادم.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>إنشاء حملة واتساب</CardTitle></CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 md:grid-cols-2 gap-3" onSubmit={handleCreateCampaign}>
            <div><Label>اسم الحملة</Label><Input value={campaignForm.name} onChange={(e) => setCampaignForm((p) => ({ ...p, name: e.target.value }))} required /></div>
            <div><Label>اسم القالب المعتمد</Label><Input value={campaignForm.template_name} onChange={(e) => setCampaignForm((p) => ({ ...p, template_name: e.target.value }))} required /></div>
            <div><Label>نوع الجمهور</Label>
              <Select value={campaignForm.audience_type} onValueChange={(value) => setCampaignForm((p) => ({ ...p, audience_type: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الجهات</SelectItem>
                  <SelectItem value="tags">حسب الوسوم/التصنيف</SelectItem>
                  <SelectItem value="imported_batch">حسب دفعة استيراد</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>اللغة</Label><Input value={campaignForm.language_code} onChange={(e) => setCampaignForm((p) => ({ ...p, language_code: e.target.value }))} /></div>
            <div><Label>وسوم</Label><Input value={campaignForm.tags} onChange={(e) => setCampaignForm((p) => ({ ...p, tags: e.target.value }))} placeholder="vip,new" /></div>
            <div><Label>تصنيف</Label><Input value={campaignForm.segment} onChange={(e) => setCampaignForm((p) => ({ ...p, segment: e.target.value }))} placeholder="daycare" /></div>
            <div>
              <Label>دفعة الاستيراد</Label>
              <Select value={campaignForm.import_batch_id || 'none'} onValueChange={(value) => setCampaignForm((p) => ({ ...p, import_batch_id: value === 'none' ? '' : value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون</SelectItem>
                  {importOptions.map((opt) => <SelectItem key={opt.id} value={opt.id}>{opt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2"><Label>وصف</Label><Input value={campaignForm.description} onChange={(e) => setCampaignForm((p) => ({ ...p, description: e.target.value }))} /></div>
            <div className="md:col-span-2"><Label>Template Components JSON</Label><Textarea value={campaignForm.components_json} onChange={(e) => setCampaignForm((p) => ({ ...p, components_json: e.target.value }))} rows={5} /></div>
            <div className="md:col-span-2 flex gap-2">
              <Button type="button" variant="outline" onClick={previewAudience}>معاينة الجمهور</Button>
              {previewCount !== null && <Badge>المتوقع: {previewCount}</Badge>}
              <Button type="submit" disabled={savingCampaign}>{savingCampaign ? 'جارٍ الحفظ...' : 'إنشاء حملة'}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>جهات الاتصال</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="بحث بالاسم/الرقم" value={filters.q} onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))} />
            <Button variant="outline" onClick={refreshAll} disabled={loading}>تحديث</Button>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-right border-b"><th>الاسم</th><th>الرقم</th><th>Opt-in</th><th>Opt-out</th><th>إجراء</th></tr></thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr key={contact._id} className="border-b">
                    <td>{contact.full_name || '-'}</td>
                    <td dir="ltr">{contact.normalized_wa_id}</td>
                    <td>{contact.has_whatsapp_opt_in ? 'نعم' : 'لا'}</td>
                    <td>{contact.whatsapp_opted_out_at ? 'نعم' : 'لا'}</td>
                    <td><Button size="sm" variant="outline" onClick={() => toggleOptOut(contact)}>{contact.whatsapp_opted_out_at ? 'إلغاء إيقاف' : 'إيقاف'}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>الحملات</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {campaigns.map((campaign) => (
            <div key={campaign._id} className="p-3 border rounded-lg">
              <div className="flex justify-between items-center gap-2">
                <div>
                  <div className="font-semibold">{campaign.name}</div>
                  <div className="text-xs text-muted-foreground">{campaign.template_name} · {campaign.status} · {campaign.total_recipients || 0}</div>
                </div>
                <div className="flex gap-2">
                  {campaign.status === 'draft' && <Button size="sm" onClick={() => queueCampaign(campaign._id)}>Queue</Button>}
                  <Button size="sm" variant="outline" onClick={async () => { setExpandedCampaign(campaign._id); await loadRecipients(campaign._id); }}>Recipients</Button>
                </div>
              </div>
              {expandedCampaign === campaign._id && (
                <div className="mt-2 text-xs space-y-1">
                  {(campaignRecipients[campaign._id] || []).map((item) => (
                    <div key={item._id} className="flex justify-between border-b py-1">
                      <span>{item.marketing_contact_id?.full_name || item.normalized_wa_id}</span>
                      <Badge variant="outline">{item.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
