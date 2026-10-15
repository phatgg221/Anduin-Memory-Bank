# Post-mortem: FX-blind MFN and fee tiers in UAT (Blackstone Real Estate Debt X)

| Field | Value |
|---|---|
| Case | AND-2026-008 |
| Fund | Blackstone Real Estate Debt X (Master), L.P., with Delaware Feeder and Cayman Feeder |
| Author | Minh Nguyen (@minh.nguyen), Senior Implementation Engineer |
| Date | 2026-02-10 |
| Status | Final. Delivered; UAT sign-off +3 days; Initial Closing held on 2026-02-06 |

## Project Context

Blackstone Real Estate Debt X is a Cayman master fund with two feeders. The Delaware Feeder takes US taxable investors and accepts USD only. The Cayman Feeder takes non-US and US tax-exempt investors in USD, EUR, GBP or AUD (Annex C Section 2.2). Our scope covered FundSub subscription packs for both feeders, routing each LP to its fee Class (A-D), and an automated side-letter MFN election workflow for LPs at or above US$25M.

MFN and fee tiers are both set by the LP's Aggregate Commitment: Tier 1 from US$25M, Tier 2 from US$50M, Tier 3 from US$100M (Annex C Sections 1.2 and 3.1). We had shipped this tier engine on several USD-only funds. This was the first fund where it met non-USD commitments.

## Timeline

| Date | Event |
|---|---|
| 2025-11-24 | Kickoff with @pm.alex and @cs.maya. Requirements captured the tier thresholds and the Section 4 election mechanics. |
| 2025-12-15 | Annex C execution version received from fund counsel (Harrow & Linden). Section 2.3 (currency conversion) was never turned into a requirement. |
| 2026-01-12 | UAT starts. |
| 2026-01-20 | @qa.tuan's side-letter regression flags three non-USD test LPs on the wrong tier (`slack_uat_fx_mfn_tiers.txt`). Root cause found within 30 minutes. @cs.maya confirms the pinned rate and fixing date from Annex C Section 2.3. |
| 2026-01-21 | v2 evaluator drafted. 21 FX fixtures added to the suite. |
| 2026-01-22 | Fix shipped: `fx_mfn_tier_rules.json` v2.0.0 and `side_letter_clause_matrix.csv`. |
| 2026-01-23 | Planned UAT sign-off. Full side-letter regression passes. Halyard Point (administrator) ties out every stored rate. Counsel's written confirmation of our Section 2.3 reading arrives after the client's Friday sign-off window. |
| 2026-01-26 | UAT signed off, 3 days late. |
| 2026-02-06 | Initial Closing held on the planned date. |

## What Went Wrong in UAT

The v1 evaluator tested `commitment.amount` against the USD thresholds as if every amount were already in dollars. QA's three Cayman Feeder test LPs, on the 2026-01-19 WM/Refinitiv 4:00 p.m. London fix (EUR/USD 1.1650, GBP/USD 1.3420, AUD/USD 0.6680):

| Test LP | Commitment | v1 result (raw) | USD Equivalent | Correct result |
|---|---|---|---|---|
| Nordhafen Pensionskasse VVaG | EUR 22,000,000 | Standard / Class A, no MFN | US$25,630,000 | Tier 1 / Class B, MFN unlocked |
| Pennant Hill Pension Trustees Limited | GBP 38,000,000 | Tier 1 / Class B | US$50,996,000 | Tier 2 / Class C |
| Wattlebrook Superannuation Trust | AUD 34,000,000 | Tier 1 / Class B, MFN unlocked | US$22,712,000 | Standard / Class A, no MFN |

The error ran in both directions. EUR and GBP are worth more than USD, so those LPs were under-tiered. AUD is worth less, so Wattlebrook was over-tiered and would have received the MFN Compendium. Annex C keeps that compendium for Eligible Investors only.

## Root Cause

- **Code:** the tier rule had no currency dimension. It was written for USD-only funds and copied forward, and nothing in it failed when a second currency showed up.
- **Requirements:** we pulled the tier table out of Annex C but never read Section 2.3, which pins the rate source, the fixing date, the rounding and how amendments are handled. With no requirement, there was no audit field for the rate either.
- **Tests:** the regression suite had no non-USD fixtures.

## How We Fixed It

- **`fx_mfn_tier_rules.json` v2.0.0.** Every commitment is converted with `fx(amount, currency, 'USD', fx_rate_date)` at the pinned WM/Refinitiv fix. The fixing date is the London business day before the Submission Date, taken in Europe/London time. The rounded USD Equivalent is then tested against the thresholds, as Section 2.3(d) requires.
- **Stored audit trail.** Rate, fixing date and source are saved on submission, so Halyard Point can tie out against Section 2.3(g). USD commitments also store rate 1.0000.
- **Affiliated commitments.** Each member's commitment is converted at its own fixing before the group is summed (Section 1.3). Example: USD 20,000,000 (Delaware Feeder) plus EUR 28,000,000 (Cayman Feeder) is US$20,000,000 + US$32,620,000 = US$52,620,000, which is Tier 2 for both members. A raw sum of 48,000,000 would have said Tier 1.
- **Amendments.** An increase converts at its own fixing and is added to the stored USD Equivalent. Example: EUR 5,000,000 at 1.1200 adds US$5,600,000, taking Nordhafen to US$31,230,000 without restating the original tranche (Section 2.3(e)). FX movement alone never lowers a tier (Section 2.3(f)).
- **MFN workflow.** The workflow now both unlocks and locks with the tier. Electable clauses come from `side_letter_clause_matrix.csv`: 20 clauses, each with a minimum tier and, where excluded, the Section 4.3 reason.
- **Fixtures.** 21 new FX fixtures: every permitted non-USD currency one unit either side of each threshold, plus a rounding edge, an affiliated group and an increase after depreciation. Rounding edge: GBP 37,257,824 x 1.3420 = US$49,999,999.808, which rounds to US$50,000,000 and is Tier 2.

## Impact

- **No live impact.** The defect was caught in UAT, and no live LP was mis-tiered.
- **Schedule.** UAT sign-off slipped 3 days (2026-01-23 to 2026-01-26). The Initial Closing held on 2026-02-06.

Management Fees v1 would have charged wrongly, per year at full deployment:

| LP | Class charged | Correct Class | Error per year |
|---|---|---|---|
| Nordhafen | A, 1.25% | B, 1.10% | About US$38,445 overcharged |
| Pennant Hill | B, 1.10% | C, 1.00% | About US$50,996 overcharged |
| Wattlebrook | B, 1.10% | A, 1.25% | About US$34,068 undercharged |

- **Avoided confidentiality breach.** Wattlebrook, which is not an Eligible Investor, would have received the anonymized side-letter compendium.
- **Backtest.** We re-ran v1 against the Initial Closing book. 9 of the Cayman Feeder subscriptions were non-USD (6 EUR, 2 GBP, 1 AUD), and v1 would have mis-tiered 3 of them.

## Reusable Rules for Future Funds

1. **Normalize every currency-denominated threshold to the fund currency at the contractually pinned rate and fixing date, and store the rate used.** Never use a live feed. Save the rate, fixing date and rate source with the subscription.
2. **Turn the side-letter policy's FX clause into requirements at kickoff.** That means the rate source, fixing date, rounding, fallback and amendment handling. If the documents are silent, have counsel specify them before UAT.
3. **Derive fixing dates from the rate source's calendar and timezone,** for example Europe/London for the WM/Refinitiv 4:00 p.m. fix. Do not use the server's or the investor's clock.
4. **Round as the policy says before testing a threshold, and fixture-test every threshold at ±1 unit in every permitted currency.** Include currencies weaker than USD, because over-tiering is as real as under-tiering.
5. **Aggregate affiliated commitments only after converting each one.** Re-tier the whole group whenever any member subscribes or amends. Convert increases at their own fixing, and never downgrade on FX movement alone.
6. **Drive MFN electability from a clause matrix, not code.** Give each clause a minimum tier and an exclusion reason (regulatory/tax status, sovereign status, seed or first-close fees), and lock the election workflow when an LP drops out of eligibility.
