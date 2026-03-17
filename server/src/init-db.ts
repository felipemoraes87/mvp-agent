import type { PrismaClient } from "@prisma/client";

export async function ensureSchema(prisma: PrismaClient): Promise<void> {
  void prisma;
  return;
}
