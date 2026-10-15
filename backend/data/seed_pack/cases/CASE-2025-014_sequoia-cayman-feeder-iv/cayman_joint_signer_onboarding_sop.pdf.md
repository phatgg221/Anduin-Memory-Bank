# Cayman Feeder Onboarding SOP — Joint Non-US Institutional Signers
*Client Operations playbook · Version 1.0 of 6 May 2025 · Owner: Minh Nguyen · Derived from CASE-2025-014*

This SOP covers onboarding of non-US entity limited partners that execute through two or more joint authorised signers into a Cayman Islands feeder fund on FundSub. It applies wherever the subscription agreement allocates tax elections to a single signatory. It does not restate FATCA, the CRS or Cayman Islands law: the role split below implements the fund's own subscription agreement, and the administrator remains responsible for reviewing tax forms.

## Section 1. Scope and Roles

| Role | Who | Can edit | Signs |
|---|---|---|---|
| `SUBSCRIPTION_OWNER` | LP's onboarding contact | Investor details, Annex B designation | Nothing |
| `PRIMARY_TAX_COLLABORATOR` | The Designated Tax Signatory named in Annex B | W-8BEN-E Part I line 5, GIIN, Parts XXV/XXVI/XXIX, CRS classification and Controlling Persons | W-8BEN-E Part XXX; CRS self-certification |
| `CO_SIGNER` | Every other joint signatory | Own attestation only | Annex B paragraph 3 acknowledgement |
| Administrator | Fund administrator's onboarding team | Nothing | Review only |

## Section 2. Kickoff Checklist (Week 1)

(a) Obtain the final-form subscription agreement and locate the joint-signatory clause and its annex. In CASE-2025-014 these were Section 4.3(b)–(d) and Annex B.
(b) Confirm in writing with fund counsel which signatory makes the Chapter 4 and CRS elections, and whether other signatories sign Part XXX or only an acknowledgement.
(c) Map those answers onto the roles in Section 1 and record them in the form specification before any build starts.
(d) Start from the `cayman_fatca_v2.json` schema. Change parameters only (jurisdiction, IGA model, reporting channel, maximum joint signers); never change field ownership or the committed-state evaluation.
(e) Agree with the administrator that a CRS classification is never used to prefill the FATCA Chapter 4 status.

## Section 3. Build Rules

- Conditional logic (`visibleWhen`, `requiredWhen`) reads committed state only. Two signers on one account must always see the same form.
- No step-wide locks. Step 4 completes on valid committed tax data plus one attestation per co-signer.
- One DocuSign anchor per recipient per signature location: `\ch4_primary_sig\` for the primary, `\cosigner_N_attest\` for each co-signer.
- Annex B must designate exactly one Designated Tax Signatory; zero or two designations block Step 1.
- A FATCA/CRS classification mismatch is a warning for the administrator, never a hard block.

<!-- pagebreak -->

## Section 4. UAT Script

Run `w8bene_joint_entity_exception_matrix.csv` in full. For every scenario:

(a) open two or three browser sessions, one per signer, at the same time;
(b) run each scenario twice, once with the primary opening Step 4 first and once with a co-signer opening it first;
(c) run the envelope pre-flight for every signer count from 1 to the configured maximum; and
(d) have the administrator review one generated W-8BEN-E per Chapter 4 status before sign-off.

> Note: in CASE-2025-014 pre-UAT testing used one tester driving each signer in turn. The co-signer-first deadlock only reproduces with concurrent sessions.

## Section 5. Go-Live and Change Control

| Gate | Owner | Evidence |
|---|---|---|
| Role mapping approved | Fund counsel | Email confirming Section 2(b) |
| Exception matrix green | QA | All 16 scenarios, both signer orders |
| Administrator review | Administrator | One accepted W-8BEN-E per Chapter 4 status |
| Draft reset plan | Client Operations | List of test drafts to purge before go-live |

If the Designated Tax Signatory changes after go-live, the subscription agreement normally requires notice signed by all joint signatories with an updated Annex B. Re-run Step 4 for that LP only; never merge co-signer drafts into the primary's committed elections.

## Section 6. Lessons from CASE-2025-014

- The deadlock cost a 9-day slip of UAT sign-off and the initial close across 14 joint-signer LPs. The patch took one night; the slip came from re-running the administrator's UAT over the Cayman Easter holidays.
- Budget two extra administrator UAT days whenever the role model changes after UAT has started.
- Ask at kickoff, not in UAT, who owns each tax election.
