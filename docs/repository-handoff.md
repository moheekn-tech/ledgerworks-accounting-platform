# Repository handoff

This is the standalone Ledgerworks accounting product. The separate Chausar integration design remains in the parent workspace.

## Start a local sample workspace

Use Node.js 22.22.3 or later. From the repository directory:

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:4310 on the machine running the app. Sample identities are `owner`, `accountant` and `operator`, with password `demo`, while development authentication is enabled. All seeded companies are synthetic. This mode uses local SQLite, the local workflow coordinator and explicitly labelled fixture Tally/Zoho adapters.

To check the implementation:

```sh
npm test
```

The original checkout also has a provisioned PostgreSQL/Temporal qualification environment. Its machine-specific runtimes, databases and private configuration are intentionally outside Git. Do not assume `scripts/local-services.mjs` works on a fresh clone before provisioning its documented runtimes.

## Production and connected systems

See [deployment](deployment.md), [qualification](qualification.md), and [verification evidence](verification.md). A local source checkout is not a publicly hosted demo. Real customer Zoho/Tally connections, an authorised statutory provider and the target production server must be qualified separately. Development shortcuts must not be used for a production deployment.

## Frontend review

The implemented design combines B styling and owner home with C accountant review. Current screenshots are in `docs/previews`; original alternatives are in `design-review`. [Frontend notes](frontend-redesign.md) describe the verified flows and approval controls.
