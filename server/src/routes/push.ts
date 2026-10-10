import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "../app.js";
import { pushSubscriptions } from "../db/schema.js";
import { type AppEnv, requireUser } from "../lib/session.js";

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(4).max(200) }),
});

export function pushRoutes({ db, config, pusher }: Deps) {
  const app = new Hono<AppEnv>();
  app.get("/key", (c) => c.json({ publicKey: pusher.publicKey }));
  app.use("/subscribe", requireUser(db, config));
  app.use("/unsubscribe", requireUser(db, config));

  app.post("/subscribe", async (c) => {
    const parsed = subscribeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid subscription" }, 400);
    const { endpoint, keys } = parsed.data;
    const userId = c.get("user").id;
    // An endpoint belongs to one device; if someone else signs in on it, it follows them.
    await db
      .insert(pushSubscriptions)
      .values({ userId, endpoint, p256dh: keys.p256dh, auth: keys.auth })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: keys.p256dh, auth: keys.auth } });
    return c.json({ status: "subscribed" });
  });

  app.post("/unsubscribe", async (c) => {
    const parsed = z.object({ endpoint: z.string().max(2000) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid request" }, 400);
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, parsed.data.endpoint), eq(pushSubscriptions.userId, c.get("user").id)));
    return c.json({ status: "unsubscribed" });
  });

  return app;
}
