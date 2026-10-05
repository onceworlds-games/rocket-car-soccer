// A very small DOM, enough for the interface code to run in node: elements with classes, text, children, styles,
// listeners and the one inline SVG the boost ring uses. Install it with installDom() before importing UI code.

class TextNode {
  constructor(t) {
    this.nodeType = 3;
    this.data = t;
  }
  get textContent() {
    return this.data;
  }
}

export class El {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    this.parent = null;
    this.hidden = false;
    this._classes = new Set();
    this._text = '';
    this.offsetWidth = 120;
  }
  get className() {
    return [...this._classes].join(' ');
  }
  set className(v) {
    this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get classList() {
    const c = this._classes;
    return {
      add: (...n) => n.forEach((x) => c.add(x)),
      remove: (...n) => n.forEach((x) => c.delete(x)),
      toggle: (n, force) => {
        const on = force === undefined ? !c.has(n) : !!force;
        if (on) c.add(n);
        else c.delete(n);
        return on;
      },
      contains: (n) => c.has(n),
    };
  }
  get textContent() {
    return this._text + this.children.map((ch) => ch.textContent).join('');
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  get firstChild() {
    return this.children[0] || null;
  }
  append(...nodes) {
    for (const n of nodes) {
      if (typeof n === 'string') this.children.push(new TextNode(n));
      else {
        if (n.parent) n.remove();
        n.parent = this;
        this.children.push(n);
      }
    }
  }
  appendChild(n) {
    this.append(n);
    return n;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  dispatch(type, ev = {}) {
    for (const fn of this.listeners[type] || []) fn({ preventDefault() {}, stopPropagation() {}, ...ev });
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  set innerHTML(html) {
    this.children = [];
    // only the static svg of the boost ring: circles with a class
    for (const m of String(html).matchAll(/<circle class="(\w+)"/g)) {
      const c = new El('circle');
      c.className = m[1];
      c.parent = this;
      this.children.push(c);
    }
  }
  querySelector(sel) {
    const cls = sel.startsWith('.') ? sel.slice(1) : null;
    const walk = (e) => {
      for (const c of e.children) {
        if (c.nodeType !== 1) continue;
        if (cls && c._classes.has(cls)) return c;
        const r = walk(c);
        if (r) return r;
      }
      return null;
    };
    return walk(this);
  }
  find(pred, out = []) {
    for (const c of this.children) {
      if (c.nodeType !== 1) continue;
      if (pred(c)) out.push(c);
      c.find(pred, out);
    }
    return out;
  }
}

export function installDom() {
  const body = new El('body');
  globalThis.document = {
    body,
    createElement: (tag) => {
      if (tag === 'canvas') return { width: 0, height: 0, getContext: () => ctx2d(), style: {} };
      if (tag === 'img') {
        const img = new El('img');
        img.crossOrigin = '';
        return img;
      }
      return new El(tag);
    },
    getElementById: (id) => {
      const e = new El(id === 'gl' ? 'canvas' : 'div');
      e.getContext = () => ctx2d();
      return e;
    },
    fonts: { load: async () => [], ready: Promise.resolve() },
    addEventListener() {},
  };
  return body;
}

export function ctx2d() {
  return new Proxy(
    {},
    {
      get(t, p) {
        if (p === 'createRadialGradient' || p === 'createLinearGradient') return () => ({ addColorStop() {} });
        if (p in t) return t[p];
        return () => {};
      },
      set(t, p, v) {
        t[p] = v;
        return true;
      },
    },
  );
}
