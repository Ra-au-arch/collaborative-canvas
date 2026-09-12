import { Point, ToolType, DrawOperation, ActiveStroke } from '../shared/protocol.js';

export const CANVAS_BG = '#ffffff';

export interface CanvasManagerOptions {
  container: HTMLElement;
  mainCanvas: HTMLCanvasElement;
  draftCanvas: HTMLCanvasElement;
  onStrokeStart: (tool: ToolType, color: string, width: number, startPoint: Point) => void;
  onStrokeChunk: (points: Point[]) => void;
  onStrokeEnd: (finalPoint?: Point) => void;
  onPointerMove: (point: Point) => void;
}

export class CanvasManager {
  private container: HTMLElement;
  private mainCanvas: HTMLCanvasElement;
  private draftCanvas: HTMLCanvasElement;
  private mainCtx: CanvasRenderingContext2D;
  private draftCtx: CanvasRenderingContext2D;

  private dpr: number = 1;
  private logicalWidth: number = 0;
  private logicalHeight: number = 0;

  // Active local stroke state
  private isDrawing: boolean = false;
  private currentTool: ToolType = 'brush';
  private currentColor: string = '#3b82f6';
  private currentWidth: number = 4;
  private localStrokePoints: Point[] = [];
  private pendingChunkPoints: Point[] = [];
  private chunkTimer: number | null = null;

  // Callbacks
  private onStrokeStartCb: CanvasManagerOptions['onStrokeStart'];
  private onStrokeChunkCb: CanvasManagerOptions['onStrokeChunk'];
  private onStrokeEndCb: CanvasManagerOptions['onStrokeEnd'];
  private onPointerMoveCb: CanvasManagerOptions['onPointerMove'];

  // Canonical operations for full redraw
  private operations: DrawOperation[] = [];
  // Remote active strokes in flight
  private remoteActiveStrokes: Map<string, ActiveStroke> = new Map();

  // Pointer move throttling
  private lastPointerMoveTime: number = 0;
  private pointerThrottleMs: number = 35; // ~30Hz cursor updates

  constructor(options: CanvasManagerOptions) {
    this.container = options.container;
    this.mainCanvas = options.mainCanvas;
    this.draftCanvas = options.draftCanvas;

    const mainCtx = this.mainCanvas.getContext('2d', { alpha: true });
    const draftCtx = this.draftCanvas.getContext('2d', { alpha: true });

    if (!mainCtx || !draftCtx) {
      throw new Error('Failed to get 2D canvas rendering contexts');
    }

    this.mainCtx = mainCtx;
    this.draftCtx = draftCtx;

    this.onStrokeStartCb = options.onStrokeStart;
    this.onStrokeChunkCb = options.onStrokeChunk;
    this.onStrokeEndCb = options.onStrokeEnd;
    this.onPointerMoveCb = options.onPointerMove;

    this.initCanvasSize();
    this.setupListeners();
  }

  /**
   * Configure device-pixel-ratio aware sizing for both canvases.
   */
  public initCanvasSize(): void {
    const rect = this.container.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.logicalWidth = rect.width;
    this.logicalHeight = rect.height;

    const physicalWidth = Math.max(1, Math.floor(this.logicalWidth * this.dpr));
    const physicalHeight = Math.max(1, Math.floor(this.logicalHeight * this.dpr));

    // Resize Main Canvas
    this.mainCanvas.width = physicalWidth;
    this.mainCanvas.height = physicalHeight;
    this.mainCanvas.style.width = `${this.logicalWidth}px`;
    this.mainCanvas.style.height = `${this.logicalHeight}px`;

    // Resize Draft Canvas
    this.draftCanvas.width = physicalWidth;
    this.draftCanvas.height = physicalHeight;
    this.draftCanvas.style.width = `${this.logicalWidth}px`;
    this.draftCanvas.style.height = `${this.logicalHeight}px`;

    // Scale contexts so logical coordinates map to device pixels
    this.mainCtx.scale(this.dpr, this.dpr);
    this.draftCtx.scale(this.dpr, this.dpr);

    // Redraw committed history
    this.redrawAll();
  }

  public setTool(tool: ToolType): void {
    this.currentTool = tool;
    if (tool === 'text') {
      this.draftCanvas.style.cursor = 'text';
    } else if (tool === 'eraser') {
      this.draftCanvas.style.cursor = 'cell';
    } else {
      this.draftCanvas.style.cursor = 'crosshair';
    }
  }

  public setColor(color: string): void {
    this.currentColor = color;
  }

  public setStrokeWidth(width: number): void {
    this.currentWidth = Math.max(1, Math.min(150, width));
  }

  public getTool(): ToolType {
    return this.currentTool;
  }

  public getColor(): string {
    return this.currentColor;
  }

  public getStrokeWidth(): number {
    return this.currentWidth;
  }

  /**
   * Set canonical operations and trigger a full redraw.
   */
  public setOperations(ops: DrawOperation[]): void {
    // Sort deterministically by server sequence number
    this.operations = [...ops].sort((a, b) => a.seq - b.seq);
    this.redrawAll();
  }

  /**
   * Incremental render for a committed operation.
   * If the operation is the local one or a remote one, commit it directly to main canvas.
   */
  public commitOperation(op: DrawOperation): void {
    // Check if already in list
    const existingIdx = this.operations.findIndex(o => o.id === op.id);
    if (existingIdx >= 0) {
      this.operations[existingIdx] = op;
      this.redrawAll();
      return;
    }

    this.operations.push(op);
    this.operations.sort((a, b) => a.seq - b.seq);

    // Draw directly to main canvas
    this.drawStroke(this.mainCtx, op.points, op.tool, op.color, op.width, false, op.text);

    // Remove from remote active strokes if present
    this.remoteActiveStrokes.delete(op.id);
    this.redrawDraft();
  }

  /**
   * Handle incoming remote active stroke start.
   */
  public handleRemoteStrokeStart(stroke: ActiveStroke): void {
    this.remoteActiveStrokes.set(stroke.id, stroke);
    this.redrawDraft();
  }

  /**
   * Handle incoming remote active stroke chunk.
   */
  public handleRemoteStrokeChunk(id: string, points: Point[]): void {
    const stroke = this.remoteActiveStrokes.get(id);
    if (!stroke) return;
    stroke.points.push(...points);
    this.redrawDraft();
  }

  private gridType: 'clean' | 'dots' | 'grid' = 'clean';

  public setGridType(type: 'clean' | 'dots' | 'grid'): void {
    this.gridType = type;
    this.redrawAll();
  }

  public getGridType(): 'clean' | 'dots' | 'grid' {
    return this.gridType;
  }

  /**
   * Export the committed drawing as a high-resolution PNG Data URL.
   */
  public exportImage(): string {
    return this.mainCanvas.toDataURL('image/png');
  }

  /**
   * Redraw canonical operations on main canvas.
   */
  public redrawAll(): void {
    this.mainCtx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);

    // Fill clean canvas background
    this.mainCtx.fillStyle = CANVAS_BG;
    this.mainCtx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);

    // Draw background texture pattern if selected
    if (this.gridType === 'dots') {
      this.drawDotsPattern(this.mainCtx);
    } else if (this.gridType === 'grid') {
      this.drawGridPattern(this.mainCtx);
    }

    // Draw historical operations in server sequence order
    for (const op of this.operations) {
      this.drawStroke(this.mainCtx, op.points, op.tool, op.color, op.width, false, op.text);
    }

    this.redrawDraft();
  }

  private drawDotsPattern(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = '#cbd5e1';
    const spacing = 24;
    for (let x = spacing; x < this.logicalWidth; x += spacing) {
      for (let y = spacing; y < this.logicalHeight; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawGridPattern(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    const spacing = 28;
    ctx.beginPath();
    for (let x = 0; x < this.logicalWidth; x += spacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.logicalHeight);
    }
    for (let y = 0; y < this.logicalHeight; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(this.logicalWidth, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Redraw active in-progress strokes on draft canvas.
   */
  private redrawDraft(): void {
    this.draftCtx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);

    // Draw all remote active strokes
    for (const stroke of this.remoteActiveStrokes.values()) {
      this.drawStroke(this.draftCtx, stroke.points, stroke.tool, stroke.color, stroke.width, false, stroke.text);
    }

    // Draw local active stroke
    if (this.isDrawing && this.localStrokePoints.length > 0) {
      this.drawStroke(
        this.draftCtx,
        this.localStrokePoints,
        this.currentTool,
        this.currentColor,
        this.currentWidth,
        true // isDraft
      );
    }
  }

  /**
   * Core rendering method with Bézier smoothing for brushes and precise vector shapes.
   */
  private drawStroke(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    tool: ToolType,
    color: string,
    width: number,
    isDraft: boolean = false,
    text?: string
  ): void {
    if (!points || points.length === 0) return;

    ctx.save();

    if (tool === 'eraser') {
      ctx.strokeStyle = CANVAS_BG;
      ctx.fillStyle = CANVAS_BG;
    } else {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
    }

    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 0. Text Tool
    if (tool === 'text') {
      const pt = points[0];
      const fontSize = Math.max(16, width * 4);
      ctx.font = `600 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillStyle = color;
      ctx.textBaseline = 'top';
      ctx.fillText(text || '', pt.x, pt.y);
      ctx.restore();
      return;
    }

    // 1. Rectangle Tool
    if (tool === 'rectangle') {
      const start = points[0];
      const end = points[points.length - 1];
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const w = Math.abs(end.x - start.x);
      const h = Math.abs(end.y - start.y);

      ctx.beginPath();
      ctx.strokeRect(x, y, w, h);

      if (isDraft && w > 8 && h > 8) {
        // Draw dimension hint pill during draft drag
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.fillRect(x, y - 22, 70, 18);
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillText(`${Math.round(w)} × ${Math.round(h)}`, x + 6, y - 9);
      }
      ctx.restore();
      return;
    }

    // 2. Circle / Ellipse Tool
    if (tool === 'circle') {
      const start = points[0];
      const end = points[points.length - 1];
      const rx = Math.abs(end.x - start.x) / 2;
      const ry = Math.abs(end.y - start.y) / 2;
      const cx = Math.min(start.x, end.x) + rx;
      const cy = Math.min(start.y, end.y) + ry;

      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // 3. Line / Arrow Tool
    if (tool === 'line') {
      const start = points[0];
      const end = points[points.length - 1];
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // 4. Brush / Eraser Tool (Midpoint Bézier Interpolation)
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    if (points.length === 2) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
    }

    const lastPoint = points[points.length - 1];
    ctx.lineTo(lastPoint.x, lastPoint.y);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Setup pointer event listeners for desktop and touch.
   */
  private setupListeners(): void {
    const target = this.draftCanvas;

    // Use PointerEvents with capture for unified mouse/touch/stylus support
    target.addEventListener('pointerdown', (e: PointerEvent) => {
      // Only handle primary button / finger touch
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      const pt = this.getPointerPos(e);

      if (this.currentTool === 'text') {
        e.preventDefault();
        this.onStrokeStartCb('text', this.currentColor, this.currentWidth, pt);
        return;
      }

      target.setPointerCapture(e.pointerId);
      this.isDrawing = true;
      this.localStrokePoints = [pt];
      this.pendingChunkPoints = [];

      // Notify callback of stroke start
      this.onStrokeStartCb(this.currentTool, this.currentColor, this.currentWidth, pt);

      // Render dot immediately
      this.redrawDraft();

      // Start periodic chunk emission timer (~35ms / ~30fps)
      this.startChunkTimer();
    });

    target.addEventListener('pointermove', (e: PointerEvent) => {
      const pt = this.getPointerPos(e);
      const now = performance.now();

      // Separate cursor movement throttling
      if (now - this.lastPointerMoveTime >= this.pointerThrottleMs) {
        this.lastPointerMoveTime = now;
        this.onPointerMoveCb(pt);
      }

      if (!this.isDrawing) return;

      this.localStrokePoints.push(pt);
      this.pendingChunkPoints.push(pt);

      // Smooth local visual rendering
      this.redrawDraft();
    });

    const finishStroke = (e: PointerEvent) => {
      if (!this.isDrawing) return;
      this.isDrawing = false;

      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }

      this.stopChunkTimer();

      const finalPoint = this.getPointerPos(e);
      this.localStrokePoints.push(finalPoint);
      this.pendingChunkPoints.push(finalPoint);

      // Flush remaining chunk if any
      if (this.pendingChunkPoints.length > 0) {
        this.onStrokeChunkCb([...this.pendingChunkPoints]);
        this.pendingChunkPoints = [];
      }

      // Notify stroke end
      this.onStrokeEndCb(finalPoint);

      // Clear local stroke points and redraw draft
      this.localStrokePoints = [];
      this.redrawDraft();
    };

    target.addEventListener('pointerup', finishStroke);
    target.addEventListener('pointercancel', finishStroke);
  }

  private getPointerPos(e: PointerEvent): Point {
    const rect = this.draftCanvas.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) * 10) / 10,
      y: Math.round((e.clientY - rect.top) * 10) / 10
    };
  }

  private startChunkTimer(): void {
    if (this.chunkTimer !== null) return;

    this.chunkTimer = window.setInterval(() => {
      if (this.pendingChunkPoints.length > 0) {
        this.onStrokeChunkCb([...this.pendingChunkPoints]);
        this.pendingChunkPoints = [];
      }
    }, 35); // ~30Hz chunks
  }

  private stopChunkTimer(): void {
    if (this.chunkTimer !== null) {
      clearInterval(this.chunkTimer);
      this.chunkTimer = null;
    }
  }

  public clearCanvas(): void {
    this.operations = [];
    this.remoteActiveStrokes.clear();
    this.redrawAll();
  }

  public destroy(): void {
    this.stopChunkTimer();
  }
}
