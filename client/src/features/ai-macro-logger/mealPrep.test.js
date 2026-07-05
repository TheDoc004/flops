import { describe, it, expect } from 'vitest';
import { detectMealPrep, reconcileMealPrep } from './mealPrep';

describe('detectMealPrep — explicit counts (must always win)', () => {
  it.each([
    ['400g chicken and 400g rice, split into 4', 4],
    ['split it into 5 servings', 5],
    ['split this up into 6', 6],
    ['divided into four portions', 4],
    ['portioned into 3 containers', 3],
    ['I want to break it into 4 meals', 4],
    ['into 5 tupperwares', 5],
    ['makes 6 servings', 6],
    ['this should give me 4 lunches', 4],
    ['making 5 portions for the week', 5],
    ["I'm getting about 4 meals out of this", 4],
    ['yields 8 servings', 8],
  ])('"%s" → servings %i', (text, servings) => {
    expect(detectMealPrep(text)).toEqual({ isMealPrep: true, servings });
  });

  it('voice-transcript style rambling still parses', () => {
    const text =
      'okay so I used like 400 grams of chicken, um, 400 grams of jasmine rice, ' +
      'some BBQ sauce maybe 60 grams, and I wanna split all of that up into 4 servings for the week';
    expect(detectMealPrep(text)).toEqual({ isMealPrep: true, servings: 4 });
  });
});

describe('detectMealPrep — keyword without a count', () => {
  it.each([
    ['meal prep for the week: 800g chicken, 500g rice'],
    ['meal-prepped some chicken and rice'],
    ['batch cooking chili today'],
    ['prepping lunches: 1kg ground beef, 600g pasta'],
  ])('"%s" → prep, servings unknown', text => {
    expect(detectMealPrep(text)).toEqual({ isMealPrep: true, servings: null });
  });

  it('keyword + bare count is trusted', () => {
    expect(detectMealPrep('meal prep, 5 servings: 800g chicken, 500g rice'))
      .toEqual({ isMealPrep: true, servings: 5 });
  });
});

describe('detectMealPrep — must NOT fire (eating, not batching)', () => {
  it.each([
    ['I ate 2 servings of chili'],
    ['had two servings of lasagna for dinner'],
    ['1 serving of my overnight oats'],
    ['155g cooked turkey, 250g sweet potato, 20 calories BBQ sauce'],
    ['log one banana'],
    ['16oz of strawberries'],
  ])('"%s" → not meal prep', text => {
    expect(detectMealPrep(text)).toEqual({ isMealPrep: false, servings: null });
  });

  it('rejects absurd counts', () => {
    expect(detectMealPrep('split into 99 servings').servings).toBe(null);
  });
});

describe('reconcileMealPrep — layer precedence', () => {
  it('explicit count in the description overrides the model', () => {
    expect(reconcileMealPrep('split into 4 servings', { servings: 6 }))
      .toEqual({ isMealPrep: true, servings: 4 });
  });

  it('model fills the count when the description only has a keyword', () => {
    expect(reconcileMealPrep('meal prepping chicken and rice', { servings: 5 }))
      .toEqual({ isMealPrep: true, servings: 5 });
  });

  it('model alone can flag fuzzy prep phrasing regex misses', () => {
    expect(reconcileMealPrep('big pot of chili to last me most of the week', { servings: null }))
      .toEqual({ isMealPrep: true, servings: null });
  });

  it('keyword-only prep with no model count → servings unknown (UI asks)', () => {
    expect(reconcileMealPrep('batch cooked some rice and beef', null))
      .toEqual({ isMealPrep: true, servings: null });
  });

  it('normal meal, model silent → not meal prep', () => {
    expect(reconcileMealPrep('2 eggs and toast', null))
      .toEqual({ isMealPrep: false, servings: null });
  });

  it('garbage model values are ignored', () => {
    expect(reconcileMealPrep('2 eggs and toast', { servings: 1 }))
      .toEqual({ isMealPrep: true, servings: null }); // model said prep, count invalid
    expect(reconcileMealPrep('split into 4', { servings: 'lots' }))
      .toEqual({ isMealPrep: true, servings: 4 });
  });
});
