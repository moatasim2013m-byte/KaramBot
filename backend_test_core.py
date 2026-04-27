#!/usr/bin/env python3
"""
Phase 3 Loyalty Earn Foundation - Core Backend Testing
Tests core loyalty award functionality without relying on balance endpoint.
"""

import requests
import json
import subprocess
import os
import time
from datetime import datetime, timedelta

# Configuration
BACKEND_URL = "http://localhost:8001/api"
MONGO_URL = "mongodb://localhost:27017/peekaboo"

# Test credentials
ADMIN_EMAIL = "admin@peekaboo.com"
ADMIN_PASSWORD = "admin123"
PARENT_EMAIL = "parent@peekaboo.com"
PARENT_PASSWORD = "parent123"

class Phase3CoreTester:
    def __init__(self):
        self.admin_token = None
        self.parent_token = None
        self.parent_id = None
        self.test_results = []
        
    def log_result(self, scenario, status, details=""):
        """Log test result"""
        result = f"{scenario}: {status}"
        if details:
            result += f" - {details}"
        self.test_results.append(result)
        print(result)
        
    def login_admin(self):
        """Login as admin and get JWT token"""
        try:
            response = requests.post(f"{BACKEND_URL}/auth/login", json={
                "email": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD
            })
            if response.status_code == 200:
                data = response.json()
                self.admin_token = data.get("token")
                self.log_result("ADMIN_LOGIN", "PASS", "Admin authentication successful")
                return True
            else:
                self.log_result("ADMIN_LOGIN", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
                return False
        except Exception as e:
            self.log_result("ADMIN_LOGIN", "FAIL", f"Exception: {str(e)}")
            return False
            
    def login_parent(self):
        """Login as parent and get JWT token"""
        try:
            response = requests.post(f"{BACKEND_URL}/auth/login", json={
                "email": PARENT_EMAIL,
                "password": PARENT_PASSWORD
            })
            if response.status_code == 200:
                data = response.json()
                self.parent_token = data.get("token")
                # Get parent user ID for loyalty operations
                user_response = requests.get(f"{BACKEND_URL}/auth/me", headers={
                    "Authorization": f"Bearer {self.parent_token}"
                })
                if user_response.status_code == 200:
                    self.parent_id = user_response.json().get("id")
                self.log_result("PARENT_LOGIN", "PASS", "Parent authentication successful")
                return True
            else:
                self.log_result("PARENT_LOGIN", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
                return False
        except Exception as e:
            self.log_result("PARENT_LOGIN", "FAIL", f"Exception: {str(e)}")
            return False
            
    def reset_loyalty_state(self):
        """Reset parent's loyalty state using the provided helper"""
        try:
            cmd = '''cd /app/backend/node-app && MONGO_URL=mongodb://localhost:27017/peekaboo node -e "
const mongoose=require('mongoose');
const User=require('./models/User');
const LoyaltyBalance=require('./models/LoyaltyBalance');
const LoyaltyLedger=require('./models/LoyaltyLedger');
const HourlyBooking=require('./models/HourlyBooking');
(async()=>{
  await mongoose.connect(process.env.MONGO_URL);
  const p = await User.findOne({email:'parent@peekaboo.com'});
  await LoyaltyBalance.deleteMany({ userId: p._id });
  await LoyaltyLedger.deleteMany({ userId: p._id });
  await HourlyBooking.deleteMany({ user_id: p._id });
  console.log('cleared');
  process.exit(0);
})();
"'''
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0 and "cleared" in result.stdout:
                self.log_result("RESET_LOYALTY", "PASS", "Loyalty state cleared")
                return True
            else:
                self.log_result("RESET_LOYALTY", "FAIL", f"Exit code: {result.returncode}, Output: {result.stdout}, Error: {result.stderr}")
                return False
        except Exception as e:
            self.log_result("RESET_LOYALTY", "FAIL", f"Exception: {str(e)}")
            return False
            
    def seed_booking(self, kinds="valid", amount=12):
        """Seed test bookings using the provided helper"""
        try:
            cmd = f'''cd /app/backend/node-app && SEED_KINDS={kinds} SEED_AMOUNT={amount} MONGO_URL=mongodb://localhost:27017/peekaboo node -e "
const mongoose=require('mongoose');
const HourlyBooking=require('./models/HourlyBooking');
const TimeSlot=require('./models/TimeSlot');
const User=require('./models/User');
const {{ generateBookingQrPayload }} = require('./utils/bookingQr');
const {{ randomUUID }} = require('crypto');
(async()=>{{
  await mongoose.connect(process.env.MONGO_URL);
  const parent = await User.findOne({{email:'parent@peekaboo.com'}});
  let slot = await TimeSlot.findOne({{slot_type:'hourly'}});
  if(!slot){{ slot = await TimeSlot.create({{date:'2027-06-15',start_time:'10:00',slot_type:'hourly',capacity:10,booked_count:0}}); }}
  const out = {{}};
  const kinds = process.env.SEED_KINDS ? process.env.SEED_KINDS.split(',') : ['valid'];
  const amount = Number(process.env.SEED_AMOUNT || 12);
  for (const kind of kinds) {{
    const {{ qr_token, qr_code }} = await generateBookingQrPayload();
    const booking_code = 'PK-H-' + kind.slice(0,3).toUpperCase() + randomUUID().substring(0,5).toUpperCase();
    let status='confirmed', qr_status='unused';
    if (kind==='cancelled') {{ status='cancelled'; qr_status='cancelled'; }}
    if (kind==='pending') {{ status='pending'; qr_status='unused'; }}
    const b = await HourlyBooking.create({{
      user_id: parent._id, child_id:null, guest_child_name: 'Test Child '+kind,
      child_count:1, slot_id: slot._id, duration_hours:2,
      qr_code, qr_token, qr_status, booking_code,
      status, payment_method:'cash', payment_status: kind==='unpaid' ? null : 'pending_cash', amount,
    }});
    out[kind] = {{ id: b._id.toString(), booking_code, qr_token, amount }};
  }}
  console.log(JSON.stringify(out));
  process.exit(0);
}})();
"'''
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0:
                try:
                    booking_data = json.loads(result.stdout.strip())
                    self.log_result("SEED_BOOKING", "PASS", f"Created bookings: {list(booking_data.keys())}")
                    return booking_data
                except json.JSONDecodeError:
                    self.log_result("SEED_BOOKING", "FAIL", f"Invalid JSON output: {result.stdout}")
                    return None
            else:
                self.log_result("SEED_BOOKING", "FAIL", f"Exit code: {result.returncode}, Output: {result.stdout}, Error: {result.stderr}")
                return None
        except Exception as e:
            self.log_result("SEED_BOOKING", "FAIL", f"Exception: {str(e)}")
            return None
            
    def qr_checkin(self, qr_token):
        """Perform QR check-in"""
        try:
            response = requests.post(f"{BACKEND_URL}/staff/qr/checkin", 
                json={"qr_token": qr_token},
                headers={"Authorization": f"Bearer {self.admin_token}"}
            )
            return response
        except Exception as e:
            self.log_result("QR_CHECKIN", "FAIL", f"Exception: {str(e)}")
            return None
            
    def legacy_checkin(self, booking_code):
        """Perform legacy check-in"""
        try:
            response = requests.post(f"{BACKEND_URL}/staff/checkin", 
                json={"booking_code": booking_code},
                headers={"Authorization": f"Bearer {self.admin_token}"}
            )
            return response
        except Exception as e:
            self.log_result("LEGACY_CHECKIN", "FAIL", f"Exception: {str(e)}")
            return None
            
    def create_settings_doc(self, policy):
        """Create or update loyalty settings document"""
        try:
            cmd = f'''cd /app/backend/node-app && MONGO_URL=mongodb://localhost:27017/peekaboo node -e "
const mongoose=require('mongoose');
const Settings=require('./models/Settings');
(async()=>{{
  await mongoose.connect(process.env.MONGO_URL);
  await Settings.findOneAndUpdate(
    {{key:'loyalty_earn_policy'}},
    {{value: {json.dumps(policy)}}},
    {{upsert: true}}
  );
  console.log('settings_updated');
  process.exit(0);
}})();
"'''
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0 and "settings_updated" in result.stdout:
                self.log_result("CREATE_SETTINGS", "PASS", f"Settings updated: {policy}")
                return True
            else:
                self.log_result("CREATE_SETTINGS", "FAIL", f"Exit code: {result.returncode}, Output: {result.stdout}, Error: {result.stderr}")
                return False
        except Exception as e:
            self.log_result("CREATE_SETTINGS", "FAIL", f"Exception: {str(e)}")
            return False
            
    def delete_settings_doc(self):
        """Delete loyalty settings document"""
        try:
            cmd = '''cd /app/backend/node-app && MONGO_URL=mongodb://localhost:27017/peekaboo node -e "
const mongoose=require('mongoose');
const Settings=require('./models/Settings');
(async()=>{
  await mongoose.connect(process.env.MONGO_URL);
  await Settings.deleteOne({key:'loyalty_earn_policy'});
  console.log('settings_deleted');
  process.exit(0);
})();
"'''
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0 and "settings_deleted" in result.stdout:
                self.log_result("DELETE_SETTINGS", "PASS", "Settings document deleted")
                return True
            else:
                self.log_result("DELETE_SETTINGS", "FAIL", f"Exit code: {result.returncode}, Output: {result.stdout}, Error: {result.stderr}")
                return False
        except Exception as e:
            self.log_result("DELETE_SETTINGS", "FAIL", f"Exception: {str(e)}")
            return False
            
    def check_booking_loyalty_fields(self, booking_id):
        """Check booking loyalty fields in database"""
        try:
            cmd = f'''cd /app/backend/node-app && MONGO_URL=mongodb://localhost:27017/peekaboo node -e "
const mongoose=require('mongoose');
const HourlyBooking=require('./models/HourlyBooking');
(async()=>{{
  await mongoose.connect(process.env.MONGO_URL);
  const booking = await HourlyBooking.findById('{booking_id}');
  if (booking) {{
    console.log(JSON.stringify({{
      loyalty_awarded_at: booking.loyalty_awarded_at,
      loyalty_points_awarded: booking.loyalty_points_awarded,
      loyalty_award_skipped_reason: booking.loyalty_award_skipped_reason
    }}));
  }} else {{
    console.log('null');
  }}
  process.exit(0);
}})();
"'''
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0:
                try:
                    if result.stdout.strip() == 'null':
                        return None
                    return json.loads(result.stdout.strip())
                except json.JSONDecodeError:
                    return None
            return None
        except Exception as e:
            return None
            
    def check_loyalty_ledger_entry(self, booking_id):
        """Check if loyalty ledger entry exists for booking"""
        try:
            cmd = f'''cd /app/backend/node-app && MONGO_URL=mongodb://localhost:27017/peekaboo node -e "
const mongoose=require('mongoose');
const LoyaltyLedger=require('./models/LoyaltyLedger');
const User=require('./models/User');
(async()=>{{
  await mongoose.connect(process.env.MONGO_URL);
  const parent = await User.findOne({{email:'parent@peekaboo.com'}});
  const entry = await LoyaltyLedger.findOne({{
    userId: parent._id,
    refType: 'hourly',
    refId: '{booking_id}'
  }});
  if (entry) {{
    console.log(JSON.stringify({{
      pointsDelta: entry.pointsDelta,
      reason: entry.reason,
      refType: entry.refType,
      refId: entry.refId
    }}));
  }} else {{
    console.log('null');
  }}
  process.exit(0);
}})();
"'''
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0:
                try:
                    if result.stdout.strip() == 'null':
                        return None
                    return json.loads(result.stdout.strip())
                except json.JSONDecodeError:
                    return None
            return None
        except Exception as e:
            return None

    def test_basic_qr_checkin_loyalty(self):
        """Test basic QR check-in loyalty award"""
        print("\n=== Testing Basic QR Check-in Loyalty Award ===")
        
        # Reset state
        self.reset_loyalty_state()
        self.delete_settings_doc()  # Use default settings
        
        # Seed booking with amount=12 (default policy: 1 point per JD)
        booking_data = self.seed_booking("valid", 12)
        if not booking_data:
            self.log_result("BASIC_SEED", "FAIL", "Failed to seed booking")
            return False
            
        # Check in and verify response
        response = self.qr_checkin(booking_data["valid"]["qr_token"])
        if response.status_code != 200:
            self.log_result("BASIC_CHECKIN", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
            return False
            
        response_data = response.json()
        
        # Verify response structure
        if not response_data.get("ok"):
            self.log_result("BASIC_OK", "FAIL", f"Expected ok=true, got {response_data.get('ok')}")
            return False
            
        # Check Arabic message
        if "تم تفعيل الجلسة بنجاح" not in response_data.get("message", ""):
            self.log_result("BASIC_MESSAGE", "FAIL", f"Expected Arabic success message, got {response_data.get('message')}")
            return False
            
        # Check loyalty object
        loyalty = response_data.get("loyalty", {})
        if not loyalty.get("awarded"):
            self.log_result("BASIC_AWARDED", "FAIL", f"Expected awarded=true, got {loyalty.get('awarded')}")
            return False
            
        if loyalty.get("points") != 12:
            self.log_result("BASIC_POINTS", "FAIL", f"Expected 12 points, got {loyalty.get('points')}")
            return False
            
        # Verify database state
        booking_fields = self.check_booking_loyalty_fields(booking_data["valid"]["id"])
        if not booking_fields:
            self.log_result("BASIC_DB_FIELDS", "FAIL", "Could not retrieve booking loyalty fields")
            return False
            
        if not booking_fields.get("loyalty_awarded_at"):
            self.log_result("BASIC_AWARDED_AT", "FAIL", f"loyalty_awarded_at should be set: {booking_fields}")
            return False
            
        if booking_fields.get("loyalty_points_awarded") != 12:
            self.log_result("BASIC_POINTS_AWARDED", "FAIL", f"Expected 12 points awarded, got {booking_fields.get('loyalty_points_awarded')}")
            return False
            
        # Check ledger entry
        ledger_entry = self.check_loyalty_ledger_entry(booking_data["valid"]["id"])
        if not ledger_entry:
            self.log_result("BASIC_LEDGER", "FAIL", "No ledger entry found")
            return False
            
        if ledger_entry.get("pointsDelta") != 12:
            self.log_result("BASIC_LEDGER_POINTS", "FAIL", f"Expected 12 points in ledger, got {ledger_entry.get('pointsDelta')}")
            return False
            
        self.log_result("BASIC_QR_CHECKIN", "PASS", "QR check-in awards 12 points correctly")
        return True
        
    def test_rescan_no_double_award(self):
        """Test re-scan does not double-award"""
        print("\n=== Testing Re-scan Does Not Double-Award ===")
        
        # Use the booking from previous test
        booking_data = self.seed_booking("valid", 12)
        if not booking_data:
            self.log_result("RESCAN_SEED", "FAIL", "Failed to seed booking")
            return False
            
        # First check-in
        response = self.qr_checkin(booking_data["valid"]["qr_token"])
        if response.status_code != 200:
            self.log_result("RESCAN_FIRST", "FAIL", f"First check-in failed: {response.status_code}")
            return False
            
        # Re-scan same token
        response = self.qr_checkin(booking_data["valid"]["qr_token"])
        if response.status_code != 409:
            self.log_result("RESCAN_STATUS", "FAIL", f"Expected 409 (already_used), got {response.status_code}")
            return False
            
        response_data = response.json()
        if response_data.get("error_code") != "already_used":
            self.log_result("RESCAN_ERROR_CODE", "FAIL", f"Expected 'already_used', got {response_data.get('error_code')}")
            return False
            
        # Verify only 1 ledger entry exists
        cmd = f'''cd /app/backend/node-app && MONGO_URL=mongodb://localhost:27017/peekaboo node -e "
const mongoose=require('mongoose');
const LoyaltyLedger=require('./models/LoyaltyLedger');
const User=require('./models/User');
(async()=>{{
  await mongoose.connect(process.env.MONGO_URL);
  const parent = await User.findOne({{email:'parent@peekaboo.com'}});
  const count = await LoyaltyLedger.countDocuments({{
    userId: parent._id,
    refType: 'hourly',
    refId: '{booking_data["valid"]["id"]}'
  }});
  console.log(count);
  process.exit(0);
}})();
"'''
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if result.returncode == 0:
            count = int(result.stdout.strip())
            if count != 1:
                self.log_result("RESCAN_LEDGER_COUNT", "FAIL", f"Expected 1 ledger entry, got {count}")
                return False
        else:
            self.log_result("RESCAN_LEDGER_COUNT", "FAIL", "Could not count ledger entries")
            return False
            
        self.log_result("RESCAN_NO_DOUBLE", "PASS", "Re-scan returns 409 and does not create duplicate ledger entry")
        return True
        
    def test_legacy_checkin_loyalty(self):
        """Test legacy check-in awards loyalty"""
        print("\n=== Testing Legacy Check-in Awards Loyalty ===")
        
        # Reset and seed fresh booking
        self.reset_loyalty_state()
        booking_data = self.seed_booking("valid", 10)
        if not booking_data:
            self.log_result("LEGACY_SEED", "FAIL", "Failed to seed booking")
            return False
            
        # Legacy check-in
        response = self.legacy_checkin(booking_data["valid"]["booking_code"])
        if response.status_code != 200:
            self.log_result("LEGACY_CHECKIN", "FAIL", f"Status: {response.status_code}, Response: {response.text}")
            return False
            
        # Verify booking fields
        booking_fields = self.check_booking_loyalty_fields(booking_data["valid"]["id"])
        if not booking_fields or not booking_fields.get("loyalty_awarded_at"):
            self.log_result("LEGACY_AWARDED_AT", "FAIL", f"loyalty_awarded_at should be set: {booking_fields}")
            return False
            
        if booking_fields.get("loyalty_points_awarded") != 10:
            self.log_result("LEGACY_POINTS", "FAIL", f"Expected 10 points, got {booking_fields.get('loyalty_points_awarded')}")
            return False
            
        # Verify ledger entry
        ledger_entry = self.check_loyalty_ledger_entry(booking_data["valid"]["id"])
        if not ledger_entry or ledger_entry.get("pointsDelta") != 10:
            self.log_result("LEGACY_LEDGER", "FAIL", f"Expected ledger entry with 10 points: {ledger_entry}")
            return False
            
        self.log_result("LEGACY_CHECKIN_AWARDS", "PASS", "Legacy check-in awards 10 points correctly")
        return True
        
    def test_cancelled_booking_no_award(self):
        """Test cancelled booking does not award"""
        print("\n=== Testing Cancelled Booking Does Not Award ===")
        
        # Reset and seed cancelled booking
        self.reset_loyalty_state()
        booking_data = self.seed_booking("cancelled", 15)
        if not booking_data:
            self.log_result("CANCELLED_SEED", "FAIL", "Failed to seed cancelled booking")
            return False
            
        # Try QR check-in on cancelled booking
        response = self.qr_checkin(booking_data["cancelled"]["qr_token"])
        if response.status_code != 400:
            self.log_result("CANCELLED_STATUS", "FAIL", f"Expected 400 for cancelled booking, got {response.status_code}")
            return False
            
        response_data = response.json()
        if "ملغي" not in response_data.get("error", ""):
            self.log_result("CANCELLED_MESSAGE", "FAIL", f"Expected Arabic cancelled message, got {response_data.get('error')}")
            return False
            
        # Verify no ledger entry
        ledger_entry = self.check_loyalty_ledger_entry(booking_data["cancelled"]["id"])
        if ledger_entry:
            self.log_result("CANCELLED_NO_LEDGER", "FAIL", f"Should not have ledger entry for cancelled booking: {ledger_entry}")
            return False
            
        self.log_result("CANCELLED_NO_AWARD", "PASS", "Cancelled booking does not award points")
        return True
        
    def test_settings_policy_variations(self):
        """Test different settings policy variations"""
        print("\n=== Testing Settings Policy Variations ===")
        
        # Test disabled policy
        self.reset_loyalty_state()
        policy = {"enabled": False, "earn_mode": "per_jd", "points_per_jd": 1, "fixed_points_per_visit": 10}
        self.create_settings_doc(policy)
        
        booking_data = self.seed_booking("valid", 15)
        if not booking_data:
            self.log_result("DISABLED_SEED", "FAIL", "Failed to seed booking")
            return False
            
        response = self.qr_checkin(booking_data["valid"]["qr_token"])
        if response.status_code != 200:
            self.log_result("DISABLED_CHECKIN", "FAIL", f"Check-in failed: {response.status_code}")
            return False
            
        response_data = response.json()
        loyalty = response_data.get("loyalty", {})
        
        if loyalty.get("awarded"):
            self.log_result("DISABLED_NOT_AWARDED", "FAIL", f"Loyalty should not be awarded when disabled: {loyalty}")
            return False
            
        if loyalty.get("reason") != "loyalty_disabled":
            self.log_result("DISABLED_REASON", "FAIL", f"Expected 'loyalty_disabled', got {loyalty.get('reason')}")
            return False
            
        self.log_result("DISABLED_POLICY", "PASS", "Disabled policy does not award points")
        
        # Test per-visit mode
        policy = {"enabled": True, "earn_mode": "per_visit", "points_per_jd": 1, "fixed_points_per_visit": 7}
        self.create_settings_doc(policy)
        
        booking_data = self.seed_booking("valid2", 99)
        if not booking_data:
            self.log_result("PER_VISIT_SEED", "FAIL", "Failed to seed booking")
            return False
            
        response = self.qr_checkin(booking_data["valid2"]["qr_token"])
        if response.status_code != 200:
            self.log_result("PER_VISIT_CHECKIN", "FAIL", f"Check-in failed: {response.status_code}")
            return False
            
        response_data = response.json()
        loyalty = response_data.get("loyalty", {})
        
        if not loyalty.get("awarded"):
            self.log_result("PER_VISIT_AWARDED", "FAIL", f"Loyalty should be awarded: {loyalty}")
            return False
            
        if loyalty.get("points") != 7:
            self.log_result("PER_VISIT_POINTS", "FAIL", f"Expected 7 points (per_visit), got {loyalty.get('points')}")
            return False
            
        self.log_result("PER_VISIT_POLICY", "PASS", "Per-visit mode awards 7 points regardless of amount")
        
        # Test custom points_per_jd
        policy = {"enabled": True, "earn_mode": "per_jd", "points_per_jd": 2, "fixed_points_per_visit": 10}
        self.create_settings_doc(policy)
        
        booking_data = self.seed_booking("valid3", 10)
        if not booking_data:
            self.log_result("CUSTOM_RATE_SEED", "FAIL", "Failed to seed booking")
            return False
            
        response = self.qr_checkin(booking_data["valid3"]["qr_token"])
        if response.status_code != 200:
            self.log_result("CUSTOM_RATE_CHECKIN", "FAIL", f"Check-in failed: {response.status_code}")
            return False
            
        response_data = response.json()
        loyalty = response_data.get("loyalty", {})
        
        if not loyalty.get("awarded"):
            self.log_result("CUSTOM_RATE_AWARDED", "FAIL", f"Loyalty should be awarded: {loyalty}")
            return False
            
        if loyalty.get("points") != 20:
            self.log_result("CUSTOM_RATE_POINTS", "FAIL", f"Expected 20 points (10*2), got {loyalty.get('points')}")
            return False
            
        self.log_result("CUSTOM_RATE_POLICY", "PASS", "Custom points_per_jd=2 awards 20 points for amount=10")
        
        # Restore defaults
        self.delete_settings_doc()
        
        return True
        
    def run_all_tests(self):
        """Run all core test scenarios"""
        print("Starting Phase 3 Loyalty Earn Foundation Core Testing")
        print("=" * 60)
        
        # Login first
        if not self.login_admin():
            print("CRITICAL: Admin login failed, cannot continue")
            return False
            
        if not self.login_parent():
            print("CRITICAL: Parent login failed, cannot continue")
            return False
            
        # Run core test scenarios
        test_methods = [
            self.test_basic_qr_checkin_loyalty,
            self.test_rescan_no_double_award,
            self.test_legacy_checkin_loyalty,
            self.test_cancelled_booking_no_award,
            self.test_settings_policy_variations,
        ]
        
        passed = 0
        failed = 0
        
        for test_method in test_methods:
            try:
                if test_method():
                    passed += 1
                else:
                    failed += 1
            except Exception as e:
                self.log_result(test_method.__name__, "FAIL", f"Exception: {str(e)}")
                failed += 1
                
        print("\n" + "=" * 60)
        print("PHASE 3 CORE TESTING SUMMARY")
        print("=" * 60)
        print(f"PASSED: {passed}")
        print(f"FAILED: {failed}")
        print(f"TOTAL:  {passed + failed}")
        
        if failed == 0:
            print("\n🎉 ALL CORE TESTS PASSED! Phase 3 loyalty earn foundation is working correctly.")
        else:
            print(f"\n❌ {failed} tests failed. See details above.")
            
        print("\nDetailed Results:")
        for result in self.test_results:
            print(f"  {result}")
            
        return failed == 0

if __name__ == "__main__":
    tester = Phase3CoreTester()
    success = tester.run_all_tests()
    exit(0 if success else 1)