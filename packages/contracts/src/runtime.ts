import { z } from "zod";

export const healthResponseSchema = z
  .object({
    contractVersion: z.union([z.literal(0), z.literal(1)]),
    status: z.literal("ok"),
  })
  .strict();

export type HealthResponse = z.infer<typeof healthResponseSchema>;
