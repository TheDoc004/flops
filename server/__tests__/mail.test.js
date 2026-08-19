/**
 * @jest-environment node
 */

describe('mail helpers', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('reports configured when RESEND_API_KEY is set', () => {
    process.env.RESEND_API_KEY = 're_test';
    delete process.env.SMTP_URL;
    const { mailConfigured } = require('../mail');
    expect(mailConfigured()).toBe(true);
  });

  it('sends via Resend HTTP API', async () => {
    process.env.RESEND_API_KEY = 're_test';
    delete process.env.SMTP_URL;
    process.env.MAIL_FROM = 'FLOPS <onboarding@resend.dev>';

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '{}',
    });
    global.fetch = fetchMock;

    const { sendOtpEmail } = require('../mail');
    await sendOtpEmail('you@example.com', '123456');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer re_test',
        }),
      })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toEqual(['you@example.com']);
    expect(body.text).toContain('123456');
  });

  it('throws when no mailer is configured', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_URL;
    const { sendOtpEmail } = require('../mail');
    await expect(sendOtpEmail('a@b.com', '111111')).rejects.toMatchObject({
      code: 'MAIL_NOT_CONFIGURED',
    });
  });
});
