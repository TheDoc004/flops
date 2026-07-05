import { useState } from 'react';
import { transcribeAudio } from '@shared/api/ai';
import { useVoiceRecorder, isVoiceRecordingSupported } from './useVoiceRecorder';

const fmtElapsed = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Mic button for the AI logger: tap to record, tap again to stop. The finished
 * recording is transcribed server-side and handed to onTranscript as text.
 * Three states: idle -> recording (pulsing dot + timer) -> transcribing.
 */
export default function VoiceInput({ onTranscript }) {
  const { isRecording, elapsed, start, stop } = useVoiceRecorder();
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState('');

  async function handleClick() {
    setError('');
    if (!isRecording) {
      if (!isVoiceRecordingSupported()) {
        setError('Voice input needs a browser with microphone support (and HTTPS on phones).');
        return;
      }
      try {
        await start();
      } catch {
        setError('Microphone access was blocked. Allow it in your browser settings and try again.');
      }
      return;
    }
    const blob = await stop();
    if (!blob) return;
    setTranscribing(true);
    try {
      const text = await transcribeAudio(blob);
      if (text) onTranscript(text);
      else setError("Didn't catch any speech — try again a little closer to the mic.");
    } catch (e) {
      setError(e.message || 'Failed to transcribe audio.');
    } finally {
      setTranscribing(false);
    }
  }

  return (
    <div style={{ display: 'inline-block' }}>
      <button
        type="button"
        className={
          transcribing ? 'btn-secondary btn-loading'
            : isRecording ? 'btn-secondary is-recording'
              : 'btn-secondary'
        }
        onClick={handleClick}
        disabled={transcribing}
        aria-label={isRecording ? 'Stop recording' : 'Describe your meal by voice'}
      >
        {transcribing
          ? (<><span className="btn-spinner" aria-hidden="true" />Transcribing…</>)
          : isRecording
            ? (<><span className="voice-dot" aria-hidden="true" />Stop · {fmtElapsed(elapsed)}</>)
            : (<><span aria-hidden="true">🎤</span> Speak</>)}
      </button>
      {error && (
        <p className="error" style={{ margin: '6px 0 0', fontSize: 13 }}>{error}</p>
      )}
    </div>
  );
}
