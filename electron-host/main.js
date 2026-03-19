const { app, BrowserWindow, ipcMain, desktopCapturer, screen: electronScreen } = require('electron');
const path = require('path');
const { mouse, Point, Button, keyboard, Key } = require('@nut-tree-fork/nut-js');

// 配置 nut.js，去掉默认的延迟以提高响应速度，但保留 5ms 防止操作系统丢弃过快的事件
mouse.config.autoDelayMs = 5;
keyboard.config.autoDelayMs = 5;

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
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
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
          await mouse.setPosition(new Point(item.pos.x, item.pos.y));
          // 移动事件不需要长延迟，稍微等待即可
          await new Promise(resolve => setTimeout(resolve, 5));
        } else if (item.type === 'action') {
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
      // x 和 y 是相对坐标 (0.0 ~ 1.0)
      const primaryDisplay = electronScreen.getPrimaryDisplay();
      const bounds = primaryDisplay.bounds;
      
      // nut.js 在 Windows/Linux 上需要物理像素，在 macOS 上需要逻辑像素
      const isMac = process.platform === 'darwin';
      const scale = isMac ? 1 : (primaryDisplay.scaleFactor || 1);

      // 限制坐标在 0~1 之间，防止越界
      const clampedX = Math.max(0, Math.min(x, 1));
      const clampedY = Math.max(0, Math.min(y, 1));

      // 映射到绝对物理坐标 (考虑多显示器时主屏幕起点可能不是 0,0)
      const targetX = Math.round((bounds.x + clampedX * bounds.width) * scale);
      const targetY = Math.round((bounds.y + clampedY * bounds.height) * scale);
      
      const lastItem = actionQueue[actionQueue.length - 1];
      if (lastItem && lastItem.type === 'move') {
        lastItem.pos = { x: targetX, y: targetY };
      } else {
        actionQueue.push({ type: 'move', pos: { x: targetX, y: targetY } });
      }
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
    actionQueue.push({ type: 'action', fn: async () => {
      try {
        if (button === 2) await mouse.pressButton(Button.RIGHT);
        else if (button === 1) await mouse.pressButton(Button.MIDDLE);
        else await mouse.pressButton(Button.LEFT);
      } catch (err) {
        console.error('Mouse down error:', err);
      }
    }});
    processQueue();
  });

  // 5. 处理鼠标抬起指令 (用于拖拽)
  ipcMain.on('mouse-up', async (event, { button = 0 } = {}) => {
    actionQueue.push({ type: 'action', fn: async () => {
      try {
        if (button === 2) await mouse.releaseButton(Button.RIGHT);
        else if (button === 1) await mouse.releaseButton(Button.MIDDLE);
        else await mouse.releaseButton(Button.LEFT);
      } catch (err) {
        console.error('Mouse up error:', err);
      }
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
