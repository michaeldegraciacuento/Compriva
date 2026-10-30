import { z } from "zod";

/**
 * Public, build-time configuration. Validated once at startup so a
 * misconfigured build fails loudly instead of calling the wrong API.
 *
 * Each variable must be referenced as `process.env.NEXT_PUBLIC_X` literally:
 * Next.js only inlines direct references.
 */
const schema = z.object({
  NEXT_PUBLIC_API_URL: z
    .url()
    .transform((url) => url.replace(/\/+$/, "")),
  NEXT_PUBLIC_APP_ENV: z
    .enum(["local", "staging", "production"])
    .default("local"),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

export const env = parseEnv({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
});
