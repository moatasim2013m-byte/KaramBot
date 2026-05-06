// Mission 3 — Day Care visibility helpers.
//
// Single source of truth for the "Main Area vs Day Care" service badge so
// every operational surface (admin BookingsTab, staff pending list, staff
// active sessions, staff QR validation panel) renders the same chip.
//
// `service_type` is the authoritative value (added on the HourlyBooking
// schema in Mission 1, default 'main_area'). For older payloads that
// don't yet carry the field, we fall back to the booking_code prefix:
//   PK-D-* → daycare,  anything else → main_area.

export const getServiceMeta = (booking) => {
  const explicit = booking?.service_type;
  if (explicit === 'daycare' || explicit === 'main_area') {
    return SERVICE_META[explicit];
  }
  const code = String(booking?.booking_code || '');
  return /^PK-D-/i.test(code) ? SERVICE_META.daycare : SERVICE_META.main_area;
};

const SERVICE_META = {
  main_area: {
    key: 'main_area',
    label: 'اللعب بالساعة',
    short: 'Main',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-300'
  },
  daycare: {
    key: 'daycare',
    label: 'حضانة Day Care',
    short: 'Daycare',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-300'
  }
};

export const SERVICE_FILTER_OPTIONS = [
  { value: 'all', label: 'الكل / All' },
  { value: 'main_area', label: 'اللعب بالساعة / Main' },
  { value: 'daycare', label: 'حضانة / Day Care' }
];

// Pure predicate for the BookingsTab service-type filter. Defined here so
// admin + staff components stay in sync if the rules ever change.
export const matchesServiceFilter = (booking, filterValue) => {
  if (!filterValue || filterValue === 'all') return true;
  return getServiceMeta(booking).key === filterValue;
};
