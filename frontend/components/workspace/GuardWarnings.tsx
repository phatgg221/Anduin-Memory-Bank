import { ChevronDown } from "lucide-react";

export function GuardWarnings({ warnings, prefix }: { warnings: string[]; prefix?: string }) {
  if (warnings.length === 0) return null;
  return (
    <details className="group text-xs text-muted-foreground">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 hover:text-ink">
        {prefix}
        {warnings.length} unverifiable reference{warnings.length === 1 ? "" : "s"} removed
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <ul className="mt-1 flex flex-col gap-0.5 border-l-2 border-modified pl-3">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </details>
  );
}
