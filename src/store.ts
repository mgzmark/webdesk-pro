import { create } from 'zustand';

interface AppState {
  localId: string;
  localPass: string;
  remoteIdInput: string;
  remotePassInput: string;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'hosting';
  error: string | null;
  remoteStream: MediaStream | null;
  virtualCursor: { x: number, y: number, visible: boolean, clickState: number };
  incomingRequest: { fromId: string } | null;

  setLocalCredentials: (id: string, pass: string) => void;
  setRemoteInput: (id: string, pass: string) => void;
  setConnectionStatus: (status: AppState['connectionStatus']) => void;
  setError: (error: string | null) => void;
  setRemoteStream: (stream: MediaStream | null) => void;
  updateVirtualCursor: (x: number, y: number, visible: boolean, clickState?: number) => void;
  setIncomingRequest: (req: { fromId: string } | null) => void;
}

export const useStore = create<AppState>((set) => ({
  localId: '',
  localPass: '',
  remoteIdInput: '',
  remotePassInput: '',
  connectionStatus: 'disconnected',
  error: null,
  remoteStream: null,
  virtualCursor: { x: 0, y: 0, visible: false, clickState: 0 },
  incomingRequest: null,

  setLocalCredentials: (id, pass) => set({ localId: id, localPass: pass }),
  setRemoteInput: (id, pass) => set({ remoteIdInput: id, remotePassInput: pass }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setError: (error) => set({ error }),
  setRemoteStream: (stream) => set({ remoteStream: stream }),
  updateVirtualCursor: (x, y, visible, clickState) => set((state) => ({ 
    virtualCursor: { x, y, visible, clickState: clickState ?? state.virtualCursor.clickState } 
  })),
  setIncomingRequest: (req) => set({ incomingRequest: req }),
}));
