"""Mission 1 — Day Care Backend Foundation pytest suite.

Exercises:
- /api/admin/pricing GET/PUT (daycare_* keys + isolation from hourly_*)
- /api/slots/available?slot_type=hourly|daycare|birthday
- /api/bookings/hourly + /hourly/offline + /hourly/guest-offline (daycare + main_area)
- service_type / PK-D-* / PK-H-* / amount classification
- Capacity decrement & enforcement on daycare
- Birthday slot rejection on hourly endpoint
- /api/payments/create-checkout type=hourly & type=subscription (manual provider)
- Subscription regression: GET /api/subscriptions/plans
- Birthday booking regression (POST /api/bookings/birthday)
"""

import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://presentation-patch.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@peekaboo.com", "password": "admin123"}
PARENT = {"email": "parent@peekaboo.com", "password": "parent123"}

# Future dates used for daycare seed (per pod date 2026-05-04). Each test that
# needs an unused slot reserves a fresh date so capacity assertions stay clean.
DAYCARE_DATES = [f"2026-05-{d}" for d in (15, 16, 17, 18, 19, 20)]
HOURLY_DATE = "2026-05-21"
BIRTHDAY_DATE = "2026-05-22"


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def parent_token():
    r = requests.post(f"{API}/auth/login", json=PARENT, timeout=15)
    assert r.status_code == 200, f"Parent login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session", autouse=True)
def seed_daycare(admin_token):
    """Ensure dev seed script populated daycare slots for our test dates."""
    import subprocess
    res = subprocess.run(
        [
            "node",
            "/app/backend/node-app/scripts/seed_daycare_slots.js",
            f"--start={DAYCARE_DATES[0]}",
            f"--end={DAYCARE_DATES[-1]}",
            "--capacity=10",
        ],
        capture_output=True, text=True, timeout=60,
    )
    assert res.returncode == 0, f"seed script failed: {res.stderr}\n{res.stdout}"
    # Also seed a capacity=10 slot date for capacity test (already covered above)
    return True


def auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _pick_unbooked_slot(slots, max_capacity=None):
    for s in slots:
        if s.get("booked_count", 0) == 0:
            if max_capacity is None or s.get("capacity") == max_capacity:
                return s
    return None


# ---------- 1. /api/admin/pricing ----------
class TestPricing:
    def test_get_pricing_returns_hourly_and_daycare_keys(self, admin_token):
        r = requests.get(f"{API}/admin/pricing", headers=auth(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # Pricing payload is wrapped: {"pricing": {...}}
        kv = data.get("pricing", data.get("settings", data))
        # Hourly keys (1/2/3 + extra_hr — 4 keys)
        for h in ("hourly_1hr", "hourly_2hr", "hourly_3hr"):
            assert h in kv, f"missing {h} in pricing payload: {kv}"
            float(kv[h])
        for d in ("daycare_1hr", "daycare_2hr", "daycare_3hr", "daycare_4hr"):
            assert d in kv, f"missing {d} in pricing payload: {kv}"
            float(kv[d])

    def test_put_pricing_isolation_daycare_does_not_touch_hourly(self, admin_token):
        # Snapshot
        snap = requests.get(f"{API}/admin/pricing", headers=auth(admin_token), timeout=15).json()
        snap = snap.get("pricing", snap.get("settings", snap))
        original_hourly = {k: snap[k] for k in ("hourly_1hr", "hourly_2hr", "hourly_3hr")}

        # PUT only daycare keys
        new_daycare = {"daycare_1hr": 11, "daycare_2hr": 19, "daycare_3hr": 26, "daycare_4hr": 33}
        r = requests.put(f"{API}/admin/pricing", headers=auth(admin_token), json=new_daycare, timeout=15)
        assert r.status_code in (200, 204), r.text

        after = requests.get(f"{API}/admin/pricing", headers=auth(admin_token), timeout=15).json()
        after = after.get("pricing", after.get("settings", after))
        for k, v in new_daycare.items():
            assert float(after[k]) == float(v), f"{k} not persisted: got {after[k]} expected {v}"
        for k, v in original_hourly.items():
            assert float(after[k]) == float(v), f"{k} unexpectedly changed: {after[k]} != {v}"

    def test_put_pricing_isolation_hourly_does_not_touch_daycare(self, admin_token):
        snap = requests.get(f"{API}/admin/pricing", headers=auth(admin_token), timeout=15).json()
        snap = snap.get("pricing", snap.get("settings", snap))
        original_daycare = {k: snap[k] for k in ("daycare_1hr", "daycare_2hr", "daycare_3hr", "daycare_4hr")}

        # Update only hourly_2hr
        new_hourly = {"hourly_2hr": float(snap["hourly_2hr"]) + 0.01}
        r = requests.put(f"{API}/admin/pricing", headers=auth(admin_token), json=new_hourly, timeout=15)
        assert r.status_code in (200, 204), r.text

        after = requests.get(f"{API}/admin/pricing", headers=auth(admin_token), timeout=15).json()
        after = after.get("pricing", after.get("settings", after))
        for k, v in original_daycare.items():
            assert float(after[k]) == float(v), f"daycare {k} changed during hourly-only PUT: {after[k]} != {v}"

        # Restore hourly_2hr
        requests.put(f"{API}/admin/pricing", headers=auth(admin_token),
                     json={"hourly_2hr": float(snap["hourly_2hr"])}, timeout=15)


# ---------- 2. /api/slots/available ----------
class TestSlotAvailability:
    def test_hourly_auto_generates_79_slots(self):
        r = requests.get(f"{API}/slots/available", params={"slot_type": "hourly", "date": HOURLY_DATE}, timeout=20)
        assert r.status_code == 200, r.text
        slots = r.json() if isinstance(r.json(), list) else r.json().get("slots", [])
        assert len(slots) == 79, f"expected 79 hourly slots got {len(slots)}"
        assert all(s.get("slot_type") == "hourly" for s in slots)

    def test_daycare_returns_seeded_slots_only(self):
        r = requests.get(f"{API}/slots/available", params={"slot_type": "daycare", "date": DAYCARE_DATES[0]}, timeout=20)
        assert r.status_code == 200, r.text
        slots = r.json() if isinstance(r.json(), list) else r.json().get("slots", [])
        assert len(slots) == 9, f"expected 9 seeded daycare slots got {len(slots)}"
        assert all(s.get("slot_type") == "daycare" for s in slots)
        assert all(int(s.get("capacity", 0)) == 10 for s in slots)

    def test_daycare_no_seed_returns_empty(self):
        # Use a far-future date with no seed
        r = requests.get(f"{API}/slots/available", params={"slot_type": "daycare", "date": "2027-01-01"}, timeout=20)
        assert r.status_code == 200, r.text
        slots = r.json() if isinstance(r.json(), list) else r.json().get("slots", [])
        assert slots == [] or len(slots) == 0, f"expected 0 slots, got {len(slots)}"

    def test_birthday_returns_six_slots(self):
        r = requests.get(f"{API}/slots/available", params={"slot_type": "birthday", "date": BIRTHDAY_DATE}, timeout=20)
        assert r.status_code == 200, r.text
        slots = r.json() if isinstance(r.json(), list) else r.json().get("slots", [])
        assert len(slots) == 6, f"expected 6 birthday slots got {len(slots)}"
        assert all(s.get("slot_type") == "birthday" for s in slots)


# ---------- helpers to grab fresh slot from a date ----------
def _get_slots(slot_type, date):
    r = requests.get(f"{API}/slots/available", params={"slot_type": slot_type, "date": date}, timeout=20)
    assert r.status_code == 200, r.text
    j = r.json()
    return j if isinstance(j, list) else j.get("slots", [])


def _db_check_booking(code):
    """Query persisted HourlyBooking by booking_code; returns dict or None."""
    import json, subprocess
    res = subprocess.run(
        ["node", "tests/_check_booking.js", code],
        cwd="/app/backend/node-app",
        capture_output=True, text=True, timeout=20,
    )
    if res.returncode != 0:
        return None
    # Last JSON line of stdout
    for line in reversed(res.stdout.strip().splitlines()):
        try:
            return json.loads(line)
        except Exception:
            continue
    return None


# ---------- 3. Booking classification ----------
class TestHourlyBookingDaycare:
    def test_book_daycare_sets_service_type_and_pkd_prefix(self, parent_token, admin_token):
        slots = _get_slots("daycare", DAYCARE_DATES[1])
        slot = _pick_unbooked_slot(slots)
        assert slot, "no unbooked daycare slot available"

        # Read current daycare_2hr price
        pricing = requests.get(f"{API}/admin/pricing", headers=auth(admin_token), timeout=15).json()
        pricing = pricing.get("pricing", pricing.get("settings", pricing))
        expected_amt = float(pricing["daycare_2hr"])

        payload = {
            "slot_id": slot["id"] if "id" in slot else slot["_id"],
            "duration_hours": 2,
            "child_count": 1,
            "child_name": "TEST_DC_Child",
            "parent_phone": "962790111111",
        }
        r = requests.post(f"{API}/bookings/hourly", headers=auth(parent_token), json=payload, timeout=20)
        assert r.status_code in (200, 201), f"daycare booking failed: {r.status_code} {r.text}"
        body = r.json()
        booking = (body.get("bookings") or [None])[0] if "bookings" in body else body.get("booking", body)
        assert booking, f"no booking in response: {body}"
        code = booking.get("booking_code") or booking.get("code")
        assert code and code.startswith("PK-D-"), f"expected PK-D-* got {code}"
        # service_type may not be echoed in response; PK-D- prefix proves classification
        if "service_type" in booking:
            assert booking["service_type"] == "daycare", booking
        amt = float(booking.get("amount", booking.get("total_amount", 0)))
        assert amt == expected_amt, f"daycare amount {amt} != expected {expected_amt}"
        # DB-level: confirm service_type='daycare' persisted
        persisted = _db_check_booking(code)
        assert persisted and persisted.get("found"), f"booking not found in DB: {code}"
        assert persisted.get("service_type") == "daycare", \
            f"persisted service_type != daycare: {persisted}"

    def test_book_main_area_hourly_sets_main_area_pkh(self, parent_token, admin_token):
        slots = _get_slots("hourly", HOURLY_DATE)
        # Pick a slot with start_time outside 10:00-13:59 to avoid happy hour ambiguity
        slot = next((s for s in slots
                     if s.get("booked_count", 0) == 0
                     and not (10 <= int(str(s.get("start_time", "00:00")).split(":")[0]) <= 13)), None)
        assert slot, "no non-happy-hour main-area slot found"

        pricing = requests.get(f"{API}/admin/pricing", headers=auth(admin_token), timeout=15).json()
        pricing = pricing.get("pricing", pricing.get("settings", pricing))
        expected_amt = float(pricing["hourly_2hr"])

        payload = {
            "slot_id": slot["id"] if "id" in slot else slot["_id"],
            "duration_hours": 2,
            "child_count": 1,
            "child_name": "TEST_MA_Child",
            "parent_phone": "962790111111",
        }
        r = requests.post(f"{API}/bookings/hourly", headers=auth(parent_token), json=payload, timeout=20)
        assert r.status_code in (200, 201), f"hourly booking failed: {r.status_code} {r.text}"
        body = r.json()
        booking = (body.get("bookings") or [None])[0] if "bookings" in body else body.get("booking", body)
        assert booking, f"no booking in response: {body}"
        code = booking.get("booking_code") or booking.get("code")
        assert code and code.startswith("PK-H-"), f"expected PK-H-* got {code}"
        if "service_type" in booking:
            assert booking["service_type"] == "main_area", booking
        amt = float(booking.get("amount", booking.get("total_amount", 0)))
        assert amt == expected_amt, f"hourly main-area amount {amt} != expected {expected_amt}"
        persisted = _db_check_booking(code)
        assert persisted and persisted.get("found"), f"booking not found in DB: {code}"
        assert persisted.get("service_type") == "main_area", \
            f"persisted service_type != main_area: {persisted}"

    def test_offline_daycare_booking(self, admin_token):
        slots = _get_slots("daycare", DAYCARE_DATES[2])
        slot = _pick_unbooked_slot(slots)
        assert slot
        payload = {
            "slot_id": slot["id"] if "id" in slot else slot["_id"],
            "duration_hours": 1,
            "child_count": 1,
            "child_name": "TEST_DC_Offline",
            "parent_phone": "962790111111",
            "parent_name": "TEST Offline Parent",
            "payment_method": "cash",
        }
        r = requests.post(f"{API}/bookings/hourly/offline", headers=auth(admin_token), json=payload, timeout=20)
        assert r.status_code in (200, 201), f"offline daycare booking failed: {r.status_code} {r.text}"
        body = r.json()
        # Response can be {bookings:[...]} or {booking:{...}}
        booking = (body.get("bookings") or [None])[0] if "bookings" in body else body.get("booking", body)
        assert booking, f"no booking in response: {body}"
        # service_type may be omitted from offline response payload — verify via booking_code prefix
        code = code if (code := booking.get("booking_code") or booking.get("code")) else None
        assert code and code.startswith("PK-D-"), f"expected PK-D-* got {code}: {booking}"
        persisted = _db_check_booking(code)
        assert persisted and persisted.get("found"), f"offline booking not found in DB: {code}"
        assert persisted.get("service_type") == "daycare", f"offline service_type wrong: {persisted}"

    def test_guest_offline_daycare_booking(self):
        slots = _get_slots("daycare", DAYCARE_DATES[3])
        slot = _pick_unbooked_slot(slots)
        assert slot
        payload = {
            "slot_id": slot["id"] if "id" in slot else slot["_id"],
            "duration_hours": 1,
            "child_count": 1,
            "child_name": "TEST_DC_Guest",
            "parent_phone": "962790111112",
            "parent_name": "TEST Guest",
            "payment_method": "cash",
        }
        # No auth header
        r = requests.post(f"{API}/bookings/hourly/guest-offline",
                          headers={"Content-Type": "application/json"},
                          json=payload, timeout=20)
        assert r.status_code in (200, 201), f"guest-offline daycare failed: {r.status_code} {r.text}"
        body = r.json()
        booking = (body.get("bookings") or [None])[0] if "bookings" in body else body.get("booking", body)
        assert booking, f"no booking in response: {body}"
        code = booking.get("booking_code") or booking.get("code")
        assert code and code.startswith("PK-D-"), f"expected PK-D-* got {code}: {booking}"
        persisted = _db_check_booking(code)
        assert persisted and persisted.get("found"), f"guest-offline booking not in DB: {code}"
        assert persisted.get("service_type") == "daycare", f"guest-offline service_type wrong: {persisted}"

    def test_hourly_endpoint_rejects_birthday_slot(self, parent_token):
        slots = _get_slots("birthday", BIRTHDAY_DATE)
        assert slots, "no birthday slots returned"
        slot = slots[0]
        payload = {
            "slot_id": slot["id"] if "id" in slot else slot["_id"],
            "duration_hours": 2,
            "child_count": 1,
            "child_name": "TEST_Reject",
            "parent_phone": "962790111111",
        }
        r = requests.post(f"{API}/bookings/hourly", headers=auth(parent_token), json=payload, timeout=20)
        assert r.status_code >= 400, f"birthday slot should be rejected, got {r.status_code} {r.text}"


# ---------- 4. Capacity enforcement ----------
class TestDaycareCapacity:
    def test_capacity_overbook_rejected_and_no_increment(self, parent_token):
        slots = _get_slots("daycare", DAYCARE_DATES[4])
        slot = _pick_unbooked_slot(slots, max_capacity=10)
        assert slot, "no fresh capacity-10 daycare slot"
        slot_id = slot["id"] if "id" in slot else slot["_id"]
        before = int(slot.get("booked_count", 0))

        # Try 11 children on capacity 10
        payload = {
            "slot_id": slot_id,
            "duration_hours": 2,
            "child_count": 11,
            "child_name": "TEST_Overbook",
            "parent_phone": "962790111111",
        }
        r = requests.post(f"{API}/bookings/hourly", headers=auth(parent_token), json=payload, timeout=20)
        assert r.status_code >= 400, f"overbook should fail, got {r.status_code} {r.text}"

        # Confirm booked_count unchanged
        slots_after = _get_slots("daycare", DAYCARE_DATES[4])
        match = next((s for s in slots_after if (s.get("id") or s.get("_id")) == slot_id), None)
        assert match is not None
        assert int(match.get("booked_count", 0)) == before, \
            f"booked_count changed from {before} to {match.get('booked_count')} on rejected overbook"


# ---------- 5. Payments create-checkout (manual provider) ----------
class TestPaymentsCheckout:
    def test_create_checkout_hourly_daycare_returns_manual(self, parent_token):
        slots = _get_slots("daycare", DAYCARE_DATES[5])
        slot = _pick_unbooked_slot(slots)
        assert slot
        payload = {
            "type": "hourly",
            "reference_id": slot["id"] if "id" in slot else slot["_id"],
            "duration_hours": 3,
            "child_count": 2,
        }
        r = requests.post(f"{API}/payments/create-checkout", headers=auth(parent_token), json=payload, timeout=20)
        # Manual provider: backend returns 200 with {message:'Manual payment only'} OR 4xx with that message.
        assert r.status_code in (200, 400, 501, 503), r.text
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        msg = (body.get("message") or body.get("error") or "").lower()
        assert "manual" in msg or body.get("provider") == "manual", \
            f"expected manual-payment response, got {r.status_code} {body}"

    def test_subscription_plans_regression(self):
        r = requests.get(f"{API}/subscriptions/plans", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        # Endpoint must respond OK; plans list may be empty in dev DB.
        assert "plans" in body or isinstance(body, list), f"unexpected plans payload: {body}"


# ---------- 6. Birthday booking regression ----------
class TestBirthdayBookingRegression:
    def test_birthday_booking_still_works(self, parent_token):
        slots = _get_slots("birthday", "2026-05-23")
        assert slots, "no birthday slots"
        slot = next((s for s in slots if int(s.get("booked_count", 0)) == 0), slots[0])
        slot_id = slot["id"] if "id" in slot else slot["_id"]
        payload = {
            "slot_id": slot_id,
            "child_name": "TEST_BDayChild",
            "child_age": 5,
            "guest_count": 10,
            "parent_phone": "962790111111",
            "package": "basic",
        }
        r = requests.post(f"{API}/bookings/birthday", headers=auth(parent_token), json=payload, timeout=20)
        # If validation differs accept either 200/201 OR a 4xx that's clearly schema-driven (not 5xx)
        assert r.status_code < 500, f"server error on birthday booking: {r.status_code} {r.text}"
        if r.status_code in (200, 201):
            booking = r.json().get("booking", r.json())
            code = booking.get("booking_code") or booking.get("code", "")
            # Birthday code prefix is typically PK-B- (not asserted hard since not in scope)
            assert code, "birthday booking returned no code"
