/**
 * Real-Time Collaborative Drawing Canvas - Shared Protocol & Types
 * Defines data structures, event names, and payload contracts shared
 * between client and server.
 */

export type ToolType = 'brush' | 'eraser';

export interface Point {
  x: number;
  y: number;
}

export interface UserInfo {
  id: string;
  name: string;
  color: string;
  cursor?: Point | null;
  joinedAt: number;
}

/**
 * Committed drawing operation.
 * Each committed operation has an authoritative server sequence number (seq).
 */
export interface DrawOperation {
  id: string;
  seq: number;
  userId: string;
  userName: string;
  tool: ToolType;
  color: string;
  width: number;
  points: Point[];
  timestamp: number;
}

/**
 * Active stroke in progress (before mouse/pointer up).
 */
export interface ActiveStroke {
  id: string;
  userId: string;
  userName: string;
  tool: ToolType;
  color: string;
  width: number;
  points: Point[];
  startTime: number;
}

/**
 * Full state snapshot of a room, sent upon joining or reconnecting.
 */
export interface RoomSnapshot {
  roomId: string;
  you: UserInfo;
  users: UserInfo[];
  operations: DrawOperation[];
  activeStrokes: ActiveStroke[];
  canUndo: boolean;
  canRedo: boolean;
  serverTime: number;
}

/**
 * Client to Server Events
 */
export interface ClientToServerEvents {
  'room:join': (payload: { roomId: string; userName?: string }) => void;
  'cursor:move': (payload: { x: number; y: number }) => void;
  'stroke:start': (payload: {
    id: string;
    tool: ToolType;
    color: string;
    width: number;
    point: Point;
  }) => void;
  'stroke:chunk': (payload: { id: string; points: Point[] }) => void;
  'stroke:end': (payload: { id: string; point?: Point }) => void;
  'canvas:clear': () => void;
  'history:undo': () => void;
  'history:redo': () => void;
  'client:ping': (payload: { timestamp: number }) => void;
}

/**
 * Server to Client Events
 */
export interface ServerToClientEvents {
  'room:snapshot': (snapshot: RoomSnapshot) => void;
  'presence:update': (payload: {
    users: UserInfo[];
    joinedUser?: UserInfo;
    leftUserId?: string;
  }) => void;
  'cursor:move': (payload: {
    userId: string;
    userName: string;
    color: string;
    x: number;
    y: number;
  }) => void;
  'stroke:start': (stroke: ActiveStroke) => void;
  'stroke:chunk': (payload: { id: string; userId: string; points: Point[] }) => void;
  'stroke:end': (operation: DrawOperation) => void;
  'canvas:clear': (payload: { clearedBy: string; seq: number }) => void;
  'history:changed': (payload: {
    operations: DrawOperation[];
    canUndo: boolean;
    canRedo: boolean;
    action: 'undo' | 'redo' | 'clear' | 'commit';
    affectedOpId?: string;
  }) => void;
  'app:error': (payload: { code: string; message: string }) => void;
  'server:pong': (payload: { clientTimestamp: number; serverTimestamp: number }) => void;
}
