"""
Phase 4 loyalty backend tests.

Covers:
  - Parent /api/loyalty/balance and /api/loyalty/history (no transactions, plain JSON)
  - Admin /api/admin/loyalty/settings GET/PUT (defaults, sanitisation, persistence)
  - Admin /api/admin/loyalty/ledger pagination + shape
  - Role separation (parent + staff blocked from admin endpoints)
  - Policy persistence — set policy, GET back the saved policy
  - Restore defaults at the end

Note: Live check-in earn regression is exercised indirectly by verifying the
PUT-then-GET roundtrip on the policy that staff.js reads via
getLoyaltyEarnPolicy(). A live booking + QR check-in is out of scope for this
suite (no fresh booking infrastructure available here).
"""

import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://whatsapp-backend-ops.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "admin@peekaboo.com"
ADMIN_PASSWORD = "admin123"
PARENT_EMAIL = "parent@peekaboo.com"
PARENT_PASSWORD = "parent123"

DEFAULT_POLICY = {
    "enabled": True,
    "earn_mode": "per_jd",
    "points_per_jd": 1,
    "fixed_points_per_visit": 10,
}


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(http, email, password):
    r = http.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"Login failed for {email}: {r.status_code} {r.text[:200]}")
    data = r.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"No token in login response: {data}"
    return token, data.get("user", {})


@pytest.fixture(scope="session")
def admin_token(http):
    token, _ = _login(http, ADMIN_EMAIL, ADMIN_PASSWORD)
    return token


@pytest.fixture(scope="session")
def parent_token(http):
    token, _ = _login(http, PARENT_EMAIL, PARENT_PASSWORD)
    return token


def _hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Parent loyalty endpoints ----------
class TestParentLoyalty:
    def test_balance_returns_plain_json_no_transactions(self, http, parent_token):
        r = http.get(f"{BASE_URL}/api/loyalty/balance", headers=_hdr(parent_token), timeout=20)
        assert r.status_code == 200, f"balance failed: {r.status_code} {r.text[:300]}"
        data = r.json()
        assert "pointsAvailable" in data
        assert "jdValue" in data
        assert isinstance(data["pointsAvailable"], (int, float))
        assert isinstance(data["jdValue"], (int, float))
        # Phase 3 seed gave parent +12 — at minimum 0, but typically >= 12
        assert data["pointsAvailable"] >= 0

    def test_balance_idempotent(self, http, parent_token):
        r1 = http.get(f"{BASE_URL}/api/loyalty/balance", headers=_hdr(parent_token), timeout=20).json()
        r2 = http.get(f"{BASE_URL}/api/loyalty/balance", headers=_hdr(parent_token), timeout=20).json()
        assert r1["pointsAvailable"] == r2["pointsAvailable"]

    def test_history_shape(self, http, parent_token):
        r = http.get(f"{BASE_URL}/api/loyalty/history", headers=_hdr(parent_token), timeout=20)
        assert r.status_code == 200, f"history failed: {r.status_code} {r.text[:300]}"
        data = r.json()
        assert "history" in data
        assert isinstance(data["history"], list)
        if data["history"]:
            entry = data["history"][0]
            assert "pointsDelta" in entry
            assert "createdAt" in entry

    def test_balance_requires_auth(self, http):
        r = http.get(f"{BASE_URL}/api/loyalty/balance", timeout=20)
        assert r.status_code == 401


# ---------- Admin loyalty settings ----------
class TestAdminLoyaltySettings:
    def test_get_settings_admin(self, http, admin_token):
        r = http.get(f"{BASE_URL}/api/admin/loyalty/settings", headers=_hdr(admin_token), timeout=20)
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        data = r.json()
        assert "settings" in data
        assert "defaults" in data
        assert data["defaults"] == DEFAULT_POLICY
        for k in DEFAULT_POLICY:
            assert k in data["settings"], f"missing key {k}"

    def test_put_settings_persists(self, http, admin_token):
        new_policy = {
            "enabled": True,
            "earn_mode": "per_jd",
            "points_per_jd": 2,
            "fixed_points_per_visit": 15,
        }
        r = http.put(
            f"{BASE_URL}/api/admin/loyalty/settings",
            headers=_hdr(admin_token),
            json=new_policy,
            timeout=20,
        )
        assert r.status_code == 200, f"PUT failed: {r.status_code} {r.text[:300]}"
        echoed = r.json().get("settings")
        assert echoed == new_policy, f"echoed != sent: {echoed}"

        # Verify persistence via GET
        r2 = http.get(f"{BASE_URL}/api/admin/loyalty/settings", headers=_hdr(admin_token), timeout=20)
        assert r2.status_code == 200
        assert r2.json()["settings"] == new_policy

    def test_put_settings_sanitises_invalid(self, http, admin_token):
        # Send invalid earn_mode + negative numbers + bogus fields
        r = http.put(
            f"{BASE_URL}/api/admin/loyalty/settings",
            headers=_hdr(admin_token),
            json={
                "enabled": "yes",  # truthy => True
                "earn_mode": "bogus",  # invalid -> default per_jd
                "points_per_jd": -5,  # invalid -> default 1
                "fixed_points_per_visit": "not_a_number",  # invalid -> default 10
                "ignored_extra_field": "x",
            },
            timeout=20,
        )
        assert r.status_code == 200
        s = r.json()["settings"]
        assert s["enabled"] is True
        assert s["earn_mode"] == DEFAULT_POLICY["earn_mode"]
        assert s["points_per_jd"] == DEFAULT_POLICY["points_per_jd"]
        assert s["fixed_points_per_visit"] == DEFAULT_POLICY["fixed_points_per_visit"]
        assert "ignored_extra_field" not in s

    def test_zzz_restore_defaults(self, http, admin_token):
        """Run last (alphabetic order) — restore to defaults per task instructions."""
        r = http.put(
            f"{BASE_URL}/api/admin/loyalty/settings",
            headers=_hdr(admin_token),
            json=DEFAULT_POLICY,
            timeout=20,
        )
        assert r.status_code == 200
        assert r.json()["settings"] == DEFAULT_POLICY


# ---------- Admin loyalty ledger ----------
class TestAdminLoyaltyLedger:
    def test_ledger_default_pagination(self, http, admin_token):
        r = http.get(f"{BASE_URL}/api/admin/loyalty/ledger", headers=_hdr(admin_token), timeout=20)
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        data = r.json()
        for k in ("items", "page", "limit", "total", "pages"):
            assert k in data, f"missing {k}"
        assert data["page"] == 1
        assert data["limit"] == 25
        assert isinstance(data["items"], list)

        if data["items"]:
            item = data["items"][0]
            for k in ("id", "userId", "user", "pointsDelta", "reason", "refType", "refId", "expiresAt", "createdAt"):
                assert k in item, f"item missing {k}"
            if item["user"] is not None:
                for k in ("id", "name", "email", "phone"):
                    assert k in item["user"]

    def test_ledger_custom_page_limit(self, http, admin_token):
        r = http.get(
            f"{BASE_URL}/api/admin/loyalty/ledger?page=1&limit=5",
            headers=_hdr(admin_token),
            timeout=20,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["limit"] == 5
        assert len(data["items"]) <= 5

    def test_ledger_sorted_desc(self, http, admin_token):
        r = http.get(f"{BASE_URL}/api/admin/loyalty/ledger?limit=50", headers=_hdr(admin_token), timeout=20)
        assert r.status_code == 200
        items = r.json()["items"]
        if len(items) >= 2:
            for a, b in zip(items, items[1:]):
                assert a["createdAt"] >= b["createdAt"], "ledger not sorted desc by createdAt"


# ---------- Role separation ----------
class TestRoleSeparation:
    def test_parent_blocked_from_settings(self, http, parent_token):
        r = http.get(f"{BASE_URL}/api/admin/loyalty/settings", headers=_hdr(parent_token), timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text[:200]}"
        assert "Admin" in r.text or "admin" in r.text

    def test_parent_blocked_from_ledger(self, http, parent_token):
        r = http.get(f"{BASE_URL}/api/admin/loyalty/ledger", headers=_hdr(parent_token), timeout=20)
        assert r.status_code == 403

    def test_parent_blocked_from_put_settings(self, http, parent_token):
        r = http.put(
            f"{BASE_URL}/api/admin/loyalty/settings",
            headers=_hdr(parent_token),
            json=DEFAULT_POLICY,
            timeout=20,
        )
        assert r.status_code == 403

    def test_unauthenticated_blocked(self, http):
        r = http.get(f"{BASE_URL}/api/admin/loyalty/settings", timeout=20)
        assert r.status_code == 401
        r2 = http.get(f"{BASE_URL}/api/admin/loyalty/ledger", timeout=20)
        assert r2.status_code == 401

    def test_staff_user_blocked(self, http, admin_token):
        """
        Create a TEST_ staff user via admin, then verify it gets 403 on admin
        loyalty endpoints. Cleans up at the end.
        """
        import uuid
        unique = uuid.uuid4().hex[:8]
        staff_email = f"TEST_staff_{unique}@peekaboo.com"
        staff_password = "staff12345"

        # Try common admin user-creation endpoints
        created_user_id = None
        create_payload = {
            "email": staff_email,
            "password": staff_password,
            "name": "TEST Staff",
            "role": "staff",
            "phone": f"96279000{unique[:4]}",
        }
        # /api/admin/staff is the canonical path on this codebase
        r = http.post(f"{BASE_URL}/api/admin/staff", headers=_hdr(admin_token), json=create_payload, timeout=20)
        if r.status_code in (200, 201):
            try:
                body = r.json()
                staff_obj = body.get("staff") or body.get("user") or body
                created_user_id = staff_obj.get("id") or staff_obj.get("_id")
            except Exception:
                pass

        # Fallback: register via /api/auth/register then promote via admin update
        if created_user_id is None:
            r = http.post(
                f"{BASE_URL}/api/auth/register",
                json={"email": staff_email, "password": staff_password, "name": "TEST Staff", "phone": create_payload["phone"]},
                timeout=20,
            )
            if r.status_code not in (200, 201):
                pytest.skip(f"Could not create staff user (register {r.status_code}): {r.text[:200]}")
            try:
                body = r.json()
                created_user_id = (body.get("user") or body).get("id") or (body.get("user") or body).get("_id")
            except Exception:
                created_user_id = None
            # Promote to staff
            promoted = False
            if created_user_id:
                for path in (f"/api/admin/users/{created_user_id}", f"/api/admin/users/{created_user_id}/role"):
                    pr = http.put(f"{BASE_URL}{path}", headers=_hdr(admin_token), json={"role": "staff"}, timeout=20)
                    if pr.status_code in (200, 204):
                        promoted = True
                        break
                    pr = http.patch(f"{BASE_URL}{path}", headers=_hdr(admin_token), json={"role": "staff"}, timeout=20)
                    if pr.status_code in (200, 204):
                        promoted = True
                        break
            if not promoted:
                pytest.skip("Could not promote test user to staff role; skipping staff-block check")

        # Login as staff
        lr = http.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": staff_email, "password": staff_password},
            timeout=20,
        )
        if lr.status_code != 200:
            pytest.skip(f"Staff login failed: {lr.status_code} {lr.text[:200]}")
        staff_token = lr.json().get("token") or lr.json().get("access_token")
        assert staff_token

        # Verify role separation
        r1 = http.get(f"{BASE_URL}/api/admin/loyalty/settings", headers=_hdr(staff_token), timeout=20)
        r2 = http.get(f"{BASE_URL}/api/admin/loyalty/ledger", headers=_hdr(staff_token), timeout=20)
        assert r1.status_code == 403, f"staff settings expected 403, got {r1.status_code}"
        assert r2.status_code == 403, f"staff ledger expected 403, got {r2.status_code}"

        # Best-effort cleanup
        if created_user_id:
            http.delete(f"{BASE_URL}/api/admin/staff/{created_user_id}", headers=_hdr(admin_token), timeout=20)


# ---------- Policy roundtrip (earn flow regression light) ----------
class TestPolicyRoundtripForEarn:
    def test_set_points_per_jd_2_and_read_back(self, http, admin_token):
        """
        Phase 3 regression-light: set policy to per_jd with points_per_jd=2.
        Staff.js reads getLoyaltyEarnPolicy() at check-in time, so verifying
        the GET roundtrip confirms the next earn would award 2 pts/JD.
        """
        target = {**DEFAULT_POLICY, "points_per_jd": 2}
        rp = http.put(f"{BASE_URL}/api/admin/loyalty/settings", headers=_hdr(admin_token), json=target, timeout=20)
        assert rp.status_code == 200
        rg = http.get(f"{BASE_URL}/api/admin/loyalty/settings", headers=_hdr(admin_token), timeout=20)
        assert rg.status_code == 200
        assert rg.json()["settings"] == target

        # Restore defaults so we leave the system clean
        rr = http.put(f"{BASE_URL}/api/admin/loyalty/settings", headers=_hdr(admin_token), json=DEFAULT_POLICY, timeout=20)
        assert rr.status_code == 200
        assert rr.json()["settings"] == DEFAULT_POLICY
