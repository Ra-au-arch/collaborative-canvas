import { DrawOperation, ActiveStroke, Point, ToolType } from '../shared/protocol.js';

export interface RoomHistoryState {
  operations: DrawOperation[];
  undoStack: DrawOperation[];
  activeStrokes: Map<string, ActiveStroke>;
  sequenceNumber: number;
}

export class DrawingStateManager {
  private operations: DrawOperation[] = [];
  private undoStack: DrawOperation[] = [];
  private activeStrokes: Map<string, ActiveStroke> = new Map();
  private sequenceNumber: number = 0;

  constructor(initialState?: Partial<RoomHistoryState>) {
    if (initialState) {
      this.operations = initialState.operations ? [...initialState.operations] : [];
      this.undoStack = initialState.undoStack ? [...initialState.undoStack] : [];
      this.activeStrokes = initialState.activeStrokes
        ? new Map(initialState.activeStrokes)
        : new Map();
      this.sequenceNumber = initialState.sequenceNumber || 0;
    }
  }

  /**
   * Start an in-flight stroke.
   */
  public startStroke(
    id: string,
    userId: string,
    userName: string,
    tool: ToolType,
    color: string,
    width: number,
    point: Point
  ): ActiveStroke {
    const stroke: ActiveStroke = {
      id,
      userId,
      userName,
      tool,
      color,
      width,
      points: [point],
      startTime: Date.now()
    };
    this.activeStrokes.set(id, stroke);
    return stroke;
  }

  /**
   * Append a batch of points to an active stroke.
   */
  public appendChunk(id: string, points: Point[]): ActiveStroke | null {
    const stroke = this.activeStrokes.get(id);
    if (!stroke) return null;
    stroke.points.push(...points);
    return stroke;
  }

  /**
   * Commit an active stroke to canonical history.
   * Assigns an authoritative server sequence number.
   * Clears the redo stack because a new mutation branches history.
   */
  public endStroke(id: string, finalPoint?: Point): DrawOperation | null {
    const stroke = this.activeStrokes.get(id);
    if (!stroke) return null;

    if (finalPoint) {
      stroke.points.push(finalPoint);
    }

    this.activeStrokes.delete(id);

    this.sequenceNumber += 1;
    const committedOp: DrawOperation = {
      id: stroke.id,
      seq: this.sequenceNumber,
      userId: stroke.userId,
      userName: stroke.userName,
      tool: stroke.tool,
      color: stroke.color,
      width: stroke.width,
      points: stroke.points,
      timestamp: Date.now()
    };

    this.operations.push(committedOp);
    // Standard collaborative history: a new commit invalidates the redo branch
    this.undoStack = [];

    return committedOp;
  }

  /**
   * Cancel or cleanup an active stroke (e.g. if user disconnects mid-stroke).
   * If the stroke already has several points, we can commit it so drawing isn't lost,
   * or discard if empty.
   */
  public cleanupUserStrokes(userId: string): DrawOperation[] {
    const committed: DrawOperation[] = [];
    for (const [id, stroke] of Array.from(this.activeStrokes.entries())) {
      if (stroke.userId === userId) {
        if (stroke.points.length > 1) {
          const op = this.endStroke(id);
          if (op) committed.push(op);
        } else {
          this.activeStrokes.delete(id);
        }
      }
    }
    return committed;
  }

  /**
   * Global collaborative Undo.
   * Pops the most recent operation from the shared room timeline,
   * regardless of which user authored it, and moves it to the undo stack.
   */
  public undo(): { undoneOp: DrawOperation | null; canUndo: boolean; canRedo: boolean } {
    if (this.operations.length === 0) {
      return { undoneOp: null, canUndo: false, canRedo: this.undoStack.length > 0 };
    }

    const undoneOp = this.operations.pop()!;
    this.undoStack.push(undoneOp);

    return {
      undoneOp,
      canUndo: this.operations.length > 0,
      canRedo: true
    };
  }

  /**
   * Global collaborative Redo.
   * Restores the most recently undone operation back onto the canonical timeline.
   */
  public redo(): { redoneOp: DrawOperation | null; canUndo: boolean; canRedo: boolean } {
    if (this.undoStack.length === 0) {
      return { redoneOp: null, canUndo: this.operations.length > 0, canRedo: false };
    }

    const redoneOp = this.undoStack.pop()!;
    this.operations.push(redoneOp);

    return {
      redoneOp,
      canUndo: true,
      canRedo: this.undoStack.length > 0
    };
  }

  /**
   * Clear canvas.
   * Resets active operations and undo stack.
   */
  public clear(): number {
    this.sequenceNumber += 1;
    this.operations = [];
    this.undoStack = [];
    this.activeStrokes.clear();
    return this.sequenceNumber;
  }

  public getOperations(): DrawOperation[] {
    return [...this.operations];
  }

  public getActiveStrokes(): ActiveStroke[] {
    return Array.from(this.activeStrokes.values());
  }

  public canUndo(): boolean {
    return this.operations.length > 0;
  }

  public canRedo(): boolean {
    return this.undoStack.length > 0;
  }

  public getSequenceNumber(): number {
    return this.sequenceNumber;
  }
}
