import { useEffect, useRef, useState } from 'react';

// Preference order matters: Chrome/Android support webm/opus, iOS Safari only
// records mp4 (AAC). The server accepts either.
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

export function isVoiceRecordingSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
}

/**
 * Microphone recording as a hook: start() asks for mic permission and begins
 * recording; stop() resolves with the finished audio Blob. The mic stream is
 * released on stop and on unmount so the browser's recording indicator never
 * lingers.
 */
export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MIME_CANDIDATES.find(t => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    rec.ondataavailable = e => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.start();
    recorderRef.current = rec;
    setElapsed(0);
    setIsRecording(true);
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
  }

  /** @returns {Promise<Blob|null>} the recording, or null if nothing was captured */
  function stop() {
    return new Promise(resolve => {
      const rec = recorderRef.current;
      clearInterval(timerRef.current);
      setIsRecording(false);
      if (!rec || rec.state === 'inactive') return resolve(null);
      rec.onstop = () => {
        rec.stream.getTracks().forEach(t => t.stop());
        recorderRef.current = null;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        resolve(blob.size > 0 ? blob : null);
      };
      rec.stop();
    });
  }

  useEffect(() => () => {
    clearInterval(timerRef.current);
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.stop();
      rec.stream.getTracks().forEach(t => t.stop());
    }
  }, []);

  return { isRecording, elapsed, start, stop };
}
