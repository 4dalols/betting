import Link from "next/link";

export const metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto mt-12 max-w-2xl space-y-4 text-zinc-300">
      <h1 className="text-3xl font-semibold text-zinc-100">Privacy Policy</h1>
      <p>
        Friends Market is a private, invite-only site for a small group of friends to run
        paper-money prediction markets. It is not a commercial service.
      </p>
      <h2 className="pt-2 text-xl font-medium text-zinc-100">What we collect</h2>
      <p>
        When you sign in with Google we store your name, email address, and profile picture so
        other players can see who created a market or placed a bet. We also store the markets you
        create, the bets you place, and your paper-money balance and transaction history.
      </p>
      <h2 className="pt-2 text-xl font-medium text-zinc-100">How it is used</h2>
      <p>
        This information is used only to operate the site. It is visible to other signed-in
        players and to the site administrator. It is never sold or shared with third parties.
      </p>
      <h2 className="pt-2 text-xl font-medium text-zinc-100">Deletion</h2>
      <p>
        To have your account and data removed, contact the site administrator.
      </p>
      <p className="pt-4">
        <Link href="/login" className="underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
