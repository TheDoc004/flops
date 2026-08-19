import { useEffect, useRef } from 'react';
import AiMacroLogger from './AiMacroLogger';

/**
 * Dashboard popup wrapper for AI Estimate. Reuses the full logger UI inside a
 * native <dialog> (same pattern as LogMealModal) so the user can speak or
 * describe a meal, review, and log without leaving Today.
 *
 * @param {string} [initialDate] date the logger defaults to (usually today)
 * @param {() => void} [onLogged] called after a successful log — refresh the host
 * @param {() => void} onClose close the popup
 */
export default function AiLoggerModal({ initialDate, onLogged, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  function close() {
    ref.current?.close();
    onClose?.();
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      style={{ width: 'min(600px, 94vw)', maxHeight: '92vh', overflowY: 'auto' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>
          <span className="spark" aria-hidden="true">✨</span> AI Estimate
        </h2>
        <button type="button" className="modal-close-x" aria-label="Close" onClick={close}>✕</button>
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--color-text-muted)' }}>
        Speak or type what you ate — “I had three eggs, toast, yogurt” — or name a saved recipe to pull it up.
      </p>
      <AiMacroLogger inModal initialDate={initialDate} onLogged={onLogged} onClose={close} />
    </dialog>
  );
}
