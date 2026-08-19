import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useAnimatedNumber from './useAnimatedNumber';

function stubMotion(reduce) {
  vi.stubGlobal('matchMedia', (query) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('useAnimatedNumber', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('snaps immediately when reduced motion is preferred', () => {
    stubMotion(true);
    const { result, rerender } = renderHook(({ v }) => useAnimatedNumber(v), {
      initialProps: { v: 10 },
    });
    rerender({ v: 50 });
    expect(result.current).toBe(50);
  });

  it('snaps immediately when the jump is tiny', () => {
    stubMotion(false);
    const { result, rerender } = renderHook(({ v }) => useAnimatedNumber(v), {
      initialProps: { v: 10 },
    });
    rerender({ v: 10.02 });
    expect(result.current).toBe(10.02);
  });
});
