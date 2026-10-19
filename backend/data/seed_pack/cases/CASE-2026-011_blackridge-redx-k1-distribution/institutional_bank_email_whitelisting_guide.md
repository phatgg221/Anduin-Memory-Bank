# Institutional Bank IT Whitelisting Guide (Investor Portal Notifications)

| Field | Value |
|---|---|
| **Case** | CASE-2026-011 |
| **Author** | Marcus Vance (@marcus.vance), Site Reliability Engineer |
| **Version** | 1.0, 20 March 2026 |
| **Audience** | IT and email security teams at banks, private banks and wealth platforms that host LP mailboxes; our Customer Success team, who send this to them |

## 1. Why you are receiving this

Your organisation's mailboxes receive notices from our investor portal on behalf of fund managers: capital calls, distribution notices, quarterly reports and annual tax documents (for example Schedule K-1 packages). These are sent in bursts around reporting deadlines. Without the entries below, a secure email gateway may quarantine them as bulk mail or impersonation, and your users will miss time-sensitive tax and capital notices.

We never attach tax documents to emails. Each notice contains a link to the portal, where the investor signs in with multi-factor authentication.

## 2. What we send from

| Item | Value |
|---|---|
| From address | `notices@notices.[portal domain]` |
| Envelope sender (return-path) | `bounce@mail.notices.[portal domain]` |
| DKIM signing domain (d=) | `notices.[portal domain]` |
| DKIM selectors | `k1`, `n1` |
| SPF | `include:` our email service provider's record, published on `mail.notices.[portal domain]` |
| DMARC | `p=quarantine`, aligned on both SPF and DKIM |
| Sending IP ranges | Provided as a separate, signed list on request (they change with our email provider) |

> Prefer allow-listing on the authenticated domain (DKIM d= and aligned DMARC pass) rather than on IP addresses. Domain-based rules survive provider IP changes; IP-based rules break silently.

## 3. Recommended gateway configuration

1. **Permitted sender / allow-list policy:** allow `notices.[portal domain]` **only when DMARC passes**. Do not allow-list on the From address alone; that would also allow spoofed mail.
2. **Bulk-mail classification:** exempt the authenticated domain from bulk or "graymail" quarantine during the dates we give you (see section 5).
3. **Impersonation protection:** if your gateway flags look-alike sender names (for example the fund manager's name in the display name), add an exception for the authenticated domain.
4. **URL rewriting / link scanning:** keep it on. Our links point to the portal domain and are safe to rewrite; time-of-click scanning may delay the first click by a few seconds.
5. **Attachment rules:** no change needed; we do not attach documents.

## 4. How to verify

1. We send a test notice to two addresses you nominate, from the same identity as production.
2. Confirm it reaches the inbox (not quarantine or junk) and that the headers show `dkim=pass header.d=notices.[portal domain]` and `dmarc=pass`.
3. Reply to Customer Success with the result. We record your organisation as verified for the season.

## 5. Volume and timing

| Event | Typical volume per fund | Our sending rate |
|---|---|---|
| Annual tax documents (K-1) | 1,000 to 5,000 notices | 200 per minute, staggered by recipient domain |
| Capital call | 50 to 500 notices | 200 per minute |
| Quarterly report | 500 to 5,000 notices | 200 per minute |

We email your IT contact 7 days before each tax season publication with the planned date.

## 6. What went wrong in March 2026 (for our own team)

- A new email-provider subaccount used for tax notices signed DKIM with the provider's domain and used the provider's return-path. Our DMARC policy is `p=quarantine`, so 1,310 of 3,200 K-1 notices failed alignment and were quarantined, concentrated at bank-hosted mailboxes.
- All 3,200 went out in about six minutes, which also tripped bulk heuristics.
- Fixes: aligned DKIM (`k1` selector on `notices.[portal domain]`), a custom return-path, throttling to 200 per minute staggered by domain, seed-inbox tests at known bank gateways, and a publish-time check that blocks sending when DKIM is not aligned with the From domain.
