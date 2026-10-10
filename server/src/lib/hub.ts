// Fan-out of live events to each signed-in officer's open sockets. Single
// server instance, so an in-memory map is enough; clients refetch over REST
// after reconnecting, so a missed event is never lost data.

export type HubEvent =
  | { type: "message"; matchId: string; message: ChatMessage }
  | { type: "read"; matchId: string; userId: string; lastReadAt: string }
  | { type: "match_ended"; matchId: string };

export interface ChatMessage {
  id: string;
  matchId: string;
  senderId: string | null;
  body: string;
  touchpointId: string | null;
  createdAt: string;
}

interface Socket {
  send(data: string): void;
}

export class Hub {
  private sockets = new Map<string, Set<Socket>>();

  add(userId: string, socket: Socket) {
    let set = this.sockets.get(userId);
    if (!set) this.sockets.set(userId, (set = new Set()));
    set.add(socket);
  }

  remove(userId: string, socket: Socket) {
    const set = this.sockets.get(userId);
    set?.delete(socket);
    if (set && set.size === 0) this.sockets.delete(userId);
  }

  publish(userIds: string[], event: HubEvent) {
    const data = JSON.stringify(event);
    for (const id of userIds) {
      for (const socket of this.sockets.get(id) ?? []) {
        try {
          socket.send(data);
        } catch {
          // Dead socket; its close handler will remove it.
        }
      }
    }
  }

  isOnline(userId: string) {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }
}
