import '@testing-library/jest-dom';

// Node 26 + jsdom can leave localStorage undefined unless --localstorage-file is set.
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return store.has(String(key)) ? store.get(String(key)) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
    key(i) {
      return [...store.keys()][i] ?? null;
    },
    get length() {
      return store.size;
    },
  };
}

// jsdom ships no matchMedia, which any component behind useMediaQuery — or the
// meal row's menu placement — calls on render. Defaults to "does not match", so
// tests see the desktop layout unless a test overrides this itself.
if (typeof globalThis.matchMedia !== 'function') {
  globalThis.matchMedia = query => ({
    matches: false,
    media: String(query),
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
  });
}

// jsdom has HTMLDialogElement but no showModal()/close(). Minimal stand-ins so
// components that open a native modal dialog render it as open in tests.
if (typeof HTMLDialogElement !== 'undefined') {
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '');
    };
  }
  if (typeof HTMLDialogElement.prototype.close !== 'function') {
    HTMLDialogElement.prototype.close = function close() {
      if (!this.hasAttribute('open')) return;
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
}
