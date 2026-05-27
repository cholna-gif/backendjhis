import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendEmail = async (to: string, subject: string, html: string) => {
  await transporter.sendMail({
    from: `"JihWorld" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
};

export const sendVerificationEmail = async (to: string, token: string, baseUrl: string) => {
  const link = `${baseUrl}/auth/verify?token=${token}`;
  await sendEmail(
    to,
    'Verify your JihWorld account',
    `<p>Click the link below to verify your email:</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours.</p>`
  );
};

export const sendPasswordResetEmail = async (to: string, token: string, baseUrl: string) => {
  const link = `${baseUrl}/reset-password?token=${token}`;
  await sendEmail(
    to,
    'Reset your JihWorld password',
    `<p>Click the link below to reset your password:</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour.</p>`
  );
};
