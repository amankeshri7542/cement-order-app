import { z } from 'zod';

// GET /client-config: lets the shop require an app update before old installs break.
export const clientConfigSchema = z.object({
  android: z.object({
    minimumVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    latestVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    storeUrl: z.url(),
  }),
});
export type ClientConfig = z.infer<typeof clientConfigSchema>;

/** Compares "1.2.10" style versions: negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a: string, b: string) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}
