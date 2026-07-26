const { callProviderJson, parseDataUrl, AiConfigError } = require('../aiClient');

const IMG = 'data:image/jpeg;base64,QUJD'; // "ABC"

describe('aiClient — parseDataUrl', () => {
  it('parses a base64 data URL', () => {
    expect(parseDataUrl(IMG)).toEqual({ mediaType: 'image/jpeg', base64: 'QUJD' });
  });
  it('returns null for non-data / non-base64 input', () => {
    expect(parseDataUrl('https://example.com/x.jpg')).toBeNull();
    expect(parseDataUrl('data:image/png,notbase64')).toBeNull();
    expect(parseDataUrl('')).toBeNull();
  });
});

describe('aiClient — vision message construction', () => {
  const OLD_ENV = { ...process.env };
  let calls;

  beforeEach(() => {
    calls = [];
    global.fetch = jest.fn(async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      // Minimal shape both provider parsers accept.
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' } }], // OpenAI
          content: [{ type: 'text', text: '{"ok":true}' }], // Anthropic
        }),
      };
    });
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
    delete global.fetch;
  });

  it('throws AiConfigError when no provider key is set', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_PROVIDER;
    await expect(callProviderJson({ system: 's', user: 'u' })).rejects.toBeInstanceOf(AiConfigError);
  });

  it('attaches the image inline for OpenAI (image_url)', async () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test';
    await callProviderJson({ system: 's', user: 'read this', imageDataUrl: IMG });
    const msg = calls[0].body.messages.find(m => m.role === 'user');
    expect(Array.isArray(msg.content)).toBe(true);
    expect(msg.content).toContainEqual({ type: 'image_url', image_url: { url: IMG } });
    expect(msg.content).toContainEqual({ type: 'text', text: 'read this' });
  });

  it('attaches the image as a base64 block for Anthropic', async () => {
    process.env.AI_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'test';
    await callProviderJson({ system: 's', user: 'read this', imageDataUrl: IMG });
    const msg = calls[0].body.messages.find(m => m.role === 'user');
    expect(msg.content).toContainEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' },
    });
  });

  it('sends plain text (no array) when no image is provided', async () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test';
    await callProviderJson({ system: 's', user: 'just text' });
    const msg = calls[0].body.messages.find(m => m.role === 'user');
    expect(msg.content).toBe('just text');
  });
});
