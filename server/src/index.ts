import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { getCookie } from "hono/cookie";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { createApi } from "./app.js";
import { loadConfig } from "./config.js";
import { db } from "./db/client.js";
import { Hub } from "./lib/hub.js";
import { ConsoleMailer, ResendMailer } from "./lib/mailer.js";
import { NoopPusher, WebPusher } from "./lib/push.js";
import { seedTouchpoints, startScheduler } from "./domain/jobs.js";
import { SESSION_COOKIE, userIdFromToken } from "./lib/session.js";

const config = loadConfig();
if (config.production && !config.resendApiKey) {
  console.error("RESEND_API_KEY is not set — sign-in codes will only appear in the server log");
}
const mailer = config.resendApiKey ? new ResendMailer(config.resendApiKey, config.emailFrom) : new ConsoleMailer();

const hub = new Hub();
const pusher =
  process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    ? new WebPusher(process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY, process.env.VAPID_SUBJECT ?? "mailto:mentorship@1stmedlisteningpost.com")
    : new NoopPusher();
if (!pusher.publicKey) console.error("VAPID keys are not set — push notifications are off");
const deps = { db, mailer, config, hub, pusher };
const app = new Hono();
const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });
app.use("/api/*", logger());
app.route("/api", createApi(deps));

// Live updates. Receive-only: messages are sent over REST, so the socket just
// tells the client something changed. Authenticated by the session cookie.
app.get(
  "/ws",
  upgradeWebSocket(async (c) => {
    const userId = await userIdFromToken(config, getCookie(c, SESSION_COOKIE));
    let socket: { send(d: string): void; close(code?: number): void } | null = null;
    return {
      onOpen(_evt, ws) {
        if (!userId) return ws.close(4401, "not signed in");
        socket = ws;
        hub.add(userId, ws);
      },
      onMessage(evt, ws) {
        if (evt.data === "ping") ws.send("pong");
      },
      onClose() {
        if (userId && socket) hub.remove(userId, socket);
      },
    };
  }),
);

// The built PWA (web/dist), with SPA fallback to index.html.
app.use("/*", serveStatic({ root: "../web/dist" }));
app.get("*", serveStatic({ path: "../web/dist/index.html" }));

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, () => console.log(`listening on :${port}`));
injectWebSocket(server);

await seedTouchpoints(deps);
if (process.env.DISABLE_SCHEDULER !== "true") startScheduler(deps);
