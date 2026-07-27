import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import LabelCropModal from './LabelCropModal';

/**
 * jsdom doesn't implement the dialog methods, so stub them while recording that
 * they were called — that IS the behaviour under test.
 */
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal() {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function close() {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  });
});

const IMG = 'data:image/jpeg;base64,QUJD';

describe('LabelCropModal', () => {
  it('renders nothing until it has both an open flag and an image', () => {
    const { container, rerender } = render(<LabelCropModal open={false} imageSrc={IMG} />);
    expect(container.querySelector('dialog')).toBeNull();
    rerender(<LabelCropModal open imageSrc={null} />);
    expect(container.querySelector('dialog')).toBeNull();
  });

  /**
   * The regression this guards: both callers are showModal() dialogs, which
   * render in the browser's top layer. A plain positioned div — at any z-index
   * — draws behind them, so the crop UI was invisible. Being a modal <dialog>
   * is what puts it in the same layer, above whatever opened it.
   */
  it('opens as a modal dialog so it can sit above the modal that opened it', () => {
    const { container } = render(<LabelCropModal open imageSrc={IMG} />);
    const dialog = container.querySelector('dialog');
    expect(dialog).not.toBeNull();
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
    expect(dialog.open).toBe(true);
  });

  it('shows the crop UI', () => {
    render(<LabelCropModal open imageSrc={IMG} />);
    expect(screen.getByText(/crop to nutrition facts/i)).toBeInTheDocument();
    expect(screen.getByAltText('Crop')).toHaveAttribute('src', IMG);
    // Nothing selected yet, so there's nothing to apply.
    expect(screen.getByRole('button', { name: /use cropped image/i })).toBeDisabled();
  });

  it('reports closing back to the caller', () => {
    const onClose = vi.fn();
    render(<LabelCropModal open imageSrc={IMG} onClose={onClose} />);
    screen.getByRole('button', { name: /close/i }).click();
    expect(onClose).toHaveBeenCalled();
  });
});
