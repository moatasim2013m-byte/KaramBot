import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Loader2, RefreshCw, UserPlus } from 'lucide-react';

export default function StaffTab({ staffMembers = [], fetchStaffMembers, api }) {
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');

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
      setForm({ name: '', email: '', password: '' });
      setAdding(false);
      fetchStaffMembers();
    } catch (err) {
      setError(err?.response?.data?.error || 'فشل إضافة الموظف');
    } finally {
      setSaving(false);
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
            <form onSubmit={handleAdd} className="space-y-3 max-w-sm">
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
              {staffMembers.map((member) => (
                <div key={member.id || member._id} className="flex items-center justify-between p-3 rounded-xl bg-muted/50">
                  <div>
                    <p className="font-semibold">{member.name}</p>
                    <p className="text-sm text-muted-foreground" dir="ltr">{member.email}</p>
                    {member.created_at && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(member.created_at).toLocaleDateString('ar')}
                      </p>
                    )}
                  </div>
                  <Badge variant={member.role === 'admin' ? 'default' : 'secondary'}>
                    {member.role === 'admin' ? 'مشرف' : 'موظف'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
