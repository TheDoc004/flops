import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BarcodeScannerModal from './BarcodeScannerModal';

/**
 * jsdom has no camera, so these exercise the typed-barcode path — which is
 * exactly what a browser with no camera permission falls back to.
 */
describe('BarcodeScannerModal (no camera available)', () => {
  it('offers manual entry and reports the product back', async () => {
    const user = userEvent.setup();
    const product = { found: true, barcode: '3017620422003', name: 'Nutella' };
    const lookup = vi.fn(async () => product);
    const onProduct = vi.fn();
    const onClose = vi.fn();

    render(<BarcodeScannerModal lookup={lookup} onProduct={onProduct} onClose={onClose} />);

    await user.type(screen.getByLabelText('Barcode number'), '3017620422003');
    await user.click(screen.getByRole('button', { name: /look up/i }));

    await waitFor(() => expect(onProduct).toHaveBeenCalledWith(product));
    expect(lookup).toHaveBeenCalledWith('3017620422003');
    expect(onClose).toHaveBeenCalled();
  });

  it('will not look up a number that fails its check digit', async () => {
    const user = userEvent.setup();
    const lookup = vi.fn();
    render(<BarcodeScannerModal lookup={lookup} onProduct={vi.fn()} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Barcode number'), '3017620422004');
    expect(screen.getByRole('button', { name: /look up/i })).toBeDisabled();
    expect(screen.getByText(/missing or mistyped digit/i)).toBeInTheDocument();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('stays open with a plain explanation when the product is unknown', async () => {
    const user = userEvent.setup();
    const lookup = vi.fn(async () => {
      const err = new Error('That product is not in Open Food Facts yet.');
      err.notFound = true;
      throw err;
    });
    const onProduct = vi.fn();
    const onClose = vi.fn();

    render(<BarcodeScannerModal lookup={lookup} onProduct={onProduct} onClose={onClose} />);
    await user.type(screen.getByLabelText('Barcode number'), '3017620422003');
    await user.click(screen.getByRole('button', { name: /look up/i }));

    expect(await screen.findByText(/isn't in Open Food Facts yet/i)).toBeInTheDocument();
    expect(onProduct).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('allows a retry after a failed lookup', async () => {
    const user = userEvent.setup();
    const lookup = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('nope'), { notFound: true }))
      .mockResolvedValueOnce({ found: true, name: 'Pringles' });
    const onProduct = vi.fn();

    render(<BarcodeScannerModal lookup={lookup} onProduct={onProduct} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Barcode number');

    await user.type(input, '3017620422003');
    await user.click(screen.getByRole('button', { name: /look up/i }));
    await screen.findByText(/isn't in Open Food Facts yet/i);

    await user.clear(input);
    await user.type(input, '038000138416');
    await user.click(screen.getByRole('button', { name: /look up/i }));

    await waitFor(() => expect(onProduct).toHaveBeenCalledWith({ found: true, name: 'Pringles' }));
  });
});
