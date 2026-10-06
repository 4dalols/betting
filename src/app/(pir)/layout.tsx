import Link from "next/link";

const links = [
  { href: "/answer", label: "Answer" },
  { href: "/game", label: "Play" },
  { href: "/host", label: "Host" },
] as const;

export default function PirLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-white/5 bg-zinc-950/70 backdrop-blur-md">
        <nav className="mx-auto flex max-w-4xl items-center gap-1 px-4 py-3 text-sm">
          <Link href="/answer" className="mr-3 flex items-center gap-2 font-semibold tracking-tight text-zinc-50">
            <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-amber-300 to-rose-500 text-xs font-bold text-zinc-950 shadow-md shadow-rose-500/30">
              PR
            </span>
            Price Is Right
          </Link>
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-2.5 py-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
            >
              {l.label}
            </Link>
          ))}
          <Link href="/" className="ml-auto text-zinc-500 transition hover:text-zinc-200">
            Friends Market →
          </Link>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:py-10">{children}</main>
    </>
  );
}
