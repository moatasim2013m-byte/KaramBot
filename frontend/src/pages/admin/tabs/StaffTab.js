import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Gift, Loader2 } from 'lucide-react';

export default function StaffTab(props) {
  const {
    users,
    expandedParent,
    handleExpandParent,
    loadingParent,
    parentDetails,
    setSelectedUser,
    setAdjustPointsDialogOpen,
  } = props;

  return (
    <div>
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>الآباء / Parents</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {users.map((user) => (
              <div key={user.id} className="rounded-xl bg-muted/50 overflow-hidden">
                <div
                  className="flex justify-between items-center p-3 cursor-pointer hover:bg-muted/70"
                  onClick={() => handleExpandParent(user.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${expandedParent === user.id ? 'bg-primary' : 'bg-muted-foreground'}`} />
                    <div>
                      <p className="font-semibold">{user.name}</p>
                      <p className="text-sm text-muted-foreground">{user.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-bold text-secondary">{user.loyalty_points} pts</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedUser(user);
                        setAdjustPointsDialogOpen(true);
                      }}
                    >
                      <Gift className="h-4 w-4 mr-1" /> Adjust
                    </Button>
                  </div>
                </div>

                {expandedParent === user.id && (
                  <div className="p-4 border-t bg-white">
                    {loadingParent ? (
                      <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
                    ) : parentDetails ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <h4 className="font-bold mb-2">معلومات الوالد / Parent Info</h4>
                          <p className="text-sm"><span className="text-muted-foreground">الاسم:</span> {parentDetails.user?.name}</p>
                          <p className="text-sm"><span className="text-muted-foreground">البريد:</span> {parentDetails.user?.email}</p>
                          <p className="text-sm"><span className="text-muted-foreground">تاريخ التسجيل:</span> {parentDetails.user?.created_at ? new Date(parentDetails.user.created_at).toLocaleDateString('ar') : '-'}</p>
                          <p className="text-sm mt-2"><span className="text-muted-foreground">الحجوزات:</span> {(parentDetails.hourly_bookings?.length || 0) + (parentDetails.birthday_bookings?.length || 0)}</p>
                          <p className="text-sm"><span className="text-muted-foreground">الاشتراكات:</span> {parentDetails.subscriptions?.length || 0}</p>
                        </div>
                        <div>
                          <h4 className="font-bold mb-2">الأطفال / Children ({parentDetails.children?.length || 0})</h4>
                          {parentDetails.children?.length > 0 ? (
                            <div className="space-y-2">
                              {parentDetails.children.map(child => (
                                <div key={child.id} className="p-2 rounded bg-muted/50 text-sm">
                                  <p className="font-semibold">{child.name}</p>
                                  {child.date_of_birth && <p className="text-muted-foreground">العمر: {new Date().getFullYear() - new Date(child.date_of_birth).getFullYear()} سنة</p>}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">لا يوجد أطفال مسجلين</p>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
