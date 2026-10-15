# Project Context — Dejavu (Anduin Memory Bank)

> Product & domain background. The product is branded **Dejavu** (`DEJAVU // Institutional Memory Engine`); "Anduin Memory Bank" is the repo/working name.
> - System design: [ARCHITECTURE.md](ARCHITECTURE.md)
> - Brand & UI: [DESIGN.md](DESIGN.md)
> - Coding rules: the `anduin-memory-bank` skill (`.claude/skills/anduin-memory-bank/`)

## 1. Hackathon & Domain Background

- **Event:** Anduin Cybernetics — "Agent in the Shell" Build Challenge (Oct 9–22, 2026).
- **Track:** **KNOWLEDGE — THE MEMORY BANK**
- **Host domain (Anduin):** the technology partner for private markets (Venture Capital, Private Equity, Fund Administration). The platform digitizes fund onboarding, LP subscription agreements, tax forms (W-8BEN, W-9), AML/KYC checks, and custom side letters.

## 2. The Business Problem

> "The team repeatedly solves problems they've already solved, because past work is buried in folders and in the memories of people who may have left. When a new request comes in, the most useful thing someone could know is how similar past cases went and what's different this time. Finding that out today means asking around or digging through old files, so most people just start from scratch."

**Challenge:** build a tool that helps people reliably find and reuse their own past work when something new arrives.

## 3. Product Philosophy & Core Thesis

**We are NOT building a passive "Chat with PDF" search bar.** Chatbots fail here because new employees don't know which keywords to search for when the tribal knowledge lives in the heads of departed employees ("Alumni") or in buried Slack threads.

We are building a **Trigger-First Case Triage & Delta Intelligence Workbench**:

1. **Proactive intake trigger** — a new fund-onboarding request, client ticket, or legal spec arrives; the user drops it into the Workbench.
2. **Automated precedent matching** — the system extracts structured metadata (jurisdiction, fund structure, investor types, custom logic) and runs a hybrid search (pgvector semantic similarity + metadata boosting) to surface the **Top 3 most similar past cases**.
3. **"How similar past cases went"** — post-mortems, hidden bottlenecks, Slack/ticket warnings — with knowledge from departed staff explicitly tagged `ALUMNI` so it isn't lost.
4. **"What's different this time" — the Delta Matrix** — a structured LLM comparison of the incoming request against the matched case, in three columns:
   - **Identical / 100% Reusable** — logic, schemas, and templates that can be cloned now.
   - **Modified / Delta** — clauses, regulatory rules, or edge cases that differ and need custom work.
   - **Net-New Risks** — requirements with no historical precedent.
5. **1-click asset reuse** — presigned MinIO links to download or clone artifacts (JSON schemas, mapping templates, validation scripts) from past cases.

## 4. Target User Persona

**Implementation / Delivery Engineers and Legal Digitization Specialists at Anduin.** Every week a General Partner (GP) sends a 120-page LP Subscription Pack (e.g., a Cayman Islands feeder fund with custom ERISA rules). In 30 seconds the engineer needs to know:

- Did we build a fund like this before? Who built it — and are they still here?
- What broke during UAT?
- Which JSON form schemas and mappings can I copy right now?

## 5. The 30-Second Demo Story

1. The engineer drops in a new GP request, e.g. a Cayman master-feeder with non-US institutional LPs, US ERISA plans coming in through the offshore feeder, and EU LPs asking for SFDR disclosures.
2. Extracted brief chips appear: jurisdiction, structure, investor types, key requirements.
3. The Top 3 precedents appear with `% Match` badges. The #1 case was built by an engineer who left 8 months ago (`ALUMNI`).
4. "How it went": a 9-day UAT delay caused by W-8BEN-E Chapter 4 FATCA validation conflicts on joint subscriptions, with the Slack thread cited.
5. The Delta Matrix shows green (reuse the FATCA validation schema), amber (ERISA 25% tracking exists, but for a different structure), and red (SFDR questionnaire: no precedent).
6. One click exports `cayman_fatca_joint_signer_v2.json` from the past case, and the Affinity prefill mapping from the ERISA case.

## 6. Glossary

| Term | Meaning |
|---|---|
| **GP / LP** | General Partner (fund manager/sponsor) / Limited Partner (investor in the fund). |
| **Subscription pack / sub docs** | What an LP completes to invest: subscription agreement, investor questionnaire (accredited investor, qualified purchaser status), tax forms, AML/KYC documents. |
| **Master-feeder** | Feeder funds pool capital into one master fund that holds the portfolio — commonly a Delaware feeder for US taxable investors and a Cayman feeder for non-US and US tax-exempt investors. |
| **Parallel fund** | Separate vehicles investing side-by-side, pro rata, in the same deals — usually for tax or regulatory reasons. |
| **Side letter** | LP-specific agreement adding or modifying terms (fee discounts, reporting, excuse rights, MFN). |
| **MFN** | Most-Favored-Nation clause — an LP may elect terms granted to other LPs. |
| **W-9 / W-8BEN / W-8BEN-E** | IRS tax-status certifications: W-9 for US persons, W-8BEN for non-US individuals, W-8BEN-E for non-US entities (includes FATCA Chapter 4 status). |
| **FATCA (Chapter 4)** | US regime requiring foreign entities to classify and report US account holders — drives W-8BEN-E validation rules. |
| **CRS** | OECD Common Reporting Standard — the non-US analogue of FATCA, via self-certification forms. |
| **ERISA 25% test** | If "benefit plan investors" hold 25% or more of any class of equity in a fund, its assets can become ERISA "plan assets" — GPs track and cap this. |
| **AML / KYC** | Anti-Money-Laundering / Know-Your-Customer checks on investors. |
| **Beneficial ownership (UBO)** | The natural persons who ultimately own or control an investing entity above a threshold (commonly 25%, lower — e.g. 10% — for higher-risk cases) — requires a look-through ownership tree. |
| **RAIF** | Luxembourg Reserved Alternative Investment Fund — not directly supervised by the CSSF; must be managed by an authorised AIFM. |
| **UAT** | User Acceptance Testing — the GP / fund admin tests the digitized onboarding flow before LPs use it. |
| **Alumni** | A former employee. Knowledge they authored is tagged `ALUMNI`. |
| **Historical case / precedent** | A completed past onboarding stored in the vault, with its artifacts, post-mortem, and discussions. |
| **Delta Matrix** | Per-requirement comparison of incoming vs. historical: `REUSABLE` / `MODIFIED` / `NET_NEW`. |

## 7. Open Product Questions

The feature set is **not concluded yet** — answers here will drive the data model (deliberately not designed yet).

- **Intake formats:** pasted text only, or PDF / DOCX / email uploads? How do we handle 120-page PDFs?
- **Growing the vault:** seed data only, or can a finished triage be saved back as a new historical case to close the loop?
- **Delta scope:** compute the delta for the #1 match only, or for all three (eagerly or on demand)?
- **Citations:** per delta item *and* per pitfall warning? Per-warning citations are what let the UI put an `ALUMNI` badge on individual warnings.
- **Mailpit's role:** "ask the current owner" emails? Job-complete notifications? Something else?
- **Similarity % display:** raw cosine similarity bunches together; do we calibrate it before showing it?
- **Auth / multi-user:** assumed none for the hackathon.
