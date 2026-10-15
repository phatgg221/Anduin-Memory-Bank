import { Pin } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CaseRef, PinnedCase } from "@/types/rooms";

const NONE = "NONE";

interface PinnedCaseBarProps {
  roomName: string;
  pinned: PinnedCase | null;
  options: CaseRef[];
  onPin: (caseId: string | null) => void;
  isPinning: boolean;
}

/** `■ 02 / #LEGAL` header with the room's current problem. */
export function PinnedCaseBar({ roomName, pinned, options, onPin, isPinning }: PinnedCaseBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
      <h2 className="micro-label flex items-center gap-2 text-navy">
        <span aria-hidden className="size-2 bg-navy" />
        02 / # {roomName}
      </h2>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <Pin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="micro-label text-muted-foreground">Current problem</span>
        <Select value={pinned?.id ?? NONE} onValueChange={(value) => onPin(value === NONE ? null : value)} disabled={isPinning}>
          <SelectTrigger className="h-8 min-w-0 max-w-80" aria-label="Current problem">
            <SelectValue placeholder="None pinned" />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value={NONE}>None pinned</SelectItem>
            {pinned && !options.some((o) => o.id === pinned.id) && (
              <SelectItem value={pinned.id}>
                {pinned.case_code} · {pinned.title}
              </SelectItem>
            )}
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.case_code} · {option.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
