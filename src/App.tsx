import React, { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { RemoteDesktopClient } from './lib/RemoteDesktopClient';
import { Monitor, Key, AlertCircle, X, MousePointer2, Terminal, GripHorizontal } from 'lucide-react';
import { motion } from 'motion/react';

export default function App() {
  const {
    localId, localPass, remoteIdInput, remotePassInput,
    connectionStatus, error, remoteStream, virtualCursor,
    incomingRequest, setRemoteInput
  } = useStore();

  const isViewer = connectionStatus === 'connected' && remoteStream;
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const toolbarTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fullScreenRef = useRef<HTMLDivElement>(null);

  const handleGlobalMouseMove = () => {
    if (!isViewer) return;
    setToolbarVisible(true);
    if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
    toolbarTimerRef.current = setTimeout(() => {
      setToolbarVisible(false);
    }, 2500);
  };

  useEffect(() => {
    if (isViewer) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      handleGlobalMouseMove();
    } else {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
    }
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
    };
  }, [isViewer]);

  useEffect(() => {
    // 组件挂载时自动连接信令服务器
    RemoteDesktopClient.getInstance().connectSignaling();
  }, []);

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (remoteIdInput && remotePassInput) {
      RemoteDesktopClient.getInstance().requestControl(remoteIdInput, remotePassInput);
    }
  };

  const handleDisconnect = () => {
    RemoteDesktopClient.getInstance().disconnect();
  };

  if (isViewer) {
    return (
      <div ref={fullScreenRef} className="fixed inset-0 bg-black z-50 overflow-hidden flex items-center justify-center">
        <RemoteVideo stream={remoteStream} />
        
        {/* Floating Toolbar Wrapper */}
        <div className={`absolute top-6 left-0 right-0 flex justify-center z-[60] pointer-events-none`}>
          <motion.div
            drag
            dragConstraints={fullScreenRef}
            dragElastic={0}
            dragMomentum={false}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: toolbarVisible ? 1 : 0, y: toolbarVisible ? 0 : -20 }}
            transition={{ duration: 0.2 }}
            className={`w-max bg-zinc-900/90 backdrop-blur-md border border-zinc-700 p-2 rounded-2xl shadow-2xl flex items-center gap-4 ${
              toolbarVisible ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
          >
            <div className="cursor-grab active:cursor-grabbing p-2 text-zinc-400 hover:text-zinc-200">
              <GripHorizontal className="w-5 h-5" />
            </div>
            
            <div className="flex items-center gap-2 px-2 border-l border-zinc-700">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-zinc-300">Connected to {remoteIdInput}</span>
            </div>

            <button
              onClick={handleDisconnect}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-xl transition-colors text-sm font-medium ml-2"
            >
              <X className="w-4 h-4" />
              Disconnect
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-indigo-500/30">
      {/* 顶部导航栏 */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Monitor className="w-6 h-6 text-indigo-400" />
          <h1 className="text-xl font-semibold tracking-tight">WebDesk Pro</h1>
        </div>
        {connectionStatus !== 'disconnected' && (
          <button
            onClick={handleDisconnect}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors text-sm font-medium"
          >
            <X className="w-4 h-4" />
            Disconnect
          </button>
        )}
      </header>

      <main className="p-6 max-w-6xl mx-auto">
        {/* 错误提示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* 收到连接请求弹窗 */}
        {incomingRequest && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl max-w-md w-full text-center animate-in fade-in zoom-in duration-200">
              <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <Monitor className="w-8 h-8 text-indigo-400" />
              </div>
              <h3 className="text-xl font-semibold mb-2 text-zinc-100">Incoming Connection</h3>
              <p className="text-zinc-400 mb-8">
                Device <span className="font-mono text-indigo-400">{incomingRequest.fromId}</span> is requesting to view and control your screen.
              </p>
              <div className="flex gap-4">
                <button
                  onClick={() => RemoteDesktopClient.getInstance().rejectRequest()}
                  className="flex-1 py-3 rounded-xl font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                >
                  Decline
                </button>
                <button
                  onClick={() => RemoteDesktopClient.getInstance().acceptRequest()}
                  className="flex-1 py-3 rounded-xl font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-lg shadow-indigo-500/25"
                >
                  Accept & Share
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 状态 1: 未连接 (显示仪表盘) */}
        {connectionStatus === 'disconnected' && (
          <div className="grid md:grid-cols-2 gap-8">
            {/* 本机信息面板 */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-xl">
              <h2 className="text-lg font-medium mb-6 text-zinc-300">This Workspace</h2>
              <div className="space-y-6">
                <div>
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 block">Your ID</label>
                  <div className="text-4xl font-mono tracking-widest text-indigo-400">
                    {localId ? localId.match(/.{1,3}/g)?.join(' ') : '--- --- ---'}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 block">Password</label>
                  <div className="flex items-center gap-3">
                    <Key className="w-5 h-5 text-zinc-600" />
                    <span className="text-2xl font-mono text-zinc-300">{localPass || '------'}</span>
                  </div>
                </div>
                <p className="text-sm text-zinc-500 pt-4 border-t border-zinc-800">
                  Share this ID and password to allow someone else to control this device.
                </p>
                
                {/* 增加本地脚本运行提示 */}
                <div className="mt-6 pt-6 border-t border-zinc-800">
                  <h3 className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-2">
                    <Terminal className="w-4 h-4" />
                    Enable Real Mouse Control
                  </h3>
                  <p className="text-xs text-zinc-500 mb-3">
                    To allow the remote user to actually control your mouse (not just see a red dot), run this command in your terminal:
                  </p>
                  <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 overflow-x-auto">
                    <code className="text-xs font-mono text-emerald-400 whitespace-nowrap">
                      # 如果你在本地运行项目:
                      <br />
                      node host.cjs {localId || '<ID>'} {localPass || '<PASS>'}
                      <br /><br />
                      # 如果你想连接到云端 AI Studio (替换为你的真实分享链接):
                      <br />
                      WS_URL=wss://ais-pre-....run.app/signaling node host.cjs {localId || '<ID>'} {localPass || '<PASS>'}
                    </code>
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-2">
                    Requires Node.js. Run `npm install ws @nut-tree-fork/nut-js` first if you haven't.
                  </p>
                </div>
              </div>
            </div>

            {/* 远程控制面板 */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-xl">
              <h2 className="text-lg font-medium mb-6 text-zinc-300">Control Remote Device</h2>
              <form onSubmit={handleConnect} className="space-y-5">
                <div>
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 block">Partner ID</label>
                  <input
                    type="text"
                    value={remoteIdInput}
                    onChange={(e) => setRemoteInput(e.target.value.replace(/\s/g, ''), remotePassInput)}
                    placeholder="123 456 789"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-lg font-mono focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 block">Password</label>
                  <input
                    type="text"
                    value={remotePassInput}
                    onChange={(e) => setRemoteInput(remoteIdInput, e.target.value)}
                    placeholder="••••••"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-lg font-mono focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3 rounded-xl transition-colors mt-4"
                >
                  Connect
                </button>
              </form>
            </div>
          </div>
        )}

        {/* 状态 2: 连接中 */}
        {connectionStatus === 'connecting' && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
            <p className="text-zinc-400">Negotiating P2P connection...</p>
          </div>
        )}

        {/* 状态 3: 作为被控端 (Host) */}
        {connectionStatus === 'hosting' && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mb-6">
              <Monitor className="w-10 h-10 text-emerald-500" />
            </div>
            <h2 className="text-2xl font-medium text-emerald-400 mb-2">Session Active</h2>
            <p className="text-zinc-400 max-w-md">
              Your screen is currently being shared. The remote user can see your screen and send virtual control inputs.
            </p>
            
            {/* 虚拟屏幕区域 (用于演示接收到的鼠标指令) */}
            <div className="mt-12 p-6 bg-zinc-900 border border-zinc-800 rounded-xl relative overflow-hidden w-full max-w-2xl aspect-video shadow-2xl">
              <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-700 font-mono text-sm pointer-events-none">
                <MousePointer2 className="w-8 h-8 mb-2 opacity-20" />
                [ Virtual Screen Area ]
                <span className="text-xs mt-2 opacity-50">Watch for the red dot when the remote user moves their mouse</span>
              </div>
              
              {/* 渲染远端传来的虚拟鼠标指针 */}
              {virtualCursor.visible && (
                <div
                  className="absolute w-4 h-4 bg-red-500 rounded-full shadow-[0_0_15px_rgba(239,68,68,1)] transform -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-all duration-75 z-10"
                  style={{
                    left: `${virtualCursor.x * 100}%`,
                    top: `${virtualCursor.y * 100}%`
                  }}
                >
                  <div className="absolute top-full left-full mt-1 ml-1 text-xs text-red-400 font-mono whitespace-nowrap bg-zinc-950/80 px-2 py-1 rounded">
                    Remote Cursor
                  </div>
                  {/* 点击波纹效果 */}
                  <div 
                    key={virtualCursor.clickState}
                    className={`absolute inset-0 rounded-full border-2 border-red-500 ${virtualCursor.clickState > 0 ? 'animate-ping' : 'hidden'}`}
                    style={{ animationDuration: '0.5s' }}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// 独立的视频组件，负责渲染流并捕获鼠标事件
function RemoteVideo({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      // Force re-assignment to wake up the video element
      videoRef.current.srcObject = null;
      // Small delay to ensure the browser registers the null assignment
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          const attemptPlay = () => {
            if (videoRef.current) {
              videoRef.current.play().catch(e => console.error("Video play failed:", e));
            }
          };
          attemptPlay();
          
          videoRef.current.addEventListener('loadedmetadata', attemptPlay);
          videoRef.current.addEventListener('canplay', attemptPlay);
        }
      }, 10);

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && videoRef.current) {
          // Re-trigger play when tab becomes visible
          videoRef.current.play().catch(e => console.error("Visibility play error:", e));
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
      };
    }
  }, [stream]);

  useEffect(() => {
    const handleGlobalMouseUp = (e: MouseEvent) => {
      RemoteDesktopClient.getInstance().sendMouseEvent('mouseup_global', 0, 0, 1, 1, e.button);
    };
    const handleBlur = () => {
      RemoteDesktopClient.getInstance().sendMouseEvent('mouseup_global', 0, 0, 1, 1, 0);
    };
    
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('blur', handleBlur);
    
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const lastMouseMoveTime = useRef<number>(0);

  const [localCursor, setLocalCursor] = useState({ x: 0, y: 0, visible: false });

  const handleMouseEvent = (e: React.MouseEvent | React.PointerEvent, type: string) => {
    if (!videoRef.current || !containerRef.current) return;

    const video = videoRef.current;
    const container = containerRef.current;
    const videoRect = video.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    // 获取视频的原始分辨率
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    
    if (videoWidth === 0 || videoHeight === 0) return;

    // 计算视频在容器中的实际显示尺寸和偏移量 (object-contain)
    const videoRatio = videoWidth / videoHeight;
    const elementRatio = videoRect.width / videoRect.height;
    
    let actualWidth = videoRect.width;
    let actualHeight = videoRect.height;
    let offsetX = 0;
    let offsetY = 0;
    
    if (videoRatio > elementRatio) {
      // 视频比容器宽，上下有黑边 (Letterbox)
      actualHeight = videoRect.width / videoRatio;
      offsetY = (videoRect.height - actualHeight) / 2;
    } else {
      // 视频比容器高，左右有黑边 (Pillarbox)
      actualWidth = videoRect.height * videoRatio;
      offsetX = (videoRect.width - actualWidth) / 2;
    }
    
    // 计算相对于实际视频画面的坐标
    let x = e.clientX - videoRect.left - offsetX;
    let y = e.clientY - videoRect.top - offsetY;
    
    // 限制在视频画面范围内，防止在黑边区域释放鼠标导致事件丢失
    x = Math.max(0, Math.min(x, actualWidth));
    y = Math.max(0, Math.min(y, actualHeight));
    
    // 更新本地假光标位置 (相对于整个容器)
    if (type === 'mouseleave') {
      setLocalCursor(prev => ({ ...prev, visible: false }));
    } else {
      setLocalCursor({
        x: e.clientX - containerRect.left,
        y: e.clientY - containerRect.top,
        visible: true
      });
    }

    // Throttle mousemove events to ~30fps to prevent lag
    if (type === 'mousemove') {
      const now = Date.now();
      if (now - lastMouseMoveTime.current < 33) {
        return;
      }
      lastMouseMoveTime.current = now;
    }
    
    // 如果是离开画面，额外发送一个 mouseup 确保释放鼠标，防止拖拽卡死
    if (type === 'mouseleave') {
      console.log(`[Frontend] Mouse left video area. Sending mouseup and mouseleave.`);
      RemoteDesktopClient.getInstance().sendMouseEvent('mouseup', x, y, actualWidth, actualHeight, e.button);
      RemoteDesktopClient.getInstance().sendMouseEvent(type, x, y, actualWidth, actualHeight, e.button);
      return;
    }
    
    if (type === 'mousedown' || type === 'mouseup' || type === 'mouseup_global') {
      console.log(`[${new Date().toISOString()}] [Frontend] handleMouseEvent: ${type}, button: ${e.button}`);
    }
    
    RemoteDesktopClient.getInstance().sendMouseEvent(type, x, y, actualWidth, actualHeight, e.button);
  };

  const handleKeyEvent = (e: React.KeyboardEvent, type: 'keydown' | 'keyup') => {
    // 阻止默认行为，防止触发浏览器快捷键（比如 F5 刷新，Tab 切换焦点等）
    // 但允许一些必要的按键，比如 F12 开发者工具
    if (e.code !== 'F12') {
      e.preventDefault();
    }

    const modifiers = {
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey
    };

    RemoteDesktopClient.getInstance().sendKeyEvent(type, e.key, e.code, modifiers);
  };

  // 自动聚焦容器，以便接收键盘事件
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.focus();
    }
  }, []);

  return (
    <div 
      ref={containerRef} 
      className="relative w-full h-full overflow-hidden bg-black outline-none"
      tabIndex={0}
      onKeyDown={(e) => handleKeyEvent(e, 'keydown')}
      onKeyUp={(e) => handleKeyEvent(e, 'keyup')}
      onMouseEnter={() => containerRef.current?.focus()}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-contain cursor-crosshair"
        style={{ touchAction: 'none' }}
        onPointerMove={(e) => handleMouseEvent(e, 'mousemove')}
        onPointerLeave={(e) => handleMouseEvent(e, 'mouseleave')}
        onPointerDown={(e) => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch (err) {
            console.warn("Failed to set pointer capture", err);
          }
          handleMouseEvent(e, 'mousedown');
        }}
        onPointerUp={(e) => {
          try {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          } catch (err) {}
          handleMouseEvent(e, 'mouseup');
        }}
        onPointerCancel={(e) => {
          try {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          } catch (err) {}
          handleMouseEvent(e, 'mouseup');
        }}
        draggable={false}
        onContextMenu={(e) => {
          e.preventDefault(); // 阻止浏览器默认右键菜单
        }}
      />
      {/* 渲染一个跟随鼠标的假光标，解决远程桌面不显示鼠标的问题 */}
      {localCursor.visible && (
        <div 
          className="absolute w-4 h-4 pointer-events-none z-50 transform -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${localCursor.x}px`,
            top: `${localCursor.y}px`,
          }}
        >
          <div className="w-2 h-2 bg-red-500 rounded-full shadow-[0_0_8px_rgba(239,68,68,1)] border border-white/50"></div>
        </div>
      )}
    </div>
  );
}
