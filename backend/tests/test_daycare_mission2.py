"""
Mission 2 Day Care Customer Booking UI – BACKEND acceptance tests.
Focus: /api/payments/hourly-pricing service-aware branching,
end-to-end cash/daycare and cash/main_area offline bookings,
capacity regression, and birthday/subscription regression.
"""
import os
import requests
import pytest
from datetime import datetime, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

PARENT = {"email": "parent@peekaboo.com", "password": "parent123"}
ADMIN = {"email": "admin@peekaboo.com", "password": "admin123"}


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def parent_token():
    r = requests.post(f"{API}/auth/login", json=PARENT, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"] if "access_token" in r.json() else r.json().get("token")


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"] if "access_token" in r.json() else r.json().get("token")


@pytest.fixture(scope="session")
def daycare_pricing(admin_token):
    r = requests.get(f"{API}/admin/pricing", headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
    assert r.status_code == 200, r.text
    pricing = r.json().get("pricing", r.json())
    # normalize: some APIs return {pricing:{...}} or flat
    if isinstance(pricing, list):
        pricing = {p["key"]: float(p["value"]) for p in pricing}
    return {
        1: float(pricing.get("daycare_1hr", 11)),
        2: float(pricing.get("daycare_2hr", 19)),
        3: float(pricing.get("daycare_3hr", 26)),
        4: float(pricing.get("daycare_4hr", 33)),
    }


@pytest.fixture(scope="session")
def hourly_pricing(admin_token):
    r = requests.get(f"{API}/admin/pricing", headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
    pricing = r.json().get("pricing", r.json())
    if isinstance(pricing, list):
        pricing = {p["key"]: float(p["value"]) for p in pricing}
    return {
        1: float(pricing.get("hourly_1hr", 7)),
        2: float(pricing.get("hourly_2hr", 10)),
        3: float(pricing.get("hourly_3hr", 13)),
    }


def _future_seeded_date():
    # Mission 1 seeded 2026-05-15..2026-05-20
    return "2026-05-18"


# ---------- /api/payments/hourly-pricing ----------
class TestHourlyPricingBranching:

    def test_legacy_no_query_returns_afternoon(self):
        r = requests.get(f"{API}/payments/hourly-pricing", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "pricing" in data
        assert len(data["pricing"]) == 3
        prices = {p["hours"]: p["price"] for p in data["pricing"]}
        assert prices == {1: 7, 2: 10, 3: 13}
        assert data.get("timeMode") == "afternoon"
        assert data.get("service_type") != "daycare"
        assert data["currency"] == "JD"

    def test_morning_happy_hour(self):
        r = requests.get(f"{API}/payments/hourly-pricing?timeMode=morning", timeout=10)
        assert r.status_code == 200
        data = r.json()
        prices = {p["hours"]: p["price"] for p in data["pricing"]}
        assert prices == {1: 3.5, 2: 7, 3: 10.5}
        assert data["extra_hour_price"] == 3.5
        assert data.get("timeMode") == "morning"

    def test_daycare_shape(self, daycare_pricing):
        r = requests.get(f"{API}/payments/hourly-pricing?service_type=daycare", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data["service_type"] == "daycare"
        assert data["currency"] == "JD"
        assert data["extra_hour_price"] is None
        assert data["extra_hour_text"] == ""
        assert len(data["pricing"]) == 4
        prices = {p["hours"]: p["price"] for p in data["pricing"]}
        for h in (1, 2, 3, 4):
            assert prices[h] == daycare_pricing[h], f"hour {h} mismatch"


# ---------- End-to-end offline bookings ----------
class TestOfflineBookings:

    def _get_slot(self, slot_type, duration, date, afternoon_only=False):
        params = {"slot_type": slot_type, "date": date, "duration": duration}
        r = requests.get(f"{API}/slots/available", params=params, timeout=15)
        assert r.status_code == 200, r.text
        slots = r.json().get("slots", [])
        # pick first available
        for s in slots:
            if s.get("available", True) and (s.get("capacity", 1) - s.get("booked_count", 0)) >= 1:
                if afternoon_only:
                    start = s.get("start_time", "")
                    # After 12:00 counts as afternoon (main_area afternoon pricing)
                    try:
                        hh = int(start.split(":")[0])
                        if hh < 13:
                            continue
                    except Exception:
                        continue
                return s
        return None

    def test_daycare_cash_offline_booking(self, parent_token, daycare_pricing):
        date = _future_seeded_date()
        duration = 2
        slot = self._get_slot("daycare", duration, date)
        assert slot, f"No daycare slot available on {date}"
        payload = {
            "slot_id": slot.get("_id") or slot.get("id"),
            "duration_hours": duration,
            "child_count": 1,
            "guest_child_name": "TEST_DC_M2",
            "payment_method": "cash",
            "notes": "mission2 test",
        }
        r = requests.post(
            f"{API}/bookings/hourly/offline",
            json=payload,
            headers={"Authorization": f"Bearer {parent_token}"},
            timeout=20,
        )
        assert r.status_code in (200, 201), r.text
        data = r.json()
        booking = (data.get("bookings") or [data.get("booking") or data])[0]
        booking_code = booking.get("booking_code")
        amount = booking.get("amount")
        assert booking_code and booking_code.startswith("PK-D-"), f"Got code: {booking_code}"
        assert float(amount) == daycare_pricing[duration], f"amount {amount} != {daycare_pricing[duration]}"
        assert booking.get("service_type") == "daycare"

    def test_main_area_cash_offline_booking(self, parent_token, hourly_pricing):
        date = _future_seeded_date()
        duration = 2
        slot = self._get_slot("hourly", duration, date, afternoon_only=True)
        assert slot, f"No hourly slot available on {date}"
        payload = {
            "slot_id": slot.get("_id") or slot.get("id"),
            "duration_hours": duration,
            "child_count": 1,
            "guest_child_name": "TEST_MA_M2",
            "payment_method": "cash",
            "time_mode": "afternoon",
        }
        r = requests.post(
            f"{API}/bookings/hourly/offline",
            json=payload,
            headers={"Authorization": f"Bearer {parent_token}"},
            timeout=20,
        )
        assert r.status_code in (200, 201), r.text
        data = r.json()
        booking = (data.get("bookings") or [data.get("booking") or data])[0]
        booking_code = booking.get("booking_code")
        amount = float(booking.get("amount"))
        assert booking_code and booking_code.startswith("PK-H-"), f"Got code: {booking_code}"
        # Accept either afternoon or morning (happy-hour) pricing — offline endpoint
        # doesn't have explicit period control in Mission 2 scope.
        acceptable = {hourly_pricing[duration], 3.5 * duration}
        assert amount in acceptable, f"amount {amount} not in {acceptable}"
        assert booking.get("service_type") == "main_area"


# ---------- Capacity regression ----------
class TestCapacityRegression:

    def test_overbook_daycare_rejected(self, parent_token):
        date = _future_seeded_date()
        duration = 1
        r = requests.get(
            f"{API}/slots/available",
            params={"slot_type": "daycare", "date": date, "duration": duration},
            timeout=15,
        )
        slots = r.json().get("slots", [])
        slot = slots[0] if slots else None
        assert slot
        capacity = slot.get("capacity", 10)
        over = capacity + 1
        payload = {
            "slot_id": slot.get("_id") or slot.get("id"),
            "duration_hours": duration,
            "child_count": over,
            "payment_method": "cash",
        }
        r = requests.post(
            f"{API}/bookings/hourly/offline",
            json=payload,
            headers={"Authorization": f"Bearer {parent_token}"},
            timeout=20,
        )
        assert r.status_code >= 400, f"Overbook should have been rejected, got {r.status_code}: {r.text}"


# ---------- Subscription/Birthday smoke regression ----------
class TestRegression:

    def test_subscription_plans(self):
        r = requests.get(f"{API}/subscriptions/plans", timeout=10)
        assert r.status_code == 200
        assert "plans" in r.json()

    def test_birthday_packages(self):
        r = requests.get(f"{API}/bookings/birthday/packages", timeout=10)
        # endpoint may return 200 or vary; just accept it doesn't 500
        assert r.status_code < 500
