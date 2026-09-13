import { requireUser } from "@/lib/auth";
import { NewMarketForm } from "./NewMarketForm";

export default async function NewMarketPage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="page-title mb-6">Propose a market</h1>
      <NewMarketForm />
    </div>
  );
}
