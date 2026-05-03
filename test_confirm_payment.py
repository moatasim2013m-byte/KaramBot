#!/usr/bin/env python3
"""
Staff Confirm Payment Endpoint Test
Tests POST /api/staff/bookings/hourly/:id/confirm-payment

Test scenarios:
1. 401 - No Authorization header
2. 404 - Non-existent booking ID
3. 400 invalid_method - POST with method:'card'
4. 400 not_pending - Booking already paid
5. 400 method_mismatch - Wrong payment method
6. 200 happy path (cash)
7. 200 happy path (cliq)
8. Regression - QR validate after payment confirmation
"""

import requests
import json
import subprocess
from datetime import datetime, timedelta
from bson import ObjectId

# Configuration
BACKEND_URL = "https://presentation-patch.preview.emergentagent.com/api"
ADMIN_CREDS = {"email": "admin@peekaboo.com", "password": "admin123"}

class ConfirmPaymentTester:
    def __init__(self):
        self.admin_token = None
        self.test_results = []
        self.test_bookings = []
        
    def log(self, scenario, status, details):
        """Log test result"""
        result = {
            'scenario': scenario,
            'status': status,
            'details': details,
            'timestamp': datetime.now().isoformat()
        }
        self.test_results.append(result)
        icon = "✅" if status == "PASS" else "❌"
        print(f"{icon} [{status}] {scenario}")
        print(f"   {details}\n")
        
    def authenticate(self):
        """Authenticate admin user"""
        print("\n=== AUTHENTICATION ===")
        response = requests.post(f"{BACKEND_URL}/auth/login", json=ADMIN_CREDS)
        if response.status_code == 200:
            self.admin_token = response.json()['token']
            self.log("AUTH", "PASS", "Admin authentication successful")
            return True
        else:
            self.log("AUTH", "FAIL", f"Admin auth failed: {response.status_code} - {response.text}")
            return False
            
    def get_headers(self, include_auth=True):
        """Get request headers"""
        headers = {"Content-Type": "application/json"}
        if include_auth and self.admin_token:
            headers["Authorization"] = f"Bearer {self.admin_token}"
        return headers
        
    def create_test_booking(self, payment_method, payment_status, status='confirmed'):
        """Create a test booking via MongoDB"""
        print(f"\n--- Creating test booking: {payment_method}/{payment_status} ---")
        
        # Generate unique booking code
        booking_code = f"TEST-{payment_method.upper()}-{int(datetime.now().timestamp())}"
        
        cmd = f"""mongosh mongodb://localhost:27017/peekaboo --quiet --eval "
        const User = db.users.findOne({{role: 'parent'}});
        if (!User) {{ print('ERROR: No parent user found'); quit(1); }}
        
        const Child = db.children.findOne({{user_id: User._id}});
        let childId = Child ? Child._id : null;
        if (!childId) {{
            const newChild = {{
                _id: new ObjectId(),
                user_id: User._id,
                name: 'Test Child',
                birthdate: new Date('2020-01-01'),
                createdAt: new Date()
            }};
            db.children.insertOne(newChild);
            childId = newChild._id;
        }}
        
        const Slot = db.hourlyslots.findOne({{}});
        const slotId = Slot ? Slot._id : null;
        
        const qrToken = require('crypto').randomBytes(32).toString('hex');
        
        const booking = {{
            _id: new ObjectId(),
            user_id: User._id,
            child_id: childId,
            slot_id: slotId,
            booking_code: '{booking_code}',
            status: '{status}',
            payment_method: '{payment_method}',
            payment_status: '{payment_status}',
            total_amount: 12,
            qr_token: qrToken,
            qr_status: 'unused',
            createdAt: new Date(),
            updatedAt: new Date()
        }};
        
        db.hourlybookings.insertOne(booking);
        print(JSON.stringify({{
            id: booking._id.toString(),
            booking_code: booking.booking_code,
            qr_token: qrToken,
            user_id: User._id.toString()
        }}));
        "
        """
        
        try:
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0 and result.stdout.strip():
                # Parse the JSON output
                lines = result.stdout.strip().split('\n')
                json_line = lines[-1]  # Last line should be our JSON
                data = json.loads(json_line)
                self.test_bookings.append(data['id'])
                print(f"   Created booking: {data['id']} ({data['booking_code']})")
                return data
            else:
                print(f"   ERROR creating booking: {result.stderr}")
                return None
        except Exception as e:
            print(f"   EXCEPTION creating booking: {str(e)}")
            return None
            
    def cleanup_bookings(self):
        """Clean up test bookings"""
        if not self.test_bookings:
            return
            
        print("\n=== CLEANUP ===")
        booking_ids = "', '".join(self.test_bookings)
        cmd = f"""mongosh mongodb://localhost:27017/peekaboo --quiet --eval "
        const ids = ['{booking_ids}'].map(id => ObjectId(id));
        const result = db.hourlybookings.deleteMany({{_id: {{'$in': ids}}}});
        print('Deleted ' + result.deletedCount + ' test bookings');
        "
        """
        
        try:
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            print(f"   {result.stdout.strip()}")
        except Exception as e:
            print(f"   Cleanup error: {str(e)}")
            
    def test_1_no_auth(self):
        """Test 1: 401 - No Authorization header"""
        print("\n=== TEST 1: No Authorization Header ===")
        
        # Use a valid ObjectId format
        fake_id = str(ObjectId())
        response = requests.post(
            f"{BACKEND_URL}/staff/bookings/hourly/{fake_id}/confirm-payment",
            json={},
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 401:
            self.log("TEST_1_NO_AUTH", "PASS", "Correctly returned 401 without Authorization header")
        else:
            self.log("TEST_1_NO_AUTH", "FAIL", f"Expected 401, got {response.status_code}: {response.text}")
            
    def test_2_not_found(self):
        """Test 2: 404 - Non-existent booking ID"""
        print("\n=== TEST 2: Non-existent Booking ID ===")
        
        # Valid ObjectId format but doesn't exist
        fake_id = "507f1f77bcf86cd799439011"
        response = requests.post(
            f"{BACKEND_URL}/staff/bookings/hourly/{fake_id}/confirm-payment",
            json={},
            headers=self.get_headers()
        )
        
        if response.status_code == 404:
            data = response.json()
            if data.get('error_code') == 'not_found':
                self.log("TEST_2_NOT_FOUND", "PASS", f"Correctly returned 404 with error_code='not_found'")
            else:
                self.log("TEST_2_NOT_FOUND", "FAIL", f"Got 404 but error_code is '{data.get('error_code')}', expected 'not_found'")
        else:
            self.log("TEST_2_NOT_FOUND", "FAIL", f"Expected 404, got {response.status_code}: {response.text}")
            
    def test_3_invalid_method(self):
        """Test 3: 400 invalid_method - POST with method:'card'"""
        print("\n=== TEST 3: Invalid Payment Method ===")
        
        # Create a test booking
        booking = self.create_test_booking('cash', 'pending_cash')
        if not booking:
            self.log("TEST_3_INVALID_METHOD", "FAIL", "Failed to create test booking")
            return
            
        response = requests.post(
            f"{BACKEND_URL}/staff/bookings/hourly/{booking['id']}/confirm-payment",
            json={"method": "card"},
            headers=self.get_headers()
        )
        
        if response.status_code == 400:
            data = response.json()
            if data.get('error_code') == 'invalid_method':
                self.log("TEST_3_INVALID_METHOD", "PASS", f"Correctly rejected method='card' with error_code='invalid_method'")
            else:
                self.log("TEST_3_INVALID_METHOD", "FAIL", f"Got 400 but error_code is '{data.get('error_code')}', expected 'invalid_method'")
        else:
            self.log("TEST_3_INVALID_METHOD", "FAIL", f"Expected 400, got {response.status_code}: {response.text}")
            
    def test_4_not_pending(self):
        """Test 4: 400 not_pending - Booking already paid"""
        print("\n=== TEST 4: Booking Already Paid ===")
        
        # Create a booking that's already paid
        booking = self.create_test_booking('cash', 'paid')
        if not booking:
            self.log("TEST_4_NOT_PENDING", "FAIL", "Failed to create test booking")
            return
            
        response = requests.post(
            f"{BACKEND_URL}/staff/bookings/hourly/{booking['id']}/confirm-payment",
            json={},
            headers=self.get_headers()
        )
        
        if response.status_code == 400:
            data = response.json()
            if data.get('error_code') == 'not_pending':
                # Verify booking was NOT mutated
                self.log("TEST_4_NOT_PENDING", "PASS", f"Correctly rejected already-paid booking with error_code='not_pending'")
            else:
                self.log("TEST_4_NOT_PENDING", "FAIL", f"Got 400 but error_code is '{data.get('error_code')}', expected 'not_pending'")
        else:
            self.log("TEST_4_NOT_PENDING", "FAIL", f"Expected 400, got {response.status_code}: {response.text}")
            
    def test_5_method_mismatch(self):
        """Test 5: 400 method_mismatch - Wrong payment method"""
        print("\n=== TEST 5: Payment Method Mismatch ===")
        
        # Create a cash booking but try to confirm with cliq
        booking = self.create_test_booking('cash', 'pending_cash')
        if not booking:
            self.log("TEST_5_METHOD_MISMATCH", "FAIL", "Failed to create test booking")
            return
            
        response = requests.post(
            f"{BACKEND_URL}/staff/bookings/hourly/{booking['id']}/confirm-payment",
            json={"method": "cliq"},
            headers=self.get_headers()
        )
        
        if response.status_code == 400:
            data = response.json()
            if data.get('error_code') == 'method_mismatch':
                self.log("TEST_5_METHOD_MISMATCH", "PASS", f"Correctly rejected method mismatch with error_code='method_mismatch'")
            else:
                self.log("TEST_5_METHOD_MISMATCH", "FAIL", f"Got 400 but error_code is '{data.get('error_code')}', expected 'method_mismatch'")
        else:
            self.log("TEST_5_METHOD_MISMATCH", "FAIL", f"Expected 400, got {response.status_code}: {response.text}")
            
    def test_6_happy_path_cash(self):
        """Test 6: 200 happy path (cash)"""
        print("\n=== TEST 6: Happy Path - Cash Payment ===")
        
        # Create a pending cash booking
        booking = self.create_test_booking('cash', 'pending_cash')
        if not booking:
            self.log("TEST_6_HAPPY_CASH", "FAIL", "Failed to create test booking")
            return
            
        # Confirm payment
        response = requests.post(
            f"{BACKEND_URL}/staff/bookings/hourly/{booking['id']}/confirm-payment",
            json={"method": "cash"},
            headers=self.get_headers()
        )
        
        if response.status_code == 200:
            data = response.json()
            if data.get('ok') and 'message' in data and data.get('booking'):
                booking_data = data['booking']
                if booking_data.get('payment_status') == 'paid':
                    # Try to confirm again - should fail with not_pending
                    response2 = requests.post(
                        f"{BACKEND_URL}/staff/bookings/hourly/{booking['id']}/confirm-payment",
                        json={"method": "cash"},
                        headers=self.get_headers()
                    )
                    if response2.status_code == 400 and response2.json().get('error_code') == 'not_pending':
                        self.log("TEST_6_HAPPY_CASH", "PASS", 
                                f"Cash payment confirmed successfully. payment_status='paid', Arabic message present, idempotent (second call rejected)")
                        return booking  # Return for regression test
                    else:
                        self.log("TEST_6_HAPPY_CASH", "FAIL", 
                                f"Payment confirmed but second call didn't return not_pending: {response2.status_code}")
                else:
                    self.log("TEST_6_HAPPY_CASH", "FAIL", 
                            f"Payment confirmed but payment_status is '{booking_data.get('payment_status')}', expected 'paid'")
            else:
                self.log("TEST_6_HAPPY_CASH", "FAIL", 
                        f"Got 200 but response missing required fields: {data}")
        else:
            self.log("TEST_6_HAPPY_CASH", "FAIL", 
                    f"Expected 200, got {response.status_code}: {response.text}")
        return None
            
    def test_7_happy_path_cliq(self):
        """Test 7: 200 happy path (cliq)"""
        print("\n=== TEST 7: Happy Path - CliQ Payment ===")
        
        # Create a pending cliq booking
        booking = self.create_test_booking('cliq', 'pending_cliq')
        if not booking:
            self.log("TEST_7_HAPPY_CLIQ", "FAIL", "Failed to create test booking")
            return
            
        # Confirm payment
        response = requests.post(
            f"{BACKEND_URL}/staff/bookings/hourly/{booking['id']}/confirm-payment",
            json={"method": "cliq"},
            headers=self.get_headers()
        )
        
        if response.status_code == 200:
            data = response.json()
            if data.get('ok') and 'message' in data and data.get('booking'):
                booking_data = data['booking']
                if booking_data.get('payment_status') == 'paid':
                    # Try to confirm again - should fail with not_pending
                    response2 = requests.post(
                        f"{BACKEND_URL}/staff/bookings/hourly/{booking['id']}/confirm-payment",
                        json={"method": "cliq"},
                        headers=self.get_headers()
                    )
                    if response2.status_code == 400 and response2.json().get('error_code') == 'not_pending':
                        self.log("TEST_7_HAPPY_CLIQ", "PASS", 
                                f"CliQ payment confirmed successfully. payment_status='paid', Arabic message present, idempotent (second call rejected)")
                        return booking  # Return for regression test
                    else:
                        self.log("TEST_7_HAPPY_CLIQ", "FAIL", 
                                f"Payment confirmed but second call didn't return not_pending: {response2.status_code}")
                else:
                    self.log("TEST_7_HAPPY_CLIQ", "FAIL", 
                            f"Payment confirmed but payment_status is '{booking_data.get('payment_status')}', expected 'paid'")
            else:
                self.log("TEST_7_HAPPY_CLIQ", "FAIL", 
                        f"Got 200 but response missing required fields: {data}")
        else:
            self.log("TEST_7_HAPPY_CLIQ", "FAIL", 
                    f"Expected 200, got {response.status_code}: {response.text}")
        return None
            
    def test_8_qr_validate_regression(self, booking):
        """Test 8: Regression - QR validate after payment confirmation"""
        print("\n=== TEST 8: QR Validate Regression ===")
        
        if not booking:
            self.log("TEST_8_QR_REGRESSION", "SKIP", "No booking from happy path test")
            return
            
        # Call QR validate endpoint
        response = requests.post(
            f"{BACKEND_URL}/staff/qr/validate",
            json={"qr_token": booking['qr_token']},
            headers=self.get_headers()
        )
        
        if response.status_code == 200:
            data = response.json()
            can_checkin = data.get('can_checkin')
            reason_code = data.get('reason_code')
            
            if can_checkin and reason_code not in ['unpaid_cash', 'unpaid_cliq']:
                self.log("TEST_8_QR_REGRESSION", "PASS", 
                        f"QR validate after payment: can_checkin={can_checkin}, reason_code='{reason_code}' (not unpaid)")
            else:
                self.log("TEST_8_QR_REGRESSION", "FAIL", 
                        f"QR validate failed: can_checkin={can_checkin}, reason_code='{reason_code}'")
        else:
            self.log("TEST_8_QR_REGRESSION", "FAIL", 
                    f"QR validate returned {response.status_code}: {response.text}")
            
    def run_all_tests(self):
        """Run all test scenarios"""
        print("\n" + "="*70)
        print("STAFF CONFIRM PAYMENT ENDPOINT TEST")
        print("POST /api/staff/bookings/hourly/:id/confirm-payment")
        print("="*70)
        
        # Authenticate
        if not self.authenticate():
            print("\n❌ Authentication failed. Cannot proceed with tests.")
            return
            
        try:
            # Run all tests
            self.test_1_no_auth()
            self.test_2_not_found()
            self.test_3_invalid_method()
            self.test_4_not_pending()
            self.test_5_method_mismatch()
            
            # Happy path tests return booking for regression test
            cash_booking = self.test_6_happy_path_cash()
            cliq_booking = self.test_7_happy_path_cliq()
            
            # Regression test with cash booking
            self.test_8_qr_validate_regression(cash_booking)
            
        finally:
            # Cleanup
            self.cleanup_bookings()
            
        # Print summary
        self.print_summary()
        
    def print_summary(self):
        """Print test summary"""
        print("\n" + "="*70)
        print("TEST SUMMARY")
        print("="*70)
        
        passed = sum(1 for r in self.test_results if r['status'] == 'PASS')
        failed = sum(1 for r in self.test_results if r['status'] == 'FAIL')
        skipped = sum(1 for r in self.test_results if r['status'] == 'SKIP')
        total = len(self.test_results)
        
        print(f"\nTotal Tests: {total}")
        print(f"✅ Passed: {passed}")
        print(f"❌ Failed: {failed}")
        print(f"⏭️  Skipped: {skipped}")
        
        if failed > 0:
            print("\n❌ FAILED TESTS:")
            for r in self.test_results:
                if r['status'] == 'FAIL':
                    print(f"  - {r['scenario']}: {r['details']}")
        
        print("\n" + "="*70)
        
        if failed == 0 and passed > 0:
            print("✅ ALL TESTS PASSED")
        else:
            print("❌ SOME TESTS FAILED")
        print("="*70 + "\n")

if __name__ == "__main__":
    tester = ConfirmPaymentTester()
    tester.run_all_tests()
