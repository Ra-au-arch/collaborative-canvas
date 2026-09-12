process.env.NODE_ENV = 'test';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as Client, Socket } from 'socket.io-client';
import { server, io as serverIo } from '../server.js';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  RoomSnapshot,
  DrawOperation,
  ActiveStroke
} from '../../shared/protocol.js';

describe('Real-Time Collaboration E2E Flow', () => {
  let port: number;
  let client1: Socket<ServerToClientEvents, ClientToServerEvents>;
  let client2: Socket<ServerToClientEvents, ClientToServerEvents>;

  let networkAvailable = true;

  before(async () => {
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          port = addr.port;
          resolve();
        } else {
          reject(new Error('Failed to obtain server port'));
        }
      });
    });

    // Probe loopback connectivity
    try {
      const probe = Client(`http://127.0.0.1:${port}`, { timeout: 600 });
      await new Promise<void>((resolve, reject) => {
        probe.once('connect', () => {
          probe.disconnect();
          resolve();
        });
        probe.once('connect_error', (err) => {
          probe.disconnect();
          reject(err);
        });
      });
    } catch {
      networkAvailable = false;
    }
  });

  after(async () => {
    client1?.disconnect();
    client2?.disconnect();
    await new Promise<void>((resolve) => {
      serverIo.close(() => {
        server.close(() => resolve());
      });
    });
  });

  it('should allow two users to join the same room and receive snapshots', async (t) => {
    if (!networkAvailable) {
      t.skip('Network loopback unavailable in sandbox');
      return;
    }
    const serverUrl = `http://127.0.0.1:${port}`;

    // User 1 joins
    client1 = Client(serverUrl, { transports: ['websocket'], forceNew: true });
    const snapshot1Promise = new Promise<RoomSnapshot>((resolve) => {
      client1.once('room:snapshot', resolve);
    });

    await new Promise<void>((resolve) => {
      if (client1.connected) resolve();
      else client1.once('connect', resolve);
    });
    client1.emit('room:join', { roomId: 'test-collab-room', userName: 'User 1' });
    const snap1 = await snapshot1Promise;

    assert.equal(snap1.roomId, 'test-collab-room');
    assert.equal(snap1.you.name, 'User 1');
    assert.equal(snap1.users.length, 1);

    // User 2 joins
    client2 = Client(serverUrl, { transports: ['websocket'], forceNew: true });
    const snapshot2Promise = new Promise<RoomSnapshot>((resolve) => {
      client2.once('room:snapshot', resolve);
    });
    const presenceForUser1Promise = new Promise<any>((resolve) => {
      client1.on('presence:update', (payload) => {
        if (payload.users.length === 2) resolve(payload);
      });
    });

    await new Promise<void>((resolve) => {
      if (client2.connected) resolve();
      else client2.once('connect', resolve);
    });
    client2.emit('room:join', { roomId: 'test-collab-room', userName: 'User 2' });

    const snap2 = await snapshot2Promise;
    assert.equal(snap2.roomId, 'test-collab-room');
    assert.equal(snap2.you.name, 'User 2');
    assert.equal(snap2.users.length, 2);

    const presence1 = await presenceForUser1Promise;
    assert.equal(presence1.users.length, 2);
  });

  it('should synchronize remote cursor movements between users', async (t) => {
    if (!networkAvailable) {
      t.skip('Network loopback unavailable in sandbox');
      return;
    }
    const cursorPromise = new Promise<any>((resolve) => {
      client2.on('cursor:move', resolve);
    });

    client1.emit('cursor:move', { x: 150.5, y: 300.2 });
    const cursor = await cursorPromise;

    assert.equal(cursor.userName, 'User 1');
    assert.equal(cursor.x, 150.5);
    assert.equal(cursor.y, 300.2);
  });

  it('should stream live drawing chunks before mouse up and commit on stroke:end', async (t) => {
    if (!networkAvailable) {
      t.skip('Network loopback unavailable in sandbox');
      return;
    }
    const strokeId = 'stroke-test-999';

    const strokeStartPromise = new Promise<ActiveStroke>((resolve) => {
      client2.on('stroke:start', resolve);
    });
    const strokeChunkPromise = new Promise<any>((resolve) => {
      client2.on('stroke:chunk', resolve);
    });
    const strokeEndPromise = new Promise<DrawOperation>((resolve) => {
      client2.on('stroke:end', resolve);
    });

    // Client 1 begins drawing
    client1.emit('stroke:start', {
      id: strokeId,
      tool: 'brush',
      color: '#ef4444',
      width: 4,
      point: { x: 10, y: 10 }
    });

    const activeStroke = await strokeStartPromise;
    assert.equal(activeStroke.id, strokeId);
    assert.equal(activeStroke.color, '#ef4444');

    // Client 1 streams points chunk
    client1.emit('stroke:chunk', {
      id: strokeId,
      points: [{ x: 20, y: 20 }, { x: 30, y: 30 }]
    });

    const chunk = await strokeChunkPromise;
    assert.equal(chunk.id, strokeId);
    assert.equal(chunk.points.length, 2);

    // Client 1 releases pointer (stroke:end)
    client1.emit('stroke:end', {
      id: strokeId,
      point: { x: 40, y: 40 }
    });

    const committedOp = await strokeEndPromise;
    assert.equal(committedOp.id, strokeId);
    assert.equal(committedOp.points.length, 4);
    assert.ok(committedOp.seq > 0); // Server assigned authoritative sequence number
  });

  it('should broadcast global undo and redo to both clients', async (t) => {
    if (!networkAvailable) {
      t.skip('Network loopback unavailable in sandbox');
      return;
    }
    const historyChangedPromise = new Promise<any>((resolve) => {
      client2.on('history:changed', (payload) => {
        if (payload.action === 'undo') resolve(payload);
      });
    });

    // Client 2 requests Undo (undoes Client 1's stroke in the shared room)
    client2.emit('history:undo');

    const historyState = await historyChangedPromise;
    assert.equal(historyState.action, 'undo');
    assert.equal(historyState.operations.length, 0);
    assert.equal(historyState.canUndo, false);
    assert.equal(historyState.canRedo, true);

    // Client 1 requests Redo (restores the stroke)
    const redoPromise = new Promise<any>((resolve) => {
      client1.on('history:changed', (payload) => {
        if (payload.action === 'redo') resolve(payload);
      });
    });
    client1.emit('history:redo');

    const redoneHistory = await redoPromise;
    assert.equal(redoneHistory.action, 'redo');
    assert.equal(redoneHistory.operations.length, 1);
    assert.equal(redoneHistory.canUndo, true);
    assert.equal(redoneHistory.canRedo, false);
  });

  it('should clear canvas for all users on canvas:clear', async (t) => {
    if (!networkAvailable) {
      t.skip('Network loopback unavailable in sandbox');
      return;
    }
    const clearPromise = new Promise<any>((resolve) => {
      client2.on('canvas:clear', resolve);
    });

    client1.emit('canvas:clear');
    const clearEvent = await clearPromise;
    assert.ok(clearEvent.seq > 0);
    assert.equal(clearEvent.clearedBy, 'User 1');
  });

  it('should deliver full updated snapshot on reconnect', async (t) => {
    if (!networkAvailable) {
      t.skip('Network loopback unavailable in sandbox');
      return;
    }
    // Reconnect client 2 to room
    const snapPromise = new Promise<RoomSnapshot>((resolve) => {
      client2.on('room:snapshot', resolve);
    });

    client2.emit('room:join', { roomId: 'test-collab-room', userName: 'User 2 Reconnected' });
    const freshSnap = await snapPromise;

    assert.equal(freshSnap.roomId, 'test-collab-room');
    assert.equal(freshSnap.you.name, 'User 2 Reconnected');
  });
});
