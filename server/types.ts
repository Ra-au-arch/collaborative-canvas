import { UserInfo, DrawOperation, ActiveStroke } from '../shared/protocol.js';

export interface RoomUser extends UserInfo {
  socketId: string;
}

export interface RoomState {
  roomId: string;
  users: Map<string, RoomUser>;
  operations: DrawOperation[];
  undoStack: DrawOperation[];
  activeStrokes: Map<string, ActiveStroke>;
  sequenceNumber: number;
  lastActivity: number;
}
