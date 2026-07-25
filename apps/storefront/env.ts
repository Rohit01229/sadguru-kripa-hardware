import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
  AUTH_SECRET: z.string().min(1),
  // Razorpay online payment is disabled for now — see checkout/page.tsx. The core
  // order/webhook code remains (dormant) so it can be re-enabled without a rebuild.
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

export const env = schema.parse(process.env);
