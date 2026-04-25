import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../../../components/ui/dialog';
import { Loader2, Edit, Trash2, Plus } from 'lucide-react';
import { format } from 'date-fns';

export default function BookingsTab(props) {
  const {
    activeFilter,
    getFilteredHourlyBookings,
    getFilteredBirthdayBookings,
    getFilteredSubscriptions,
    getStatusBadge,
    formatSessionTimer,
    paymentMethodLabel,
    handleActivateHourlySession,
    activatingBookingId,
    handleUpdateBirthdayBookingStatus,
    plans,
    planDialogOpen,
    setPlanDialogOpen,
    editingPlan,
    setEditingPlan,
    newPlan,
    setNewPlan,
    handleCreatePlan,
    handleEditPlan,
    handleDeletePlan,
  } = props;

  const [subTab, setSubTab] = useState('hourly');

  return (
    <div>
      {/* Sub-tab navigation */}
      <div className="flex gap-2 mb-6 border-b pb-3">
        <button
          className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${subTab === 'hourly' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'}`}
          onClick={() => setSubTab('hourly')}
        >
          الحجوزات بالساعة
        </button>
        <button
          className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${subTab === 'birthday' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'}`}
          onClick={() => setSubTab('birthday')}
        >
          حفلات أعياد الميلاد
        </button>
        <button
          className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${subTab === 'subscriptions' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'}`}
          onClick={() => setSubTab('subscriptions')}
        >
          الاشتراكات
        </button>
      </div>

      {/* Hourly Bookings */}
      {subTab === 'hourly' && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Hourly Bookings {activeFilter === 'today' && <Badge className="ml-2 bg-blue-500">Today</Badge>}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {getFilteredHourlyBookings().map((booking) => (
                <div key={booking.id} className="flex justify-between items-center p-3 rounded-xl bg-muted/50">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{booking.booking_code}</span>
                      <Badge className={getStatusBadge(booking.status)}>{booking.status}</Badge>
                      {booking.booking_source === 'whatsapp' && (
                        <Badge className="bg-green-600 text-white text-xs">واتساب</Badge>
                      )}
                      {booking.status === 'checked_in' && (
                        <Badge className="bg-blue-600 text-white">
                          Running: {formatSessionTimer(booking.session_end_time) || '--:--'}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {booking.slot?.date} at {booking.slot?.start_time}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium">الوالد:</span> {booking.user?.name || '-'} &nbsp;|&nbsp; {booking.user?.email}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium">الطفل:</span>{' '}
                      {booking.child?.name || booking.guest_child_name || '-'}
                      {!booking.child?.name && booking.child_count > 1 && (
                        <span className="text-muted-foreground"> ({booking.child_count} أطفال)</span>
                      )}
                      {booking.child?.birthday && (
                        <> &nbsp;(🎂 {format(new Date(booking.child.birthday), 'yyyy-MM-dd')})</>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Payment: {paymentMethodLabel[booking.payment_method] || booking.payment_method || 'N/A'} ({booking.payment_status || 'N/A'})
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <p className="font-bold">${booking.amount}</p>
                    {booking.status === 'confirmed' && booking.payment_method && booking.payment_method !== 'card' && (
                      <Button
                        size="sm"
                        className="h-8 rounded-full"
                        onClick={() => handleActivateHourlySession(booking)}
                        disabled={activatingBookingId === booking.id}
                      >
                        {activatingBookingId === booking.id ? 'Activating...' : 'Activate Session'}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Birthday Bookings */}
      {subTab === 'birthday' && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>
              Birthday Bookings{' '}
              {activeFilter === 'today' && <Badge className="ml-2 bg-pink-500">Today</Badge>}
              {activeFilter === 'custom_pending' && <Badge className="ml-2 bg-purple-500">Custom Pending</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {getFilteredBirthdayBookings().map((booking) => (
                <div key={booking.id} className="flex justify-between items-center p-3 rounded-xl bg-muted/50">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{booking.booking_code}</span>
                      <Badge className={getStatusBadge(booking.status)}>{booking.status.replace('_', ' ')}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {booking.slot?.date} - {booking.is_custom ? 'Custom Theme' : booking.theme?.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium">الوالد:</span> {booking.user?.name || '-'} &nbsp;|&nbsp; {booking.user?.email}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium">الطفل:</span> {booking.child?.name || '-'}
                      {booking.child?.birthday && (
                        <> &nbsp;(🎂 {format(new Date(booking.child.birthday), 'yyyy-MM-dd')})</>
                      )}
                    </p>
                    {booking.is_custom && (
                      <p className="text-sm text-purple-600 mt-1">Request: {booking.custom_request}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <p className="font-bold">{booking.amount ? `$${booking.amount}` : 'Pending'}</p>
                    {(booking.status === 'custom_pending' || booking.status === 'pending') && (
                      <Button
                        size="sm"
                        className="h-8 rounded-full"
                        onClick={() => handleUpdateBirthdayBookingStatus(booking.id, 'confirmed')}
                      >
                        Confirm Order
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Subscriptions */}
      {subTab === 'subscriptions' && (
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl">باقات الاشتراك / Subscription Plans</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">إدارة باقات الزيارات للعملاء</p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {plans.map((plan) => (
                <Card key={plan.id} className="rounded-xl">
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-heading font-bold">{plan.name}</h3>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditPlan(plan)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeletePlan(plan.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {plan.name_ar && <p className="text-sm text-muted-foreground" dir="rtl">{plan.name_ar}</p>}
                    <p className="text-sm text-muted-foreground">{plan.description}</p>
                    <div className="mt-2 flex justify-between">
                      <span className="text-secondary font-bold">{plan.visits} visits</span>
                      <span className="font-bold">{plan.price} JD</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Add Plan Dialog */}
            <div className="pt-6 border-t mt-6 flex justify-end">
              <Dialog open={planDialogOpen} onOpenChange={(open) => { setPlanDialogOpen(open); if (!open) { setEditingPlan(null); setNewPlan({ name: '', name_ar: '', description: '', description_ar: '', visits: '', price: '' }); } }}>
                <DialogTrigger asChild>
                  <Button className="rounded-full gap-2 px-6">
                    <Plus className="h-4 w-4" /> إضافة باقة / Add Plan
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingPlan ? 'تعديل الباقة / Edit Plan' : 'إنشاء باقة / Create Plan'}</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleCreatePlan} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>الاسم (EN)</Label>
                        <Input value={newPlan.name} onChange={(e) => setNewPlan({...newPlan, name: e.target.value})} className="rounded-xl mt-1" />
                      </div>
                      <div>
                        <Label>الاسم (AR)</Label>
                        <Input value={newPlan.name_ar} onChange={(e) => setNewPlan({...newPlan, name_ar: e.target.value})} className="rounded-xl mt-1" dir="rtl" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>الوصف (EN)</Label>
                        <Textarea value={newPlan.description} onChange={(e) => setNewPlan({...newPlan, description: e.target.value})} className="rounded-xl mt-1" />
                      </div>
                      <div>
                        <Label>الوصف (AR)</Label>
                        <Textarea value={newPlan.description_ar} onChange={(e) => setNewPlan({...newPlan, description_ar: e.target.value})} className="rounded-xl mt-1" dir="rtl" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>عدد الزيارات</Label>
                        <Input type="number" value={newPlan.visits} onChange={(e) => setNewPlan({...newPlan, visits: e.target.value})} className="rounded-xl mt-1" />
                      </div>
                      <div>
                        <Label>السعر (JD)</Label>
                        <Input type="number" step="0.01" value={newPlan.price} onChange={(e) => setNewPlan({...newPlan, price: e.target.value})} className="rounded-xl mt-1" />
                      </div>
                    </div>
                    <Button type="submit" className="w-full rounded-full">{editingPlan ? 'تحديث / Update' : 'إنشاء / Create'}</Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            <h3 className="font-heading font-bold mb-4 mt-8">
              الاشتراكات النشطة / Active Subscriptions{' '}
              {activeFilter === 'active' && <Badge className="ml-2 bg-green-500">Active Only</Badge>}
            </h3>
            <div className="space-y-3">
              {getFilteredSubscriptions().map((sub) => (
                <div key={sub.id} className="flex justify-between items-center p-3 rounded-xl bg-muted/50">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{sub.plan?.name}</span>
                      <Badge className={getStatusBadge(sub.status)}>{sub.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium">الوالد:</span> {sub.user?.name || '-'} &nbsp;|&nbsp; {sub.user?.email}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium">الطفل:</span> {sub.child?.name || '-'}
                      {sub.child?.birthday && (
                        <> &nbsp;(🎂 {format(new Date(sub.child.birthday), 'yyyy-MM-dd')})</>
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-secondary">{sub.remaining_visits} left</p>
                    <p className="text-sm text-muted-foreground">
                      Expires {format(new Date(sub.expires_at), 'MMM d')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
