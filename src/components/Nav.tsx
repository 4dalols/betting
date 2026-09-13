import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/payout";

const links = [
  { href: "/", label: "Markets" },
  { href: "/markets/new", label: "New market" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/account", label: "Account" },
] as const;

export async function Nav() {
  const session = await auth();
  if (!session?.user) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { balanceCents: true, name: true },
  });
  return (
    <header className="sticky top-0 z-20 border-b border-white/5 bg-zinc-950/70 backdrop-blur-md">
      <nav className="mx-auto flex max-w-4xl items-center gap-1 px-4 py-3 text-sm">
        <Link href="/" className="mr-3 flex items-center gap-2 font-semibold tracking-tight text-zinc-50">
          <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-accent-400 to-accent-600 text-xs font-bold text-zinc-950 shadow-md shadow-accent-500/30">
            FM
          </span>
          Friends Market
        </Link>
        <div className="hidden items-center gap-1 sm:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-2.5 py-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
            >
              {l.label}
            </Link>
          ))}
          {session.user.role === "ADMIN" && (
            <Link
              href="/admin"
              className="rounded-md px-2.5 py-1.5 text-amber-300 transition hover:bg-amber-500/10 hover:text-amber-200"
            >
              Admin
            </Link>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-zinc-400 sm:inline">{user?.name}</span>
          <Link
            href="/account"
            className="pill bg-accent-500/10 font-mono text-accent-300 ring-accent-500/30 transition hover:bg-accent-500/20"
          >
            {formatCents(user?.balanceCents ?? 0)}
          </Link>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button className="text-zinc-500 transition hover:text-zinc-200">Sign out</button>
          </form>
        </div>
      </nav>
      <div className="flex gap-1 overflow-x-auto px-4 pb-2 text-sm sm:hidden">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="shrink-0 rounded-md px-2.5 py-1 text-zinc-400 hover:text-zinc-100">
            {l.label}
          </Link>
        ))}
        {session.user.role === "ADMIN" && (
          <Link href="/admin" className="shrink-0 rounded-md px-2.5 py-1 text-amber-300">
            Admin
          </Link>
        )}
      </div>
    </header>
  );
}
