import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../../../components/ui/dialog';
import { Textarea } from '../../../components/ui/textarea';
import { Loader2, Trash2, Plus, Edit, Upload, Home, Image } from 'lucide-react';

const RAW_BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || '').trim();
const BACKEND_ORIGIN =
  !RAW_BACKEND_URL || RAW_BACKEND_URL === 'undefined' || RAW_BACKEND_URL === 'null'
    ? ''
    : RAW_BACKEND_URL.replace(/\/+$/, '');

const resolveMediaUrl = (url) => {
  if (!url) return '';
  if (/^(data:|blob:)/i.test(url)) return url;

  let normalizedUrl = String(url).trim();

  if (/^https?:\/\//i.test(normalizedUrl)) {
    try {
      const parsed = new URL(normalizedUrl);
      if (parsed.pathname.startsWith('/api/uploads/')) {
        normalizedUrl = `${parsed.pathname}${parsed.search}`;
      } else {
        return normalizedUrl;
      }
    } catch {
      return normalizedUrl;
    }
  }

  if (normalizedUrl.startsWith('/uploads/')) {
    normalizedUrl = `/api${normalizedUrl}`;
  }

  return `${BACKEND_ORIGIN}${normalizedUrl.startsWith('/') ? '' : '/'}${normalizedUrl}`;
};

export default function ContentTab(props) {
  const {
    gallery,
    handleDeleteMedia,
    mediaDialogOpen,
    setMediaDialogOpen,
    galleryPreview,
    setGalleryPreview,
    newMedia,
    setNewMedia,
    handleAddMedia,
    handleGalleryFileChange,
    uploadingImage,
    heroSettings,
    setHeroSettings,
    heroImagePreview,
    handleHeroImageChange,
    handleSaveHero,
    savingHero,
  } = props;

  const [subTab, setSubTab] = useState('gallery');
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div>
      {/* Sub-tab navigation */}
      <div className="flex gap-2 mb-6 border-b pb-3">
        <button
          className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${subTab === 'gallery' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'}`}
          onClick={() => setSubTab('gallery')}
        >
          المعرض
        </button>
        <button
          className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${subTab === 'homepage' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'}`}
          onClick={() => setSubTab('homepage')}
        >
          الصفحة الرئيسية
        </button>
      </div>

      {/* Gallery Tab */}
      {subTab === 'gallery' && (
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl">معرض الصور / Homepage Gallery</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">صور تظهر في الصفحة الرئيسية للعملاء</p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {gallery.map((item) => (
                <div key={item.id} className="relative rounded-xl overflow-hidden group">
                  {item.type === 'photo' ? (
                    <img src={item.url} alt={item.title} className="w-full h-32 object-cover" />
                  ) : (
                    <video src={item.url} className="w-full h-32 object-cover" />
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Button variant="destructive" size="icon" onClick={() => handleDeleteMedia(item.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-6 border-t flex justify-end">
              <Dialog open={mediaDialogOpen} onOpenChange={(open) => { setMediaDialogOpen(open); if (!open) { setGalleryPreview(null); setNewMedia({ url: '', type: 'photo', title: '', file: null }); } }}>
                <DialogTrigger asChild>
                  <Button className="rounded-full gap-2 px-6">
                    <Plus className="h-4 w-4" /> إضافة صورة / Add Media
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>إضافة صورة / Add Gallery Media</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleAddMedia} className="space-y-4">
                    <div>
                      <Label>رفع صورة / Upload Image</Label>
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={handleGalleryFileChange}
                        className="rounded-xl mt-1"
                        disabled={uploadingImage}
                      />
                      {galleryPreview && (
                        <img src={galleryPreview} alt="Preview" className="mt-2 h-32 w-full object-cover rounded-lg" />
                      )}
                    </div>
                    <div className="text-center text-sm text-muted-foreground">- أو / OR -</div>
                    <div>
                      <Label>رابط الصورة / URL (اختياري)</Label>
                      <Input value={newMedia.url} onChange={(e) => setNewMedia({...newMedia, url: e.target.value})} className="rounded-xl mt-1" placeholder="https://..." disabled={!!newMedia.file} />
                    </div>
                    <div>
                      <Label>النوع / Type</Label>
                      <Select value={newMedia.type} onValueChange={(v) => setNewMedia({...newMedia, type: v})}>
                        <SelectTrigger className="rounded-xl mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="photo">صورة / Photo</SelectItem>
                          <SelectItem value="video">فيديو / Video</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>العنوان / Title (اختياري)</Label>
                      <Input value={newMedia.title} onChange={(e) => setNewMedia({...newMedia, title: e.target.value})} className="rounded-xl mt-1" />
                    </div>
                    <Button type="submit" className="w-full rounded-full" disabled={uploadingImage}>
                      {uploadingImage ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      إضافة / Add Media
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Homepage Hero Tab */}
      {subTab === 'homepage' && (
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl flex items-center gap-2">
              <Home className="h-5 w-5" />
              الصفحة الرئيسية / Homepage Hero
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">تعديل محتوى وصورة البانر الرئيسي</p>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Hero Image Upload - Drag-and-drop zone */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">صورة البانر / Hero Image</Label>
              <div
                className={`relative border-2 border-dashed rounded-2xl min-h-[200px] flex flex-col items-center justify-center cursor-pointer transition-all p-6 ${isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary hover:bg-primary/5'}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files[0]; if (file) { handleHeroImageChange({ target: { files: [file] } }); } }}
                onClick={() => document.getElementById('hero-file-input').click()}
              >
                <Upload className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm font-medium">اسحب الصورة هنا أو اضغط للاختيار</p>
                <p className="text-xs text-muted-foreground mt-1">PNG, JPG, WebP · حجم أقصى 10MB</p>
                <input
                  id="hero-file-input"
                  type="file"
                  accept="image/*"
                  onChange={handleHeroImageChange}
                  className="hidden"
                  disabled={uploadingImage}
                />
              </div>
              {(heroImagePreview || heroSettings.hero_image) && (
                <div className="mt-4">
                  <p className="text-sm font-medium mb-2">معاينة الصورة الحالية:</p>
                  <img
                    src={heroImagePreview || resolveMediaUrl(heroSettings.hero_image)}
                    alt="Hero preview"
                    className="w-full max-h-48 object-cover rounded-xl border"
                  />
                </div>
              )}
            </div>

            {/* Hero Text Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>العنوان الرئيسي / Hero Title</Label>
                <Input
                  value={heroSettings.hero_title}
                  onChange={(e) => setHeroSettings({...heroSettings, hero_title: e.target.value})}
                  className="rounded-xl"
                  dir="rtl"
                  placeholder="حيث يلعب الأطفال ويحتفلون"
                />
              </div>
              <div className="space-y-2">
                <Label>نص الزر / CTA Button Text</Label>
                <Input
                  value={heroSettings.hero_cta_text}
                  onChange={(e) => setHeroSettings({...heroSettings, hero_cta_text: e.target.value})}
                  className="rounded-xl"
                  dir="rtl"
                  placeholder="احجز جلسة"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>الوصف / Hero Subtitle</Label>
              <Textarea
                value={heroSettings.hero_subtitle}
                onChange={(e) => setHeroSettings({...heroSettings, hero_subtitle: e.target.value})}
                className="rounded-xl min-h-[80px]"
                dir="rtl"
                placeholder="أفضل تجربة ملعب داخلي..."
              />
            </div>

            <div className="space-y-2">
              <Label>رابط الزر / CTA Route</Label>
              <Select
                value={heroSettings.hero_cta_route}
                onValueChange={(v) => setHeroSettings({...heroSettings, hero_cta_route: v})}
              >
                <SelectTrigger className="rounded-xl w-full md:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="/tickets">تذاكر بالساعة (/tickets)</SelectItem>
                  <SelectItem value="/birthday">حفلات أعياد الميلاد (/birthday)</SelectItem>
                  <SelectItem value="/subscriptions">الاشتراكات (/subscriptions)</SelectItem>
                  <SelectItem value="/register">إنشاء حساب (/register)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="pt-4 border-t">
              <Button
                onClick={handleSaveHero}
                disabled={savingHero}
                className="rounded-full gap-2 bg-primary"
              >
                {savingHero ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري الحفظ...
                  </>
                ) : (
                  <>
                    <Edit className="h-4 w-4" />
                    حفظ التغييرات / Save Changes
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
