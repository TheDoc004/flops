import { useEffect, useRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import BarcodeScannerModal from './BarcodeScannerModal';

/**
 * Library → + Add ingredient is a native <dialog> opened with showModal(), so
 * it sits in the browser's top layer. A z-index div can never draw above it;
 * the scanner has to be a modal <dialog> too, or nobody can see or tap it.
 */
function AddIngredientForm({ children }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog ref={ref} aria-label="Add a new ingredient">
      {children}
    </dialog>
  );
}

describe('BarcodeScannerModal inside the Add ingredient dialog', () => {
  let original;
  let showModal;

  beforeEach(() => {
    original = HTMLDialogElement.prototype.showModal;
    showModal = vi.fn(function showModal() {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.showModal = showModal;
  });

  afterEach(() => {
    HTMLDialogElement.prototype.showModal = original;
  });

  it('opens as its own modal dialog, above the form', () => {
    render(
      <AddIngredientForm>
        <BarcodeScannerModal lookup={vi.fn()} onProduct={vi.fn()} onClose={vi.fn()} />
      </AddIngredientForm>,
    );

    const scanner = screen.getByLabelText('Barcode number').closest('[aria-labelledby="barcode-scan-title"]');
    expect(scanner).not.toBeNull();
    expect(scanner.tagName).toBe('DIALOG');
    const openedDialogs = showModal.mock.contexts;
    expect(openedDialogs).toContain(scanner);
    expect(scanner.open).toBe(true);
  });
});
