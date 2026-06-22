/**
 * Live-Benachrichtigung an einen einzelnen User bei Freundschafts-Ereignissen.
 *
 * Wir hängen am selben Socket.IO-Server wie alle Gateways (gleicher
 * `path: "/ws"`) und emitten in den persönlichen Raum `lobby:user:<id>`, den
 * der `LobbyGateway` beim Connect joint. Dadurch braucht es kein
 * Modul-Coupling zwischen `users` und `lobby` — exakt das Muster von
 * `ChatGateway.notifyDmReceived`.
 *
 * Das Frontend (`UserEventToasts` im Root) hört auf diese Events, zeigt einen
 * Toast und frischt die `["friends"]`-Queries auf, damit Freunde-Tab und
 * Kontextmenü ohne Reload den neuen Stand zeigen.
 */
import { Injectable } from "@nestjs/common";
import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server } from "socket.io";

export interface FriendEventPayload {
  /** User, der die Anfrage gesendet bzw. angenommen hat. */
  fromId: string;
  fromName: string;
}

@Injectable()
@WebSocketGateway({
  path: "/ws",
  cors: { origin: true, credentials: true },
})
export class FriendsGateway {
  @WebSocketServer()
  server!: Server;

  /** „X möchte mit dir befreundet sein" — an den Empfänger der Anfrage. */
  notifyRequestReceived(recipientId: string, payload: FriendEventPayload): void {
    this.server.to(`lobby:user:${recipientId}`).emit("friend:request-received", payload);
  }

  /** „X hat deine Anfrage angenommen" — an den ursprünglichen Anfrager. */
  notifyRequestAccepted(requesterId: string, payload: FriendEventPayload): void {
    this.server.to(`lobby:user:${requesterId}`).emit("friend:request-accepted", payload);
  }
}
