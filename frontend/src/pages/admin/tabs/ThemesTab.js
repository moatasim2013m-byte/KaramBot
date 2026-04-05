import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { Badge } from '../../../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Edit, Trash2, Star, Loader2, Sparkles, Upload } from 'lucide-react';

const resolveMediaUrl = (url) => {
  if (!url) return '';
  if (/^(data:|blob:|https?:\/\/)/i.test(url)) return url;
  const normalized = String(url).trim();
  if (normalized.startsWith('/uploads/')) return `/api${normalized}`;
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

const emptyTheme = { name: '', name_ar: '', description: '', description_ar: '', price: '', image_url: '' };

export default function ThemesTab({ themes, setThemes, api }) {
  const [themeDialogOpen, setThemeDialogOpen] = useState(false);
  const [editingTheme, setEditingTheme] = useState(null);
  const [form, setForm] = useState(emptyTheme);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

  // AI generation dialog state
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiPreviewUrl, setAiPreviewUrl] = useState('');

  const refreshThemes = async () => {
    try {
      const res = await api.get('/admin/themes');
      setThemes(res.data.themes || []);
    } catch {
      toast.error('فشل تحميل الثيمات');
    }
  };

  const openCreateDialog = () => {
    setEditingTheme(null);
    setForm(emptyTheme);
    setThemeDialogOpen(true);
  };

  const openEditDialog = (theme) => {
    setEditingTheme(theme);
    setForm({
      name: theme.name || '',
      name_ar: theme.name_ar || '',
      description: theme.description || '',
      description_ar: theme.description_ar || '',
      price: theme.price?.toString() || '',
      image_url: theme.image_url || '',
    });
    setThemeDialogOpen(true);
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error('يجب أن تكون الصورة PNG أو JPG أو WebP');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('حجم الصورة يجب أن يكون أقل من 10MB');
      return;
    }
    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const response = await api.post('/admin/upload-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setForm((prev) => ({ ...prev, image_url: response.data.image_url }));
      toast.success('تم رفع الصورة');
    } catch {
      toast.error('فشل رفع الصورة');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSavingTheme(true);
    try {
      const payload = { ...form, price: parseFloat(form.price) };
      if (editingTheme) {
        const res = await api.put(`/admin/themes/${editingTheme.id}`, payload);
        setThemes((prev) => prev.map((t) => (t.id === editingTheme.id ? res.data.theme : t)));
        toast.success('تم تحديث الثيم');
      } else {
        const res = await api.post('/admin/themes', payload);
        setThemes((prev) => [res.data.theme, ...prev]);
        toast.success('تم إنشاء الثيم');
      }
      setThemeDialogOpen(false);
      setEditingTheme(null);
      setForm(emptyTheme);
    } catch {
      toast.error('فشل حفظ الثيم');
    } finally {
      setSavingTheme(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا الثيم؟')) return;
    try {
      await api.delete(`/admin/themes/${id}`);
      setThemes((prev) => prev.filter((t) => t.id !== id));
      toast.success('تم حذف الثيم');
    } catch {
      toast.error('فشل حذف الثيم');
    }
  };

  const handleTogglePopular = async (theme) => {
    setTogglingId(theme.id);
    try {
      const res = await api.put(`/admin/themes/${theme.id}`, {
        is_most_popular: !theme.is_most_popular,
      });
      setThemes((prev) => prev.map((t) => (t.id === theme.id ? res.data.theme : t)));
    } catch {
      toast.error('فشل تحديث الثيم');
    } finally {
      setTogglingId(null);
    }
  };

  const handleAiGenerate = async () => {
    if (aiPrompt.trim().length < 10) {
      toast.error('النص يجب أن يكون 10 أحرف على الأقل');
      return;
    }
    setAiGenerating(true);
    setAiPreviewUrl('');
    try {
      const res = await api.post('/themes/ai-generate', { prompt: aiPrompt });
      setAiPreviewUrl(res.data.imageUrl || '');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'فشل توليد الصورة');
    } finally {
      setAiGenerating(false);
    }
  };

  const handleUseAiImage = () => {
    if (!aiPreviewUrl) return;
    setForm((prev) => ({ ...prev, image_url: aiPreviewUrl }));
    setAiDialogOpen(false);
    setAiPrompt('');
    setAiPreviewUrl('');
    toast.success('تم استخدام الصورة المولّدة');
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-xl">ثيمات أعياد الميلاد / Birthday Themes</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">إدارة ثيمات الحفلات المتاحة للعملاء</p>
            </div>
            <Button className="rounded-full gap-2 px-6" onClick={openCreateDialog}>
              <Plus className="h-4 w-4" /> إضافة ثيم
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {themes.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">لا توجد ثيمات بعد</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {themes.map((theme) => (
                <Card key={theme.id} className="rounded-xl overflow-hidden">
                  {theme.image_url && (
                    <img
                      src={resolveMediaUrl(theme.image_url)}
                      alt={theme.name}
                      className="w-full h-40 object-cover"
                    />
                  )}
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold truncate">{theme.name}</h3>
                        {theme.name_ar && (
                          <p className="text-sm text-muted-foreground truncate" dir="rtl">
                            {theme.name_ar}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1 flex-shrink-0 ms-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title={theme.is_most_popular ? 'إلغاء الأكثر شعبية' : 'تعيين كالأكثر شعبية'}
                          onClick={() => handleTogglePopular(theme)}
                          disabled={togglingId === theme.id}
                        >
                          {togglingId === theme.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Star
                              className={`h-4 w-4 ${theme.is_most_popular ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`}
                            />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEditDialog(theme)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => handleDelete(theme.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {theme.is_most_popular && (
                      <Badge variant="secondary" className="mb-2 text-yellow-600 bg-yellow-50 border-yellow-200">
                        ⭐ الأكثر شعبية
                      </Badge>
                    )}
                    {theme.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{theme.description}</p>
                    )}
                    <p className="text-accent font-bold mt-2">{theme.price} JD</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Theme Dialog */}
      <Dialog
        open={themeDialogOpen}
        onOpenChange={(open) => {
          setThemeDialogOpen(open);
          if (!open) {
            setEditingTheme(null);
            setForm(emptyTheme);
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTheme ? 'تعديل الثيم / Edit Theme' : 'إضافة ثيم / Add Theme'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>الاسم (EN)</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="rounded-xl mt-1"
                  required
                />
              </div>
              <div>
                <Label>الاسم (AR)</Label>
                <Input
                  value={form.name_ar}
                  onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
                  className="rounded-xl mt-1"
                  dir="rtl"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>الوصف (EN)</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="rounded-xl mt-1"
                  rows={3}
                />
              </div>
              <div>
                <Label>الوصف (AR)</Label>
                <Textarea
                  value={form.description_ar}
                  onChange={(e) => setForm({ ...form, description_ar: e.target.value })}
                  className="rounded-xl mt-1"
                  dir="rtl"
                  rows={3}
                />
              </div>
            </div>
            <div>
              <Label>السعر (JD)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className="rounded-xl mt-1"
                required
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>صورة الثيم</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full gap-1 text-xs"
                  onClick={() => setAiDialogOpen(true)}
                >
                  <Sparkles className="h-3 w-3" />
                  توليد بالذكاء الاصطناعي
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-2 border rounded-xl px-3 py-2 hover:bg-muted transition-colors">
                    <Upload className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {uploadingImage ? 'جارٍ الرفع…' : 'اختر صورة'}
                    </span>
                  </div>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleImageUpload}
                    className="hidden"
                    disabled={uploadingImage}
                  />
                </label>
              </div>
              {form.image_url && (
                <img
                  src={resolveMediaUrl(form.image_url)}
                  alt="معاينة"
                  className="mt-2 h-24 w-full object-cover rounded-xl"
                />
              )}
            </div>
            <Button
              type="submit"
              className="w-full rounded-full"
              disabled={savingTheme || uploadingImage}
            >
              {savingTheme && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingTheme ? 'تحديث / Update' : 'إنشاء / Create'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* AI Image Generation Dialog */}
      <Dialog
        open={aiDialogOpen}
        onOpenChange={(open) => {
          setAiDialogOpen(open);
          if (!open) {
            setAiPrompt('');
            setAiPreviewUrl('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              توليد صورة بالذكاء الاصطناعي
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>وصف الصورة المطلوبة</Label>
              <Textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="مثال: ثيم حفلة أميرة باللون الوردي مع نجوم ذهبية وبالونات..."
                className="rounded-xl mt-1"
                rows={3}
                dir="rtl"
              />
              <p className="text-xs text-muted-foreground mt-1">بين 10 و 300 حرف</p>
            </div>
            <Button
              className="w-full rounded-full gap-2"
              onClick={handleAiGenerate}
              disabled={aiGenerating || aiPrompt.trim().length < 10}
            >
              {aiGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {aiGenerating ? 'جارٍ التوليد…' : 'توليد الصورة'}
            </Button>
            {aiPreviewUrl && (
              <div className="space-y-3">
                <img
                  src={resolveMediaUrl(aiPreviewUrl)}
                  alt="صورة مولّدة"
                  className="w-full rounded-xl object-cover max-h-60"
                />
                <Button
                  className="w-full rounded-full gap-2"
                  variant="secondary"
                  onClick={handleUseAiImage}
                >
                  استخدام هذه الصورة
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
