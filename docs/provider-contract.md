# Filing provider adapter contract

The product talks to a normalized provider adapter. Selecting a provider URL is insufficient when the vendor has a different wire protocol. Implement that vendor's account registration, authentication, encryption, signing/DSC/OTP and official response mapping in the adapter before connecting it here.

Submission: `POST /v1/filings`, bearer authorization, `Idempotency-Key: filing:<companyId>:<filingId>`, `X-Payload-Digest`. The JSON envelope contains `reference`, `form`, `period`, `payloadDigest`, `schemaVersion` (registered schema digest), and the approved numeric JSON payload.

The adapter must persist the reference before sending a government/provider request. A repeated reference must return the original outcome, not submit again. It must retain source evidence for the transmitted payload, utility/schema version, taxpayer, acknowledgements and original provider status.

Status: `GET /v1/filings/<URL-encoded reference>`. Return the same approved reference and digest. Supported response statuses are `submitted`, `filed`, and `rejected`. `filed` requires `acknowledgement` and `acceptedAt` (ISO timestamp). Example:

```json
{"reference":"filing:company:uuid","payloadDigest":"approved-sha256","status":"filed","acknowledgement":"provider-or-government-acknowledgement","acceptedAt":"2026-10-14T09:00:00Z"}
```

HTTP timeout, malformed response or mismatched reference/hash is an unknown outcome. The product never repeats the admitted submission. Reconcile against this status endpoint. If a provider requires OTP/DSC, complete the authorized authentication in the provider flow before reporting acceptance; don't translate an authentication challenge into `filed`.
