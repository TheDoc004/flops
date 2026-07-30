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
