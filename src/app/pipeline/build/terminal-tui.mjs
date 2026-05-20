// @ts-check

const ENTER_TERMINAL_TUI = '\x1b[?25l\x1b[2J\x1b[H';
const EXIT_TERMINAL_TUI = '\x1b[?25h\x1b[0m\n';
const CLEAR_FRAME = '\x1b[2J\x1b[H';

function asInputText(chunk) {
  if (Buffer.isBuffer(chunk)) {
    return chunk.toString('utf8');
  }
  return String(chunk ?? '');
}

function key(name, sequence, extra = {}) {
  return { name, sequence, ...extra };
}

function printableKey(character) {
  if (character === ' ') {
    return key('space', character, { text: character });
  }
  if (character === '/') {
    return key('slash', character, { text: character });
  }
  return key(character.toLowerCase(), character, { text: character });
}

function controlKey(character) {
  if (character === '\x03') {
    return key('c', character, { ctrl: true });
  }
  if (character === '\x7f' || character === '\b') {
    return key('backspace', character);
  }
  if (character === '\r' || character === '\n') {
    return key('return', character);
  }
  return key('control', character);
}

function csiKey(text, index) {
  const match = /^\x1b\[(?:\d+(?:;\d+)*)?([ABCD])/.exec(text.slice(index));
  if (!match) {
    return null;
  }
  const names = {
    A: 'up',
    B: 'down',
    C: 'right',
    D: 'left',
  };
  return {
    key: key(names[match[1]], match[0]),
    length: match[0].length,
  };
}

function ss3Key(text, index) {
  const match = /^\x1bO([ABCD])/.exec(text.slice(index));
  if (!match) {
    return null;
  }
  const names = {
    A: 'up',
    B: 'down',
    C: 'right',
    D: 'left',
  };
  return {
    key: key(names[match[1]], match[0]),
    length: match[0].length,
  };
}

function legacyWindowsKey(text, index) {
  const prefix = text[index];
  if (prefix !== '\x00' && prefix !== '\u00e0') {
    return null;
  }
  const code = text[index + 1];
  const names = {
    H: 'up',
    P: 'down',
    K: 'left',
    M: 'right',
  };
  if (!names[code]) {
    return null;
  }
  const sequence = `${prefix}${code}`;
  return {
    key: key(names[code], sequence),
    length: sequence.length,
  };
}

export function parseTerminalInputKeys(chunk) {
  const text = asInputText(chunk);
  const keys = [];
  for (let index = 0; index < text.length;) {
    const csi = csiKey(text, index);
    if (csi) {
      keys.push(csi.key);
      index += csi.length;
      continue;
    }
    const ss3 = ss3Key(text, index);
    if (ss3) {
      keys.push(ss3.key);
      index += ss3.length;
      continue;
    }
    const legacy = legacyWindowsKey(text, index);
    if (legacy) {
      keys.push(legacy.key);
      index += legacy.length;
      continue;
    }
    const character = text[index];
    if (character === '\x1b') {
      keys.push(key('escape', character));
      index += 1;
      continue;
    }
    if (character === '\r' && text[index + 1] === '\n') {
      keys.push(key('return', '\r\n'));
      index += 2;
      continue;
    }
    if (character < ' ' || character === '\x7f') {
      keys.push(controlKey(character));
      index += 1;
      continue;
    }
    keys.push(printableKey(character));
    index += 1;
  }
  return keys;
}

export async function* readTerminalKeys(input) {
  const queue = [];
  let done = false;
  let failure = null;
  let notify = null;
  const wake = () => {
    const resolve = notify;
    notify = null;
    if (resolve) {
      resolve();
    }
  };
  const onData = (chunk) => {
    queue.push(...parseTerminalInputKeys(chunk));
    wake();
  };
  const onEnd = () => {
    done = true;
    wake();
  };
  const onError = (error) => {
    failure = error;
    done = true;
    wake();
  };
  input.on('data', onData);
  input.once('end', onEnd);
  input.once('close', onEnd);
  input.once('error', onError);
  try {
    while (true) {
      if (queue.length) {
        yield queue.shift();
        continue;
      }
      if (failure) {
        throw failure;
      }
      if (done) {
        return;
      }
      await new Promise((resolve) => {
        notify = resolve;
      });
    }
  } finally {
    input.off('data', onData);
    input.off('end', onEnd);
    input.off('close', onEnd);
    input.off('error', onError);
  }
}

export function enterTerminalTui(input, output) {
  if (!input?.isTTY || !output?.isTTY || typeof input.setRawMode !== 'function' || typeof output.write !== 'function') {
    return null;
  }
  const previousRawMode = Boolean(input.isRaw);
  try {
    input.setRawMode(true);
  } catch {
    return null;
  }
  input.resume?.();
  output.write(ENTER_TERMINAL_TUI);
  let lastFrame = null;
  let closed = false;
  return {
    render(frame) {
      if (closed || frame === lastFrame) {
        return;
      }
      lastFrame = frame;
      output.write(`${CLEAR_FRAME}${frame}`);
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      try {
        input.setRawMode(previousRawMode);
      } catch {
        // The screen must still be restored even when the terminal refuses raw-mode reset.
      }
      output.write(EXIT_TERMINAL_TUI);
    },
  };
}

export function isTerminalReturnKey(key = {}) {
  return key.name === 'return' || key.name === 'enter' || key.sequence === '\r' || key.sequence === '\n' || key.sequence === '\r\n';
}

export function isTerminalSpaceKey(key = {}) {
  return key.name === 'space' || key.name === 'spacebar' || key.sequence === ' ' || key.text === ' ';
}

export function isTerminalSlashKey(key = {}) {
  return key.name === 'slash' || key.sequence === '/' || key.text === '/';
}

export function isTerminalCharacterKey(key = {}, character) {
  const wanted = String(character ?? '').toLowerCase();
  return key.name === wanted
    || String(key.sequence ?? '').toLowerCase() === wanted
    || String(key.text ?? '').toLowerCase() === wanted;
}
