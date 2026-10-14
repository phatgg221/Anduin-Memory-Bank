"use client";

import { usePathname } from "next/navigation";
import { TopNav, type NavItem } from "./TopNav";

/**
 * TopNav with the active item derived from the URL. usePathname suspends on routes with unknown dynamic
 * params under Cache Components, so render this inside <Suspense fallback={<TopNav items={...} />}>.
 */
export function RoutedTopNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const active = items.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return <TopNav items={items} activeHref={active?.href} />;
}
