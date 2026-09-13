import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await auth();
  const { callbackUrl } = await searchParams;
  if (session?.user) redirect("/");
  const target = typeof callbackUrl === "string" && callbackUrl.startsWith("/") ? callbackUrl : "/";
  return (
    <div className="mx-auto mt-24 max-w-sm text-center">
      <h1 className="text-3xl font-semibold">Friends Market</h1>
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
    </div>
  );
}
