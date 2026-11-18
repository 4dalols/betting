import Link from "next/link";

const links = [
  { href: "/ex", label: "Play" },
  { href: "/ex/host", label: "Host" },
] as const;

export default function ExLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-white/5 bg-zinc-950/70 backdrop-blur-md">
        <nav className="mx-auto flex max-w-[1800px] items-center gap-1 px-4 py-3 text-sm">
          <Link href="/ex" className="mr-3 flex items-center gap-2 font-semibold tracking-tight text-zinc-50">
            <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-emerald-300 to-sky-500 text-xs font-bold text-zinc-950 shadow-md shadow-sky-500/30">
              EX
            </span>
            Exchange
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
        </nav>
      </header>
      <div className="mx-auto w-full max-w-[1800px] flex-1 px-4 py-3">{children}</div>
    </>
  );
}
