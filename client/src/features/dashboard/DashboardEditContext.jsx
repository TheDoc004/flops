import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import DashboardEditExitDialog from './DashboardEditExitDialog';

const DashboardEditContext = createContext(null);

export function useDashboardEdit() {
  return useContext(DashboardEditContext);
}

/**
 * Tracks dashboard layout-edit session: dirty state, exit prompts, nav lock.
 */
export function DashboardEditProvider({ children }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const editing = searchParams.get('editLayout') === '1';
  const savedSnapshotRef = useRef(null);
  const saveHandlerRef = useRef(null);
  const discardHandlerRef = useRef(null);
  const [dirty, setDirty] = useState(false);
  const [pendingExit, setPendingExit] = useState(null);
  const [exitBusy, setExitBusy] = useState(false);

  const beginSession = useCallback((layout) => {
    savedSnapshotRef.current = JSON.stringify(layout);
    setDirty(false);
  }, []);

  const markDirty = useCallback((layout) => {
    if (!savedSnapshotRef.current) return;
    setDirty(JSON.stringify(layout) !== savedSnapshotRef.current);
  }, []);

  const registerHandlers = useCallback((handlers) => {
    saveHandlerRef.current = handlers?.onSave ?? null;
    discardHandlerRef.current = handlers?.onDiscard ?? null;
  }, []);

  const finishExit = useCallback(() => {
    setSearchParams({});
    setDirty(false);
    savedSnapshotRef.current = null;
    setPendingExit(null);
    setExitBusy(false);
  }, [setSearchParams]);

  const requestExit = useCallback((payload = { type: 'close' }) => {
    if (!dirty) {
      finishExit();
      payload.onContinue?.();
      return;
    }
    setPendingExit(payload);
  }, [dirty, finishExit]);

  const cancelExit = useCallback(() => {
    setPendingExit(null);
  }, []);

  const confirmSave = useCallback(async () => {
    setExitBusy(true);
    try {
      await saveHandlerRef.current?.();
      const cont = pendingExit?.onContinue;
      finishExit();
      cont?.();
    } catch {
      setExitBusy(false);
    }
  }, [finishExit, pendingExit]);

  const confirmDiscard = useCallback(() => {
    discardHandlerRef.current?.();
    const cont = pendingExit?.onContinue;
    finishExit();
    cont?.();
  }, [finishExit, pendingExit]);

  useEffect(() => {
    if (editing) {
      document.documentElement.setAttribute('data-dash-layout-edit', '1');
    } else {
      document.documentElement.removeAttribute('data-dash-layout-edit');
      setPendingExit(null);
      setDirty(false);
      savedSnapshotRef.current = null;
    }
    return () => document.documentElement.removeAttribute('data-dash-layout-edit');
  }, [editing]);

  useEffect(() => {
    if (!editing) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        requestExit({ type: 'close' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, requestExit]);

  return (
    <DashboardEditContext.Provider value={{
      editing,
      dirty,
      beginSession,
      markDirty,
      registerHandlers,
      requestExit,
      finishExit,
    }}
    >
      {children}
      {pendingExit && (
        <DashboardEditExitDialog
          busy={exitBusy}
          onSave={() => { void confirmSave(); }}
          onDiscard={confirmDiscard}
          onCancel={cancelExit}
        />
      )}
    </DashboardEditContext.Provider>
  );
}
