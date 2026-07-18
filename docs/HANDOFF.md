# Invoice Extractor — Project Handoff

> **Read this first in any new chat.** It captures everything needed to work on this
> project without re-deriving context or making errors. Last updated after commit
> `d26faab` (2026-07-18).

---

## 1. What this is

A single-page web app ("**Sabrina OS**") for **Chai Jee Kiong Trading Sdn Bhd (CJK)**, a
beverage distributor in Kuching, Sarawak. It has two areas:

- **Invoices** — AI reads supplier invoice photos/PDFs and builds a **Payment Summary**
  (with transport/volume subsidies) that CJK prints or exports to Excel. Two suppliers,
  each with its own subsidy model, live as sub-tabs:
  - **Choon Hua** (cascading carton model + 0.4% / 0.2%)
  - **YHS** (Yeo Hiap Seng — flat 2% + transport + per-volume bonus)
- **Payroll** — Malaysian statutory monthly payslips (EPF / SOCSO / EIS).

Primary users: **Owen** (owner/operator) and his **sister** (drops invoice images, no
technical knowledge). Keep it simple and forgiving.

**Live app:** https://invoice-extractor-eosin.vercel.app/ (auto-deploys on push to `main`).
**Repo:** github.com/owenchai33-byte/invoice-extractor (HTTPS remote, `main` branch).

---

## 2. Environment (critical — do this every session)

- **node/npm are NOT on the default PATH.** Prefix node commands with:
  ```bash
  export PATH="/opt/homebrew/bin:$PATH"
  ```
  (node v26, npm at `/opt/homebrew/bin`.)
- **Dev server:** never use `npm run dev` in Bash. Use the Browser-pane preview tool
  (`preview_start` with `{name:"dev"}`) — config is in `.claude/launch.json` (gitignored;
  `runtimeExecutable` is the absolute npm path). Port **5173**.
- **The preview pane's viewport sometimes reports 0×0** → `width:100%` collapses and
  measurements read 0. Fix with `resize_window {width:1100,height:800}` before measuring.
- **gh CLI** is installed and authenticated (Owen ran `gh auth login`). Push works over HTTPS.
- **Commit/push only when asked.** End commit messages with the Co-Authored-By trailer.
- Scratchpad for temp files: the session scratchpad dir (not `/tmp`).

### Common commands
```bash
export PATH="/opt/homebrew/bin:$PATH"
npm install            # if node_modules is stale
npx vitest run         # run all tests (currently 271 passing)
npm run build          # production build (must stay clean)
```

---

## 3. Architecture / files (`src/`)

| File | Role |
|---|---|
| `App.jsx` | Sabrina OS shell: top nav (Invoices / Payroll), clock. Root has `min-height:100vh`. |
| `InvoicesWorkspace.jsx` | Sub-tab bar (**Choon Hua** \| **YHS**), persists `invoices_subtab`. |
| `InvoiceExtractor.jsx` | **Choon Hua** extractor **+ all shared plumbing** (see below). |
| `YHSExtractor.jsx` | **YHS** extractor. Imports shared plumbing from `InvoiceExtractor.jsx`. |
| `Payroll.jsx` | Malaysian payroll (EPF/SOCSO/EIS), 65 wage bands. |
| `main.jsx` | Entry. |
| `__tests__/` | `invoiceExtractor.test.js`, `yhs.test.js`, `payroll.test.js`. |

**`InvoiceExtractor.jsx` is the shared library.** It exports the pure functions and shared
components that both tabs and the tests use: `calcSub`, `matchCat`, `parseDesc`,
`deriveActualLabel`, `computeIssues`, `normalizeDate`, `validInvoiceNo`, `formatVolUnit`,
`fmt`, `parseAIJson`, `callAI`, `runPool`, `pdfToImageFiles`, `downsizeBase64ToJPEG`,
`EditableAmount`, `EditableText`, `FlappyLoader`, plus config (`AI_PROVIDER`, `AI_CFG`,
`LOGO`, `CO`, `BATCH_CONCURRENCY`, `BATCH_MIN_GAP_MS`). **Don't paste logic between files —
import it.**

---

## 4. The two subsidy models

### Choon Hua (`InvoiceExtractor.jsx` → `calcSub`)
Cascading: each line-item group is matched to a **rate category** by (volume_ml, pack_size).
- `carton = Σ(group.ctn × group.rate)`
- `p1 = (amount − carton) × 0.4%`, `p2 = (amount − carton − p1) × 0.2%`
- FOC / RM0 invoices: carton subsidy still applies; p1/p2 = 0.
- Rate categories are in `config.rates` (e.g. `500ML x 24 = RM0.50`, `300ML x 24 = RM0.40`,
  `300ML x 12 = RM0.20`, etc.). Matched via `matchCat` (description text wins over AI numbers).

### YHS (`YHSExtractor.jsx` → `calcYHS`)
Flat model on the **batch total**:
- `2% discount` on total invoice amount.
- `transport = totalCtn × RM0.30` **plus** `totalCtn × RM0.20` (two lines).
- **per-volume bonus** = `subsidyCtn × rate` per distinct volume. Rate is **per-ml, editable**
  (`volRates`, default **0** = "no discount until you set it"). `subsidyCtn` defaults to the
  aggregated carton count but can be **overridden** (`volCtn`) when only part of a volume
  qualifies (e.g. Justea 300ml gets no discount) — the override affects the bonus only, **not**
  transport.
- `payable = total − 2% − transport1 − transport2 − Σbonus − otherDiscount − creditNote`.
- Rounds to 4dp to match the source Excel exactly (`calcYHS` is locked by tests against `1.xlsx`).

---

## 5. AI extraction

- **Provider: Anthropic Claude, `claude-haiku-4-5`** (`AI_PROVIDER='anthropic'` in
  `InvoiceExtractor.jsx`). Cheapest/fastest vision Claude, ~cents/month at CJK's volume.
  History: Groq/Scout (dead) → Gemini 2.5 Flash-Lite (free but rate-limited) → **Anthropic (paid, current)**.
- **Browser-direct** calls to `https://api.anthropic.com/v1/messages` — no backend. Requires
  the `anthropic-dangerous-direct-browser-access: true` header (CORS). The API key lives in
  the user's **localStorage** (`anthropic_api_key`), entered via the ⚙ API panel. Owen's key
  is on his machine; **you never have it** — you cannot run a real extraction yourself.
- **The deployed app cannot use a Claude subscription** — subscriptions aren't APIs. It needs
  a paid Anthropic API key. (This was settled after a long back-and-forth; don't re-propose
  "use your Claude login".)
- **Batching / concurrency:** `runPool` with `BATCH_CONCURRENCY` (4 on anthropic) and
  `BATCH_MIN_GAP_MS` (0 on anthropic). `callAI` handles single (`imageDataUrl`) **and** multi
  (`images[]`) images. YHS uses `YHS_CHUNK=1` on the paid tier (one image per call = reliable).
- **`parseAIJson`** tolerates markdown fences, arrays, extra prose, trailing commas, and
  unquoted keys; throws only on a hard failure (caller shows a friendly message).
- **`callAI` error handling:** 429 → `rate_limit` (retry w/ backoff); 401/403 → `auth`
  ("API key rejected"); malformed data-URL / empty response → `malformed`.

### Anti-"random data" guardrails (important — this is the recurring concern)
AI OCR is **never 100%**; the design goal is **never let a wrong read slip by silently.**
- Prompts forbid fabrication and tell the model to read volumes/amounts **literally** and
  flag anything unclear in `uncertain_fields` rather than guess.
- **Choon Hua `total_amount`** must be the **"Total Amount Due"** (post-discount bottom line),
  **not** the gross **"Total"** line. The self-check was fixed so it no longer pushes the model
  to the gross figure (the final total is normally *less* than the line-item sum).
- **YHS volumes** are read literally from the description ("1L…" → 1000, never substituted);
  continuation/footer pages return 0/0/[] and are **dropped** (`processFiles` filter).
- **Uncertainty is now visible:** any field the model flags (invoice no, date, amount) renders
  with an **amber highlight + ⚠ + tooltip** (both tabs). The highlight is screen-only (reset in
  print CSS). This is the review checkpoint — combined with the **👁 source-image preview** and
  **click-to-edit** on every field.
- If Haiku still misreads, the accuracy upgrade is a **one-line** change:
  `ANTHROPIC_MODEL = 'claude-sonnet-5'` (a few $/month instead of cents).

---

## 6. State / localStorage keys

| Key | What |
|---|---|
| `sabrina_active` | top tab: `invoice` \| `payroll` |
| `invoices_subtab` | sub-tab: `choonhua` \| `yhs` |
| `yhs_invoices` | YHS invoice list (YHS **persists**; **Choon Hua does NOT** — starts empty each load) |
| `yhs_volrates_v2` | YHS per-volume RM/CTN rates (persist across batches — product-stable) |
| `yhs_volctn_v1` | YHS per-volume subsidy-qty overrides (cleared by "Clear all") |
| `anthropic_api_key` / `gemini_api_key` / `groq_api_key` | per-provider API key |
| Payroll uses its own `_v3` keys | staff data + defaults |

**"🗑 Clear all"** button (both tabs, red, with confirm) wipes the list back to the upload
screen. YHS's reset also clears `volCtn` but keeps `volRates`.

---

## 7. Testing & CI

- **Vitest**, jsdom. `npx vitest run` → **271 tests** (as of `d26faab`). Tests import functions
  directly from source (never paste). Pure functions are heavily covered: `calcSub`, `calcYHS`,
  `matchCat`, `parseAIJson`, `computeIssues`, statutory tables, `parseVolInput`, etc.
- **GitHub Actions:** `.github/workflows/test.yml` — `npm install --no-audit --no-fund` on Node
  22, then `npx vitest run`. Keep it green.
- **Rule: every change must keep 271 (or more) tests passing and the build clean.** UI changes
  are verified live in the Browser pane (force `processing=true` temporarily to see the loader;
  seed `localStorage` for YHS; temporarily seed the `useState([])` for Choon Hua since it doesn't
  persist — **always revert temp seeds before committing**).

### Print (both tabs)
- Must fit **one A4** and start at the top (no blank first page). Fixed causes: `min-height:100vh`
  flattened in `@media print`; removed `page-break-inside:avoid` from the whole `.print-area`
  (kept on `tr`); compact print fonts. Test via print-media emulation (inject the print rules on
  screen at ~733px width and measure `.print-area` height ≤ ~1070px).

---

## 8. Recent work log (newest first)

| Commit | What |
|---|---|
| `d26faab` | Surface AI uncertainty — flag unsure fields (amber + ⚠) on both tabs |
| `79f0c74` | Choon Hua: read **Total Amount Due** not Total; CN col = AMOUNT width; **Clear all** button |
| `539a8dc` | Flappy loader → self-contained **SVG bird** (no favicon-file dependency) + even fade to white |
| `0a964e9` | Smoothed loader ground (seamless tile scroll) + blended into page |
| `96b75fc` | Added the cute **Flappy-Bird loader** while extracting (both tabs) |
| `b73bfef` | YHS: left-align AMOUNT column so every "RM" lines up |
| `3cbde23` | YHS: print summary as a neat right-aligned totals box (colgroup) |
| `b1a2d7e` | Flappy bird PNG as the **browser-tab favicon** (`public/favicon.svg` + `.png`) |
| `e6c1761` | YHS **editable subsidy qty** (`ctnOverrides`) + fix blank-page / one-A4 printing |
| `bde3306` | YHS: **editable volume label** in the breakdown (re-keys the ml) |
| `e43d7b8` | Choon Hua: **editable volume label** inline |
| `56c6703` | YHS: fix single-char input bug (moved components to module scope); rate-setting out of the total |
| `50b915f` | YHS: fix volume misreads, drop footer pages, per-volume rates |
| `94d8724` | Switch AI provider to **Anthropic Claude (Haiku 4.5)** |
| earlier | Test infra + CI, statutory corrections (7 EPF/SOCSO/EIS fixes), YHS tab build, provider migration |

`docs/HANDOFF_2026_07_03.md` is the older handoff (test-infra era) — superseded by this file.

---

## 9. Gotchas & conventions

- **Choon Hua does not persist** invoices; **YHS does.** To test Choon Hua UI, temporarily seed
  `const [invoices,setInvoices]=useState([...])` and **revert before committing.**
- Editable inputs use **local-string state, commit on blur/Enter** (so multi-char + decimals
  work). Components rendered inside `.map` or used as inputs must be **module-scope**, not defined
  inside the parent component (defining inside caused the "can only type one character" bug —
  the subtree remounts every keystroke and drops focus).
- The **favicon** is the yellow flappy bird (`public/favicon.svg` wraps a square-framed
  `favicon.png`). The loader draws a **separate inline SVG bird** (not the PNG) so it always
  renders.
- Keep the two tabs **consistent** (same loader, same "Clear all", same uncertainty flags, same
  print behavior).
- **Be honest about AI OCR:** don't promise perfection. The value is in flagging + easy editing,
  not in a claim of zero misreads.
- When the user reports a wrong extraction, ask for the **source image + what it produced** so the
  prompt can be tightened for that exact case.

---

## 10. If starting fresh, do this

1. `export PATH="/opt/homebrew/bin:$PATH"` then `npm install` if needed.
2. `npx vitest run` (expect 271 pass) and `npm run build` (clean) to confirm a good baseline.
3. Read the relevant source file end-to-end before editing (they're large single files).
4. Make the change, keep tests green, verify UI live in the Browser pane, revert any temp seeds,
   then commit + push (only when asked) and confirm CI + Vercel.
