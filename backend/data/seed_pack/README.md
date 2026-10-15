# Dejavu seed pack

Fictional, realistic institutional memory for Dejavu's company-wide Memory Vault:
- 5 departments;
- 8 users (active staff and departed alumni);
- 8 resolved cases with their team-channel discussions and reusable artifacts;
- 3 open case channels for the live demo.

`bun run seed` loads it into Postgres (via the ORM) and MinIO.

> All funds, sponsors, investors, people, incidents, and documents here are fictional demo material. Real firm names appear only as demo labels. Every rendered PDF carries a "fictional demo material" footer.

## Layout

```text
seed_pack/
├── README.md               this file — also the authoring spec
├── departments.json        → departments
├── users.json              → users (staff + alumni; your own account is matched via SEED_OPERATOR_EMAIL)
├── cases/                  resolved cases (status RESOLVED) → Memory Vault
│   └── <CASE-CODE>_<slug>/
│       ├── case.json       → case_records row + artifact list
│       ├── channel.txt     → channel_messages (the team discussion that solved it)
│       ├── *.pdf.md        PDF sources → rendered *.pdf (both committed)
│       └── *.csv / *.md / *.json / *.ts   artifacts → case_artifacts + MinIO
└── channels/               open case channels (status OPEN) for the demo
    └── <channel-slug>/
        ├── case.json       → case_records row incl. comparisonResults (top-3 precedents + delta)
        ├── channel.txt     → the first messages in the channel
        └── client brief files (artifacts)
```

Commands:

```bash
bun run seed:pdfs                    # re-render PDFs after editing any *.pdf.md
bun run test tests/test_seed_pack.py # validate the pack (also part of bun run test)
bun run seed                         # load into Postgres + MinIO (idempotent)
```

## Departments and people

- `departments.json` ids: `CLIENT_OPERATIONS`, `LEGAL_COMPLIANCE`, `SALES_SOLUTIONS`, `CUSTOMER_SUCCESS`, `ENGINEERING_DATA`.
- `users.json` handles (use these, and only these, in `case.json` and `channel.txt`):

| Handle | Person | Department | Status |
|---|---|---|---|
| `chloe.nguyen` | Chloe Nguyen | Customer Success | ACTIVE |
| `elena.rostova` | Elena Rostova | Legal & Compliance | ACTIVE |
| `ryan.miller` | Ryan Miller | Sales & Solutions | ACTIVE |
| `sarah.tran` | Sarah Tran | Engineering & Data | ACTIVE |
| `marcus.vance` | Marcus Vance | Engineering & Data | ACTIVE |
| `minh.nguyen` | Minh Nguyen | Client Operations | ALUMNI — left 2026-02-13 |
| `david.le` | David Le | Legal & Compliance | ALUMNI — left 2025-11-07 |

- No content may be attributed to `operator` (the real user's account).
- Alumni can only appear in activity dated on or before their departure.
- Investor, counsel, administrator, and bank-side contact names are invented. They are never real people or institutions, apart from the firm names that label a case.

## Resolved case — `cases/<CASE-CODE>_<slug>/case.json`

```json
{
  "caseCode": "CASE-2025-014",
  "channelSlug": "case-sequoia-cayman-iv",
  "title": "Sequoia Cayman Feeder IV — Joint Non-US Signer W-8BEN-E Deadlock",
  "client": "Sequoia Heritage",
  "fund": "Sequoia Heritage Cayman Feeder IV, L.P. (Cayman master-feeder)",
  "sourceType": "CLIENT_EMAIL",
  "severity": "HIGH",
  "dueDate": "2025-04-23",
  "departmentId": "CLIENT_OPERATIONS",
  "secondaryDepartmentIds": [],
  "status": "RESOLVED",
  "createdBy": "chloe.nguyen",
  "leadResolver": "minh.nguyen",
  "initialRequestBrief": "What arrived, written as the original request/escalation (3–6 sentences).",
  "contextTags": { "Jurisdiction": "Cayman Islands", "Workflow": "LP Onboarding" },
  "summary": "2–3 sentence memory summary.",
  "howItWent": "Narrative: what happened, impact, blockers (4–8 sentences).",
  "resolutionSteps": ["Imperative step 1", "Imperative step 2"],
  "pitfalls": [
    { "warning": "Concrete warning for the next team", "author": "minh.nguyen", "severity": "HIGH", "reference": "Chat #L42" }
  ],
  "durationDays": 60,
  "createdAt": "2025-03-03T09:00:00+07:00",
  "resolvedAt": "2025-05-02T18:00:00+07:00",
  "artifacts": [
    { "file": "x.pdf", "source": "x.pdf.md", "fileType": "SOP_PDF", "isReusable": true, "description": "…", "uploadedBy": "minh.nguyen" }
  ]
}
```

- **Keys match the DB columns** (camelCase here → snake_case columns; `client` → `client_name`). `severity`: `CRITICAL | HIGH | MEDIUM | LOW`; `fund` is the parent project; `sourceType`: `CLIENT_EMAIL | CS_ESCALATION | LEGAL_REDLINE | SECURITY_RFP`; `dueDate` is the client deadline the team worked against. `contextTags` keys are Title Case labels, as in the blueprint.
- **`pitfalls[].severity`:** `HIGH | MEDIUM | LOW`. `reference` is optional and points at a chat line (`Chat #L<n>`, the line number in `channel.txt`) or an artifact section (`<file> §<section>`).
- **`durationDays`** = whole days from `createdAt` to `resolvedAt`.
- **`fileType` vocabulary:**
  - intake: `CLIENT_BRIEF` (the client's request as received, open channels only);
  - documents: `LEGAL_DOC`, `LEGAL_REDLINE`, `SOP_PDF`, `GUIDE_PDF`, `TEMPLATE_PDF`, `ARCHITECTURE_PDF`;
  - markdown: `RUNBOOK_MD`, `POLICY_MD`, `POSTMORTEM_MD`;
  - tables: `MATRIX_CSV`, `RFP_MATRIX_CSV`, `TEMPLATE_CSV`;
  - configuration and code: `JSON_SCHEMA`, `MAPPING_JSON`, `CODE`.
- **Artifacts:** at least one artifact must be `isReusable: true`. Every PDF has a `source` (`*.pdf.md`).

## Team channel — `channel.txt`

```text
# Channel export · #case-sequoia-cayman-iv
# Case CASE-2025-014 · Sequoia Cayman Feeder IV — Joint Non-US Signer W-8BEN-E Deadlock
# Times in ICT (UTC+7)

[2025-04-14 23:02] @chloe.nguyen
First body line. Continuation lines have no indentation.

[2025-04-14 23:48] @minh.nguyen ★
A ★ after the handle marks a resolution milestone (is_resolution_milestone = true).
[attached] cayman_fatca_v2.json
```

- **Size:** 10–15 messages for a resolved case, 3–6 for an open channel. Messages are chronological, between `createdAt` and `resolvedAt`, with one blank line between them.
- **Milestones:** each resolved case marks 1–3 messages with ★.
- **Attachments:** a final body line `[attached] <file>` links that message to an artifact, which must be listed in `case.json`. Attach every reusable artifact at least once.
- **Cross-references must be real:** cite lines (`cayman_fatca_v2.json L31`), sections (`Section 4.3(b)`) and annexes that exist in the case's own files. Check with `grep -n`.

## Open channel — `channels/<slug>/case.json`

Same keys as a resolved case, except:
- `status: "OPEN"`, with no `summary`, `howItWent`, `resolutionSteps`, `pitfalls`, `durationDays`, or `resolvedAt`;
- `leadResolver` is the case's current **owner** (shown in Case details);
- it adds `comparisonResults`: the Workbench's precedent banner, pre-computed so the UI works before the live pipeline exists. It also serves as the regression fixture for that pipeline.

```json
"comparisonResults": [
  {
    "caseCode": "CASE-2025-014",
    "similarityScore": 94,
    "howPastCaseWent": "One or two sentences.",
    "pitfallWarnings": ["…"],
    "deltaItems": [
      { "category": "W-8BEN-E joint-signer routing", "pastApproach": "…", "currentRequirement": "…", "status": "REUSABLE", "actionRecommendation": "…", "sourceArtifact": "cayman_fatca_v2.json" }
    ]
  }
]
```

`status` is one of `REUSABLE | MODIFIED | NET_NEW`. A `sourceArtifact` must exist in that case's `artifacts`, and is `null` for `NET_NEW`.

## Documents

### PDF sources (`*.pdf.md`, 1–4 pages)

The renderer supports this Markdown subset only:

| Syntax | Renders as |
|---|---|
| `# Title` (first line) | Centered document title |
| `*Italic line*` right after the title | Centered subtitle |
| `## Section 3. Heading` / `### 3.2 Heading` | Section / subsection headings |
| Paragraph text (consecutive lines join) | Justified body text |
| `(a) …`, `(ii) …` at line start | Indented sub-clause (one per line) |
| `- item` | Bullet list |
| `> Note: …` | Indented italic note |
| Pipe tables with a `|---|` rule | Table with a header row |
| `**bold**`, `*italic*`, `` `code` `` | Inline styles |
| `<!-- pagebreak -->` | Page break |

- **Regulation:** cite real regimes accurately (W-8BEN-E parts, FATCA/CRS, ERISA §3(42), 29 C.F.R. §2510.3-101(f), Rule 506(c), the Luxembourg AML Law of 12 November 2004, the RAIF Law of 23 July 2016, EU DORA Regulation (EU) 2022/2554, GDPR). Fictional rules are framed as client, counsel, or company policy, never as law.

### Other artifacts

- **CSV:** a header row, with the same column count on every row.
- **Markdown:** runbooks, policies, and post-mortems with real headings.
- **JSON schemas and mappings:** follow the FundSub style — `$schema`, `schemaId`, `version`, `caseCode`, `author`, `updated`, `_comment`, `parameters`, `fields[]`, `rules[]`. Expressions use dotted paths; author notes go in `_comment` keys.
