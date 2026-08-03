import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import DayAdherencePopover from './DayAdherencePopover';

// jsdom gives every element a zero rect; the popover only uses it for placement.
const rect = { top: 400, bottom: 452, left: 300, width: 60 };

const targets = {
  calories: { min: 2200, max: 2600 },
  protein_g: { min: 180, max: 200 },
  carbs_g: { min: 200, max: 300 },
  fat_g: { min: 50, max: 80 },
};

/** A row shaped like buildWeeklyAdherenceRows output. */
const row = (totals, over = {}) => ({
  date: '2026-08-01',
  weekday: 6,
  totals,
  targets,
  hasData: true,
  status: 'partial',
  missed: [],
  ...over,
});

beforeAll(() => {
  // Positioning clamps against the viewport width.
  window.innerWidth = 1200;
});

describe('DayAdherencePopover', () => {
  it('shows each macro with what was eaten and the goal beside it', () => {
    render(
      <DayAdherencePopover
        row={row({ calories: 2000, protein_g: 190, carbs_g: 250, fat_g: 60 })}
        rect={rect}
        macroUnits="metric"
      />
    );

    for (const label of ['Calories', 'Protein', 'Carbs', 'Fat']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('2000 kcal')).toBeInTheDocument();
    expect(screen.getByText(/goal 2200–2600 kcal/)).toBeInTheDocument();
    expect(screen.getByText('2026-08-01', { exact: false })).toBeInTheDocument();
  });

  it('marks an in-range macro green and an out-of-range one muted', () => {
    // Calories under the floor; protein inside the band.
    render(
      <DayAdherencePopover
        row={row({ calories: 2000, protein_g: 190, carbs_g: 250, fat_g: 60 })}
        rect={rect}
        macroUnits="metric"
      />
    );

    const missed = screen.getByText('2000 kcal');
    expect(missed).toHaveStyle({ color: 'var(--color-text-muted)' });
    expect(screen.getByText(/Under by 200 kcal/)).toBeInTheDocument();

    // Protein is the only one sitting inside its range here.
    const inRange = screen.getAllByText('In range');
    expect(inRange.length).toBeGreaterThan(0);
    expect(inRange[0]).toHaveStyle({ color: 'var(--status-hit-text)' });
  });

  it('reports going over a ceiling with the direction', () => {
    render(
      <DayAdherencePopover
        row={row({ calories: 3000, protein_g: 190, carbs_g: 250, fat_g: 60 })}
        rect={rect}
        macroUnits="metric"
      />
    );
    expect(screen.getByText(/Over by 400 kcal/)).toBeInTheDocument();
  });

  it('says so plainly when nothing was logged', () => {
    render(
      <DayAdherencePopover
        row={row({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, { status: 'no_data', hasData: false })}
        rect={rect}
        macroUnits="metric"
      />
    );
    expect(screen.getByText('No meals logged.')).toBeInTheDocument();
    expect(screen.queryByText(/goal /)).not.toBeInTheDocument();
  });

  it('distinguishes an upcoming day from an unlogged past one', () => {
    render(
      <DayAdherencePopover
        row={row({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, { status: 'upcoming', hasData: false })}
        rect={rect}
        macroUnits="metric"
      />
    );
    expect(screen.getByText(/Upcoming/)).toBeInTheDocument();
  });

  it('renders nothing without a row or a rect', () => {
    const { container: a } = render(<DayAdherencePopover row={null} rect={rect} macroUnits="metric" />);
    expect(a).toBeEmptyDOMElement();
    const { container: b } = render(<DayAdherencePopover row={row({ calories: 1 })} rect={null} macroUnits="metric" />);
    expect(b).toBeEmptyDOMElement();
  });
});
