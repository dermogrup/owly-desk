import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/owly?schema=public";
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function run() {
  console.log("Checking database tables...");
  
  const customerCount = await prisma.customer.count();
  const conversationCount = await prisma.conversation.count();
  const adminCount = await prisma.admin.count();
  
  console.log(`Customers: ${customerCount}`);
  console.log(`Conversations: ${conversationCount}`);
  console.log(`Admins: ${adminCount}`);
  
  if (customerCount > 0) {
    const customers = await prisma.customer.findMany({ take: 5 });
    console.log("\nSample Customers:");
    console.dir(customers, { depth: null });
  }
  
  if (conversationCount > 0) {
    const conversations = await prisma.conversation.findMany({
      take: 5,
      include: { messages: true }
    });
    console.log("\nSample Conversations:");
    console.dir(conversations, { depth: null });
  }
  
  await prisma.$disconnect();
  await pool.end();
}

run().catch(console.error);
