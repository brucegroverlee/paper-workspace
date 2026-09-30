// JSON with comments and trailing commas, as VS Code themes and language configurations are written.

/** Parse JSONC: `//` and `/* *\/` comments and trailing commas are allowed. Throws on invalid input. */
export function parseJsonc(text: string): unknown {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      // Copy a string literal as is, escapes included.
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(removeTrailingCommas(out));
}

/** Drop commas that directly precede `}` or `]`, skipping string literals. */
function removeTrailingCommas(json: string): string {
  let out = '';
  let i = 0;
  const n = json.length;
  while (i < n) {
    const c = json[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && json[j] !== '"') j += json[j] === '\\' ? 2 : 1;
      out += json.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < n && /\s/.test(json[j])) j++;
      if (json[j] === '}' || json[j] === ']') {
        i++;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}
