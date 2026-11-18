"use client";

import { usePathname } from "next/navigation";

/** The Exchange has its own nav and needs the full screen width, so it skips the site nav and page column. */
export function SiteChrome({ nav, children }: { nav: React.ReactNode; children: React.ReactNode }) {
  const path = usePathname();
  const exchange = path === "/ex" || path.startsWith("/ex/");
  return (
    <>
      {!exchange && nav}
      <main className={exchange ? "flex w-full flex-1 flex-col" : "mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:py-10"}>
        {children}
      </main>
    </>
  );
}
