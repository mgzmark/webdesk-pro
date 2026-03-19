const runtimeConfig = window.electronAPI.getRuntimeConfig();
const WS_URL = runtimeConfig.signalingUrl;
console.log('[Electron Host] Runtime config:', runtimeConfig);

let ws;
let pc;
let dc;
let localStream;
let currentClientId = null;
let iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
];

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
    ws.send(JSON.stringify({
      type: 'hello',
      clientKind: 'electron_host'
    }));
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
        if (Array.isArray(data.iceServers)) {
          iceServers = data.iceServers;
        }
        localIdEl.innerText = data.id;
        localPassEl.innerText = data.pass;
        updateStatus('Ready for connection', 'success');
        break;
      case 'hello_ack':
        if (Array.isArray(data.iceServers)) {
          iceServers = data.iceServers;
        }
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

      case 'session_closed':
        updateStatus(data.message || 'Session ended. Ready.', 'success');
        if (localStream) {
          localStream.getTracks().forEach((track) => track.stop());
          localStream = null;
        }
        if (pc) {
          pc.close();
          pc = null;
        }
        dc = null;
        currentClientId = null;
        window.electronAPI.resetInput();
        break;

      case 'candidate':
        if (pc) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (e) {
            console.error("Error adding ice candidate", e);
          }
        }
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
    iceServers
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

  // 监听数据通道，接收鼠标指令
  pc.ondatachannel = (event) => {
    dc = event.channel;
    dc.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'mousemove') {
        window.electronAPI.moveMouse({ x: msg.x, y: msg.y });
      } else if (msg.type === 'click') {
        window.electronAPI.clickMouse({ button: msg.button });
      } else if (msg.type === 'mousedown') {
        window.electronAPI.mouseDown({ button: msg.button });
      } else if (msg.type === 'mouseup') {
        window.electronAPI.mouseUp({ button: msg.button });
      } else if (msg.type === 'keyboard_event') {
        window.electronAPI.sendKeyEvent(msg);
      }
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
