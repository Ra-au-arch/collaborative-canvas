import { CanvasManager } from './canvas.js';
import { SocketClient } from './socket.js';
import { UIManager } from './ui.js';
import { ClientAppState, ConnectionState } from './types.js';
import { Point, ToolType, UserInfo, DrawOperation } from '../shared/protocol.js';

class CollaborativeCanvasApp {
  private canvasManager!: CanvasManager;
  private socketClient!: SocketClient;
  private uiManager!: UIManager;

  private state: ClientAppState = {
    roomId: 'default',
    user: null,
    users: [],
    tool: 'brush',
    color: '#3b82f6',
    strokeWidth: 4,
    connectionState: 'connecting',
    canUndo: false,
    canRedo: false,
    isDrawing: false,
    activeStrokeId: null,
    operations: [],
    activeRemoteStrokes: new Map(),
    stats: {
      fps: 60,
      latencyMs: 0,
      userCount: 1,
      operationCount: 0
    }
  };

  // FPS calculation
  private frameCount: number = 0;
  private lastFpsTime: number = performance.now();

  constructor() {
    this.initRoomFromUrl();
    this.initUI();
    this.initCanvas();
    this.initSocket();
    this.setupWindowEvents();
    this.startFpsLoop();
  }

  /**
   * Parse room query parameter from URL (e.g. ?room=design-room).
   */
  private initRoomFromUrl(): void {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam && roomParam.trim().length > 0) {
      this.state.roomId = roomParam.trim().slice(0, 64);
    } else {
      this.state.roomId = 'demo';
      this.updateUrlRoom(this.state.roomId, true);
    }
  }

  private updateUrlRoom(room: string, replace: boolean = false): void {
    const url = new URL(window.location.href);
    url.searchParams.set('room', room);
    if (replace) {
      window.history.replaceState({}, '', url.toString());
    } else {
      window.history.pushState({}, '', url.toString());
    }
  }

  private initUI(): void {
    this.uiManager = new UIManager({
      onToolSelect: (tool: ToolType) => {
        this.state.tool = tool;
        this.canvasManager.setTool(tool);
      },
      onColorSelect: (color: string) => {
        this.state.color = color;
        this.canvasManager.setColor(color);
      },
      onWidthSelect: (width: number) => {
        this.state.strokeWidth = width;
        this.canvasManager.setStrokeWidth(width);
      },
      onUndo: () => {
        this.socketClient.emitUndo();
      },
      onRedo: () => {
        this.socketClient.emitRedo();
      },
      onClear: () => {
        this.socketClient.emitClear();
      },
      onRoomChange: (newRoom: string) => {
        if (newRoom === this.state.roomId) return;
        this.switchRoom(newRoom);
      }
    });

    this.uiManager.setRoomName(this.state.roomId);
    this.uiManager.setConnectionState(this.state.connectionState);
  }

  private initCanvas(): void {
    const container = document.getElementById('canvasContainer')!;
    const mainCanvas = document.getElementById('mainCanvas') as HTMLCanvasElement;
    const draftCanvas = document.getElementById('draftCanvas') as HTMLCanvasElement;

    this.canvasManager = new CanvasManager({
      container,
      mainCanvas,
      draftCanvas,
      onStrokeStart: (tool: ToolType, color: string, width: number, startPoint: Point) => {
        this.uiManager.hideOnboardingHint();
        this.state.isDrawing = true;
        this.state.activeStrokeId = `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

        this.socketClient.emitStrokeStart({
          id: this.state.activeStrokeId,
          tool,
          color,
          width,
          point: startPoint
        });
      },
      onStrokeChunk: (points: Point[]) => {
        if (this.state.activeStrokeId && points.length > 0) {
          this.socketClient.emitStrokeChunk({
            id: this.state.activeStrokeId,
            points
          });
        }
      },
      onStrokeEnd: (finalPoint?: Point) => {
        if (this.state.activeStrokeId) {
          this.socketClient.emitStrokeEnd({
            id: this.state.activeStrokeId,
            point: finalPoint
          });
          this.state.activeStrokeId = null;
        }
        this.state.isDrawing = false;
      },
      onPointerMove: (point: Point) => {
        this.socketClient.emitCursorMove(point);
      }
    });

    // Synchronize initial tool & color values
    this.canvasManager.setTool(this.state.tool);
    this.canvasManager.setColor(this.state.color);
    this.canvasManager.setStrokeWidth(this.state.strokeWidth);
  }

  private initSocket(): void {
    this.socketClient = new SocketClient({
      onConnectionChange: (connState: ConnectionState) => {
        this.state.connectionState = connState;
        this.uiManager.setConnectionState(connState);
      },
      onSnapshot: (snapshot) => {
        this.state.user = snapshot.you;
        this.state.users = snapshot.users;
        this.state.operations = snapshot.operations;
        this.state.canUndo = snapshot.canUndo;
        this.state.canRedo = snapshot.canRedo;

        this.uiManager.setRoomName(snapshot.roomId);
        this.uiManager.updateUsersList(snapshot.users, snapshot.you.id);
        this.uiManager.updateHistoryButtons(snapshot.canUndo, snapshot.canRedo);

        // Load committed operations onto canvas
        this.canvasManager.setOperations(snapshot.operations);

        // If snapshot has historical operations, hide onboarding hint
        if (snapshot.operations.length > 0) {
          this.uiManager.hideOnboardingHint();
        }

        this.state.stats.userCount = snapshot.users.length;
        this.state.stats.operationCount = snapshot.operations.length;
        this.syncDiagnostics();
      },
      onPresenceUpdate: (payload) => {
        this.state.users = payload.users;
        this.state.stats.userCount = payload.users.length;

        if (this.state.user) {
          this.uiManager.updateUsersList(payload.users, this.state.user.id);
        }

        if (payload.leftUserId) {
          this.uiManager.removeRemoteCursor(payload.leftUserId);
        }

        if (payload.joinedUser && payload.joinedUser.id !== this.state.user?.id) {
          this.uiManager.showToast(`👋 ${payload.joinedUser.name} joined`);
        }

        this.syncDiagnostics();
      },
      onRemoteCursor: (payload) => {
        this.uiManager.updateRemoteCursor(
          payload.userId,
          payload.userName,
          payload.color,
          { x: payload.x, y: payload.y }
        );
      },
      onRemoteStrokeStart: (stroke) => {
        this.uiManager.hideOnboardingHint();
        this.canvasManager.handleRemoteStrokeStart(stroke);
      },
      onRemoteStrokeChunk: (payload) => {
        this.canvasManager.handleRemoteStrokeChunk(payload.id, payload.points);
      },
      onRemoteStrokeEnd: (operation: DrawOperation) => {
        this.canvasManager.commitOperation(operation);
        this.state.stats.operationCount += 1;
        this.syncDiagnostics();
      },
      onCanvasClear: (payload) => {
        this.canvasManager.clearCanvas();
        this.state.stats.operationCount = 0;
        this.uiManager.updateHistoryButtons(false, false);
        this.uiManager.showToast(`🧹 Canvas cleared by ${payload.clearedBy}`);
        this.syncDiagnostics();
      },
      onHistoryChanged: (payload) => {
        this.state.operations = payload.operations;
        this.state.canUndo = payload.canUndo;
        this.state.canRedo = payload.canRedo;
        this.state.stats.operationCount = payload.operations.length;

        this.canvasManager.setOperations(payload.operations);
        this.uiManager.updateHistoryButtons(payload.canUndo, payload.canRedo);
        this.syncDiagnostics();
      },
      onError: (err) => {
        this.uiManager.showToast(`⚠️ Error: ${err.message}`, 4000);
      },
      onPong: (latencyMs) => {
        this.state.stats.latencyMs = latencyMs;
        this.syncDiagnostics();
      }
    });

    // Initiate connection
    this.socketClient.connect(this.state.roomId);
  }

  private switchRoom(newRoom: string): void {
    this.state.roomId = newRoom;
    this.updateUrlRoom(newRoom);
    this.uiManager.setRoomName(newRoom);
    this.canvasManager.clearCanvas();
    this.socketClient.joinRoom(newRoom);
    this.uiManager.showToast(`Switched to room: ${newRoom}`);
  }

  private setupWindowEvents(): void {
    // Responsive canvas resizing with debouncing
    let resizeTimer: number | null = null;
    window.addEventListener('resize', () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        this.canvasManager.initCanvasSize();
        this.syncDiagnostics();
      }, 100);
    });

    // Handle browser navigation (back / forward)
    window.addEventListener('popstate', () => {
      const params = new URLSearchParams(window.location.search);
      const room = params.get('room') || 'demo';
      if (room !== this.state.roomId) {
        this.state.roomId = room;
        this.uiManager.setRoomName(room);
        this.socketClient.joinRoom(room);
      }
    });
  }

  private startFpsLoop(): void {
    const loop = (now: number) => {
      this.frameCount += 1;
      const delta = now - this.lastFpsTime;

      if (delta >= 1000) {
        this.state.stats.fps = Math.round((this.frameCount * 1000) / delta);
        this.frameCount = 0;
        this.lastFpsTime = now;
        this.syncDiagnostics();
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }

  private syncDiagnostics(): void {
    this.uiManager.updateDiagnostics({
      fps: this.state.stats.fps,
      latencyMs: this.state.stats.latencyMs,
      userCount: this.state.stats.userCount,
      operationCount: this.state.stats.operationCount,
      dpr: window.devicePixelRatio || 1
    });
  }
}

// Bootstrap on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new CollaborativeCanvasApp());
} else {
  new CollaborativeCanvasApp();
}
