import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Loader2, RefreshCw, Trash2, UserPlus } from 'lucide-react';

const STAFF_PERMISSIONS_INITIAL = {
  access_staff_tools: true,
  access_whatsapp_inbox: true,
  access_whatsapp_campaigns: true
};

const STAFF_PERMISSION_OPTIONS = [
  { key: 'access_staff_tools', label: 'أدوات الموظف (تشيك-إن/اشتراكات/حفلات اليوم)' },
  { key: 'access_whatsapp_inbox', label: 'واتساب - صندوق الوارد' },
  { key: 'access_whatsapp_campaigns', label: 'واتساب - الحملات' }
];

export default function StaffTab({ staffMembers = [], fetchStaffMembers, api }) {
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    staff_permissions: STAFF_PERMISSIONS_INITIAL
  });
  const [updatingId, setUpdatingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [error, setError] = useState('');

  const sortedStaffMembers = useMemo(
    () => [...staffMembers].sort((a, b) => (a.role === 'admin' ? 1 : 0) - (b.role === 'admin' ? 1 : 0)),
    [staffMembers]
  );

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name || !form.email || !form.password) {
      setError('يرجى تعبئة جميع الحقول');
      return;
    }
    setSaving(true);
    try {
      await api.post('/admin/staff', form);
      setForm({
        name: '',
        email: '',
        password: '',
        staff_permissions: STAFF_PERMISSIONS_INITIAL
      });
      setAdding(false);
      fetchStaffMembers();
    } catch (err) {
      setError(err?.response?.data?.error || 'فشل إضافة الموظف');
    } finally {
      setSaving(false);
    }
  };

  const togglePermission = (key) => {
    setForm((prev) => ({
      ...prev,
      staff_permissions: {
        ...prev.staff_permissions,
        [key]: !prev.staff_permissions[key]
      }
    }));
  };

  const updateStaffPermission = async (memberId, nextPermissions) => {
    setUpdatingId(memberId);
    setError('');
    try {
      await api.put(`/admin/staff/${memberId}/permissions`, { staff_permissions: nextPermissions });
      fetchStaffMembers();
    } catch (err) {
      setError(err?.response?.data?.error || 'فشل تحديث الصلاحيات');
    } finally {
      setUpdatingId('');
    }
  };

  const deleteStaff = async (memberId) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا الموظف؟')) return;
    setDeletingId(memberId);
    setError('');
    try {
      await api.delete(`/admin/staff/${memberId}`);
      fetchStaffMembers();
    } catch (err) {
      setError(err?.response?.data?.error || 'فشل حذف الموظف');
    } finally {
      setDeletingId('');
    }
  };

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>الموظفون / Staff Management</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchStaffMembers}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={() => { setAdding((v) => !v); setError(''); }}>
              <UserPlus className="h-4 w-4 ml-1" />
              إضافة موظف
            </Button>
          </div>
        </CardHeader>

        {adding && (
          <CardContent className="border-t pt-4">
            <form onSubmit={handleAdd} className="space-y-3 max-w-xl">
              <div>
                <Label>الاسم</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="اسم الموظف"
                />
              </div>
              <div>
                <Label>البريد الإلكتروني</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="email@example.com"
                  dir="ltr"
                />
              </div>
              <div>
                <Label>كلمة المرور</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="••••••••"
                  dir="ltr"
                />
              </div>

              <div className="space-y-2 pt-2">
                <Label>صلاحيات الوصول</Label>
                <div className="space-y-2">
                  {STAFF_PERMISSION_OPTIONS.map((option) => (
                    <label key={option.key} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(form.staff_permissions?.[option.key])}
                        onChange={() => togglePermission(option.key)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'حفظ'}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setAdding(false); setError(''); }}>
                  إلغاء
                </Button>
              </div>
            </form>
          </CardContent>
        )}

        <CardContent>
          {staffMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">لا يوجد موظفون مسجلون بعد</p>
          ) : (
            <div className="space-y-3">
              {sortedStaffMembers.map((member) => {
                const memberId = member.id || member._id;
                const memberPermissions = {
                  ...STAFF_PERMISSIONS_INITIAL,
                  ...(member.staff_permissions || {})
                };

                return (
                  <div key={memberId} className="p-3 rounded-xl bg-muted/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold">{member.name}</p>
                        <p className="text-sm text-muted-foreground" dir="ltr">{member.email}</p>
                        {member.created_at && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(member.created_at).toLocaleDateString('ar')}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={member.role === 'admin' ? 'default' : 'secondary'}>
                          {member.role === 'admin' ? 'مشرف' : 'موظف'}
                        </Badge>
                        {member.role === 'staff' && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => deleteStaff(memberId)}
                            disabled={deletingId === memberId}
                          >
                            {deletingId === memberId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </Button>
                        )}
                      </div>
                    </div>

                    {member.role === 'staff' && (
                      <div className="space-y-2 border-t pt-3">
                        {STAFF_PERMISSION_OPTIONS.map((option) => (
                          <label key={`${memberId}-${option.key}`} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(memberPermissions?.[option.key])}
                              onChange={() => {
                                const nextPermissions = {
                                  ...memberPermissions,
                                  [option.key]: !memberPermissions?.[option.key]
                                };
                                updateStaffPermission(memberId, nextPermissions);
                              }}
                              disabled={updatingId === memberId}
                            />
                            <span>{option.label}</span>
                          </label>
                        ))}
                        {updatingId === memberId && (
                          <p className="text-xs text-muted-foreground">...جاري تحديث الصلاحيات</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {error && !adding && <p className="text-sm text-red-500 mt-3">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
