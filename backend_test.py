#!/usr/bin/env python3
"""
Backend Testing for Peekaboo QR Activation Foundation (Phase 1)
Tests all QR-related endpoints and functionality for hourly bookings.
"""

import requests
import json
import time
import os
from datetime import datetime, timedelta

# Get backend URL from environment
BACKEND_URL = os.getenv('REACT_APP_BACKEND_URL', 'https://control-mode-1.preview.emergentagent.com')
API_BASE = f"{BACKEND_URL}/api"

# Admin credentials
ADMIN_EMAIL = "admin@peekaboo.com"
ADMIN_PASSWORD = "admin123"

class PeekabooQRTester:
    def __init__(self):
        self.session = requests.Session()
        self.admin_token = None
        self.test_results = []
        
    def log_result(self, test_name, success, details=""):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        self.test_results.append({
            'test': test_name,
            'success': success,
            'details': details
        })
        print(f"{status}: {test_name}")
        if details:
            print(f"   Details: {details}")
    
    def admin_login(self):
        """Login as admin and get JWT token"""
        try:
            response = self.session.post(f"{API_BASE}/auth/login", json={
                "email": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD
            })
            
            if response.status_code == 200:
                data = response.json()
                self.admin_token = data.get('token')
                self.session.headers.update({'Authorization': f'Bearer {self.admin_token}'})
                self.log_result("Admin Login", True, f"Token received: {self.admin_token[:20]}...")
                return True
            else:
                self.log_result("Admin Login", False, f"Status: {response.status_code}, Response: {response.text}")
                return False
        except Exception as e:
            self.log_result("Admin Login", False, f"Exception: {str(e)}")
            return False
    
    def create_test_booking(self, status="confirmed", payment_status="pending_cash"):
        """Create a test hourly booking using direct MongoDB insertion"""
        try:
            # Use the node snippet provided in the review request
            node_script = f'''
const mongoose=require('mongoose');
const HourlyBooking=require('./models/HourlyBooking');
const TimeSlot=require('./models/TimeSlot');
const User=require('./models/User');
const {{ generateBookingQrPayload }} = require('./utils/bookingQr');
const {{ randomUUID }} = require('crypto');
(async()=>{{
  await mongoose.connect(process.env.MONGO_URL);
  const admin = await User.findOne({{email:'admin@peekaboo.com'}});
  let slot = await TimeSlot.findOne({{slot_type:'hourly'}});
  if(!slot){{ slot = await TimeSlot.create({{date:'2027-01-01',start_time:'10:00',slot_type:'hourly',capacity:10,booked_count:0}}); }}
  const {{ qr_token, qr_code }} = await generateBookingQrPayload();
  const booking_code = 'TEST-' + randomUUID().substring(0,8).toUpperCase();
  const b = await HourlyBooking.create({{
    user_id: admin._id, child_id:null, guest_child_name:'Test Child',
    child_count:1, slot_id: slot._id, duration_hours:2,
    qr_code, qr_token, qr_status:'unused', booking_code,
    status:'{status}', payment_method:'cash', payment_status:'{payment_status}', amount:10
  }});
  console.log(JSON.stringify({{ id:b._id.toString(), booking_code, qr_token }}));
  process.exit(0);
}})();
'''
            
            # Execute the node script
            import subprocess
            result = subprocess.run([
                'node', '-e', node_script
            ], cwd='/app/backend/node-app', capture_output=True, text=True, env={
                **os.environ,
                'MONGO_URL': 'mongodb://localhost:27017/peekaboo'
            })
            
            if result.returncode == 0 and result.stdout.strip():
                booking_data = json.loads(result.stdout.strip())
                self.log_result("Create Test Booking", True, f"Created booking: {booking_data['booking_code']}")
                return booking_data
            else:
                self.log_result("Create Test Booking", False, f"Node script failed: {result.stderr}")
                return None
                
        except Exception as e:
            self.log_result("Create Test Booking", False, f"Exception: {str(e)}")
            return None
    
    def test_qr_validate(self, qr_token, expected_can_checkin=True, expected_reason="ok"):
        """Test POST /api/staff/qr/validate"""
        try:
            response = self.session.post(f"{API_BASE}/staff/qr/validate", json={
                "qr_token": qr_token
            })
            
            if response.status_code == 200:
                data = response.json()
                can_checkin = data.get('can_checkin', False)
                reason_code = data.get('reason_code', '')
                message = data.get('message', '')
                booking = data.get('booking', {})
                
                success = (can_checkin == expected_can_checkin and 
                          reason_code == expected_reason)
                
                details = f"can_checkin={can_checkin}, reason={reason_code}, message='{message}'"
                if booking:
                    details += f", booking_code={booking.get('booking_code')}"
                
                self.log_result("QR Validate", success, details)
                return data
            elif response.status_code == 404:
                success = expected_reason == "not_found"
                self.log_result("QR Validate", success, f"404 Not Found: {response.json()}")
                return response.json()
            else:
                self.log_result("QR Validate", False, f"Status: {response.status_code}, Response: {response.text}")
                return None
                
        except Exception as e:
            self.log_result("QR Validate", False, f"Exception: {str(e)}")
            return None
    
    def test_qr_checkin(self, qr_token, expected_success=True):
        """Test POST /api/staff/qr/checkin"""
        try:
            response = self.session.post(f"{API_BASE}/staff/qr/checkin", json={
                "qr_token": qr_token
            })
            
            if response.status_code == 200:
                data = response.json()
                ok = data.get('ok', False)
                message = data.get('message', '')
                booking = data.get('booking', {})
                
                success = ok == expected_success
                details = f"ok={ok}, message='{message}'"
                if booking:
                    details += f", status={booking.get('status')}, qr_status={booking.get('qr_status')}"
                
                self.log_result("QR Checkin", success, details)
                return data
            elif response.status_code == 409:
                # Already used - check if this was expected
                data = response.json()
                success = not expected_success  # 409 means it was already used
                details = f"409 Already Used: {data.get('error', '')}"
                self.log_result("QR Checkin", success, details)
                return data
            elif response.status_code in [400, 404]:
                data = response.json()
                success = not expected_success
                details = f"{response.status_code}: {data.get('error', '')}"
                self.log_result("QR Checkin", success, details)
                return data
            else:
                self.log_result("QR Checkin", False, f"Status: {response.status_code}, Response: {response.text}")
                return None
                
        except Exception as e:
            self.log_result("QR Checkin", False, f"Exception: {str(e)}")
            return None
    
    def test_legacy_checkin(self, booking_code):
        """Test legacy POST /api/staff/checkin"""
        try:
            response = self.session.post(f"{API_BASE}/staff/checkin", json={
                "booking_code": booking_code
            })
            
            if response.status_code == 200:
                data = response.json()
                success = data.get('success', False)
                details = f"success={success}, message='{data.get('message', '')}'"
                self.log_result("Legacy Checkin", success, details)
                return data
            else:
                self.log_result("Legacy Checkin", False, f"Status: {response.status_code}, Response: {response.text}")
                return None
                
        except Exception as e:
            self.log_result("Legacy Checkin", False, f"Exception: {str(e)}")
            return None
    
    def test_active_sessions(self):
        """Test GET /api/staff/active-sessions"""
        try:
            response = self.session.get(f"{API_BASE}/staff/active-sessions")
            
            if response.status_code == 200:
                data = response.json()
                sessions = data.get('sessions', [])
                details = f"Found {len(sessions)} active sessions"
                if sessions:
                    details += f", first session: {sessions[0].get('booking_code', 'N/A')}"
                
                self.log_result("Active Sessions", True, details)
                return data
            else:
                self.log_result("Active Sessions", False, f"Status: {response.status_code}, Response: {response.text}")
                return None
                
        except Exception as e:
            self.log_result("Active Sessions", False, f"Exception: {str(e)}")
            return None
    
    def test_qr_backfill(self):
        """Test POST /api/staff/qr/backfill (admin-only)"""
        try:
            # First create a legacy booking without qr_token
            node_script = '''
const mongoose=require('mongoose');
const HourlyBooking=require('./models/HourlyBooking');
const TimeSlot=require('./models/TimeSlot');
const User=require('./models/User');
const { randomUUID } = require('crypto');
(async()=>{
  await mongoose.connect(process.env.MONGO_URL);
  const admin = await User.findOne({email:'admin@peekaboo.com'});
  let slot = await TimeSlot.findOne({slot_type:'hourly'});
  if(!slot){ slot = await TimeSlot.create({date:'2027-01-01',start_time:'11:00',slot_type:'hourly',capacity:10,booked_count:0}); }
  const booking_code = 'LEGACY-' + randomUUID().substring(0,8).toUpperCase();
  const b = await HourlyBooking.create({
    user_id: admin._id, child_id:null, guest_child_name:'Legacy Child',
    child_count:1, slot_id: slot._id, duration_hours:2,
    qr_code: 'legacy-qr-code', booking_code,
    status:'confirmed', payment_method:'cash', payment_status:'pending_cash', amount:10
  });
  console.log(JSON.stringify({ id:b._id.toString(), booking_code }));
  process.exit(0);
})();
'''
            
            import subprocess
            result = subprocess.run([
                'node', '-e', node_script
            ], cwd='/app/backend/node-app', capture_output=True, text=True, env={
                **os.environ,
                'MONGO_URL': 'mongodb://localhost:27017/peekaboo'
            })
            
            if result.returncode != 0:
                self.log_result("QR Backfill Setup", False, f"Failed to create legacy booking: {result.stderr}")
                return None
            
            legacy_booking = json.loads(result.stdout.strip())
            
            # Now test the backfill endpoint
            response = self.session.post(f"{API_BASE}/staff/qr/backfill", json={
                "limit": 100
            })
            
            if response.status_code == 200:
                data = response.json()
                ok = data.get('ok', False)
                scanned = data.get('scanned', 0)
                updated = data.get('updated', 0)
                
                success = ok and updated >= 1
                details = f"ok={ok}, scanned={scanned}, updated={updated}"
                self.log_result("QR Backfill", success, details)
                return data
            else:
                self.log_result("QR Backfill", False, f"Status: {response.status_code}, Response: {response.text}")
                return None
                
        except Exception as e:
            self.log_result("QR Backfill", False, f"Exception: {str(e)}")
            return None
    
    def test_invalid_inputs(self):
        """Test various invalid input scenarios"""
        # Test empty body
        try:
            response = self.session.post(f"{API_BASE}/staff/qr/validate", json={})
            if response.status_code == 400:
                data = response.json()
                if 'رمز الحجز مطلوب' in data.get('error', ''):
                    self.log_result("Invalid Input - Empty Body", True, "Correctly rejected empty body")
                else:
                    self.log_result("Invalid Input - Empty Body", False, f"Wrong error message: {data}")
            else:
                self.log_result("Invalid Input - Empty Body", False, f"Expected 400, got {response.status_code}")
        except Exception as e:
            self.log_result("Invalid Input - Empty Body", False, f"Exception: {str(e)}")
        
        # Test unknown token
        try:
            response = self.session.post(f"{API_BASE}/staff/qr/validate", json={
                "qr_token": "unknown-token-12345"
            })
            if response.status_code == 404:
                data = response.json()
                if 'رمز الحجز غير صالح' in data.get('error', ''):
                    self.log_result("Invalid Input - Unknown Token", True, "Correctly rejected unknown token")
                else:
                    self.log_result("Invalid Input - Unknown Token", False, f"Wrong error message: {data}")
            else:
                self.log_result("Invalid Input - Unknown Token", False, f"Expected 404, got {response.status_code}")
        except Exception as e:
            self.log_result("Invalid Input - Unknown Token", False, f"Exception: {str(e)}")
    
    def run_comprehensive_test(self):
        """Run all test scenarios from the review request"""
        print("🚀 Starting Peekaboo QR Activation Foundation Tests")
        print("=" * 60)
        
        # 1. Admin login
        if not self.admin_login():
            print("❌ Cannot proceed without admin login")
            return
        
        # 2. Create fresh confirmed booking and verify qr_token
        print("\n📝 Creating test bookings...")
        confirmed_booking = self.create_test_booking("confirmed", "pending_cash")
        if not confirmed_booking:
            print("❌ Cannot proceed without test booking")
            return
        
        qr_token = confirmed_booking['qr_token']
        booking_code = confirmed_booking['booking_code']
        
        # Verify qr_token is 64-hex
        if len(qr_token) == 64 and all(c in '0123456789abcdef' for c in qr_token.lower()):
            self.log_result("QR Token Format", True, f"64-hex token: {qr_token[:16]}...")
        else:
            self.log_result("QR Token Format", False, f"Invalid format: {qr_token}")
        
        # 3. Validate fresh booking
        print("\n🔍 Testing QR validation...")
        self.test_qr_validate(qr_token, expected_can_checkin=True, expected_reason="ok")
        
        # 4. Check in via QR
        print("\n✅ Testing QR check-in...")
        checkin_result = self.test_qr_checkin(qr_token, expected_success=True)
        
        # 5. Try to check in again (should get 409)
        print("\n🔄 Testing idempotent re-scan...")
        self.test_qr_checkin(qr_token, expected_success=False)
        
        # 6. Validate after check-in (should be already_used)
        print("\n🔍 Testing validation after check-in...")
        self.test_qr_validate(qr_token, expected_can_checkin=False, expected_reason="already_used")
        
        # 7. Test cancelled booking
        print("\n❌ Testing cancelled booking...")
        cancelled_booking = self.create_test_booking("cancelled", "pending_cash")
        if cancelled_booking:
            self.test_qr_validate(cancelled_booking['qr_token'], 
                                expected_can_checkin=False, expected_reason="cancelled")
        
        # 8. Test pending booking
        print("\n⏳ Testing pending booking...")
        pending_booking = self.create_test_booking("pending", "pending_cash")
        if pending_booking:
            self.test_qr_validate(pending_booking['qr_token'], 
                                expected_can_checkin=False, expected_reason="not_active_yet")
        
        # 9. Test legacy checkin flow
        print("\n🔧 Testing legacy check-in flow...")
        legacy_booking = self.create_test_booking("confirmed", "pending_cash")
        if legacy_booking:
            # Check in via legacy endpoint
            self.test_legacy_checkin(legacy_booking['booking_code'])
            # Then validate QR should show already_used
            self.test_qr_validate(legacy_booking['qr_token'], 
                                expected_can_checkin=False, expected_reason="already_used")
        
        # 10. Test active sessions
        print("\n📊 Testing active sessions...")
        self.test_active_sessions()
        
        # 11. Test backfill
        print("\n🔄 Testing QR backfill...")
        self.test_qr_backfill()
        
        # 12-14. Test invalid inputs
        print("\n❌ Testing invalid inputs...")
        self.test_invalid_inputs()
        
        # Summary
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        
        passed = sum(1 for r in self.test_results if r['success'])
        total = len(self.test_results)
        
        for result in self.test_results:
            status = "✅" if result['success'] else "❌"
            print(f"{status} {result['test']}")
        
        print(f"\n🎯 OVERALL: {passed}/{total} tests passed")
        
        if passed == total:
            print("🎉 ALL TESTS PASSED!")
        else:
            print("⚠️  Some tests failed - check details above")
        
        return passed == total

if __name__ == "__main__":
    tester = PeekabooQRTester()
    success = tester.run_comprehensive_test()
    exit(0 if success else 1)