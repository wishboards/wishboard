const ALLOWED_SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'polygon', 'line']);
const ALLOWED_CHILD_TAGS = new Set(['path', 'circle', 'rect', 'polygon', 'line']);

const ALLOWED_ATTRS = {
  svg: new Set(['viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'opacity']),
  path: new Set(['d', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform']),
  circle: new Set(['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform']),
  rect: new Set([
    'x',
    'y',
    'width',
    'height',
    'fill',
    'stroke',
    'stroke-width',
    'opacity',
    'transform',
  ]),
  polygon: new Set(['points', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform']),
  line: new Set(['x1', 'y1', 'x2', 'y2', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform']),
};

const CANONICAL_ATTR_NAMES = {
  viewbox: 'viewBox',
};

const NAMED_ENTITIES = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const DANGEROUS_VALUE_RE =
  /(?:javascript:|vbscript:|data:|https?:\/\/|\/\/|url\s*\(|expression\s*\()/i;

const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const LENGTH_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px|%|em|rem)?$/i;
const PATH_D_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9\s,.\-+eE]+$/;
const POINTS_RE = /^[0-9\s,.\-+eE]+$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const NAMED_COLOR_RE = /^[a-zA-Z]{1,25}$/;
const FUNC_COLOR_NAMES = new Set(['rgb', 'rgba', 'hsl', 'hsla']);
const ALLOWED_TRANSFORM_FNS = new Set(['translate', 'scale', 'rotate', 'skewx', 'skewy', 'matrix']);
const LENGTH_ATTRS = new Set([
  'width',
  'height',
  'cx',
  'cy',
  'r',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'stroke-width',
]);
const DATA_SVG_UTF8_METAS = new Set([
  'data:image/svg+xml',
  'data:image/svg+xml;utf8',
  'data:image/svg+xml;charset=utf-8',
  'data:image/svg+xml;charset=utf8',
]);

function decodeEntities(raw) {
  let decoded = raw;
  for (let pass = 0; pass < 2; pass++) {
    const next = decoded
      .replace(/&#x([0-9a-fA-F]+);?/g, (_, hex) => {
        const code = Number.parseInt(hex, 16);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
      })
      .replace(/&#(\d+);?/g, (_, dec) => {
        const code = Number.parseInt(dec, 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
      })
      .replace(/&([a-zA-Z]+);/g, (full, name) => NAMED_ENTITIES[name.toLowerCase()] ?? full);
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function stripControlChars(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.codePointAt(i);
    if (code >= 0x20 && code !== 0x7f) {
      out += str[i];
    } else if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += ' ';
    }
  }
  return out;
}

function escapeXmlAttr(val) {
  return val
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function validateViewBox(val) {
  const parts = val
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (NUMBER_RE.test(p) ? Number(p) : Number.NaN));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (nums[2] <= 0 || nums[3] <= 0) return null;
  return nums.join(' ');
}

function isColorArgValid(token) {
  const numPart = token.endsWith('%') ? token.slice(0, -1) : token;
  return NUMBER_RE.test(numPart);
}

function validateFuncColor(trimmed) {
  if (!trimmed.endsWith(')')) return false;
  const openIdx = trimmed.indexOf('(');
  if (openIdx <= 0) return false;
  const fnName = trimmed.slice(0, openIdx).toLowerCase();
  if (!FUNC_COLOR_NAMES.has(fnName)) return false;

  const inner = trimmed.slice(openIdx + 1, -1).trim();
  if (!inner) return false;
  const parts = inner.split(/[\s,/]+/).filter(Boolean);
  return (parts.length === 3 || parts.length === 4) && parts.every(isColorArgValid);
}

function validateColor(val) {
  const trimmed = val.trim();
  if (!trimmed) return null;
  if (HEX_COLOR_RE.test(trimmed)) return trimmed;
  if (NAMED_COLOR_RE.test(trimmed)) return trimmed;
  if (validateFuncColor(trimmed)) return trimmed;
  return null;
}

function areTransformArgsValid(argsStr) {
  const trimmed = argsStr.trim();
  if (!trimmed || trimmed.startsWith(',') || trimmed.endsWith(',')) return false;
  const commaParts = trimmed.split(',');
  for (const part of commaParts) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || !tokens.every((t) => NUMBER_RE.test(t))) {
      return false;
    }
  }
  return true;
}

function validateTransform(val) {
  const trimmed = val.trim();
  if (!trimmed) return null;

  let idx = 0;
  let count = 0;
  while (idx < trimmed.length) {
    idx = skipWhitespace(trimmed, idx);
    if (idx >= trimmed.length) break;

    const openIdx = trimmed.indexOf('(', idx);
    if (openIdx === -1) return null;
    const fnName = trimmed.slice(idx, openIdx).trim().toLowerCase();
    if (!ALLOWED_TRANSFORM_FNS.has(fnName)) return null;

    const closeIdx = trimmed.indexOf(')', openIdx + 1);
    if (closeIdx === -1) return null;
    if (!areTransformArgsValid(trimmed.slice(openIdx + 1, closeIdx))) return null;

    count += 1;
    idx = closeIdx + 1;
  }

  return count > 0 ? trimmed : null;
}

function validatePoints(decoded) {
  if (!POINTS_RE.test(decoded)) return null;
  const nums = decoded.split(/[\s,]+/).filter(Boolean);
  return nums.length >= 2 && nums.every((n) => NUMBER_RE.test(n)) ? decoded : null;
}

function validateOpacity(decoded) {
  if (!NUMBER_RE.test(decoded)) return null;
  const num = Number(decoded);
  return Number.isFinite(num) && num >= 0 && num <= 1 ? decoded : null;
}

function validateAttrValue(attrName, rawValue) {
  const decoded = stripControlChars(decodeEntities(rawValue)).trim();
  if (!decoded) return null;

  // Strip all whitespace when checking for obfuscated dangerous schemes
  const collapsed = decoded.replace(/\s+/g, '');
  if (DANGEROUS_VALUE_RE.test(decoded) || DANGEROUS_VALUE_RE.test(collapsed)) {
    return null;
  }

  if (LENGTH_ATTRS.has(attrName)) {
    return LENGTH_RE.test(decoded) ? decoded : null;
  }

  switch (attrName) {
    case 'viewBox':
      return validateViewBox(decoded);
    case 'd':
      return PATH_D_RE.test(decoded) ? decoded : null;
    case 'points':
      return validatePoints(decoded);
    case 'fill':
    case 'stroke':
      return validateColor(decoded);
    case 'transform':
      return validateTransform(decoded);
    case 'opacity':
      return validateOpacity(decoded);
    default:
      return null;
  }
}

function isWhitespaceChar(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function skipWhitespace(str, idx) {
  let i = idx;
  while (i < str.length && isWhitespaceChar(str[i])) i++;
  return i;
}

function readAttrName(str, idx) {
  let i = idx;
  while (
    i < str.length &&
    !isWhitespaceChar(str[i]) &&
    str[i] !== '=' &&
    str[i] !== '/' &&
    str[i] !== '>'
  ) {
    i++;
  }
  return { rawName: str.slice(idx, i), nextIdx: i };
}

function readAttrValue(str, idx) {
  let i = skipWhitespace(str, idx);
  if (i >= str.length || str[i] !== '=') {
    return { rawValue: '', nextIdx: i };
  }
  i = skipWhitespace(str, i + 1);
  if (i < str.length && (str[i] === '"' || str[i] === "'")) {
    const quote = str[i++];
    const valStart = i;
    while (i < str.length && str[i] !== quote) i++;
    const rawValue = str.slice(valStart, i);
    if (i < str.length && str[i] === quote) i++;
    return { rawValue, nextIdx: i };
  }
  const valStart = i;
  while (i < str.length && !isWhitespaceChar(str[i]) && str[i] !== '/' && str[i] !== '>') {
    i++;
  }
  return { rawValue: str.slice(valStart, i), nextIdx: i };
}

function parseAttributes(attrString, tagName) {
  const allowedSet = ALLOWED_ATTRS[tagName];
  if (!allowedSet) return {};

  const attrs = {};
  let i = 0;
  const len = attrString.length;

  while (i < len) {
    i = skipWhitespace(attrString, i);
    if (i >= len) break;

    const nameResult = readAttrName(attrString, i);
    if (!nameResult.rawName) {
      i++;
      continue;
    }

    const valResult = readAttrValue(attrString, nameResult.nextIdx);
    i = valResult.nextIdx;

    const lowerName = nameResult.rawName.toLowerCase();
    const canonicalName = CANONICAL_ATTR_NAMES[lowerName] || lowerName;
    if (allowedSet.has(canonicalName)) {
      const validated = validateAttrValue(canonicalName, valResult.rawValue);
      if (validated !== null) {
        attrs[canonicalName] = validated;
      }
    }
  }

  return attrs;
}

function decodeBase64Utf8(base64Str) {
  const cleaned = base64Str.replace(/\s+/g, '');
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.codePointAt(i);
    }
    if (typeof globalThis.TextDecoder === 'function') {
      return new globalThis.TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
    return binary;
  }
  return null;
}

function decodeDataSvgUri(trimmed) {
  const commaIdx = trimmed.indexOf(',');
  if (commaIdx === -1) return null;
  const meta = trimmed.slice(0, commaIdx).toLowerCase();
  const payload = trimmed.slice(commaIdx + 1);

  if (meta.includes(';base64')) {
    try {
      return decodeBase64Utf8(payload);
    } catch {
      return null;
    }
  }

  if (!DATA_SVG_UTF8_METAS.has(meta)) {
    return null;
  }

  try {
    return payload.includes('%') ? decodeURIComponent(payload) : payload;
  } catch (err) {
    if (err instanceof URIError && payload.trimStart().startsWith('<')) {
      return payload;
    }
    return null;
  }
}

function unwrapSvgInput(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^data:image\/svg\+xml/i.test(trimmed)) {
    return decodeDataSvgUri(trimmed);
  }
  return trimmed;
}

function stripDelimited(str, openToken, closeToken) {
  let out = '';
  let pos = 0;
  while (pos < str.length) {
    const start = str.indexOf(openToken, pos);
    if (start === -1) {
      out += str.slice(pos);
      break;
    }
    out += str.slice(pos, start);
    const end = str.indexOf(closeToken, start + openToken.length);
    if (end === -1) {
      break;
    }
    pos = end + closeToken.length;
  }
  return out;
}

function stripDoctype(str) {
  let out = '';
  let pos = 0;
  const lower = str.toLowerCase();
  while (pos < str.length) {
    const start = lower.indexOf('<!doctype', pos);
    if (start === -1) {
      out += str.slice(pos);
      break;
    }
    out += str.slice(pos, start);
    let i = start + 9;
    let inSubset = false;
    while (i < str.length) {
      const ch = str[i];
      if (ch === '[') inSubset = true;
      else if (ch === ']') inSubset = false;
      else if (ch === '>' && !inSubset) {
        i += 1;
        break;
      }
      i += 1;
    }
    pos = i;
  }
  return out;
}

function stripPrologueAndComments(raw) {
  let out = raw;
  // Strip UTF-8 BOM if present
  if (out.codePointAt(0) === 0xfeff) {
    out = out.slice(1);
  }
  // Iteratively strip comments, processing instructions (<?...?>), and DOCTYPE declarations
  let prev;
  do {
    prev = out;
    out = stripDoctype(stripDelimited(stripDelimited(out, '<!--', '-->'), '<?', '?>'));
  } while (out !== prev);
  return out;
}

function findTagEnd(str, startIdx) {
  let quote = null;
  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

function serializeAttrs(attrs) {
  return Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeXmlAttr(v)}"`)
    .join(' ');
}

function splitTagNameAndAttrs(inner) {
  let i = 0;
  while (i < inner.length && !isWhitespaceChar(inner[i]) && inner[i] !== '/' && inner[i] !== '>') {
    i++;
  }
  if (i === 0) return null;
  return {
    tagName: inner.slice(0, i).toLowerCase(),
    attrStr: inner.slice(i),
  };
}

function handleClosingTag(tagContent, state) {
  const closeName = tagContent.slice(1).trim().toLowerCase();
  if (state.skipStack.length > 0) {
    if (state.skipStack.at(-1) === closeName) {
      state.skipStack.pop();
    }
    return false;
  }
  return closeName === 'svg' && state.insideSvg;
}

function handleOpeningTag(tagContent, state) {
  const isSelfClosing = tagContent.endsWith('/');
  const inner = isSelfClosing ? tagContent.slice(0, -1).trim() : tagContent;
  const parsed = splitTagNameAndAttrs(inner);
  if (!parsed) return true;

  const { tagName, attrStr } = parsed;
  if (state.skipStack.length > 0) {
    if (!isSelfClosing) state.skipStack.push(tagName);
    return true;
  }

  if (!state.insideSvg) {
    if (tagName !== 'svg' || isSelfClosing) return false;
    const attrs = parseAttributes(attrStr, 'svg');
    if (!attrs.viewBox) return false;
    state.rootSvgAttrs = attrs;
    state.insideSvg = true;
    return true;
  }

  if (!ALLOWED_SVG_TAGS.has(tagName) || !ALLOWED_CHILD_TAGS.has(tagName)) {
    if (!isSelfClosing) state.skipStack.push(tagName);
    return true;
  }

  const attrSerialized = serializeAttrs(parseAttributes(attrStr, tagName));
  state.childElements.push(attrSerialized ? `<${tagName} ${attrSerialized} />` : `<${tagName} />`);
  return true;
}

/**
 * Strictly sanitizes an SVG string or `data:image/svg+xml` URI using an allowlist of tags and attributes.
 * Returns canonical sanitized `<svg ...>...</svg>` or `null` if invalid or empty.
 *
 * @param {string} input
 * @returns {string | null}
 */
export function sanitizeSvg(input) {
  if (typeof input !== 'string') return null;

  const unwrapped = unwrapSvgInput(input);
  if (!unwrapped) return null;

  const cleaned = stripPrologueAndComments(unwrapped).trim();
  if (!cleaned) return null;

  let pos = 0;
  const state = {
    rootSvgAttrs: null,
    childElements: [],
    insideSvg: false,
    skipStack: [],
  };

  while (pos < cleaned.length) {
    const ltIdx = cleaned.indexOf('<', pos);
    if (ltIdx === -1) break;

    const gtIdx = findTagEnd(cleaned, ltIdx + 1);
    if (gtIdx === -1) return null;

    const tagContent = cleaned.slice(ltIdx + 1, gtIdx).trim();
    pos = gtIdx + 1;
    if (!tagContent || tagContent.startsWith('!')) continue;

    if (tagContent.startsWith('/')) {
      if (handleClosingTag(tagContent, state)) break;
      continue;
    }

    if (!handleOpeningTag(tagContent, state)) return null;
  }

  if (!state.rootSvgAttrs?.viewBox || state.childElements.length === 0) {
    return null;
  }

  const rootAttrSerialized = serializeAttrs(state.rootSvgAttrs);
  return `<svg ${rootAttrSerialized}>${state.childElements.join('')}</svg>`;
}

function hasControlChars(str) {
  for (let i = 0; i < str.length; i++) {
    const code = str.codePointAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Validates and sanitizes a sticker image `src` attribute.
 * Allows safe relative paths (`/assets/...` or `/images/...` without traversal)
 * or `data:image/svg+xml` URIs (sanitized via `sanitizeSvg`).
 *
 * @param {string} src
 * @returns {string | null}
 */
export function sanitizeStickerImageSrc(src) {
  if (typeof src !== 'string') return null;
  const trimmed = src.trim();
  if (!trimmed || hasControlChars(trimmed)) return null;

  if (/^data:image\/svg\+xml/i.test(trimmed)) {
    const sanitized = sanitizeSvg(trimmed);
    if (!sanitized) return null;
    const withXmlns = sanitized.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
    return `data:image/svg+xml;utf8,${encodeURIComponent(withXmlns)}`;
  }

  if (trimmed.startsWith('//') || trimmed.includes('\\')) {
    return null;
  }

  if (!trimmed.startsWith('/assets/') && !trimmed.startsWith('/images/')) {
    return null;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(trimmed);
  } catch {
    return null;
  }

  if (
    hasControlChars(decodedPath) ||
    decodedPath.includes('..') ||
    decodedPath.includes('\\') ||
    decodedPath.startsWith('//')
  ) {
    return null;
  }

  return trimmed;
}
