import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import RecipeCombobox from './RecipeCombobox';

const RECIPES = [
  { id: 1, name: 'Banana protein oats', serving_size: '1 bowl' },
  { id: 2, name: 'Chicken and rice', serving_size: '1 plate' },
];

const INGREDIENTS = [
  { id: 10, name: 'Banana', serving_size_text: '1 medium (118g)', grams_per_serving: 118, calories: 105 },
  { id: 11, name: 'Almonds', serving_size_text: '1 oz (28g)', grams_per_serving: 28, calories: 164 },
  { id: 12, name: 'Egg', tracking_type: 'unit', unit_name: 'egg', serving_quantity: 1, calories: 72 },
];

function open(ui) {
  render(ui);
  fireEvent.click(screen.getByRole('searchbox'));
}

describe('RecipeCombobox', () => {
  it('lists recipes only when no ingredients are passed, with no group headers', () => {
    open(<RecipeCombobox recipes={RECIPES} value="" onChange={() => {}} />);
    expect(screen.getByText('Banana protein oats')).toBeInTheDocument();
    // Headers would be noise when there is only one kind of thing in the list.
    expect(screen.queryByText('Recipes')).not.toBeInTheDocument();
    expect(screen.queryByText('Ingredients')).not.toBeInTheDocument();
  });

  it('groups both kinds under headers when ingredients are passed', () => {
    open(<RecipeCombobox recipes={RECIPES} ingredients={INGREDIENTS} value="" onChange={() => {}} />);
    expect(screen.getByText('Recipes')).toBeInTheDocument();
    expect(screen.getByText('Ingredients')).toBeInTheDocument();
    expect(screen.getByText('Banana protein oats')).toBeInTheDocument();
    expect(screen.getByText('Almonds')).toBeInTheDocument();
  });

  it('reports which list the choice came from', () => {
    const onChange = vi.fn();
    open(<RecipeCombobox recipes={RECIPES} ingredients={INGREDIENTS} value="" onChange={onChange} />);

    fireEvent.click(screen.getByText('Almonds'));
    expect(onChange).toHaveBeenCalledWith('11', 'ingredient');

    fireEvent.click(screen.getByRole('searchbox'));
    fireEvent.click(screen.getByText('Chicken and rice'));
    expect(onChange).toHaveBeenLastCalledWith('2', 'recipe');
  });

  it('searches across both groups at once', () => {
    open(<RecipeCombobox recipes={RECIPES} ingredients={INGREDIENTS} value="" onChange={() => {}} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'banana' } });

    expect(screen.getByText('Banana protein oats')).toBeInTheDocument();
    expect(screen.getByText('Banana')).toBeInTheDocument();
    expect(screen.queryByText('Almonds')).not.toBeInTheDocument();
  });

  it('describes a unit-tracked ingredient by its own unit, not grams', () => {
    open(<RecipeCombobox recipes={[]} ingredients={INGREDIENTS} value="" onChange={() => {}} />);
    expect(screen.getByText('per 1 egg · 72 cal')).toBeInTheDocument();
  });

  it('marks the selection using the kind it belongs to, not the id alone', () => {
    // Recipe id 1 and ingredient id 1 could collide; valueKind disambiguates.
    const recipes = [{ id: 10, name: 'Collides with the banana', serving_size: '1' }];
    open(
      <RecipeCombobox
        recipes={recipes}
        ingredients={INGREDIENTS}
        value="10"
        valueKind="ingredient"
        onChange={() => {}}
      />
    );
    const selected = screen.getByText('Selected').closest('[role="option"]');
    expect(selected).toHaveTextContent('Banana');
  });
});
