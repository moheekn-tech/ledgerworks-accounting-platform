# Portable deployment on your server

The production package uses Docker Compose, PostgreSQL for application records, a separate PostgreSQL database for Temporal history, an accounting worker, and Caddy for HTTPS. Only the proxy publishes public ports. `docker-compose.yml` in the repository root remains a development convenience; use `deploy/compose.yml` for server deployment.

## Initial installation

Install Docker Engine with Compose on your Linux server. Point the chosen domain at its public IP and allow inbound 80/443. Keep PostgreSQL, Temporal, and application ports private.

```sh
node deploy/bootstrap.mjs
docker compose --env-file deploy/.env -f deploy/compose.yml build
docker compose --env-file deploy/.env -f deploy/compose.yml run --rm initialize
docker compose --env-file deploy/.env -f deploy/compose.yml up -d app worker proxy
docker compose --env-file deploy/.env -f deploy/compose.yml ps
```

Bootstrap generates random credentials and prints the three initial user passwords once. Preserve the backup encryption key separately from the server. It refuses to overwrite existing secrets. Initialization creates an empty native company, without synthetic transactions. The app creates its standard chart on startup. The service operator has explicit `*` company scope; owners and accountants have only their assigned company IDs. Update the configured identity file when assigning more companies and restart containers to refresh mounted credential files.

`deploy/secrets` and `deploy/.env` are ignored by Git and excluded from Docker builds and the distribution ZIP. Individual secret files must be readable by their container user; bootstrap gives the host parent directory private permissions. The deployment host administrator controls these files. Set up TOTP with `node scripts/provision-mfa.mjs deploy/secrets/auth-users.json accountant` and enroll the returned private URI in the accountant's authenticator.

## Models and OCR

The included CPU model proposes an accounting category using a quantized ONNX NLI model. The company must enable `modelEnabled`. Its score is a relative classifier score, not a calibrated accounting accuracy probability. Low scores produce questions. This is distinct from the optional Pi agent using an explicitly configured OpenAI model/key. Put the key in `deploy/secrets/openai_api_key`, set `MODEL_PROVIDER=openai` and `OPENAI_MODEL`, then recreate app and worker. A real local model has been exercised; the remote model path needs your credential.

OCR uses Tesseract locally, including rasterization for scanned PDFs. The first run downloads OCR language data and, when enabled, model weights. Persistent caches live in the application data volume. Images, PDFs up to the configured page bound, and text documents are supported. Unsupported files fail visibly. Extracted fields require review before preparing a vendor bill.

## Zoho Books

Register your OAuth client in the correct Zoho data center, authorize the customer's organization with the appropriate Books read/write scopes, and place the client ID, secret, and refresh token into their mounted secret files. No tokens belong in company profiles or frontend storage. Profiles store credential environment references, organization ID, region, and reviewed source mappings.

Start with `ALLOW_LIVE_WRITES=false`, onboard a `zoho` / `live` company, configure its account, vendor, customer, item, GST and TDS maps, and synchronize. Review source completeness and chart classifications with the accountant. Set `ALLOW_LIVE_WRITES=true` in `deploy/.env` only for the approved source organization and recreate app and worker. A changed map invalidates prepared approvals. A missing map produces an unresolved preparation question. Connected bills, invoices, expenses, receipts/payments and journals are separately created and read back, including actual per-account GL effects. Imported Zoho statement rows use the corresponding categorization endpoints.

Source contracts and readback behavior are covered by local protocol tests. They have not been qualified against your actual Zoho organization. The source snapshot rejects incomplete/unbalanced GL or mismatched account balance magnitudes. Foreign-currency rows without explicit base-currency amounts are rejected. API rate limits and account-specific behavior need testing on your representative data.

## Tally on Windows

Enable Tally's XML HTTP interface on local port 9000 and open the customer's company. Compile this checkout with `npm ci` and `npm run build` on the Tally machine, write the shared gateway token to a protected file, and start the loopback bridge:

```powershell
./scripts/start-tally-gateway.ps1 -CompanyName 'Exact Tally Company Name' -TokenFile 'C:\secure\tally-token' -AllowWrites
```

The bridge binds to 127.0.0.1:4311, permits only the named companies, rejects external XML entity declarations, and separately controls voucher creation. Publish the bridge through your HTTPS reverse proxy or private tunnel. Configure `TALLY_GATEWAY_URL` and the corresponding token secret on the application server. Do not publish Tally's own HTTP interface on the Internet.

Tally plans use party ledgers and New Ref / Agst Ref bill allocations, preserve the supplier/customer document reference, and use deterministic operation identities. Source sync reads groups, ledgers, opening balances, vouchers and allocations, aggregates party ledgers into AP/AR control accounts, and checks closing balances. XML import success alone does not mark a proposal verified; voucher date, reference, party effects and allocations must match. A source timeout leaves an uncertain outcome and must be reconciled, without another creation attempt.

The bridge launcher is provided; automatic startup and tunnel credentials are deployment choices on the customer's machine. Real Tally version, company settings, tax masters, numbering policy and inventory voucher behavior still require your representative company and accountant.

## Configurable statutory filing

The company profile selects `filingProvider`, defaulting to `manual-export`. GSTR-1, GSTR-3B, non-salary TDS, e-invoice and e-way-bill preparation all pass through versioned schema validation and accountant approval. Generated GST/TDS workpapers need accountant completion; they are not universal, ready-to-submit government returns. Non-salary TDS uses the quarter containing the selected month. Current Form 140 versus legacy 26Q is identified by period; official RPU/FVU artifacts, challan reconciliation, utility versions and authentication remain required.

Register the exact official/provider JSON schema and its actual source/version in the filing screen. The accountant completes the payload and questions, validates it, approves the exact hash and exports or submits it. A changed source set, period ledger, taxpayer settings or schema invalidates submission. An exported return is never described as government-filed. Manual acceptance requires an accountant-attested receipt document and acknowledgement; provider acceptance requires its bound acknowledgement and timestamp.

Custom providers are configured in `deploy/secrets/filing-providers.json`:

```json
{"chosen-provider":{"baseUrl":"https://your-provider-adapter.example","tokenEnv":"FILING_API_TOKEN","submitPath":"/v1/filings","statusPath":"/v1/filings/{reference}"}}
```

The provider adapter contract is documented in `provider-contract.md`. This is a normalized gateway contract, not a claim that arbitrary GST providers accept this envelope. Your chosen provider's authentication, OTP/DSC, encryption, transport and response adapter must conform to it. The product will preserve unknown outcomes and query status rather than resubmit. No filing provider has been selected or authenticated in this checkout.

## Backups, recovery and operations

Use Operations & backups to create and download an AES-256-GCM encrypted company backup. It includes transactional record snapshots and original document bytes. Restore verifies authentication, record digests and document hashes and refuses a nonempty target. The server-side restore command is `node deploy/restore.mjs /mounted/backup.lwbackup`, running against a new empty database/data volume with the original backup key. Local development has `scripts/restore-backup.ts`.

Keep independent off-server PostgreSQL dumps/snapshots of both databases, application volumes, configuration and encrypted company archives. Company backups alone do not include Temporal history, identity credentials or the encryption key. Disaster recovery of the whole Docker stack has not been executed on this Windows host, which has no Docker installation.

`/api/health` identifies the running drivers and configured execution paths. `/api/ready` checks the database and Temporal service. Container health checks use readiness. Operations screens expose source synchronization failures and backup status; application and worker logs expose operational failures. Runbook checks include restoring a backup to an empty destination and matching the accountant's TB, testing interrupted source writes, testing credential expiry, and reopening signed-off periods with reasons before importing source corrections. Workspace sign-off on connected books does not lock the period inside Zoho or Tally.

## Verification boundary

Real PostgreSQL, real Temporal with worker restart, real local model inference, OCR and a running HTTP product flow have passed on this machine. Production Compose has been authored and its YAML inspected; container building and a server deployment have not been executed here. CI includes the Docker build. You still need the server/domain access, source company authorization and chosen filing provider to verify the external environment.
