import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DashboardWeightRow from './DashboardWeightRow';

const { fetchBodyWeights, saveBodyWeight } = vi.hoisted(() => ({
  fetchBodyWeights: vi.fn(),
  saveBodyWeight: vi.fn(),
}));

vi.mock('@shared/api/profile', () => ({ fetchBodyWeights, saveBodyWeight }));

const TODAY = '2026-08-01';

function renderRow(props = {}) {
  return render(
    <MemoryRouter>
      <DashboardWeightRow today={TODAY} bodyUnits="us" {...props} />
    </MemoryRouter>
  );
}

describe('DashboardWeightRow', () => {
  beforeEach(() => {
    fetchBodyWeights.mockReset();
    saveBodyWeight.mockReset();
  });

  it('offers to save, then settles into a confirmation once logged', async () => {
    const user = userEvent.setup();
    fetchBodyWeights.mockResolvedValue([{ date: '2026-07-29', weight_kg: 74.8 }]);
    saveBodyWeight.mockResolvedValue({ date: TODAY, weight_kg: 74.98 });
    renderRow();

    // Previous weigh-in is shown as a sanity check against what you type.
    expect(await screen.findByText(/Last weigh-in 164.9 lb on Jul 29/)).toBeInTheDocument();
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Save weight');

    fireEvent.change(screen.getByLabelText(/Today's weight in lb/), { target: { value: '165.3' } });
    await user.click(button);

    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Weight saved'));
    expect(screen.getByRole('button')).toBeDisabled();
    expect(saveBodyWeight).toHaveBeenCalledWith(TODAY, expect.closeTo(74.98, 2));
  });

  it('opens already settled when today is logged, with the change since last time', async () => {
    fetchBodyWeights.mockResolvedValue([
      { date: '2026-07-29', weight_kg: 74.8 },
      { date: TODAY, weight_kg: 75.0 },
    ]);
    renderRow();

    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Weight saved'));
    expect(screen.getByText(/Logged for today · \+0.4 lb since Jul 29/)).toBeInTheDocument();
  });

  it('turns back into an update once a different weight is entered', async () => {
    fetchBodyWeights.mockResolvedValue([{ date: TODAY, weight_kg: 75.0 }]);
    saveBodyWeight.mockResolvedValue({ date: TODAY, weight_kg: 74.5 });
    renderRow();

    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Weight saved'));

    // Set the field in one shot: typing "165.35" into a number input goes
    // through the invalid intermediate "165.", which jsdom reports as empty.
    const field = screen.getByLabelText(/Today's weight in lb/);
    fireEvent.change(field, { target: { value: '164.2' } });

    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Update weight');
    expect(button).toBeEnabled();

    // Putting the original value back is not a change — no action to offer.
    fireEvent.change(field, { target: { value: '165.35' } });
    expect(screen.getByRole('button')).toHaveTextContent('Weight saved');
  });

  it('sends Full history to the weight trend in Review', async () => {
    fetchBodyWeights.mockResolvedValue([]);
    renderRow();
    const link = await screen.findByRole('link', { name: /Full history/ });
    expect(link).toHaveAttribute('href', '/history#weight-trend');
  });

  it('rejects an unparseable weight without calling the API', async () => {
    const user = userEvent.setup();
    fetchBodyWeights.mockResolvedValue([]);
    renderRow();

    await screen.findByRole('button', { name: /Save weight/ });
    await user.click(screen.getByRole('button'));

    expect(await screen.findByText(/Enter a valid weight in pounds/)).toBeInTheDocument();
    expect(saveBodyWeight).not.toHaveBeenCalled();
  });
});
