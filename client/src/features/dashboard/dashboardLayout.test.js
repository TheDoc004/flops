import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DASH_LAYOUT,
  mergeDashLayout,
  layoutToRgl,
  rglToLayout,
  mobileStackOrder,
} from './dashboardLayout';

describe('mergeDashLayout', () => {
  it('seeds defaults when saved is null', () => {
    const result = mergeDashLayout(null);
    expect(result.cards).toHaveLength(DEFAULT_DASH_LAYOUT.length);
    expect(result.cards[0].id).toBe('macros');
    expect(result.cards.find(c => c.id === 'weight_chart').visible).toBe(false);
  });

  it('merges saved positions and keeps new card defaults', () => {
    const saved = [{ id: 'macros', x: 0, y: 0, w: 12, h: 5, visible: true }];
    const result = mergeDashLayout(saved);
    expect(result.cards.find(c => c.id === 'macros').h).toBe(5);
    expect(result.cards.find(c => c.id === 'meals')).toBeTruthy();
  });

  it('respects profile show/hide flags', () => {
    const result = mergeDashLayout(null, { dash_weight_enabled: 0, dash_meals_enabled: 0 });
    expect(result.cards.find(c => c.id === 'weight').visible).toBe(false);
    expect(result.cards.find(c => c.id === 'meals').visible).toBe(false);
  });

  it('enables weight chart from profile flag', () => {
    const result = mergeDashLayout(null, { dash_weight_chart_card_enabled: 1 });
    expect(result.cards.find(c => c.id === 'weight_chart').visible).toBe(true);
  });
});

describe('layoutToRgl', () => {
  it('pins macros as static', () => {
    const layout = mergeDashLayout(null);
    const items = layoutToRgl(layout);
    expect(items.find(i => i.i === 'macros').static).toBe(true);
  });

  it('omits hidden cards', () => {
    const layout = mergeDashLayout(null, { dash_weight_enabled: 0 });
    const items = layoutToRgl(layout);
    expect(items.some(i => i.i === 'weight')).toBe(false);
  });
});

describe('rglToLayout', () => {
  it('updates positions while preserving card list', () => {
    const prev = mergeDashLayout(null);
    const next = rglToLayout(prev, [{ i: 'macros', x: 0, y: 2, w: 12, h: 4 }]);
    expect(next.cards.find(c => c.id === 'macros').y).toBe(2);
    expect(next.cards).toHaveLength(DEFAULT_DASH_LAYOUT.length);
  });
});

describe('mobileStackOrder', () => {
  it('orders visible cards by y then x', () => {
    const layout = mergeDashLayout(null);
    const order = mobileStackOrder(layout);
    expect(order[0]).toBe('macros');
    expect(order).not.toContain('weight_chart');
  });
});
