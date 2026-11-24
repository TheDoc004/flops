import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ReportProblem from './ReportProblem';

const submitProblemReport = vi.fn();

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ReportProblem submit={submitProblemReport} />
    </MemoryRouter>,
  );
}

// jsdom has no modal dialogs; open/close by attribute so the form is in the a11y tree.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

describe('ReportProblem', () => {
  beforeEach(() => submitProblemReport.mockReset());

  it('sends the typed text with the current path only', async () => {
    const user = userEvent.setup();
    submitProblemReport.mockResolvedValue({ id: 1 });
    renderAt('/history?date=2026-08-01');

    await user.click(screen.getByRole('button', { name: 'Report a problem' }));
    await user.type(screen.getByLabelText('What went wrong'), 'Chart is blank');
    await user.click(screen.getByRole('button', { name: 'Send report' }));

    await waitFor(() => expect(screen.getByText(/on the list/i)).toBeInTheDocument());
    expect(submitProblemReport).toHaveBeenCalledWith({ text: 'Chart is blank', route: '/history' });
  });

  it('will not send an empty report', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('button', { name: 'Report a problem' }));
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    expect(screen.getByText('Tell us what went wrong.')).toBeInTheDocument();
    expect(submitProblemReport).not.toHaveBeenCalled();
  });

  it('keeps the text and shows the error when sending fails', async () => {
    const user = userEvent.setup();
    const failing = () => Promise.reject(new Error('Too many requests. Slow down.'));
    render(
      <MemoryRouter initialEntries={['/']}>
        <ReportProblem submit={failing} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Report a problem' }));
    await user.type(screen.getByLabelText('What went wrong'), 'Oops');
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(screen.getByText('Too many requests. Slow down.')).toBeInTheDocument());
    expect(screen.getByLabelText('What went wrong')).toHaveValue('Oops');
  });
});
