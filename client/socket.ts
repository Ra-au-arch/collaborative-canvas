import { io, Socket } from 'socket.io-client';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  Point,
  ToolType,
  RoomSnapshot,
  UserInfo,
  DrawOperation,
  ActiveStroke
} from '../shared/protocol.js';
import { ConnectionState } from './types.js';

export interface SocketCallbacks {
  onConnectionChange: (state: ConnectionState) => void;
  onSnapshot: (snapshot: RoomSnapshot) => void;
  onPresenceUpdate: (payload: { users: UserInfo[]; joinedUser?: UserInfo; leftUserId?: string }) => void;
  onRemoteCursor: (payload: { userId: string; userName: string; color: string; x: number; y: number }) => void;
  onRemoteStrokeStart: (stroke: ActiveStroke) => void;
  onRemoteStrokeChunk: (payload: { id: string; userId: string; points: Point[] }) => void;
  onRemoteStrokeEnd: (operation: DrawOperation) => void;
  onCanvasClear: (payload: { clearedBy: string; seq: number }) => void;
  onHistoryChanged: (payload: {
    operations: DrawOperation[];
    canUndo: boolean;
    canRedo: boolean;
    action: 'undo' | 'redo' | 'clear' | 'commit';
    affectedOpId?: string;
  }) => void;
  onReaction: (reaction: import('../shared/protocol.js').EmojiReaction) => void;
  onError: (error: { code: string; message: string }) => void;
  onPong: (latencyMs: number) => void;
}

export class SocketClient {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private callbacks: SocketCallbacks;
  private currentRoomId: string = '';
  private currentUserName?: string;
  private pingInterval: number | null = null;

  constructor(callbacks: SocketCallbacks) {
    this.callbacks = callbacks;
  }

  public connect(roomId: string, userName?: string): void {
    this.currentRoomId = roomId;
    this.currentUserName = userName;

    this.callbacks.onConnectionChange('connecting');

    // Connect to same-origin host
    this.socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000
    });

    this.setupListeners();
    this.startPingLoop();
  }

  private setupListeners(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      this.callbacks.onConnectionChange('connected');
      // Join or re-join room
      this.joinRoom(this.currentRoomId, this.currentUserName);
    });

    this.socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        // Reconnect manually if server disconnected
        this.socket?.connect();
      }
      this.callbacks.onConnectionChange('disconnected');
    });

    this.socket.io.on('reconnect_attempt', () => {
      this.callbacks.onConnectionChange('reconnecting');
    });

    this.socket.io.on('reconnect', () => {
      this.callbacks.onConnectionChange('connected');
      this.joinRoom(this.currentRoomId, this.currentUserName);
    });

    this.socket.io.on('error', () => {
      this.callbacks.onConnectionChange('reconnecting');
    });

    // Event listeners
    this.socket.on('room:snapshot', (snapshot) => {
      this.callbacks.onSnapshot(snapshot);
    });

    this.socket.on('presence:update', (payload) => {
      this.callbacks.onPresenceUpdate(payload);
    });

    this.socket.on('cursor:move', (payload) => {
      this.callbacks.onRemoteCursor(payload);
    });

    this.socket.on('stroke:start', (stroke) => {
      this.callbacks.onRemoteStrokeStart(stroke);
    });

    this.socket.on('stroke:chunk', (payload) => {
      this.callbacks.onRemoteStrokeChunk(payload);
    });

    this.socket.on('stroke:end', (operation) => {
      this.callbacks.onRemoteStrokeEnd(operation);
    });

    this.socket.on('canvas:clear', (payload) => {
      this.callbacks.onCanvasClear(payload);
    });

    this.socket.on('history:changed', (payload) => {
      this.callbacks.onHistoryChanged(payload);
    });

    this.socket.on('reaction:receive', (reaction) => {
      this.callbacks.onReaction(reaction);
    });

    this.socket.on('app:error', (error) => {
      this.callbacks.onError(error);
    });

    this.socket.on('server:pong', (payload) => {
      const latency = Math.max(0, Date.now() - payload.clientTimestamp);
      this.callbacks.onPong(latency);
    });
  }

  public joinRoom(roomId: string, userName?: string): void {
    this.currentRoomId = roomId;
    this.currentUserName = userName;
    if (this.socket && this.socket.connected) {
      this.socket.emit('room:join', { roomId, userName });
    }
  }

  public emitStrokeStart(payload: {
    id: string;
    tool: ToolType;
    color: string;
    width: number;
    point: Point;
    text?: string;
  }): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit('stroke:start', payload);
    }
  }

  public emitStrokeChunk(payload: { id: string; points: Point[] }): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit('stroke:chunk', payload);
    }
  }

  public emitStrokeEnd(payload: { id: string; point?: Point; text?: string }): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit('stroke:end', payload);
    }
  }

  public emitCursorMove(point: Point): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit('cursor:move', point);
    }
  }

  public emitUndo(): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit('history:undo');
    }
  }

  public emitRedo(): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit('history:redo');
    }
  }

  public emitReaction(emoji: string, x: number, y: number): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit('reaction:send', { emoji, x, y });
    }
  }

  public emitClear(): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit('canvas:clear');
    }
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    this.pingInterval = window.setInterval(() => {
      if (this.socket && this.socket.connected) {
        this.socket.emit('client:ping', { timestamp: Date.now() });
      }
    }, 3000);
  }

  private stopPingLoop(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public disconnect(): void {
    this.stopPingLoop();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}
