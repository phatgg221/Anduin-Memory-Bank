import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { IsometricStack } from "@/components/brand/IsometricStack";
import { SectionLabel } from "@/components/brand/SectionLabel";

/** Split screen for sign-in / register: navy brand panel (lg+) beside the form. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside className="hidden flex-col justify-between bg-navy p-10 text-white lg:flex">
        <BrandMark inverse />
        <div className="flex flex-col gap-6">
          <SectionLabel as="p" inverse>
            Institutional memory engine
          </SectionLabel>
          <p className="max-w-md text-4xl leading-tight font-semibold tracking-tight">
            Stop solving the same problem twice.
          </p>
          <p className="max-w-md text-white/70">
            Every past fund onboarding, post-mortem, and alumni fix — instantly recalled when a new request lands.
          </p>
        </div>
        <div className="flex items-end justify-between">
          <span className="micro-label text-white/50">Agent in the Shell · 2026</span>
          <IsometricStack className="w-36 opacity-90" />
        </div>
      </aside>

      <section className="flex flex-col">
        <div className="flex h-14 items-center border-b px-6 lg:hidden">
          <BrandMark />
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </section>
    </div>
  );
}
