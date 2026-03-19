const { contextBridge, ipcRenderer } = require('electron');

// 将受限的 API 暴露给渲染进程 (网页 UI)
contextBridge.exposeInMainWorld('electronAPI', {
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
