# Verification performed on 2026-10-14

| Check | Result | Evidence / boundary |
| --- | --- | --- |
| Build | Passed | TypeScript, compiled Node backend/worker, React/Vite frontend |
| Automated suite | 36 passed | Exact arithmetic, nine workflow/source combinations, approvals and source drift, partial settlements/ageing, correction/removal/reappearance, encrypted restore, filing recovery, OAuth, official Zoho request contracts and Tally readback |
| Dependency audit | 0 known production vulnerabilities | npm audit --omit=dev; replaced vulnerable static serving and upgraded PDF/CSV packages |
| Real PostgreSQL | Passed | Portable PostgreSQL 18; serializable transactions, approval, repeated posting, balanced reports; scripts/verify-postgres.ts |
| Real Temporal | Passed | Official local runtime; prepare, stop worker, approve offline, durable signal, restart, verified posting; scripts/verify-temporal.ts |
| Actual running product | Passed | Existing 178 SQLite records copied to persistent PostgreSQL; local Temporal and compiled worker running; HTTP invoice approval, document/bill intake, workflow, encrypted backup and balanced reports; scripts/verify-live-stack.mjs |
| Real model inference | Passed | Quantized DistilBERT MNLI via Transformers.js / ONNX CPU, synthetic descriptions; scripts/verify-model.ts |
| Actual model workflow | Passed | Real classifier proposal, reviewed questions, accountant approval, Temporal execution and PostgreSQL verified entry; scripts/verify-model-workflow.mjs |
| Automatic OCR | Passed | Synthetic invoice PNG and scanned PDF: amount 1180.00, date 2026-10-14, 94% confidence; scripts/verify-ocr.ts and scripts/verify-scanned-pdf.ts |
| Browser | Passed | Updated workspace, statutory preparation, missing-data questions and schema controls; earlier synthetic tax/bill approval flow retained |
| Approved frontend redesign | Passed | B styling/owner home plus C accountant review; all 20 views opened, source document dialog, owner reply, revision save and synthetic INR 118 approval verified; desktop and mobile checks in docs/frontend-redesign.md |
| Live Zoho/Tally | Protocol tests passed; customer qualification unperformed | Published schemas and emulated transports. No authorized live organization or physical Tally runtime supplied |
| Statutory provider | Normalized adapter/manual export tested | No selected/authorized provider; government submission, OTP/DSC, FVU and acknowledgement not demonstrated |
| Production Docker/server | Authored, not executed | No Docker on this Windows host. Compose references inspected and CI Docker build defined; server/domain access absent |

Machine-readable results are in data/verification and excluded from distribution. All execution checks used synthetic data. Classifier scores are not accounting accuracy qualification. Source contracts do not prove account-specific integration.

The active local app uses PostgreSQL and Temporal. Local Temporal uses persistent development storage; production Compose uses PostgreSQL-backed Temporal. The original SQLite database and separate Chausar/standalone designs are retained.
