import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ViewToggle from './ViewToggle';

/* Shared by the logged-meal row and the recipe row, so its open/close contract
   has to hold for both — a regression here would break two pages at once. */
describe('ViewToggle', () => {
  const setup = (props = {}) => {
    const setView = vi.fn();
    render(<ViewToggle view={null} setView={setView} hasMicros {...props} />);
    return { setView };
  };

  it('opens the panel the button names', async () => {
    const user = userEvent.setup();
    const { setView } = setup();
    await user.click(screen.getByRole('button', { name: /macros/i }));
    expect(setView).toHaveBeenCalledWith('macros');
  });

  it('collapses when the already-open side is clicked again', async () => {
    const user = userEvent.setup();
    const { setView } = setup({ view: 'micros' });
    await user.click(screen.getByRole('button', { name: /micros/i }));
    expect(setView).toHaveBeenCalledWith(null);
  });

  it('marks the open side as expanded for assistive tech', () => {
    setup({ view: 'macros' });
    expect(screen.getByRole('button', { name: /macros/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /micros/i })).toHaveAttribute('aria-expanded', 'false');
  });

  /* The chevron flips to signal expansion — the fill alone read as "selected". */
  it('flips the caret on the open side only', () => {
    const { container } = render(<ViewToggle view="macros" setView={() => {}} hasMicros />);
    const [macrosCaret, microsCaret] = container.querySelectorAll('button > span');
    expect(macrosCaret.style.transform).toBe('rotate(180deg)');
    expect(microsCaret.style.transform).toBe('none');
  });

  it('refuses to open micros when there is no estimate', async () => {
    const user = userEvent.setup();
    const { setView } = setup({ hasMicros: false });
    const micros = screen.getByRole('button', { name: /micros/i });
    expect(micros).toBeDisabled();
    await user.click(micros);
    expect(setView).not.toHaveBeenCalled();
  });
});
