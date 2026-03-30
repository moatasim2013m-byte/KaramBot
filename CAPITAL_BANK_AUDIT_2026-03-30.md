# Capital Bank / CyberSource Secure Acceptance Audit (2026-03-30)

## Final Verdict
Implemented but broken.

## Why this verdict
- Core Secure Acceptance signing flow exists in backend and uses HMAC-SHA256.
- Required signed fields are defined, ordered, and used for signature creation.
- Frontend redirects correctly via backend-generated hosted form fields.
- Return and notify handlers exist and verify callback signatures.
- Blocking mismatch exists between repository docs and real routes/flow naming (README advertises `/secure-acceptance/...` routes that do not exist), which is a bank/UAT execution risk.

## Required field checklist
All Visa-required fields are present in payload generation and in `signed_field_names` constant order, and are included in the signature string generation path via `signFields()`.

## Critical risk notes
1. README integration contract is stale and points to route paths not implemented in runtime.
2. No explicit trim+non-empty validation for each required billing field at request boundary; whitespace-like values can pass into signed payload.
3. `CAPITAL_BANK_ENV` defaults to `prod` in code if unset; README wording historically references test default endpoint, creating environment mismatch risk.

