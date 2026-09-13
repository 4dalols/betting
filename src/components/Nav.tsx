import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/payout";

export async function Nav() {
  const session = await auth();
  if (!session?.user) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { balanceCents: true, name: true },
  });
  return (
    <header className="border-b border-zinc-800">
      <nav className="mx-auto flex max-w-4xl items-center gap-5 px-4 py-3 text-sm">
        <Link href="/" className="font-semibold text-zinc-100">
          Friends Market
        </Link>
        <Link href="/markets/new" className="text-zinc-400 hover:text-zinc-100">
          New market
        </Link>
        <Link href="/leaderboard" className="text-zinc-400 hover:text-zinc-100">
          Leaderboard
        </Link>
        <Link href="/account" className="text-zinc-400 hover:text-zinc-100">
          Account
        </Link>
        {session.user.role === "ADMIN" && (
          <Link href="/admin" className="text-amber-400 hover:text-amber-300">
            Admin
          </Link>
        )}
        <span className="ml-auto text-zinc-400">
          {user?.name} · <span className="font-mono text-zinc-100">{formatCents(user?.balanceCents ?? 0)}</span>
        </span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button className="text-zinc-500 hover:text-zinc-200">Sign out</button>
        </form>
      </nav>
    </header>
  );
}
