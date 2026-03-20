const fs = require('fs');
const path = require('path');
const { contextBridge, ipcRenderer } = require('electron');

const DEFAULT_SIGNALING_URL = 'ws://192.168.221.79:3000/signaling';

function readJsonConfig(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    console.error(`[Electron Host] Failed to read config: ${filePath}`, error);
    return null;
  }
}

function resolveRuntimeConfig() {
  const candidatePaths = [
    path.join(path.dirname(process.execPath), 'config.json'),
    path.join(process.resourcesPath || '', 'config.json'),
    path.join(process.cwd(), 'config.json'),
    path.join(__dirname, 'config.json')
  ].filter(Boolean);

  const envUrl = process.env.WS_URL?.trim();
  if (envUrl) {
    return {
      signalingUrl: envUrl,
      configSource: 'env:WS_URL'
    };
  }

  for (const candidatePath of candidatePaths) {
    const parsed = readJsonConfig(candidatePath);
    if (parsed && typeof parsed.wsUrl === 'string' && parsed.wsUrl.trim()) {
      return {
        signalingUrl: parsed.wsUrl.trim(),
        configSource: candidatePath
      };
    }
  }

  return {
    signalingUrl: DEFAULT_SIGNALING_URL,
    configSource: 'builtin-default'
  };
}

// 将受限的 API 暴露给渲染进程 (网页 UI)
contextBridge.exposeInMainWorld('electronAPI', {
  getRuntimeConfig: () => resolveRuntimeConfig(),
  getRuntimeConfig: () => ({
    signalingUrl: process.env.WS_URL || 'ws://localhost:3000/signaling'
  }),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  moveMouse: (data) => ipcRenderer.send('mouse-move', data),
  clickMouse: (data) => ipcRenderer.send('mouse-click', data),
  mouseDown: (data) => ipcRenderer.send('mouse-down', data),
  mouseUp: (data) => ipcRenderer.send('mouse-up', data),
  sendKeyEvent: (data) => ipcRenderer.send('key-event', data),
  resetInput: () => ipcRenderer.send('reset-input')
});
