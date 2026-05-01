#!/usr/bin/env python3
"""
Post-Merge Verification Testing for Capital Bank Secure Acceptance Integration
Simplified version focusing on critical post-merge verification points.
"""

import requests
import json
import sys

# Configuration
BACKEND_URL = "https://credit-mode-preview.preview.emergentagent.com"
API_BASE = f"{BACKEND_URL}/api"

def log_test_result(test_name, status, message="", details=None):
    """Log test result with consistent formatting"""
    status_emoji = "✅" if status == "PASS" else "❌" if status == "FAIL" else "ℹ️"
    print(f"{status_emoji} {test_name}: {message}")
    if details:
        print(f"   Details: {details}")

def test_critical_post_merge_scenarios():
    """Run critical post-merge verification tests"""
    print("\n🔍 CAPITAL BANK SECURE ACCEPTANCE - POST-MERGE VERIFICATION")
    print("=" * 65)
    
    results = []
    
    # Test 1: Verify backend is accessible and serving correct responses
    print("\n=== Test 1: Backend Connectivity & Configuration ===")
    try:
        response = requests.get(f"{API_BASE}/payments/hourly-pricing", timeout=10)
        if response.status_code == 200:
            pricing_data = response.json()
            if pricing_data.get("pricing") and len(pricing_data["pricing"]) > 0:
                log_test_result("Backend Connectivity", "PASS", "Backend accessible and returning valid pricing data")
                results.append(("Backend Connectivity", True))
            else:
                log_test_result("Backend Connectivity", "FAIL", "Backend accessible but pricing data invalid")
                results.append(("Backend Connectivity", False))
        else:
            log_test_result("Backend Connectivity", "FAIL", f"Backend not accessible: {response.status_code}")
            results.append(("Backend Connectivity", False))
    except Exception as e:
        log_test_result("Backend Connectivity", "FAIL", f"Connection error: {str(e)}")
        results.append(("Backend Connectivity", False))
    
    # Test 2: Critical URL Resolution - Check cybersourceRest.js changes
    print("\n=== Test 2: URL Resolution Post-Merge Verification ===")
    
    # We can verify the URL configuration by checking if login works with Capital Bank credentials
    try:
        # First test authentication to get a token
        auth_response = requests.post(
            f"{API_BASE}/auth/login",
            json={"email": "admin@peekaboo.com", "password": "admin123"},
            timeout=10
        )
        
        if auth_response.status_code == 200:
            token = auth_response.json().get("token")
            log_test_result("Authentication System", "PASS", "Admin authentication working")
            
            # Test child creation to verify database and auth middleware
            child_response = requests.post(
                f"{API_BASE}/profile/children",
                json={"name": "Test Post-Merge Child", "birthday": "2020-05-15"},
                headers={"Authorization": f"Bearer {token}"},
                timeout=10
            )
            
            if child_response.status_code == 201:
                child_id = child_response.json().get("child", {}).get("_id")
                log_test_result("Child Profile Creation", "PASS", f"Child creation working: {child_id}")
                
                # Test checkout creation to verify Capital Bank configuration
                checkout_response = requests.post(
                    f"{API_BASE}/payments/create-checkout",
                    json={
                        "type": "hourly",
                        "reference_id": "676b98e5fb9cdcb8cb795c4e",  # Use existing slot ID from test results
                        "duration_hours": 2,
                        "child_ids": [child_id],
                        "origin_url": BACKEND_URL
                    },
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=10
                )
                
                if checkout_response.status_code == 200:
                    checkout_data = checkout_response.json()
                    payment_provider = checkout_data.get("payment_provider")
                    session_id = checkout_data.get("session_id")
                    
                    if payment_provider == "capital_bank":
                        log_test_result("Capital Bank Configuration", "PASS", "Payment provider correctly set to capital_bank (NOT manual mode)")
                        results.append(("Capital Bank Configuration", True))
                        
                        # Test the critical URL resolution - Capital Bank initiate endpoint
                        if session_id:
                            initiate_response = requests.post(
                                f"{API_BASE}/payments/capital-bank/initiate",
                                json={
                                    "orderId": session_id,
                                    "originUrl": BACKEND_URL,
                                    "locale": "en"
                                },
                                headers={"Authorization": f"Bearer {token}"},
                                timeout=10
                            )
                            
                            if initiate_response.status_code == 200:
                                initiate_data = initiate_response.json()
                                secure_acceptance_url = initiate_data.get("secureAcceptance", {}).get("url")
                                fields = initiate_data.get("secureAcceptance", {}).get("fields", {})
                                
                                # Critical check: URL resolution after cybersourceRest.js changes
                                if secure_acceptance_url == "https://ebc2test.cybersource.com/ebc2/pay":
                                    log_test_result("URL Resolution Post-Merge", "PASS", "getCyberSourcePaymentUrl() correctly returns Capital Bank test URL")
                                    log_test_result("CAPITAL_BANK_PAYMENT_ENDPOINT Parsing", "PASS", "Environment variable parsed correctly after code changes")
                                    results.append(("URL Resolution Post-Merge", True))
                                    
                                    # Verify signature generation still works
                                    signature = fields.get("signature")
                                    profile_id = fields.get("profile_id")
                                    
                                    if signature and len(signature) > 10:
                                        log_test_result("Signature Generation", "PASS", "HMAC-SHA256 signature generated successfully")
                                        results.append(("Signature Generation", True))
                                    else:
                                        log_test_result("Signature Generation", "FAIL", "Signature generation failed")
                                        results.append(("Signature Generation", False))
                                    
                                    if profile_id == "903897720102":
                                        log_test_result("Organization ID Verification", "PASS", "Capital Bank Organization ID (903897720102) verified")
                                        results.append(("Organization ID", True))
                                    else:
                                        log_test_result("Organization ID Verification", "FAIL", f"Incorrect profile_id: {profile_id}")
                                        results.append(("Organization ID", False))
                                        
                                else:
                                    log_test_result("URL Resolution Post-Merge", "FAIL", f"Incorrect URL returned: {secure_acceptance_url}")
                                    results.append(("URL Resolution Post-Merge", False))
                            else:
                                log_test_result("Capital Bank Initiate Endpoint", "FAIL", f"Initiate endpoint failed: {initiate_response.status_code}")
                                results.append(("Capital Bank Initiate", False))
                        else:
                            log_test_result("Session ID Generation", "FAIL", "No session_id returned from checkout")
                            results.append(("Session Generation", False))
                    elif payment_provider == "manual" or checkout_data.get("payment_method") == "manual":
                        log_test_result("Capital Bank Configuration", "FAIL", "System is in manual mode - Capital Bank credentials missing or invalid")
                        results.append(("Capital Bank Configuration", False))
                    else:
                        log_test_result("Capital Bank Configuration", "FAIL", f"Unexpected payment provider: {payment_provider}")
                        results.append(("Capital Bank Configuration", False))
                else:
                    log_test_result("Checkout Creation", "FAIL", f"Checkout creation failed: {checkout_response.status_code} - {checkout_response.text}")
                    results.append(("Checkout Creation", False))
            else:
                log_test_result("Child Profile Creation", "FAIL", f"Child creation failed: {child_response.status_code}")
                results.append(("Child Profile Creation", False))
        elif auth_response.status_code == 429:
            log_test_result("Authentication Rate Limit", "FAIL", "Rate limited - too many login attempts")
            results.append(("Authentication", False))
        else:
            log_test_result("Authentication System", "FAIL", f"Login failed: {auth_response.status_code}")
            results.append(("Authentication", False))
            
    except Exception as e:
        log_test_result("Post-Merge Verification", "FAIL", f"Test failed with error: {str(e)}")
        results.append(("Post-Merge Verification", False))
    
    # Summary
    print("\n" + "=" * 65)
    print("🏁 POST-MERGE VERIFICATION SUMMARY")
    print("=" * 65)
    
    passed = sum(1 for _, result in results if result)
    failed = len(results) - passed
    
    for test_name, result in results:
        status_emoji = "✅" if result else "❌"
        print(f"{status_emoji} {test_name}")
    
    print(f"\nTotal: {len(results)} tests | Passed: {passed} | Failed: {failed}")
    
    # Specific post-merge analysis
    critical_tests = [
        "Capital Bank Configuration",
        "URL Resolution Post-Merge",
        "Signature Generation"
    ]
    
    critical_passed = sum(1 for test_name, result in results if test_name in critical_tests and result)
    critical_total = sum(1 for test_name, _ in results if test_name in critical_tests)
    
    if critical_total > 0:
        print(f"\n🎯 Critical Post-Merge Tests: {critical_passed}/{critical_total} passed")
    
    if failed == 0:
        print("\n🎉 ALL TESTS PASSED - Capital Bank integration working correctly after merge!")
        return 0
    else:
        print(f"\n⚠️  {failed} TEST(S) FAILED - Post-merge issues detected!")
        return 1

def main():
    """Run post-merge verification"""
    return test_critical_post_merge_scenarios()

if __name__ == "__main__":
    sys.exit(main())