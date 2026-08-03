/**
 * Browsers let the mouse wheel / trackpad scroll change the value of a focused
 * `<input type="number">`. In practice that only ever fires by accident: you
 * flick to scroll a list of ingredients, the pointer happens to sit over an
 * amount field, and the amount silently changes instead.
 *
 * Blurring the field on wheel kills the behaviour everywhere at once — the
 * value is left alone and the page/list scrolls as normal. Typed input is
 * untouched (blur commits it, same as clicking away).
 */
export function installNumberInputWheelGuard(target = document) {
  const onWheel = event => {
    const el = target.activeElement;
    if (!el || el.tagName !== 'INPUT' || el.type !== 'number') return;
    // Only when the wheel is actually over the focused field — scrolling
    // elsewhere on the page should never steal focus.
    if (el !== event.target && !el.contains(event.target)) return;
    el.blur();
  };
  // Capture + passive: we never cancel the scroll, only drop focus before the
  // browser can apply it to the input.
  target.addEventListener('wheel', onWheel, { capture: true, passive: true });
  return () => target.removeEventListener('wheel', onWheel, { capture: true });
}
