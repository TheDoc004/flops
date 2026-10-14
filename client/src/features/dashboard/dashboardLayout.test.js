import { describe, it, expect } from 'vitest';
import { dashboardCards, visibleCardIds } from './dashboardLayout';

describe('dashboardCards', () => {
  it('puts supplements first, above macros', () => {
    expect(visibleCardIds(dashboardCards())).toEqual(['supplements', 'macros', 'weight', 'meals']);
  });

  it('hides the weight trend card by default', () => {
    expect(dashboardCards().find(c => c.id === 'weight_chart').visible).toBe(false);
  });

  it('respects profile show/hide flags', () => {
    const ids = visibleCardIds(dashboardCards({ dash_weight_enabled: 0, dash_meals_enabled: 0 }));
    expect(ids).toEqual(['supplements', 'macros']);
  });

  it('keeps supplements first when the weight trend card is on', () => {
    const ids = visibleCardIds(dashboardCards({ dash_weight_chart_card_enabled: 1 }));
    expect(ids).toEqual(['supplements', 'macros', 'weight', 'weight_chart', 'meals']);
  });

  it('honors the legacy dash_weight_chart_enabled alias', () => {
    expect(dashboardCards({ dash_weight_chart_enabled: 1 }).find(c => c.id === 'weight_chart').visible).toBe(true);
  });

  it('never hides macros', () => {
    expect(visibleCardIds(dashboardCards({ dash_supplements_enabled: 0 }))[0]).toBe('macros');
  });

  it('ignores a saved dash_layout_json order', () => {
    const profile = {
      dash_layout_json: JSON.stringify({
        version: 1,
        cards: [{ id: 'meals', x: 0, y: 0, w: 12, h: 8 }, { id: 'supplements', x: 0, y: 20, w: 12, h: 3 }],
      }),
    };
    expect(visibleCardIds(dashboardCards(profile))[0]).toBe('supplements');
  });
});
