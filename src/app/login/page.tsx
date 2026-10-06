import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await auth();
  const { callbackUrl } = await searchParams;
  if (session?.user) redirect("/");
  const target = typeof callbackUrl === "string" && callbackUrl.startsWith("/") ? callbackUrl : "/";
  return (
    <div className="card mx-auto mt-16 max-w-sm p-8 text-center sm:mt-24">
      <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-accent-400 to-accent-600 text-lg font-bold text-zinc-950 shadow-lg shadow-accent-500/30">
        FM
      </div>
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Friends Market</h1>
      <p className="mt-2 text-zinc-400">Paper-money prediction markets. Sign in to play.</p>
      <form
        className="mt-8"
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: target });
        }}
      >
        <button className="btn w-full">Continue with Google</button>
      </form>
      <p className="mt-6 text-sm text-zinc-400">
        Here for the Price Is Right game?{" "}
        <Link href="/answer" className="text-amber-300 hover:underline">
          Answer questions
        </Link>{" "}
        ·{" "}
        <Link href="/game" className="text-amber-300 hover:underline">
          Join a game
        </Link>
      </p>
      <p className="mt-4 text-xs text-zinc-500">
        <Link href="/privacy" className="hover:text-zinc-300">
          Privacy policy
        </Link>
      </p>
    </div>
  );
}
