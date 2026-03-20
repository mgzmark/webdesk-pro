import { useStore } from '../store';

export class RemoteDesktopClient {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private targetId: string | null = null;
  private isHost: boolean = false;
  private iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ];

  private static instance: RemoteDesktopClient;

  private constructor() {}

  public static getInstance() {
    if (!RemoteDesktopClient.instance) {
      RemoteDesktopClient.instance = new RemoteDesktopClient();
    }
    return RemoteDesktopClient.instance;
  }

  // 1. 连接到信令服务器
  public connectSignaling() {
    if (this.ws) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${window.location.host}/signaling`);
    this.ws.onopen = () => {
      this.ws?.send(JSON.stringify({
        type: 'hello',
        clientKind: 'browser'
      }));
    };

    this.ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      const store = useStore.getState();

      switch (data.type) {
        case 'registered':
          if (Array.isArray(data.iceServers)) {
            this.iceServers = data.iceServers;
          }
          store.setLocalCredentials(data.id, data.pass);
          break;
        case 'hello_ack':
          if (Array.isArray(data.iceServers)) {
            this.iceServers = data.iceServers;
          }
          break;
        case 'error':
          store.setError(data.message);
          store.setConnectionStatus('disconnected');
          break;
        case 'incoming_connection':
          // 有人请求控制我们，弹出提示让用户手动确认 (必须有用户手势才能触发屏幕分享)
          store.setIncomingRequest({ fromId: data.fromId });
          break;
        case 'control_rejected':
          store.setError(data.message || "Connection was rejected by the host.");
          this.disconnect();
          break;
        case 'control_accepted':
          // 对方接受了控制请求，我们成为 Viewer (控制端)
          this.isHost = false;
          if (Array.isArray(data.iceServers)) {
            this.iceServers = data.iceServers;
          }
          store.setConnectionStatus('connected');
          await this.initiateWebRTC();
          break;
        case 'session_closed':
          store.setError(data.message || 'The remote session has ended.');
          this.disconnect(false);
          break;
        case 'offer':
          await this.handleOffer(data);
          break;
        case 'answer':
          await this.handleAnswer(data);
          break;
        case 'candidate':
          await this.handleCandidate(data);
          break;
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (useStore.getState().connectionStatus !== 'disconnected') {
        useStore.getState().setError('Disconnected from signaling server.');
        this.disconnect(false);
      }
    };
  }

  // 2. 发起控制请求
  public requestControl(id: string, pass: string) {
    this.targetId = id;
    useStore.getState().setConnectionStatus('connecting');
    useStore.getState().setError(null);
    this.ws?.send(JSON.stringify({
      type: 'request_control',
      targetId: id,
      password: pass
    }));
  }

  // 3. 接受控制请求
  public async acceptRequest() {
    const req = useStore.getState().incomingRequest;
    if (!req) return;
    this.isHost = true;
    this.targetId = req.fromId;
    useStore.getState().setConnectionStatus('hosting');
    useStore.getState().setIncomingRequest(null);
    await this.startHosting();
  }

  // 拒绝控制请求
  public rejectRequest() {
    const req = useStore.getState().incomingRequest;
    if (!req) return;
    this.ws?.send(JSON.stringify({
      type: 'reject_control',
      toId: req.fromId,
      message: "Host declined the connection."
    }));
    useStore.getState().setIncomingRequest(null);
  }

  // 启动被控端 (抓取屏幕并等待 WebRTC 连接)
  private async startHosting() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error("NotSupportedError");
      }
      
      // 获取屏幕分享流
      this.localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" } as any,
        audio: false
      });
      
      // 如果用户点击了浏览器自带的"停止分享"按钮，断开连接
      this.localStream.getVideoTracks()[0].onended = () => {
         this.disconnect();
      };

      // 告诉控制端我们准备好了
      this.ws?.send(JSON.stringify({
        type: 'accept_control',
        toId: this.targetId
      }));
    } catch (e: any) {
      console.error("Failed to get display media", e);
      let errorMsg = "Screen sharing was denied or failed.";
      if (e.name === 'NotAllowedError') {
        errorMsg = "Permission denied. If you are viewing this inside an iframe, please click 'Open in new tab' (top right) to use screen sharing.";
      } else if (e.message === 'NotSupportedError' || e.name === 'NotSupportedError') {
        errorMsg = "Screen sharing is not supported on this device/browser. Note: Mobile browsers (iOS/Android) cannot share their screen via WebRTC.";
      }
      this.ws?.send(JSON.stringify({
        type: 'reject_control',
        toId: this.targetId,
        message: errorMsg
      }));
      useStore.getState().setError(errorMsg);
      this.disconnect();
    }
  }

  // 4. 创建 RTCPeerConnection 基础配置
  private createPeerConnection() {
    this.pc = new RTCPeerConnection({
      iceServers: this.iceServers
    });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.ws?.send(JSON.stringify({
          type: 'candidate',
          targetId: this.targetId,
          candidate: event.candidate
        }));
      }
    };

    this.pc.ontrack = (event) => {
      // 如果我们是控制端，接收到视频流后更新 UI
      if (!this.isHost) {
        if (event.streams && event.streams[0]) {
          // 强制创建一个新的 MediaStream 对象，确保 React 状态更新触发重新渲染
          useStore.getState().setRemoteStream(new MediaStream(event.streams[0].getTracks()));
        } else {
          const stream = new MediaStream([event.track]);
          useStore.getState().setRemoteStream(stream);
        }
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc?.connectionState === 'disconnected' || this.pc?.connectionState === 'failed') {
        this.disconnect();
      }
    };
  }

  // 5. 控制端发起 WebRTC 连接 (创建 Offer 和 DataChannel)
  private async initiateWebRTC() {
    this.createPeerConnection();

    // 明确告诉被控端，我们需要接收视频流
    this.pc!.addTransceiver('video', { direction: 'recvonly' });

    // 控制端创建 DataChannel 用于发送鼠标键盘指令
    this.dc = this.pc!.createDataChannel('control');
    this.setupDataChannel();

    const offer = await this.pc!.createOffer();
    await this.pc!.setLocalDescription(offer);

    this.ws?.send(JSON.stringify({
      type: 'offer',
      targetId: this.targetId,
      offer: offer
    }));
  }

  // 6. 被控端处理 Offer
  private async handleOffer(data: any) {
    if (!this.pc) this.createPeerConnection();

    // 被控端监听 DataChannel 的建立
    this.pc!.ondatachannel = (event) => {
      this.dc = event.channel;
      this.setupDataChannel();
    };

    // 被控端将屏幕流加入连接
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        this.pc!.addTrack(track, this.localStream!);
      });
    }

    await this.pc!.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await this.pc!.createAnswer();
    await this.pc!.setLocalDescription(answer);

    this.ws?.send(JSON.stringify({
      type: 'answer',
      targetId: this.targetId,
      answer: answer
    }));
  }

  private async handleAnswer(data: any) {
    await this.pc?.setRemoteDescription(new RTCSessionDescription(data.answer));
  }

  private async handleCandidate(data: any) {
    try {
      await this.pc?.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {
      console.error("Error adding ice candidate", e);
    }
  }

  // 7. 设置数据通道 (处理鼠标/键盘指令)
  private setupDataChannel() {
    if (!this.dc) return;
    this.dc.onmessage = (event) => {
      if (this.isHost) {
        const msg = JSON.parse(event.data);
        // 在原型中，我们在被控端的屏幕上渲染一个虚拟的红点来模拟鼠标移动
        if (msg.type === 'mousemove') {
          useStore.getState().updateVirtualCursor(msg.x, msg.y, true);
        } else if (msg.type === 'mouseleave') {
          useStore.getState().updateVirtualCursor(0, 0, false);
        } else if (msg.type === 'click' || msg.type === 'mousedown') {
          console.log(`[Host] Received virtual click at relative coords: ${msg.x.toFixed(2)}, ${msg.y.toFixed(2)}`);
          // 触发点击动画
          useStore.getState().updateVirtualCursor(msg.x, msg.y, true, Date.now());
        }
      }
    };
  }

  // 8. 控制端发送鼠标事件
  public sendMouseEvent(type: string, x: number, y: number, width: number, height: number, button: number = 0) {
    const relativeX = x / width;
    const relativeY = y / height;

    // 1. 通过 DataChannel 发送给被控端网页（用于显示红点）
    if (this.dc && this.dc.readyState === 'open') {
      this.dc.send(JSON.stringify({
        type,
        x: relativeX,
        y: relativeY,
        button
      }));
    }

    // 2. 通过 WebSocket 发送给被控端本地 Node.js 脚本（用于真正控制鼠标）
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.targetId) {
      this.ws.send(JSON.stringify({
        type: 'mouse_event',
        targetId: this.targetId,
        mouseType: type,
        x: relativeX,
        y: relativeY,
        button
      }));
    }
  }

  // 8.5 控制端发送键盘事件
  public sendKeyEvent(type: 'keydown' | 'keyup', key: string, code: string, modifiers: any) {
    if (this.dc && this.dc.readyState === 'open') {
      this.dc.send(JSON.stringify({
        type: 'keyboard_event',
        keyType: type,
        key,
        code,
        modifiers
      }));
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.targetId) {
      this.ws.send(JSON.stringify({
        type: 'keyboard_event',
        targetId: this.targetId,
        keyType: type,
        key,
        code,
        modifiers
      }));
    }
  }

  // 9. 断开连接并清理资源
  public disconnect(sendSessionEnd: boolean = true) {
    if (sendSessionEnd && this.ws?.readyState === WebSocket.OPEN && this.targetId) {
      this.ws.send(JSON.stringify({
        type: 'end_session',
        targetId: this.targetId
      }));
    }

    this.localStream?.getTracks().forEach(t => t.stop());
    this.pc?.close();
    this.dc?.close();
    this.pc = null;
    this.dc = null;
    this.localStream = null;
    this.targetId = null;
    this.isHost = false;
    
    useStore.getState().setConnectionStatus('disconnected');
    useStore.getState().setRemoteStream(null);
    useStore.getState().updateVirtualCursor(0, 0, false);
    useStore.getState().setIncomingRequest(null);
  }
}
