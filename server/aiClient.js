/**
 * aiClient — shared provider plumbing for all server-side AI features
 * (macro estimation, micronutrient estimation, …). Provider-agnostic: uses
 * OpenAI or Anthropic depending on which API key is set (AI_PROVIDER overrides).
 * Keys are read here, server-side only, and never sent to the frontend.
 *
 * No SDK — calls each provider's REST API with the built-in fetch (Node 18+).
 * Each feature supplies its own system/user prompt and validates the JSON it
 * gets back; this module only handles the transport.
 */

class AiConfigError extends Error {} // no usable API key configured -> 503
class AiProviderError extends Error {} // provider call failed -> 502
class AiResponseError extends Error {} // provider returned unusable output -> 502
class AiQuotaError extends Error {} // provider account out of quota / billing not set up -> 402

// Quota / billing signatures across providers.
const QUOTA_RE = /insufficient_quota|exceeded your current quota|credit balance is too low|billing|payment required|out of credits|quota/i;

function classifyProviderError(status, detail) {
  if (status === 402 || QUOTA_RE.test(String(detail || ''))) {
    return new AiQuotaError(
      "The AI provider says the account is out of quota or billing isn't set up. Add credits / check the provider's billing settings, then try again."
    );
  }
  return new AiProviderError(`AI service returned ${status}. ${String(detail).slice(0, 300)}`);
}

function resolveProvider() {
  const explicit = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'openai') return process.env.OPENAI_API_KEY ? 'openai' : null;
  if (explicit === 'anthropic') return process.env.ANTHROPIC_API_KEY ? 'anthropic' : null;
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

async function callOpenAIJson({ system, user, maxTokens }) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  } catch (e) {
    throw new AiProviderError(`Could not reach the AI service: ${e.message}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw classifyProviderError(res.status, detail);
  }
  const data = await res.json().catch(() => null);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new AiResponseError('AI service returned an empty response.');
  return text;
}

async function callAnthropicJson({ system, user, maxTokens }) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
  } catch (e) {
    throw new AiProviderError(`Could not reach the AI service: ${e.message}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw classifyProviderError(res.status, detail);
  }
  const data = await res.json().catch(() => null);
  const text = Array.isArray(data?.content)
    ? data.content.filter(b => b?.type === 'text').map(b => b.text).join('')
    : null;
  if (!text) throw new AiResponseError('AI service returned an empty response.');
  return text;
}

/**
 * Run a JSON-only chat completion against the configured provider.
 * @returns {Promise<string>} the model's raw text (expected to be JSON).
 * @throws {AiConfigError|AiProviderError|AiQuotaError|AiResponseError}
 */
async function callProviderJson({ system, user, maxTokens = 1500 }) {
  const provider = resolveProvider();
  if (!provider) {
    throw new AiConfigError('AI estimation is not configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY on the server.');
  }
  return provider === 'anthropic'
    ? callAnthropicJson({ system, user, maxTokens })
    : callOpenAIJson({ system, user, maxTokens });
}

/** Pull the JSON object out of a model response (tolerates stray prose / code fences). */
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new AiResponseError('AI response did not contain valid JSON.');
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new AiResponseError('AI response was not valid JSON.');
  }
}

module.exports = {
  callProviderJson,
  extractJson,
  resolveProvider,
  AiConfigError,
  AiProviderError,
  AiResponseError,
  AiQuotaError,
};
