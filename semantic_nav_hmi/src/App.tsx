import { useEffect } from 'react';
import { ConfirmDialog } from './components/dialogs/ConfirmDialog';
import { LabelDialog } from './components/dialogs/LabelDialog';
import { SettingsDialog } from './components/dialogs/SettingsDialog';
import { ShortcutsDialog } from './components/dialogs/ShortcutsDialog';
import { SystemDialog } from './components/dialogs/SystemDialog';
import { ZoneDialog } from './components/dialogs/ZoneDialog';
import { SidePanel } from './components/SidePanel';
import { Stage } from './components/Stage';
import { StatusBar } from './components/StatusBar';
import { Toasts } from './components/Toasts';
import { TopBar } from './components/TopBar';
import { isTyping, routeToTool } from './hooks/keyboard';
import { sendCommand, setSpeaker, startRos } from './ros/app';
import { emergencyStop } from './ros/commands';
import { installTeleopSafety, teleop, type Dir } from './ros/teleop';
import { speak, startListening, stopListening } from './speech/speech';
import { app, MODE_ORDER, useApp, type Tool } from './state/store';

const DRIVE_KEYS: Record<string, Dir> = {
  KeyW: 'fwd',
  ArrowUp: 'fwd',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

const TOOL_KEYS: Record<string, Tool> = { v: 'pan', g: 'goal', p: 'pose', l: 'label', k: 'zone' };

let booted = false;

function boot() {
  if (booted) return;
  booted = true;
  installTeleopSafety();
  setSpeaker(speak);
  // leaving a driving mode releases held keys
  useApp.subscribe((s, p) => {
    if (s.mode !== p.mode && s.mode !== 'drive' && s.mode !== 'map') teleop.releaseAll();
  });
  void startRos();
}

function mapCommand(cmd: string) {
  window.dispatchEvent(new CustomEvent('map-command', { detail: cmd }));
}

/** Zoom keys act on whichever view is in front. */
function viewCommand(cmd: 'zoom-in' | 'zoom-out' | 'fit') {
  if (app().primary === 'camera') {
    window.dispatchEvent(new CustomEvent('camera-command', { detail: cmd === 'fit' ? 'reset' : cmd }));
  } else {
    mapCommand(cmd);
  }
}

function onKeyDown(e: KeyboardEvent) {
  const s = app();
  const typing = isTyping(e);

  // Safety first: Space is STOP everywhere except mid-text. An empty field counts
  // as "not typing": right after sending a command the box is empty and focused,
  // which is exactly when an operator reaches for Space.
  const emptyField =
    typing && (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) && e.target.value.length === 0;
  if (e.code === 'Space' && (!typing || emptyField) && !e.repeat) {
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
    void emergencyStop();
    return;
  }
  if (typing) {
    if (e.key === 'Escape') (e.target as HTMLElement).blur();
    return;
  }
  const modal = s.dialog !== null || s.labelDraft !== null || s.zoneDraft !== null || s.confirm !== null;
  if (modal) return;
  if (routeToTool(e)) {
    e.preventDefault();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const dir = DRIVE_KEYS[e.code];
  if (dir && (s.mode === 'drive' || s.mode === 'map')) {
    e.preventDefault();
    if (!e.repeat) teleop.setKey(dir, true);
    return;
  }

  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key >= '1' && key <= '4') {
    s.setMode(MODE_ORDER[Number(key) - 1]);
    return;
  }
  if (key in TOOL_KEYS) {
    s.setPrimary('map');
    s.setTool(TOOL_KEYS[key]);
    return;
  }
  switch (key) {
    case 'f':
      if (s.pose) s.setFollow(!s.followRobot);
      break;
    case '0':
      viewCommand('fit');
      break;
    case '+':
    case '=':
      viewCommand('zoom-in');
      break;
    case '-':
    case '_':
      viewCommand('zoom-out');
      break;
    case 'c':
      s.swapViews();
      break;
    case 'q':
    case 'e':
      if (s.primary === 'camera') {
        window.dispatchEvent(new CustomEvent('camera-command', { detail: key === 'q' ? 'rotate-left' : 'rotate-right' }));
      }
      break;
    case '?':
      s.patch({ dialog: 'shortcuts' });
      break;
    case '/':
      e.preventDefault();
      s.setMode('command');
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.composer__input')?.focus());
      break;
    case 'm':
      if (s.mode === 'command') {
        if (s.listening) stopListening();
        else startListening((t) => sendCommand(t));
      }
      break;
    case 'Escape':
      if (s.tool !== 'pan') s.setTool('pan');
      else if (s.selection) s.patch({ selection: null });
      else if (s.logOpen) s.patch({ logOpen: false });
      break;
  }
}

function onKeyUp(e: KeyboardEvent) {
  const dir = DRIVE_KEYS[e.code];
  // always process releases, whatever has focus — a missed keyup must never keep the robot moving
  if (dir) teleop.setKey(dir, false);
}

export function App() {
  const dialog = useApp((s) => s.dialog);
  const labelDraft = useApp((s) => s.labelDraft);
  const zoneDraft = useApp((s) => s.zoneDraft);

  useEffect(() => {
    boot();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return (
    <div className="app">
      <TopBar />
      <main className="main">
        <Stage />
        <SidePanel />
      </main>
      <StatusBar />
      <Toasts />
      {labelDraft && <LabelDialog key={labelDraft.id ?? `${labelDraft.x}:${labelDraft.y}`} draft={labelDraft} />}
      {zoneDraft && <ZoneDialog draft={zoneDraft} />}
      {dialog === 'settings' && <SettingsDialog />}
      {dialog === 'system' && <SystemDialog />}
      {dialog === 'shortcuts' && <ShortcutsDialog />}
      <ConfirmDialog />
    </div>
  );
}
