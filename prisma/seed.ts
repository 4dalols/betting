import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const names = ["Alice", "Bob", "Carol"];
  const users = [];
  for (const name of names) {
    const u = await prisma.user.upsert({
      where: { email: `${name.toLowerCase()}@example.com` },
      update: {},
      create: { name, email: `${name.toLowerCase()}@example.com`, balanceCents: 5000 },
    });
    users.push(u);
  }
  const existing = await prisma.market.count();
  if (existing === 0) {
    await prisma.market.create({
      data: {
        question: "Will it rain next Saturday?",
        type: "BINARY",
        stakeCents: 500,
        creatorId: users[0].id,
        closesAt: new Date(Date.now() + 7 * 86400_000),
        outcomes: { create: [{ label: "Yes", sortOrder: 0 }, { label: "No", sortOrder: 1 }] },
      },
    });
    await prisma.market.create({
      data: {
        question: "Who wins game night?",
        type: "MULTI",
        stakeCents: 200,
        creatorId: users[1].id,
        outcomes: {
          create: names.map((label, i) => ({ label, sortOrder: i })),
        },
      },
    });
  }
  console.log("seeded");
}

main().finally(() => prisma.$disconnect());
