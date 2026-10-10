import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { createApi } from "./app.js";
import { loadConfig } from "./config.js";
import { db } from "./db/client.js";
import { ConsoleMailer, ResendMailer } from "./lib/mailer.js";

const config = loadConfig();
if (config.production && !config.resendApiKey) {
  console.error("RESEND_API_KEY is not set — sign-in codes will only appear in the server log");
}
const mailer = config.resendApiKey ? new ResendMailer(config.resendApiKey, config.emailFrom) : new ConsoleMailer();

const app = new Hono();
app.use("*", logger());
app.route("/api", createApi({ db, mailer, config }));

// The built PWA (web/dist), with SPA fallback to index.html.
app.use("/*", serveStatic({ root: "../web/dist" }));
app.get("*", serveStatic({ path: "../web/dist/index.html" }));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => console.log(`listening on :${port}`));
