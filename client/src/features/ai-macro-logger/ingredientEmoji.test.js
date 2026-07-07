import { describe, it, expect } from 'vitest';
import { ingredientEmoji } from './ingredientEmoji';

describe('ingredientEmoji', () => {
  it('matches common produce', () => {
    expect(ingredientEmoji('red onion')).toBe('🧅');
    expect(ingredientEmoji('Roma tomato')).toBe('🍅');
    expect(ingredientEmoji('garlic clove')).toBe('🧄');
  });

  it('matches proteins', () => {
    expect(ingredientEmoji('grilled chicken breast')).toBe('🍗');
    expect(ingredientEmoji('ribeye steak')).toBe('🥩');
    expect(ingredientEmoji('salmon fillet')).toBe('🐟');
  });

  it('prefers the more specific compound match', () => {
    expect(ingredientEmoji('sweet potato')).toBe('🍠');
    expect(ingredientEmoji('russet potato')).toBe('🥔');
  });

  it('is case-insensitive and tolerant of extra words', () => {
    expect(ingredientEmoji('2 tbsp OLIVE OIL')).toBe('🫒');
    expect(ingredientEmoji('a handful of blueberries')).toBe('🫐');
  });

  it('falls back to a utensil when nothing matches', () => {
    expect(ingredientEmoji('mystery ingredient')).toBe('🍴');
    expect(ingredientEmoji('')).toBe('🍴');
  });
});
