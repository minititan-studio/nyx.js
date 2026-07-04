import { inputsLib } from './inputs';

const reg = inputsLib.registry;
const prev: Record<string, number> = {};

// Standalone keyboard state — populated by our own listeners below.
// If the keyboard catmod is also enabled it writes the same keys, no conflict.
let _lastKey  = '';
let _lastCode = '';
let _string   = '';
let _shift    = false;
let _alt      = false;
let _ctrl     = false;

document.addEventListener('keydown', (e: KeyboardEvent) => {
    const code = e.code || 'Unknown';
    reg['keyboard.' + code] = 1;
    _lastKey  = e.key  ?? '';
    _lastCode = code;
    _shift    = e.shiftKey;
    _alt      = e.altKey;
    _ctrl     = e.ctrlKey;
    if (e.key) {
        if (e.key.length === 1)        _string += e.key;
        else if (e.key === 'Backspace') _string = _string.slice(0, -1);
        else if (e.key === 'Enter')     _string = '';
    }
}, false);

document.addEventListener('keyup', (e: KeyboardEvent) => {
    reg['keyboard.' + (e.code || 'Unknown')] = 0;
    _shift = e.shiftKey;
    _alt   = e.altKey;
    _ctrl  = e.ctrlKey;
}, false);

function isDown(code: string): boolean {
    return (reg['keyboard.' + code] ?? 0) !== 0;
}
function isPressed(code: string): boolean {
    return (prev['keyboard.' + code] ?? 0) === 0 &&
           (reg['keyboard.' + code] ?? 0) !== 0;
}
function isReleased(code: string): boolean {
    return (prev['keyboard.' + code] ?? 0) !== 0 &&
           (reg['keyboard.' + code] ?? 0) === 0;
}

export const Key = {
    // Letters
    A: 'KeyA', B: 'KeyB', C: 'KeyC', D: 'KeyD', E: 'KeyE',
    F: 'KeyF', G: 'KeyG', H: 'KeyH', I: 'KeyI', J: 'KeyJ',
    K: 'KeyK', L: 'KeyL', M: 'KeyM', N: 'KeyN', O: 'KeyO',
    P: 'KeyP', Q: 'KeyQ', R: 'KeyR', S: 'KeyS', T: 'KeyT',
    U: 'KeyU', V: 'KeyV', W: 'KeyW', X: 'KeyX', Y: 'KeyY',
    Z: 'KeyZ',
    // Number row (Alpha* mirrors Unity naming)
    Alpha0: 'Digit0', Alpha1: 'Digit1', Alpha2: 'Digit2',
    Alpha3: 'Digit3', Alpha4: 'Digit4', Alpha5: 'Digit5',
    Alpha6: 'Digit6', Alpha7: 'Digit7', Alpha8: 'Digit8', Alpha9: 'Digit9',
    // Numpad (Keypad* mirrors Unity naming)
    Keypad0: 'Numpad0', Keypad1: 'Numpad1', Keypad2: 'Numpad2',
    Keypad3: 'Numpad3', Keypad4: 'Numpad4', Keypad5: 'Numpad5',
    Keypad6: 'Numpad6', Keypad7: 'Numpad7', Keypad8: 'Numpad8', Keypad9: 'Numpad9',
    KeypadPlus: 'NumpadAdd', KeypadMinus: 'NumpadSubtract',
    KeypadMultiply: 'NumpadMultiply', KeypadDivide: 'NumpadDivide',
    KeypadPeriod: 'NumpadDecimal', KeypadEnter: 'NumpadEnter',
    Numlock: 'NumLock',
    // Function keys
    F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
    F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
    // Arrows (Unity naming)
    UpArrow: 'ArrowUp', DownArrow: 'ArrowDown',
    LeftArrow: 'ArrowLeft', RightArrow: 'ArrowRight',
    // Navigation
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    Insert: 'Insert', Delete: 'Delete',
    // Special
    Space: 'Space', Return: 'Enter', Enter: 'Enter',
    Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace',
    CapsLock: 'CapsLock', ScrollLock: 'ScrollLock',
    Pause: 'Pause', PrintScreen: 'PrintScreen',
    // Modifiers
    LeftShift: 'ShiftLeft', RightShift: 'ShiftRight',
    LeftControl: 'ControlLeft', RightControl: 'ControlRight',
    LeftAlt: 'AltLeft', RightAlt: 'AltRight',
    LeftMeta: 'MetaLeft', RightMeta: 'MetaRight',
    // Punctuation
    Comma: 'Comma', Period: 'Period', Slash: 'Slash', Backslash: 'Backslash',
    Semicolon: 'Semicolon', Quote: 'Quote',
    LeftBracket: 'BracketLeft', RightBracket: 'BracketRight',
    Backquote: 'Backquote', Minus: 'Minus', Equals: 'Equal',
} as const;

// Methods we always add to window.keyboard (creating it if the catmod isn't enabled).
const KeyboardExtension = {
    isDown,
    isPressed,
    isReleased,
};

// Minimal keyboard global for when the catmod is absent.
const fallbackKeyboard = {
    ...KeyboardExtension,
    get lastKey()  { return _lastKey; },
    get lastCode() { return _lastCode; },
    get string()   { return _string; },
    get shift()    { return _shift; },
    get alt()      { return _alt; },
    get ctrl()     { return _ctrl; },
    clear() { _lastKey = _lastCode = _string = ''; _shift = _alt = _ctrl = false; },
};

// Track which object we last patched. If the catmod replaces window.keyboard
// (e.g. on a second play session), the reference changes and we re-patch.
let patchedKb: object | null = null;

export const keyboardLib = {
    Key,
    // Called at the START of each frame — patches window.keyboard if needed.
    update(): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        const kb = w.keyboard ?? null;
        if (kb !== patchedKb) {
            if (kb) {
                Object.assign(kb, KeyboardExtension);
                patchedKb = kb;
            } else {
                w.keyboard = fallbackKeyboard;
                patchedKb = fallbackKeyboard;
            }
        }
    },
    // Called at the END of each frame — snapshots prev so next frame's
    // isPressed/isReleased compare against this frame's state, not next frame's.
    endFrame(): void {
        for (const k in reg) {
            if (k.startsWith('keyboard.')) {
                prev[k] = reg[k];
            }
        }
    },
};

export default keyboardLib;
