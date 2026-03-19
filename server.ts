import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import path from "path";

// 定义连接的设备类型
interface Peer {
  ws: WebSocket;
  id: string;
  pass: string;
  companionWs?: WebSocket; // 用于绑定本地 Node.js 脚本以执行真实的鼠标控制
}

const peers = new Map<string, Peer>();

// 生成 9 位数字 ID
function generateId() {
  return Math.floor(100000000 + Math.random() * 900000000).toString();
}

// 生成 6 位随机密码
function generatePass() {
  return Math.random().toString(36).slice(-6);
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  const server = http.createServer(app);
  
  // 初始化 WebSocket 服务器
  const wss = new WebSocketServer({ server, path: "/signaling" });

  wss.on("connection", (ws) => {
    // 1. 设备连接时，分配唯一的 ID 和密码
    let id = generateId();
    while (peers.has(id)) id = generateId();
    const pass = generatePass();

    const peer: Peer = { ws, id, pass };
    peers.set(id, peer);

    // 发送注册信息给客户端
    ws.send(JSON.stringify({ type: "registered", id, pass }));

    // 2. 处理客户端发来的信令消息
    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        const targetPeer = peers.get(data.targetId);

        switch (data.type) {
          case "request_control":
            // 控制端请求连接被控端，验证密码
            if (targetPeer && targetPeer.pass === data.password) {
              targetPeer.ws.send(JSON.stringify({
                type: "incoming_connection",
                fromId: id
              }));
            } else {
              ws.send(JSON.stringify({ type: "error", message: "Invalid ID or Password" }));
            }
            break;
            
          case "accept_control":
            // 被控端同意连接，通知控制端
            const controller = peers.get(data.toId);
            if (controller) {
              controller.ws.send(JSON.stringify({ type: "control_accepted", fromId: id }));
            }
            break;
            
          case "reject_control":
            // 被控端拒绝连接或失败
            const rejectedController = peers.get(data.toId);
            if (rejectedController) {
              rejectedController.ws.send(JSON.stringify({ type: "control_rejected", message: data.message }));
            }
            break;

          case "bind_device":
            // 允许本地 Node.js 脚本绑定到同一个 ID 接收鼠标事件
            const hostPeer = peers.get(data.hostId);
            if (hostPeer && hostPeer.pass === data.password) {
              hostPeer.companionWs = ws;
              ws.send(JSON.stringify({ type: "bound", message: "Successfully bound to host" }));
            } else {
              ws.send(JSON.stringify({ type: "error", message: "Invalid Host ID or Password" }));
            }
            break;

          case "mouse_event":
            // 将鼠标事件转发给绑定的本地 Node.js 脚本
            if (targetPeer && targetPeer.companionWs) {
              targetPeer.companionWs.send(JSON.stringify({
                ...data,
                fromId: id
              }));
            }
            break;

          // WebRTC 核心信令转发 (Offer, Answer, ICE Candidates)
          case "offer":
          case "answer":
          case "candidate":
            if (targetPeer) {
              targetPeer.ws.send(JSON.stringify({
                ...data,
                fromId: id
              }));
            }
            break;
        }
      } catch (e) {
        console.error("WS message error:", e);
      }
    });

    // 3. 设备断开连接时清理
    ws.on("close", () => {
      peers.delete(id);
    });
  });

  // Vite 中间件 (用于开发环境的热更新和静态资源服务)
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Signaling Server running on http://localhost:${PORT}`);
  });
}

startServer();
