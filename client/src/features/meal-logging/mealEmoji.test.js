import { describe, it, expect } from 'vitest';
import { mealEmoji } from './mealEmoji';

describe('mealEmoji', () => {
  it('matches a dish name in the title', () => {
    expect(mealEmoji('Chicken burrito bowl')).toBe('🌯');
    expect(mealEmoji('Protein Pancakes')).toBe('🥞');
  });

  it('title beats ingredients', () => {
    expect(mealEmoji('Greek salad', ['chicken breast'])).toBe('🥗');
  });

  it('generic meal words catch titles with no dish signal', () => {
    expect(mealEmoji('4th of July Breakfast')).toBe('🍳');
  });

  it('falls back to ingredients when the title says nothing', () => {
    expect(mealEmoji('Post-workout special', ['salmon fillet', 'rice'])).toBe('🐟');
  });

  it('falls back to a plate when nothing matches', () => {
    expect(mealEmoji('Mystery meal', ['unknown thing'])).toBe('🍽️');
    expect(mealEmoji('')).toBe('🍽️');
  });
});
