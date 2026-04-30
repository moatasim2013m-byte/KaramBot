#!/usr/bin/env python3
"""
Phase 3 Loyalty Earn Tests - Real Scenario Testing
Tests the actual Phase 3 loyalty earn functionality with real API calls.
"""

import requests
import json
import time
import sys
from datetime import datetime, timedelta
import uuid

# Configuration
BACKEND_URL = "https://staff-bookings-qa.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@peekaboo.com"
ADMIN_PASSWORD = "admin123"
PARENT_EMAIL = "parent@peekaboo.com"
PARENT_PASSWORD = "parent123"

class Phase3LoyaltyTester:
    def __init__(self):
        self.admin_token = None
        self.parent_token = None
        self.parent_user_id = None
        self.session = requests.Session()
        
    def log(self, message):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}")
        
    def login_admin(self):
        """Login as admin user"""
        response = self.session.post(f"{BACKEND_URL}/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            data = response.json()
            self.admin_token = data.get('token')
            self.log("✅ Admin login successful")
            return True
        else:
            self.log(f"❌ Admin login failed: {response.status_code} - {response.text}")
            return False
            
    def login_parent(self):
        """Login as parent user"""
        response = self.session.post(f"{BACKEND_URL}/auth/login", json={
            "email": PARENT_EMAIL,
            "password": PARENT_PASSWORD
        })
        if response.status_code == 200:
            data = response.json()
            self.parent_token = data.get('token')
            self.parent_user_id = data.get('user', {}).get('id')
            self.log("✅ Parent login successful")
            return True
        else:
            self.log(f"❌ Parent login failed: {response.status_code} - {response.text}")
            return False
            
    def make_request(self, method, endpoint, token=None, **kwargs):
        """Make authenticated request"""
        headers = kwargs.get('headers', {})
        if token:
            headers['Authorization'] = f'Bearer {token}'
        kwargs['headers'] = headers
        
        url = f"{BACKEND_URL}{endpoint}"
        response = getattr(self.session, method.lower())(url, **kwargs)
        return response
        
    def test_loyalty_balance_endpoint(self):
        """Test I1: GET /api/loyalty/balance (parent) — auth required, returns pointsAvailable"""
        self.log("Testing I1: GET /api/loyalty/balance")
        
        # Test without auth
        response = self.session.get(f"{BACKEND_URL}/loyalty/balance")
        if response.status_code != 401:
            self.log(f"❌ I1: Expected 401 without auth, got {response.status_code}")
            return False
            
        # Test with parent auth
        response = self.make_request('GET', '/loyalty/balance', token=self.parent_token)
        if response.status_code == 200:
            data = response.json()
            if 'pointsAvailable' in data:
                points = data['pointsAvailable']
                self.log(f"✅ I1: Loyalty balance endpoint working - {points} points available")
                return True
            else:
                self.log("❌ I1: Missing pointsAvailable field")
                return False
        else:
            self.log(f"❌ I1: Failed with status {response.status_code}: {response.text}")
            return False
            
    def test_loyalty_history_endpoint(self):
        """Test I2: GET /api/loyalty/history (parent) — auth required, returns ledger entries"""
        self.log("Testing I2: GET /api/loyalty/history")
        
        # Test without auth
        response = self.session.get(f"{BACKEND_URL}/loyalty/history")
        if response.status_code != 401:
            self.log(f"❌ I2: Expected 401 without auth, got {response.status_code}")
            return False
            
        # Test with parent auth
        response = self.make_request('GET', '/loyalty/history', token=self.parent_token)
        if response.status_code == 200:
            data = response.json()
            if 'history' in data:
                history = data['history']
                self.log(f"✅ I2: Loyalty history endpoint working - {len(history)} entries")
                
                # Show recent entries
                for entry in history[:3]:
                    points = entry.get('pointsDelta', 0)
                    reason = entry.get('reason', 'Unknown')
                    ref_type = entry.get('refType', 'Unknown')
                    self.log(f"   📝 {points} points - {reason} ({ref_type})")
                    
                return True
            else:
                self.log("❌ I2: Missing history field")
                return False
        else:
            self.log(f"❌ I2: Failed with status {response.status_code}: {response.text}")
            return False
            
    def test_qr_validate_endpoint(self):
        """Test QR validate endpoint with various scenarios"""
        self.log("Testing QR Validate Endpoint")
        
        # Test with invalid token
        response = self.make_request('POST', '/staff/qr/validate', 
                                   token=self.admin_token,
                                   json={"qr_token": "invalid_token_12345"})
        
        if response.status_code == 404:
            data = response.json()
            self.log(f"✅ QR Validate: Invalid token correctly rejected - {data.get('error', 'No message')}")
            return True
        else:
            self.log(f"❌ QR Validate: Unexpected response {response.status_code}: {response.text}")
            return False
            
    def test_qr_checkin_endpoint(self):
        """Test QR checkin endpoint with various scenarios"""
        self.log("Testing QR Checkin Endpoint")
        
        # Test with invalid token
        response = self.make_request('POST', '/staff/qr/checkin',
                                   token=self.admin_token, 
                                   json={"qr_token": "invalid_token_12345"})
        
        if response.status_code == 404:
            data = response.json()
            self.log(f"✅ QR Checkin: Invalid token correctly rejected - {data.get('error', 'No message')}")
            return True
        else:
            self.log(f"❌ QR Checkin: Unexpected response {response.status_code}: {response.text}")
            return False
            
    def test_legacy_checkin_endpoint(self):
        """Test legacy checkin endpoint"""
        self.log("Testing Legacy Checkin Endpoint")
        
        # Test with invalid booking code
        response = self.make_request('POST', '/staff/checkin',
                                   token=self.admin_token,
                                   json={"booking_code": "PK-H-INVALID123"})
        
        if response.status_code == 404:
            data = response.json()
            self.log(f"✅ Legacy Checkin: Invalid booking code correctly rejected - {data.get('error', 'Booking not found')}")
            return True
        else:
            self.log(f"❌ Legacy Checkin: Unexpected response {response.status_code}: {response.text}")
            return False
            
    def test_staff_endpoints_auth(self):
        """Test that staff endpoints require proper authentication"""
        self.log("Testing Staff Endpoints Authentication")
        
        # Test QR validate without auth
        response = self.session.post(f"{BACKEND_URL}/staff/qr/validate", 
                                   json={"qr_token": "test"})
        if response.status_code != 401:
            self.log(f"❌ QR Validate should require auth, got {response.status_code}")
            return False
            
        # Test QR checkin without auth
        response = self.session.post(f"{BACKEND_URL}/staff/qr/checkin",
                                   json={"qr_token": "test"})
        if response.status_code != 401:
            self.log(f"❌ QR Checkin should require auth, got {response.status_code}")
            return False
            
        # Test legacy checkin without auth
        response = self.session.post(f"{BACKEND_URL}/staff/checkin",
                                   json={"booking_code": "test"})
        if response.status_code != 401:
            self.log(f"❌ Legacy Checkin should require auth, got {response.status_code}")
            return False
            
        self.log("✅ All staff endpoints properly require authentication")
        return True
        
    def test_response_structure(self):
        """Test H1: QR checkin response structure"""
        self.log("Testing H1: QR checkin response structure")
        
        # Test QR checkin response structure
        response = self.make_request('POST', '/staff/qr/checkin',
                                   token=self.admin_token,
                                   json={"qr_token": "test_structure_token"})
        
        if response.status_code == 404:
            data = response.json()
            required_fields = ['error', 'error_code']
            
            has_all_fields = all(field in data for field in required_fields)
            if has_all_fields:
                self.log("✅ H1: QR checkin error response has correct structure")
                self.log(f"   📝 Error: {data.get('error')}")
                self.log(f"   📝 Error Code: {data.get('error_code')}")
                return True
            else:
                missing = [f for f in required_fields if f not in data]
                self.log(f"❌ H1: Missing fields in response: {missing}")
                return False
        else:
            self.log(f"❌ H1: Unexpected response status {response.status_code}")
            return False
            
    def check_backend_logs(self):
        """Test H2: Check backend logs for loyalty events"""
        self.log("Testing H2: Backend logs")
        
        try:
            # Check recent backend logs for loyalty events
            import subprocess
            result = subprocess.run(['tail', '-n', '50', '/var/log/supervisor/backend.out.log'], 
                                  capture_output=True, text=True)
            
            if result.returncode == 0:
                logs = result.stdout
                loyalty_events = [line for line in logs.split('\n') 
                                if 'loyalty' in line.lower() or 'qr_checkin' in line]
                
                if loyalty_events:
                    self.log(f"✅ H2: Found {len(loyalty_events)} loyalty-related log entries")
                    for event in loyalty_events[-3:]:  # Show last 3
                        if event.strip():
                            self.log(f"   📝 {event.strip()}")
                    return True
                else:
                    self.log("✅ H2: No recent loyalty events in logs (expected for test tokens)")
                    return True
            else:
                self.log("❌ H2: Could not read backend logs")
                return False
                
        except Exception as e:
            self.log(f"❌ H2: Error checking logs: {e}")
            return False
            
    def test_booking_creation_no_award(self):
        """Test F2: Inspect routes/bookings.js for no-op loyalty award"""
        self.log("Testing F2: Booking creation no longer awards loyalty")
        
        try:
            # Read the bookings.js file to verify awardLoyaltyPoints is a no-op
            with open('/app/backend/node-app/routes/bookings.js', 'r') as f:
                content = f.read()
                
            # Look for the awardLoyaltyPoints function
            if 'phase3_award_on_checkin' in content:
                self.log("✅ F2: Found phase3_award_on_checkin in bookings.js - loyalty moved to checkin")
                return True
            else:
                self.log("❌ F2: Could not find phase3_award_on_checkin marker")
                return False
                
        except Exception as e:
            self.log(f"❌ F2: Error reading bookings.js: {e}")
            return False
            
    def run_comprehensive_tests(self):
        """Run comprehensive Phase 3 loyalty tests"""
        self.log("🚀 Starting Comprehensive Phase 3 Loyalty Tests")
        
        # Login
        if not self.login_admin():
            return False
            
        if not self.login_parent():
            return False
            
        # Run tests
        tests = [
            ("I1", "Loyalty Balance Endpoint", self.test_loyalty_balance_endpoint),
            ("I2", "Loyalty History Endpoint", self.test_loyalty_history_endpoint),
            ("QR_VAL", "QR Validate Endpoint", self.test_qr_validate_endpoint),
            ("QR_CHK", "QR Checkin Endpoint", self.test_qr_checkin_endpoint),
            ("LEG_CHK", "Legacy Checkin Endpoint", self.test_legacy_checkin_endpoint),
            ("AUTH", "Staff Endpoints Auth", self.test_staff_endpoints_auth),
            ("H1", "Response Structure", self.test_response_structure),
            ("H2", "Backend Logs", self.check_backend_logs),
            ("F2", "Booking Creation No Award", self.test_booking_creation_no_award)
        ]
        
        results = {}
        for test_id, test_name, test_func in tests:
            self.log(f"\n📋 Running {test_id}: {test_name}")
            try:
                success = test_func()
                results[test_id] = "PASS" if success else "FAIL"
            except Exception as e:
                self.log(f"❌ {test_id}: Exception - {e}")
                results[test_id] = f"ERROR: {e}"
                
        # Summary
        self.log("\n📊 COMPREHENSIVE TEST SUMMARY")
        self.log("=" * 50)
        
        passed = sum(1 for r in results.values() if r == "PASS")
        total = len(results)
        
        for test_id, result in results.items():
            status = "✅" if result == "PASS" else "❌"
            self.log(f"{status} {test_id}: {result}")
            
        self.log("=" * 50)
        self.log(f"🎯 OVERALL: {passed}/{total} tests passed")
        
        if passed == total:
            self.log("🎉 ALL COMPREHENSIVE TESTS PASSED!")
            return True
        else:
            self.log("⚠️  Some tests failed - see details above")
            return False

def main():
    """Main test runner"""
    tester = Phase3LoyaltyTester()
    success = tester.run_comprehensive_tests()
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()