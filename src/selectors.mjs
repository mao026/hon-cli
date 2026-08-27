import { HonError, EXIT } from './errors.mjs';

const ATTRIBUTE_ALIASES = Object.freeze({
  class: 'type',
  'resource-id': 'id',
  resourceId: 'id',
  desc: 'description',
  'content-desc': 'description',
  package: 'bundleName',
});

const BOOLEAN_PSEUDOS = new Set([
  'visible', 'clickable', 'enabled', 'focused', 'checked', 'selected', 'scrollable', 'checkable', 'longClickable',
]);

export function parseBounds(value) {
  if (Array.isArray(value) && value.length === 4) {
    return makeBounds(...value.map(Number));
  }
  const text = String(value ?? '').trim();
  let match = text.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
  if (match) return makeBounds(...match.slice(1).map(Number));
  match = text.match(/^(-?\d+),(-?\d+),(-?\d+),(-?\d+)$/);
  if (match) {
    const [left, right, top, bottom] = match.slice(1).map(Number);
    return makeBounds(left, top, right, bottom);
  }
  return null;
}

function makeBounds(left, top, right, bottom) {
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    center: [Math.round((left + right) / 2), Math.round((top + bottom) / 2)],
  };
}

function booleanValue(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return fallback;
}

export function flattenLayout(layout) {
  const nodes = [];
  const roots = Array.isArray(layout) ? layout : [layout];

  function visit(raw, parent = null, depth = 0) {
    if (!raw || typeof raw !== 'object') return;
    const attributes = raw.attributes && typeof raw.attributes === 'object' ? raw.attributes : raw;
    const bounds = parseBounds(attributes.bounds ?? attributes.rectInScreen ?? attributes.origBounds);
    const node = {
      raw,
      parent,
      depth,
      type: String(attributes.type ?? attributes.componentType ?? 'Unknown'),
      id: String(attributes.id ?? attributes.key ?? attributes.accessibilityId ?? ''),
      accessibilityId: String(attributes.accessibilityId ?? ''),
      text: String(attributes.text ?? attributes.content ?? attributes.originalText ?? ''),
      description: String(attributes.description ?? ''),
      hint: String(attributes.hint ?? ''),
      bundleName: String(attributes.bundleName ?? ''),
      abilityName: String(attributes.abilityName ?? ''),
      pagePath: String(attributes.pagePath ?? ''),
      visible: booleanValue(attributes.visible, true),
      clickable: booleanValue(attributes.clickable),
      enabled: booleanValue(attributes.enabled, true),
      focused: booleanValue(attributes.focused),
      checked: booleanValue(attributes.checked),
      selected: booleanValue(attributes.selected),
      scrollable: booleanValue(attributes.scrollable),
      checkable: booleanValue(attributes.checkable),
      longClickable: booleanValue(attributes.longClickable),
      bounds,
      attributes,
    };
    nodes.push(node);
    for (const child of raw.children ?? []) visit(child, node, depth + 1);
  }

  for (const root of roots) visit(root);
  return nodes;
}

function unquote(value) {
  const text = value.trim();
  if (text.length >= 2 && ((text[0] === '"' && text.at(-1) === '"') || (text[0] === "'" && text.at(-1) === "'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function parseStructuredSelector(source) {
  let rest = source.trim();
  const typeMatch = rest.match(/^(\*|[A-Za-z_$][\w.$-]*)/);
  const type = typeMatch ? typeMatch[1] : '*';
  if (typeMatch) rest = rest.slice(typeMatch[0].length);
  const predicates = [];

  while (rest.trim()) {
    rest = rest.trimStart();
    if (rest.startsWith('[')) {
      const close = rest.indexOf(']');
      if (close < 0) throw new HonError('BAD_SELECTOR', `选择器属性缺少 ]：${source}`, EXIT.USAGE);
      const expression = rest.slice(1, close).trim();
      const match = expression.match(/^([\w-]+)\s*(?:(~=|\^=|\$=|=)\s*(.*))?$/);
      if (!match) throw new HonError('BAD_SELECTOR', `无效属性选择器：[${expression}]`, EXIT.USAGE);
      const key = ATTRIBUTE_ALIASES[match[1]] ?? match[1];
      const operator = match[2] ?? 'present';
      const expected = unquote(match[3] ?? '');
      predicates.push((node) => compare(node[key] ?? node.attributes?.[key], operator, expected));
      rest = rest.slice(close + 1);
      continue;
    }

    const textPseudo = rest.match(/^:(has-text|text-is)\(("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\)/);
    if (textPseudo) {
      const expected = unquote(textPseudo[2]);
      predicates.push((node) => textPseudo[1] === 'text-is' ? label(node) === expected : label(node).includes(expected));
      rest = rest.slice(textPseudo[0].length);
      continue;
    }

    const boolPseudo = rest.match(/^:([A-Za-z][\w-]*)/);
    if (boolPseudo) {
      if (!BOOLEAN_PSEUDOS.has(boolPseudo[1])) {
        throw new HonError('BAD_SELECTOR', `不支持伪类：:${boolPseudo[1]}`, EXIT.USAGE);
      }
      predicates.push((node) => Boolean(node[boolPseudo[1]]));
      rest = rest.slice(boolPseudo[0].length);
      continue;
    }
    throw new HonError('BAD_SELECTOR', `无法解析选择器：${source}`, EXIT.USAGE);
  }

  return (node) => {
    const nodeType = node.type.split('.').at(-1);
    const expectedType = type.split('.').at(-1);
    return (type === '*' || node.type === type || nodeType === expectedType) && predicates.every((test) => test(node));
  };
}

function compare(actualValue, operator, expected) {
  const actual = String(actualValue ?? '');
  if (operator === 'present') return actual !== '';
  if (operator === '=') return actual === expected;
  if (operator === '~=') return actual.includes(expected);
  if (operator === '^=') return actual.startsWith(expected);
  if (operator === '$=') return actual.endsWith(expected);
  return false;
}

export function label(node) {
  return node.text || node.description || node.hint || node.id;
}

export function compileSelector(source) {
  const selector = String(source ?? '').trim();
  if (!selector) throw new HonError('BAD_SELECTOR', '选择器不能为空', EXIT.USAGE);
  const structured = selector.startsWith('[') || selector.startsWith(':') || /^[A-Za-z_$*][\w.$-]*(?:\[|:)/.test(selector);
  if (structured) return parseStructuredSelector(selector);

  return (node) => {
    const values = [node.text, node.description, node.hint, node.id].filter(Boolean);
    return values.some((value) => value === selector);
  };
}

export function findNodes(nodes, selector, { visible = true } = {}) {
  const matcher = compileSelector(selector);
  let matches = nodes.filter((node) => matcher(node));
  if (visible) matches = matches.filter((node) => node.visible && node.bounds && node.bounds.width > 0 && node.bounds.height > 0);

  if (matches.length === 0 && !/[\[:]/.test(selector)) {
    const needle = selector.toLowerCase();
    matches = nodes.filter((node) => {
      if (visible && (!node.visible || !node.bounds || node.bounds.width <= 0 || node.bounds.height <= 0)) return false;
      return [node.text, node.description, node.hint, node.id]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle));
    });
  }
  return matches;
}

export function resolveNode(nodes, selector, { unique = true, visible = true } = {}) {
  const matches = findNodes(nodes, selector, { visible });
  if (matches.length === 0) {
    throw new HonError('NOT_FOUND', `未找到控件：${selector}`, EXIT.NOT_FOUND, { selector });
  }
  if (unique && matches.length > 1) {
    throw new HonError('AMBIGUOUS', `选择器匹配到 ${matches.length} 个控件：${selector}`, EXIT.AMBIGUOUS, {
      selector,
      matches: matches.slice(0, 10).map(summary),
    });
  }
  return matches[0];
}

export function summary(node) {
  return {
    type: node.type,
    text: node.text,
    description: node.description,
    id: node.id,
    center: node.bounds?.center,
  };
}
