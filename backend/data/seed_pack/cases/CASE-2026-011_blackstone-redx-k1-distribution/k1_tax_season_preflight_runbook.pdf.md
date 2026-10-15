# Tax Season K-1 Bulk Distribution Pre-Flight Runbook
*Customer Success & Escalations · Version 1.0 of 15 April 2026 · Owners: Chloe Nguyen, Marcus Vance · Derived from CASE-2026-011*

This runbook applies whenever a fund publishes annual tax documents (Schedule K-1 packages or equivalent) to more than 500 limited partners at once. It exists because publishing 3,200 K-1 packages in one burst in March 2026 put 1,310 notices into bank email quarantine and locked 412 dormant LPs out of multi-factor authentication within two days.

## Section 1. Timeline

| When | Step | Owner |
|---|---|---|
| T−21 | Confirm publish date and LP count with the GP; pull the dormant-LP list (no sign-in for 12+ months) | Customer Success |
| T−14 | Start the contact and MFA re-verification campaign (Section 2) | Customer Success |
| T−7 | Send the Institutional Bank IT Whitelisting Guide to the IT contacts of bank-hosted LP domains | Customer Success |
| T−3 | Seed-inbox tests from the production sending identity (Section 3) | SRE |
| T−1 | Go/no-go: DKIM alignment check, seed results, campaign completion rate | Customer Success + SRE |
| T−0 | Publish documents; notices throttled to 200 per minute, staggered by recipient domain | SRE |
| T+1 to T+3 | Monitor DMARC reports, open rates by domain, lockouts and support queue | Customer Success + SRE |

## Section 2. Contact and MFA Re-Verification Campaign (T−14)

(a) Email every LP user a "confirm your access before tax season" notice with a link to verify their email address and phone number.
(b) Prompt users still on SMS codes to enrol an authenticator app and to save recovery codes.
(c) Dormant LPs who have not verified by T−5 get a second notice and a call from investor relations.
(d) Report the completion rate to the GP at T−1. Target: at least 85% of dormant LPs verified.

> Note: in March 2026, 412 dormant LPs received SMS codes at outdated numbers, retried five times, were locked out for 30 minutes and retried again. The campaign moves that failure two weeks earlier, when it costs nothing.

## Section 3. Deliverability Pre-Flight (T−3)

- The sending identity must sign DKIM with the portal's own notice domain (`d=notices.[portal domain]`) and use our custom return-path, so DMARC passes on alignment. Publishing is blocked automatically if it doesn't.
- Send seed notices to test inboxes behind the main institutional bank gateways and confirm inbox placement and `dmarc=pass` in the headers.
- Never send all notices at once. Use 200 per minute, staggered by recipient domain.

<!-- pagebreak -->

## Section 4. Lockout Handling (T−0 onward)

| Situation | Action |
|---|---|
| LP locked out after failed MFA codes | Verify identity against the investor-relations contact on file (call-back to the number in the subscription documents), then reset MFA and enrol an authenticator app |
| LP's phone number has changed | Treat as an account change: verify identity first, then update the number; never change it on an inbound request alone |
| Bank-hosted LP did not receive the notice | Check quarantine with the bank's IT contact using the whitelisting guide; resend once released |
| Support queue above 100 open tickets | Activate the tax-season support rota and post status updates to the GP every 4 hours |

## Section 5. Metrics to Report to the GP

| Metric | March 2026 (no pre-flight) | Target |
|---|---|---|
| Notices quarantined | 1,310 of 3,200 (41%) | Below 2% |
| Open rate after 48 hours | 41% before resend; 74% after | Above 75% |
| MFA lockouts in first 72 hours | 412 | Below 40 |
| Peak open support tickets | 240 | Below 60 |

## Section 6. References

- `institutional_bank_email_whitelisting_guide.md`: what bank IT teams should allow-list and how to verify.
- CASE-2026-011 channel (`#case-blackstone-redx-k1`): the March 2026 incident and fixes.
