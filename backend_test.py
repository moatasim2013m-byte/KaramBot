#!/usr/bin/env python3
"""
Phase 6 Loyalty Redemption Verification Test
CREDIT-CONTROL MODE - AUDIT/VERIFY ONLY - NO CODE CHANGES

This script performs comprehensive verification of Phase 6 redemption functionality
following the exact scenarios outlined in the review request.
"""

import requests
import json
import time
import subprocess
from datetime import datetime, timedelta
from bson import ObjectId

# Configuration
BACKEND_URL = "https://iphone-scanner-test.preview.emergentagent.com/api"
ADMIN_CREDS = {"email": "admin@peekaboo.com", "password": "admin123"}
PARENT_CREDS = {"email": "parent@peekaboo.com", "password": "parent123"}

class Phase6Verifier:
    def __init__(self):
        self.admin_token = None
        self.parent_token = None
        self.parent_id = None
        self.test_results = {}
        self.cleanup_data = {
            'payment_transactions': [],
            'hourly_bookings': [],
            'loyalty_ledgers': [],
            'slot_ids': []
        }
        
    def log_result(self, scenario, status, details):
        """Log test result"""
        self.test_results[scenario] = {
            'status': status,
            'details': details,
            'timestamp': datetime.now().isoformat()
        }
        print(f"[{status}] {scenario}: {details}")
        
    def authenticate(self):
        """Authenticate admin and parent users"""
        print("\n=== AUTHENTICATION ===")
        
        # Admin login
        response = requests.post(f"{BACKEND_URL}/auth/login", json=ADMIN_CREDS)
        if response.status_code == 200:
            self.admin_token = response.json()['token']
            self.log_result("ADMIN_AUTH", "PASS", "Admin authentication successful")
        else:
            self.log_result("ADMIN_AUTH", "FAIL", f"Admin auth failed: {response.status_code}")
            return False
            
        # Parent login
        response = requests.post(f"{BACKEND_URL}/auth/login", json=PARENT_CREDS)
        if response.status_code == 200:
            data = response.json()
            self.parent_token = data['token']
            self.parent_id = data['user']['id']
            self.log_result("PARENT_AUTH", "PASS", f"Parent authentication successful, ID: {self.parent_id}")
        else:
            self.log_result("PARENT_AUTH", "FAIL", f"Parent auth failed: {response.status_code}")
            return False
            
        return True
        
    def get_headers(self, token):
        """Get authorization headers"""
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        
    def seed_loyalty_points(self, points=200):
        """Seed loyalty points via MongoDB direct insert"""
        print(f"\n=== SEEDING {points} LOYALTY POINTS ===")
        
        cmd = f"""mongosh mongodb://localhost:27017/peekaboo --eval "
        db.loyaltyledgers.insertOne({{
            userId: ObjectId('{self.parent_id}'),
            pointsDelta: {points},
            reason: 'audit_seed',
            refType: 'manual',
            refId: 'audit_seed_' + Date.now(),
            expiresAt: null,
            createdAt: new Date()
        }})"
        """
        
        try:
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0:
                self.log_result("SEED_POINTS", "PASS", f"Seeded {points} loyalty points")
                self.cleanup_data['loyalty_ledgers'].append('audit_seed')
                return True
            else:
                self.log_result("SEED_POINTS", "FAIL", f"Failed to seed points: {result.stderr}")
                return False
        except Exception as e:
            self.log_result("SEED_POINTS", "FAIL", f"Exception seeding points: {str(e)}")
            return False
            
    def find_valid_slot_and_child(self):
        """Find a valid future hourly TimeSlot and ensure child exists"""
        print("\n=== FINDING VALID SLOT AND CHILD ===")
        
        # Get available slots for tomorrow
        tomorrow = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
        response = requests.get(
            f"{BACKEND_URL}/slots/available",
            params={
                'date': tomorrow,
                'slot_type': 'hourly',
                'timeMode': 'afternoon',
                'duration': '2'
            },
            headers=self.get_headers(self.parent_token)
        )
        
        if response.status_code != 200:
            self.log_result("FIND_SLOT", "FAIL", f"Failed to get slots: {response.status_code}")
            return None, None
            
        slots_data = response.json()
        slots = slots_data.get('slots', []) if isinstance(slots_data, dict) else []
        valid_slot = None
        
        for slot in slots:
            if isinstance(slot, dict) and slot.get('capacity', 0) > slot.get('booked_count', 0):
                valid_slot = slot
                break
                
        if not valid_slot:
            self.log_result("FIND_SLOT", "FAIL", "No available slots found")
            return None, None
            
        slot_id = valid_slot.get('id') or valid_slot.get('_id')
        self.log_result("FIND_SLOT", "PASS", f"Found valid slot: {slot_id}")
        
        # Check if parent has children
        response = requests.get(
            f"{BACKEND_URL}/profile/children",
            headers=self.get_headers(self.parent_token)
        )
        
        children_data = response.json() if response.status_code == 200 else {}
        children = children_data.get('children', []) if isinstance(children_data, dict) else []
        
        if not children:
            # Create a child
            child_data = {
                "name": "طفل اختبار Phase6",
                "age": 8,
                "gender": "male"
            }
            response = requests.post(
                f"{BACKEND_URL}/profile/children",
                json=child_data,
                headers=self.get_headers(self.parent_token)
            )
            
            if response.status_code == 201:
                child_response = response.json()
                child_id = child_response.get('child', {}).get('_id') or child_response.get('_id')
                self.log_result("CREATE_CHILD", "PASS", f"Created child: {child_id}")
            else:
                self.log_result("CREATE_CHILD", "FAIL", f"Failed to create child: {response.status_code} - {response.text}")
                return slot_id, None
        else:
            child_id = children[0].get('_id') or children[0].get('id')
            self.log_result("FIND_CHILD", "PASS", f"Found existing child: {child_id}")
            
        return slot_id, child_id
        
    def insert_payment_transaction(self, slot_id, child_id, status='paid', amount=10):
        """Insert synthetic PaymentTransaction into MongoDB"""
        print(f"\n=== INSERTING PAYMENT TRANSACTION (status={status}) ===")
        
        timestamp = int(time.time() * 1000)
        payment_id = f"AUDIT-PHASE6-{timestamp}"
        session_id = f"AUDIT-SESSION-{timestamp}"
        
        transaction_doc = {
            'user_id': f"ObjectId('{self.parent_id}')",
            'type': 'hourly',
            'amount': amount,
            'status': status,
            'payment_id': payment_id,
            'session_id': session_id,
            'provider': 'capital_bank',
            'created_at': 'new Date()',
            'metadata': {
                'type': 'hourly',
                'user_id': self.parent_id,
                'slot_id': slot_id,
                'duration_hours': 2,
                'child_ids': f"JSON.stringify(['{child_id}'])",
                'loyalty_points_used': 50,
                'loyalty_discount_jd': 5,
                'loyalty_conversion': 10
            }
        }
        
        # Convert to MongoDB insert command
        metadata_str = json.dumps(transaction_doc['metadata']).replace('"JSON.stringify', 'JSON.stringify').replace('"])"', '])')
        
        cmd = f"""mongosh mongodb://localhost:27017/peekaboo --eval "
        db.paymenttransactions.insertOne({{
            user_id: ObjectId('{self.parent_id}'),
            type: 'hourly',
            amount: {amount},
            status: '{status}',
            payment_id: '{payment_id}',
            session_id: '{session_id}',
            provider: 'capital_bank',
            created_at: new Date(),
            metadata: {metadata_str}
        }})"
        """
        
        try:
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0:
                self.log_result("INSERT_PAYMENT", "PASS", f"Inserted payment transaction: {payment_id}")
                self.cleanup_data['payment_transactions'].append(payment_id)
                return session_id
            else:
                self.log_result("INSERT_PAYMENT", "FAIL", f"Failed to insert payment: {result.stderr}")
                return None
        except Exception as e:
            self.log_result("INSERT_PAYMENT", "FAIL", f"Exception inserting payment: {str(e)}")
            return None
            
    def test_technique_a_finalize_simulation(self):
        """TECHNIQUE A — Direct finalize simulation (primary test path for redemption deduction)"""
        print("\n" + "="*60)
        print("TECHNIQUE A — DIRECT FINALIZE SIMULATION")
        print("="*60)
        
        # Step 1: Already authenticated
        # Step 2: Already seeded points
        # Step 3: Find valid slot and child
        slot_id, child_id = self.find_valid_slot_and_child()
        if not slot_id or not child_id:
            return False
            
        # Step 4: Insert synthetic PaymentTransaction with status='paid'
        session_id = self.insert_payment_transaction(slot_id, child_id, status='paid', amount=10)
        if not session_id:
            return False
            
        # Step 5: Call POST /api/payments/finalize/<sessionId>
        print(f"\n=== CALLING FINALIZE ENDPOINT ===")
        response = requests.post(
            f"{BACKEND_URL}/payments/finalize/{session_id}",
            headers=self.get_headers(self.parent_token)
        )
        
        if response.status_code != 200:
            self.log_result("A5_FINALIZE", "FAIL", f"Finalize failed: {response.status_code} - {response.text}")
            return False
            
        finalize_data = response.json()
        if finalize_data.get('resourceType') != 'hourly' or len(finalize_data.get('bookings', [])) != 1:
            self.log_result("A5_FINALIZE", "FAIL", f"Unexpected finalize response: {finalize_data}")
            return False
            
        booking = finalize_data['bookings'][0]
        booking_id = booking['_id']
        self.cleanup_data['hourly_bookings'].append(booking_id)
        
        self.log_result("A5_FINALIZE", "PASS", f"Finalize successful, booking created: {booking_id}")
        
        # Step 6: Verify redemption markers and ledger
        return self.verify_redemption_markers(booking_id, session_id)
        
    def verify_redemption_markers(self, booking_id, session_id):
        """Verify redemption markers and ledger entries"""
        print(f"\n=== VERIFYING REDEMPTION MARKERS ===")
        
        # 6a: Verify HourlyBooking has redemption markers
        cmd = f"""mongosh mongodb://localhost:27017/peekaboo --eval "
        db.hourlybookings.findOne({{_id: ObjectId('{booking_id}')}})
        " --quiet"""
        
        try:
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0 and 'loyalty_redeemed_points' in result.stdout:
                self.log_result("A6a_BOOKING_MARKERS", "PASS", "HourlyBooking has redemption markers")
            else:
                self.log_result("A6a_BOOKING_MARKERS", "FAIL", "Missing redemption markers in booking")
                return False
        except Exception as e:
            self.log_result("A6a_BOOKING_MARKERS", "FAIL", f"Error checking booking: {str(e)}")
            return False
            
        # 6b: Verify LoyaltyLedger has redemption entry
        cmd = f"""mongosh mongodb://localhost:27017/peekaboo --eval "
        db.loyaltyledgers.findOne({{
            userId: ObjectId('{self.parent_id}'),
            refType: 'hourly',
            refId: 'redeem:{booking_id}',
            reason: 'redeem_booking_discount'
        }})
        " --quiet"""
        
        try:
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0 and 'pointsDelta' in result.stdout and '-50' in result.stdout:
                self.log_result("A6b_LEDGER_ENTRY", "PASS", "LoyaltyLedger has redemption entry with -50 points")
            else:
                self.log_result("A6b_LEDGER_ENTRY", "FAIL", "Missing or incorrect redemption ledger entry")
                return False
        except Exception as e:
            self.log_result("A6b_LEDGER_ENTRY", "FAIL", f"Error checking ledger: {str(e)}")
            return False
            
        # 6c: Verify balance reduced
        response = requests.get(
            f"{BACKEND_URL}/loyalty/balance",
            headers=self.get_headers(self.parent_token)
        )
        
        if response.status_code == 200:
            balance_data = response.json()
            points_available = balance_data.get('pointsAvailable', 0)
            expected_balance = 200 - 50  # seeded 200, redeemed 50
            
            if points_available == expected_balance:
                self.log_result("A6c_BALANCE_REDUCED", "PASS", f"Balance correctly reduced to {points_available}")
            else:
                self.log_result("A6c_BALANCE_REDUCED", "FAIL", f"Balance {points_available} != expected {expected_balance}")
                return False
        else:
            self.log_result("A6c_BALANCE_REDUCED", "FAIL", f"Failed to get balance: {response.status_code}")
            return False
            
        # 6d: Verify history shows redemption
        response = requests.get(
            f"{BACKEND_URL}/loyalty/history",
            headers=self.get_headers(self.parent_token)
        )
        
        if response.status_code == 200:
            history = response.json()
            redemption_entry = None
            for entry in history:
                if entry.get('reason') == 'redeem_booking_discount' and entry.get('pointsDelta') == -50:
                    redemption_entry = entry
                    break
                    
            if redemption_entry:
                self.log_result("A6d_HISTORY_ENTRY", "PASS", "Redemption entry appears in history")
            else:
                self.log_result("A6d_HISTORY_ENTRY", "FAIL", "Redemption entry missing from history")
                return False
        else:
            self.log_result("A6d_HISTORY_ENTRY", "FAIL", f"Failed to get history: {response.status_code}")
            return False
            
        # 6e: Verify admin ledger shows redemption
        response = requests.get(
            f"{BACKEND_URL}/admin/loyalty/ledger",
            headers=self.get_headers(self.admin_token)
        )
        
        if response.status_code == 200:
            ledger_data = response.json()
            redemption_entry = None
            for item in ledger_data.get('items', []):
                if (item.get('reason') == 'redeem_booking_discount' and 
                    item.get('pointsDelta') == -50 and
                    item.get('refId') == f'redeem:{booking_id}'):
                    redemption_entry = item
                    break
                    
            if redemption_entry:
                self.log_result("A6e_ADMIN_LEDGER", "PASS", "Redemption entry in admin ledger with correct refId pattern")
            else:
                self.log_result("A6e_ADMIN_LEDGER", "FAIL", "Redemption entry missing from admin ledger")
                return False
        else:
            self.log_result("A6e_ADMIN_LEDGER", "FAIL", f"Failed to get admin ledger: {response.status_code}")
            return False
            
        # Step 7: Test idempotency
        print(f"\n=== TESTING IDEMPOTENCY ===")
        response = requests.post(
            f"{BACKEND_URL}/payments/finalize/{session_id}",
            headers=self.get_headers(self.parent_token)
        )
        
        if response.status_code == 200:
            # Verify no new ledger entry was created
            response = requests.get(
                f"{BACKEND_URL}/loyalty/balance",
                headers=self.get_headers(self.parent_token)
            )
            
            if response.status_code == 200:
                new_balance = response.json().get('pointsAvailable', 0)
                if new_balance == expected_balance:
                    self.log_result("A7_IDEMPOTENCY", "PASS", "Idempotent call - no additional deduction")
                else:
                    self.log_result("A7_IDEMPOTENCY", "FAIL", f"Balance changed on idempotent call: {new_balance}")
                    return False
            else:
                self.log_result("A7_IDEMPOTENCY", "FAIL", "Failed to verify balance after idempotent call")
                return False
        else:
            self.log_result("A7_IDEMPOTENCY", "FAIL", f"Idempotent call failed: {response.status_code}")
            return False
            
        return True
        
    def test_technique_b_failed_payment_safety(self):
        """TECHNIQUE B — Failed-payment safety (verify no deduction when payment never succeeds)"""
        print("\n" + "="*60)
        print("TECHNIQUE B — FAILED-PAYMENT SAFETY")
        print("="*60)
        
        # Find another valid slot and child
        slot_id, child_id = self.find_valid_slot_and_child()
        if not slot_id or not child_id:
            return False
            
        # Insert PaymentTransaction with status='pending' (NOT 'paid')
        session_id = self.insert_payment_transaction(slot_id, child_id, status='pending', amount=15)
        if not session_id:
            return False
            
        # Call finalize - should fail
        print(f"\n=== CALLING FINALIZE WITH PENDING PAYMENT ===")
        response = requests.post(
            f"{BACKEND_URL}/payments/finalize/{session_id}",
            headers=self.get_headers(self.parent_token)
        )
        
        if response.status_code == 409:
            self.log_result("B2_FINALIZE_PENDING", "PASS", "Finalize correctly rejected pending payment with 409")
        else:
            self.log_result("B2_FINALIZE_PENDING", "FAIL", f"Expected 409, got {response.status_code}")
            return False
            
        # Verify no ledger entry was created and balance unchanged
        response = requests.get(
            f"{BACKEND_URL}/loyalty/balance",
            headers=self.get_headers(self.parent_token)
        )
        
        if response.status_code == 200:
            balance = response.json().get('pointsAvailable', 0)
            expected_balance = 200 - 50  # Only the previous redemption should be deducted
            
            if balance == expected_balance:
                self.log_result("B3_BALANCE_UNCHANGED", "PASS", f"Balance unchanged: {balance}")
                return True
            else:
                self.log_result("B3_BALANCE_UNCHANGED", "FAIL", f"Balance {balance} != expected {expected_balance}")
                return False
        else:
            self.log_result("B3_BALANCE_UNCHANGED", "FAIL", f"Failed to get balance: {response.status_code}")
            return False
            
    def test_deliberate_safety_blocks(self):
        """Test deliberate safety blocks for offline bookings"""
        print("\n" + "="*60)
        print("DELIBERATE SAFETY BLOCKS")
        print("="*60)
        
        # Test C: Offline booking with loyalty_points should be rejected
        slot_id, child_id = self.find_valid_slot_and_child()
        if not slot_id or not child_id:
            return False
            
        offline_booking_data = {
            "slot_id": slot_id,
            "child_ids": [child_id],
            "payment_method": "cash",
            "loyalty_points": 50
        }
        
        response = requests.post(
            f"{BACKEND_URL}/bookings/hourly/offline",
            json=offline_booking_data,
            headers=self.get_headers(self.admin_token)
        )
        
        if response.status_code == 400 and 'redemption_not_supported_for_offline' in response.text:
            self.log_result("C_OFFLINE_REDEMPTION_BLOCKED", "PASS", "Offline booking with loyalty_points correctly rejected")
        else:
            self.log_result("C_OFFLINE_REDEMPTION_BLOCKED", "FAIL", f"Expected 400 with redemption_not_supported_for_offline, got {response.status_code}")
            
        # Test D: Offline booking without loyalty fields should succeed
        offline_booking_data_clean = {
            "slot_id": slot_id,
            "child_ids": [child_id],
            "payment_method": "cash"
        }
        
        response = requests.post(
            f"{BACKEND_URL}/bookings/hourly/offline",
            json=offline_booking_data_clean,
            headers=self.get_headers(self.admin_token)
        )
        
        if response.status_code in [200, 201]:
            self.log_result("D_OFFLINE_NO_LOYALTY", "PASS", "Offline booking without loyalty fields succeeded")
            # Clean up the booking
            if response.status_code == 201:
                booking_data = response.json()
                if 'booking' in booking_data:
                    booking_id = booking_data['booking'].get('_id')
                    if booking_id:
                        self.cleanup_data['hourly_bookings'].append(booking_id)
        else:
            self.log_result("D_OFFLINE_NO_LOYALTY", "FAIL", f"Offline booking without loyalty failed: {response.status_code}")
            
        return True
        
    def test_regression_checks(self):
        """Test regression checks to ensure existing functionality still works"""
        print("\n" + "="*60)
        print("REGRESSION CHECKS")
        print("="*60)
        
        # F: QR validate
        # First create a valid booking to test with
        slot_id, child_id = self.find_valid_slot_and_child()
        if slot_id and child_id:
            # Create a cash booking for QR testing
            offline_booking_data = {
                "slot_id": slot_id,
                "child_ids": [child_id],
                "payment_method": "cash"
            }
            
            response = requests.post(
                f"{BACKEND_URL}/bookings/hourly/offline",
                json=offline_booking_data,
                headers=self.get_headers(self.admin_token)
            )
            
            if response.status_code == 201:
                booking = response.json()['booking']
                qr_token = booking.get('qr_token')
                booking_id = booking['_id']
                self.cleanup_data['hourly_bookings'].append(booking_id)
                
                if qr_token:
                    # Test QR validate
                    validate_response = requests.post(
                        f"{BACKEND_URL}/staff/qr/validate",
                        json={"qr_token": qr_token},
                        headers=self.get_headers(self.admin_token)
                    )
                    
                    if validate_response.status_code == 200:
                        validate_data = validate_response.json()
                        if validate_data.get('can_checkin'):
                            self.log_result("F_QR_VALIDATE", "PASS", "QR validate working correctly")
                            
                            # G: QR checkin
                            checkin_response = requests.post(
                                f"{BACKEND_URL}/staff/qr/checkin",
                                json={"qr_token": qr_token},
                                headers=self.get_headers(self.admin_token)
                            )
                            
                            if checkin_response.status_code == 200:
                                self.log_result("G_QR_CHECKIN", "PASS", "QR checkin working correctly")
                            else:
                                self.log_result("G_QR_CHECKIN", "FAIL", f"QR checkin failed: {checkin_response.status_code}")
                        else:
                            self.log_result("F_QR_VALIDATE", "FAIL", f"QR validate returned can_checkin=false")
                    else:
                        self.log_result("F_QR_VALIDATE", "FAIL", f"QR validate failed: {validate_response.status_code}")
                else:
                    self.log_result("F_QR_VALIDATE", "FAIL", "No QR token in booking")
            else:
                self.log_result("F_QR_VALIDATE", "FAIL", f"Failed to create test booking: {response.status_code}")
        
        # H: Loyalty balance
        response = requests.get(
            f"{BACKEND_URL}/loyalty/balance",
            headers=self.get_headers(self.parent_token)
        )
        
        if response.status_code == 200:
            balance_data = response.json()
            if 'pointsAvailable' in balance_data and 'redemption' in balance_data:
                self.log_result("H_LOYALTY_BALANCE", "PASS", "Loyalty balance endpoint working with redemption block")
            else:
                self.log_result("H_LOYALTY_BALANCE", "FAIL", "Missing fields in loyalty balance response")
        else:
            self.log_result("H_LOYALTY_BALANCE", "FAIL", f"Loyalty balance failed: {response.status_code}")
            
        # I: Loyalty history
        response = requests.get(
            f"{BACKEND_URL}/loyalty/history",
            headers=self.get_headers(self.parent_token)
        )
        
        if response.status_code == 200:
            self.log_result("I_LOYALTY_HISTORY", "PASS", "Loyalty history endpoint working")
        else:
            self.log_result("I_LOYALTY_HISTORY", "FAIL", f"Loyalty history failed: {response.status_code}")
            
        # J: Admin loyalty settings
        response = requests.get(
            f"{BACKEND_URL}/admin/loyalty/settings",
            headers=self.get_headers(self.admin_token)
        )
        
        if response.status_code == 200:
            settings_data = response.json()
            if 'redemption_enabled' in settings_data.get('settings', {}) and 'points_per_jd_redeem' in settings_data.get('settings', {}):
                self.log_result("J_ADMIN_SETTINGS", "PASS", "Admin loyalty settings working with redemption fields")
            else:
                self.log_result("J_ADMIN_SETTINGS", "FAIL", "Missing redemption fields in admin settings")
        else:
            self.log_result("J_ADMIN_SETTINGS", "FAIL", f"Admin loyalty settings failed: {response.status_code}")
            
        # K: Admin loyalty ledger
        response = requests.get(
            f"{BACKEND_URL}/admin/loyalty/ledger",
            headers=self.get_headers(self.admin_token)
        )
        
        if response.status_code == 200:
            self.log_result("K_ADMIN_LEDGER", "PASS", "Admin loyalty ledger working")
        else:
            self.log_result("K_ADMIN_LEDGER", "FAIL", f"Admin loyalty ledger failed: {response.status_code}")
            
        return True
        
    def test_trust_consistency(self):
        """Test parent ↔ admin trust consistency"""
        print("\n" + "="*60)
        print("PARENT ↔ ADMIN TRUST CONSISTENCY")
        print("="*60)
        
        # L: Compute balance consistency
        # Get parent visible balance
        response = requests.get(
            f"{BACKEND_URL}/loyalty/balance",
            headers=self.get_headers(self.parent_token)
        )
        
        if response.status_code != 200:
            self.log_result("L_TRUST_CONSISTENCY", "FAIL", f"Failed to get parent balance: {response.status_code}")
            return False
            
        parent_balance = response.json().get('pointsAvailable', 0)
        
        # Get ledger truth via MongoDB
        cmd = f"""mongosh mongodb://localhost:27017/peekaboo --eval "
        const result = db.loyaltyledgers.aggregate([
            {{ \\$match: {{ userId: ObjectId('{self.parent_id}'), \\$or: [{{ expiresAt: null }}, {{ expiresAt: {{ \\$exists: false }} }}] }} }},
            {{ \\$group: {{ _id: null, total: {{ \\$sum: '\\$pointsDelta' }} }} }}
        ]).toArray();
        print('TOTAL_POINTS:' + (result.length > 0 ? result[0].total : 0));
        " --quiet"""
        
        try:
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0:
                # Parse the MongoDB result
                import re
                match = re.search(r'TOTAL_POINTS:(\d+)', result.stdout)
                if match:
                    ledger_truth = int(match.group(1))
                    
                    if parent_balance == ledger_truth:
                        self.log_result("L_TRUST_CONSISTENCY", "PASS", f"Balance consistency verified: {parent_balance}")
                    else:
                        self.log_result("L_TRUST_CONSISTENCY", "FAIL", f"Balance mismatch: parent={parent_balance}, ledger={ledger_truth}")
                        return False
                else:
                    self.log_result("L_TRUST_CONSISTENCY", "FAIL", f"Could not parse ledger total from: {result.stdout}")
                    return False
            else:
                self.log_result("L_TRUST_CONSISTENCY", "FAIL", f"MongoDB query failed: {result.stderr}")
                return False
        except Exception as e:
            self.log_result("L_TRUST_CONSISTENCY", "FAIL", f"Exception checking consistency: {str(e)}")
            return False
            
        # M: Admin ledger redemption entry verification
        response = requests.get(
            f"{BACKEND_URL}/admin/loyalty/ledger",
            headers=self.get_headers(self.admin_token)
        )
        
        if response.status_code == 200:
            ledger_data = response.json()
            redemption_entries = [
                item for item in ledger_data.get('items', [])
                if item.get('reason') == 'redeem_booking_discount' and item.get('refId', '').startswith('redeem:')
            ]
            
            if redemption_entries:
                self.log_result("M_ADMIN_REDEMPTION_CLEAR", "PASS", f"Found {len(redemption_entries)} clear redemption entries")
            else:
                self.log_result("M_ADMIN_REDEMPTION_CLEAR", "FAIL", "No clear redemption entries found in admin ledger")
                return False
        else:
            self.log_result("M_ADMIN_REDEMPTION_CLEAR", "FAIL", f"Failed to get admin ledger: {response.status_code}")
            return False
            
        return True
        
    def cleanup_test_data(self):
        """Clean up test data as requested"""
        print("\n" + "="*60)
        print("CLEANUP TEST DATA")
        print("="*60)
        
        # Delete audit seed loyalty ledgers
        cmd = """mongosh mongodb://localhost:27017/peekaboo --eval "
        db.loyaltyledgers.deleteMany({refType:'manual', reason:'audit_seed'})
        " """
        
        try:
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0:
                self.log_result("CLEANUP_SEED_LEDGERS", "PASS", "Deleted audit seed ledgers")
            else:
                self.log_result("CLEANUP_SEED_LEDGERS", "FAIL", f"Failed to delete seed ledgers: {result.stderr}")
        except Exception as e:
            self.log_result("CLEANUP_SEED_LEDGERS", "FAIL", f"Exception: {str(e)}")
            
        # Delete test PaymentTransactions
        if self.cleanup_data['payment_transactions']:
            payment_ids = "', '".join(self.cleanup_data['payment_transactions'])
            cmd = f"""mongosh mongodb://localhost:27017/peekaboo --eval "
            db.paymenttransactions.deleteMany({{payment_id: {{\\$in: ['{payment_ids}']}}}})
            " """
            
            try:
                result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
                if result.returncode == 0:
                    self.log_result("CLEANUP_PAYMENTS", "PASS", f"Deleted {len(self.cleanup_data['payment_transactions'])} payment transactions")
                else:
                    self.log_result("CLEANUP_PAYMENTS", "FAIL", f"Failed to delete payments: {result.stderr}")
            except Exception as e:
                self.log_result("CLEANUP_PAYMENTS", "FAIL", f"Exception: {str(e)}")
                
        # Delete test HourlyBookings
        if self.cleanup_data['hourly_bookings']:
            booking_ids = "', '".join(self.cleanup_data['hourly_bookings'])
            cmd = f"""mongosh mongodb://localhost:27017/peekaboo --eval "
            db.hourlybookings.deleteMany({{_id: {{\\$in: [ObjectId('{booking_ids.replace("', '", "'), ObjectId('")}')]}}}})
            " """
            
            try:
                result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
                if result.returncode == 0:
                    self.log_result("CLEANUP_BOOKINGS", "PASS", f"Deleted {len(self.cleanup_data['hourly_bookings'])} hourly bookings")
                else:
                    self.log_result("CLEANUP_BOOKINGS", "FAIL", f"Failed to delete bookings: {result.stderr}")
            except Exception as e:
                self.log_result("CLEANUP_BOOKINGS", "FAIL", f"Exception: {str(e)}")
                
        # Delete audit redemption ledger entries
        cmd = f"""mongosh mongodb://localhost:27017/peekaboo --eval "
        db.loyaltyledgers.deleteMany({{
            refId: /^redeem:/,
            reason: 'redeem_booking_discount',
            refType: 'hourly',
            userId: ObjectId('{self.parent_id}')
        }})
        " """
        
        try:
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0:
                self.log_result("CLEANUP_REDEMPTION_LEDGERS", "PASS", "Deleted audit redemption ledger entries")
            else:
                self.log_result("CLEANUP_REDEMPTION_LEDGERS", "FAIL", f"Failed to delete redemption ledgers: {result.stderr}")
        except Exception as e:
            self.log_result("CLEANUP_REDEMPTION_LEDGERS", "FAIL", f"Exception: {str(e)}")
            
    def generate_report(self):
        """Generate final test report"""
        print("\n" + "="*80)
        print("PHASE 6 VERIFICATION REPORT")
        print("="*80)
        
        total_tests = len(self.test_results)
        passed_tests = len([r for r in self.test_results.values() if r['status'] == 'PASS'])
        failed_tests = total_tests - passed_tests
        
        print(f"\nSUMMARY: {passed_tests}/{total_tests} tests passed ({failed_tests} failed)")
        
        print("\nPASS/FAIL SUMMARY PER SCENARIO:")
        for scenario, result in self.test_results.items():
            status_symbol = "✅" if result['status'] == 'PASS' else "❌"
            print(f"{status_symbol} {scenario}: {result['details']}")
            
        print("\nREAL BUGS FOUND:")
        bugs_found = [scenario for scenario, result in self.test_results.items() if result['status'] == 'FAIL']
        if bugs_found:
            for bug in bugs_found:
                print(f"- {bug}: {self.test_results[bug]['details']}")
        else:
            print("- No real production-impact bugs found")
            
        print(f"\nPHASE 6 STATUS: {'SAFE TO CLOSE' if failed_tests == 0 else 'REQUIRES FIXES'}")
        
        return failed_tests == 0
        
    def run_verification(self):
        """Run complete Phase 6 verification"""
        print("Starting Phase 6 Loyalty Redemption Verification...")
        print("CREDIT-CONTROL MODE - AUDIT/VERIFY ONLY - NO CODE CHANGES")
        
        try:
            # Authentication
            if not self.authenticate():
                return False
                
            # Seed loyalty points
            if not self.seed_loyalty_points(200):
                return False
                
            # Run verification techniques
            self.test_technique_a_finalize_simulation()
            self.test_technique_b_failed_payment_safety()
            self.test_deliberate_safety_blocks()
            self.test_regression_checks()
            self.test_trust_consistency()
            
            # Cleanup
            self.cleanup_test_data()
            
            # Generate report
            return self.generate_report()
            
        except Exception as e:
            print(f"CRITICAL ERROR: {str(e)}")
            return False

if __name__ == "__main__":
    verifier = Phase6Verifier()
    success = verifier.run_verification()
    exit(0 if success else 1)