import { IsometricStack } from "@/components/brand/IsometricStack";

/** Shown while the session is restored from the refresh cookie (or if that check can't reach the server). */
export function SessionSplash({ error }: { error?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <IsometricStack className={error ? "opacity-60" : "animate-pulse"} />
      <p className="micro-label text-muted-foreground">{error ? "Session check failed" : "Restoring session"}</p>
      {error && <p className="max-w-sm text-sm text-muted-foreground">{error}</p>}
    </div>
  );
}
