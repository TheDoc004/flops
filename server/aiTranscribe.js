/**
 * aiTranscribe — server-side speech-to-text for the AI logger's voice input.
 * Uses OpenAI's transcription API directly (Anthropic has no speech endpoint),
 * so this needs OPENAI_API_KEY even if macro estimation runs on Anthropic.
 * Same no-SDK approach as aiClient: built-in fetch + FormData (Node 18+).
 */
const {
  classifyProviderError,
  AiConfigError,
  AiProviderError,
  AiResponseError,
} = require('./aiClient');

// OpenAI infers the audio format from the uploaded filename's extension.
const EXT_BY_MIME = {
  'audio/webm': 'webm', // Chrome / Android
  'audio/mp4': 'mp4', // iOS Safari
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
};

/**
 * @param {{ buffer: Buffer, mimeType?: string }} input raw recorded audio
 * @returns {Promise<string>} the transcript ('' when no speech was detected)
 * @throws {AiConfigError|AiProviderError|AiQuotaError|AiResponseError}
 */
async function transcribeAudio({ buffer, mimeType }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new AiConfigError('Voice transcription is not configured. Set OPENAI_API_KEY on the server.');
  }
  const model = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
  const baseType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const ext = EXT_BY_MIME[baseType] || 'webm';

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: baseType || 'audio/webm' }), `voice-note.${ext}`);
  form.append('model', model);

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
  } catch (e) {
    throw new AiProviderError(`Could not reach the transcription service: ${e.message}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw classifyProviderError(res.status, detail);
  }
  const data = await res.json().catch(() => null);
  if (typeof data?.text !== 'string') {
    throw new AiResponseError('Transcription service returned an unexpected response.');
  }
  return data.text.trim();
}

module.exports = { transcribeAudio };
