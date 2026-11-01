# JaanchSetu — SIH26265 workspace upgrade

This update preserves the uploaded project's JaanchSetu identity, NestJS API, PostgreSQL model and existing FDR workflows. It improves the working product, rather than adding a disconnected presentation mockup.

## What the review found

The original project already includes source-labelled verification, OCR, maturity reminders, coverage forecasting, discrepancy management, institution scoping, maker–checker release processing and audit-backed release orders. Its principal presentation weaknesses were competing dashboard tiles, a horizontally wide evidence table, artificial loading delays and limited navigation shortcuts.

## What changed

- A coherent forest-green, warm-paper and terracotta design with a custom bridge mark, responsive navigation and an editorial sign-in screen.
- Four primary metrics with a role-scoped attention queue. Duplicate queue entries are merged. Explicit role restrictions are retained; restricted cases are ordered last. The ranking explanation is visible and does not claim machine learning.
- A selected case's decision brief explains why it is present and the next review action. It links to the real API-backed case.
- A maturity explorer switches between 3, 6 and 12 months and between instrument count and value. Clicking a month opens valid start/end date filters, including February and leap years.
- An evidence checklist navigates to documents, field review and discrepancies. It is an informational review aid, not a release authorisation or proof of authenticity.
- Field cards show institution, extraction and financial-source values side by side on desktop and stack on mobile. Officers retain the original confirm/correct actions. Differences and unreviewed fields can be filtered.
- A JSON decision-brief export includes the displayed record, five review checks, source evidence, document hashes, discrepancies and release information. It is not an official order or a signed attestation.
- Ctrl+K or / opens debounced API-backed search and permitted workspace commands. Keyboard focus is contained in the dialog and restored on close.
- Up to six named register views are stored per account in the browser. They save filters, not copies of financial records. Changing roles returns to the overview and remounts account-scoped views.
- Artificial page and splash minimum delays are removed. Document fetches cancel on navigation, object URLs are revoked, and the development entry point reuses its React root during hot refresh.
- Layout and text adjustments improve compact-laptop and mobile use. Reduced-motion preferences are respected.

## Validation

- Frontend TypeScript check and Vite production build passed.
- Backend TypeScript production build passed.
- All 60 existing backend unit tests passed (7 suites).
- All 11 new workspace tests passed: queue priority/deduplication, retained role restrictions, missing dates, month bounds/leap years, missing evidence, open discrepancies, insufficient checklist notes and historical release selection.
- The real local API and isolated embedded PostgreSQL were launched and the project's seed completed: 26 synthetic FDRs.
- Browser checks verified role login, API-backed command search, opening a discrepancy case, checklist-to-discrepancy navigation, a downloaded decision brief, saved-view filter restoration and switching to the institution role.
- Mobile dashboard was visually reviewed at a 390px viewport; the lifecycle stepper was adjusted after a small case-screen overflow was observed. Default browser size was restored afterwards.
- The pre-existing 256-check API E2E script has not been rerun as part of this UI update. Do not report it as newly passing.

## Run and review

On Windows with Node.js 20 or newer, extract the archive and run `start.bat`. It installs dependencies, starts an embedded PostgreSQL, seeds a fresh demo database and opens the app at `http://localhost:5173`. The first seed runs OCR on sample receipts and can take several minutes.

Demo password: `demo123`. Choose the scrutiny role to demonstrate the decision workspace. The accounts and institutional data are fictional. For a fresh environment, the required Node packages must be downloadable.

Frontend checks: `npm --prefix frontend run build` and `npm --prefix frontend test`.

Backend checks: `npm --prefix backend run prisma:generate`, `npm --prefix backend run build` and `npm --prefix backend test -- --runInBand`.

The package includes source and the built frontend. It excludes dependencies, local database files, runtime storage, test downloads and logs.

## Suggested short demonstration

1. Enter as Scrutiny Officer and explain the four primary metrics.
2. Select a queue item; show its reason and next step in the adjacent brief.
3. Use Ctrl+K to find `FD2026A0004`.
4. Show the amount difference between submitted and extracted values. Open the discrepancy panel through the checklist.
5. Export the decision brief and inspect the source references.
6. Return to the overview, choose a maturity month and show the matching register filter.
7. Switch to Institution and show the scoped workspace.

## Honest limits to keep in the SIH pitch

No real bank is connected by default. OCR and document hashes do not establish bank authenticity. The new checklist is informational; it does not add a new backend approval gate. The earlier NIDHIVEK proposal's selective invalidation of clearances after material evidence changes is **not implemented by this UI update** and must not be presented as working.

The new screens use English copy; the original language picker and existing translated screens remain available, but new translations have not been supplied or reviewed. Existing colour palettes remain in source, while the redesigned workspace uses a fixed visual system.

No competitor code was copied for this update. No claim is made about global uniqueness, production readiness or guaranteed SIH selection. Demonstrate the working behaviour and report measured results only after running the relevant evaluation.
