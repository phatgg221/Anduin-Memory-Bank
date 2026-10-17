import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { IsometricStack } from "@/components/brand/IsometricStack";
import { SectionLabel } from "@/components/brand/SectionLabel";
import { Button } from "@/components/ui/button";

export function NotFoundState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
      <IsometricStack className="w-24" />
      <SectionLabel>{title}</SectionLabel>
      <p className="max-w-md text-sm text-muted-foreground">{detail}</p>
      <Button asChild variant="outline" size="sm" className="gap-1.5">
        <Link href="/workbench">
          <ArrowLeft className="size-3.5" aria-hidden /> Back to the Workbench
        </Link>
      </Button>
    </div>
  );
}
