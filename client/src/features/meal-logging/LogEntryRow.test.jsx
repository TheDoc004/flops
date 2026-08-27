import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MacroUnitsProvider } from '@shared/context/MacroUnitsContext';
import LogEntryRow from './LogEntryRow';

const entry = {
  id: 5,
  recipe_name: 'Oat bowl',
  servings: 1,
  recipe_calories: 480, recipe_protein_g: 30, recipe_carbs_g: 60, recipe_fat_g: 12,
  ingredients_json: JSON.stringify([
    { name: 'Oats', amount: 90, unit: 'g', calories: 337.5, protein_g: 11.3, carbs_g: 60.8, fat_g: 6.8, label_ingredient_id: 1 },
  ]),
};

const renderRow = (props = {}) =>
  render(
    <MacroUnitsProvider>
      <LogEntryRow entry={entry} variant="dashboard" {...props} />
    </MacroUnitsProvider>
  );

const openMenu = async user => {
  await user.click(await screen.findByRole('button', { name: /Meal actions/i }));
};

describe('LogEntryRow — Save as Recipe', () => {
  it('offers Save as Recipe in the meal menu', async () => {
    const user = userEvent.setup();
    const onSaveAsRecipe = vi.fn();
    renderRow({ onSaveAsRecipe });
    await openMenu(user);

    const item = screen.getByRole('menuitem', { name: 'Save as Recipe' });
    await user.click(item);

    // The whole entry goes through, so the dialog can prefill the name and read
    // the ingredient rows.
    expect(onSaveAsRecipe).toHaveBeenCalledWith(entry);
  });

  it('leaves the item out when no handler is supplied', async () => {
    const user = userEvent.setup();
    renderRow({ onDelete: vi.fn() });
    await openMenu(user);
    expect(screen.queryByRole('menuitem', { name: 'Save as Recipe' })).not.toBeInTheDocument();
  });

  it('still shows the menu when Save as Recipe is the only action', async () => {
    const user = userEvent.setup();
    renderRow({ onMacros: undefined, onSaveAsRecipe: vi.fn() });
    await openMenu(user);
    expect(screen.getByRole('menuitem', { name: 'Save as Recipe' })).toBeInTheDocument();
  });
});

describe('LogEntryRow — Edit meal', () => {
  it('offers Edit meal in the meal menu', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    renderRow({ onEdit });
    await openMenu(user);

    await user.click(screen.getByRole('menuitem', { name: 'Edit meal' }));
    expect(onEdit).toHaveBeenCalledWith(entry);
  });

  it('leaves Edit meal out when no handler is supplied', async () => {
    const user = userEvent.setup();
    renderRow({ onDelete: vi.fn() });
    await openMenu(user);
    expect(screen.queryByRole('menuitem', { name: 'Edit meal' })).not.toBeInTheDocument();
  });
});
