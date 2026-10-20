import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DeleteAccount from './DeleteAccount';

const api = { request: vi.fn(), confirm: vi.fn() };

// jsdom has no modal dialogs; open/close by attribute so the form is in the a11y tree.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

function renderRow(props = {}) {
  return render(<DeleteAccount email="demo@flops.example" api={api} {...props} />);
}

describe('DeleteAccount', () => {
  beforeEach(() => {
    api.request.mockReset();
    api.confirm.mockReset();
  });

  it('explains first and offers the download before any code is sent', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    renderRow({ onDownload });

    await user.click(screen.getByRole('button', { name: 'Delete…' }));
    expect(screen.getByRole('dialog', { name: 'Delete my account' })).toBeInTheDocument();
    expect(api.request).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Download your data first' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(api.request).not.toHaveBeenCalled();
  });

  it('deletes only after the emailed code is entered', async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    api.request.mockResolvedValue({ ok: true, method: 'email' });
    api.confirm.mockResolvedValue({ ok: true });
    renderRow({ onDeleted });

    await user.click(screen.getByRole('button', { name: 'Delete…' }));
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    await screen.findByText(/sent a 6-digit code to demo@flops\.example/);

    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(api.confirm).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter the 6-digit code/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(api.confirm).toHaveBeenCalledWith({ code: '123456' });
  });

  it('keeps the account and shows the error when the code is refused', async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    api.request.mockResolvedValue({ ok: true, method: 'email' });
    api.confirm.mockRejectedValue(new Error('That code is wrong or has expired. Ask for a new one.'));
    renderRow({ onDeleted });

    await user.click(screen.getByRole('button', { name: 'Delete…' }));
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    await user.type(await screen.findByLabelText('Code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));

    await screen.findByText(/wrong or has expired/);
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
