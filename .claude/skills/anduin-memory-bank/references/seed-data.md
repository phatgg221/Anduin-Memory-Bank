# Seed Data — Anduin Private-Markets Scenarios (`backend/app/seed.py`)

## Rules

- **Realistic Anduin operations only:**
  - LP subscription packs and investor questionnaires;
  - W-8 / W-9 tax forms, FATCA / CRS;
  - AML/KYC and beneficial-ownership trees;
  - ERISA, side letters, UAT incidents.

  Never use lorem ipsum, todo apps, or e-commerce examples.
- **Every artifact a case names exists as a real file**, uploaded to MinIO under `cases/{case_slug}/artifacts/`, with plausible content — the demo will click it:
  - JSON schemas with real-looking field names (`chapter4_status`, `giin`, `joint_subscriber_index`, …);
  - Slack exports with timestamps, handles, and a back-and-forth that ends in the fix;
  - post-mortems with a timeline, root cause, impact, fix, and "next time" section;
  - PDFs, which can be short but must be real PDFs.
- **Author status is explicit:** `ACTIVE`, or `ALUMNI` plus when they left. Alumni knowledge is the product's core value, so some of the most valuable warnings should come from alumni.
- **Idempotent:** stable slugs (e.g. `sequoia-heritage-feeder-iv`) and upserts, so re-running never duplicates. `bun run dev --refresh-db` rebuilds from scratch.
- **Survive schema changes:** keep scenario *content* in a data module (e.g. `app/seed_data/` with one file per case, plus artifact files on disk), separate from the loading code. The table/field mapping waits for the schema decision; the content shouldn't have to be rewritten.
- **Ingest through the real path:** seeding goes through `vault` ingestion (chunk → embed → store), so retrieval is tested against the same code the app uses.

## Anchor cases

### Case 1 — Cayman Islands Master-Feeder LP Onboarding (`Sequoia Heritage Feeder IV`)
- **Author:** Minh Nguyen — `ALUMNI`, left 8 months ago
- **How it went:** delayed 9 days in UAT. Non-US institutional LPs signing **jointly** triggered conflicting W-8BEN-E Chapter 4 FATCA status validation rules.
- **Reusable artifacts:** `cayman_fatca_validation_schema.json`, `slack_thread_uat_fatca_fix.txt`, `lp_sub_agreement_mapping.pdf`

### Case 2 — Delaware Parallel Venture Fund with ERISA 25% Benefit-Plan Limit (`Andreessen Growth VII`)
- **Author:** Sarah Tran — `ACTIVE`
- **How it went:** smooth launch, but it needed a custom dynamic calculation hook to track aggregate ERISA benefit-plan investor commitments across the parallel entities in real time.
- **Reusable artifacts:** `erisa_25_percent_calculator.ts`, `delaware_erisa_postmortem.md`

### Case 3 — Luxembourg RAIF Cross-Border PE Subscription (`KKR Euro Infra III`)
- **Author:** David Le — `ALUMNI`, left 1 year ago
- **How it went:** external counsel lowered the AML/KYC beneficial-ownership threshold from 25% to 10% for high-risk jurisdictions mid-onboarding, which required a hotfix to the entity look-through tree.
- **Reusable artifacts:** `lux_aml_kyc_tree_schema.json`, `counsel_redline_notes.pdf`

## Distractors & coverage

With only three cases, "Top 3" returns everything and the ranking proves nothing. Add **6–10 more cases**, including deliberate near-misses, and mix ACTIVE/ALUMNI authors with smooth and troubled outcomes. For example:

| Near-miss case | Why it's there |
|---|---|
| Cayman open-ended hedge fund feeder (no joint-subscriber FATCA issue) | Same jurisdiction — must rank **below** Case 1 for a FATCA-heavy request |
| Delaware single-entity buyout fund, no benefit-plan investors | Delaware but no ERISA logic — distractor for Case 2 |
| Singapore VCC umbrella fund, CRS self-certification changes | Different tax regime with similar "tax form validation" vocabulary |
| Ireland ICAV credit fund, professional-investor eligibility checks | Different questionnaire logic |
| Delaware co-investment SPV, accelerated 5-day close | Same structure family, a timeline-driven pitfall |
| Luxembourg SCSp evergreen fund, semi-annual liquidity windows | Same jurisdiction as Case 3, no AML threshold change |

## Suggested demo trigger

The demo trigger is an incoming request that strongly matches Case 1 and exercises all three delta columns:

> **New GP request — Northwind Ventures Fund II.** Cayman Islands master-feeder. Non-US institutional LPs, several subscribing jointly. US tax-exempt investors, including ERISA plans, come in through the offshore feeder. Several EU LPs require an SFDR Article 8 sustainability disclosure questionnaire. MFN side letters expected for anchor LPs.

Expected outcome:
- **REUSABLE:** the W-8BEN-E joint-subscriber FATCA validation (`cayman_fatca_validation_schema.json`, from Case 1).
- **MODIFIED:** ERISA 25% tracking. Case 2's hook tracks Delaware parallel entities; this time it must track at feeder and master level.
- **NET_NEW:** the SFDR Article 8 questionnaire has no precedent.

Also store the trigger as a fixture. The opt-in retrieval regression test asserts that Case 1 ranks #1 for it.
