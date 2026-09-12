import { ToolType, Point } from '../shared/protocol.js';

export interface ValidationResult<T> {
  valid: boolean;
  value?: T;
  error?: string;
}

export function sanitizeRoomId(raw: unknown): ValidationResult<string> {
  if (typeof raw !== 'string') {
    return { valid: false, error: 'Room ID must be a string' };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 64) {
    return { valid: false, error: 'Room ID must be between 1 and 64 characters' };
  }
  // Allow letters, numbers, dashes, underscores
  const sanitized = trimmed.replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 64);
  if (sanitized.length === 0) {
    return { valid: false, error: 'Room ID contains no valid characters' };
  }
  return { valid: true, value: sanitized };
}

export function sanitizeUserName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, 32);
}

export function isValidPoint(point: unknown): point is Point {
  if (!point || typeof point !== 'object') return false;
  const p = point as Record<string, unknown>;
  return (
    typeof p.x === 'number' &&
    Number.isFinite(p.x) &&
    typeof p.y === 'number' &&
    Number.isFinite(p.y) &&
    Math.abs(p.x) < 50000 &&
    Math.abs(p.y) < 50000
  );
}

export function isValidTool(tool: unknown): tool is ToolType {
  return tool === 'brush' || tool === 'eraser';
}

export function isValidColor(color: unknown): color is string {
  if (typeof color !== 'string') return false;
  // Match hex colors (#fff, #ffffff, #ffffffff) or rgb/hsl
  const hexRegex = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  const rgbRegex = /^rgba?\((\s*\d+\s*,){2}\s*\d+(\s*,\s*(0|1|0?\.\d+))?\s*\)$/i;
  return hexRegex.test(color) || rgbRegex.test(color);
}

export function isValidStrokeWidth(width: unknown): width is number {
  return typeof width === 'number' && Number.isFinite(width) && width >= 1 && width <= 150;
}

export function validateStrokeStart(payload: unknown): ValidationResult<{
  id: string;
  tool: ToolType;
  color: string;
  width: number;
  point: Point;
}> {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Payload must be an object' };
  }
  const data = payload as Record<string, unknown>;

  if (typeof data.id !== 'string' || data.id.length === 0 || data.id.length > 64) {
    return { valid: false, error: 'Invalid stroke ID' };
  }
  if (!isValidTool(data.tool)) {
    return { valid: false, error: 'Invalid tool type' };
  }
  if (!isValidColor(data.color)) {
    return { valid: false, error: 'Invalid stroke color' };
  }
  if (!isValidStrokeWidth(data.width)) {
    return { valid: false, error: 'Invalid stroke width (must be 1-150)' };
  }
  if (!isValidPoint(data.point)) {
    return { valid: false, error: 'Invalid start point coordinates' };
  }

  return {
    valid: true,
    value: {
      id: data.id,
      tool: data.tool,
      color: data.color,
      width: Number(data.width),
      point: { x: Number(data.point.x), y: Number(data.point.y) }
    }
  };
}

export function validateStrokeChunk(payload: unknown): ValidationResult<{
  id: string;
  points: Point[];
}> {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Payload must be an object' };
  }
  const data = payload as Record<string, unknown>;

  if (typeof data.id !== 'string' || data.id.length === 0 || data.id.length > 64) {
    return { valid: false, error: 'Invalid stroke ID' };
  }
  if (!Array.isArray(data.points) || data.points.length === 0 || data.points.length > 500) {
    return { valid: false, error: 'Points must be a non-empty array with <= 500 items' };
  }

  const validatedPoints: Point[] = [];
  for (const p of data.points) {
    if (!isValidPoint(p)) {
      return { valid: false, error: 'Invalid coordinate in chunk points array' };
    }
    validatedPoints.push({ x: Number(p.x), y: Number(p.y) });
  }

  return {
    valid: true,
    value: {
      id: data.id,
      points: validatedPoints
    }
  };
}

export function validateStrokeEnd(payload: unknown): ValidationResult<{
  id: string;
  point?: Point;
}> {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Payload must be an object' };
  }
  const data = payload as Record<string, unknown>;

  if (typeof data.id !== 'string' || data.id.length === 0 || data.id.length > 64) {
    return { valid: false, error: 'Invalid stroke ID' };
  }

  let finalPoint: Point | undefined = undefined;
  if (data.point !== undefined) {
    if (!isValidPoint(data.point)) {
      return { valid: false, error: 'Invalid end point coordinates' };
    }
    finalPoint = { x: Number(data.point.x), y: Number(data.point.y) };
  }

  return {
    valid: true,
    value: {
      id: data.id,
      point: finalPoint
    }
  };
}

export function validateCursor(payload: unknown): ValidationResult<Point> {
  if (!isValidPoint(payload)) {
    return { valid: false, error: 'Invalid cursor coordinates' };
  }
  const p = payload as Point;
  return { valid: true, value: { x: Number(p.x), y: Number(p.y) } };
}
