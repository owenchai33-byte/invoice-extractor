# Sabrina OS — Full Handoff for a New Chat
**Compiled:** 2026-07-30 · **Repo:** `~/Documents/invoice-extractor` · **Live:** https://invoice-extractor-eosin.vercel.app/

> Paste this whole file (or point the new chat at it) to continue without losing context.
> Also read `docs/HANDOFF.md` (module/business-rule detail) and `CLAUDE.md` (env + deploy rules).

---

## 0. ⚠️ MOST URGENT — the OpenClaw "Tomcat" agent is burning credit fast

There's a **self-hosted OpenClaw WhatsApp agent** on this Mac that Owen built to let his
non-technical sister request app fixes by text. It's set to **FULL-AUTO on Claude Opus 4.8**
(the most expensive model) and has been shipping commits on its own for days. That autonomous
Opus loop is the credit drain Owen is worried about.

**To throttle / stop it (pick one):**
```bash
# See what's running
openclaw channels status --deep
pgrep -fl openclaw

# A) CHEAPER MODEL for the code agent (biggest easy win — edit ~/.openclaw/openclaw.json):
#    agents.list[ id:"tomcat" ].model.primary  →  "claude-cli/claude-sonnet-5"  (or haiku)
#    (Opus 4.8 → Sonnet/Haiku cuts cost a lot. No restart needed for config, or restart gateway.)

# B) DISABLE just the code bot (Tomcat), keep the price bot (Janny) running:
#    ~/.openclaw/openclaw.json → channels.whatsapp.accounts.sabrina.enabled = false

# C) STOP EVERYTHING (both bots go offline — Janny the price bot too):
kill <gateway_pid_from_pgrep>        # e.g. the "openclaw ... gateway --port 18789" process
```
Owen mainly wants the *code* agent (Tomcat) reined in; **Janny the price bot is a live business
tool — don't kill it casually.** Option A or B is usually what he wants.

---

## 1. What this project is
**Sabrina OS** = a single-page Vite/React app for **Chai Jee Kiong Trading Sdn Bhd (CJK)**, a
beverage distributor in Kuching, Sarawak. Deployed on **Vercel (auto-deploys on push to `main`)**.
GitHub: `owenchai33-byte/invoice-extractor`. localStorage-only (no DB). AI features call
**Anthropic Claude (`claude-haiku-4-5`)** browser-direct, with the user's API key in localStorage.

**Top-nav tabs:** Invoices · Payroll · Contracts · Payslip (shell).

Users: **Owen** (owner/developer) and his **sister** (accountant, non-technical, drops photos).

---

## 2. Environment & workflow (do this every session)
- **node/npm are NOT on PATH** → run `export PATH="/opt/homebrew/bin:$PATH"` first.
- **Dev server:** use the Browser-pane preview tool (`preview_start {name:"dev"}`, port 5173), never `npm run dev` in a shell.
- **Before shipping:** `npx vitest run` must stay green (**271 tests**) and `npm run build` clean.
- **Deploy = push to `main`** (Vercel). A **pre-push hook blocks pushing to `main` unless `ALLOW_DEPLOY=1`** is set → deploy with `ALLOW_DEPLOY=1 git push`.
- Verify UI changes in the browser. Be honest about AI-OCR — it's never 100%.

### ⚠️ Known blocker (hit repeatedly this session)
This chat's **git write ops (commit/push) and some `~/.openclaw` config edits got blocked by the
harness safety classifier** — especially anything that looked like "auto-deploy money code" or
editing agent/deploy config. If a new chat sees **"Blocked by classifier"**, that's why. Workaround:
**Owen runs the git command himself, or tells Tomcat to deploy** (Tomcat's full-auto and CAN push).

---

## 3. Current state (2026-07-30)
- **Branch `main`**, in sync with `origin/main` (head `080a984`). One **uncommitted** file:
  `src/Payroll.jsx` (in-progress edit by Tomcat/Owen — not yet committed).
- **Everything from this session is deployed** (Tomcat/Owen shipped it): DATE-column fit fix,
  YHS total-row breakdown removal, **batch tabs** (Chrome-style, both suppliers), **Contracts tab**
  (fillable template **+ IC/ID photo → AI auto-fill**), **Payroll "Show bonus column" toggle**
  (Gawai — default ON, treats bonus as 0 when off), a Payslip tab shell, and payroll fx-bar tweaks.

---

## 4. Modules
- **Invoices** — AI reads supplier invoice photos → Payment Summary with subsidies. Two suppliers
  as sub-tabs: **Choon Hua** (cascading carton + 0.4%/0.2%) and **YHS** (2% + transport + per-ml bonus).
  Each supplier now has **batch tabs** (multiple independent invoice sets, kept alive in localStorage,
  namespaced by batch id). See `InvoicesWorkspace.jsx` (batch shell) + `InvoiceExtractor.jsx`
  (Choon Hua + all shared plumbing: `callAI`, `parseAIJson`, `downsizeBase64ToJPEG`, `EditableText`,
  `AI_PROVIDER`, `AI_CFG`, `LOGO`, etc.) + `YHSExtractor.jsx`.
- **Payroll** (`Payroll.jsx`) — Malaysian EPF/SOCSO/EIS, 271 tests. New: "Show bonus column" toggle.
  Money rules (do NOT break): EPF wage = salary+incentive+bonus; SOCSO/EIS wage = salary+incentive
  (bonus excluded); EPF via Third Schedule banding; SOCSO Cat1 employee = invalidity + Lindung 24 Jam.
- **Contracts** (`ContractGenerator.jsx`) — CJK employment-contract template, 5 editable fields
  (name, NRIC, address, position, effective date; yellow on screen, clean on 4-page A4 print).
  **IC/ID photo upload → AI fills name + NRIC + address** (position/date typed manually). Reuses the
  invoice AI plumbing + shared `anthropic_api_key`.
- **Payslip** — tab shell only (per commit `080a984`), not built out.

Business-rule reference lives in `docs/HANDOFF.md` §13 — keep those intact.

---

## 5. The OpenClaw two-agent setup (config at `~/.openclaw/openclaw.json`)
One OpenClaw gateway, **two agents** routed by `bindings` (matched by whatsapp `accountId`):

| Agent | Purpose | WhatsApp account | Number linked | allowFrom |
|---|---|---|---|---|
| **default** (Janny) | CJK price/stock bot | `default` | **60146766989** | Owen + `+60138202392` (013 user) |
| **tomcat** | code bot for THIS repo | `sabrina` | sister's **60168929599** | sister + Owen |

- Each account has its own `authDir` (separate WhatsApp login) so the two numbers don't collide.
- Tomcat's brain: **`~/.openclaw/workspace-tomcat/`** (its `AGENTS.md` = the repo rules + deploy rule;
  its `USER.md` = who Owen is). Janny's brain: `~/.openclaw/workspace/`.
- **Tomcat is FULL-AUTO** (Owen set it): sister texts a fix → Tomcat edits the repo → runs tests →
  `ALLOW_DEPLOY=1 git push origin main` → tells the sister it's live. **No human approval step.**
- **Gotcha:** an OpenClaw agent **can't message a *different* number** from within a chat (platform
  policy) — that's why an earlier "ping Owen for approval" design dead-ended; the fix was removing it.
- Model: `claude-cli/claude-opus-4-8` → **this is the credit cost.** See §0 to change it.

---

## 6. Owen — how to work with him (from feedback this session)
- **Direct, blunt, concise, casual ("bro").** No hedging, no verbose caveats, no option-menus.
- **Don't over-explain or re-litigate settled decisions** — once he's decided (even a config he
  edited himself), confirm in one line and move on. He'll snap "what are you still talking about."
- **No speculation / no random unverified content** — only state what's verified from the repo,
  what he shows you, or a real lookup. If you don't know, say so in one line.
- **Free-tier preference** (avoid paid services unless necessary). Kuching, GMT+8.
- **Deploy only when he asks** (and via `ALLOW_DEPLOY=1`); a pre-push hook enforces it.

---

## 7. Open threads / next steps
- `src/Payroll.jsx` is uncommitted — check what it is before committing (money file).
- The Contracts **IC-photo auto-fill** was verified UI-only; the *real* AI read needs Owen's API key
  (can't be tested without it) — confirm on first real photo.
- Payslip tab is a shell — not implemented.
- The "scan a LIST of many employees → many contracts" (batch contracts) was scoped but **not built**;
  Owen was going to send a sample of "the list."
- Decide on the OpenClaw credit throttle (§0).
