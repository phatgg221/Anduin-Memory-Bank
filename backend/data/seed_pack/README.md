# Dejavu seed pack

Realistic, **fictional** institutional memory for the Knowledge Vault: past fund-onboarding cases with their legal excerpts, Slack incident threads, post-mortems, and reusable schemas, plus incoming requests to test the Workbench.

> All funds, sponsors, investors, people, incidents, and documents here are fictional demo material. Real firm names appear only as demo labels. Every rendered PDF carries a "fictional demo material" footer.

## Layout

```text
seed_pack/
├── README.md                 this file (also the authoring spec)
├── people.json               everyone who appears in the pack — ACTIVE or ALUMNI (drives the alumni badge)
├── cases/
│   └── <caseId>_<slug>/
│       ├── case.json         manifest: metadata, timeline, incident, resolution, artifact list
│       ├── *.pdf.md          legal excerpt source → rendered to *.pdf (both committed)
│       ├── slack_*.txt       incident thread export
│       ├── postmortem_*.md   engineering post-mortem
│       └── *.json / *.ts / *.csv   reusable artifacts (schemas, mappings, code, matrices)
└── incoming/                 new client requests for the Workbench + expected outcomes
```

Render PDFs after editing any `*.pdf.md`:

```bash
cd backend && uv run python -m app.seed_pdfs            # all sources
cd backend && uv run python -m app.seed_pdfs <file.pdf.md>
```

The output is deterministic, so a re-render only changes the PDF when its source changed. Loading into Postgres + MinIO (`bun run seed`) waits on the domain schema; the loader will read `case.json` and upload exactly the files listed in `artifacts`.

## Cases

| Case | Fund | Archetype | Author |
|---|---|---|---|
| `AND-2025-014` | Sequoia Heritage Cayman Feeder IV | Conditional-logic deadlock + multi-signer race | Minh Nguyen (ALUMNI) |
| `AND-2025-029` | Andreessen Growth Parallel VII | Aggregate fund-level cap breach (ERISA 25%) + Affinity prefill | Sarah Tran (ACTIVE) |
| `AND-2025-051` | KKR European Infrastructure RAIF III | Mid-flight external counsel redline (UBO 25% → 10%) | David Le (ALUMNI) |
| `AND-2026-008` | Blackstone Real Estate Debt X | Side-letter MFN election + FX-normalized fee-tier routing | Minh Nguyen (ALUMNI) |

## Authoring conventions

### `case.json` (content manifest — field names are not the DB schema)

```json
{
  "caseId": "AND-2025-014",
  "slug": "sequoia-heritage-cayman-feeder-iv",
  "title": "Sequoia Heritage Cayman Feeder IV",
  "sponsor": "Sequoia Heritage",
  "archetype": "Conditional Logic Deadlock + Multi-Signer Race Condition",
  "jurisdictions": ["Cayman Islands"],
  "fundStructure": "Master-Feeder",
  "strategy": "Venture Capital",
  "investorTypes": ["Non-US institutional (entity)", "Joint authorized signers"],
  "author": "minh.nguyen",
  "contributors": ["qa.linh", "pm.alex"],
  "timeline": { "kickoff": "YYYY-MM-DD", "uatStart": "…", "plannedUatSignOff": "…", "actualUatSignOff": "…", "plannedInitialClose": "…", "actualInitialClose": "…" },
  "outcome": { "status": "DELIVERED | DELIVERED_LATE | DELIVERED_WITH_HOTFIX", "slipDays": 0, "summary": "one sentence" },
  "incident": "2–4 sentences: what broke, when, impact",
  "rootCause": "1–2 sentences",
  "resolution": "2–3 sentences, naming the artifact(s)",
  "reusableRules": ["imperative rule a future engineer should apply", "…"],
  "tags": ["W-8BEN-E", "FATCA Chapter 4", "…"],
  "artifacts": [
    { "file": "x.pdf", "source": "x.pdf.md", "kind": "LEGAL_DOC", "title": "…", "description": "…", "reusable": false },
    { "file": "slack_x.txt", "kind": "SLACK_THREAD", "title": "…", "description": "…", "reusable": false },
    { "file": "postmortem_x.md", "kind": "POSTMORTEM", "title": "…", "description": "…", "reusable": false },
    { "file": "x.json", "kind": "FORM_SCHEMA", "title": "…", "description": "…", "reusable": true }
  ]
}
```

Artifact `kind`: `LEGAL_DOC`, `SLACK_THREAD`, `POSTMORTEM`, `FORM_SCHEMA`, `CRM_MAPPING`, `CODE`, `MATRIX`. `reusable: true` marks what the Workbench offers for 1-click reuse.

### Legal excerpt (`*.pdf.md` → PDF, 2–3 pages)

The renderer supports this Markdown subset only:

| Syntax | Renders as |
|---|---|
| `# Title` (first line) | Centered document title |
| `*Italic line*` right after the title | Centered subtitle |
| `## Section 3. Heading` / `### 3.2 Heading` | Section / subsection headings |
| Paragraph text (consecutive lines join) | Justified body text |
| `(a) …`, `(ii) …` at line start | Indented sub-clause (one per line) |
| `- item` | Bullet list |
| `> Drafting note: …` | Indented italic note |
| Pipe tables with a `|---|` rule | Table with a header row |
| `**bold**`, `*italic*`, `` `code` `` | Inline styles |
| `<!-- pagebreak -->` | Page break |

Write numbered sections (Section 3.1, Schedule A, Annex B) in realistic private-markets drafting style. Cite real regimes accurately (IRS Form W-8BEN-E parts, FATCA Chapter 4, CRS, ERISA §3(42) and 29 C.F.R. §2510.3-101(f), Regulation D Rule 506(c), Luxembourg AML Law of 12 November 2004, RAIF Law of 23 July 2016). Never invent a real statute's content; when a rule is fictional (e.g. a "2026 CIMA" change), present it as a client- or counsel-specified requirement.

### Slack export (`slack_*.txt`, 12–15 messages)

```text
# Slack export · #deal-sequoia-cayman-iv
# Exported 2025-04-25 by @pm.alex · times in ICT (UTC+7)
# Case AND-2025-014 · Sequoia Heritage Cayman Feeder IV

[2025-04-14 23:02] @qa.linh
First body line of the message.
Optional continuation lines (no indentation).

[2025-04-14 23:05] @minh.nguyen
…
```

- One blank line between messages; handles come from `people.json`.
- Reference concrete things that exist in the same case folder: `cayman_fatca_joint_signer_v2.json L42`, "Section 4.3(b)", "Annex B".
- Line numbers you cite must be correct; check them with `grep -n`.

### Post-mortem (`postmortem_*.md`)

Front-matter table (Case, Fund, Author, Date, Status), then exactly these sections: `## Project Context`, `## Timeline`, `## What Went Wrong in UAT`, `## Root Cause`, `## How We Fixed It`, `## Impact`, `## Reusable Rules for Future Funds`.

### Form schema (`FORM_SCHEMA`, 60–80 lines of JSON)

```json
{
  "$schema": "https://schemas.anduin.example/fundsub/form-schema/v3.json",
  "schemaId": "cayman_fatca_joint_signer",
  "version": "2.0.0",
  "caseId": "AND-2025-014",
  "author": "@minh.nguyen",
  "updated": "2025-04-16",
  "_comment": "Author's note: why this exists and how to reuse it.",
  "parameters": { "…": "…" },
  "fields": [
    {
      "id": "tax.ch4_status",
      "type": "select",
      "label": "Chapter 4 status (W-8BEN-E Part I, line 5)",
      "required": true,
      "editableBy": ["PRIMARY_TAX_COLLABORATOR"],
      "visibleWhen": "investor.kind == 'ENTITY' && investor.us_person == false",
      "validation": [{ "expr": "…", "message": "…" }],
      "_comment": "…"
    }
  ],
  "rules": [{ "id": "…", "when": "…", "then": "…", "_comment": "…" }]
}
```

Expressions use dotted paths and `== != && || ! > >= < <= in`. Helpers: `count()`, `sum()`, `any()`, `all()`, `fx(amount, from, to, rateDate)`. JSON has no comments, so author notes go in `_comment` keys.

### People & names

- People come from `people.json`; dates must be consistent with each person's `leftOn`.
- Investor / LP / counsel / administrator names are invented, and must not be real institutions.
