# WebDesk Pro

WebDesk Pro 是一个远程桌面仓库，包含：

- **Web viewer / controller**：React + WebRTC 前端，用于发起连接、查看远端画面并发送鼠标 / 键盘输入。
- **Signaling server**：Express + WebSocket 信令层，负责设备注册、连接审批、TURN 下发、会话绑定与安全校验。
- **Electron Host（正式主路径）**：独立桌面 Host，负责桌面采集与原生输入执行。
- **Node companion（兼容回退）**：`host.cjs`，用于本地实验或临时桥接原生输入。

> 仓库定位已经从“AI Studio 模板”切换为 **WebDesk Pro**。当前文档、标题、环境变量与依赖均围绕远程桌面场景整理。

## Architecture

### Primary host path

推荐生产场景使用 `electron-host/`：

1. Electron Host 连接信令服务器并注册设备。
2. Viewer 在 Web UI 中输入 Host 的 ID / Password 发起请求。
3. Signaling server 创建受控会话，校验会话双方，并下发 ICE / TURN 配置。
4. WebRTC 传输桌面画面；鼠标 / 键盘通过 DataChannel 实时送达 Electron Host。
5. 如果启用了 companion bridge，服务端也会按会话关系转发 `mouse_event` / `keyboard_event`。

### Server responsibilities

`server.ts` 现在负责：

- 设备注册与随机凭证分配。
- `keyboard_event` / `mouse_event` 的会话内转发。
- Host 请求审批与超时回收。
- Session lifecycle（创建、绑定、断开、异常清理）。
- Heartbeat / stale peer 清理。
- TURN / STUN 配置统一下发。
- 可选 `ALLOWED_ORIGINS` origin 限制。

## Local development

### Requirements

- Node.js 20+
- npm

### Install

```bash
npm install
```

### Run web app + signaling server

```bash
npm run dev
```

默认地址：

- App / signaling server: `http://localhost:3000`
- WebSocket signaling: `ws://localhost:3000/signaling`

## Electron Host

Electron Host 是正式推荐的被控端实现。

打包后默认会读取 `electron-host/config.json`（并随安装包一起带上），当前仓库已经预置为：

```json
{
  "wsUrl": "ws://192.168.221.79:3000/signaling"
}
```

也就是说，**打包后发到另一台电脑，直接双击启动就会默认连接到 `192.168.221.79`**；如果你后续要改服务器地址，优先修改 `electron-host/config.json` 再重新打包。

```bash
cd electron-host
npm install
npm start
```

可通过环境变量覆盖信令地址：

```bash
WS_URL=wss://your-domain.example/signaling npm start
```

打包命令：

```bash
cd electron-host
npm run build
```

Electron Host 的运行时地址优先级为：

1. `WS_URL` 环境变量
2. 打包产物旁边的 `config.json`
3. 安装包内携带的 `config.json`
4. 内置默认值 `ws://192.168.221.79:3000/signaling`

如果你的服务端开启了 `ALLOWED_ORIGINS`，请同时保留 `ALLOW_NATIVE_ORIGINLESS=true`；因为安装版 Electron Host 往往没有浏览器页面那样的 Origin 头，或者会以 `file://` / `null` 的形式出现。服务端还会自动放行与当前 `Host` 头一致的浏览器 Origin，因此像 `http://192.168.x.x:3000` 这种局域网地址访问也不需要额外再写一遍白名单。

更多说明见：

- `electron-host/`
- `ELECTRON_HOST_GUIDE.md`

## Legacy Node companion

如果你只是想在本机快速桥接原生输入，可以继续使用旧的 companion：

```bash
node host.cjs <HOST_ID> <HOST_PASS>
```

或：

```bash
WS_URL=wss://your-domain.example/signaling node host.cjs <HOST_ID> <HOST_PASS>
```

## Environment variables

参考 `.env.example`：

- `HOST`, `PORT`
- `ALLOWED_ORIGINS`
- `ALLOW_NATIVE_ORIGINLESS`（允许 Electron 安装版在无 Origin / `file://` 的情况下连接）
- `REQUEST_TTL_MS`
- `HEARTBEAT_INTERVAL_MS`
- `PEER_STALE_MS`
- `STUN_URLS`
- `TURN_URLS`
- `TURN_USERNAME`
- `TURN_CREDENTIAL`
- `WS_URL`（Electron Host / companion override）

## Validation

```bash
npm run lint
npm run build
```
