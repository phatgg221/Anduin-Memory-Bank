# Seed Data — Anduin Private-Markets Scenarios

**Source of truth: `backend/data/seed_pack/`.** Its `README.md` is the authoring spec (manifest format, Slack/post-mortem/schema conventions, the Markdown subset for PDFs). This file summarises the rules and the demo contract.

## Rules

- **Realistic Anduin operations only:**
  - LP subscription packs and investor questionnaires;
  - W-8 / W-9 tax forms, FATCA / CRS;
  - AML/KYC and beneficial-ownership trees;
  - ERISA, side letters, MFN, UAT incidents.

  Never use lorem ipsum, todo apps, or e-commerce examples.
- **Content is separate from loading.** Scenario content lives in `backend/data/seed_pack/cases/<caseId>_<slug>/` (`case.json` + artifact files). The loader (`app/seed.py`, waiting on the domain schema) reads `case.json` and uploads exactly the files in `artifacts` to MinIO at `cases/{slug}/artifacts/{file}`, then ingests them through the real vault path (chunk → embed → store).
- **Every artifact exists as a real file.**
  - Legal excerpts are `*.pdf.md` sources rendered by `python -m app.seed_pdfs` into real PDFs. Both are committed, and the output is deterministic.
  - Every PDF carries a "fictional demo material" footer.
- **People come from `seed_pack/people.json`** (ACTIVE / ALUMNI with `leftOn`). Alumni knowledge is the product's core value.
- **Idempotent loading:** stable case IDs/slugs and upserts; `bun run dev --refresh-db` rebuilds from scratch.
- **Fictional names only** for investors, counsel, and administrators. Real regulations are cited accurately; fictional rules (e.g. "2026 CIMA guidance") are framed as client or counsel requirements.

## Cases in the pack

| Case | Fund | Archetype | Author | Key reusable artifacts |
|---|---|---|---|---|
| `AND-2025-014` | Sequoia Heritage Cayman Feeder IV | Conditional-logic deadlock + multi-signer race (W-8BEN-E Ch. 4 / Part XXIX) | Minh Nguyen · ALUMNI | `cayman_fatca_joint_signer_v2.json` |
| `AND-2025-029` | Andreessen Growth Parallel VII | ERISA 25% aggregate cap breach across parallel funds + Affinity prefill | Sarah Tran · ACTIVE | `erisa_aggregate_cap_guard.ts`, `affinity_prefill_mapping.json` |
| `AND-2025-051` | KKR European Infrastructure RAIF III | Counsel redline 48h before go-live: UBO 25% → 10%, 4-tier look-through | David Le · ALUMNI | `lux_aml_ubo_repeater_schema.json` |
| `AND-2026-008` | Blackstone Real Estate Debt X | Side-letter MFN + FX-normalized fee tiers (EUR/GBP vs USD thresholds) | Minh Nguyen · ALUMNI | `fx_mfn_tier_rules.json`, `side_letter_clause_matrix.csv` |

Each case also has a legal excerpt PDF, a Slack incident thread, and a post-mortem. See each `case.json` for the timeline, incident, root cause, and reusable rules.

## Coverage & distractors

Four cases make "Top 3" a weak ranking test.
- **AND-2026-008 doubles as a metadata distractor for REQ-A:** it's a Cayman master-feeder, but its problem is MFN/FX, so it must not outrank AND-2025-014.
- **Grow the pack to 8–10 cases** with deliberate near-misses (each as a full case folder), for example:

| Near-miss case | Why it's there |
|---|---|
| Cayman open-ended hedge fund feeder (no joint-signer FATCA issue) | Same jurisdiction; must rank below AND-2025-014 for a FATCA-heavy request |
| Delaware single-entity buyout fund, no benefit-plan investors | Delaware without ERISA logic; distractor for AND-2025-029 |
| Singapore VCC umbrella fund, CRS self-certification changes | Similar "tax form validation" vocabulary, different regime |
| Luxembourg SCSp evergreen fund, semi-annual liquidity windows | Same jurisdiction as AND-2025-051, no AML threshold change |

## Demo contract — incoming requests

`backend/data/seed_pack/incoming/` holds the "Load Demo" presets. Each is a client intake brief (`.pdf.md` + rendered PDF). `expected.json` is the regression fixture:
- `retrieval.mustRankFirst`, `shouldAppearInTop3`, and the metadata distractor;
- the expected delta rows (status, source case, artifact);
- the expected pitfalls.

| Request | Must rank first | Delta highlights |
|---|---|---|
| **REQ-A** Apollo Global Cayman Crossover Feeder II | `AND-2025-014` (~92%) | REUSABLE joint-signer W-8BEN-E (014) · REUSABLE Affinity prefill (029) · MODIFIED UBO 10% look-through (051 repeater, now applied to all investors) · **NET_NEW** hardware-wallet custody attestation annex |
| **REQ-B** Bain Capital Tech Opportunities Parallel V | `AND-2025-029` | REUSABLE ERISA aggregate guard · MODIFIED CRM prefill (Affinity → DealCloud) · MODIFIED joint signers (W-9, not W-8BEN-E) · **NET_NEW** QP look-through for single-purpose vehicles |

- **The DESIGN.md Workbench mock is REQ-A.** The citation inspector cites `slack_uat_fatca_deadlock.txt #L42`, so line 42 of that file is the first line of Minh's "Found the UAT blocker:" message. Keep it there if you edit the thread.
- **The opt-in retrieval test** (real embeddings) asserts `mustRankFirst` for both requests.
