# Post-mortem: Joint-signer W-8BEN-E deadlock at Step 4 (UAT)

| Field | Value |
|---|---|
| **Case** | AND-2025-014 |
| **Fund** | Sequoia Heritage Cayman Feeder IV, L.P. (feeder into Sequoia Heritage Master Fund IV, L.P.) |
| **Author** | Minh Nguyen (@minh.nguyen), Senior Implementation Engineer. Contributors: @qa.linh, @pm.alex |
| **Date** | 2025-05-07 |
| **Status** | Final. Delivered late: UAT sign-off and initial close both slipped 9 days |

## Project Context

- **Vehicle.** Cayman Islands exempted limited partnership, registered with CIMA as a private fund, venture capital strategy. It feeds into Sequoia Heritage Master Fund IV, L.P. LPs coming through this feeder are non-US institutional entities (IRS Form W-8BEN-E plus CRS entity self-certification) and US tax-exempt investors (IRS Form W-9).
- **Joint signers.** Many of the non-US entities sign through two or three Joint Authorized Signers under board resolutions. The administrator, Harbourline Fund Services (Cayman) Ltd., runs AML/KYC and files the FATCA/CRS reports with the Cayman Tax Information Authority through the DITC Portal.
- **Legal source.** Fund counsel circulated the final-form subscription agreement on 2025-03-21 (`sequoia_cayman_sub_agreement_excerpt.pdf`). Three parts of it matter here:
  - **Section 4.3(b):** exactly one *Designated Tax Signatory* makes the Chapter 4 and CRS elections and signs W-8BEN-E Part XXX.
  - **Section 4.3(d):** entries made by any other Joint Signatory have no effect until the Designated Tax Signatory submits them.
  - **Annex B:** each other Joint Signatory only signs an acknowledgement (para 3).
- **Our build.** A five-step FundSub flow: 1 Investor details, 2 AML/KYC (25% look-through, Section 3.2(b)), 3 Investor questionnaire, 4 Tax Certifications, 5 Review & Sign (DocuSign). Step 4 ran on schema `cayman_fatca_joint_signer` v1.4.1.
- **Close.** The initial close targeted 31 LPs on 2025-04-23. Seven of them were non-US entities with joint authorized signers.

## Timeline

All times ICT (UTC+7).

| When | What happened |
|---|---|
| 2025-03-03 | Kickoff with the GP and Harbourline. |
| 2025-03-21 | Final-form subscription agreement received, including Section 4.3(b), Annex B and Schedule A. |
| 2025-04-04 | v1.4.1 code complete. Single-signer tax regression green. Joint accounts tested by one tester, one signer at a time. |
| 2025-04-07 | UAT starts. |
| 2025-04-14 23:02 | @qa.linh reports Step 4 stuck on "Waiting for other signers" for joint test LP Kestrel Ridge Holdings Ltd. Repro 3/3. |
| 2025-04-14 23:19 | Admin force-unlock gets past Step 4, but envelope generation fails with `ENVELOPE_PREFLIGHT_FAILED` (duplicate anchor `\ch4_sig\`). |
| 2025-04-14 23:44 | Second joint test LP (Pellion Harbour Investments SA, 3 signers) shows the same failure. It only happens when a co-signer opens Part XXIX before the primary commits. |
| 2025-04-14 23:48 | Root cause found (`slack_uat_fatca_deadlock.txt` L41–45). |
| 2025-04-15 00:14 | v2 patch on staging. |
| 2025-04-15 00:31 | Both test LPs pass in both signer orders. The envelope generates with split anchors. |
| 2025-04-15 00:40 | @pm.alex decides to tell the GP and Harbourline in the morning. Planned UAT sign-off (04-15) is missed. |
| 2025-04-15 | 48-case regression (6 Chapter 4 statuses × 2 or 3 signers × 2 signer orders × Part XXIX open or closed). One extra defect: an Active NFFE / CRS Passive NFE pair was hard-blocked. It became a warning. |
| 2025-04-16 | v2.0.0 finalised and deployed to the UAT environment. The 19 UAT test subscriptions created under v1 are reset. |
| 2025-04-17 | Harbourline starts re-running its joint-signer UAT script on v2. |
| 2025-04-18 to 04-21 | Good Friday to Easter Monday. Harbourline's Cayman UAT team is out. |
| 2025-04-22 to 04-23 | Harbourline completes the re-test. Fund counsel confirms that the v2 role split matches Section 4.3(b)–(d) and Annex B. |
| 2025-04-24 | UAT sign-off, 9 days late. |
| 2025-05-02 | Initial close, 9 days late (planned 2025-04-23). |

## What Went Wrong in UAT

The tax step deadlocked for any joint account where a co-signer looked at the passive-NFFE branch before the primary signer committed. The sequence on Kestrel Ridge Holdings Ltd (joint signatories):

1. **Co-signer 2 opens Step 4 first.** A v1 prefill copied the CRS self-certification (Passive NFE) into their draft `tax.ch4_status` as `PASSIVE_NFFE`, so Part XXIX (Substantial U.S. Owners of Passive NFFE) appeared as required and they started reviewing it.
2. **Signer 1 commits Active NFFE.** Signer 1, the intended primary, selected **Active NFFE** on W-8BEN-E Part I, line 5, completed Part XXV and pressed Save & Continue. They got "Waiting for other signers".
3. **Neither side can finish.**
   - Co-signer 2 could not close Part XXIX. Their draft still said `PASSIVE_NFFE`, so it stayed required.
   - Signer 1 could not commit while Co-signer 2 had a Step 4 section open.
   - Co-signer 2's draft would only refresh after a commit.

   Step 4 never completed, so DocuSign envelope generation stayed disabled.
4. **Force-unlock fails at the envelope.** When QA force-unlocked Step 4 as admin, envelope generation failed anyway. v1 placed the same Chapter 4 anchor (`\ch4_sig\`) on both recipients, and our envelope pre-flight rejects an anchor that is shared between recipients.

The failure depended on order. If the primary committed before anyone else opened Step 4, the flow passed. Pre-UAT testing used one tester driving each signer in turn, so the bug never reproduced before UAT.

## Root Cause

We modelled "joint signatories" as N equal editors of the tax step. The subscription agreement defines one elector and N−1 attesters: Section 4.3(b) gives the elections to the Designated Tax Signatory, and Annex B para 3 gives everyone else an acknowledgement. Four v1 behaviours came out of that mismatch:

- **No owner for the election.** Every signer could edit `tax.ch4_status`, and each signer's edits sat in a private draft. That contradicts Section 4.3(b) and (d).
- **Drafts drove the conditional logic.** Part XXIX `visibleWhen` / `requiredWhen` read `draft.tax.ch4_status`, so two signers on the same account saw two different forms.
- **Step-wide lock.** Rule `step4.exclusive_lock` blocked the commit while any collaborator had a Step 4 section open. Drafts only refreshed on commit, so each side was waiting on the other.
- **Shared anchor.** One DocuSign anchor `\ch4_sig\` was cloned onto every signer, although only one person signs W-8BEN-E Part XXX.

## How We Fixed It

We shipped `cayman_fatca_joint_signer_v2.json` (v2.0.0, supersedes 1.4.1). It binds the tax step to the role split in the subscription agreement:

- **One elector.** `joint.designated_tax_signatory_index` (L21) captures the Annex B para 2 designation. That signer becomes `PRIMARY_TAX_COLLABORATOR`.
- **Read-only co-signers.** `tax.ch4_status` is editable only by `PRIMARY_TAX_COLLABORATOR` and read-only for co-signers (L36–37). The other tax and CRS fields are restricted the same way.
- **Committed state only.** `parameters.ruleEvaluationState = "COMMITTED"` (L16) makes every condition read the committed primary election. Part XXIX is keyed on the committed Chapter 4 status and the line 40c choice (L49).
- **No step lock.** The v1 `step4.exclusive_lock` is gone. `step4.completion` (L66) completes Step 4 when the committed tax/CRS data is valid and every co-signer has attested. On each primary commit, `step4.refresh_on_commit` (L67) discards co-signer drafts and re-renders their view.
- **Co-signer attestation.** Each co-signer gets their own `joint.cosigner_attestation` (L56), which mirrors Annex B para 3, instead of a W-8BEN-E signature.
- **Split anchors.** The primary signs `\ch4_primary_sig\` on W-8BEN-E Part XXX, and each co-signer signs `\cosigner_N_attest\` on Annex B (L73–75). The pre-flight expression (L77) asserts unique anchors and exactly one primary.
- **No CRS-to-FATCA prefill.** We removed the prefill. A FATCA/CRS classification mismatch is now a warning, not a block (L68).
- **Clean test data.** We reset the 19 UAT test subscriptions that held v1 drafts.

## Impact

- **Schedule.** UAT sign-off moved from 2025-04-15 to 2025-04-24, and the initial close from 2025-04-23 to 2025-05-02. Both slipped 9 days. The patch took one night. Most of the slip came from Harbourline re-running its UAT, which the Cayman Easter holidays delayed.
- **LPs affected.** 7 of the 31 initial-close LPs were non-US entities with joint authorized signers, about US$138M of commitments. None of them could have produced a DocuSign envelope on v1. We caught it in UAT, so no LP signed a v1 W-8BEN-E and nothing had to be re-papered.
- **LPs moved but not affected.** The other 24 LPs (single-signer non-US entities and US tax-exempt W-9 investors) were not affected functionally. Their close moved because the initial close is a single event.
- **Effort.** About 3 engineer-days (patch and migration), about 4 QA-days (regression matrix), and 2 extra UAT days at Harbourline. The GP asked for this written root cause as part of the sign-off pack.

## Reusable Rules for Future Funds

1. **Chapter 4 elections belong to exactly one role on joint accounts.** Map the sub agreement's Designated Tax Signatory (or equivalent) to `PRIMARY_TAX_COLLABORATOR`. Co-signers get a read-only view and their own attestation, never edit rights on `tax.*` or `crs.*`.
2. **Evaluate conditional logic against committed state, never a collaborator's draft.** If two signers can see different `visibleWhen` / `requiredWhen` results on the same account, the schema is wrong.
3. **Never lock a whole step on "someone has a section open".** Gate step completion on committed data plus per-signer attestations, and refresh other collaborators' views on commit.
4. **One DocuSign anchor per recipient per signature location.** Only the Designated Tax Signatory signs W-8BEN-E Part XXX. Run the envelope pre-flight in UAT for every signer count from 1 to `maxJointSigners`.
5. **Encode the signatory clause at kickoff.** Read the sub agreement's joint-signatory clause and annex (here Section 4.3(b)–(d) and Annex B) and turn them into roles in the form spec before building.
6. **Test joint accounts with concurrent sessions in both signer orders, and never derive FATCA status from CRS.** Test the case where a co-signer opens the step first. Never prefill the FATCA Chapter 4 status from the CRS classification: the regimes can legitimately disagree.
