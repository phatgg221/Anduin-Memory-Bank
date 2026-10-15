# Implementation Request — Bain Capital Tech Opportunities Parallel V
*Client intake brief · received 2026-10-13 · routed to Anduin Delivery*

## 1. Fund Overview

Bain Capital Tech Opportunities Fund V, L.P. (the **"Main Fund"**) and Bain Capital Tech Opportunities Parallel Fund V, L.P. (the **"Parallel Fund"**, together the **"Funds"**) are Delaware limited partnerships that will invest side by side, pro rata to commitments, in growth-stage technology companies. Target aggregate commitments are $1.2 billion across both Funds, offered under Regulation D Rule 506(c).

The investor base mixes U.S. public and corporate pension plans, endowments and foundations, U.S. family offices, and high-net-worth individuals. The General Partner asks Anduin to deliver the subscription workflow for both Funds, with investors routed to the Main or Parallel Fund by the GP.

## 2. Requested Scope

### 2.1 ERISA 25% aggregate monitoring across Main and Parallel
The Limited Partnership Agreements require the GP to keep Benefit Plan Investors below 25% of each class of interests, monitored **on an aggregate basis across the Main Fund and the Parallel Fund**. The GP wants a live view of the aggregate percentage, and a hard stop before countersignature if an acceptance would cause the limit to be reached. Several pension investors are expected to subscribe in the last week before the first closing.

### 2.2 Joint signers for family-office investors
Many family-office investors are trusts or LLCs that require two signatories. Both must sign the subscription, but tax certifications (IRS Form W-9 for these U.S. investors, plus the backup-withholding certification) must be completed by one designated signatory only. Both signatories sign the final packet in DocuSign.

### 2.3 DealCloud CRM prefill
The GP's investor-relations team uses **DealCloud** (not Affinity). Investor legal name, entity type, tax classification, contacts, commitment amount, and investor category (including whether the investor is a Benefit Plan Investor) should prefill from DealCloud entries, with the investor confirming every prefilled value.

### 2.4 Accredited-investor verification under Rule 506(c)
Every investor must be verified as accredited. The GP accepts third-party verification letters (broker-dealer, registered investment adviser, attorney, or CPA) uploaded in the workflow, and a minimum-investment-amount approach for natural persons where permitted.

### 2.5 Qualified-purchaser look-through for single-purpose vehicles
The Funds rely on Section 3(c)(7) of the Investment Company Act. Some family offices will invest through vehicles formed specifically for this investment. For those vehicles the workflow must look through to each beneficial owner and collect qualified-purchaser representations from each of them.

## 3. Timeline

| Milestone | Target date |
|---|---|
| Kickoff | 2026-10-26 |
| UAT start | 2026-11-30 |
| UAT sign-off | 2026-12-11 |
| First closing | 2026-12-18 |

## 4. Questions from the General Partner

- How did you handle ERISA aggregation across parallel funds before, and what nearly went wrong?
- Can your existing CRM prefill templates be adapted to DealCloud?
- How do you stop two family-office signatories from conflicting on tax certifications?
