# CLAUDE.md — invoice-extractor (Sabrina OS)

Read `docs/HANDOFF.md` first — it's the full, current context for this repo.

This app calculates **real Malaysian payroll (EPF/SOCSO/EIS) and supplier subsidies**.
Wrong numbers mean real money paid incorrectly. Treat every change as money-critical.

## Environment
- node/npm are NOT on the default PATH — run `export PATH="/opt/homebrew/bin:$PATH"` first.
- Run the dev server via the Browser-pane preview tool, not `npm run dev` in a plain shell.

## Before anything ships
- `npx vitest run` must stay green (271 tests) and `npm run build` must stay clean.
- Work on a branch; don't commit straight to `main`.
- Verify UI changes in the browser. Don't claim the AI-OCR is perfect — it isn't.

## Deploy = push to `main` (Vercel auto-deploys)
**Never `git push` to `main` without the human's explicit OK.** A pre-push hook blocks
it unless `ALLOW_DEPLOY=1` is set. To deploy on purpose: `ALLOW_DEPLOY=1 git push`.
