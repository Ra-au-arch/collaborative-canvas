# 🎨 Real-Time Collaborative Drawing Canvas

A high-performance, multi-user collaborative drawing application built with **TypeScript**, **native HTML5 Canvas API**, **Node.js**, **Express**, and **Socket.IO**. No frontend frameworks (React/Vue/Angular) and no drawing libraries (Fabric.js/Konva/Excalidraw).

Multiple collaborators in the same room can draw simultaneously, see each other's live strokes and cursors with zero latency, and utilize server-authoritative global undo/redo and canvas clearing.

---

## ✨ Feature List

### 1. Drawing Canvas & Tools
- **Brush & Eraser Tools**: Native Canvas API implementation with customizable color and stroke width.
- **Midpoint Quadratic Bézier Smoothing**: Interpolates pointer coordinates with quadratic Bézier curves (`quadraticCurveTo`), eliminating jagged polylines.
- **Curated Color Swatches & Native Color Picker**: 9 curated designer swatches + native color picker for infinite hex/RGB palettes.
- **Stroke Width Controls**: Real-time slider (1px–60px) + quick-preset buttons (2, 4, 8, 16, 28) with dynamic width preview indicator.
- **Clear Canvas Modal**: Guarded confirmation dialog preventing accidental clearing for the entire room.
- **High-DPI Retina Support**: Automatically calculates `window.devicePixelRatio` and scales backing canvas buffers for razor-sharp rendering on 4K/Retina displays.

### 2. Real-Time Collaboration
- **Chunk-Streamed Drawing**: Strokes are streamed incrementally during pointer movement via throttled chunks (~35ms / 30Hz), allowing peers to see drawings appear live before mouse-up.
- **Presence & Online Users**: Real-time room participant roster with distinct curated user colors, generated fun display names (e.g. *Cosmic Lynx 42*), and `(You)` indicators.
- **Live Remote Cursors**: Smoothly animated floating remote cursor arrows with name pills and auto-fadeout on idle.
- **URL-Based Multi-Room**: Join or share rooms via query parameters (e.g., `?room=design-sprint`). Built-in room switcher modal and one-click "Share Room Link" clipboard button.

### 3. Server-Authoritative Global Undo/Redo & Conflict Ordering
- **Global Collaborative History**: Undoing or redoing affects the shared document history timeline rather than local client state.
- **Deterministic Server Sequencing**: Every committed operation receives a monotonic sequence number (`seq`). Redraws iterate strictly by `seq`, guaranteeing identical visual state across all clients regardless of network packet arrival order.
- **Overlapping Strokes Retention**: Overlapping concurrent strokes are preserved in authoritative sequence order, rendering naturally without silent overwrites.
- **Reconnect Recovery**: Upon connection loss, clients automatically reconnect and request a full `RoomSnapshot` from the server, restoring complete drawing history and active peers.

### 4. Performance & Diagnostics
- **Dual-Layer Canvas Architecture**:
  - *Main Canvas*: Holds committed historical operations.
  - *Draft Canvas*: Ephemeral overlay layer for local active strokes and peers' active in-progress chunks.
  - Full canvas redrawing is strictly isolated to undo, redo, clear, snapshot restore, or window resize.
- **Throttling & Batching**: Pointer movements are throttled separately for cursor telemetry (~35ms) and stroke chunks (~35ms), preventing WebSocket buffer saturation.
- **Live Diagnostics HUD**: Real-time overlay reporting instantaneous FPS, ping round-trip latency (RTT), active room users count, operation count, and display DPR.

---

## 📋 Prerequisites

- **Node.js**: `v20.0.0` or higher
- **npm**: `v10.0.0` or higher

---

## 🚀 Quickstart & Setup

### 1. Clone & Install
```bash
git clone <repository-url>
cd collaborative-canvas
npm install
```

### 2. Build & Start
```bash
npm start
```
> `npm start` automatically triggers the TypeScript build via `esbuild` and starts the production Express + Socket.IO server at **`http://localhost:3000`**.

### 3. Development Mode
To automatically re-bundle on client and server changes:
```bash
npm run dev
```

### 4. Run Unit & E2E Tests
```bash
npm test
```
Runs the automated test suite covering:
- In-flight stroke chunking and sequence assignment
- Global undo, redo, and redo-stack invalidation
- Room presence, user assignment, and cursor tracking
- Payload validation & boundary sanitization
- Multi-client Socket.IO end-to-end synchronization

---

## 👥 How to Test with Multiple Users

1. Open `http://localhost:3000/?room=demo` in your browser.
2. Open a **second tab** or an **incognito window** with the same URL: `http://localhost:3000/?room=demo`.
3. Notice:
   - Both users are assigned unique colors and display names.
   - The user pill displays `2 online` in both windows.
   - Moving your cursor in Window 1 immediately shows a labeled cursor in Window 2.
   - Drawing in Window 1 streams live strokes to Window 2 before pointer release.
   - Drawing simultaneously from both windows preserves both strokes in server sequence order.
   - Pressing **Undo** (`Cmd+Z` / `Ctrl+Z`) in Window 1 removes the latest committed stroke in both windows synchronously.
   - Clicking **Clear Canvas** prompts a confirmation dialog and clears the board globally.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `B` | Switch to Brush Tool |
| `T` | Switch to Text Tool (click canvas to type) |
| `R` | Switch to Rectangle Tool |
| `C` | Switch to Circle Tool |
| `L` | Switch to Line Tool |
| `E` | Switch to Eraser Tool |
| `[` | Decrease Stroke Width by 2px |
| `]` | Increase Stroke Width by 2px |
| `Cmd/Ctrl + Z` | Global Collaborative Undo |
| `Cmd/Ctrl + Shift + Z` or `Cmd/Ctrl + Y` | Global Collaborative Redo |
| `Escape` | Close modals / dropdowns / dismiss text box |

---

## 🚢 Deployment Instructions (Render)

This repository includes a turnkey `render.yaml` blueprint configured for single-service same-origin deployment:

1. Push this repository to GitHub.
2. In the [Render Dashboard](https://dashboard.render.com/), click **New** → **Blueprint**.
3. Select your repository. Render will detect `render.yaml`:
   - **Service Type**: Web Service
   - **Environment**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run serve`
   - **Environment Variables**: `NODE_ENV=production`, `PORT=10000`
4. Click **Apply**.
5. Once deployed, open the assigned `.onrender.com` URL. The app serves both the client static bundle and real-time Socket.IO endpoints on the same origin without CORS or frontend environment variable configuration.

---

## ⏱️ Actual Time Spent

| Phase | Description | Time Spent |
| :--- | :--- | :--- |
| **Phase 1 & 2** | Architecture design, TypeScript setup, esbuild pipeline, package config | ~45 mins |
| **Phase 3 & 4** | Dual-layer canvas engine, high-DPI scaling, Bézier smoothing, pointer capture | ~1.5 hours |
| **Phase 5 & 6** | Socket.IO protocol, chunk streaming, server sequence ordering, global undo/redo | ~1.5 hours |
| **Phase 7 & 8** | UI design, accessible toolbar, diagnostics HUD, unit & E2E integration tests | ~1 hour |
| **Phase 9 & 10** | Multi-client concurrency verification, reconnect stress testing, edge-case fixes | ~45 mins |
| **Phase 11** | Documentation (`README.md`, `ARCHITECTURE.md`, interview guide) | ~45 mins |
| **Total** | | **~6.5 hours** |

---

## 📸 Screenshots & UI Layout

```text
+---------------------------------------------------------------------------------------+
| [✏️ DrawSync]  [Room: demo (Share)] [Switch Room]            (🟢 Connected) [👥 2 online]|
+---------------------------------------------------------------------------------------+
|                                                                                       |
|                                 (Remote Cursor: Alice ↗)                              |
|            ~~~~~~ (Live Stroke Stream) ~~~~~~                                         |
|                                                                                       |
|                                                                                       |
|                         [ 🎨 Pick a tool and draw! ]                                  |
|                                                                                       |
|                                                                                       |
|               +-------------------------------------------------------+               |
|               | [🖌️] [🧽] | (🔴)(🟠)(🟡)(🟢)(🔵)(🟣) | [4px ▾] | [↩️] [↪️] [🗑️] |               |
|               +-------------------------------------------------------+               |
|                                                                         [📊 60 FPS ▾] |
+---------------------------------------------------------------------------------------+
```

---

## ⚠️ Known Limitations & Future Enhancements

1. **Vector Object Selection**: Operations are stored as sampled point paths rather than interactive vector objects (SVG/scene graph). Shapes cannot be selected, dragged, or resized after commitment.
2. **Infinite Canvas Pan/Zoom**: The current canvas fits the viewport container. A virtual coordinate space with 2D transform matrices (`ctx.setTransform`) could be added for unbounded panning and zooming.
3. **Persisted Database Storage**: Rooms and history are currently kept in high-performance server memory. For enterprise persistence, rooms can be snapshot to Redis or PostgreSQL / S3.
