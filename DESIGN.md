# Product & UI/UX Design Blueprint — Dejavu

> **Implementation status (2026-10-14):**
> - Done: tokens, shadcn/ui (Radix, Nova style), brand kit (§3), persistent top nav, and the empty 3-pane Workbench frame.
> - Not built: pane contents, the Knowledge Vault, and Ingest. They wait on the feature set (CONTEXT.md §7).
>
> Rules for writing UI code live in the skill: `.claude/skills/anduin-memory-bank/references/design-system.md`.

## 1. Brand Identity: "Dejavu"

- **App name:** **Dejavu** (`DEJAVU // Institutional Memory Engine`). The repo and codebase keep the working name *Anduin Memory Bank*.
- **Tagline:** *"Stop solving the same problem twice. Every past project, instantly recalled."*
- **Design language:** inspired by **Anduin's core platform aesthetic**:
  - Swiss architectural grids;
  - crisp white and cool-slate surfaces;
  - deep institutional navy (`#0F2547`) and electric logo cyan (`#2998FF`);
  - razor-sharp `1px` borders and square corners (`border-radius: 0`);
  - technical monospace micro-labels (`■ CASE MATCHED`).
- **Light theme only.** No dark mode for the hackathon.

## 2. Anduin Color Palette & Design Tokens

Tokens are defined once in `frontend/app/globals.css`. **Use the Tailwind class, never the raw hex.** Where a shadcn semantic role matches, prefer it, because shadcn components already use those roles.

| Role | Hex | Use this class | Usage in Dejavu |
| :--- | :--- | :--- | :--- |
| Background Primary | `#FFFFFF` | `bg-background` / `bg-card` | Main canvas, cards, split-pane surfaces |
| Background Secondary (Cool Grey) | `#ECEFF3` | `bg-surface-2` (= `bg-secondary` / `bg-muted`) | Left intake panel, inactive tabs, card headers |
| Background Tertiary (Steel Slate) | `#CBD2DC` | `bg-surface-3` (= `bg-accent`) | Diagram wells, hover states, skeleton blocks |
| Anduin Deep Navy (Primary Brand) | `#0F2547` | `bg-navy` / `text-navy` | Active case banner, structural headers, `■` bullets |
| Anduin Brand Cyan (Logo Accent) | `#2998FF` | `bg-brand-cyan` / `border-brand-cyan` / `ring-ring` | Brand mark, similarity bars, focus/selection ring. **Not for text** (§7) |
| Ink Black (Text & CTA) | `#111315` | `text-foreground` / `text-ink` / `bg-primary` | Headlines, primary CTA (`Analyze Request [↗]`) |
| Muted Slate (Body & Subtitles) | `#525866` | `text-muted-foreground` | Descriptions, timestamps, artifact metadata |
| Grid Hairline Border | `#D6DCE5` | `border` / `border-border` / `border-hairline` / `divide-x` | Exposed `1px solid` lines between panes and table rows |

### Semantic Status Tokens (Delta Matrix & Memory)

| Status | Text | Background | Border | Square dot | Classes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `REUSABLE` | `#065F46` | `#ECFDF5` | `#A7F3D0` | `■ #10B981` | `text-reusable bg-reusable-bg border-reusable-border` · dot `bg-reusable-dot` |
| `MODIFIED` / Delta | `#92400E` | `#FFFBEB` | `#FDE68A` | `■ #F59E0B` | `text-modified bg-modified-bg border-modified-border` · dot `bg-modified-dot` |
| `NET_NEW` Risk | `#991B1B` | `#FEF2F2` | `#FECACA` | `■ #EF4444` | `text-net-new bg-net-new-bg border-net-new-border` · dot `bg-net-new-dot` |
| `ALUMNI` Memory | `#0F2547` | `#E0F2FE` | `#7DD3FC` | `■ #0F2547` | `text-alumni bg-alumni-bg border-alumni-border` · dot `bg-alumni-dot` — badge `[■ ALUMNI ARCHIVE]` |

In practice, use `<StatusBadge status=… />` and `<AlumniBadge />` rather than composing these classes by hand.

### Typography

| Use | Style |
| :--- | :--- |
| UI and body | Geist Sans (`font-sans`), `text-sm` default. Headlines `font-semibold tracking-tight` in ink |
| Micro-labels, overlines, IDs, scores, status | Geist Mono via the `micro-label` utility: 11px, uppercase, `0.14em` tracking |
| Code, file names, citations | `font-mono text-xs` |

### Shape & elevation

- **Square corners everywhere.** `--radius: 0`, the radius scale is zeroed, and the base layer forces `border-radius: 0 !important`, so even shadcn's hard-coded `rounded-full` renders square.
- **No shadows.** The shadow scale is flattened. Separation comes from 1px hairlines (`border`, `divide-x/y`) and surface colour steps (white → `surface-2` → `surface-3` → navy).
- **The grid is the structure.** Panes butt against each other and are divided by hairlines, never floating cards with gaps. Shared borders and `divide-*` beat margins.

## 3. Signature Anduin UI Components

| # | Component | File | Notes |
| :--- | :--- | :--- | :--- |
| 1 | **Section overline** `■ 01 / INCOMING REQUEST` | `components/brand/SectionLabel.tsx` | Navy square + tracked mono label. `index` adds `01 /`; `inverse` for navy surfaces |
| 2 | **Action button** `[ Run Dejavu Analysis  [↗] ]` | `components/brand/ActionButton.tsx` | `tone="primary"`: ink fill, white text, white icon box. `tone="secondary"`: white fill, 1px ink border, ink icon box. `icon="arrow" \| "bolt"` |
| 3 | **Isometric empty state** | `components/brand/IsometricStack.tsx` | Stacked isometric planes (steel), navy top plane, cyan ring. Shown before a request is analyzed |
| — | Status badges `[■ REUSABLE]`, `[■ ALUMNI ARCHIVE]` | `components/brand/StatusBadge.tsx` | `StatusBadge` and `AlumniBadge` |
| — | Similarity meter `#01 · 94% MATCH` | `components/brand/SimilarityMeter.tsx` | Cyan bar on a steel track. The score comes from retrieval, never from the LLM |
| — | Brand mark `▲ Dejavu // by Anduin` | `components/brand/BrandMark.tsx` | |
| — | Top navigation | `components/shell/TopNav.tsx` + `RoutedTopNav.tsx` | Active item gets a 2px navy underline. Unbuilt sections render disabled |

Primitives (Button, Badge, Card, Table, Select, Textarea, Input, Label, Checkbox, ScrollArea, Skeleton, Tooltip, Resizable, DropdownMenu, Tabs, Progress, Separator) come from **shadcn/ui** in `components/ui/`, themed by the tokens above.

## 4. View Sketches (Anduin Visual Grid)

### View 1: Top Navigation Bar (persistent) — *built*

```text
+------------------------------------------------------------------------------------------------------------------+
| ▲ Dejavu // by Anduin     Workbench    Knowledge Vault    Ingest Archive          [ Load Demo ▾ ]  [ + Ingest ↗ ]|
+------------------------------------------------------------------------------------------------------------------+
```

`Knowledge Vault` and `Ingest Archive` render disabled until their routes exist. The `Load Demo` and `+ Ingest` actions wait on the features behind them; TopNav already has an `actions` slot for them.

### View 2: The Dejavu Workbench (`/workbench`) — 3-pane Swiss grid — *frame built, panes empty*

`/` redirects to `/workbench`. Panes: `minmax(300px,1fr) | minmax(0,2fr) | minmax(280px,1fr)` with `divide-x` hairlines. Pane 01 sits on `surface-2`. Below `lg` the panes stack. A slim system status bar sits at the bottom.

```text
+----------------------------------+-----------------------------------------------+-------------------------------+
| ■ 01 / INCOMING REQUEST          | ■ 02 / DEJAVU PRECEDENT & DELTA ENGINE        | ■ 03 / REUSABLE KIT & SOURCE  |
| -------------------------------- | --------------------------------------------- | ----------------------------- |
| [Preset: Cayman Feeder IV     ▾] | MATCHED HISTORICAL CASES (TOP 3)              | REUSABLE ASSETS (2 SELECTED)  |
|                                  | +-------------------+-----------+-----------+ | +---------------------------+ |
| +------------------------------+ | | #01 · 94% MATCH   | #02 · 78% | #03 · 64% | | | [x] FATCA joint-signer v2 | |
| | Client: Apollo Global        | | | Sequoia Feeder IV | KKR Euro  | A16Z VII  | | |     Validation Schema     | |
| | Request: Onboard new Cayman  | | | Cayman · Q2 2025  | Lux ·2025 | DE · 2025 | | |     [Preview]  [Export ↗] | |
| | Master-Feeder fund. Must     | | +-------------------+-----------+-----------+ | +---------------------------+ |
| | support joint non-US LP      | |                                               | | [x] Affinity prefill map  | |
| | signers (W-8BEN-E) and new   | | ┌─ HOW THIS PAST CASE WENT (#0F2547 Navy) ──┐ | |     CRM field mapping     | |
| | 2026 CIMA AML 10% beneficial | | | ■ ALUMNI RECORD: Minh Nguyen (Left 8m ago)| | |     [Preview]  [Export ↗] | |
| | ownership look-through rule. | | | "UAT slipped 9 days because joint non-US  | | +---------------------------+ |
| +------------------------------+ | |  LPs triggered conflicting W-8BEN-E Ch.4  | | [ Clone Starter Kit     [↗] ] |
|                                  | |  status rules. Fixed in v2 schema."       | |                               |
| [ Run Dejavu Analysis      [↗] ] | |  Source: [slack_uat_fatca_deadlock #L42 ↗]| | ----------------------------- |
|                                  | └───────────────────────────────────────────┘ | ■ SOURCE CITATION INSPECTOR   |
| -------------------------------- |                                               | File: slack_uat_fatca_deadlock|
| ■ EXTRACTED PARAMETERS           | ■ WHAT'S DIFFERENT THIS TIME (DELTA MATRIX)   | +---------------------------+ |
|                                  | +---------------+-------------+-------------+ | | @minh.nguyen [2025-04-14] | |
| JURISDICTION   [Cayman Islands]  | | DIMENSION     | PAST CASE   | THIS REQUEST| | | "Found the UAT blocker:   | |
| STRUCTURE      [Master-Feeder ]  | +---------------+-------------+-------------+ | | Primary LP = Active NFFE  | |
| TAX FORMS      [W-8BEN-E Joint]  | | ■ W-8BEN-E    | Joint Signer| Identical   | | | + Co-signer = Passive     | |
| AML RULE       [CIMA 10% Rule ]  | |   Routing     | v2 Patch    | [REUSABLE]  | | | locks step 4. Use v2."    | |
|                                  | +---------------+-------------+-------------+ | +---------------------------+ |
|                                  | | ■ AML/KYC     | 25% CIMA    | 10% CIMA    | |                               |
|                                  | |   Threshold   | Look-through| [MODIFIED]  | | ■ ASK SCOPED QUESTION         |
|                                  | +---------------+-------------+-------------+ | +-----------------------+---+ |
|                                  | | ■ Crypto      | None        | Hardware    | | | Verify v2 test cases? | ↗ | |
|                                  | |   Attestation |             | [NET_NEW]   | | +-----------------------+---+ |
+----------------------------------+-----------------------------------------------+-------------------------------+
```

The mock shows seed-pack request **REQ-A**, and every value in it comes from `backend/data/seed_pack/`:
- **Matches:** AND-2025-014 / AND-2025-051 / AND-2025-029.
- **Assets:** `cayman_fatca_joint_signer_v2.json`, `affinity_prefill_mapping.json`.
- **Citation:** `slack_uat_fatca_deadlock.txt` line 42.
- **Expected delta:** `incoming/expected.json`.

Component mapping when these panes get built:

| Sketch element | Build with |
| :--- | :--- |
| Preset select, request text | shadcn `Select`, `Textarea` |
| Extracted parameters | `micro-label` keys + mono value chips (`border bg-background font-mono text-xs`) |
| Top-3 match strip | One row of cells sharing hairlines, each with a `SimilarityMeter`. The selected cell gets a `border-brand-cyan` ring |
| "How this past case went" | Navy panel (`bg-navy text-white`), `SectionLabel inverse`, `AlumniBadge`, citation link |
| Delta Matrix | shadcn `Table`, with a `StatusBadge` in the last column |
| Reusable assets | `Checkbox` rows plus secondary `ActionButton`s. `Clone Starter Kit` is a primary `ActionButton` |
| Source citation inspector | `ScrollArea` with `font-mono text-xs` and the cited line highlighted |
| Ask scoped question | `Input` plus an icon box button |
| Pane loading | `Skeleton` (steel blocks), plus step-by-step job progress |

### View 3: The Knowledge Vault (`/vault`) — *not built*

Anduin's 3-column feature grid across the top, then a clean data table:

- **Column 1** (`bg-surface-2`): `12 INDEXED PAST CASES` — total digitized fund-onboarding playbooks.
- **Column 2** (`bg-surface-3`): `5 ALUMNI MEMORIES PRESERVED` — post-mortems and Slack fixes captured from departed engineers.
- **Column 3** (`bg-navy text-white`): `38 REUSABLE SCHEMAS & TEMPLATES` — ready for 1-click cloning into new projects.

## 5. Layout Rules

- **Page shell:** sticky 56px `TopNav` (`h-14`, bottom hairline), then `<main class="flex flex-1 flex-col">`.
- **Pane padding:** `p-6`. Gap between a section label and its content: `gap-6` for panes, `gap-4` for subsections.
- **Breakpoints:** panes are 3 columns at `lg` and above, stacked below. Design for 1440px first; 1280px must still work.
- **Data-dense views:** tables use `text-sm`, IDs and dates in `font-mono text-xs`, and right-aligned numbers.

## 6. Interaction & Motion

- **Hover:** `hover:bg-surface-2` on rows and nav cells; buttons per their variant. No scale or lift effects.
- **Focus:** a visible cyan ring (`ring-ring`). Never remove outlines without a replacement.
- **Loading:** steel `Skeleton` blocks, and step labels for analysis jobs (`■ 02 / RETRIEVING PRECEDENTS`). Never a lone spinner.
- **Motion:** minimal. Opacity and translate only, ≤150ms (`tw-animate-css` is available).

## 7. Accessibility

- **Cyan is not text.** `#2998FF` on white is **2.99:1**, which fails WCAG AA for text and is borderline for UI graphics. Use it for bars, rings, borders, and the `▲` mark; put any adjacent label in ink or navy.
- **Muted slate passes:** `#525866` is 7.1:1 on white and ~6.2:1 on `#ECEFF3`. Status text/background pairs are dark-on-pale and pass.
- **Status is never colour-only.** Badges always carry their text (`REUSABLE`, …), and the `■` dots are `aria-hidden`.

## 8. Product capabilities implied by the sketches (need sign-off)

These appear in the blueprint but aren't in ARCHITECTURE.md yet. Each needs a product decision before it gets built:

1. **Load Demo presets** — canned incoming requests (pairs with the seed data's demo trigger).
2. **Ingest Archive / `+ Ingest`** — adding past cases to the vault from the UI (answers CONTEXT §7 "Growing the vault").
3. **Source citation inspector with line anchors** (`slack_uat_fatca_deadlock.txt #L42`) — needs citations with chunk ID, quote, and line range (extends the proposed `Citation` contract).
4. **Ask scoped question** — LLM Q&A grounded in the selected case. This is a new pipeline, and it must stay grounded and guarded so it doesn't become a generic chatbot.
5. **Clone Starter Kit** — bundling the selected artifacts (zip export, or a list of presigned links).
6. **Vault stats** — counts of cases, alumni memories, and reusable artifacts.

> The sketch's sample content uses real firm names (Apollo, Sequoia, KKR, a16z) next to invented incidents. For a demo shown to Anduin, consider fictional sponsor names.
