#!/usr/bin/env python3
"""
Phase 4 Loyalty Backend Verification Script

This script performs comprehensive testing of all Phase 4 loyalty endpoints
as specified in the review request.
"""

import os
import requests
import json
import sys
from typing import Dict, Any, List, Tuple

# Configuration
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://codebases.preview.emergentagent.com").rstrip("/")
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

class TestResult:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.results = []
        
    def add_result(self, test_name: str, passed: bool, details: str = ""):
        self.results.append({
            "test": test_name,
            "passed": passed,
            "details": details
        })
        if passed:
            self.passed += 1
        else:
            self.failed += 1
            
    def print_summary(self):
        print(f"\n{'='*80}")
        print(f"PHASE 4 LOYALTY BACKEND VERIFICATION SUMMARY")
        print(f"{'='*80}")
        print(f"Total Tests: {self.passed + self.failed}")
        print(f"Passed: {self.passed}")
        print(f"Failed: {self.failed}")
        print(f"Success Rate: {(self.passed/(self.passed + self.failed)*100):.1f}%")
        
        if self.failed > 0:
            print(f"\n❌ FAILED TESTS:")
            for result in self.results:
                if not result["passed"]:
                    print(f"  - {result['test']}: {result['details']}")
        
        print(f"\n✅ PASSED TESTS:")
        for result in self.results:
            if result["passed"]:
                print(f"  - {result['test']}")

def login(email: str, password: str) -> Tuple[str, Dict]:
    """Login and return token and user info"""
    try:
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": email, "password": password},
            timeout=20
        )
        if response.status_code != 200:
            raise Exception(f"Login failed: {response.status_code} {response.text[:200]}")
        
        data = response.json()
        token = data.get("token") or data.get("access_token")
        if not token:
            raise Exception(f"No token in login response: {data}")
        
        return token, data.get("user", {})
    except Exception as e:
        raise Exception(f"Login error for {email}: {str(e)}")

def make_request(method: str, endpoint: str, token: str = None, json_data: Dict = None, params: Dict = None) -> requests.Response:
    """Make HTTP request with optional auth"""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    url = f"{BASE_URL}{endpoint}"
    
    try:
        if method.upper() == "GET":
            return requests.get(url, headers=headers, params=params, timeout=20)
        elif method.upper() == "POST":
            return requests.post(url, headers=headers, json=json_data, timeout=20)
        elif method.upper() == "PUT":
            return requests.put(url, headers=headers, json=json_data, timeout=20)
        else:
            raise ValueError(f"Unsupported method: {method}")
    except Exception as e:
        raise Exception(f"Request failed: {str(e)}")

def test_loyalty_balance(result: TestResult, parent_token: str):
    """Test GET /api/loyalty/balance endpoint"""
    print("\n🔍 Testing GET /api/loyalty/balance...")
    
    # Test 1: 401 without token
    try:
        r = make_request("GET", "/api/loyalty/balance")
        if r.status_code == 401:
            result.add_result("Balance - 401 without token", True)
        else:
            result.add_result("Balance - 401 without token", False, f"Expected 401, got {r.status_code}")
    except Exception as e:
        result.add_result("Balance - 401 without token", False, str(e))
    
    # Test 2: 200 with parent token and pointsAvailable field
    try:
        r = make_request("GET", "/api/loyalty/balance", parent_token)
        if r.status_code == 200:
            data = r.json()
            if "pointsAvailable" in data and isinstance(data["pointsAvailable"], (int, float)):
                result.add_result("Balance - 200 with parent token + pointsAvailable", True, f"Points: {data['pointsAvailable']}")
            else:
                result.add_result("Balance - 200 with parent token + pointsAvailable", False, f"Missing or invalid pointsAvailable: {data}")
        else:
            result.add_result("Balance - 200 with parent token + pointsAvailable", False, f"Expected 200, got {r.status_code}: {r.text[:200]}")
    except Exception as e:
        result.add_result("Balance - 200 with parent token + pointsAvailable", False, str(e))

def test_loyalty_history(result: TestResult, parent_token: str):
    """Test GET /api/loyalty/history endpoint"""
    print("\n🔍 Testing GET /api/loyalty/history...")
    
    # Test 1: 401 without token
    try:
        r = make_request("GET", "/api/loyalty/history")
        if r.status_code == 401:
            result.add_result("History - 401 without token", True)
        else:
            result.add_result("History - 401 without token", False, f"Expected 401, got {r.status_code}")
    except Exception as e:
        result.add_result("History - 401 without token", False, str(e))
    
    # Test 2: 200 with parent token and proper structure
    try:
        r = make_request("GET", "/api/loyalty/history", parent_token)
        if r.status_code == 200:
            data = r.json()
            if "history" in data and isinstance(data["history"], list):
                result.add_result("History - 200 with parent token + proper structure", True, f"Entries: {len(data['history'])}")
            else:
                result.add_result("History - 200 with parent token + proper structure", False, f"Invalid structure: {data}")
        else:
            result.add_result("History - 200 with parent token + proper structure", False, f"Expected 200, got {r.status_code}: {r.text[:200]}")
    except Exception as e:
        result.add_result("History - 200 with parent token + proper structure", False, str(e))

def test_admin_loyalty_settings_get(result: TestResult, admin_token: str, parent_token: str):
    """Test GET /api/admin/loyalty/settings endpoint"""
    print("\n🔍 Testing GET /api/admin/loyalty/settings...")
    
    # Test 1: 401 without token
    try:
        r = make_request("GET", "/api/admin/loyalty/settings")
        if r.status_code == 401:
            result.add_result("Admin Settings GET - 401 without token", True)
        else:
            result.add_result("Admin Settings GET - 401 without token", False, f"Expected 401, got {r.status_code}")
    except Exception as e:
        result.add_result("Admin Settings GET - 401 without token", False, str(e))
    
    # Test 2: 403 with parent token
    try:
        r = make_request("GET", "/api/admin/loyalty/settings", parent_token)
        if r.status_code == 403:
            result.add_result("Admin Settings GET - 403 with parent token", True)
        else:
            result.add_result("Admin Settings GET - 403 with parent token", False, f"Expected 403, got {r.status_code}")
    except Exception as e:
        result.add_result("Admin Settings GET - 403 with parent token", False, str(e))
    
    # Test 3: 200 with admin token and proper structure
    try:
        r = make_request("GET", "/api/admin/loyalty/settings", admin_token)
        if r.status_code == 200:
            data = r.json()
            if "settings" in data and "defaults" in data:
                settings = data["settings"]
                defaults = data["defaults"]
                if defaults == DEFAULT_POLICY:
                    result.add_result("Admin Settings GET - 200 with admin token + proper structure", True, f"Settings: {settings}")
                else:
                    result.add_result("Admin Settings GET - 200 with admin token + proper structure", False, f"Defaults mismatch: {defaults}")
            else:
                result.add_result("Admin Settings GET - 200 with admin token + proper structure", False, f"Invalid structure: {data}")
        else:
            result.add_result("Admin Settings GET - 200 with admin token + proper structure", False, f"Expected 200, got {r.status_code}: {r.text[:200]}")
    except Exception as e:
        result.add_result("Admin Settings GET - 200 with admin token + proper structure", False, str(e))

def test_admin_loyalty_settings_put(result: TestResult, admin_token: str, parent_token: str):
    """Test PUT /api/admin/loyalty/settings endpoint with sanitisation"""
    print("\n🔍 Testing PUT /api/admin/loyalty/settings...")
    
    # Test 1: 403 with parent token
    try:
        r = make_request("PUT", "/api/admin/loyalty/settings", parent_token, DEFAULT_POLICY)
        if r.status_code == 403:
            result.add_result("Admin Settings PUT - 403 with parent token", True)
        else:
            result.add_result("Admin Settings PUT - 403 with parent token", False, f"Expected 403, got {r.status_code}")
    except Exception as e:
        result.add_result("Admin Settings PUT - 403 with parent token", False, str(e))
    
    # Test 2a: Valid policy
    try:
        valid_policy = {
            "enabled": False,
            "earn_mode": "per_visit",
            "points_per_jd": 2,
            "fixed_points_per_visit": 25
        }
        r = make_request("PUT", "/api/admin/loyalty/settings", admin_token, valid_policy)
        if r.status_code == 200:
            data = r.json()
            if data.get("settings") == valid_policy:
                # Verify persistence
                r2 = make_request("GET", "/api/admin/loyalty/settings", admin_token)
                if r2.status_code == 200 and r2.json().get("settings") == valid_policy:
                    result.add_result("Admin Settings PUT - Valid policy persistence", True)
                else:
                    result.add_result("Admin Settings PUT - Valid policy persistence", False, "Policy not persisted")
            else:
                result.add_result("Admin Settings PUT - Valid policy persistence", False, f"Policy mismatch: {data}")
        else:
            result.add_result("Admin Settings PUT - Valid policy persistence", False, f"Expected 200, got {r.status_code}")
    except Exception as e:
        result.add_result("Admin Settings PUT - Valid policy persistence", False, str(e))
    
    # Test 2b: Negative values (should be clamped to defaults)
    try:
        negative_policy = {
            "points_per_jd": -5,
            "fixed_points_per_visit": -1
        }
        r = make_request("PUT", "/api/admin/loyalty/settings", admin_token, negative_policy)
        if r.status_code == 200:
            data = r.json()
            settings = data.get("settings", {})
            if settings.get("points_per_jd") == DEFAULT_POLICY["points_per_jd"] and settings.get("fixed_points_per_visit") == DEFAULT_POLICY["fixed_points_per_visit"]:
                result.add_result("Admin Settings PUT - Negative values clamped", True)
            else:
                result.add_result("Admin Settings PUT - Negative values clamped", False, f"Values not clamped: {settings}")
        else:
            result.add_result("Admin Settings PUT - Negative values clamped", False, f"Expected 200, got {r.status_code}")
    except Exception as e:
        result.add_result("Admin Settings PUT - Negative values clamped", False, str(e))
    
    # Test 2c: Non-finite/non-numeric values
    try:
        invalid_policy = {
            "points_per_jd": "abc",
            "fixed_points_per_visit": None
        }
        r = make_request("PUT", "/api/admin/loyalty/settings", admin_token, invalid_policy)
        if r.status_code == 200:
            data = r.json()
            settings = data.get("settings", {})
            if settings.get("points_per_jd") == DEFAULT_POLICY["points_per_jd"] and settings.get("fixed_points_per_visit") == DEFAULT_POLICY["fixed_points_per_visit"]:
                result.add_result("Admin Settings PUT - Non-numeric values fallback", True)
            else:
                result.add_result("Admin Settings PUT - Non-numeric values fallback", False, f"Values not defaulted: {settings}")
        else:
            result.add_result("Admin Settings PUT - Non-numeric values fallback", False, f"Expected 200, got {r.status_code}")
    except Exception as e:
        result.add_result("Admin Settings PUT - Non-numeric values fallback", False, str(e))
    
    # Test 2d: Unknown earn_mode
    try:
        unknown_mode_policy = {
            "earn_mode": "moon_points"
        }
        r = make_request("PUT", "/api/admin/loyalty/settings", admin_token, unknown_mode_policy)
        if r.status_code == 200:
            data = r.json()
            settings = data.get("settings", {})
            if settings.get("earn_mode") == DEFAULT_POLICY["earn_mode"]:
                result.add_result("Admin Settings PUT - Unknown earn_mode fallback", True)
            else:
                result.add_result("Admin Settings PUT - Unknown earn_mode fallback", False, f"earn_mode not defaulted: {settings}")
        else:
            result.add_result("Admin Settings PUT - Unknown earn_mode fallback", False, f"Expected 200, got {r.status_code}")
    except Exception as e:
        result.add_result("Admin Settings PUT - Unknown earn_mode fallback", False, str(e))
    
    # Test 2e: Missing enabled (should default to true)
    try:
        no_enabled_policy = {
            "earn_mode": "per_jd",
            "points_per_jd": 1,
            "fixed_points_per_visit": 10
        }
        r = make_request("PUT", "/api/admin/loyalty/settings", admin_token, no_enabled_policy)
        if r.status_code == 200:
            data = r.json()
            settings = data.get("settings", {})
            if settings.get("enabled") is True:
                result.add_result("Admin Settings PUT - Missing enabled defaults to true", True)
            else:
                result.add_result("Admin Settings PUT - Missing enabled defaults to true", False, f"enabled not defaulted: {settings}")
        else:
            result.add_result("Admin Settings PUT - Missing enabled defaults to true", False, f"Expected 200, got {r.status_code}")
    except Exception as e:
        result.add_result("Admin Settings PUT - Missing enabled defaults to true", False, str(e))
    
    # Restore defaults at the end
    try:
        r = make_request("PUT", "/api/admin/loyalty/settings", admin_token, DEFAULT_POLICY)
        if r.status_code == 200:
            r2 = make_request("GET", "/api/admin/loyalty/settings", admin_token)
            if r2.status_code == 200 and r2.json().get("settings") == DEFAULT_POLICY:
                result.add_result("Admin Settings PUT - Restore defaults", True)
            else:
                result.add_result("Admin Settings PUT - Restore defaults", False, "Failed to restore defaults")
        else:
            result.add_result("Admin Settings PUT - Restore defaults", False, f"Expected 200, got {r.status_code}")
    except Exception as e:
        result.add_result("Admin Settings PUT - Restore defaults", False, str(e))

def test_admin_loyalty_ledger(result: TestResult, admin_token: str, parent_token: str):
    """Test GET /api/admin/loyalty/ledger endpoint"""
    print("\n🔍 Testing GET /api/admin/loyalty/ledger...")
    
    # Test 1: 403 with parent token
    try:
        r = make_request("GET", "/api/admin/loyalty/ledger", parent_token)
        if r.status_code == 403:
            result.add_result("Admin Ledger - 403 with parent token", True)
        else:
            result.add_result("Admin Ledger - 403 with parent token", False, f"Expected 403, got {r.status_code}")
    except Exception as e:
        result.add_result("Admin Ledger - 403 with parent token", False, str(e))
    
    # Test 2: Default call with admin token
    try:
        r = make_request("GET", "/api/admin/loyalty/ledger", admin_token)
        if r.status_code == 200:
            data = r.json()
            required_keys = ["items", "page", "limit", "total", "pages"]
            if all(key in data for key in required_keys):
                if data["page"] == 1 and data["limit"] == 25 and data["pages"] >= 1:
                    result.add_result("Admin Ledger - Default call structure", True, f"Total: {data['total']}, Items: {len(data['items'])}")
                else:
                    result.add_result("Admin Ledger - Default call structure", False, f"Invalid pagination: {data}")
            else:
                result.add_result("Admin Ledger - Default call structure", False, f"Missing keys: {data}")
        else:
            result.add_result("Admin Ledger - Default call structure", False, f"Expected 200, got {r.status_code}")
    except Exception as e:
        result.add_result("Admin Ledger - Default call structure", False, str(e))
    
    # Test 3: Pagination parameters
    try:
        r = make_request("GET", "/api/admin/loyalty/ledger", admin_token, params={"page": 1, "limit": 5})
        if r.status_code == 200:
            data = r.json()
            if data["page"] == 1 and data["limit"] == 5 and len(data["items"]) <= 5:
                result.add_result("Admin Ledger - Pagination parameters", True)
            else:
                result.add_result("Admin Ledger - Pagination parameters", False, f"Pagination failed: {data}")
        else:
            result.add_result("Admin Ledger - Pagination parameters", False, f"Expected 200, got {r.status_code}")
    except Exception as e:
        result.add_result("Admin Ledger - Pagination parameters", False, str(e))
    
    # Test 4: Limit clamp (should clamp to 100)
    try:
        r = make_request("GET", "/api/admin/loyalty/ledger", admin_token, params={"limit": 9999})
        if r.status_code == 200:
            data = r.json()
            if data["limit"] == 100:
                result.add_result("Admin Ledger - Limit clamp to 100", True)
            else:
                result.add_result("Admin Ledger - Limit clamp to 100", False, f"Limit not clamped: {data['limit']}")
        else:
            result.add_result("Admin Ledger - Limit clamp to 100", False, f"Expected 200, got {r.status_code}")
    except Exception as e:
        result.add_result("Admin Ledger - Limit clamp to 100", False, str(e))
    
    # Test 5: Item structure validation
    try:
        r = make_request("GET", "/api/admin/loyalty/ledger", admin_token)
        if r.status_code == 200:
            data = r.json()
            items = data.get("items", [])
            if items:
                item = items[0]
                required_item_keys = ["id", "userId", "user", "pointsDelta", "reason", "refType", "refId", "expiresAt", "createdAt"]
                if all(key in item for key in required_item_keys):
                    result.add_result("Admin Ledger - Item structure validation", True, f"Sample item keys: {list(item.keys())}")
                else:
                    missing_keys = [key for key in required_item_keys if key not in item]
                    result.add_result("Admin Ledger - Item structure validation", False, f"Missing keys: {missing_keys}")
            else:
                result.add_result("Admin Ledger - Item structure validation", True, "No items to validate (empty ledger)")
        else:
            result.add_result("Admin Ledger - Item structure validation", False, f"Expected 200, got {r.status_code}")
    except Exception as e:
        result.add_result("Admin Ledger - Item structure validation", False, str(e))

def main():
    """Main test execution"""
    print("🚀 Starting Phase 4 Loyalty Backend Verification")
    print(f"Backend URL: {BASE_URL}")
    
    result = TestResult()
    
    try:
        # Login as admin and parent
        print("\n🔐 Logging in...")
        admin_token, admin_user = login(ADMIN_EMAIL, ADMIN_PASSWORD)
        parent_token, parent_user = login(PARENT_EMAIL, PARENT_PASSWORD)
        print(f"✅ Admin login successful: {admin_user.get('email', 'Unknown')}")
        print(f"✅ Parent login successful: {parent_user.get('email', 'Unknown')}")
        
        # Run all tests
        test_loyalty_balance(result, parent_token)
        test_loyalty_history(result, parent_token)
        test_admin_loyalty_settings_get(result, admin_token, parent_token)
        test_admin_loyalty_settings_put(result, admin_token, parent_token)
        test_admin_loyalty_ledger(result, admin_token, parent_token)
        
    except Exception as e:
        print(f"❌ Critical error during testing: {str(e)}")
        result.add_result("Critical Setup Error", False, str(e))
    
    # Print summary
    result.print_summary()
    
    # Return exit code
    return 0 if result.failed == 0 else 1

if __name__ == "__main__":
    sys.exit(main())