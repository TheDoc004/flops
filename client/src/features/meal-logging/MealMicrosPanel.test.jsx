import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MealMicrosPanel from './MealMicrosPanel';

const entry = (micros, over = {}) => ({
  servings: 1,
  micros_json: JSON.stringify({ micros, confidence: 'high', notes: 'From product labels' }),
  ...over,
});

describe('MealMicrosPanel', () => {
  it('shows each nutrient as its share of the daily target', () => {
    // Vitamin A target is 900 mcg — 450 is half a day's worth.
    render(<MealMicrosPanel entry={entry({ vitamin_a_mcg: 450 })} />);
    expect(screen.getByText('Vitamin A')).toBeInTheDocument();
    expect(screen.getByText(/450 mcg · 50%/)).toBeInTheDocument();
    expect(screen.getByText(/how much of your daily targets/i)).toBeInTheDocument();
  });

  it('scales amounts by the logged servings', () => {
    render(<MealMicrosPanel entry={entry({ vitamin_a_mcg: 450 }, { servings: 2 })} />);
    expect(screen.getByText(/900 mcg · 100%/)).toBeInTheDocument();
  });

  it('labels watch nutrients against their limit, not a target', () => {
    // Sodium limit 2300 — 1150 is 50% of the LIMIT.
    render(<MealMicrosPanel entry={entry({ sodium_mg: 1150 })} />);
    expect(screen.getByText(/1150 mg · 50% of limit/)).toBeInTheDocument();
  });

  it('groups v2 nutrients under their categories', () => {
    render(<MealMicrosPanel entry={entry({ omega3_epa_mg: 360, selenium_mcg: 28 })} />);
    expect(screen.getByText('Omega-3s')).toBeInTheDocument();
    expect(screen.getByText('EPA')).toBeInTheDocument();
    expect(screen.getByText('Minerals')).toBeInTheDocument();
  });

  it('shows the provenance note from the blob', () => {
    render(<MealMicrosPanel entry={entry({ iron_mg: 4 })} />);
    expect(screen.getByText('From product labels')).toBeInTheDocument();
  });

  it('explains itself on meals without a micro estimate', () => {
    render(<MealMicrosPanel entry={{ servings: 1, micros_json: null }} />);
    expect(screen.getByText(/no micronutrient estimate/i)).toBeInTheDocument();
  });
});

describe('MealMicrosPanel — contribution threshold', () => {
  it('hides trace contributions and offers them behind a toggle', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(
      <MealMicrosPanel
        entry={entry({
          vitamin_a_mcg: 450, // 50% — shows
          iron_mg: 0.5, // ~6% of 8 mg — hidden, the user's own example
        })}
      />
    );
    expect(screen.getByText('Vitamin A')).toBeInTheDocument();
    expect(screen.queryByText('Iron')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show 1 more nutrient/i }));
    expect(screen.getByText('Iron')).toBeInTheDocument();
  });

  /* Beyond the absolute trace floor, the list is cut relative to the biggest
     contributor — so one dominant nutrient doesn't drag a long tail with it. */
  it('lists only what the meal is notable for, keeping the rest one click away', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(
      <MealMicrosPanel
        entry={entry({
          vitamin_a_mcg: 900, // 100% — the leader
          iron_mg: 1.2, // 15%: clears the trace floor, far below the leader
        })}
      />
    );
    expect(screen.getByText('Vitamin A')).toBeInTheDocument();
    expect(screen.queryByText('Iron')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show 1 more nutrient/i }));
    expect(screen.getByText('Iron')).toBeInTheDocument();
  });

  it('keeps a tight cluster of comparable nutrients together', () => {
    render(<MealMicrosPanel entry={entry({ iron_mg: 4, zinc_mg: 5.5, vitamin_c_mg: 45 })} />);
    expect(screen.getByText('Iron')).toBeInTheDocument();
    expect(screen.getByText('Zinc')).toBeInTheDocument();
    expect(screen.getByText('Vitamin C')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more nutrient/i })).not.toBeInTheDocument();
  });

  it('takes a caption override for non-meal contexts', () => {
    render(<MealMicrosPanel entry={entry({ iron_mg: 4 })} caption="For default amounts" />);
    expect(screen.getByText('For default amounts')).toBeInTheDocument();
  });

  it('keeps a 20% contribution visible', () => {
    render(<MealMicrosPanel entry={entry({ iron_mg: 1.6 })} />); // 20% of 8 mg
    expect(screen.getByText('Iron')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /smaller/i })).not.toBeInTheDocument();
  });

  it('explains itself when everything is a trace amount', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<MealMicrosPanel entry={entry({ iron_mg: 0.5, zinc_mg: 0.4 })} />);
    expect(screen.getByText(/nothing above 10% of a daily target/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /show 2 smaller/i }));
    expect(screen.getByText('Iron')).toBeInTheDocument();
    expect(screen.getByText('Zinc')).toBeInTheDocument();
  });
});
