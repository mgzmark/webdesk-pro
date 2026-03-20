const { app, BrowserWindow, ipcMain, desktopCapturer, screen: electronScreen } = require('electron');
const path = require('path');
const { mouse, Point, screen: nutScreen, Button, keyboard, Key } = require('@nut-tree-fork/nut-js');

// 禁用硬件加速，解决 Windows 下 DXGI 桌面捕捉失败 (DxgiDuplicatorController failed) 的问题
app.disableHardwareAcceleration();

// 强制禁用 WebRTC 的 DXGI 捕捉，回退到 GDI 捕捉，这在无显示器或 RDP 环境下更稳定
// 同时禁用 WebRtcHideLocalIpsWithMdns，解决 Windows 下无法解析 .local mDNS 地址导致连接失败的问题 (errorcode: -105)
app.commandLine.appendSwitch('disable-features', 'WebRtcAllowDxgi,WebRtcUseDxgi,WebRtcHideLocalIpsWithMdns,mDNS');
app.commandLine.appendSwitch('enable-webrtc-hide-local-ips-with-mdns', 'false');
// 隐藏捕获器光标，防止在 GDI 模式下因为权限问题导致获取光标失败 (Error 5)
app.commandLine.appendSwitch('enable-features', 'WebRtcHideCapturer');

// 配置 nut.js，去掉默认的延迟以提高响应速度
// mouse.config.autoDelayMs = 0;
// keyboard.config.autoDelayMs = 0;

// Web KeyboardEvent.code 到 nut.js Key 的映射
const keyMap = {
  'KeyA': Key.A, 'KeyB': Key.B, 'KeyC': Key.C, 'KeyD': Key.D, 'KeyE': Key.E,
  'KeyF': Key.F, 'KeyG': Key.G, 'KeyH': Key.H, 'KeyI': Key.I, 'KeyJ': Key.J,
  'KeyK': Key.K, 'KeyL': Key.L, 'KeyM': Key.M, 'KeyN': Key.N, 'KeyO': Key.O,
  'KeyP': Key.P, 'KeyQ': Key.Q, 'KeyR': Key.R, 'KeyS': Key.S, 'KeyT': Key.T,
  'KeyU': Key.U, 'KeyV': Key.V, 'KeyW': Key.W, 'KeyX': Key.X, 'KeyY': Key.Y, 'KeyZ': Key.Z,
  'Digit1': Key.Num1, 'Digit2': Key.Num2, 'Digit3': Key.Num3, 'Digit4': Key.Num4, 'Digit5': Key.Num5,
  'Digit6': Key.Num6, 'Digit7': Key.Num7, 'Digit8': Key.Num8, 'Digit9': Key.Num9, 'Digit0': Key.Num0,
  'Enter': Key.Enter, 'Escape': Key.Escape, 'Backspace': Key.Backspace, 'Tab': Key.Tab, 'Space': Key.Space,
  'Minus': Key.Minus, 'Equal': Key.Equal, 'BracketLeft': Key.LeftBracket, 'BracketRight': Key.RightBracket,
  'Backslash': Key.Backslash, 'Semicolon': Key.Semicolon, 'Quote': Key.Quote, 'Backquote': Key.Grave,
  'Comma': Key.Comma, 'Period': Key.Period, 'Slash': Key.Slash,
  'CapsLock': Key.CapsLock, 'F1': Key.F1, 'F2': Key.F2, 'F3': Key.F3, 'F4': Key.F4, 'F5': Key.F5, 'F6': Key.F6,
  'F7': Key.F7, 'F8': Key.F8, 'F9': Key.F9, 'F10': Key.F10, 'F11': Key.F11, 'F12': Key.F12,
  'PrintScreen': Key.Print, 'ScrollLock': Key.ScrollLock, 'Pause': Key.Pause,
  'Insert': Key.Insert, 'Home': Key.Home, 'PageUp': Key.PageUp, 'Delete': Key.Delete, 'End': Key.End, 'PageDown': Key.PageDown,
  'ArrowRight': Key.Right, 'ArrowLeft': Key.Left, 'ArrowDown': Key.Down, 'ArrowUp': Key.Up,
  'NumLock': Key.NumLock, 'NumpadDivide': Key.Divide, 'NumpadMultiply': Key.Multiply, 'NumpadSubtract': Key.Subtract, 'NumpadAdd': Key.Add, 'NumpadEnter': Key.Enter,
  'Numpad1': Key.Num1, 'Numpad2': Key.Num2, 'Numpad3': Key.Num3, 'Numpad4': Key.Num4, 'Numpad5': Key.Num5, 'Numpad6': Key.Num6, 'Numpad7': Key.Num7, 'Numpad8': Key.Num8, 'Numpad9': Key.Num9, 'Numpad0': Key.Num0, 'NumpadDecimal': Key.Decimal,
  'ShiftLeft': Key.LeftShift, 'ShiftRight': Key.RightShift, 'ControlLeft': Key.LeftControl, 'ControlRight': Key.RightControl,
  'AltLeft': Key.LeftAlt, 'AltRight': Key.RightAlt, 'MetaLeft': Key.LeftSuper, 'MetaRight': Key.RightSuper
};

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 550,
    resizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools(); // 取消注释可以打开开发者工具调试
}

app.whenReady().then(() => {
  createWindow();

  // 1. 处理渲染进程获取屏幕源的请求
  ipcMain.handle('get-desktop-sources', async () => {
    // 设置 thumbnailSize 为 0x0，防止在获取屏幕列表时因为生成缩略图而触发 DXGI 捕捉超时
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const primaryDisplay = electronScreen.getPrimaryDisplay();
    // 确保获取的是真正的主屏幕
    const primarySource = sources.find(s => s.display_id === primaryDisplay.id.toString()) || sources[0];
    return primarySource;
  });

  let isProcessing = false;
  const actionQueue = [];

  const processQueue = async () => {
    if (isProcessing) return;
    isProcessing = true;
    while (actionQueue.length > 0) {
      const item = actionQueue.shift();
      try {
        if (item.type === 'move') {
          console.log(`[Electron-Main] Executing move to ${item.pos.x}, ${item.pos.y}`);
          await mouse.setPosition(new Point(item.pos.x, item.pos.y));
          // 移动事件不需要长延迟，稍微等待即可
          await new Promise(resolve => setTimeout(resolve, 5));
        } else if (item.type === 'action') {
          console.log(`[Electron-Main] Executing action`);
          await item.fn();
          // 强制等待 50ms，确保操作系统有足够时间处理上一个原生事件，防止 mousedown 和 mouseup 粘连
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch (e) {
        console.error('Action error:', e);
      }
    }
    isProcessing = false;
  };

  // 2. 处理鼠标移动指令
  ipcMain.on('mouse-move', async (event, { x, y }) => {
    try {
      if (typeof x !== 'number' || typeof y !== 'number' || isNaN(x) || isNaN(y)) {
        return;
      }
      
      // 限制坐标在 0~1 之间，防止越界
      const clampedX = Math.max(0, Math.min(x, 1));
      const clampedY = Math.max(0, Math.min(y, 1));

      // 使用 nut.js 的屏幕尺寸，确保坐标映射准确
      const screenWidth = await nutScreen.width();
      const screenHeight = await nutScreen.height();

      const targetX = Math.round(clampedX * screenWidth);
      const targetY = Math.round(clampedY * screenHeight);
      
      const lastItem = actionQueue[actionQueue.length - 1];
      if (lastItem && lastItem.type === 'move') {
        lastItem.pos = { x: targetX, y: targetY };
      } else {
        actionQueue.push({ type: 'move', pos: { x: targetX, y: targetY } });
      }
      console.log(`[Electron-Main] Enqueued mouse-move to ${targetX}, ${targetY}`);
      processQueue();
    } catch (err) {
      console.error('Mouse move error:', err);
    }
  });

  // 3. 处理鼠标点击指令
  ipcMain.on('mouse-click', async (event, { button = 0 } = {}) => {
    actionQueue.push({ type: 'action', fn: async () => {
      try {
        if (button === 2) await mouse.click(Button.RIGHT);
        else if (button === 1) await mouse.click(Button.MIDDLE);
        else await mouse.leftClick();
      } catch (err) {
        console.error('Mouse click error:', err);
      }
    }});
    processQueue();
  });

  // 4. 处理鼠标按下指令 (用于拖拽)
  ipcMain.on('mouse-down', async (event, { button = 0 } = {}) => {
    console.log(`[${new Date().toISOString()}] [Electron-Main] Enqueuing mouse-down, button: ${button}`);
    actionQueue.push({ type: 'action', fn: async () => {
      try {
        if (button === 2) await mouse.pressButton(Button.RIGHT);
        else if (button === 1) await mouse.pressButton(Button.MIDDLE);
        else await mouse.pressButton(Button.LEFT);
        console.log(`[${new Date().toISOString()}] [Electron-Main] Executed mouse-down, button: ${button}`);
      } catch (err) {
        console.error('Mouse down error:', err);
      }
    }});
    processQueue();
  });

  // 5. 处理鼠标抬起指令 (用于拖拽)
  ipcMain.on('mouse-up', async (event, { button = 0 } = {}) => {
    console.log(`[${new Date().toISOString()}] [Electron-Main] Enqueuing mouse-up, button: ${button}`);
    actionQueue.push({ type: 'action', fn: async () => {
      try { await mouse.releaseButton(Button.LEFT); } catch(e){}
      try { await mouse.releaseButton(Button.RIGHT); } catch(e){}
      try { await mouse.releaseButton(Button.MIDDLE); } catch(e){}
      console.log(`[${new Date().toISOString()}] [Electron-Main] Executed mouse-up (all released), button: ${button}`);
    }});
    processQueue();
  });

  // 5.5 紧急重置指令 (连接断开时调用)
  ipcMain.on('reset-input', async () => {
    actionQueue.push({ type: 'action', fn: async () => {
      try {
        await mouse.releaseButton(Button.LEFT);
        await mouse.releaseButton(Button.RIGHT);
        await mouse.releaseButton(Button.MIDDLE);
      } catch (err) {
        console.error('Reset input error:', err);
      }
    }});
    processQueue();
  });

  // 6. 处理键盘指令
  ipcMain.on('key-event', async (event, { keyType, code, modifiers }) => {
    const nutKey = keyMap[code];
    if (!nutKey) {
      console.warn(`[Keyboard] Unmapped key code: ${code}`);
      return;
    }
    actionQueue.push({ type: 'action', fn: async () => {
      try {
        if (keyType === 'keydown') await keyboard.pressKey(nutKey);
        else if (keyType === 'keyup') await keyboard.releaseKey(nutKey);
      } catch (err) {
        console.error('Keyboard error:', err);
      }
    }});
    processQueue();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
