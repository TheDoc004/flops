import { useEffect, useRef } from 'react';
import AiMacroLogger from './AiMacroLogger';

/**
 * Dashboard popup wrapper for the AI Macro Logger. Reuses the full logger UI
 * inside a native <dialog> (same pattern as LogMealModal) so the user can
 * describe, review, revise, and log a meal without ever leaving the dashboard.
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
          <span className="spark" aria-hidden="true">✨</span> AI Macro Logger
        </h2>
        <button type="button" className="modal-close-x" aria-label="Close" onClick={close}>✕</button>
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--color-text-muted)' }}>
        Describe a meal and talk through the estimate, then log it once — or say “log my <em>recipe</em>” to pull up and tweak a saved one.
      </p>
      <AiMacroLogger inModal initialDate={initialDate} onLogged={onLogged} onClose={close} />
    </dialog>
  );
}
