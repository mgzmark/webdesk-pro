import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocket, WebSocketServer } from "ws";

type ClientKind = "browser" | "electron_host" | "companion";

interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

interface Peer {
  ws: WebSocket;
  id: string;
  pass: string;
  kind: ClientKind;
  lastSeenAt: number;
  activeSessionId: string | null;
  partnerId: string | null;
  pendingRequestFrom: string | null;
  companionWs?: WebSocket;
  boundHostId?: string;
}

interface Session {
  id: string;
  controllerId: string;
  hostId: string;
  createdAt: number;
  lastActivityAt: number;
}

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 3000);
const REQUEST_TTL_MS = Number(process.env.REQUEST_TTL_MS ?? 30_000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 15_000);
const PEER_STALE_MS = Number(process.env.PEER_STALE_MS ?? 45_000);
const STRICT_ORIGIN_CHECK = process.env.STRICT_ORIGIN_CHECK === "true";
const ALLOW_NATIVE_ORIGINLESS = process.env.ALLOW_NATIVE_ORIGINLESS !== "false";
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const peers = new Map<string, Peer>();
const sessions = new Map<string, Session>();
const wsToPeerId = new Map<WebSocket, string>();

function now() {
  return Date.now();
}

function randomDigits(length: number) {
  const min = 10 ** (length - 1);
  const max = (10 ** length) - 1;
  return crypto.randomInt(min, max).toString();
}

function generateId() {
  let id = randomDigits(9);
  while (peers.has(id)) {
    id = randomDigits(9);
  }
  return id;
}

function generatePass() {
  return crypto.randomBytes(6).toString("base64url").slice(0, 8);
}

function generateSessionId() {
  return crypto.randomBytes(12).toString("hex");
}

function parseCsv(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildIceServers(): IceServerConfig[] {
  const defaults = parseCsv(process.env.STUN_URLS);
  const stunUrls = defaults.length > 0 ? defaults : [
    "stun:stun.l.google.com:19302",
    "stun:global.stun.twilio.com:3478",
  ];

  const iceServers: IceServerConfig[] = [{ urls: stunUrls }];
  const turnUrls = parseCsv(process.env.TURN_URLS);
  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_CREDENTIAL;

  if (turnUrls.length > 0 && username && credential) {
    iceServers.push({
      urls: turnUrls,
      username,
      credential,
    });
  }

  return iceServers;
}

const ICE_SERVERS = buildIceServers();

function isAllowedOrigin(originHeader?: string, requestHost?: string) {
  if (!STRICT_ORIGIN_CHECK || ALLOWED_ORIGINS.size === 0) {
    return true;
  }

  if (!originHeader) {
    return ALLOW_NATIVE_ORIGINLESS;
  }

  if (originHeader === "null" || originHeader.startsWith("file://")) {
    return true;
  }

  if (requestHost) {
    try {
      const originUrl = new URL(originHeader);
      if (originUrl.host === requestHost) {
        return true;
      }
    } catch {
      // ignore malformed origin, fall back to explicit allowlist check
    }
  }

  return ALLOWED_ORIGINS.has(originHeader);
}

function safeSend(ws: WebSocket | undefined, payload: unknown) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(JSON.stringify(payload));
}

function getPeerByWs(ws: WebSocket) {
  const peerId = wsToPeerId.get(ws);
  return peerId ? peers.get(peerId) ?? null : null;
}

function validateTargetPeer(sender: Peer, targetId: unknown) {
  if (typeof targetId !== "string" || !targetId) {
    safeSend(sender.ws, { type: "error", message: "Missing targetId." });
    return null;
  }

  const targetPeer = peers.get(targetId);
  if (!targetPeer) {
    safeSend(sender.ws, { type: "error", message: "Target device is offline." });
    return null;
  }

  return targetPeer;
}

function clearPendingRequestsForController(controllerId: string) {
  for (const peer of peers.values()) {
    if (peer.pendingRequestFrom === controllerId) {
      peer.pendingRequestFrom = null;
    }
  }
}

function clearCompanionBinding(peer: Peer) {
  if (peer.boundHostId) {
    const host = peers.get(peer.boundHostId);
    if (host?.companionWs === peer.ws) {
      host.companionWs = undefined;
    }
    peer.boundHostId = undefined;
  }
}

function tearDownSession(sessionId: string, reason = "Session ended.", initiatorId?: string) {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  sessions.delete(sessionId);
  const controller = peers.get(session.controllerId);
  const host = peers.get(session.hostId);

  for (const peer of [controller, host]) {
    if (!peer) continue;
    peer.activeSessionId = null;
    peer.partnerId = null;
    if (peer.pendingRequestFrom === (peer.id === session.hostId ? session.controllerId : null)) {
      peer.pendingRequestFrom = null;
    }
  }

  if (controller && controller.id !== initiatorId) {
    safeSend(controller.ws, { type: "session_closed", message: reason });
  }

  if (host && host.id !== initiatorId) {
    safeSend(host.ws, { type: "session_closed", message: reason });
  }
}

function refreshSession(sessionId: string | null) {
  if (!sessionId) return;
  const session = sessions.get(sessionId);
  if (!session) return;
  session.lastActivityAt = now();
}

function ensureActiveSession(sender: Peer, targetPeer: Peer) {
  if (!sender.activeSessionId || !targetPeer.activeSessionId) {
    safeSend(sender.ws, { type: "error", message: "No active session for this action." });
    return null;
  }

  if (sender.activeSessionId !== targetPeer.activeSessionId || sender.partnerId !== targetPeer.id) {
    safeSend(sender.ws, { type: "error", message: "Unauthorized cross-session message." });
    return null;
  }

  const session = sessions.get(sender.activeSessionId);
  if (!session) {
    safeSend(sender.ws, { type: "error", message: "Session not found." });
    sender.activeSessionId = null;
    sender.partnerId = null;
    targetPeer.activeSessionId = null;
    targetPeer.partnerId = null;
    return null;
  }

  session.lastActivityAt = now();
  return session;
}

function registerPeer(ws: WebSocket, kind: ClientKind = "browser") {
  const peer: Peer = {
    ws,
    id: generateId(),
    pass: generatePass(),
    kind,
    lastSeenAt: now(),
    activeSessionId: null,
    partnerId: null,
    pendingRequestFrom: null,
  };

  peers.set(peer.id, peer);
  wsToPeerId.set(ws, peer.id);
  safeSend(ws, {
    type: "registered",
    id: peer.id,
    pass: peer.pass,
    clientKind: kind,
    recommendedHost: "electron_host",
    iceServers: ICE_SERVERS,
  });
}

function handleRequestControl(sender: Peer, payload: Record<string, unknown>) {
  const targetPeer = validateTargetPeer(sender, payload.targetId);
  if (!targetPeer) return;

  if (typeof payload.password !== "string" || payload.password !== targetPeer.pass) {
    safeSend(sender.ws, { type: "error", message: "Invalid ID or password." });
    return;
  }

  if (sender.activeSessionId || targetPeer.activeSessionId) {
    safeSend(sender.ws, { type: "error", message: "One of the devices is already in an active session." });
    return;
  }

  if (targetPeer.pendingRequestFrom) {
    safeSend(sender.ws, { type: "error", message: "The host already has a pending request." });
    return;
  }

  targetPeer.pendingRequestFrom = sender.id;
  safeSend(targetPeer.ws, {
    type: "incoming_connection",
    fromId: sender.id,
    requestedAt: new Date().toISOString(),
    requestExpiresInMs: REQUEST_TTL_MS,
  });

  setTimeout(() => {
    const refreshedTarget = peers.get(targetPeer.id);
    if (refreshedTarget?.pendingRequestFrom === sender.id) {
      refreshedTarget.pendingRequestFrom = null;
      safeSend(sender.ws, { type: "control_rejected", message: "Connection request timed out." });
    }
  }, REQUEST_TTL_MS);
}

function handleAcceptControl(sender: Peer, payload: Record<string, unknown>) {
  if (typeof payload.toId !== "string" || !payload.toId) {
    safeSend(sender.ws, { type: "error", message: "Missing controller id." });
    return;
  }

  const controller = peers.get(payload.toId);
  if (!controller) {
    safeSend(sender.ws, { type: "error", message: "Controller is offline." });
    sender.pendingRequestFrom = null;
    return;
  }

  if (sender.pendingRequestFrom !== controller.id) {
    safeSend(sender.ws, { type: "error", message: "No matching pending request." });
    return;
  }

  if (sender.activeSessionId || controller.activeSessionId) {
    safeSend(sender.ws, { type: "error", message: "Session already active." });
    sender.pendingRequestFrom = null;
    return;
  }

  const sessionId = generateSessionId();
  const session: Session = {
    id: sessionId,
    controllerId: controller.id,
    hostId: sender.id,
    createdAt: now(),
    lastActivityAt: now(),
  };

  sessions.set(sessionId, session);
  sender.pendingRequestFrom = null;
  sender.activeSessionId = sessionId;
  sender.partnerId = controller.id;
  controller.activeSessionId = sessionId;
  controller.partnerId = sender.id;

  safeSend(controller.ws, {
    type: "control_accepted",
    fromId: sender.id,
    sessionId,
    iceServers: ICE_SERVERS,
    hostKind: sender.kind,
  });

  safeSend(sender.ws, {
    type: "session_started",
    sessionId,
    partnerId: controller.id,
  });
}

function handleRejectControl(sender: Peer, payload: Record<string, unknown>) {
  if (typeof payload.toId !== "string" || !payload.toId) {
    safeSend(sender.ws, { type: "error", message: "Missing controller id." });
    return;
  }

  const controller = peers.get(payload.toId);
  if (!controller) {
    sender.pendingRequestFrom = null;
    return;
  }

  if (sender.pendingRequestFrom && sender.pendingRequestFrom !== controller.id) {
    safeSend(sender.ws, { type: "error", message: "No matching pending request." });
    return;
  }

  sender.pendingRequestFrom = null;
  safeSend(controller.ws, {
    type: "control_rejected",
    message: typeof payload.message === "string" ? payload.message : "Connection was rejected by the host.",
  });
}

function handleBindDevice(sender: Peer, payload: Record<string, unknown>) {
  if (typeof payload.hostId !== "string" || typeof payload.password !== "string") {
    safeSend(sender.ws, { type: "error", message: "Invalid host binding payload." });
    return;
  }

  const hostPeer = peers.get(payload.hostId);
  if (!hostPeer || hostPeer.pass !== payload.password) {
    safeSend(sender.ws, { type: "error", message: "Invalid host ID or password." });
    return;
  }

  if (hostPeer.companionWs && hostPeer.companionWs !== sender.ws) {
    safeSend(hostPeer.companionWs, { type: "session_closed", message: "A new companion replaced this connection." });
    hostPeer.companionWs.close();
  }

  sender.kind = "companion";
  sender.boundHostId = hostPeer.id;
  hostPeer.companionWs = sender.ws;

  safeSend(sender.ws, {
    type: "bound",
    hostId: hostPeer.id,
    message: "Successfully bound to host.",
  });
}

function relaySignalMessage(
  sender: Peer,
  targetPeer: Peer,
  payload: Record<string, unknown>,
  type: "offer" | "answer" | "candidate",
) {
  if (!ensureActiveSession(sender, targetPeer)) {
    return;
  }

  safeSend(targetPeer.ws, {
    ...payload,
    type,
    fromId: sender.id,
    sessionId: sender.activeSessionId,
  });
}

function relayInputMessage(
  sender: Peer,
  targetPeer: Peer,
  payload: Record<string, unknown>,
  type: "mouse_event" | "keyboard_event",
) {
  if (!ensureActiveSession(sender, targetPeer)) {
    return;
  }

  if (!targetPeer.companionWs || targetPeer.companionWs.readyState !== WebSocket.OPEN) {
    return;
  }

  safeSend(targetPeer.companionWs, {
    ...payload,
    type,
    fromId: sender.id,
    sessionId: sender.activeSessionId,
  });
}

function cleanupPeer(peer: Peer, reason = "Peer disconnected.") {
  clearCompanionBinding(peer);
  clearPendingRequestsForController(peer.id);

  if (peer.pendingRequestFrom) {
    const controller = peers.get(peer.pendingRequestFrom);
    safeSend(controller?.ws, {
      type: "control_rejected",
      message: "Host disconnected before the request was accepted.",
    });
    peer.pendingRequestFrom = null;
  }

  if (peer.activeSessionId) {
    tearDownSession(peer.activeSessionId, reason, peer.id);
  }

  peers.delete(peer.id);
  wsToPeerId.delete(peer.ws);
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  const wss = new WebSocketServer({
    server,
    path: "/signaling",
    maxPayload: 128 * 1024,
    perMessageDeflate: false,
  });

  wss.on("connection", (ws, req) => {
    if (!isAllowedOrigin(req.headers.origin, req.headers.host)) {
      console.warn("Rejected signaling connection due to origin:", req.headers.origin);
      safeSend(ws, { type: "error", message: "Origin is not allowed." });
      ws.close(1008, "Origin not allowed");
      return;
    }

    registerPeer(ws, "browser");

    ws.on("pong", () => {
      const peer = getPeerByWs(ws);
      if (peer) {
        peer.lastSeenAt = now();
      }
    });

    ws.on("message", (message) => {
      const peer = getPeerByWs(ws);
      if (!peer) {
        return;
      }

      peer.lastSeenAt = now();
      let payload: Record<string, unknown>;

      try {
        payload = JSON.parse(message.toString());
      } catch (error) {
        console.error("Invalid WS payload:", error);
        safeSend(ws, { type: "error", message: "Invalid JSON payload." });
        return;
      }

      if (!payload || typeof payload.type !== "string") {
        safeSend(ws, { type: "error", message: "Missing message type." });
        return;
      }

      switch (payload.type) {
        case "hello":
          if (payload.clientKind === "electron_host" || payload.clientKind === "browser") {
            peer.kind = payload.clientKind;
            safeSend(ws, {
              type: "hello_ack",
              clientKind: peer.kind,
              recommendedHost: "electron_host",
              iceServers: ICE_SERVERS,
            });
          }
          break;
        case "request_control":
          handleRequestControl(peer, payload);
          break;
        case "accept_control":
          handleAcceptControl(peer, payload);
          break;
        case "reject_control":
          handleRejectControl(peer, payload);
          break;
        case "bind_device":
          handleBindDevice(peer, payload);
          break;
        case "offer":
        case "answer":
        case "candidate": {
          const targetPeer = validateTargetPeer(peer, payload.targetId);
          if (!targetPeer) return;
          relaySignalMessage(peer, targetPeer, payload, payload.type);
          break;
        }
        case "mouse_event":
        case "keyboard_event": {
          const targetPeer = validateTargetPeer(peer, payload.targetId);
          if (!targetPeer) return;
          relayInputMessage(peer, targetPeer, payload, payload.type);
          break;
        }
        case "end_session":
          if (peer.activeSessionId) {
            tearDownSession(peer.activeSessionId, "Session ended by peer.", peer.id);
          }
          break;
        default:
          safeSend(ws, { type: "error", message: `Unsupported message type: ${payload.type}` });
      }

      refreshSession(peer.activeSessionId);
    });

    ws.on("close", () => {
      const peer = getPeerByWs(ws);
      if (peer) {
        cleanupPeer(peer);
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const peer of peers.values()) {
      if (now() - peer.lastSeenAt > PEER_STALE_MS) {
        peer.ws.terminate();
        cleanupPeer(peer, "Peer heartbeat timed out.");
        continue;
      }

      if (peer.ws.readyState === WebSocket.OPEN) {
        peer.ws.ping();
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("close", () => {
    clearInterval(heartbeat);
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, HOST, () => {
    console.log(`WebDesk Pro signaling server listening on http://${HOST}:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
