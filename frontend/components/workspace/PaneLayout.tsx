"use client";

import type { ReactNode } from "react";
import { useDefaultLayout, type LayoutStorage } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import type { PanelSide, Panels } from "@/lib/usePanels";
import { cn } from "@/lib/utils";

const layoutStorage: LayoutStorage = {
  getItem: (key) => (typeof window === "undefined" ? null : window.localStorage.getItem(key)),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};

interface Side {
  label: string;
  content: ReactNode;
  defaultSize?: string;
}

interface PaneLayoutProps {
  id: string;
  panels: Panels;
  left?: Side;
  right?: Side;
  children: ReactNode;
}

function SplitHandle() {
  return <ResizableHandle withHandle className="transition-colors hover:bg-brand-cyan data-[separator=active]:bg-brand-cyan" />;
}

export function PaneLayout({ id, panels, left, right, children }: PaneLayoutProps) {
  const layout = useDefaultLayout({ id, storage: layoutStorage });

  if (!panels.isWide) {
    const drawerClass = (side: PanelSide) =>
      cn(
        "fixed top-14 bottom-0 z-30 w-[min(380px,90vw)] flex-col overflow-y-auto bg-surface-2",
        panels.drawer === side ? "flex" : "hidden",
        side === "left" ? "left-0 border-r" : "right-0 border-l",
      );
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1">
        {panels.drawer && (
          <button
            type="button"
            aria-label="Close panel"
            onClick={panels.closeDrawer}
            className="fixed inset-x-0 top-14 bottom-0 z-20 bg-navy/20"
          />
        )}
        {left && (
          <aside aria-label={left.label} className={drawerClass("left")}>
            {left.content}
          </aside>
        )}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</section>
        {right && (
          <aside aria-label={right.label} className={drawerClass("right")}>
            {right.content}
          </aside>
        )}
      </div>
    );
  }

  const side = (which: PanelSide, value: Side) => (
    <ResizablePanel
      id={which}
      panelRef={panels.refs[which]}
      defaultSize={value.defaultSize ?? "22"}
      minSize={260}
      maxSize="45"
      collapsible
      collapsedSize={0}
      onResize={(size) => panels.syncOpen(which, size.inPixels)}
    >
      <aside aria-label={value.label} className="h-full overflow-y-auto bg-surface-2">
        {value.content}
      </aside>
    </ResizablePanel>
  );

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      id={id}
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
      className="min-w-0 flex-1"
    >
      {left && side("left", left)}
      {left && <SplitHandle />}
      <ResizablePanel id="centre" minSize="30">
        <section className="flex h-full min-h-0 min-w-0 flex-col">{children}</section>
      </ResizablePanel>
      {right && <SplitHandle />}
      {right && side("right", right)}
    </ResizablePanelGroup>
  );
}
