# Post-mortem: Luxembourg UBO threshold redline (25% to 10%, 4-tier look-through)

| Field | Value |
|---|---|
| **Case** | AND-2025-051 |
| **Fund** | KKR European Infrastructure RAIF III SCSp (Luxembourg RAIF) |
| **Author** | David Le (@david.le), Lead Implementation Engineer |
| **Date** | 2025-10-06 |
| **Status** | Final: DELIVERED_WITH_HOTFIX, 0 slip days |

Contributors: @cs.maya (counsel liaison), @qa.linh (QA), @pm.alex (delivery PM).

## Project Context

- **Vehicle:** KKR European Infrastructure RAIF III SCSp, a Luxembourg special limited partnership qualifying as a RAIF under the Law of 23 July 2016. The AIFM, Northlake Infrastructure Management S.à r.l. (CSSF-authorised), runs AML/KYC on the Fund's behalf. Luxembourg counsel is Clausen Pfaffenthal Avocats.
- **Scope:** FundSub subscription pack plus the AML/KYC module, built to counsel's AML/KYC pack (`kkr_lux_raif_aml_kyc_pack.pdf`, Revision 1 of 11 August 2025 at kickoff).
- **v1 UBO capture:** `lux_aml_ubo_static_table` v1.4.0. It was a static 3-row table, because only three holders can each exceed 25%. The 25% threshold was hard-coded in the validation expression, and each entity had one look-through row.
- **Dates:** kickoff 2025-08-18, UAT from 2025-09-15, UAT sign-off 2025-09-26 (the investor portal opened to the initial-close cohort the same day), initial-close go-live 2025-10-01 09:00 Luxembourg time (14:00 ICT).

## Timeline

All times are ICT (UTC+7). Luxembourg was on CEST (UTC+2).

| When | What happened |
|---|---|
| 2025-08-18 | Kickoff. Counsel's pack Revision 1 is the baseline. |
| 2025-09-15 | UAT starts (@qa.linh). |
| 2025-09-26 | Northlake signs off UAT. The investor portal opens for the initial-close cohort. |
| 2025-09-29 13:40 | Counsel's Revision 2 arrives (08:40 CEST). It adds Section 5.2(c) (10% or more for High-Risk Exposure investors) and Section 5.3 (recursive look-through to 4 tiers). At that point 31 drafts are in progress and 12 subscriptions are signed. |
| 2025-09-29 13:52 | @cs.maya relays the redline in #deal-kkr-euro-infra-iii. |
| 2025-09-29 14:09–14:26 | I propose a versioned repeater schema plus a draft migration. Counsel confirms that Section 7.2(a) (transition) covers re-prompting only the delta. |
| 2025-09-29 14:40 | @qa.linh posts the QA plan. |
| 2025-09-30 10:12 | Migration dry run on a staging copy: 31 drafts migrated, 0 values lost, 7 NEEDS_INFO, 24 unchanged. |
| 2025-09-30 18:30 | QA passes 38/38 after one migration fix (ambiguous v1 look-through rows). |
| 2025-09-30 21:40 | Walk-through with Northlake compliance and counsel. Go/no-go: GO. |
| 2025-09-30 22:47 | Hotfix v2.0.0 ships. The migration runs and 7 investors are notified. |
| 2025-10-01 14:00 | Initial close holds at 09:00 CEST. |

## What Went Wrong in UAT

UAT itself passed. That is the uncomfortable part: everything was tested against Revision 1, and the redline arrived three days after sign-off and 48 hours before go-live. The redline exposed four weaknesses that UAT could not have caught as scoped:

1. **The threshold lived in three places**: the validation expression (`> 25`), the table's row count (3), and the investor-facing helper text. Changing "the number" meant changing the layout.
2. **The look-through depth was a layout decision.** The table had one look-through row per entity. Counsel now needed up to 4 tiers, and v1 could not represent the Annex C Part 2 worked example at all.
3. **Drafts had no schema versioning.** Editing v1 in place would have made every half-filled high-risk draft fail validation on its next save. That would have meant a silent restart for investors two days before close.
4. **The UAT fixtures had no multi-tier chains**, so depth was never exercised. They also had no holder at exactly 10.00% or 25.00%, so the comparator was never tested either.

The QA plan also caught one migration bug on its first run. Some investors had typed an entity's name into a v1 look-through row marked NATURAL_PERSON. The migration took those rows at face value and ended the chain early. 2 of the 7 affected drafts had such a row.

## Root Cause

We encoded a counsel- and regulator-driven threshold as a constant and as a fixed layout (3 rows, 1 look-through tier) instead of as a parameter. We also had no migration path for in-flight drafts between schema versions. Late counsel redlines are normal on Luxembourg launches. Our design was the reason a one-number change became a structural rewrite under deadline.

## How We Fixed It

- **`lux_aml_ubo_repeater_schema.json` v2.0.0.** The static table became a recursive `ubo.owners` repeater. Each node holds name, person type, country, ownership %, a control-only flag, a PEP flag and `children`. The node's `effective_pct` is multiplied down the chain, as Section 5.3(c) requires.
- **Parameters, not constants.** The schema now has `ubo_threshold_pct` (default 25), `ubo_threshold_inclusive` (default false), `high_risk_threshold_pct` (10, inclusive, citing Section 5.2(c)), `max_depth` (4) and `high_risk_list_source` (EU Delegated Regulation 2016/1675, the FATF lists, and AIFM designations, with a snapshot date). Rule `ubo.resolve_threshold` is the only place the threshold switches. Every parameter change carries an audit entry: who made it, who approved it, why, and the source clause.
- **Validation.** Holdings disclosed for one entity cannot exceed 100%. An entity that meets the threshold must disclose its own holders until Tier 4. A Tier 4 entity that still meets the threshold escalates to Northlake compliance (`ubo.escalate_depth`, Section 5.3(d)) instead of opening a Tier 5.
- **`migrate.v1_to_v2`.** The migration maps each v1 row into the repeater at its tier, keeps every value entered, and re-resolves the threshold. Only drafts that gained required rows went to NEEDS_INFO, and the investor email listed only the missing owners. Ambiguous v1 rows are flagged for re-confirmation, never auto-converted. Signed subscriptions are out of scope; under Section 7.2(b), Northlake handled them directly.
- **QA (@qa.linh):** 38 cases covered the following:
  - boundary values 9.99 / 10.00 / 10.01 and 25.00 / 25.01;
  - the Annex C Part 2 worked example end to end, including L. Osei-Brandt at 10.44% as a PEP;
  - holdings above 100% for one entity;
  - Tier 4 escalation;
  - a remitting-account change that flips `high_risk_exposure` mid-draft.

## Impact

- **No slip.** The initial close held on 2025-10-01 at 09:00 CEST.
- **31 drafts migrated with 0 entered values lost.** 24 were untouched. 7 were re-prompted, for 19 additional owner rows in total. Of the 7, 5 were domiciled in a listed jurisdiction (Section 3.2(a)) and 2 funded through a listed account (Section 3.2(b)).
- 6 of the 7 completed before the cut-off. The 7th has a Tier 4 holding company that still meets the threshold. It went to Northlake compliance under Section 5.3(d) and moves to the subsequent closing.
- Northlake confirmed that none of the 12 signed subscriptions was High-Risk Exposure, so nothing was reopened.
- **Cost:** about 33 hours from redline to deploy, one late-night release (22:47 ICT), and no rollback. Investor-facing impact was one targeted email to 7 investors.

## Reusable Rules for Future Funds

1. **Never hard-code a regulatory threshold in a form. Make it a parameter with an audit trail** (who changed it, who approved it, why, and the source clause). Read it through `params.*` everywhere, including helper text.
2. **Model ownership as a recursive repeater with `max_depth`, never as a fixed-row table.** The row count is the threshold in disguise: 100 / threshold holders per entity.
3. **Version every form schema, pin drafts to their version, and ship each change with a migration rule.** The migration should preserve entered values and re-prompt only the delta. Never edit a published version in place.
4. **Keep the comparator with the number.** The statutory "more than 25%" is exclusive and counsel's "10% or more" is inclusive. Test x - 0.01, x and x + 0.01 for every threshold.
5. **Resolve the applicable threshold in exactly one rule, from a dated high-risk list snapshot** (EU Delegated Regulation 2016/1675 plus the FATF lists). Re-resolve it whenever domicile or the remitting account changes.
6. **On counsel-led launches (Luxembourg especially), ask counsel at kickoff about pending AML/KYC changes,** and ask for a transitional clause like Section 7.2(a). That way a mid-flight redline re-prompts only the delta instead of forcing a restart.
