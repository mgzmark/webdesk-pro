# WebDesk Pro - Electron 桌面被控端开发指南

这份文档将指导你如何基于现有的技术栈，开发一个**完全独立、不依赖浏览器、带有图形界面（GUI）的桌面端被控端（Host）**。

我们将使用 **Electron**，它允许我们用前端技术写界面，同时拥有 Node.js 的底层系统控制能力。

## 1. 架构设计

在 Electron 中，应用分为两个核心部分：
1. **主进程 (Main Process)**: 运行在 Node.js 环境中。负责创建桌面窗口、系统托盘，以及**调用 `@nut-tree-fork/nut-js` 来真正控制鼠标和键盘**。
2. **渲染进程 (Renderer Process)**: 运行在 Chromium 环境中（也就是你的 UI 界面）。负责显示 ID 和密码、**捕获屏幕画面 (WebRTC)**、以及通过 WebSocket 与云端信令服务器通信。

这两者之间通过 **IPC (进程间通信)** 进行数据交换。例如：渲染进程通过 WebRTC 收到远端的鼠标移动指令后，通过 IPC 发送给主进程，主进程再调用 `nut.js` 移动真实的鼠标。

---

## 2. 本地项目搭建步骤

请在你的本地电脑上，按照以下步骤创建一个新的 Electron 项目：

### 第一步：初始化项目
打开终端（命令行），创建一个新文件夹并初始化：
```bash
mkdir webdesk-host-electron
cd webdesk-host-electron
npm init -y
```

### 第二步：安装依赖
我们需要安装 Electron 本身，打包工具，以及控制鼠标的库：
```bash
# 安装运行依赖
npm install ws @nut-tree-fork/nut-js

# 安装开发和打包依赖
npm install electron electron-builder -D
```

### 第三步：修改 `package.json`
在 `package.json` 中，修改 `main` 入口，并添加启动和打包脚本：
```json
{
  "name": "webdesk-host",
  "version": "1.0.0",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder"
  },
  "build": {
    "appId": "com.webdesk.host",
    "win": {
      "target": "nsis"
    }
  }
}
```

---

## 3. 核心代码实现

在项目根目录下创建以下 4 个文件：

### 文件 1: `main.js` (主进程)
负责创建窗口，并监听渲染进程发来的鼠标控制指令。
```javascript
const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const { mouse, Point } = require('@nut-tree-fork/nut-js');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  // 处理获取屏幕源的请求 (Electron 专属的屏幕共享方式)
  ipcMain.handle('get-desktop-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources[0]; // 默认获取主屏幕
  });

  // 监听渲染进程发来的鼠标控制指令
  ipcMain.on('mouse-move', async (event, { x, y, width, height }) => {
    // 将相对坐标转换为绝对坐标
    // 注意：这里需要根据实际屏幕分辨率进行映射，这里仅作演示
    const targetX = x * 1920; 
    const targetY = y * 1080;
    await mouse.setPosition(new Point(targetX, targetY));
  });

  ipcMain.on('mouse-click', async () => {
    // 模拟鼠标左键点击 (需要引入 nut-js 的 Button)
    // await mouse.leftClick();
    console.log("执行了真实的鼠标点击");
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

### 文件 2: `preload.js` (预加载脚本)
作为主进程和渲染进程之间的安全桥梁。
```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  moveMouse: (data) => ipcRenderer.send('mouse-move', data),
  clickMouse: () => ipcRenderer.send('mouse-click')
});
```

### 文件 3: `index.html` (UI 界面)
简单的桌面端界面。
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>WebDesk Host</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #18181b; color: white; padding: 20px; text-align: center; }
    .card { background: #27272a; padding: 20px; border-radius: 10px; margin-top: 20px; }
    .id-text { font-size: 32px; color: #818cf8; font-family: monospace; letter-spacing: 2px; }
    .status { margin-top: 20px; color: #a1a1aa; }
  </style>
</head>
<body>
  <h2>WebDesk Pro - Host</h2>
  <div class="card">
    <p>Your ID</p>
    <div class="id-text" id="local-id">Loading...</div>
    <p>Password</p>
    <div class="id-text" id="local-pass">------</div>
  </div>
  <div class="status" id="status-text">Connecting to server...</div>

  <script src="renderer.js"></script>
</body>
</html>
```

### 文件 4: `renderer.js` (渲染进程)
负责 WebSocket 信令和 WebRTC 屏幕分享。
```javascript
// 注意：这里的 WS_URL 替换为你部署的云端地址或本地地址
const WS_URL = 'ws://localhost:3000/signaling'; 
let ws;
let pc;

function connectSignaling() {
  ws = new WebSocket(WS_URL);

  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'registered') {
      document.getElementById('local-id').innerText = data.id;
      document.getElementById('local-pass').innerText = data.pass;
      document.getElementById('status-text').innerText = 'Ready for connection';
    }

    if (data.type === 'request_control') {
      // 在桌面端，我们可以直接自动接受，或者弹窗询问
      document.getElementById('status-text').innerText = 'Incoming connection...';
      startScreenShare(data.fromId);
    }

    // ... 这里省略了 WebRTC 的 offer/answer/candidate 处理逻辑
    // 逻辑与我们在浏览器端写的 RemoteDesktopClient.ts 完全一致
  };
}

async function startScreenShare(targetId) {
  try {
    // 1. 通过 Electron API 获取屏幕源 ID
    const source = await window.electronAPI.getDesktopSources();
    
    // 2. 使用 navigator.mediaDevices 获取屏幕流 (Electron 特有写法)
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: source.id,
          minWidth: 1280,
          maxWidth: 1920,
          minHeight: 720,
          maxHeight: 1080
        }
      }
    });

    document.getElementById('status-text').innerText = 'Screen sharing active';
    
    // 3. 将 stream 加入 RTCPeerConnection 并发送 Offer...
    // (复用之前的 WebRTC 逻辑)

  } catch (e) {
    console.error('Failed to get screen', e);
  }
}

// 假设我们通过 WebRTC DataChannel 收到了鼠标指令
function handleRemoteMouseCommand(command) {
  if (command.type === 'mousemove') {
    // 调用主进程去真正移动鼠标
    window.electronAPI.moveMouse({ x: command.x, y: command.y });
  } else if (command.type === 'click') {
    window.electronAPI.clickMouse();
  }
}

connectSignaling();
```

---

## 4. 运行与打包

### 在本地测试运行
在终端中执行：
```bash
npm start
```
这会弹出一个独立的桌面窗口，显示 ID 和密码，并连接到信令服务器。

### 打包成 Windows `.exe`
开发完成后，执行：
```bash
npm run build
```
`electron-builder` 会自动将你的代码打包，并在 `dist` 目录下生成一个可以直接安装或运行的 `.exe` 文件！

---
*你可以将此文档下载到本地作为开发参考。*
