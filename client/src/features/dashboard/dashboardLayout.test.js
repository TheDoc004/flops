import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DASH_LAYOUT,
  mergeDashLayout,
  layoutToRgl,
  rglToLayout,
  mobileStackOrder,
  applyProfileVisibility,
  profilePatchForLayout,
  setCardVisible,
  layoutForEditSession,
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

  it('merges { version, cards } shape from profile persistence', () => {
    const saved = {
      version: 1,
      cards: [{ id: 'weight', x: 2, y: 9, w: 8, h: 4, visible: true }],
    };
    const result = mergeDashLayout(saved);
    const weight = result.cards.find(c => c.id === 'weight');
    expect(weight.x).toBe(2);
    expect(weight.y).toBe(9);
    expect(weight.w).toBe(8);
    expect(weight.h).toBe(4);
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

  it('re-enables meals when profile flag is on even if layout saved hidden', () => {
    const saved = {
      version: 1,
      cards: DEFAULT_DASH_LAYOUT.map(c =>
        (c.id === 'meals' ? { ...c, visible: false } : c),
      ),
    };
    const result = mergeDashLayout(saved, { dash_meals_enabled: 1 });
    expect(result.cards.find(c => c.id === 'meals').visible).toBe(true);
  });
});

describe('layoutToRgl', () => {
  it('includes corner resize handles on items', () => {
    const layout = mergeDashLayout(null);
    const items = layoutToRgl(layout);
    expect(items.find(i => i.i === 'macros').resizeHandles).toEqual(['nw', 'ne', 'sw', 'se']);
    expect(items.find(i => i.i === 'macros').static).toBeUndefined();
  });

  it('omits hidden cards', () => {
    const layout = mergeDashLayout(null, { dash_weight_enabled: 0 });
    const items = layoutToRgl(layout);
    expect(items.some(i => i.i === 'weight')).toBe(false);
  });

  it('clamps inflated saved heights to edit max rows', () => {
    const saved = {
      version: 1,
      cards: DEFAULT_DASH_LAYOUT.map(c =>
        (c.id === 'macros' ? { ...c, h: 20, visible: true } : c),
      ),
    };
    const items = layoutToRgl(mergeDashLayout(saved));
    expect(items.find(i => i.i === 'macros').h).toBe(6);
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

describe('setCardVisible', () => {
  it('toggles a single card', () => {
    const base = mergeDashLayout(null);
    const next = setCardVisible(base, 'meals', false);
    expect(next.cards.find(c => c.id === 'meals').visible).toBe(false);
  });
});

describe('profilePatchForLayout', () => {
  it('maps layout visibility to profile flags', () => {
    const layout = setCardVisible(mergeDashLayout(null), 'weight', false);
    const patch = profilePatchForLayout(layout);
    expect(patch.dash_weight_enabled).toBe(0);
    expect(patch.dash_meals_enabled).toBe(1);
  });
});

describe('applyProfileVisibility', () => {
  it('forces visibility from profile flags', () => {
    const cards = DEFAULT_DASH_LAYOUT.map(c => ({ ...c, visible: false }));
    applyProfileVisibility(cards, { dash_supplements_enabled: 1, dash_meals_enabled: 0 });
    expect(cards.find(c => c.id === 'supplements').visible).toBe(true);
    expect(cards.find(c => c.id === 'meals').visible).toBe(false);
  });
});

describe('layoutForEditSession', () => {
  it('stacks visible cards full-width with compact row heights', () => {
    const base = mergeDashLayout(null);
    const edit = layoutForEditSession(base);
    const macros = edit.cards.find(c => c.id === 'macros');
    expect(macros.w).toBe(12);
    expect(macros.x).toBe(0);
    expect(macros.h).toBeLessThanOrEqual(6);
  });

  it('resets inflated saved heights to compact edit defaults', () => {
    const saved = {
      version: 1,
      cards: DEFAULT_DASH_LAYOUT.map(c =>
        (c.id === 'macros' ? { ...c, h: 20, w: 12, x: 0, y: 0 } : c),
      ),
    };
    const edit = layoutForEditSession(mergeDashLayout(saved));
    expect(edit.cards.find(c => c.id === 'macros').h).toBe(3);
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
