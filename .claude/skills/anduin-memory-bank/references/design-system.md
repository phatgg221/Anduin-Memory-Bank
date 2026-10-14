# Design System — Dejavu (shadcn/ui + Anduin tokens)

Source of truth: `DESIGN.md` (repo root). This file is the coding rulebook. Read it before writing or changing any UI.

## The look in one paragraph

Swiss architectural grid:
- **Surfaces:** white and cool-slate.
- **Brand colours:** navy `#0F2547` for structure, cyan `#2998FF` as the accent.
- **Lines and corners:** 1px `#D6DCE5` hairlines, **square corners, no shadows**.
- **Labels:** tracked monospace micro-labels with a navy `■`.

It's an operational workbench: split panes, tables, badges, citations. Not a chatbot, and not a marketing site.

## Where things live

| Path | What | Rules |
|---|---|---|
| `app/globals.css` | All tokens (`:root` palette → shadcn roles → `@theme inline` utilities), `micro-label` utility, base rules | Add new tokens here only. No hex values anywhere else |
| `components/ui/*` | shadcn/ui primitives (Radix base, **Nova** style) | Owned code. Keep edits minimal and token-based. Dejavu edit so far: `ring-foreground/10` → `ring-border` |
| `components/brand/*` | Dejavu signature pieces: `SectionLabel`, `ActionButton`, `StatusBadge`, `AlumniBadge`, `SimilarityMeter`, `BrandMark`, `IsometricStack` | Use these before composing raw classes |
| `components/shell/*` | App chrome: `TopNav` (presentational) + `RoutedTopNav` (reads `usePathname`) | Nav items are configured in `app/layout.tsx` |
| `components/<feature>/*` | Feature components (triage, vault, …) | Presentational: props in, callbacks out (ESLint-enforced) |
| `components.json` | shadcn config: `style: radix-nova`, `iconLibrary: lucide`, aliases `@/components/ui`, `@/lib/utils` | |
| `lib/utils.ts` | `export { cn } from "cn"` | `cn` is shadcn's drop-in `clsx` + `tailwind-merge` replacement |

## Token → class cheat sheet

| Need | Class |
|---|---|
| Page / card surface | `bg-background` / `bg-card` |
| Secondary panel (intake pane, card header, inactive tab) | `bg-surface-2` (= `bg-secondary` = `bg-muted`) |
| Well / hover / skeleton | `bg-surface-3` (= `bg-accent`) |
| Structural navy (banner, `■`, active underline) | `bg-navy`, `text-navy`, `border-navy` |
| Accent cyan (bars, selection ring, brand mark) | `bg-brand-cyan`, `border-brand-cyan`, `ring-ring` — **never for text** |
| Main text / CTA fill | `text-foreground` (= `text-ink`), `bg-primary` |
| Secondary text | `text-muted-foreground` |
| Hairline | `border` / `border-border` / `divide-x` / `divide-y` (defaults to the hairline colour) |
| Delta status | `<StatusBadge status="REUSABLE" \| "MODIFIED" \| "NET_NEW" />` |
| Alumni knowledge | `<AlumniBadge />` (or `text-alumni bg-alumni-bg border-alumni-border`) |
| Overline | `<SectionLabel index={1}>Incoming request</SectionLabel>` |
| Any mono micro text | `micro-label` (11px, uppercase, 0.14em, Geist Mono) |

## Rules

1. **No raw hex or arbitrary colours** in components (`bg-[#ECEFF3]` ✗ → `bg-surface-2` ✓). The DESIGN.md hex values are documentation; the classes are the API.
2. **Square and flat.** Don't add `rounded-*` or `shadow-*`; they're globally neutralised anyway. If something needs to stand out, use a hairline, a surface step, or navy.
3. **Grid, not floating cards.** Panes and table cells share borders (`divide-x`, `border-r`). Avoid gaps between bordered boxes.
4. **Every pane or section starts with a `SectionLabel`** (`■ 0N / TITLE`). Pane numbering follows DESIGN.md §4.
5. **CTAs:**
   - primary actions use `<ActionButton>` (ink fill + boxed `↗`);
   - secondary actions use `tone="secondary"`;
   - plain shadcn `Button` is for minor/tertiary actions (`variant="outline"`, `ghost`, `link`).
6. **Status always carries text.** Never colour-only. Dots are `aria-hidden`.
7. **Scores and IDs** render in mono (`micro-label`, or `font-mono text-xs`). Similarity uses `<SimilarityMeter>` with the retrieval score.
8. **Loading:** `Skeleton` blocks (steel) shaped like the content, plus named job steps. No bare spinners.
9. **Light theme only.** Don't add `dark:` styles. The `dark` variant is class-based (`.dark`), so shadcn's built-in `dark:` classes never fire from the OS setting.
10. **Icons:** `lucide-react`, `size-4` by default, stroke icons only.

## shadcn workflow

- **Adding components:** run `bunx shadcn@latest add <name>` from `frontend/`. Then:
  1. grep the new file for `ring-foreground/10` and swap it to `ring-border`;
  2. check it under the hairline/square rules (radius and shadows are neutralised globally, so usually nothing else is needed);
  3. run `bun run lint` and `bun run build`.
- **Already installed:** button, badge, card, table, separator, select, textarea, input, label, checkbox, scroll-area, skeleton, tooltip, resizable, dropdown-menu, tabs, progress.
- **Tooltip:** `TooltipProvider` is already mounted in `app/providers.tsx`.
- **Imports:** shadcn components import `cn` straight from `"cn"`. Our own code imports it from `@/lib/utils`.
- **Don't re-run `shadcn init`.** It rewrites `globals.css` with a generic theme, and its `--font-sans: var(--font-sans)` line is self-referential. If you must re-run it, restore `globals.css` from git afterwards.
- **After adding dependencies:** run `bun run dev`. It rebuilds the frontend image and renews the container's `node_modules` volume. Until then, the running container can't resolve the new packages.
- **Stale errors after a restart:** an old browser tab replays stale "Module not found" errors after a restart, and Next 16 forwards browser console output into the container log as `[browser] …`. Reload or reopen the tab before trusting those.

## Example: a pane

```tsx
<section className="flex flex-col gap-6 border-r p-6">
  <SectionLabel index={2}>Dejavu precedent &amp; delta engine</SectionLabel>
  <div className="grid grid-cols-3 divide-x border">
    {matches.map((m, i) => (
      <button
        key={m.caseId}
        onClick={() => onSelect(m.caseId)}
        className={cn("flex flex-col gap-2 p-4 text-left hover:bg-surface-2", m.caseId === selectedId && "outline outline-brand-cyan")}
      >
        <SimilarityMeter rank={i + 1} score={m.similarityScore} />
        <span className="font-medium">{m.title}</span>
        <span className="micro-label text-muted-foreground">{m.jurisdiction} · {m.period}</span>
      </button>
    ))}
  </div>
</section>
```
