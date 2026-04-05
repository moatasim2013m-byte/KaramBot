import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { DollarSign, Clock, Check, Star, Users, Cake } from 'lucide-react';
import { Card as TremorCard, Metric, Text, BadgeDelta } from '@tremor/react';

export default function OverviewTab({ stats, handleDashboardCardClick, formatCurrency }) {
  return (
    <div>
      {/* Tremor KPI Cards */}
      <div className="admin-kpi-grid mb-6">
        <TremorCard>
          <Text>إيرادات اليوم</Text>
          <Metric>{formatCurrency(stats.revenue_today)}</Metric>
          <BadgeDelta deltaType="increase">اليوم</BadgeDelta>
        </TremorCard>
        <TremorCard>
          <Text>الجلسات النشطة</Text>
          <Metric>{stats.active_sessions_now || 0}</Metric>
          <BadgeDelta deltaType="unchanged">الآن</BadgeDelta>
        </TremorCard>
        <TremorCard>
          <Text>حجوزات اليوم</Text>
          <Metric>{stats.total_checkins_today || 0}</Metric>
          <BadgeDelta deltaType="increase">Check-ins</BadgeDelta>
        </TremorCard>
        <TremorCard>
          <Text>الاشتراكات النشطة</Text>
          <Metric>{stats.active_subscriptions || 0}</Metric>
          <BadgeDelta deltaType="unchanged">نشط</BadgeDelta>
        </TremorCard>
      </div>

      {/* Original dashboard grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('hourly', 'today')}>
          <CardContent className="p-4 text-center">
            <DollarSign className="h-8 w-8 text-emerald-600 mx-auto mb-2" />
            <p className="text-2xl font-bold">{formatCurrency(stats.revenue_today)}</p>
            <p className="text-sm text-muted-foreground">إيراد اليوم</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('hourly')}>
          <CardContent className="p-4 text-center">
            <DollarSign className="h-8 w-8 text-green-500 mx-auto mb-2" />
            <p className="text-2xl font-bold">{formatCurrency(stats.revenue_month)}</p>
            <p className="text-sm text-muted-foreground">إيراد الشهر</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('hourly')}>
          <CardContent className="p-4 text-center">
            <Clock className="h-8 w-8 text-blue-500 mx-auto mb-2" />
            <p className="text-2xl font-bold">{stats.active_sessions_now || 0}</p>
            <p className="text-sm text-muted-foreground">الجلسات النشطة الآن</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('hourly', 'today')}>
          <CardContent className="p-4 text-center">
            <Check className="h-8 w-8 text-sky-500 mx-auto mb-2" />
            <p className="text-2xl font-bold">{stats.total_checkins_today || 0}</p>
            <p className="text-sm text-muted-foreground">إجمالي Check-ins اليوم</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('hourly')}>
          <CardContent className="p-4 text-center">
            <Clock className="h-8 w-8 text-amber-500 mx-auto mb-2" />
            <p className="text-2xl font-bold">{stats.open_overtime_unpaid_orders || 0}</p>
            <p className="text-sm text-muted-foreground">Overtime / Unpaid المفتوحة</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('subscriptions', 'active')}>
          <CardContent className="p-4 text-center">
            <Star className="h-8 w-8 text-secondary mx-auto mb-2" />
            <p className="text-2xl font-bold">{stats.active_subscriptions || 0}</p>
            <p className="text-sm text-muted-foreground">الاشتراكات النشطة</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('users')}>
          <CardContent className="p-4 text-center">
            <Users className="h-8 w-8 text-primary mx-auto mb-2" />
            <p className="text-2xl font-bold">{stats.total_parents || 0}</p>
            <p className="text-sm text-muted-foreground">Parents</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('users')}>
          <CardContent className="p-4 text-center">
            <Users className="h-8 w-8 text-accent mx-auto mb-2" />
            <p className="text-2xl font-bold">{stats.total_children || 0}</p>
            <p className="text-sm text-muted-foreground">Children</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('birthday', 'today')}>
          <CardContent className="p-4 text-center">
            <Cake className="h-8 w-8 text-pink-500 mx-auto mb-2" />
            <p className="text-2xl font-bold">{stats.today_birthday_bookings || 0}</p>
            <p className="text-sm text-muted-foreground">Today Birthday</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('subscriptions', 'active')}>
          <CardContent className="p-4 text-center">
            <Star className="h-8 w-8 text-secondary mx-auto mb-2" />
            <p className="text-2xl font-bold">{stats.active_subscriptions || 0}</p>
            <p className="text-sm text-muted-foreground">Active Subs</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('birthday', 'custom_pending')}>
          <CardContent className="p-4 text-center">
            <Cake className="h-8 w-8 text-purple-500 mx-auto mb-2" />
            <p className="text-2xl font-bold">{stats.pending_custom_parties || 0}</p>
            <p className="text-sm text-muted-foreground">Custom Pending</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="text-lg">ملخص الإشغال حسب الفترة</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(stats.zones_occupancy || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد جلسات نشطة حالياً</p>
            ) : (
              (stats.zones_occupancy || []).map((zone) => (
                <div key={zone.zone} className="flex items-center justify-between rounded-xl border p-3">
                  <div>
                    <p className="font-semibold">{zone.zone}</p>
                    <p className="text-xs text-muted-foreground">{zone.active_sessions || 0} جلسة</p>
                  </div>
                  <Badge variant="secondary">{zone.occupancy_share_pct || 0}%</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="text-lg">ملخص الفروع</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(stats.branch_summary || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No branch data available</p>
            ) : (
              (stats.branch_summary || []).map((branch) => (
                <div key={branch.branch} className="rounded-xl border p-3 space-y-1">
                  <p className="font-semibold">{branch.branch}</p>
                  <p className="text-sm text-muted-foreground">طلبات: {branch.total_orders || 0}</p>
                  <p className="text-sm text-muted-foreground">إيراد مدفوع: {formatCurrency(branch.paid_revenue)}</p>
                  <p className="text-sm text-muted-foreground">طلبات غير مدفوعة: {branch.unpaid_orders || 0}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
