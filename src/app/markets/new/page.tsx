import { requireUser } from "@/lib/auth";
import { NewMarketForm } from "./NewMarketForm";

export default async function NewMarketPage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-6 text-2xl font-semibold">Propose a market</h1>
      <NewMarketForm />
    </div>
  );
}
