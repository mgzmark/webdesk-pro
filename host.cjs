const WebSocket = require('ws');
const { mouse, Point, screen, Button, keyboard, Key } = require('@nut-tree-fork/nut-js');

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

// 默认使用本地地址，如果你部署到了云端，可以修改这里
const WS_URL = process.env.WS_URL || 'ws://localhost:3000/signaling';

// 从命令行参数获取 ID 和密码
const HOST_ID = process.argv[2];
const HOST_PASS = process.argv[3];

if (!HOST_ID || !HOST_PASS) {
  console.error('❌ 请提供被控端的 ID 和密码！');
  console.error('👉 用法: node host.cjs <9位数字ID> <6位密码>');
  console.error('👉 例如: node host.cjs 123456789 abcdef');
  console.error(`👉 当前连接地址: ${WS_URL} (可通过设置 WS_URL 环境变量修改)`);
  process.exit(1);
}

console.log(`正在连接到信令服务器: ${WS_URL}`);
const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('已连接到服务器，正在绑定设备...');
  
  // 发送绑定请求，将这个 Node.js 脚本与网页上的 ID 绑定
  ws.send(JSON.stringify({
    type: 'bind_device',
    hostId: HOST_ID,
    password: HOST_PASS
  }));
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

ws.on('message', async (data) => {
  const msg = JSON.parse(data);
  
  if (msg.type === 'bound') {
    console.log('✅ 成功绑定到被控端网页！等待控制指令...');
  } else if (msg.type === 'session_closed') {
    console.log(`ℹ️ 会话结束: ${msg.message || '远端已断开'}`);
  } else if (msg.type === 'error') {
    console.error('❌ 绑定失败:', msg.message);
  } else if (msg.type === 'mouse_event') {
    try {
      // 获取当前电脑的屏幕分辨率
      const width = await screen.width();
      const height = await screen.height();
      
      // 将网页传来的相对坐标 (0~1) 转换为你电脑屏幕的绝对坐标
      const x = Math.max(0, Math.min(Math.round(msg.x * width), width - 1));
      const y = Math.max(0, Math.min(Math.round(msg.y * height), height - 1));

      if (msg.mouseType === 'mousemove') {
        if (typeof x !== 'number' || typeof y !== 'number' || isNaN(x) || isNaN(y)) {
          return;
        }
        
        const lastItem = actionQueue[actionQueue.length - 1];
        if (lastItem && lastItem.type === 'move') {
          lastItem.pos = { x, y };
        } else {
          actionQueue.push({ type: 'move', pos: { x, y } });
        }
        processQueue();
      } else if (msg.mouseType === 'click') {
        actionQueue.push({ type: 'action', fn: async () => {
          if (msg.button === 2) await mouse.click(Button.RIGHT);
          else if (msg.button === 1) await mouse.click(Button.MIDDLE);
          else await mouse.leftClick();
          console.log(`执行点击: x=${x}, y=${y}, button=${msg.button}`);
        }});
        processQueue();
      } else if (msg.mouseType === 'mousedown') {
        actionQueue.push({ type: 'action', fn: async () => {
          if (msg.button === 2) await mouse.pressButton(Button.RIGHT);
          else if (msg.button === 1) await mouse.pressButton(Button.MIDDLE);
          else await mouse.pressButton(Button.LEFT);
          console.log(`鼠标按下: x=${x}, y=${y}, button=${msg.button}`);
        }});
        processQueue();
      } else if (msg.mouseType === 'mouseup') {
        actionQueue.push({ type: 'action', fn: async () => {
          if (msg.button === 2) await mouse.releaseButton(Button.RIGHT);
          else if (msg.button === 1) await mouse.releaseButton(Button.MIDDLE);
          else await mouse.releaseButton(Button.LEFT);
          console.log(`鼠标抬起: x=${x}, y=${y}, button=${msg.button}`);
        }});
        processQueue();
      }
    } catch (err) {
      console.error('执行鼠标操作失败:', err);
    }
  } else if (msg.type === 'keyboard_event') {
    try {
      const nutKey = keyMap[msg.code];
      if (!nutKey) {
        console.warn(`[Keyboard] Unmapped key code: ${msg.code}`);
        return;
      }

      actionQueue.push({ type: 'action', fn: async () => {
        try {
          if (msg.keyType === 'keydown') await keyboard.pressKey(nutKey);
          else if (msg.keyType === 'keyup') await keyboard.releaseKey(nutKey);
        } catch (err) {
          console.error('Keyboard error:', err);
        }
      }});
      processQueue();
    } catch (err) {
      console.error('执行键盘操作失败:', err);
    }
  }
});

ws.on('close', async () => {
  console.log('连接已断开');
  try {
    await mouse.releaseButton(Button.LEFT);
    await mouse.releaseButton(Button.RIGHT);
    await mouse.releaseButton(Button.MIDDLE);
  } catch (e) {
    // ignore
  }
});
