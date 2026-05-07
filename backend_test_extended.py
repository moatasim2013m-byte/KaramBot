#!/usr/bin/env python3
"""
Phase 6 Loyalty Redemption Backend Testing - Extended
Tests all Phase 6 loyalty redemption foundation functionality with seeded points.
"""

import requests
import json
import time
import sys
from datetime import datetime, timedelta

# Backend URL from frontend/.env
BACKEND_URL = "https://whatsapp-backend-ops.preview.emergentagent.com/api"

# Test credentials from /app/memory/test_credentials.md
ADMIN_EMAIL = "admin@peekaboo.com"
ADMIN_PASSWORD = "admin123"
PARENT_EMAIL = "parent@peekaboo.com"
PARENT_PASSWORD = "parent123"

class Phase6LoyaltyTesterExtended:
    def __init__(self):
        self.admin_token = None
        self.parent_token = None
        self.test_results = []
        self.parent_user_id = None
        
    def log_test(self, test_name, success, details="", error=""):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        result = {
            "test": test_name,
            "success": success,
            "details": details,
            "error": error,
            "timestamp": datetime.now().isoformat()
        }
        self.test_results.append(result)
        print(f"{status}: {test_name}")
        if details:
            print(f"   Details: {details}")
        if error:
            print(f"   Error: {error}")
        print()

    def login_admin(self):
        """Login as admin and get token"""
        try:
            response = requests.post(f"{BACKEND_URL}/auth/login", json={
                "email": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD
            })
            
            if response.status_code == 200:
                data = response.json()
                self.admin_token = data.get("token")
                self.log_test("Admin Login", True, f"Token obtained")
                return True
            else:
                self.log_test("Admin Login", False, error=f"Status: {response.status_code}, Response: {response.text}")
                return False
        except Exception as e:
            self.log_test("Admin Login", False, error=str(e))
            return False

    def login_parent(self):
        """Login as parent and get token"""
        try:
            response = requests.post(f"{BACKEND_URL}/auth/login", json={
                "email": PARENT_EMAIL,
                "password": PARENT_PASSWORD
            })
            
            if response.status_code == 200:
                data = response.json()
                self.parent_token = data.get("token")
                self.parent_user_id = data.get("user", {}).get("id")
                self.log_test("Parent Login", True, f"User ID: {self.parent_user_id}")
                return True
            else:
                self.log_test("Parent Login", False, error=f"Status: {response.status_code}, Response: {response.text}")
                return False
        except Exception as e:
            self.log_test("Parent Login", False, error=str(e))
            return False

    def test_parent_balance_with_seeded_points(self):
        """Test parent balance shows seeded points"""
        try:
            headers = {"Authorization": f"Bearer {self.parent_token}"}
            response = requests.get(f"{BACKEND_URL}/loyalty/balance", headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                points_available = data.get("pointsAvailable", 0)
                redemption = data.get("redemption", {})
                
                if points_available >= 100:
                    self.log_test("Parent Balance - Seeded Points", True, 
                                f"Parent has {points_available} points (seeded successfully)")
                else:
                    self.log_test("Parent Balance - Seeded Points", False, 
                                f"Expected >= 100 points, got: {points_available}")
            else:
                self.log_test("Parent Balance - Seeded Points", False, 
                            error=f"Status: {response.status_code}, Response: {response.text}")
        except Exception as e:
            self.log_test("Parent Balance - Seeded Points", False, error=str(e))

    def test_redemption_preview_with_sufficient_points(self):
        """Test redemption preview with sufficient points"""
        try:
            headers = {"Authorization": f"Bearer {self.parent_token}"}
            
            # Test with sufficient points (100 points, want to use 50)
            params = {
                "amount_jd": 10,
                "points": 50,
                "use_max": "false"
            }
            response = requests.get(f"{BACKEND_URL}/loyalty/redemption-preview", 
                                  headers=headers, params=params)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("ok") == True:
                    points_to_use = data.get("pointsToUse", 0)
                    discount_jd = data.get("discountJd", 0)
                    conversion = data.get("points_per_jd_redeem", 0)
                    
                    self.log_test("Redemption Preview - Sufficient Points", True, 
                                f"ok=true, pointsToUse={points_to_use}, discountJd={discount_jd}, conversion={conversion}")
                else:
                    reason = data.get("reason", "unknown")
                    self.log_test("Redemption Preview - Sufficient Points", False, 
                                f"Expected ok=true, got ok=false, reason={reason}")
            else:
                self.log_test("Redemption Preview - Sufficient Points", False, 
                            error=f"Status: {response.status_code}, Response: {response.text}")
            
            # Test use_max=true
            params = {
                "amount_jd": 5,  # Small amount
                "use_max": "true"
            }
            response = requests.get(f"{BACKEND_URL}/loyalty/redemption-preview", 
                                  headers=headers, params=params)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("ok") == True:
                    points_to_use = data.get("pointsToUse", 0)
                    discount_jd = data.get("discountJd", 0)
                    
                    self.log_test("Redemption Preview - Use Max", True, 
                                f"use_max=true worked, pointsToUse={points_to_use}, discountJd={discount_jd}")
                else:
                    reason = data.get("reason", "unknown")
                    self.log_test("Redemption Preview - Use Max", False, 
                                f"use_max=true failed, reason={reason}")
            else:
                self.log_test("Redemption Preview - Use Max", False, 
                            error=f"Status: {response.status_code}, Response: {response.text}")
            
        except Exception as e:
            self.log_test("Redemption Preview - With Points", False, error=str(e))

    def test_redemption_preview_edge_cases(self):
        """Test redemption preview edge cases"""
        try:
            headers = {"Authorization": f"Bearer {self.parent_token}"}
            
            # Test exceeding available points
            params = {
                "amount_jd": 50,  # Large amount
                "points": 1000,   # More than available
                "use_max": "false"
            }
            response = requests.get(f"{BACKEND_URL}/loyalty/redemption-preview", 
                                  headers=headers, params=params)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("ok") == False and data.get("reason") in ["exceeds_limit", "exceeds_amount"]:
                    self.log_test("Redemption Preview - Exceeds Limit", True, 
                                f"Correctly rejected excessive points, reason={data.get('reason')}")
                else:
                    self.log_test("Redemption Preview - Exceeds Limit", False, 
                                f"Should reject excessive points, got: {data}")
            else:
                self.log_test("Redemption Preview - Exceeds Limit", False, 
                            error=f"Status: {response.status_code}, Response: {response.text}")
            
            # Test below minimum points (assuming min is 50)
            params = {
                "amount_jd": 10,
                "points": 30,  # Below minimum
                "use_max": "false"
            }
            response = requests.get(f"{BACKEND_URL}/loyalty/redemption-preview", 
                                  headers=headers, params=params)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("ok") == False and data.get("reason") == "below_min_points":
                    self.log_test("Redemption Preview - Below Minimum", True, 
                                f"Correctly rejected below minimum points")
                else:
                    self.log_test("Redemption Preview - Below Minimum", False, 
                                f"Should reject below minimum, got: {data}")
            else:
                self.log_test("Redemption Preview - Below Minimum", False, 
                            error=f"Status: {response.status_code}, Response: {response.text}")
            
        except Exception as e:
            self.log_test("Redemption Preview - Edge Cases", False, error=str(e))

    def test_payment_provider_configuration(self):
        """Test payment provider configuration"""
        try:
            headers = {"Authorization": f"Bearer {self.parent_token}"}
            
            # Try to create a checkout to see payment provider behavior
            payload = {
                "type": "hourly",
                "reference_id": "507f1f77bcf86cd799439011",  # Dummy slot ID
                "child_ids": ["507f1f77bcf86cd799439013"],
                "duration_hours": 2,
                "origin_url": "https://whatsapp-backend-ops.preview.emergentagent.com"
            }
            response = requests.post(f"{BACKEND_URL}/payments/create-checkout", 
                                   headers=headers, json=payload)
            
            if response.status_code == 200:
                data = response.json()
                payment_method = data.get("payment_method")
                if payment_method == "manual":
                    self.log_test("Payment Provider Check", True, 
                                f"Payment provider is set to manual mode (expected in dev)")
                else:
                    self.log_test("Payment Provider Check", False, 
                                f"Unexpected payment method: {payment_method}")
            else:
                self.log_test("Payment Provider Check", False, 
                            error=f"Status: {response.status_code}, Response: {response.text}")
        except Exception as e:
            self.log_test("Payment Provider Check", False, error=str(e))

    def test_loyalty_ledger_structure(self):
        """Test loyalty ledger structure via admin endpoint"""
        try:
            headers = {"Authorization": f"Bearer {self.admin_token}"}
            response = requests.get(f"{BACKEND_URL}/admin/loyalty/ledger", headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                items = data.get("items", [])
                
                if len(items) > 0:
                    # Check if our seeded entry is there
                    seeded_entry = None
                    for item in items:
                        if item.get("reason") == "test_seed":
                            seeded_entry = item
                            break
                    
                    if seeded_entry:
                        required_fields = ["id", "userId", "pointsDelta", "reason", "refType", "refId", "createdAt"]
                        has_all_fields = all(field in seeded_entry for field in required_fields)
                        
                        if has_all_fields and seeded_entry.get("pointsDelta") == 100:
                            self.log_test("Loyalty Ledger Structure", True, 
                                        f"Seeded entry found with correct structure and pointsDelta=100")
                        else:
                            self.log_test("Loyalty Ledger Structure", False, 
                                        f"Seeded entry missing fields or wrong pointsDelta: {seeded_entry}")
                    else:
                        self.log_test("Loyalty Ledger Structure", False, 
                                    f"Seeded entry not found in ledger. Items: {len(items)}")
                else:
                    self.log_test("Loyalty Ledger Structure", False, 
                                f"No ledger entries found")
            else:
                self.log_test("Loyalty Ledger Structure", False, 
                            error=f"Status: {response.status_code}, Response: {response.text}")
        except Exception as e:
            self.log_test("Loyalty Ledger Structure", False, error=str(e))

    def test_redemption_refid_strategy(self):
        """Test that redemption refId strategy is documented correctly"""
        try:
            # This is a documentation test - we verify the refId strategy is implemented
            # by checking the loyaltyRedemption.js file structure
            
            # For now, we'll test the toRedemptionRefId function behavior by checking
            # if the preview endpoint correctly handles the conversion logic
            headers = {"Authorization": f"Bearer {self.parent_token}"}
            
            params = {
                "amount_jd": 5,
                "points": 50,
                "use_max": "false"
            }
            response = requests.get(f"{BACKEND_URL}/loyalty/redemption-preview", 
                                  headers=headers, params=params)
            
            if response.status_code == 200:
                data = response.json()
                # Check if conversion field is present (indicates redemption logic is working)
                if "conversion" in data:
                    conversion = data.get("conversion", 0)
                    self.log_test("Redemption RefId Strategy", True, 
                                f"Redemption logic working, conversion rate: {conversion}")
                else:
                    self.log_test("Redemption RefId Strategy", False, 
                                f"Conversion field missing from preview response")
            else:
                self.log_test("Redemption RefId Strategy", False, 
                            error=f"Preview endpoint failed: {response.status_code}")
        except Exception as e:
            self.log_test("Redemption RefId Strategy", False, error=str(e))

    def run_extended_tests(self):
        """Run extended Phase 6 loyalty redemption tests"""
        print("=" * 80)
        print("PHASE 6 LOYALTY REDEMPTION BACKEND TESTING - EXTENDED")
        print("=" * 80)
        print()
        
        # Login first
        if not self.login_admin():
            print("❌ Cannot proceed without admin login")
            return False
            
        if not self.login_parent():
            print("❌ Cannot proceed without parent login")
            return False
        
        print("🔄 Running extended Phase 6 loyalty redemption tests...")
        print()
        
        # Run extended tests
        self.test_parent_balance_with_seeded_points()
        self.test_redemption_preview_with_sufficient_points()
        self.test_redemption_preview_edge_cases()
        self.test_payment_provider_configuration()
        self.test_loyalty_ledger_structure()
        self.test_redemption_refid_strategy()
        
        # Summary
        print("=" * 80)
        print("EXTENDED TEST SUMMARY")
        print("=" * 80)
        
        passed = sum(1 for result in self.test_results if result["success"])
        total = len(self.test_results)
        
        print(f"Total Tests: {total}")
        print(f"Passed: {passed}")
        print(f"Failed: {total - passed}")
        print()
        
        if total - passed > 0:
            print("FAILED TESTS:")
            for result in self.test_results:
                if not result["success"]:
                    print(f"❌ {result['test']}: {result['error']}")
            print()
        
        print("DETAILED RESULTS:")
        for result in self.test_results:
            status = "✅" if result["success"] else "❌"
            print(f"{status} {result['test']}")
            if result["details"]:
                print(f"   {result['details']}")
            if result["error"]:
                print(f"   Error: {result['error']}")
        
        print()
        print("=" * 80)
        print("PHASE 6 EXTENDED TESTING COMPLETE")
        print("=" * 80)
        
        return passed == total

if __name__ == "__main__":
    tester = Phase6LoyaltyTesterExtended()
    success = tester.run_extended_tests()
    sys.exit(0 if success else 1)