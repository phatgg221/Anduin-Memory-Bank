# Private Wealth / RIA Pre-Sales Scoping Rubric & Effort Multiplier
*Sales & Solutions Architecture · Version 1.0 of 26 March 2026 · Authors: Ryan Miller, Sarah Tran · Derived from CASE-2026-003*

Use this rubric on every deal where investors are onboarded through wealth advisors, registered investment advisers (RIAs), broker-dealers or feeder platforms rather than directly. Our institutional scoping template asks how many investors a fund has. It never asks who fills in the forms. In CASE-2026-003 that gap cost four weeks of delivery.

## Section 1. Discovery Questions (ask before quoting)

(a) Who prepares subscriptions: the investor, the advisor, an advisor's assistant, or a home-office operations team?
(b) How many advisors, at how many firms, and how many client accounts per advisor (median and maximum)?
(c) Which account types are in scope: individual, joint (JTWROS or tenants in common), IRA or other custodial account, revocable or irrevocable trust, entity?
(d) Does the advisor attest to suitability or provide a certification, and is a home-office supervisory review required?
(e) Will advisors upload client lists in bulk, and in what format? Is there a CRM or custodian feed?
(f) Can advisors move between firms during the offering, and how are client relationships re-assigned?
(g) What is the closing cadence (monthly, quarterly, continuous)?

## Section 2. Effort Multiplier

Start from the institutional baseline estimate (B) for the same fund documents. Multiply by every factor that applies.

| Factor | Condition | Multiplier |
|---|---|---|
| Delegated preparation | Advisors prepare subscriptions for clients (1-to-many) | × 1.35 |
| Book size | Median of more than 25 accounts per advisor | × 1.10 |
| Bulk intake | Advisors upload client lists (CSV or feed) | × 1.15 |
| Custodial accounts | IRAs or other custodial accounts in scope | × 1.15 |
| Joint and trust accounts | More than one signer type per account | × 1.05 |
| Supervisory review | Home-office or broker-dealer review step | × 1.10 |
| Advisor mobility | Advisors may change firms mid-offering | × 1.05 |
| Continuous closes | Monthly or continuous closing cadence | × 1.05 |

> Note: In CASE-2026-003 the institutional baseline was 6 weeks. With delegated preparation, book size, bulk intake, custodial accounts, joint/trust accounts and advisor mobility, the rubric gives 6 × 2.17 ≈ 13 weeks; actual delivery took 10 weeks across two phases, against the 6 originally quoted.

## Section 3. Access Model Defaults

Start from `advisor_delegated_access_matrix.csv`. The non-negotiables are:

- An advisor sees only clients linked to their current, active rep code; access is re-evaluated nightly and on every transfer event.
- Assistants act for an advisor but never attest suitability.
- Advisors prepare and send; investors review and sign. No advisor signs on a client's behalf.
- The home office sees its whole firm but cannot change an investor's reviewed answers.
- For IRAs, the custodian signs its acceptance after the investor.

<!-- pagebreak -->

## Section 4. Phasing Pattern

When the client's first close is fixed, offer two phases instead of a slipped single launch:

| Phase | Scope | Typical timing |
|---|---|---|
| 1 | Advisor delegation, single-account preparation, individual and joint accounts | Baseline B, for the first close |
| 2 | Bulk intake, custodial (IRA) routing, home-office dashboards | B + 4 weeks |

## Section 5. Red Flags That Need a Solutions Architect Before Quoting

- More than 5,000 investors or more than 100 advisors.
- A broker-dealer supervisory workflow with its own approval system.
- A feeder platform sitting between the advisor and us.
- Advisors who expect to sign on clients' behalf under powers of attorney.

## Section 6. Worked Example: Brookfield Private Wealth (CASE-2026-003)

| Input | Value |
|---|---|
| Investors | About 2,500 HNW investors |
| Advisors | About 60 advisors at 9 RIA firms; median 42 accounts each |
| Account types | Individual, JTWROS, IRA, revocable trust |
| Quoted (institutional template) | 6 weeks |
| Rubric estimate | About 13 weeks (6 × 2.17) |
| Delivered | Phase 1 in 6 weeks (23 Feb 2026), phase 2 four weeks later (23 Mar 2026) |
