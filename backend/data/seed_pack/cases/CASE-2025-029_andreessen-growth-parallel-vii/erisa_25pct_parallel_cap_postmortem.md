# Post-mortem: ERISA 25% aggregate cap breach across parallel vehicles (dry run)

| Field | Value |
|---|---|
| Case | AND-2025-029 |
| Fund | Andreessen Growth Fund VII, L.P. (Main) + Andreessen Growth Parallel Fund VII, L.P. (Parallel) |
| Author | Sarah Tran (@sarah.tran), Senior Delivery Engineer |
| Date | 2025-08-08 |
| Status | Final. DELIVERED, 0 slip days (UAT sign-off 2025-07-28, initial close 2025-08-04, both on plan) |

## Project Context

Andreessen Growth Fund VII is a Delaware venture/growth program run as two limited partnerships that invest side by side: a Main fund and a Parallel fund, both managed by AGF VII GP, L.L.C. Anduin digitized the subscription booklet for both vehicles in FundSub, including Addendum C (Delaware LP representations, Rule 506(c) accredited-investor verification, ERISA Benefit Plan Investor representations and the Schedule A worksheet), and prefilled LP records from the GP's Affinity CRM pipeline list.

The constraint that matters here is Section 6.4 of Addendum C ("Parallel Fund Aggregation"). The plan-asset rule in 29 C.F.R. §2510.3-101(f) is tested per entity and per class: Benefit Plan Investors (ERISA §3(42)) must hold less than 25% of each Partnership's limited partner Interests, after disregarding non-BPI interests held by the GP, the adviser and their affiliates. On top of that, both LPAs contain a **contractual covenant**: the GP manages the 25% limit on an aggregate basis across Main + Parallel, as if their LP Interests were one class. Fund counsel (Ostrander Vale LLP) confirmed the aggregate test is a GP policy written into the LPAs, not a regulatory requirement. The guard therefore applies both.

Team: Sarah Tran (build), Jordan Ellis (PM, GP relationship), Linh Pham (QA), Maya Okafor (counsel and fund admin liaison).

## Timeline

| Date (ICT) | Event |
|---|---|
| 2025-06-09 | Kickoff. Addendum C (form of June 2025) and the Affinity list "Growth VII – LP Pipeline" in scope. |
| 2025-07-14 | UAT starts. Per-LP ERISA validation passes all scripted cases. |
| 2025-07-21 | Dry-run baseline book loaded from Affinity and marked GP-approved (not countersigned): $357.75M eligible, $62.40M BPI, 17.44%. |
| 2025-07-22 21:41–21:47 | Four US pension subscriptions submitted via Affinity prefill within 6 minutes. All pass validation; every review packet shows a green "Fund BPI %" between 19.69% and 21.24%. |
| 2025-07-22 21:58 | Linh sums the book by hand: 28.40% aggregate. Thread in #deal-a16z-growth-vii (`slack_dryrun_erisa_cap.txt`). |
| 2025-07-22 22:15 | Counsel, via Maya, confirms per-entity regulatory test plus the Section 6.4 aggregate covenant. |
| 2025-07-25 | Fix shipped: `erisa_aggregate_cap_guard.ts` and `affinity_prefill_mapping.json` v1.1. |
| 2025-07-26 | Linh replays the four submissions 50 times with random 0–500 ms jitter: every run ends with four HOLDs at 28.40%, no ALLOW. Duplicate webhook deliveries return the stored decision. |
| 2025-07-28 | UAT sign-off (planned = actual). |
| 2025-07-30 | GP allocation decision under Section 6.4(d). Guard re-evaluates at 23.83%: WARN, acknowledged by the GP's CCO. |
| 2025-08-04 | Initial close (planned = actual). Countersigned book at 23.83% aggregate, both vehicles below 25%. |

## What Went Wrong in UAT

During the 2025-07-22 dry run, the GP's IR team pushed four soft-circled pension commitments from Affinity into FundSub within six minutes:

| Time | LP (fictional) | Plan type | Vehicle | Commitment | Packet "Fund BPI %" |
|---|---|---|---|---|---|
| 21:41 | Cedar Valley Building Trades Pension Fund | Multiemployer (Taft-Hartley) | Main | $15.00M | 20.76% |
| 21:43 | Halvorsen Manufacturing Retirement Plan Master Trust | Single-employer DB | Parallel | $12.50M | 20.23% |
| 21:45 | Ironwood Ridge Operating Engineers Pension Trust | Multiemployer (Taft-Hartley) | Main | $17.25M | 21.24% |
| 21:47 | Northgate Paper Co. Employees' Retirement Plan | Single-employer DB | Parallel | $10.00M | 19.69% |
| | **Total** | | | **$54.75M** | |

Each packet was green. Together they took the aggregate from 17.44% to **28.40%** ($117.15M BPI of $412.50M eligible). Per vehicle it was no better: Main 28.46%, Parallel 28.26%. Had the GP countersigned, both Partnerships would have breached the regulatory test and the Section 6.4 covenant at initial close, and their assets would have been at risk of being treated as plan assets. Nothing had been countersigned; the GP's acceptance step was still open.

Two side findings: all four arrived with every `erisa.*` field blank, because the Affinity "Investor Type" was a bare "Pension" and prefill v1.0 mapped nothing to BPI; and one Affinity note held a full EIN pasted in by the GP's IR team.

## Root Cause

1. **Per-LP rule for a fund-level constraint.** The form schema asked only "is this LP a Benefit Plan Investor?" and required the plan-asset reps if so. Nothing ever evaluated the cross-subscription aggregate. A form rule runs in one LP's session against that LP's answers; it cannot see the fund.
2. **Read-before-commit race.** The packet's "Fund BPI %" was computed as *GP-approved book + this subscription*. Pending subscriptions were excluded and evaluation was not serialized, so each of the four read the 17.44% baseline before the other three were counted.
3. **No ERISA data at prefill.** With BPI flags blank until each signatory ticked Schedule A, Line A1, no projection was possible at the moment the pipeline was loaded.

## How We Fixed It

### 1. `erisa_aggregate_cap_guard.ts`: the cross-fund calculation

A FundSub webhook on `subscription.prefilled`, `subscription.submitted` and `subscription.pre_countersign`. Only `pre_countersign` blocks; the other two show a banner in the GP review queue.

**Formula** (Section 6.4(b) of the addendum, same formula per vehicle for the regulatory test):

```text
eligible(s)  = s.status in {SUBMITTED, IN_REVIEW, GP_APPROVED, COUNTERSIGNED} or s is the incoming subscription
               and not (s.gp_affiliate and s.bpi_weight = 0)                     # Section 6.3, §2510.3-101(f)(1)
weight(s)    = 1.00  Schedule A Line A1 (ERISA Title I plan) or A2 (Code §4975 plan)
             = p     Line A3 plan-asset entity, p = its BPI-held equity %        # ERISA §3(42)
             = 0     Lines A4–A7 (governmental, church, non-US, none)
             = 1.00  unknown / UNCLASSIFIED (fail closed)
D (denominator) = Σ commitment_usd(s)              over eligible s, Main + Parallel
N (numerator)   = Σ commitment_usd(s) × weight(s)  over eligible s, Main + Parallel
BPI %           = N / D
headroom        = (0.25 × D − N) / 0.75            # BPI dollars that still fit below 25%
decision        = HOLD if any scope >= 25.00%, else WARN if any scope >= 22.50%, else ALLOW
                  scopes = aggregate, Main, Parallel
```

- **Value** is measured by Capital Commitments, as Section 6.4(b) specifies, in integer USD cents; the threshold compare is exact integer arithmetic, never the rounded 2 dp figure.
- **Exclusions:** the $9.30M of GP and affiliate commitments (Main $6.80M, Parallel $2.50M) are not BPIs and are disregarded from both N and D. Leaving them in D would have shown 27.77% and understated the breach. Governmental, non-electing church and non-US plans stay in D but contribute 0 to N.
- **When it runs:** at prefill and submit (banner), and immediately before GP acceptance of any subscription, increase or transfer (blocking), per Section 6.4(c). Every amount edit is a new webhook delivery and re-counts the book.
- **Concurrency:** one `pg_advisory_xact_lock` per fund family (Main + Parallel share a family id), taken before any read, at READ COMMITTED. We deliberately avoided REPEATABLE READ/SERIALIZABLE: Postgres takes that snapshot at the first statement, which is the lock call itself, so a waiter would wake up and count a stale book. Decisions are stored per webhook delivery id, so retries are idempotent while a fresh GP attempt after a scale-back re-counts.

**Worked numbers ($M):**

| Book | Main BPI / eligible | Parallel BPI / eligible | Aggregate BPI / eligible | Decision | Aggregate headroom |
|---|---|---|---|---|---|
| Before the four | 50.00 / 256.75 = 19.47% | 12.40 / 101.00 = 12.28% | 62.40 / 357.75 = **17.44%** | ALLOW | +$36.05M |
| After the four | 82.25 / 289.00 = 28.46% | 34.90 / 123.50 = 28.26% | 117.15 / 412.50 = **28.40%** | HOLD | −$18.70M |
| Initial close | 65.00 / 271.75 = 23.92% | 27.40 / 116.00 = 23.62% | 92.40 / 387.75 = **23.83%** | WARN | +$6.05M |

The −$18.70M means the GP had to cut more than $18.70M of the $54.75M: a cut of exactly $18.70M gives (117.15 − 18.70) / (412.50 − 18.70) = 98.45 / 393.80 = 25.00%, which still HOLDs.

### 2. The GP's decision (Section 6.4(d))

After calls with the four plans, the GP chose LP preference over order of receipt:

| LP | Vehicle | Requested | Accepted at initial close | Treatment |
|---|---|---|---|---|
| Cedar Valley Building Trades Pension Fund | Main | $15.00M | $15.00M | Accepted in full |
| Halvorsen Manufacturing Retirement Plan Master Trust | Parallel | $12.50M | $5.00M | Scaled back; remaining $7.50M offered at the second closing, subject to the guard |
| Ironwood Ridge Operating Engineers Pension Trust | Main | $17.25M | $0.00M | Deferred to the second closing (its board approved the full amount only) |
| Northgate Paper Co. Employees' Retirement Plan | Parallel | $10.00M | $10.00M | Accepted in full |
| **Total** | | **$54.75M** | **$30.00M** | $24.75M cut, above the $18.70M breach point |

Result: N = 62.40 + 15.00 + 5.00 + 10.00 = 92.40; D = 357.75 + 30.00 = 387.75; **92.40 / 387.75 = 23.83%** aggregate (Main 65.00 / 271.75 = 23.92%, Parallel 27.40 / 116.00 = 23.62%). That is under 25% in every scope but above the 22.50% soft threshold, so the guard returned WARN, which the GP's CCO acknowledged. The binding headroom after close is Parallel at $2.13M (aggregate $6.05M), which is why the Halvorsen remainder and Ironwood Ridge wait for second-closing non-BPI commitments to grow the denominator.

### 3. `affinity_prefill_mapping.json` v1.1

Maps Affinity "Investor Type" to `erisa.bpi_class` (corporate and multiemployer pensions and 401(k)s → Title I plan; IRA/Keogh → Code §4975 plan; fund-of-funds and insurers → plan-asset entity with BPI %; public pensions → governmental plan, **not** a BPI under §3(42); church and non-US plans → not BPI). A bare "Pension" stays UNCLASSIFIED and is counted as a full BPI until Schedule A confirms. Schedule A always wins over CRM data. Tax IDs come across masked (last 4 only), and any CRM note matching an SSN/EIN pattern is dropped and alerted. Accredited and QP flags are hints only; Rule 506(c) verification still runs in FundSub (Addendum Section 3.2).

## Impact

- **Caught before countersignature.** No Partnership ever held 25% or more BPI capital, and there was no plan-asset exposure. Zero slip: UAT sign-off 2025-07-28 and initial close 2025-08-04 landed as planned.
- **LP impact:** $24.75M of pension demand moved out of the initial close ($7.50M Halvorsen scale-back, $17.25M Ironwood Ridge deferral). The GP handled both conversations with the 2025-07-30 numbers in hand.
- **Effort:** about 3 engineering days (guard, mapping, tests) and 2 QA days (concurrency replay, boundary cases at 22.50% and 25.00%, idempotency).
- **Data hygiene:** one full EIN removed from Affinity; the prefill now refuses to carry one.
- **Reuse:** the guard and mapping are marked reusable for any Delaware main/parallel launch with an aggregate ERISA covenant.

## Reusable Rules for Future Funds

1. Implement any fund-level cap (ERISA 25%, concentration limits) as a server-side check at GP acceptance across every vehicle the LPA aggregates. Never implement it as a per-LP form validation.
2. Count pending subscriptions in the projection, and serialize evaluation with one lock per fund family taken before any read. In Postgres, read at READ COMMITTED after the lock, because a REPEATABLE READ/SERIALIZABLE snapshot is taken at the lock statement.
3. Compute the regulatory per-entity test (29 C.F.R. §2510.3-101(f)) and any contractual aggregate together. Disregard non-BPI GP, adviser and affiliate interests from numerator and denominator, and decide on the worst scope using exact integer arithmetic.
4. Classify BPIs at prefill from CRM investor types. Keep governmental, non-electing church and non-US plans out of the numerator, fail closed on unknowns, and let the LP's Schedule A override the CRM.
5. Never prefill a full SSN or EIN from a CRM. Bring only the masked last 4 and scrub CRM notes for TIN patterns.
6. Give the GP a soft threshold (22.50%) and the dollar headroom early, so reject/scale-back/defer decisions under Section 6.4(d) are made before closing week.
