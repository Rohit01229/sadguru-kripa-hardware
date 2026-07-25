import { z } from "zod";

// Fail fast at boot if required env is missing (11-scaffolding-plan §Phase 7).
const schema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
  AUTH_SECRET: z.string().min(1),
  SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3001"),
});

export const env = schema.parse(process.env);
