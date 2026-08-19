/**
 * Outbound mail for login OTPs.
 *
 * Prefer Resend HTTP API when RESEND_API_KEY is set (recommended).
 * Otherwise use SMTP_URL with nodemailer (e.g. Resend SMTP or any provider).
 *
 * MAIL_FROM — defaults to "FLOPS <onboarding@resend.dev>" (Resend test sender).
 * With a verified domain, set e.g. MAIL_FROM="FLOPS <login@yourdomain.com>".
 */

const DEFAULT_FROM = 'FLOPS <onboarding@resend.dev>';

function mailConfigured() {
  return !!(process.env.RESEND_API_KEY || process.env.SMTP_URL);
}

function fromAddress() {
  return String(process.env.MAIL_FROM || DEFAULT_FROM).trim() || DEFAULT_FROM;
}

async function sendViaResend({ to, subject, text }) {
  const key = process.env.RESEND_API_KEY;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: [to],
      subject,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Resend error ${res.status}: ${body.slice(0, 300)}`);
    err.status = 502;
    throw err;
  }
}

async function sendViaSmtp({ to, subject, text }) {
  const nodemailer = require('nodemailer');
  const url = process.env.SMTP_URL;
  const transporter = nodemailer.createTransport(url);
  await transporter.sendMail({
    from: fromAddress(),
    to,
    subject,
    text,
  });
}

/**
 * Send a 6-digit login code.
 * No-ops only when neither provider is configured (caller decides policy).
 */
async function sendOtpEmail(to, code) {
  const subject = 'Your FLOPS login code';
  const text =
    `Your FLOPS login code is ${code}.\n\n` +
    `It expires in 10 minutes. If you did not request this, you can ignore this email.\n`;

  if (process.env.RESEND_API_KEY) {
    await sendViaResend({ to, subject, text });
    return { provider: 'resend' };
  }
  if (process.env.SMTP_URL) {
    await sendViaSmtp({ to, subject, text });
    return { provider: 'smtp' };
  }
  const err = new Error('Email is not configured (set RESEND_API_KEY or SMTP_URL).');
  err.status = 503;
  err.code = 'MAIL_NOT_CONFIGURED';
  throw err;
}

module.exports = {
  mailConfigured,
  sendOtpEmail,
  fromAddress,
};
