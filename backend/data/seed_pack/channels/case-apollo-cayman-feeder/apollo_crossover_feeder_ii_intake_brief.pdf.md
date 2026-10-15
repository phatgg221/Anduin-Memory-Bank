# Implementation Request — Apollo Global Cayman Crossover Feeder II, L.P.
*Client intake brief · received 2026-10-12 · routed to Anduin Delivery*

## 1. Fund Overview

Apollo Global Cayman Crossover Feeder II, L.P. (the **"Feeder"**) is a Cayman Islands exempted limited partnership that will invest substantially all of its assets in Apollo Global Crossover Master Fund II, L.P. (the **"Master Fund"**). The strategy is late-stage private and crossover growth equity. A Delaware feeder for U.S. taxable investors is out of scope for this request and will be onboarded separately.

The Feeder expects approximately 60–80 investors at the first closing: non-U.S. institutional investors (pension schemes, insurers, sovereign-related entities, fund-of-funds), U.S. tax-exempt investors, and a small number of family offices that hold digital assets. Target first-close commitments are $750 million.

The General Partner asks Anduin to deliver the full digital subscription workflow (investor questionnaire, tax forms, AML/KYC, signature packets) on the Anduin platform, with Anduin's standard UAT cycle.

## 2. Requested Scope

### 2.1 Cayman master-feeder subscription workflow
A standard Cayman feeder subscription booklet: subscriber information, accredited investor and qualified purchaser representations where relevant, Cayman AML/KYC, FATCA/CRS self-certification, and signature pages. Capital-call and distribution banking details are captured in the same flow.

### 2.2 Joint non-U.S. institutional signers (W-8BEN-E)
Many non-U.S. institutional investors require two authorized signatories. Both signatories must be able to work in the same subscription, but only one of them may make the Chapter 4 FATCA and CRS elections on IRS Form W-8BEN-E (Part I, line 5), including the Part XXIX disclosure of substantial U.S. owners for Passive NFFEs. Both signatories must sign the final packet in DocuSign. The GP flagged that a previous administrator's portal "froze" when two signers edited tax sections at the same time; this must not happen.

### 2.3 Sovereign wealth side letters and MFN (US$15M bracket)
Two sovereign wealth investors are expected at the first closing. Their counsel has already indicated that neither can give the standard investor indemnity or submit to jurisdiction. The GP wants pre-agreed sovereign immunity language and an MFN in which fee terms are disclosed by commitment bracket. Unlike the GP's prior funds, the first bracket starts at **US$15 million** of aggregate commitment (previously US$25 million), with commitments of investors under common control aggregated. The GP needs the MFN compendium generated per bracket after the final closing.

### 2.4 Beneficial ownership look-through at 10% (client requirement)
The GP's Cayman counsel has instructed that, following 2026 CIMA guidance as interpreted in counsel's memo of 30 September 2026, the Feeder must identify and verify every natural person holding, directly or indirectly, **10% or more** of an investing entity (instead of the 25% threshold used in the GP's prior funds). Ownership must be traced through intermediate entities until natural persons are reached, up to four tiers. Investors that have already started a subscription when the threshold changes must not lose their progress.

### 2.5 Digital Asset Custody — Hardware Wallet Attestation Annex (new)
Some family-office investors will fund capital contributions from digital-asset holdings. For these investors the GP requires a new Annex D in which the investor:

(a) attests that the relevant digital assets are held in self-custodied hardware wallets (cold storage) under the investor's exclusive control;
(b) proves control of each funding wallet address by signing a challenge message, verified on submission, with address format validated per blockchain;
(c) identifies every key holder of a multi-signature arrangement (for example 2-of-3) and links each to a verified KYC record;
(d) uploads a blockchain-analytics screening report showing no direct or indirect exposure to sanctioned addresses; and
(e) undertakes to provide Travel Rule originator information for each transfer to the Feeder's account.

The GP is not aware of any existing template for this annex.

## 3. Timeline

| Milestone | Target date |
|---|---|
| Kickoff | 2026-10-19 |
| Draft workflow ready for GP review | 2026-11-09 |
| UAT start | 2026-11-16 |
| UAT sign-off | 2026-12-04 |
| First closing | 2026-12-15 |

## 4. Questions from the General Partner

- Have you built joint-signatory tax certification on a Cayman feeder before, and what went wrong?
- Can the beneficial-ownership threshold be changed after launch without restarting investors' subscriptions?
- Do you have pre-approved sovereign immunity language, and what changes when the MFN bracket starts at US$15M?
- What is your estimate for the digital-asset custody annex, given it has not been done before?
