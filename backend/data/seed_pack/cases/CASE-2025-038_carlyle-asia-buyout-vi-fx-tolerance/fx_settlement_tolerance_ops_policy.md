# FX Settlement Tolerance Policy for Capital Call Reconciliation

| Field | Value |
|---|---|
| **Case** | CASE-2025-038 |
| **Fund** | Carlyle Asia Buyout Partners VI, L.P. (USD-denominated) |
| **Author** | Minh Nguyen (@minh.nguyen), Principal Operations Architect |
| **Reviewed by** | Elena Rostova (@elena.rostova), Legal Counsel; GP counsel |
| **Adopted** | Version 1.1, 1 August 2025, by the General Partner under LPA Section 3.4(e); acknowledged by Tidewater Fund Services (HK) Ltd as administrator |

## 1. Why this policy exists

Capital calls are denominated in USD, but Japanese and European limited partners often instruct their banks in JPY or EUR. The bank converts at the spot rate on the instruction date, and the wire settles one or two business days later. Spot moves in that window, plus intermediary bank lifting fees deducted under `SHA` charges (MT103 field 71A), leave the USD amount received a few hundred dollars away from the amount called.

Before this policy, reconciliation matched to the cent. On Call #1 (15%, due 25 July 2025), 23 of 61 limited partners were flagged `UNDERFUNDED` and received automated "capital call outstanding" reminders, although 22 of them had paid in full in their own currency. Only one (Mirae Ocean Holdings, 3.0% short) was a genuine shortfall.

## 2. Evidence for the band

Minh Nguyen reviewed 18 months of capital calls across four Asia and Europe funds with non-USD remitters:

| Measure | Value |
|---|---|
| Largest 48-hour FX variance on a JPY or EUR wire | 0.11% of the called amount |
| 99th percentile FX variance | 0.07% |
| Largest single intermediary lifting fee | USD 65 |
| Smallest genuine shortfall observed | 1.8% |

A ±0.25% band covers the worst observed FX move with more than a 2x margin and stays an order of magnitude below the smallest genuine shortfall.

## 3. Policy

1. **Tolerance band.** A contribution is **settled within tolerance** when the USD amount received differs from the amount called by no more than **±0.25%** of the amount called.
2. **Adoption.** The General Partner adopts this treatment under LPA Section 3.4(e), which allows de minimis shortfalls to be treated as paid where they are trued up in the next capital contribution. The administrator applies it; it does not waive anything on its own authority.
3. **True-up.** Every variance within the band is posted to the limited partner's true-up ledger and added to (shortfall) or credited against (overpayment) its next capital call. Overpayments below USD 1,000 are credited, never refunded.
4. **Outside the band.** A variance beyond ±0.25% follows the normal process: the administrator issues the LPA Section 3.4(a) notice and the default clock runs as usual.
5. **No silent suppression.** Automated reminders are suppressed only for contributions marked `WITHIN_TOLERANCE`. Each one appears on the post-call report the General Partner receives.
6. **Final call.** On the final capital call and on any distribution netting, the true-up ledger is settled to zero.

## 4. Reconciliation rule

```text
variance_pct = (received_usd - call_due_usd) / call_due_usd * 100
status = WITHIN_TOLERANCE   if abs(variance_pct) <= 0.25
       = OUTSIDE_TOLERANCE  otherwise
```

- The band is a fund-level parameter (`fx_tolerance_pct = 0.25`). A new fund may change it only with written GP adoption under its own LPA.
- Compare to the called amount, never to the commitment.
- Record the charges code (`OUR`, `SHA`, `BEN`) from MT103 field 71A so fee-driven and FX-driven variances can be told apart.

## 5. Results on Call #1

Re-running Call #1 under the policy (see `carlyle_call1_reconciliation_extract.csv`): 22 of the 23 flagged limited partners became `WITHIN_TOLERANCE` and their reminders were withdrawn with an apology. Mirae Ocean Holdings stayed `OUTSIDE_TOLERANCE` and received its Section 3.4(a) notice on time.

## 6. Reusing this policy

- Check the target fund's LPA for a de minimis or GP-discretion clause equivalent to Section 3.4(e) before adopting it; if there is none, Legal must approve an alternative basis.
- Pair it with the dual-currency notice (`apac_multicurrency_wire_notice_template.pdf`), which prints the band and asks for `OUR` charges.
- Recompute the evidence table in Section 2 if the LP base includes currencies more volatile than JPY or EUR.
