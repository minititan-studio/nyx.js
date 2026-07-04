/**
 * This module provides keyboard inputs for Nyx's Actions system. It also has a number of its own
 * handy methods and variables.
 */
declare namespace keyboard {
    var lastKey: string;
    var lastCode: string;
    var string: string;
    var alt: boolean;
    var shift: boolean;
    var ctrl: boolean;

    function clear(): void;

    /** True while the key is held down. Pass a `Key.*` constant or a Web KeyboardEvent code string. */
    function isDown(code: string): boolean;
    /** True on the first frame the key was pressed. */
    function isPressed(code: string): boolean;
    /** True on the first frame the key was released. */
    function isReleased(code: string): boolean;
}

/**
 * Key code constants for use with `keyboard.isDown()`, `keyboard.isPressed()`, and `keyboard.isReleased()`.
 * Named after Unity's KeyCode enum, mapped to Web KeyboardEvent `code` values.
 *
 * @example
 * if (keyboard.isPressed(Key.Space)) this.jump();
 * if (keyboard.isDown(Key.W)) this.y -= speed;
 */
declare const Key: {
    readonly A: 'KeyA'; readonly B: 'KeyB'; readonly C: 'KeyC'; readonly D: 'KeyD'; readonly E: 'KeyE';
    readonly F: 'KeyF'; readonly G: 'KeyG'; readonly H: 'KeyH'; readonly I: 'KeyI'; readonly J: 'KeyJ';
    readonly K: 'KeyK'; readonly L: 'KeyL'; readonly M: 'KeyM'; readonly N: 'KeyN'; readonly O: 'KeyO';
    readonly P: 'KeyP'; readonly Q: 'KeyQ'; readonly R: 'KeyR'; readonly S: 'KeyS'; readonly T: 'KeyT';
    readonly U: 'KeyU'; readonly V: 'KeyV'; readonly W: 'KeyW'; readonly X: 'KeyX'; readonly Y: 'KeyY';
    readonly Z: 'KeyZ';
    readonly Alpha0: 'Digit0'; readonly Alpha1: 'Digit1'; readonly Alpha2: 'Digit2';
    readonly Alpha3: 'Digit3'; readonly Alpha4: 'Digit4'; readonly Alpha5: 'Digit5';
    readonly Alpha6: 'Digit6'; readonly Alpha7: 'Digit7'; readonly Alpha8: 'Digit8'; readonly Alpha9: 'Digit9';
    readonly Keypad0: 'Numpad0'; readonly Keypad1: 'Numpad1'; readonly Keypad2: 'Numpad2';
    readonly Keypad3: 'Numpad3'; readonly Keypad4: 'Numpad4'; readonly Keypad5: 'Numpad5';
    readonly Keypad6: 'Numpad6'; readonly Keypad7: 'Numpad7'; readonly Keypad8: 'Numpad8'; readonly Keypad9: 'Numpad9';
    readonly KeypadPlus: 'NumpadAdd'; readonly KeypadMinus: 'NumpadSubtract';
    readonly KeypadMultiply: 'NumpadMultiply'; readonly KeypadDivide: 'NumpadDivide';
    readonly KeypadPeriod: 'NumpadDecimal'; readonly KeypadEnter: 'NumpadEnter';
    readonly Numlock: 'NumLock';
    readonly F1: 'F1'; readonly F2: 'F2'; readonly F3: 'F3'; readonly F4: 'F4';
    readonly F5: 'F5'; readonly F6: 'F6'; readonly F7: 'F7'; readonly F8: 'F8';
    readonly F9: 'F9'; readonly F10: 'F10'; readonly F11: 'F11'; readonly F12: 'F12';
    readonly UpArrow: 'ArrowUp'; readonly DownArrow: 'ArrowDown';
    readonly LeftArrow: 'ArrowLeft'; readonly RightArrow: 'ArrowRight';
    readonly Home: 'Home'; readonly End: 'End'; readonly PageUp: 'PageUp'; readonly PageDown: 'PageDown';
    readonly Insert: 'Insert'; readonly Delete: 'Delete';
    readonly Space: 'Space'; readonly Return: 'Enter'; readonly Enter: 'Enter';
    readonly Escape: 'Escape'; readonly Tab: 'Tab'; readonly Backspace: 'Backspace';
    readonly CapsLock: 'CapsLock'; readonly ScrollLock: 'ScrollLock';
    readonly Pause: 'Pause'; readonly PrintScreen: 'PrintScreen';
    readonly LeftShift: 'ShiftLeft'; readonly RightShift: 'ShiftRight';
    readonly LeftControl: 'ControlLeft'; readonly RightControl: 'ControlRight';
    readonly LeftAlt: 'AltLeft'; readonly RightAlt: 'AltRight';
    readonly LeftMeta: 'MetaLeft'; readonly RightMeta: 'MetaRight';
    readonly Comma: 'Comma'; readonly Period: 'Period'; readonly Slash: 'Slash'; readonly Backslash: 'Backslash';
    readonly Semicolon: 'Semicolon'; readonly Quote: 'Quote';
    readonly LeftBracket: 'BracketLeft'; readonly RightBracket: 'BracketRight';
    readonly Backquote: 'Backquote'; readonly Minus: 'Minus'; readonly Equals: 'Equal';
};
