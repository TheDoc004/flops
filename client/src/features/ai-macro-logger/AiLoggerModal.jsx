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
    <dialog ref={ref} onClose={onClose} className="ai-logger-modal">
      <div className="ai-logger-modal__header">
        <h2 className="section-title ai-logger-modal__title">
          AI Estimate
        </h2>
        <button type="button" className="modal-close-x" aria-label="Close" onClick={close}>✕</button>
      </div>
      <p className="ai-logger-modal__intro">
        Had a meal you didn&apos;t weigh? Describe what you ate — or name a saved recipe to pull it up.
      </p>
      <AiMacroLogger inModal initialDate={initialDate} onLogged={onLogged} onClose={close} />
    </dialog>
  );
}
