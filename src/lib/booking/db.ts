import type { PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/prisma"

/** Keep the existing RLS/transaction proxy, with generated model types at this boundary. */
export const bookingDb = prisma as PrismaClient
