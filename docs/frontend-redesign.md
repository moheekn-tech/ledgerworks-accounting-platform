# Approved frontend redesign — 14 October 2026

Implemented the selected combination: option B's warm ivory and terracotta styling, option B's owner home, and option C's accountant review layout. The original mockups remain in `design-review/`.

The owner home shows verified bank balance, outstanding posted receivables and payables, questions needing details, prepared work with the accountant, and recent imported bank activity. Figures come from the selected company's accounting data. Unreviewed bank activity is labelled “To match”; it is not represented as paid or posted.

Accountants land in Review. A filterable source/party/amount/status table sits beside the selected entry, its debit and credit lines, actual retained documents, questions and approval controls. Technical preparation details are under a disclosure. Images use the original retained file; text/PDF extracts are labelled by their actual source file, with an original download. Where no original is attached, the interface says so.

Owners can send details on the affected proposal. Their messages are visible to the accountant, who still checks the account, supporting evidence and answers. Sending a message does not silently resolve an accounting question or post an entry. Unsaved changes disable approval; saved revisions remain bound to backend approval checks. Completed entries are available under History.

All 20 accounting views remain reachable through Home, Transactions/Money, Review, Documents, Reports and Settings. The operator keeps preparation tools; the owner has no approval controls. Company/period reloads discard responses belonging to another context. Dialogs support Escape, contained keyboard focus and focus restoration.

## Verification

- Production build: TypeScript and Vite passed.
- Existing accounting regression suite: all 36 tests passed.
- Browser navigation: opened all 20 views; no error banner or captured console error.
- Synthetic owner reply: sent from Ravi's entry and observed in the accountant detail pane.
- Synthetic accounting revision: edited and saved the bank-charge description; approval disabled while unsaved.
- Synthetic approval: approved the existing INR 118 bank charge; Temporal completed posting, History showed Posted, and the trial balance showed INR 118 in Bank charges and INR 399882 in Operating bank. Trial balance debits and credits both INR 492840.
- Actual retained text document: opened from a posted bill in History; source text, original download and document dialog displayed.
- Responsive checks: 1440px desktop and 390px phone layouts. Page overflow checked; mobile tables can scroll inside their own containers. Company and period selection remain available.

Evidence screenshots are in `artifacts/ui-owner-home.png`, `artifacts/ui-accountant-review.png` and `artifacts/ui-owner-mobile.png`. Runtime sample data and verification screenshots are outside the source distribution archive.

These checks use synthetic local records. This frontend work does not change the separate live customer connector, statutory provider or production deployment qualification boundaries in `docs/verification.md`.
