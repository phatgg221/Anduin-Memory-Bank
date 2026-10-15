# Seed Data — Anduin Private-Markets Scenarios

**Source of truth: `backend/data/seed_pack/`.** Its `README.md` is the authoring spec (manifest keys, `channel.txt` format, artifact conventions, the Markdown subset for PDFs). This file summarises the rules and the demo contract.

## Rules

- **Realistic Anduin operations only**, across every department: LP onboarding and tax forms (W-8/W-9, FATCA/CRS), capital calls and wires, side letters and MFN, AML/KYC look-through, security RFPs (DORA, GDPR), private wealth scoping, tax-season distribution, CRM migrations and ERISA. Never lorem ipsum, todo apps or e-commerce examples.
- **Content is separate from loading.** Content lives in `seed_pack/`; `app/seed_pack.py` reads it; `app/seed.py` loads it:
  - upserts departments and users (seeded colleagues get `UNUSABLE_PASSWORD`; your own account is matched by `SEED_OPERATOR_EMAIL` and only gets department/role/title);
  - upserts each case by `caseCode`, uploads exactly the files in `artifacts` to MinIO at `cases/{channelSlug}/artifacts/{file}`, and replaces its channel messages;
  - resolves `Chat #L<n>` pitfall references to message IDs and adds `caseId` / `sourceArtifactId` to `comparisonResults`.
  - Knowledge chunks are not embedded yet; that lands with the intelligence pipeline.
- **Every artifact exists as a real file.** PDFs are `*.pdf.md` sources rendered by `bun run seed:pdfs` (deterministic, both committed, "fictional demo material" footer).
- **People come from `seed_pack/users.json`** by handle. Alumni (`is_active: false`, `departed_at`) only appear in activity dated on or before they left. Alumni knowledge is the product's core value.
- **Idempotent loading:** re-running `bun run seed` leaves the same rows; `bun run dev --refresh-db` rebuilds from scratch.
- **Fictional names only** for investors, counsel, administrators and banks' staff. Real regulations are cited accurately; fictional rules are framed as client, counsel or company policy.
- **`tests/test_seed_pack.py` validates the pack:** manifests, handles, alumni dates, message counts and order, attachments, `Chat #L<n>` references, delta source artifacts, CSV shape, PDFs in sync with their sources.

## People

| Handle | Department | Status |
|---|---|---|
| `chloe.nguyen` | Customer Success | ACTIVE |
| `elena.rostova` | Legal & Compliance | ACTIVE |
| `ryan.miller` | Sales & Solutions | ACTIVE |
| `sarah.tran` | Engineering & Data | ACTIVE |
| `marcus.vance` | Engineering & Data | ACTIVE |
| `minh.nguyen` | Client Operations | ALUMNI — left 2026-02-13 |
| `david.le` | Legal & Compliance | ALUMNI — left 2025-11-07 |

## Resolved cases (Memory Vault)

| Case | Department | Lead | Key reusable artifacts |
|---|---|---|---|
| `CASE-2025-014` Sequoia Cayman Feeder IV — joint-signer W-8BEN-E deadlock | CLIENT_OPERATIONS | Minh · ALUMNI | `cayman_fatca_v2.json`, `cayman_joint_signer_onboarding_sop.pdf`, `w8bene_joint_entity_exception_matrix.csv` |
| `CASE-2025-029` Andreessen Growth Parallel VII — legacy trust migration & ERISA 25% cap | ENGINEERING_DATA | Sarah | `legacy_lp_trust_migration_template.csv`, `affinity_crm_to_fundsub_mapping.json`, `erisa_25pct_parallel_cap_postmortem.md` |
| `CASE-2025-038` Carlyle Asia Buyout VI — JPY/EUR capital call FX tolerance | CLIENT_OPERATIONS | Minh · ALUMNI | `fx_settlement_tolerance_ops_policy.md`, `apac_multicurrency_wire_notice_template.pdf` |
| `CASE-2025-052` GIC & Temasek sovereign side letter — immunity & MFN tiers | LEGAL_COMPLIANCE | David · ALUMNI | `sovereign_wealth_side_letter_approved_redlines.pdf`, `mfn_tier_eligibility_matrix.csv` |
| `CASE-2025-067` KKR European Infrastructure RAIF — CSSF 10% UBO look-through | LEGAL_COMPLIANCE | David · ALUMNI | `ubo_4tier_lookthrough_schema.json`, `luxembourg_cssf_10pct_aml_compliance_guide.pdf` |
| `CASE-2025-081` BNP Paribas AM — EU DORA & Frankfurt residency RFP | SALES_SOLUTIONS | David · ALUMNI | `eu_dora_infosec_rfp_master_responses.csv`, `eu_frankfurt_data_residency_architecture.pdf` |
| `CASE-2026-003` Brookfield Private Wealth — delegated advisor scoping | SALES_SOLUTIONS | Ryan | `private_wealth_ria_scoping_rubric.pdf`, `advisor_delegated_access_matrix.csv` |
| `CASE-2026-011` Blackstone Real Estate Debt X — K-1 distribution & bank firewalls | CUSTOMER_SUCCESS | Chloe | `k1_tax_season_preflight_runbook.pdf`, `institutional_bank_email_whitelisting_guide.md` |

## Demo contract — open channels

`seed_pack/channels/<slug>/` holds the three OPEN case channels. Each `case.json` carries `comparisonResults`: the precedent banner the Workbench renders before the live pipeline exists, and the regression fixture for that pipeline (ranking, similarity, delta status and source artifact per row).

| Channel | Top matches | Delta highlights |
|---|---|---|
| `case-apollo-cayman-feeder` (`CASE-2026-047`) | 014 (94) · 067 (89) · 052 (84) | REUSABLE joint-signer schema + SOP (014) and 10% look-through tree (067) · MODIFIED MFN bracket US$25M → US$15M (052) and Lux → Cayman guide (067) · **NET_NEW** hardware wallet custody annex |
| `case-allianz-eu-wealth-rfp` (`CASE-2026-048`) | 081 (92) · 2026-003 (86) | REUSABLE DORA master answers + Frankfurt brief (081) · MODIFIED delegated advisor matrix and scoping rubric (2026-003) · **NET_NEW** Swiss banking secrecy waiver addendum |
| `case-tpg-migration-escalation` (`CASE-2026-049`) | 2026-011 (91) · 038 (88) · 029 (85) | REUSABLE bank whitelisting guide + K-1 runbook (011), FX tolerance policy + notice (038), trust template (029) · MODIFIED CRM map Affinity → DealCloud (029) |

- **The DESIGN.md Workbench mock is the Apollo channel.** Its citation inspector cites `#case-sequoia-cayman-iv` line 42 (`CASE-2025-014/channel.txt`), the first line of Minh's "Found the UAT blocker:" message. `test_demo_citation_line_42` keeps it there.
- **Retrieval tests** (once embeddings exist) should assert each channel's first `comparisonResults` entry ranks first.
