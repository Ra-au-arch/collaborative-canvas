import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  ToolType,
  Point
} from '../shared/protocol.js';
import { RoomManager } from './room-manager.js';
import {
  sanitizeRoomId,
  sanitizeUserName,
  validateCursor,
  validateStrokeStart,
  validateStrokeChunk,
  validateStrokeEnd,
  validateReaction
} from './validation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 10000,
  pingInterval: 5000
});

const roomManager = new RoomManager();

// Track which room each socket is currently in
const socketRoomMap = new Map<string, string>();

// Serve client static build files
const publicDir = path.resolve(__dirname, '../public');
app.use(express.static(publicDir));

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

// Active rooms endpoint for room discovery
app.get('/api/rooms', (_req, res) => {
  res.json({
    rooms: roomManager.getActiveRooms()
  });
});

// Single-page application fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Socket.IO event controllers
io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  socket.on('room:join', (payload) => {
    const roomValidation = sanitizeRoomId(payload?.roomId);
    if (!roomValidation.valid || !roomValidation.value) {
      socket.emit('app:error', {
        code: 'INVALID_ROOM_ID',
        message: roomValidation.error || 'Invalid Room ID'
      });
      return;
    }

    const roomId = roomValidation.value;
    const userName = sanitizeUserName(payload?.userName);

    // If socket was in a previous room, clean up
    const prevRoomId = socketRoomMap.get(socket.id);
    if (prevRoomId) {
      socket.leave(prevRoomId);
      const { leftUser, remainingUsers, finalizedOps } = roomManager.leaveRoom(prevRoomId, socket.id);
      if (leftUser) {
        io.to(prevRoomId).emit('presence:update', {
          users: remainingUsers,
          leftUserId: socket.id
        });
        for (const op of finalizedOps) {
          io.to(prevRoomId).emit('stroke:end', op);
        }
      }
    }

    // Join new room
    socket.join(roomId);
    socketRoomMap.set(socket.id, roomId);

    const { user, snapshot } = roomManager.joinRoom(roomId, socket.id, userName);

    // Send authoritative full state snapshot to the joining user
    socket.emit('room:snapshot', snapshot);

    // Broadcast updated presence to all clients in the room
    io.to(roomId).emit('presence:update', {
      users: roomManager.getRoomUsers(roomId),
      joinedUser: snapshot.you
    });
  });

  socket.on('cursor:move', (payload) => {
    const roomId = socketRoomMap.get(socket.id);
    if (!roomId) return;

    const validation = validateCursor(payload);
    if (!validation.valid || !validation.value) return;

    const user = roomManager.updateCursor(roomId, socket.id, validation.value.x, validation.value.y);
    if (!user) return;

    // Broadcast cursor position to all OTHER users in the room
    socket.to(roomId).emit('cursor:move', {
      userId: user.id,
      userName: user.name,
      color: user.color,
      x: validation.value.x,
      y: validation.value.y
    });
  });

  socket.on('stroke:start', (payload) => {
    const roomId = socketRoomMap.get(socket.id);
    if (!roomId) return;

    const validation = validateStrokeStart(payload);
    if (!validation.valid || !validation.value) {
      socket.emit('app:error', {
        code: 'INVALID_STROKE_START',
        message: validation.error || 'Invalid stroke start payload'
      });
      return;
    }

    const drawing = roomManager.getDrawingManager(roomId);
    const users = roomManager.getRoomUsers(roomId);
    const currentUser = users.find(u => u.id === socket.id);
    if (!drawing || !currentUser) return;

    const stroke = drawing.startStroke(
      validation.value.id,
      currentUser.id,
      currentUser.name,
      validation.value.tool,
      validation.value.color,
      validation.value.width,
      validation.value.point,
      validation.value.text
    );

    // Stream live stroke start to all peers in the room
    socket.to(roomId).emit('stroke:start', stroke);
  });

  socket.on('stroke:chunk', (payload) => {
    const roomId = socketRoomMap.get(socket.id);
    if (!roomId) return;

    const validation = validateStrokeChunk(payload);
    if (!validation.valid || !validation.value) return;

    const drawing = roomManager.getDrawingManager(roomId);
    if (!drawing) return;

    const updated = drawing.appendChunk(validation.value.id, validation.value.points);
    if (!updated) return;

    // Stream live chunk points to all peers in the room
    socket.to(roomId).emit('stroke:chunk', {
      id: validation.value.id,
      userId: socket.id,
      points: validation.value.points
    });
  });

  socket.on('stroke:end', (payload) => {
    const roomId = socketRoomMap.get(socket.id);
    if (!roomId) return;

    const validation = validateStrokeEnd(payload);
    if (!validation.valid || !validation.value) return;

    const drawing = roomManager.getDrawingManager(roomId);
    if (!drawing) return;

    const committedOp = drawing.endStroke(
      validation.value.id,
      validation.value.point,
      validation.value.text
    );
    if (!committedOp) return;

    // Authoritative commit: broadcast committed operation with server sequence number to ALL clients
    io.to(roomId).emit('stroke:end', committedOp);

    // Notify history state update (redo stack invalidated on new commit)
    io.to(roomId).emit('history:changed', {
      operations: drawing.getOperations(),
      canUndo: drawing.canUndo(),
      canRedo: drawing.canRedo(),
      action: 'commit',
      affectedOpId: committedOp.id
    });
  });

  socket.on('history:undo', () => {
    const roomId = socketRoomMap.get(socket.id);
    if (!roomId) return;

    const drawing = roomManager.getDrawingManager(roomId);
    if (!drawing) return;

    const result = drawing.undo();
    if (result.undoneOp) {
      io.to(roomId).emit('history:changed', {
        operations: drawing.getOperations(),
        canUndo: result.canUndo,
        canRedo: result.canRedo,
        action: 'undo',
        affectedOpId: result.undoneOp.id
      });
    }
  });

  socket.on('history:redo', () => {
    const roomId = socketRoomMap.get(socket.id);
    if (!roomId) return;

    const drawing = roomManager.getDrawingManager(roomId);
    if (!drawing) return;

    const result = drawing.redo();
    if (result.redoneOp) {
      io.to(roomId).emit('history:changed', {
        operations: drawing.getOperations(),
        canUndo: result.canUndo,
        canRedo: result.canRedo,
        action: 'redo',
        affectedOpId: result.redoneOp.id
      });
    }
  });

  socket.on('canvas:clear', () => {
    const roomId = socketRoomMap.get(socket.id);
    if (!roomId) return;

    const drawing = roomManager.getDrawingManager(roomId);
    const users = roomManager.getRoomUsers(roomId);
    const currentUser = users.find(u => u.id === socket.id);
    if (!drawing || !currentUser) return;

    const seq = drawing.clear();

    io.to(roomId).emit('canvas:clear', {
      clearedBy: currentUser.name,
      seq
    });

    io.to(roomId).emit('history:changed', {
      operations: [],
      canUndo: false,
      canRedo: false,
      action: 'clear'
    });
  });

  socket.on('reaction:send', (payload) => {
    const roomId = socketRoomMap.get(socket.id);
    if (!roomId) return;

    const validation = validateReaction(payload);
    if (!validation.valid || !validation.value) return;

    const users = roomManager.getRoomUsers(roomId);
    const currentUser = users.find(u => u.id === socket.id);
    if (!currentUser) return;

    // Broadcast reaction to everyone in the room (including sender for feedback)
    io.to(roomId).emit('reaction:receive', {
      userId: currentUser.id,
      userName: currentUser.name,
      color: currentUser.color,
      emoji: validation.value.emoji,
      x: validation.value.x,
      y: validation.value.y,
      timestamp: Date.now()
    });
  });

  socket.on('client:ping', (payload) => {
    socket.emit('server:pong', {
      clientTimestamp: payload?.timestamp || Date.now(),
      serverTimestamp: Date.now()
    });
  });

  socket.on('disconnect', () => {
    const roomId = socketRoomMap.get(socket.id);
    if (!roomId) return;

    socketRoomMap.delete(socket.id);
    const { leftUser, remainingUsers, finalizedOps } = roomManager.leaveRoom(roomId, socket.id);

    if (leftUser) {
      io.to(roomId).emit('presence:update', {
        users: remainingUsers,
        leftUserId: socket.id
      });

      // If user had an in-flight stroke with points, commit and notify room
      for (const op of finalizedOps) {
        io.to(roomId).emit('stroke:end', op);
      }
    }
  });
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    const port = process.env.PORT || 3000;
    console.error(`\n⚠️  Port ${port} is already in use by another running server instance.`);
    console.error(`👉 If another server instance is already running, open http://localhost:${port}`);
    console.error(`👉 Or stop the process using port ${port} by running: npm run kill\n`);
    process.exit(1);
  } else {
    throw err;
  }
});

export function startServer(port: number = Number(process.env.PORT) || 3000) {
  return server.listen(port, () => {
    console.log(`🚀 Collaborative Canvas Server listening on port ${port}`);
    console.log(`   Local URL: http://localhost:${port}`);
  });
}

const isMain = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts');
const isRunningInTest =
  process.env.NODE_ENV === 'test' ||
  !!process.env.NODE_TEST_CONTEXT ||
  process.execArgv.includes('--test') ||
  process.argv.some((arg) => arg.includes('test'));

if (isMain && !isRunningInTest) {
  startServer();
}

export { app, server, io, roomManager };
