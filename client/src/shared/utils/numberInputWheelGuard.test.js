import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installNumberInputWheelGuard } from './numberInputWheelGuard';

describe('installNumberInputWheelGuard', () => {
  let uninstall;

  beforeEach(() => {
    document.body.innerHTML = '';
    uninstall = installNumberInputWheelGuard();
  });

  afterEach(() => {
    uninstall();
    document.body.innerHTML = '';
  });

  function addInput(type) {
    const el = document.createElement('input');
    el.type = type;
    document.body.appendChild(el);
    return el;
  }

  function wheelOver(el) {
    el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
  }

  it('blurs a focused number input so the wheel cannot change its value', () => {
    const el = addInput('number');
    el.focus();
    expect(document.activeElement).toBe(el);
    wheelOver(el);
    expect(document.activeElement).not.toBe(el);
  });

  it('leaves other focused fields alone', () => {
    const el = addInput('text');
    el.focus();
    wheelOver(el);
    expect(document.activeElement).toBe(el);
  });

  it('does not steal focus when the wheel is elsewhere on the page', () => {
    const el = addInput('number');
    const other = document.createElement('div');
    document.body.appendChild(other);
    el.focus();
    wheelOver(other);
    expect(document.activeElement).toBe(el);
  });

  it('stops guarding after uninstall', () => {
    const el = addInput('number');
    el.focus();
    uninstall();
    wheelOver(el);
    expect(document.activeElement).toBe(el);
  });
});
