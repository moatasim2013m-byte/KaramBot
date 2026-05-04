# Mission 1 — Day Care Backend Foundation: Test Notes

This file documents the manual-curl regression suite used to validate
Mission 1 (no production auto-seed; backend-only changes).

## Prerequisites

- Admin and parent accounts seeded (see `/app/memory/test_credentials.md`).
- Daycare slots seeded with the dev-only script:

  ```bash
  cd /app/backend/node-app
  node scripts/seed_daycare_slots.js --start=YYYY-MM-DD --end=YYYY-MM-DD --capacity=10
  ```

## Validations performed

1. `GET /api/admin/pricing` returns the four daycare keys with safe defaults
   (`daycare_1hr=8, daycare_2hr=15, daycare_3hr=22, daycare_4hr=28`).
2. `PUT /api/admin/pricing` with `{daycare_1hr, daycare_2hr, daycare_3hr, daycare_4hr}`
   updates only those keys; hourly_* keys are left untouched.
3. `GET /api/slots/available?slot_type=daycare&date=...` returns the seeded
   daycare slots WITHOUT auto-creating any (manual-only).
4. `GET /api/slots/available?slot_type=hourly&date=...` still returns the
   79 hourly slots (regression — main area unchanged).
5. `POST /api/bookings/hourly` with a daycare slot:
   - `service_type === 'daycare'`
   - `booking_code` starts with `PK-D-`
   - `amount` matches `daycare_<hours>hr` setting
6. `POST /api/bookings/hourly` with a main-area slot:
   - `service_type === 'main_area'`
   - `booking_code` starts with `PK-H-`
   - `amount` matches `hourly_<hours>hr` (or Happy Hour) setting
7. `POST /api/bookings/hourly` with a birthday slot — rejected (cannot
   book birthday slot through the hourly endpoint).

All seven were verified manually on 2026-05-04.
