# Product qualification

The core paths are implemented and locally tested. This release is a build for integration and accountant qualification. Authorized external access and representative books remain necessary.

| Area | Implemented and checked | Remaining qualification / scope |
| --- | --- | --- |
| Native books | Double entry, exact money, approval, immutable entries, period controls, schedules/reversals | Accountant policies, fiscal year treatment, credit/debit-note and specialized valuation workflows |
| PostgreSQL/Temporal | Real execution, worker restart and running product migration | Production Docker stack, load, multi-instance contention and disaster recovery |
| Models | Real local model and completed product workflow; optional bounded Pi/OpenAI path | Remote credential and accountant-labelled evaluation corpus |
| Zoho | OAuth, pagination, full GL/subledgers, bills/invoices, partial payments, expenses, statement categorization, journals and readback | Actual organization, mappings, status/numbering/tax cases, credits/refunds, foreign currency and rate limits |
| Tally | Scoped bridge, groups/ledger/opening/closing balances, vouchers/allocations, Purchase/Sales/Payment/Receipt/Journal/readback | Customer machine/tunnel, version/settings, inventory/GST/tax masters and numbering |
| Documents | Real local OCR, PDF/text extraction, original bytes, retry, reviewed bill intake | Noisy scans, languages, multi-line extraction and confidence calibration |
| Statutory | Preparation, versioned schema validation, source-bound approval, export, normalized provider gateway and receipts | Chosen provider adapter, registration/credentials, OTP/DSC/FVU, full return sections and accountant completion |
| Identity | Company ACL, salted hashes, revocation, login cap, optional TOTP and secure production cookies | SSO, recovery procedures and deployed security testing |
| Delivery | Owner intake, preparation/review, workspace questions/resolution | Email delivery, subscriptions and service staffing |
| Reports | TB/P&L/BS, period P&L/cumulative BS, budget variance, dated native/Tally partial ageing, working consolidation | Historical Zoho ageing uses latest subledger balances; statutory statements/full multi-currency policy |
| Operations | Encrypted company backup/restore, sync failures, readiness and Docker package | Docker build/run, TLS/domain, offsite whole-stack backups/restore drills |
| Chausar | Original integration design preserved | Actual repository and authentication/event contracts |

Use the arranged Tally/Zoho data and accountant to compare expected books and exercise duplicates, partial payments, ambiguous transfers, edits after approval, token expiry, interrupted writes, corrections/deletions and period boundaries. API success alone is insufficient: identities, allocations and ledger effects must agree.
