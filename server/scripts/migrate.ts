import { PrismaClient } from "@prisma/client";
import { ensureSchema } from "../src/init-db.js";

const prisma = new PrismaClient();

async function main() {
  await ensureSchema(prisma);
  console.log("Schema initialized (SQLite)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
