import { inArray } from "drizzle-orm";
import type { Db } from "../app.js";
import { pushSubscriptions } from "../db/schema.js";
import type { PushPayload, Pusher } from "./push.js";

/**
 * Push a notification to every device these officers registered. Payloads
 * never carry message text: they show on lock screens.
 */
export async function pushToUsers(db: Db, pusher: Pusher, userIds: string[], payload: PushPayload) {
  if (!userIds.length || !pusher.publicKey) return 0;
  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds));
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      const result = await pusher.send(s, payload);
      if (result === "sent") sent++;
      if (result === "gone") gone.push(s.id);
    }),
  );
  if (gone.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
  return sent;
}
