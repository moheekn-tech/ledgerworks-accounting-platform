# Ledgerworks UI review — 2026-10-14

Open the review board at http://127.0.0.1:4312/ while the preview server is running, or open index.html directly. Select A/B/C, compare all, or open an image full size.

| Direction | Focus | Design |
| --- | --- | --- |
| A · Workbench | Shared daily workspace | Pale sidebar, dark green accent, one attention queue, contextual document pane |
| B · Owner home | Business owner | Warm paper background, short top navigation, essential balances and next steps |
| C · Review desk | Accountant | Compact table, filters, source evidence and entry in one pane |

All mockups use fictional sample data. The source previews are design placeholders. These images do not exercise accounting logic. The current application and its backend were left unchanged.

## Shared direction

- Use readable type and stronger contrast, rather than the current tiny gray labels.
- Show the action and its status. Remove slogans, repeated explanations and generic dashboard decoration.
- Collapse the 20 individual menu entries into Home, Transactions, Review, Documents and Reports, with settings and detailed tools inside their relevant sections.
- Reveal audit details, tax rules and connector diagnostics only when needed.
- Retain document evidence and accountant approval beside the work.

## Implementation after review

The selected style can be applied to the existing React components, navigation and review presentation. Existing API routes, workflows, accounting logic and permissions stay in place. A balanced product can combine B's owner information hierarchy and C's accountant workflow using one chosen visual system.

## Artifacts

Final mockups: assets/option-a.png, assets/option-b.png and assets/option-c.png. Initial drafts are retained separately. Generated with the built-in image_gen tool using the imagegen skill. The exact original prompts are in generation-prompts.json; targeted refinements are in edit-prompts.json.

Start the isolated review server with `node design-review/server.mjs`. It serves static review files on loopback port 4312 and has no connection to accounting actions or customer data.
