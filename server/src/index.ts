import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { logger } from "hono/logger";

const app = new Hono();
app.use("*", logger());

// Static, no DB — Railway's healthcheck target.
app.get("/api/health", (c) => c.json({ status: "ok" }));

app.get("/api/db-health", async (c) => {
  try {
    const { sql } = await import("./db/client.js");
    await sql`select 1`;
    return c.json({ status: "ok" });
  } catch (err) {
    console.error("db-health failed", err);
    return c.json({ error: "database unreachable" }, 503);
  }
});

app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

// The built PWA (web/dist), with SPA fallback to index.html.
app.use("/*", serveStatic({ root: "../web/dist" }));
app.get("*", serveStatic({ path: "../web/dist/index.html" }));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => console.log(`listening on :${port}`));
