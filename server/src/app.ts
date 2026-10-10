import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Hono } from "hono";
import type { Config } from "./config.js";
import type * as schema from "./db/schema.js";
import type { Hub } from "./lib/hub.js";
import type { Mailer } from "./lib/mailer.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";
import { matchingRoutes } from "./routes/matching.js";
import { meRoutes } from "./routes/me.js";

export type Db = PostgresJsDatabase<typeof schema>;
export interface Deps {
  db: Db;
  mailer: Mailer;
  config: Config;
  hub: Hub;
}

/** The API, without static hosting or a listener — so tests can drive it directly. */
export function createApi(deps: Deps) {
  const api = new Hono();

  // Static, no DB — Railway's healthcheck target.
  api.get("/health", (c) => c.json({ status: "ok" }));
  api.get("/db-health", async (c) => {
    try {
      await deps.db.execute(sql`select 1`);
      return c.json({ status: "ok" });
    } catch (err) {
      console.error("db-health failed", err);
      return c.json({ error: "database unreachable" }, 503);
    }
  });

  // State-changing requests must be JSON: browsers can't send that cross-site
  // without a CORS preflight, which this API never grants.
  api.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      if (!c.req.header("content-type")?.startsWith("application/json")) {
        return c.json({ error: "expected application/json" }, 415);
      }
    }
    await next();
  });

  api.route("/auth", authRoutes(deps));
  api.route("/admin", adminRoutes(deps));
  api.route("/matching", matchingRoutes(deps));
  api.route("/chat", chatRoutes(deps));
  api.route("/", meRoutes(deps));
  api.all("*", (c) => c.json({ error: "not found" }, 404));
  return api;
}
