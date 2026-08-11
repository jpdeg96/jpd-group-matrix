import { handlers } from "@/lib/auth";

// Auth.js needs the Node.js runtime here: the credentials provider reaches
// Prisma, which cannot run on the edge.
export const runtime = "nodejs";

export const { GET, POST } = handlers;
