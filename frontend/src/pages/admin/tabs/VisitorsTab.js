import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../../../components/ui/dialog';
import { Loader2, Edit, Trash2, Plus, Eye, Ban, Check, Search, UserPlus, Gift } from 'lucide-react';
import { format } from 'date-fns';

export default function VisitorsTab(props) {
  const {
    // Users/Parents props
    users,
    expandedParent,
    handleExpandParent,
    loadingParent,
    parentDetails,
    setSelectedUser,
    setAdjustPointsDialogOpen,
    // Customers props
    customers,
    loadingCustomers,
    customerSearch,
    setCustomerSearch,
    customerDialogOpen,
    setCustomerDialogOpen,
    newCustomer,
    setNewCustomer,
    handleCreateCustomer,
    savingCustomer,
    handleToggleCustomerStatus,
    handleDeleteCustomer,
    setSelectedCustomer,
    fetchCustomerDetails,
    customerDetailsOpen,
    setCustomerDetailsOpen,
    customerDetails,
    setCustomerDetails,
    editingCustomer,
    setEditingCustomer,
    handleUpdateCustomer,
    editingChild,
    setEditingChild,
    handleUpdateChild,
    handleDeleteChild,
    newChild,
    setNewChild,
    handleAddChild,
  } = props;

  const [subTab, setSubTab] = useState('customers');

  return (
    <div>
      {/* Sub-tab navigation */}
      <div className="flex gap-2 mb-6 border-b pb-3">
        <button
          className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${subTab === 'customers' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'}`}
          onClick={() => setSubTab('customers')}
        >
          العملاء
        </button>
        <button
          className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${subTab === 'users' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'}`}
          onClick={() => setSubTab('users')}
        >
          الآباء
        </button>
      </div>

      {/* Customers Tab */}
      {subTab === 'customers' && (
        <>
          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                <div>
                  <CardTitle className="text-xl">إدارة العملاء</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">عرض وتعديل وإدارة بيانات العملاء</p>
                </div>
                <Dialog open={customerDialogOpen} onOpenChange={setCustomerDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="w-full sm:w-auto rounded-full gap-2">
                      <UserPlus className="h-4 w-4" /> إضافة عميل
                    </Button>
                  </DialogTrigger>
                  <DialogContent dir="rtl">
                    <DialogHeader>
                      <DialogTitle>إضافة عميل جديد</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleCreateCustomer} className="space-y-4">
                      <div>
                        <Label>الاسم *</Label>
                        <Input
                          value={newCustomer.name}
                          onChange={(e) => setNewCustomer({...newCustomer, name: e.target.value})}
                          className="rounded-xl mt-1"
                          required
                        />
                      </div>
                      <div>
                        <Label>البريد الإلكتروني *</Label>
                        <Input
                          type="email"
                          value={newCustomer.email}
                          onChange={(e) => setNewCustomer({...newCustomer, email: e.target.value})}
                          className="rounded-xl mt-1"
                          required
                        />
                      </div>
                      <div>
                        <Label>الهاتف</Label>
                        <Input
                          value={newCustomer.phone}
                          onChange={(e) => setNewCustomer({...newCustomer, phone: e.target.value})}
                          className="rounded-xl mt-1"
                          dir="ltr"
                        />
                      </div>
                      <Button type="submit" className="w-full rounded-full" disabled={savingCustomer}>
                        {savingCustomer ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
                        إضافة العميل
                      </Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="بحث بالاسم أو البريد أو الهاتف..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="pr-10 rounded-xl text-sm sm:text-base"
                />
              </div>

              {loadingCustomers ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : customers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">لا يوجد عملاء</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-right py-3 px-2 font-medium">الاسم</th>
                        <th className="text-right py-3 px-2 font-medium">الهاتف</th>
                        <th className="text-right py-3 px-2 font-medium">البريد</th>
                        <th className="text-center py-3 px-2 font-medium">الأطفال</th>
                        <th className="text-center py-3 px-2 font-medium">الحالة</th>
                        <th className="text-center py-3 px-2 font-medium">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.map((customer) => (
                        <tr key={customer.id} className="border-b hover:bg-muted/50">
                          <td className="py-3 px-2">{customer.name}</td>
                          <td className="py-3 px-2" dir="ltr">{customer.phone || '-'}</td>
                          <td className="py-3 px-2 text-xs">{customer.email}</td>
                          <td className="py-3 px-2 text-center">{customer.children_count}</td>
                          <td className="py-3 px-2 text-center">
                            <Badge variant={customer.is_disabled ? 'destructive' : 'default'} className="text-xs">
                              {customer.is_disabled ? 'معطّل' : 'نشط'}
                            </Badge>
                          </td>
                          <td className="py-3 px-2 text-center">
                            <div className="flex justify-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0"
                                onClick={() => { setSelectedCustomer(customer); fetchCustomerDetails(customer.id); }}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className={`h-8 w-8 p-0 ${customer.is_disabled ? 'text-green-600' : 'text-red-600'}`}
                                onClick={() => handleToggleCustomerStatus(customer.id)}
                              >
                                {customer.is_disabled ? <Check className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-red-600"
                                onClick={() => handleDeleteCustomer(customer.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Customer Details Dialog */}
          <Dialog open={customerDetailsOpen} onOpenChange={(open) => { setCustomerDetailsOpen(open); if (!open) { setCustomerDetails(null); setEditingChild(null); } }}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
              <DialogHeader>
                <DialogTitle>تفاصيل العميل</DialogTitle>
              </DialogHeader>
              {customerDetails && (
                <div className="space-y-6">
                  <div className="space-y-4 p-4 bg-muted/30 rounded-xl">
                    <h3 className="font-bold text-sm mb-3">بيانات العميل</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label>الاسم</Label>
                        <Input
                          value={editingCustomer?.name || ''}
                          onChange={(e) => setEditingCustomer({...editingCustomer, name: e.target.value})}
                          className="rounded-xl mt-1"
                        />
                      </div>
                      <div>
                        <Label>الهاتف</Label>
                        <Input
                          value={editingCustomer?.phone || ''}
                          onChange={(e) => setEditingCustomer({...editingCustomer, phone: e.target.value})}
                          className="rounded-xl mt-1"
                          dir="ltr"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label>البريد الإلكتروني</Label>
                        <Input
                          type="email"
                          value={editingCustomer?.email || ''}
                          onChange={(e) => setEditingCustomer({...editingCustomer, email: e.target.value})}
                          className="rounded-xl mt-1"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button onClick={handleUpdateCustomer} className="rounded-full" disabled={savingCustomer}>
                        {savingCustomer ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
                        حفظ التغييرات
                      </Button>
                      <Button
                        variant={customerDetails.customer.is_disabled ? 'default' : 'destructive'}
                        onClick={() => handleToggleCustomerStatus(customerDetails.customer.id)}
                        className="rounded-full"
                      >
                        {customerDetails.customer.is_disabled ? 'تفعيل' : 'تعطيل'}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => handleDeleteCustomer(customerDetails.customer.id)}
                        className="rounded-full"
                      >
                        <Trash2 className="h-4 w-4 ml-1" /> حذف العميل
                      </Button>
                    </div>
                  </div>

                  <div className="p-4 bg-blue-50 rounded-xl">
                    <h3 className="font-bold text-sm mb-3">ملخص الحجوزات</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                      <div className="bg-white p-3 rounded-lg">
                        <div className="text-2xl font-bold text-blue-600">{customerDetails.bookings_summary?.hourly_count || 0}</div>
                        <div className="text-xs text-muted-foreground">حجوزات ساعية</div>
                      </div>
                      <div className="bg-white p-3 rounded-lg">
                        <div className="text-2xl font-bold text-pink-600">{customerDetails.bookings_summary?.birthday_count || 0}</div>
                        <div className="text-xs text-muted-foreground">حفلات</div>
                      </div>
                      <div className="bg-white p-3 rounded-lg">
                        <div className="text-2xl font-bold text-green-600">{customerDetails.bookings_summary?.active_subscriptions || 0}</div>
                        <div className="text-xs text-muted-foreground">اشتراكات نشطة</div>
                      </div>
                      <div className="bg-white p-3 rounded-lg">
                        <div className="text-2xl font-bold text-yellow-600">{customerDetails.customer?.loyalty_points || 0}</div>
                        <div className="text-xs text-muted-foreground">نقاط الولاء</div>
                      </div>
                    </div>
                    {customerDetails.bookings_summary?.last_booking_date && (
                      <p className="text-xs text-muted-foreground mt-3">
                        آخر حجز: {format(new Date(customerDetails.bookings_summary.last_booking_date), 'yyyy-MM-dd')}
                      </p>
                    )}
                  </div>

                  <div className="p-4 bg-yellow-50 rounded-xl">
                    <h3 className="font-bold text-sm mb-3">الأطفال ({customerDetails.children?.length || 0})</h3>
                    <div className="space-y-2">
                      {customerDetails.children?.map((child) => (
                        <div key={child.id} className="flex items-center justify-between bg-white p-3 rounded-lg">
                          {editingChild?.id === child.id ? (
                            <div className="flex-1 flex items-center gap-2">
                              <Input
                                value={editingChild.name}
                                onChange={(e) => setEditingChild({...editingChild, name: e.target.value})}
                                className="rounded-lg h-8 text-sm"
                                placeholder="الاسم"
                              />
                              <Input
                                type="date"
                                value={editingChild.birthday?.split('T')[0] || ''}
                                onChange={(e) => setEditingChild({...editingChild, birthday: e.target.value})}
                                className="rounded-lg h-8 text-sm w-36"
                              />
                              <Button size="sm" className="h-8" onClick={() => handleUpdateChild(child.id)}>
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingChild(null)}>
                                <span className="h-3 w-3">✕</span>
                              </Button>
                            </div>
                          ) : (
                            <>
                              <div>
                                <span className="font-medium">{child.name}</span>
                                <span className="text-xs text-muted-foreground mr-2">
                                  ({format(new Date(child.birthday), 'yyyy-MM-dd')})
                                </span>
                              </div>
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingChild({ id: child.id, name: child.name, birthday: child.birthday })}>
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600" onClick={() => handleDeleteChild(child.id)}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                    <form onSubmit={handleAddChild} className="mt-3 flex items-end gap-2">
                      <div className="flex-1">
                        <Label className="text-xs">اسم الطفل</Label>
                        <Input
                          value={newChild.name}
                          onChange={(e) => setNewChild({...newChild, name: e.target.value})}
                          className="rounded-lg h-9 text-sm"
                          placeholder="اسم الطفل"
                          required
                        />
                      </div>
                      <div>
                        <Label className="text-xs">تاريخ الميلاد</Label>
                        <Input
                          type="date"
                          value={newChild.birthday}
                          onChange={(e) => setNewChild({...newChild, birthday: e.target.value})}
                          className="rounded-lg h-9 text-sm w-36"
                          required
                        />
                      </div>
                      <Button type="submit" size="sm" className="h-9 rounded-lg">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </form>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* Users/Parents Tab */}
      {subTab === 'users' && (
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
                                    {child.birthday && <p className="text-muted-foreground">🎂 {format(new Date(child.birthday), 'yyyy-MM-dd')} (العمر: {new Date().getFullYear() - new Date(child.birthday).getFullYear()} سنة)</p>}
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
      )}
    </div>
  );
}
