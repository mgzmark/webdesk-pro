# WebDesk Pro

WebDesk Pro 是一个基于 **React + Vite + Express + WebSocket + WebRTC** 的远程桌面原型项目，目标是通过浏览器完成屏幕共享、远程查看，以及在宿主机侧执行真实的鼠标/键盘控制。

项目当前同时提供两种宿主端形态：

- **浏览器 Host + 本地 Node Companion (`host.cjs`)**：适合本地开发和快速验证。
- **Electron Host (`electron-host/`)**：适合将“屏幕采集 + 输入注入”封装成桌面端独立宿主程序。

---

## 核心能力

- 自动分配 9 位设备 ID 和 6 位连接密码。
- 通过 WebSocket 信令建立浏览器间的 WebRTC P2P 屏幕连接。
- Host 端收到连接请求后手动确认，随后发起屏幕共享。
- Viewer 端支持远程鼠标移动、点击、按下/抬起、键盘事件发送。
- 页面内提供虚拟红点光标，便于确认远端输入是否送达。
- 可选使用 `host.cjs` 将网页中的相对坐标映射到本机真实鼠标键盘。
- 提供 Electron 宿主端，直接在桌面程序中采集主屏幕并执行输入控制。

> 当前仓库更适合作为 **远程控制原型 / Demo / 二次开发基础**，而不是生产级远控产品。

---

## 仓库结构

```text
.
├─ src/
│  ├─ App.tsx                     # 主界面：仪表盘、连接、会话、远程视频与输入捕获
│  ├─ store.ts                    # Zustand 全局状态
│  └─ lib/RemoteDesktopClient.ts  # WebSocket 信令、WebRTC、数据通道与输入转发
├─ server.ts                      # Express + Vite + WebSocket 信令服务
├─ host.cjs                       # Node.js 本地输入宿主，执行真实鼠标/键盘控制
├─ electron-host/                 # Electron 版本宿主端
├─ .env.example                   # 环境变量示例
└─ README.md
```

---

## 技术架构

### 1. 前端控制台
前端使用 React 19 + Zustand 构建，负责：

- 展示当前设备 ID / Password。
- 发起远程连接。
- 处理来电确认。
- 渲染远程视频流。
- 捕获 Viewer 的鼠标与键盘事件。
- 通过 WebRTC DataChannel 与 WebSocket 双路发送控制事件。

### 2. 信令服务
`server.ts` 启动 Express 服务，并挂载 `/signaling` WebSocket 服务，用于：

- 为每个连接设备分配唯一 ID 与密码。
- 转发 `request_control / accept_control / reject_control` 控制消息。
- 转发 WebRTC `offer / answer / candidate`。
- 将 `mouse_event / keyboard_event` 转发给宿主网页与本地 companion。
- 在开发模式下复用 Vite 中间件提供前端页面。

### 3. WebRTC 媒体链路
媒体链路由 Host 端共享屏幕，Viewer 端接收视频轨道：

- **浏览器 Host 模式**：调用 `navigator.mediaDevices.getDisplayMedia()`。
- **Electron Host 模式**：通过 `desktopCapturer` + `getUserMedia()` 获取桌面流。

### 4. 本地输入执行
真实输入执行有两条路径：

- `host.cjs`：通过 `@nut-tree-fork/nut-js` 执行本机鼠标/键盘事件。
- `electron-host/`：通过 Electron 主进程调用 `nut-js`，由渲染进程接收远程事件后转发到 IPC。

---

## 运行方式

### 环境要求

- Node.js 18+（建议 LTS）
- npm
- 支持 WebRTC 与屏幕共享的现代浏览器
- 若需要真实输入控制：
  - 允许本机执行鼠标/键盘注入
  - 安装 `@nut-tree-fork/nut-js` 相关依赖
  - 某些系统下可能需要额外辅助权限（尤其 macOS）

### 安装依赖

在仓库根目录执行：

```bash
npm install
```

如果你还要单独运行 Electron Host：

```bash
cd electron-host
npm install
```

---

## 本地开发

### 启动 Web 应用 + 信令服务

```bash
npm run dev
```

默认会在 `http://localhost:3000` 提供：

- React 前端界面
- `/signaling` WebSocket 信令服务

### 生产构建

```bash
npm run build
```

### 预览静态构建

```bash
npm run preview
```

### TypeScript 检查

```bash
npm run lint
```

---

## 使用说明

### 方案 A：纯浏览器体验（仅演示共享 + 虚拟光标）

1. 启动项目：
   ```bash
   npm run dev
   ```
2. 在 Host 设备打开页面，记录系统分配的 **Your ID** 和 **Password**。
3. 在 Viewer 设备打开同一服务地址。
4. 输入 Host 的 ID 和密码并点击 **Connect**。
5. Host 侧会弹出 **Incoming Connection** 确认框。
6. Host 点击 **Accept & Share**，选择要共享的屏幕或窗口。
7. Viewer 进入远程查看界面，可发送鼠标与键盘事件。

> 此模式下即使未运行 `host.cjs`，你仍能看到页面内的虚拟红点反馈，但不一定会真正控制宿主机系统鼠标。

### 方案 B：浏览器 Host + `host.cjs` 真正控制本机

1. 启动服务：
   ```bash
   npm run dev
   ```
2. 在 Host 浏览器中拿到 `Your ID` 与 `Password`。
3. 新开终端，在仓库根目录执行：
   ```bash
   node host.cjs <9位数字ID> <6位密码>
   ```
4. 若服务部署在远端地址，可通过环境变量指定信令地址：
   ```bash
   WS_URL=wss://your-domain/signaling node host.cjs <9位数字ID> <6位密码>
   ```
5. 当 Viewer 发起连接并被 Host 接受后，`host.cjs` 会接收相对坐标与键盘事件，并通过 `nut-js` 映射为真实系统输入。

### 方案 C：Electron Host

1. 先确保信令服务可访问。
2. 修改 `electron-host/renderer.js` 中的 `WS_URL`，指向你的信令服务地址。
3. 启动 Electron Host：
   ```bash
   cd electron-host
   npm start
   ```
4. Electron 窗口会显示设备 ID 与连接密码。
5. Viewer 端输入该 ID / Password 后，即可发起连接。
6. Electron Host 会自动接受连接并共享主屏幕，同时执行远程输入。

---

## 环境变量

根目录 `.env.example` 中包含以下变量：

| 变量名 | 说明 |
| --- | --- |
| `GEMINI_API_KEY` | 预留给 Gemini API 调用；当前核心远程桌面链路并未直接依赖它。 |
| `APP_URL` | 预留应用部署地址；可用于云端场景中的自引用地址配置。 |

此外，`host.cjs` 支持：

| 变量名 | 说明 |
| --- | --- |
| `WS_URL` | 覆盖默认信令地址，默认值为 `ws://localhost:3000/signaling`。 |

---

## 关键脚本

### 根目录脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 使用 `tsx server.ts` 启动开发服务（包含前端与信令）。 |
| `npm run start` | 使用 Node 运行 `server.ts`。 |
| `npm run build` | 执行 Vite 生产构建。 |
| `npm run preview` | 本地预览构建产物。 |
| `npm run clean` | 清理 `dist`。 |
| `npm run lint` | 执行 `tsc --noEmit` 类型检查。 |

### Electron Host 脚本

| 命令 | 作用 |
| --- | --- |
| `cd electron-host && npm start` | 启动 Electron 宿主程序。 |
| `cd electron-host && npm run build` | 使用 `electron-builder` 打包桌面端应用。 |

---

## 代码阅读指引

如果你准备继续开发，建议按下面顺序阅读：

1. **`server.ts`**：理解设备注册、密码校验、事件转发、WebRTC 信令。
2. **`src/lib/RemoteDesktopClient.ts`**：理解浏览器侧连接管理、P2P 协商、输入发送。
3. **`src/App.tsx`**：理解 UI 状态机、共享/连接流程、远程视频事件捕获。
4. **`host.cjs`**：理解如何把相对坐标转换为本机绝对坐标，并驱动真实输入。
5. **`electron-host/`**：了解桌面宿主版实现方式及其与 Web 版本的差异。

---

## 当前实现特点与限制

### 已具备

- 基础信令与连接配对
- Host 侧屏幕共享
- Viewer 侧远程视频显示
- 鼠标与键盘事件传递
- 本地 Node / Electron 宿主执行真实输入
- 对拖拽、鼠标抬起丢失、mDNS ICE 候选等问题做了部分兼容处理

### 仍待完善

- 缺少鉴权、审计、设备管理等生产级安全机制
- 默认使用内存态 `Map` 存储连接信息，不适合多实例部署
- 无 TURN 中继，跨复杂网络环境下的 WebRTC 成功率有限
- Electron `renderer.js` 中的 `WS_URL` 仍为硬编码地址，需手动调整
- 移动端浏览器通常不支持完整屏幕共享或输入控制体验
- 对不同操作系统的输入权限、缩放、多显示器映射尚未全面处理

---

## 后续可优化方向

- 引入 TURN / ICE 配置中心，提高跨网络连接成功率。
- 将设备注册、会话状态迁移到 Redis / 数据库。
- 增加登录认证、一次性邀请码、会话过期等安全机制。
- 为 `electron-host` 增加配置面板，而不是硬编码 `WS_URL`。
- 补充截图压缩、分辨率自适应、音频共享等功能。
- 增加更完善的快捷键映射、输入法兼容、多屏选择能力。
- 将 `host.cjs` 与前端配置统一为更友好的安装/启动流程。

---

## 常见问题

### 1. Viewer 已连接，但 Host 无法共享屏幕
请优先检查：

- 浏览器是否支持 `getDisplayMedia`
- 是否在 iframe 中打开页面
- 是否被浏览器/系统拒绝屏幕共享权限
- 是否在移动设备浏览器中访问

### 2. 能看到画面，但无法真正操作宿主机鼠标
这通常说明：

- 你只运行了网页 Host，没有运行 `host.cjs`
- 或 Electron Host 未正确接收输入事件
- 或当前系统未授予 `nut-js` 所需权限

### 3. Electron Host 无法连接
请确认：

- `electron-host/renderer.js` 中的 `WS_URL` 是否配置正确
- 信令服务地址是否可从宿主机访问
- 防火墙是否允许对应端口与 WebSocket 连接

---

## 许可证

仓库中暂未看到明确的 License 文件；如果你计划公开分发或商用，请先补充许可证声明。
