import Link from "next/link";

const links = [
  { href: "/tt", label: "Play" },
  { href: "/tt/host", label: "Host" },
  { href: "/answer", label: "Price Is Right" },
] as const;

export default function TtLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-white/5 bg-zinc-950/70 backdrop-blur-md">
        <nav className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-3 text-sm">
          <Link href="/tt" className="mr-3 flex items-center gap-2 font-semibold tracking-tight text-zinc-50">
            <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-sky-300 to-violet-500 text-xs font-bold text-zinc-950 shadow-md shadow-violet-500/30">
              TT
            </span>
            Trade or Tighten
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
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-10">{children}</main>
    </>
  );
}
