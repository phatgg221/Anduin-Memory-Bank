# Sample cases

Ready-to-paste requests for trying Dejavu or demoing it. Each one is written in plain words, maps onto one past case
in the seeded memory, and has one clearly new requirement so the delta matrix shows something NET_NEW.

**How to use one:** on the Workbench, fill the intake form with the values below (use **+ New case**, not Load demo,
so no hidden preset tags leak in), then click **Run Dejavu analysis & open room**. The analysis takes about 30 s.

Scores were measured on the production memory on 19 Oct 2026. Similarity is a ranking, not a confidence: related
cases sit around 55–75%, so the gap to #2 matters more than the number.

| Department | Customer | Expected #1 precedent | Score | Gap to #2 | What's new this time |
|---|---|---|---|---|---|
| Engineering & Data | Greyfield Capital | CASE-2025-029 Ardent (Sarah Tran) | 76% with the CSV attached | 12 pts | Weekly CSV report for the fund administrator |
| Legal & Compliance | Pacific Crown Investment Authority | CASE-2025-052 Orchid & Straitview (David Le, ALUMNI) | 83% | 21 pts | Carve-out to share documents with a government auditor |
| Sales & Solutions | Northgate Wealth Partners | CASE-2026-003 Brookhaven (Ryan Miller) | 67% | 13 pts | Advisor dashboard of every client's status |
| Client Operations | Nordvik Partners | CASE-2025-038 Carrow (Minh Nguyen, ALUMNI) | 65% | 10 pts | Investors paying in CHF |
| Customer Success | Harbor Crest Capital | CASE-2026-011 Blackridge (Chloe Nguyen) | 59% | 6 pts | Notification email in German |

## Engineering & Data: the investor-list import (recommended)

**The story:** a client is moving its investor list from Excel into Corvane. The import chokes on family trusts that
appear once per trustee, and a 25% limit on pension investors could be broken by several pensions signing at once.
Engineering solved exactly this last year.

| Field | Value |
|---|---|
| Customer | Greyfield Capital |
| Project / Fund | Greyfield Growth Fund III |
| Incoming source | Client email |
| Severity | High |
| People to resolve it | Sarah Tran (Engineering) |
| File to attach | [`backend/data/demo/greyfield_lp_import_errors.csv`](../backend/data/demo/greyfield_lp_import_errors.csv) |

```text
We're moving our investor list from an old Excel file into Corvane before our first close on 30 Nov. About 20 of 250 rows fail to import: family trusts with two or three trustees appear once per trustee, each with the full commitment, so they look like duplicates. We also have to stay under the 25% limit for pension investors, and we're worried that several pension plans signing on the same day could push us over without anyone noticing. New this time: our fund administrator wants a weekly CSV report of the import status.
```

The attached CSV holds 9 failed rows: two trusts split one row per trustee, one trust with both trustees in one cell,
and three pensions whose cap check never ran.

**What you should see**

- **#1 precedent: CASE-2025-029**, Ardent Growth Parallel VII. Last time 37 of 400 rows failed on multi-trustee
  trusts, and four pension plans submitted within six minutes pushed the fund to 28.40% before QA caught it by hand.
- **Delta matrix:** trust clean-up and the 25% cap check are REUSABLE; the weekly CSV report is NET_NEW.
- **Reusable kit:** `legacy_lp_trust_migration_template.csv` (the trust clean-up template) and
  `erisa_aggregate_cap_guard.ts` (the server-side cap check), plus the case's post-mortem and CRM mapping.
- **A pitfall from Minh Nguyen (ALUMNI):** legacy registers repeat a trust once per trustee with the full commitment;
  without a dedupe key it is double- or triple-counted.

**Try next, in the case channel**

- `@Dejavu how did we stop the 25% limit being broken last time?` It should explain the server-side check that counts
  pending subscriptions across funds.
- Post *"Let's just validate the 25% limit on each investor's form"*, select it, then **Review with Dejavu**. It should
  flag this as the mistake from last time: a per-form check shows every concurrent investor a green number.
- **Use in case** on `legacy_lp_trust_migration_template.csv`: the reuse brief explains what to change for 250 rows.

**Close the loop (Act 3 and Act 4 of the demo)**

1. **Complete & save to memory**, outcome RESOLVED, and drop
   [`backend/data/demo/weekly_import_status_report_spec.md`](../backend/data/demo/weekly_import_status_report_spec.md)
   as the final output: the spec for the new weekly report. Draft, review, Commit.
2. **+ New case** for the next client: Customer `Ridgeway Partners`, Project / Fund `Ridgeway Income Fund I`,
   Client email, Medium.

```text
We're importing 180 investors from a spreadsheet into Corvane. A few family trusts are listed once per trustee and fail the import. Our fund administrator also needs a weekly CSV report of the import status every Monday, like other funds get. New this time: they want the report sent to two administrator inboxes.
```

Expect the Greyfield case you just committed as #1, with `weekly_import_status_report_spec.md` REUSABLE in the kit.
This depends on the commit, so rehearse it once; each rehearsal adds a case, so remove rehearsal cases before the
real demo.

## Legal & Compliance: a sovereign investor rejects the indemnity

| Field | Value |
|---|---|
| Customer | Pacific Crown Investment Authority |
| Project / Fund | Harrow Infrastructure Fund II |
| Incoming source | Legal redline |
| Severity | High |

```text
A sovereign wealth fund investor refuses to sign the standard indemnity in its side letter because, as a state entity, it says it has immunity. It also wants to see the fee terms other large investors received (MFN). Counsel needs approved wording within two weeks. New this time: they want a carve-out to share documents with their government auditor.
```

Expect CASE-2025-052 first, led by David Le, who has left (ALUMNI): the pre-approved Sovereign Immunity Reservation
Clause and the MFN tier matrix in the kit.

## Sales & Solutions: scoping a wealth-advisor deal

| Field | Value |
|---|---|
| Customer | Northgate Wealth Partners |
| Project / Fund | Northgate Private Markets Access |
| Incoming source | Client email |
| Severity | Medium |

```text
A wealth management firm wants a quote to put 2,000 high-net-worth clients into our private funds. About 40 advisors would each prepare subscriptions for many clients, including IRAs and trusts. Our usual institutional template estimates 6 weeks. Is that realistic? New this time: they want advisors to see a dashboard of every client's status.
```

Expect CASE-2026-003 first: last time the institutional template underestimated delivery by four weeks. The kit offers
the private wealth scoping rubric and the delegated advisor access matrix.

## Client Operations: wires arrive slightly short

| Field | Value |
|---|---|
| Customer | Nordvik Partners |
| Project / Fund | Nordvik Nordic Buyout IV |
| Incoming source | Client email |
| Severity | Medium |

```text
Our first capital call went out last week. Investors paying in EUR and JPY show as underfunded by small amounts, $150 to $2,000, even though they sent the full amount. We think the exchange rate moved and banks took fees along the way. We need a rule for small shortfalls and a clearer wire notice. New this time: some investors want to pay in CHF.
```

Expect CASE-2025-038 first, by Minh Nguyen (ALUMNI): the ±0.25% FX settlement tolerance policy and the dual-currency
wire notice template.

## Customer Success: notification emails quarantined

| Field | Value |
|---|---|
| Customer | Harbor Crest Capital |
| Project / Fund | Harbor Crest Credit Fund II |
| Incoming source | CS escalation |
| Severity | High |

```text
We published year-end tax documents to 1,500 investors yesterday. Investors whose email is hosted by their bank never got the notification, and IT at two banks says our emails were quarantined by their email gateway. About 150 investors who haven't logged in for a year are locked out by MFA because their phone numbers are out of date, and they're calling support. New this time: 300 German investors want the email in German.
```

Expect CASE-2026-011 first: the bank IT whitelisting guide and the pre-flight runbook. This one has the smallest lead
(6 points), so keep the wording close to the text above.
