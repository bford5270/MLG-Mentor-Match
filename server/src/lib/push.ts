import webpush from "web-push";

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Path inside the app to open when tapped. */
  url?: string;
  /** Collapses repeat notifications for the same thing. */
  tag?: string;
}

export type PushResult = "sent" | "gone" | "failed";

export interface Pusher {
  readonly publicKey: string | null;
  send(sub: PushSubscriptionRecord, payload: PushPayload): Promise<PushResult>;
}

export class WebPusher implements Pusher {
  constructor(
    readonly publicKey: string,
    privateKey: string,
    subject: string,
  ) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  async send(sub: PushSubscriptionRecord, payload: PushPayload): Promise<PushResult> {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 24 * 60 * 60 },
      );
      return "sent";
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return "gone";
      console.error("push failed", status, (err as Error).message);
      return "failed";
    }
  }
}

/** Used when VAPID keys aren't configured. */
export class NoopPusher implements Pusher {
  readonly publicKey = null;
  async send(): Promise<PushResult> {
    return "failed";
  }
}

/** Test helper. */
export class MemoryPusher implements Pusher {
  readonly publicKey = "test-public-key";
  sent: { endpoint: string; payload: PushPayload }[] = [];
  gone = new Set<string>();
  async send(sub: PushSubscriptionRecord, payload: PushPayload): Promise<PushResult> {
    if (this.gone.has(sub.endpoint)) return "gone";
    this.sent.push({ endpoint: sub.endpoint, payload });
    return "sent";
  }
}
