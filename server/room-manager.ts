import { RoomState, RoomUser } from './types.js';
import { DrawingStateManager } from './drawing-state.js';
import { RoomSnapshot, UserInfo } from '../shared/protocol.js';

const CURATED_COLORS = [
  '#f43f5e', // Rose
  '#3b82f6', // Blue
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#8b5cf6', // Violet
  '#06b6d4', // Cyan
  '#ec4899', // Pink
  '#84cc16', // Lime
  '#d946ef', // Fuchsia
  '#14b8a6', // Teal
  '#f97316', // Orange
  '#6366f1'  // Indigo
];

const ADJECTIVES = [
  'Cosmic', 'Solar', 'Velvet', 'Neon', 'Swift', 'Silent',
  'Golden', 'Silver', 'Emerald', 'Azure', 'Crimson', 'Shadow'
];

const ANIMALS = [
  'Fox', 'Falcon', 'Lynx', 'Panda', 'Otter', 'Tiger',
  'Hawk', 'Wolf', 'Owl', 'Cheetah', 'Raven', 'Dolphin'
];

export class RoomManager {
  private rooms: Map<string, {
    state: RoomState;
    drawing: DrawingStateManager;
  }> = new Map();

  private userColorIndex: number = 0;

  /**
   * Get an existing room or create a new one.
   */
  public getOrCreateRoom(roomId: string): {
    state: RoomState;
    drawing: DrawingStateManager;
  } {
    let room = this.rooms.get(roomId);
    if (!room) {
      const state: RoomState = {
        roomId,
        users: new Map(),
        operations: [],
        undoStack: [],
        activeStrokes: new Map(),
        sequenceNumber: 0,
        lastActivity: Date.now()
      };
      const drawing = new DrawingStateManager();
      room = { state, drawing };
      this.rooms.set(roomId, room);
    }
    room.state.lastActivity = Date.now();
    return room;
  }

  /**
   * Generate a readable random display name.
   */
  public generateDisplayName(): string {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    const num = Math.floor(10 + Math.random() * 90);
    return `${adj} ${animal} ${num}`;
  }

  /**
   * Pick next distinct color from curated palette.
   */
  public assignColor(): string {
    const color = CURATED_COLORS[this.userColorIndex % CURATED_COLORS.length];
    this.userColorIndex += 1;
    return color;
  }

  /**
   * Add a user to a room.
   */
  public joinRoom(
    roomId: string,
    socketId: string,
    customName?: string
  ): { user: RoomUser; snapshot: RoomSnapshot } {
    const { state, drawing } = this.getOrCreateRoom(roomId);

    const name = customName?.trim() || this.generateDisplayName();
    const color = this.assignColor();

    const user: RoomUser = {
      id: socketId,
      socketId,
      name,
      color,
      cursor: null,
      joinedAt: Date.now()
    };

    state.users.set(socketId, user);
    state.lastActivity = Date.now();

    const snapshot = this.getSnapshot(roomId, socketId);
    return { user, snapshot };
  }

  /**
   * Remove a user from a room on disconnect.
   */
  public leaveRoom(roomId: string, socketId: string): {
    leftUser: RoomUser | null;
    remainingUsers: UserInfo[];
    finalizedOps: import('../shared/protocol.js').DrawOperation[];
  } {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { leftUser: null, remainingUsers: [], finalizedOps: [] };
    }

    const { state, drawing } = room;
    const leftUser = state.users.get(socketId) || null;
    state.users.delete(socketId);

    // Finalize any in-flight strokes started by this user
    const finalizedOps = drawing.cleanupUserStrokes(socketId);

    state.lastActivity = Date.now();

    // If room is empty, we keep it for a short time or clean up if memory constrained
    if (state.users.size === 0) {
      // Room remains available in memory for rejoining with drawing history
    }

    const remainingUsers = this.getRoomUsers(roomId);
    return { leftUser, remainingUsers, finalizedOps };
  }

  /**
   * Update a user's cursor position.
   */
  public updateCursor(
    roomId: string,
    socketId: string,
    x: number,
    y: number
  ): RoomUser | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const user = room.state.users.get(socketId);
    if (!user) return null;

    user.cursor = { x, y };
    return user;
  }

  /**
   * Get all active users in a room.
   */
  public getRoomUsers(roomId: string): UserInfo[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    return Array.from(room.state.users.values()).map(u => ({
      id: u.id,
      name: u.name,
      color: u.color,
      cursor: u.cursor,
      joinedAt: u.joinedAt
    }));
  }

  /**
   * Build full RoomSnapshot for a given user.
   */
  public getSnapshot(roomId: string, socketId: string): RoomSnapshot {
    const { state, drawing } = this.getOrCreateRoom(roomId);
    const user = state.users.get(socketId) || {
      id: socketId,
      name: 'Anonymous',
      color: '#3b82f6',
      joinedAt: Date.now()
    };

    return {
      roomId,
      you: {
        id: user.id,
        name: user.name,
        color: user.color,
        joinedAt: user.joinedAt
      },
      users: this.getRoomUsers(roomId),
      operations: drawing.getOperations(),
      activeStrokes: drawing.getActiveStrokes(),
      canUndo: drawing.canUndo(),
      canRedo: drawing.canRedo(),
      serverTime: Date.now()
    };
  }

  /**
   * Retrieve room drawing manager.
   */
  public getDrawingManager(roomId: string): DrawingStateManager | null {
    const room = this.rooms.get(roomId);
    return room ? room.drawing : null;
  }

  /**
   * List all currently active rooms.
   */
  public getActiveRooms(): { roomId: string; userCount: number; opCount: number }[] {
    const list: { roomId: string; userCount: number; opCount: number }[] = [];
    for (const [roomId, room] of this.rooms.entries()) {
      list.push({
        roomId,
        userCount: room.state.users.size,
        opCount: room.drawing.getOperations().length
      });
    }
    return list;
  }
}
