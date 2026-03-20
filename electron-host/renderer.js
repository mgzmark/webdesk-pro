// 默认连接到本地的信令服务器
// 如果你要连云端，请修改为: const WS_URL = 'wss://你的分享链接.run.app/signaling';
const WS_URL = 'ws://192.168.221.79:3000/signaling'; 

let ws;
let pc;
let dc;
let localStream;
let currentClientId = null;

const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
const localIdEl = document.getElementById('local-id');
const localPassEl = document.getElementById('local-pass');

function updateStatus(text, state = 'warning') {
  statusText.innerText = text;
  statusDot.className = 'status-dot';
  if (state === 'success') statusDot.classList.add('connected');
  if (state === 'error') statusDot.classList.add('error');
}

function connectSignaling() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    updateStatus('Connected to signaling server', 'success');
  };

  ws.onclose = () => {
    updateStatus('Disconnected. Reconnecting...', 'error');
    setTimeout(connectSignaling, 3000);
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };

  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    switch (data.type) {
      case 'registered':
        localIdEl.innerText = data.id;
        localPassEl.innerText = data.pass;
        updateStatus('Ready for connection', 'success');
        break;
        
      case 'incoming_connection':
        // 有人请求控制，自动接受并开始分享屏幕
        currentClientId = data.fromId;
        updateStatus('Incoming connection...', 'warning');
        await startScreenShare(currentClientId);
        break;

      case 'offer':
        await handleOffer(data);
        break;

      case 'candidate':
        if (pc && data.candidate) {
          try {
            // 过滤掉 .local 的 mDNS 候选者，防止底层 socket_manager 报错 -105
            if (data.candidate.candidate && data.candidate.candidate.includes('.local')) {
              console.log('Ignored mDNS candidate from peer to prevent -105 error');
              break;
            }
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (e) {
            console.error("Error adding ice candidate", e);
          }
        }
        break;

      case 'mouse_event':
        // 接收来自 WebSocket 的鼠标事件 (作为 WebRTC DataChannel 的备用/补充)
        if (data.mouseType === 'mousedown' || data.mouseType === 'mouseup' || data.mouseType === 'mouseup_global') {
          console.log(`[${new Date().toISOString()}] [Electron-Renderer] Received via WebSocket: ${data.mouseType}, button: ${data.button}`);
        }
        
        if (data.mouseType === 'mousemove') {
          console.log(`[Electron-Renderer] Received mousemove: ${data.x}, ${data.y}`);
          window.electronAPI.moveMouse({ x: data.x, y: data.y });
        } else if (data.mouseType === 'click') {
          window.electronAPI.mouseDown({ button: data.button });
          window.electronAPI.mouseUp({ button: data.button });
        } else if (data.mouseType === 'mousedown') {
          window.electronAPI.mouseDown({ button: data.button });
        } else if (data.mouseType === 'mouseup' || data.mouseType === 'mouseup_global') {
          window.electronAPI.mouseUp({ button: data.button });
        }
        break;

      case 'keyboard_event':
        window.electronAPI.sendKeyEvent(data);
        break;
    }
  };
}

async function startScreenShare(targetId) {
  try {
    // 1. 调用 Electron 主进程获取屏幕源
    const source = await window.electronAPI.getDesktopSources();
    
    // 2. 使用特殊的 chromeMediaSourceId 获取桌面流
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: source.id
        }
      }
    });

    updateStatus('Screen sharing active', 'success');
    
    // 3. 告诉控制端我们准备好了
    ws.send(JSON.stringify({
      type: 'accept_control',
      toId: targetId
    }));

  } catch (e) {
    console.error('Failed to get screen', e);
    updateStatus('Screen sharing failed', 'error');
    ws.send(JSON.stringify({
      type: 'reject_control',
      toId: targetId,
      message: 'Host failed to capture screen.'
    }));
  }
}

async function handleOffer(data) {
  pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({
        type: 'candidate',
        targetId: currentClientId,
        candidate: event.candidate
      }));
    }
  };

  // 监听数据通道，接收鼠标指令 (已废弃，改用 WebSocket 接收以防止被 DXGI 错误阻塞)
  pc.ondatachannel = (event) => {
    dc = event.channel;
    dc.onmessage = (e) => {
      // 忽略 DataChannel 的控制消息，全部走 WebSocket
      // const msg = JSON.parse(e.data);
      // console.log(`[${new Date().toISOString()}] [Electron-Renderer] Ignored DataChannel message: ${msg.type}`);
    };
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      updateStatus('Client disconnected. Ready.', 'success');
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
      }
      pc = null;
      dc = null;
      window.electronAPI.resetInput();
    }
  };

  // 将本地屏幕流加入连接
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  ws.send(JSON.stringify({
    type: 'answer',
    targetId: currentClientId,
    answer: answer
  }));
}

// 启动连接
connectSignaling();
