import { Check, X } from "lucide-react";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { Button } from "@/components/ui/button";
import type { AccessRequest } from "@/types/rooms";
import { Avatar } from "./Avatar";

interface AccessRequestsProps {
  requests: AccessRequest[];
  departmentCodes: Record<string, string>;
  onDecide: (requestId: string, approve: boolean) => void;
}

export function AccessRequests({ requests, departmentCodes, onDecide }: AccessRequestsProps) {
  if (requests.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 border border-modified-border bg-modified-bg p-3">
      <SectionLabel>Asking to join · {requests.length}</SectionLabel>
      <ul className="flex flex-col gap-2">
        {requests.map((request) => (
          <li key={request.id} className="flex items-center gap-2 text-sm">
            <Avatar initials={request.user.avatar_initials} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-ink">{request.user.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {request.user.job_title ?? "Colleague"}
                {request.user.primary_department_id && ` · ${departmentCodes[request.user.primary_department_id] ?? ""}`}
              </span>
            </span>
            <Button size="sm" className="gap-1" onClick={() => onDecide(request.id, true)}>
              <Check className="size-3.5" aria-hidden /> Add
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={`Dismiss ${request.user.name}'s request`}
              onClick={() => onDecide(request.id, false)}
            >
              <X className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
