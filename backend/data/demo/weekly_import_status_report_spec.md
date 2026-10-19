# Weekly investor-import status report: spec

Prepared for Greyfield Capital's fund administrator, Greyfield Growth Fund III.
Owner: Engineering & Data Integrations. Version 1.0.

## Purpose

Every Monday at 07:00 UTC the administrator receives one CSV that shows where each investor stands in the import
from the legacy Excel register, so open issues are chased before the first close on 30 Nov.

## Delivery

- File name: `greyfield_import_status_YYYY-MM-DD.csv`, UTF-8, comma-separated, one header row.
- Sent through the administrator's SFTP drop; a copy is attached to the case channel.
- Generated from the import job tables after the nightly normalisation run; never edited by hand.

## Columns

| Column | Type | Meaning |
|---|---|---|
| `investor_key` | text | Dedupe key: normalised trust or entity name + instrument date + TIN last 4 |
| `investor_name` | text | Legal name as it will appear on the subscription |
| `investor_type` | enum | `INDIVIDUAL`, `TRUST`, `ENTITY`, `PENSION` |
| `signatories` | integer | Trustees or authorised signers attached to the investor |
| `commitment_usd` | number | Commitment counted once per investor, never per trustee |
| `status` | enum | `IMPORTED`, `NEEDS_IR_REVIEW`, `BLOCKED` |
| `blocking_reason` | text | Empty unless `status` is `BLOCKED` |
| `pension_cap_checked` | boolean | `true` once the server-side 25% aggregate check has run for this subscription |
| `last_updated_utc` | timestamp | When the row last changed |

## Rules

1. One row per investor, never per trustee: rows that share an `investor_key` are merged before the report runs.
2. Pension investors show `pension_cap_checked = false` until the aggregate check at GP acceptance passes; the
   administrator escalates any `false` older than 48 hours.
3. Totals row at the end: investors by status and the aggregate pension share of commitments, to two decimals.
4. A run that fails sends an empty file with a single `ERROR` row instead of skipping the week.

## Reuse

The columns and rules are fund-agnostic. For another fund, change only the file prefix, the SFTP target and the
close date in the purpose line.
