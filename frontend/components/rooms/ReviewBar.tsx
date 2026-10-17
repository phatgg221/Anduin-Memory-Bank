import { ListChecks, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ReviewBarProps {
  count: number;
  span: string;
  onSubmit: (focus: string) => void;
  onCancel: () => void;
}

export function ReviewBar({ count, span, onSubmit, onCancel }: ReviewBarProps) {
  const [focus, setFocus] = useState("");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(focus.trim());
  };
  return (
    <form
      onSubmit={submit}
      className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-surface-2 px-6 py-2.5"
      aria-label="Review messages with Dejavu"
    >
      <ListChecks className="size-4 text-navy" aria-hidden />
      <span className="flex flex-col text-sm text-ink">
        <span>
          <span className="font-medium">{count}</span> message{count === 1 ? "" : "s"} selected
          <span className="text-muted-foreground"> · {span}</span>
        </span>
        <span className="text-xs text-muted-foreground">Click messages to add or remove · shift-click for a run</span>
      </span>
      <Input
        value={focus}
        onChange={(event) => setFocus(event.target.value)}
        maxLength={500}
        placeholder="Optional focus, e.g. is our residency answer right?"
        className="h-8 min-w-48 flex-1 bg-background text-sm"
      />
      <Button type="submit" size="sm" className="gap-1.5">
        <ListChecks className="size-3.5" aria-hidden /> Review with Dejavu
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel} aria-label="Cancel review">
        <X className="size-3.5" aria-hidden />
      </Button>
    </form>
  );
}
