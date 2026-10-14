import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { RoutedTopNav } from "@/components/shell/RoutedTopNav";
import { TopNav, type NavItem } from "@/components/shell/TopNav";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dejavu — Institutional Memory Engine",
  description: "Stop solving the same problem twice. Every past project, instantly recalled.",
};

const NAV: NavItem[] = [
  { href: "/workbench", label: "Workbench" },
  { href: "/vault", label: "Knowledge Vault", disabled: true },
  { href: "/ingest", label: "Ingest Archive", disabled: true },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <Providers>
          {/* usePathname suspends on dynamic routes: keep the shell prerendered with a static fallback. */}
          <Suspense fallback={<TopNav items={NAV} />}>
            <RoutedTopNav items={NAV} />
          </Suspense>
          <main className="flex flex-1 flex-col">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
