import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DrawingStateManager } from '../drawing-state.js';
import { RoomManager } from '../room-manager.js';
import {
  sanitizeRoomId,
  isValidColor,
  isValidStrokeWidth,
  isValidPoint,
  validateStrokeStart,
  validateStrokeChunk,
  validateStrokeEnd,
  validateCursor
} from '../validation.js';

describe('DrawingStateManager', () => {
  it('should track in-flight strokes and commit with server sequence numbers', () => {
    const manager = new DrawingStateManager();

    assert.equal(manager.getSequenceNumber(), 0);
    assert.equal(manager.canUndo(), false);
    assert.equal(manager.canRedo(), false);

    // Start stroke
    const stroke = manager.startStroke(
      'stroke-1',
      'user-1',
      'Alice',
      'brush',
      '#ef4444',
      6,
      { x: 10, y: 20 }
    );
    assert.equal(stroke.id, 'stroke-1');
    assert.equal(stroke.points.length, 1);
    assert.equal(manager.getActiveStrokes().length, 1);

    // Append chunk
    manager.appendChunk('stroke-1', [{ x: 15, y: 25 }, { x: 20, y: 30 }]);
    assert.equal(manager.getActiveStrokes()[0].points.length, 3);

    // End stroke
    const op = manager.endStroke('stroke-1', { x: 25, y: 35 });
    assert.ok(op);
    assert.equal(op.seq, 1);
    assert.equal(op.points.length, 4);
    assert.equal(manager.getOperations().length, 1);
    assert.equal(manager.getActiveStrokes().length, 0);
    assert.equal(manager.canUndo(), true);
    assert.equal(manager.canRedo(), false);
  });

  it('should support deterministic global collaborative undo and redo', () => {
    const manager = new DrawingStateManager();

    // User A draws op 1
    manager.startStroke('op-a', 'user-a', 'Alice', 'brush', '#ef4444', 4, { x: 0, y: 0 });
    const op1 = manager.endStroke('op-a', { x: 10, y: 10 })!;

    // User B draws op 2
    manager.startStroke('op-b', 'user-b', 'Bob', 'brush', '#3b82f6', 4, { x: 50, y: 50 });
    const op2 = manager.endStroke('op-b', { x: 60, y: 60 })!;

    assert.equal(op1.seq, 1);
    assert.equal(op2.seq, 2);
    assert.equal(manager.getOperations().length, 2);

    // User A triggers Undo -> Undoes User B's most recent operation (global timeline)
    const undoRes1 = manager.undo();
    assert.equal(undoRes1.undoneOp?.id, 'op-b');
    assert.equal(manager.getOperations().length, 1);
    assert.equal(manager.canUndo(), true);
    assert.equal(manager.canRedo(), true);

    // Redo restores User B's operation
    const redoRes1 = manager.redo();
    assert.equal(redoRes1.redoneOp?.id, 'op-b');
    assert.equal(manager.getOperations().length, 2);
    assert.equal(manager.canRedo(), false);

    // Undo both operations
    manager.undo(); // undo op-b
    manager.undo(); // undo op-a
    assert.equal(manager.getOperations().length, 0);
    assert.equal(manager.canUndo(), false);
    assert.equal(manager.canRedo(), true);

    // Redo op-a
    manager.redo();
    assert.equal(manager.getOperations().length, 1);
    assert.equal(manager.getOperations()[0].id, 'op-a');
  });

  it('should invalidate redo stack when a new operation is committed', () => {
    const manager = new DrawingStateManager();

    manager.startStroke('op-1', 'u1', 'User 1', 'brush', '#000', 2, { x: 1, y: 1 });
    manager.endStroke('op-1');

    manager.undo();
    assert.equal(manager.canRedo(), true);

    // Commit new operation
    manager.startStroke('op-2', 'u1', 'User 1', 'brush', '#000', 2, { x: 2, y: 2 });
    manager.endStroke('op-2');

    // Redo must now be invalid
    assert.equal(manager.canRedo(), false);
    assert.equal(manager.getOperations().length, 1);
    assert.equal(manager.getOperations()[0].id, 'op-2');
  });

  it('should clear canvas and reset history stacks', () => {
    const manager = new DrawingStateManager();

    manager.startStroke('op-1', 'u1', 'User 1', 'brush', '#000', 2, { x: 1, y: 1 });
    manager.endStroke('op-1');

    const clearSeq = manager.clear();
    assert.ok(clearSeq > 1);
    assert.equal(manager.getOperations().length, 0);
    assert.equal(manager.canUndo(), false);
    assert.equal(manager.canRedo(), false);
    assert.equal(manager.getActiveStrokes().length, 0);
  });

  it('should clean up and commit disconnected user active strokes', () => {
    const manager = new DrawingStateManager();

    manager.startStroke('stroke-u1', 'user-disc', 'Disconnecter', 'brush', '#000', 2, { x: 1, y: 1 });
    manager.appendChunk('stroke-u1', [{ x: 5, y: 5 }, { x: 10, y: 10 }]);

    const committed = manager.cleanupUserStrokes('user-disc');
    assert.equal(committed.length, 1);
    assert.equal(committed[0].id, 'stroke-u1');
    assert.equal(manager.getOperations().length, 1);
    assert.equal(manager.getActiveStrokes().length, 0);
  });
});

describe('RoomManager', () => {
  it('should manage room creation, user join, cursor updates, and departure', () => {
    const rm = new RoomManager();

    // User joins room
    const { user: user1, snapshot } = rm.joinRoom('test-room', 'socket-1', 'Alice');
    assert.equal(user1.name, 'Alice');
    assert.equal(snapshot.roomId, 'test-room');
    assert.equal(snapshot.users.length, 1);
    assert.equal(snapshot.you.id, 'socket-1');

    // Second user joins
    const { user: user2 } = rm.joinRoom('test-room', 'socket-2');
    assert.ok(user2.name.length > 0);
    assert.notEqual(user1.color, user2.color); // Distinct curated colors

    const users = rm.getRoomUsers('test-room');
    assert.equal(users.length, 2);

    // Update cursor
    rm.updateCursor('test-room', 'socket-1', 123.4, 567.8);
    const updatedUsers = rm.getRoomUsers('test-room');
    const u1 = updatedUsers.find(u => u.id === 'socket-1');
    assert.deepEqual(u1?.cursor, { x: 123.4, y: 567.8 });

    // User leaves
    const { leftUser, remainingUsers } = rm.leaveRoom('test-room', 'socket-1');
    assert.equal(leftUser?.id, 'socket-1');
    assert.equal(remainingUsers.length, 1);
    assert.equal(remainingUsers[0].id, 'socket-2');
  });
});

describe('Payload Validation', () => {
  it('should validate and sanitize room IDs', () => {
    assert.equal(sanitizeRoomId('room123').value, 'room123');
    assert.equal(sanitizeRoomId('  my-room_42  ').value, 'my-room_42');
    assert.equal(sanitizeRoomId('room with spaces').value, 'room-with-spaces');
    assert.equal(sanitizeRoomId('').valid, false);
    assert.equal(sanitizeRoomId(123).valid, false);
  });

  it('should validate points and colors', () => {
    assert.equal(isValidPoint({ x: 10, y: 20 }), true);
    assert.equal(isValidPoint({ x: '10', y: 20 }), false);
    assert.equal(isValidPoint({ x: NaN, y: 20 }), false);
    assert.equal(isValidPoint({ x: 999999, y: 0 }), false); // out of bounds

    assert.equal(isValidColor('#3b82f6'), true);
    assert.equal(isValidColor('#fff'), true);
    assert.equal(isValidColor('rgba(255, 0, 0, 0.5)'), true);
    assert.equal(isValidColor('not-a-color'), false);
    assert.equal(isValidColor(null), false);

    assert.equal(isValidStrokeWidth(4), true);
    assert.equal(isValidStrokeWidth(0), false);
    assert.equal(isValidStrokeWidth(200), false);
  });

  it('should validate stroke payloads', () => {
    const validStart = validateStrokeStart({
      id: 'stroke-1',
      tool: 'brush',
      color: '#ff0000',
      width: 5,
      point: { x: 10, y: 15 }
    });
    assert.equal(validStart.valid, true);

    const invalidStart = validateStrokeStart({
      id: '',
      tool: 'unknown',
      color: 'xyz'
    });
    assert.equal(invalidStart.valid, false);

    const validChunk = validateStrokeChunk({
      id: 'stroke-1',
      points: [{ x: 1, y: 2 }, { x: 3, y: 4 }]
    });
    assert.equal(validChunk.valid, true);

    const emptyChunk = validateStrokeChunk({
      id: 'stroke-1',
      points: []
    });
    assert.equal(emptyChunk.valid, false);

    const validEnd = validateStrokeEnd({
      id: 'stroke-1',
      point: { x: 10, y: 20 }
    });
    assert.equal(validEnd.valid, true);

    const validCursor = validateCursor({ x: 50, y: 100 });
    assert.equal(validCursor.valid, true);
  });
});
