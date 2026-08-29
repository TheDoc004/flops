/**
 * Prompt when leaving the dashboard layout editor with unsaved changes.
 */
export default function DashboardEditExitDialog({ busy, onSave, onDiscard, onCancel }) {
  return (
    <dialog open className="dash-edit-exit-dialog">
      <div className="dash-edit-exit-dialog__panel">
        <h2 className="dash-edit-exit-dialog__title">Leave layout editor?</h2>
        <p className="dash-edit-exit-dialog__body">
          You have unsaved changes to your Today dashboard. Save them before leaving, or discard to revert.
        </p>
        <div className="dash-edit-exit-dialog__actions">
          <button type="button" className="btn-primary" disabled={busy} onClick={onSave}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={onDiscard}>
            Discard
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>
            Keep editing
          </button>
        </div>
      </div>
    </dialog>
  );
}
