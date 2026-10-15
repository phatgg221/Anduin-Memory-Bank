import Link from "next/link";
import { IsometricStack } from "@/components/brand/IsometricStack";
import { SectionLabel } from "@/components/brand/SectionLabel";

// Bulk import of legacy case folders isn't built yet; this page says so instead of pretending.
export default function IngestPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-6 text-center">
      <IsometricStack />
      <SectionLabel as="h1">Ingest archive</SectionLabel>
      <p className="max-w-lg text-sm text-muted-foreground">
        Bulk import of legacy case folders (post-mortems, chat exports and deliverables) into the Memory Bank is coming
        next. Until then, attach files to a case from the intake on the{" "}
        <Link href="/workbench" className="text-navy underline underline-offset-2">
          Workbench
        </Link>
        : they&apos;re stored, their text is extracted, and they&apos;re indexed when the case is committed to memory.
      </p>
    </div>
  );
}
