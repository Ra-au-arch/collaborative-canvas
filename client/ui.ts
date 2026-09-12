import { ToolType, UserInfo, Point } from '../shared/protocol.js';
import { ConnectionState } from './types.js';

const PRESET_COLORS = [
  '#0f172a', // Slate Black
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#10b981', // Emerald
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#8b5cf6', // Violet
  '#ec4899'  // Pink
];

export interface UIOptions {
  onToolSelect: (tool: ToolType) => void;
  onColorSelect: (color: string) => void;
  onWidthSelect: (width: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onRoomChange: (roomId: string) => void;
}

export class UIManager {
  private options: UIOptions;

  // Header elements
  private currentRoomNameEl: HTMLElement;
  private copyLinkBtn: HTMLButtonElement;
  private switchRoomBtn: HTMLButtonElement;
  private statusBadgeEl: HTMLElement;
  private usersTriggerEl: HTMLButtonElement;
  private usersDropdownEl: HTMLElement;
  private usersListEl: HTMLElement;
  private userCountTextEl: HTMLElement;
  private dropdownUserCountEl: HTMLElement;

  // Toolbar elements
  private toolBrushBtn: HTMLButtonElement;
  private toolEraserBtn: HTMLButtonElement;
  private swatchesContainer: HTMLElement;
  private customColorPicker: HTMLInputElement;
  private customColorPreview: HTMLElement;
  private strokeWidthSlider: HTMLInputElement;
  private widthValueLabel: HTMLElement;
  private widthPreviewDot: HTMLElement;
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private clearBtn: HTMLButtonElement;

  // Modals
  private clearModal: HTMLElement;
  private cancelClearBtn: HTMLButtonElement;
  private confirmClearBtn: HTMLButtonElement;
  private roomModal: HTMLElement;
  private switchRoomForm: HTMLFormElement;
  private roomNameInput: HTMLInputElement;
  private cancelRoomBtn: HTMLButtonElement;

  // Cursors & Overlay
  private cursorsContainer: HTMLElement;
  private onboardingHint: HTMLElement;
  private toastContainer: HTMLElement;

  // Diagnostics
  private diagnosticsToggle: HTMLButtonElement;
  private diagnosticsContent: HTMLElement;
  private diagSummaryFps: HTMLElement;
  private diagFps: HTMLElement;
  private diagLatency: HTMLElement;
  private diagUsers: HTMLElement;
  private diagOps: HTMLElement;
  private diagDpr: HTMLElement;

  // Remote cursor element cache: userId -> { element, timer }
  private remoteCursors: Map<string, { element: HTMLElement; timer: number }> = new Map();

  private currentColor: string = '#3b82f6';
  private currentWidth: number = 4;
  private currentTool: ToolType = 'brush';

  constructor(options: UIOptions) {
    this.options = options;

    // Grab DOM elements
    this.currentRoomNameEl = document.getElementById('currentRoomName')!;
    this.copyLinkBtn = document.getElementById('copyLinkBtn') as HTMLButtonElement;
    this.switchRoomBtn = document.getElementById('switchRoomBtn') as HTMLButtonElement;
    this.statusBadgeEl = document.getElementById('statusBadge')!;
    this.usersTriggerEl = document.getElementById('usersTrigger') as HTMLButtonElement;
    this.usersDropdownEl = document.getElementById('usersDropdown')!;
    this.usersListEl = document.getElementById('usersList')!;
    this.userCountTextEl = document.getElementById('userCountText')!;
    this.dropdownUserCountEl = document.getElementById('dropdownUserCount')!;

    this.toolBrushBtn = document.getElementById('toolBrush') as HTMLButtonElement;
    this.toolEraserBtn = document.getElementById('toolEraser') as HTMLButtonElement;
    this.swatchesContainer = document.getElementById('swatchesContainer')!;
    this.customColorPicker = document.getElementById('customColorPicker') as HTMLInputElement;
    this.customColorPreview = document.getElementById('customColorPreview')!;
    this.strokeWidthSlider = document.getElementById('strokeWidthSlider') as HTMLInputElement;
    this.widthValueLabel = document.getElementById('widthValueLabel')!;
    this.widthPreviewDot = document.getElementById('widthPreviewDot')!;
    this.undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
    this.redoBtn = document.getElementById('redoBtn') as HTMLButtonElement;
    this.clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;

    this.clearModal = document.getElementById('clearModal')!;
    this.cancelClearBtn = document.getElementById('cancelClearBtn') as HTMLButtonElement;
    this.confirmClearBtn = document.getElementById('confirmClearBtn') as HTMLButtonElement;
    this.roomModal = document.getElementById('roomModal')!;
    this.switchRoomForm = document.getElementById('switchRoomForm') as HTMLFormElement;
    this.roomNameInput = document.getElementById('roomNameInput') as HTMLInputElement;
    this.cancelRoomBtn = document.getElementById('cancelRoomBtn') as HTMLButtonElement;

    this.cursorsContainer = document.getElementById('cursorsContainer')!;
    this.onboardingHint = document.getElementById('onboardingHint')!;
    this.toastContainer = document.getElementById('toastContainer')!;

    this.diagnosticsToggle = document.getElementById('diagnosticsToggle') as HTMLButtonElement;
    this.diagnosticsContent = document.getElementById('diagnosticsContent')!;
    this.diagSummaryFps = document.getElementById('diagSummaryFps')!;
    this.diagFps = document.getElementById('diagFps')!;
    this.diagLatency = document.getElementById('diagLatency')!;
    this.diagUsers = document.getElementById('diagUsers')!;
    this.diagOps = document.getElementById('diagOps')!;
    this.diagDpr = document.getElementById('diagDpr')!;

    this.initSwatches();
    this.setupListeners();
    this.updateWidthDisplay(this.currentWidth);
  }

  private initSwatches(): void {
    this.swatchesContainer.innerHTML = '';
    PRESET_COLORS.forEach((hex) => {
      const btn = document.createElement('button');
      btn.className = `color-swatch ${hex === this.currentColor ? 'active' : ''}`;
      btn.style.backgroundColor = hex;
      btn.setAttribute('aria-label', `Color ${hex}`);
      btn.addEventListener('click', () => {
        this.selectColor(hex);
      });
      this.swatchesContainer.appendChild(btn);
    });
  }

  private selectColor(hex: string): void {
    this.currentColor = hex;
    this.customColorPreview.style.backgroundColor = hex;
    this.customColorPicker.value = hex;

    // Update swatches active ring
    const swatches = this.swatchesContainer.querySelectorAll('.color-swatch');
    swatches.forEach((swatch) => {
      const el = swatch as HTMLElement;
      if (el.style.backgroundColor === hex || el.dataset.hex === hex) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    // If eraser was active, automatically switch back to brush
    if (this.currentTool === 'eraser') {
      this.selectTool('brush');
    }

    this.options.onColorSelect(hex);
  }

  public selectTool(tool: ToolType): void {
    this.currentTool = tool;
    if (tool === 'brush') {
      this.toolBrushBtn.classList.add('active');
      this.toolEraserBtn.classList.remove('active');
    } else {
      this.toolEraserBtn.classList.add('active');
      this.toolBrushBtn.classList.remove('active');
    }
    this.options.onToolSelect(tool);
  }

  public setStrokeWidth(width: number): void {
    const clamped = Math.max(1, Math.min(100, width));
    this.currentWidth = clamped;
    this.strokeWidthSlider.value = String(clamped);
    this.updateWidthDisplay(clamped);
    this.options.onWidthSelect(clamped);
  }

  private updateWidthDisplay(width: number): void {
    this.widthValueLabel.textContent = `${width}px`;
    const dotSize = Math.max(3, Math.min(22, width));
    this.widthPreviewDot.style.width = `${dotSize}px`;
    this.widthPreviewDot.style.height = `${dotSize}px`;

    // Highlight matching quick preset if any
    const presets = document.querySelectorAll('.width-preset-btn');
    presets.forEach((btn) => {
      const w = Number((btn as HTMLElement).dataset.width);
      if (w === width) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  private setupListeners(): void {
    // Tool buttons
    this.toolBrushBtn.addEventListener('click', () => this.selectTool('brush'));
    this.toolEraserBtn.addEventListener('click', () => this.selectTool('eraser'));

    // Custom color picker
    this.customColorPicker.addEventListener('input', (e) => {
      const hex = (e.target as HTMLInputElement).value;
      this.selectColor(hex);
    });

    // Stroke width slider
    this.strokeWidthSlider.addEventListener('input', (e) => {
      const width = Number((e.target as HTMLInputElement).value);
      this.setStrokeWidth(width);
    });

    // Quick width presets
    const presets = document.querySelectorAll('.width-preset-btn');
    presets.forEach((btn) => {
      btn.addEventListener('click', () => {
        const w = Number((btn as HTMLElement).dataset.width);
        this.setStrokeWidth(w);
      });
    });

    // Undo / Redo
    this.undoBtn.addEventListener('click', () => this.options.onUndo());
    this.redoBtn.addEventListener('click', () => this.options.onRedo());

    // Clear modal triggers
    this.clearBtn.addEventListener('click', () => {
      this.clearModal.classList.remove('hidden');
    });
    this.cancelClearBtn.addEventListener('click', () => {
      this.clearModal.classList.add('hidden');
    });
    this.confirmClearBtn.addEventListener('click', () => {
      this.clearModal.classList.add('hidden');
      this.options.onClear();
    });

    // Room modal triggers
    this.switchRoomBtn.addEventListener('click', () => {
      this.roomModal.classList.remove('hidden');
      this.roomNameInput.focus();
    });
    this.cancelRoomBtn.addEventListener('click', () => {
      this.roomModal.classList.add('hidden');
    });
    this.switchRoomForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const newRoom = this.roomNameInput.value.trim();
      if (newRoom) {
        this.roomModal.classList.add('hidden');
        this.options.onRoomChange(newRoom);
      }
    });

    // Copy room link
    this.copyLinkBtn.addEventListener('click', () => {
      const url = window.location.href;
      navigator.clipboard.writeText(url).then(() => {
        this.showToast('Room link copied to clipboard! 📋');
      }).catch(() => {
        this.showToast('Failed to copy room link');
      });
    });

    // Users dropdown toggle
    this.usersTriggerEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = this.usersDropdownEl.classList.toggle('hidden');
      this.usersTriggerEl.setAttribute('aria-expanded', String(!isHidden));
    });

    document.addEventListener('click', (e) => {
      if (!this.usersDropdownEl.contains(e.target as Node) && e.target !== this.usersTriggerEl) {
        this.usersDropdownEl.classList.add('hidden');
        this.usersTriggerEl.setAttribute('aria-expanded', 'false');
      }
    });

    // Diagnostics toggle
    this.diagnosticsToggle.addEventListener('click', () => {
      const isHidden = this.diagnosticsContent.classList.toggle('hidden');
      this.diagnosticsToggle.setAttribute('aria-expanded', String(!isHidden));
    });

    // Global keyboard shortcuts
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      // Ignore shortcut if typing in input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        if (e.key === 'Escape') {
          this.roomModal.classList.add('hidden');
          this.clearModal.classList.add('hidden');
        }
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (cmdOrCtrl && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.options.onUndo();
      } else if (
        (cmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'z') ||
        (cmdOrCtrl && e.key.toLowerCase() === 'y')
      ) {
        e.preventDefault();
        this.options.onRedo();
      } else if (e.key.toLowerCase() === 'b') {
        this.selectTool('brush');
      } else if (e.key.toLowerCase() === 'e') {
        this.selectTool('eraser');
      } else if (e.key === '[') {
        this.setStrokeWidth(this.currentWidth - 2);
      } else if (e.key === ']') {
        this.setStrokeWidth(this.currentWidth + 2);
      } else if (e.key === 'Escape') {
        this.clearModal.classList.add('hidden');
        this.roomModal.classList.add('hidden');
        this.usersDropdownEl.classList.add('hidden');
      }
    });
  }

  public setRoomName(room: string): void {
    this.currentRoomNameEl.textContent = room;
    this.roomNameInput.value = room;
  }

  public setConnectionState(state: ConnectionState): void {
    this.statusBadgeEl.className = `status-badge ${state}`;
    const textEl = this.statusBadgeEl.querySelector('.status-text')!;
    switch (state) {
      case 'connected':
        textEl.textContent = 'Connected';
        break;
      case 'connecting':
        textEl.textContent = 'Connecting...';
        break;
      case 'reconnecting':
        textEl.textContent = 'Reconnecting...';
        break;
      case 'disconnected':
        textEl.textContent = 'Disconnected';
        break;
    }
  }

  public updateHistoryButtons(canUndo: boolean, canRedo: boolean): void {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
  }

  public updateUsersList(users: UserInfo[], myId: string): void {
    this.userCountTextEl.textContent = `${users.length} online`;
    this.dropdownUserCountEl.textContent = String(users.length);

    this.usersListEl.innerHTML = '';
    users.forEach((u) => {
      const li = document.createElement('li');
      li.className = 'user-item';

      const avatar = document.createElement('span');
      avatar.className = 'user-avatar';
      avatar.style.backgroundColor = u.color;

      const name = document.createElement('span');
      name.className = 'user-name-text';
      name.textContent = u.name;

      li.appendChild(avatar);
      li.appendChild(name);

      if (u.id === myId) {
        const tag = document.createElement('span');
        tag.className = 'user-you-tag';
        tag.textContent = 'You';
        li.appendChild(tag);
      }

      this.usersListEl.appendChild(li);
    });
  }

  /**
   * Render or update a remote user's cursor pointer with name badge.
   */
  public updateRemoteCursor(
    userId: string,
    userName: string,
    color: string,
    pos: Point
  ): void {
    let cursorEntry = this.remoteCursors.get(userId);

    if (!cursorEntry) {
      const element = document.createElement('div');
      element.className = 'remote-cursor';
      element.id = `cursor-${userId}`;

      element.innerHTML = `
        <div class="remote-cursor-pointer">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="${color}" stroke="#ffffff" stroke-width="1.5">
            <path d="M3 3l7 18 3-7 7-3L3 3z"/>
          </svg>
          <span class="remote-cursor-label" style="background-color: ${color}">${userName}</span>
        </div>
      `;

      this.cursorsContainer.appendChild(element);
      cursorEntry = { element, timer: 0 };
      this.remoteCursors.set(userId, cursorEntry);
    }

    // Position cursor element
    cursorEntry.element.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    cursorEntry.element.style.opacity = '1';

    // Clear existing idle timer and start fresh 4s idle fadeout
    if (cursorEntry.timer) {
      clearTimeout(cursorEntry.timer);
    }

    cursorEntry.timer = window.setTimeout(() => {
      if (cursorEntry) {
        cursorEntry.element.style.opacity = '0';
      }
    }, 4000);
  }

  public removeRemoteCursor(userId: string): void {
    const entry = this.remoteCursors.get(userId);
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.element.remove();
      this.remoteCursors.delete(userId);
    }
  }

  public hideOnboardingHint(): void {
    if (this.onboardingHint) {
      this.onboardingHint.classList.add('hidden');
    }
  }

  public showToast(message: string, durationMs: number = 3000): void {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;

    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, durationMs);
  }

  public updateDiagnostics(stats: {
    fps: number;
    latencyMs: number;
    userCount: number;
    operationCount: number;
    dpr: number;
  }): void {
    this.diagSummaryFps.textContent = `${stats.fps} FPS`;
    this.diagFps.textContent = String(stats.fps);
    this.diagLatency.textContent = `${stats.latencyMs} ms`;
    this.diagUsers.textContent = String(stats.userCount);
    this.diagOps.textContent = String(stats.operationCount);
    this.diagDpr.textContent = `${stats.dpr.toFixed(1)}x`;
  }
}
