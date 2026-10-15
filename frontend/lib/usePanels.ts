import { useEffect, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import { useMediaQuery } from "./useMediaQuery";

export type PanelSide = "left" | "right";
export type Panels = ReturnType<typeof usePanels>;

export function usePanels() {
  const isWide = useMediaQuery("(min-width: 1024px)", false);
  const [wideOpen, setWideOpen] = useState<Record<PanelSide, boolean>>({ left: true, right: true });
  const [drawer, setDrawer] = useState<PanelSide | null>(null);
  const left = usePanelRef();
  const right = usePanelRef();
  const refs = { left, right };

  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setDrawer(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  return {
    isWide,
    drawer,
    refs,
    closeDrawer: () => setDrawer(null),
    isOpen: (side: PanelSide) => (isWide ? wideOpen[side] : drawer === side),
    toggle: (side: PanelSide) => {
      if (!isWide) return setDrawer((current) => (current === side ? null : side));
      const ref = refs[side].current;
      if (ref?.isCollapsed()) ref.expand();
      else ref?.collapse();
    },
    syncOpen: (side: PanelSide, pixels: number) =>
      setWideOpen((open) => (open[side] === pixels > 0 ? open : { ...open, [side]: pixels > 0 })),
  };
}
