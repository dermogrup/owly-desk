import { PrismaClient } from "./src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/owly?schema=public";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const channels = await prisma.channel.findMany();
  const settings = await prisma.settings.findFirst();
  console.log("Channels:", JSON.stringify(channels, null, 2));
  console.log("Settings:", JSON.stringify(settings, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
