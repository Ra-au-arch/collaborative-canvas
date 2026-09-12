import { ToolType, Point, DrawOperation, ActiveStroke, UserInfo } from '../shared/protocol.js';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface ClientAppState {
  roomId: string;
  user: UserInfo | null;
  users: UserInfo[];
  tool: ToolType;
  color: string;
  strokeWidth: number;
  connectionState: ConnectionState;
  canUndo: boolean;
  canRedo: boolean;
  isDrawing: boolean;
  activeStrokeId: string | null;
  operations: DrawOperation[];
  activeRemoteStrokes: Map<string, ActiveStroke>;
  stats: {
    fps: number;
    latencyMs: number;
    userCount: number;
    operationCount: number;
  };
}

export interface RemoteCursor {
  userId: string;
  userName: string;
  color: string;
  x: number;
  y: number;
  lastUpdate: number;
  element: HTMLElement;
}
