"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPasswordResetEmail = exports.sendVerificationEmail = exports.sendEmail = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const transporter = nodemailer_1.default.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});
const sendEmail = async (to, subject, html) => {
    await transporter.sendMail({
        from: `"JihWorld" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to,
        subject,
        html,
    });
};
exports.sendEmail = sendEmail;
const sendVerificationEmail = async (to, token, baseUrl) => {
    const link = `${baseUrl}/auth/verify?token=${token}`;
    await (0, exports.sendEmail)(to, 'Verify your JihWorld account', `<p>Click the link below to verify your email:</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours.</p>`);
};
exports.sendVerificationEmail = sendVerificationEmail;
const sendPasswordResetEmail = async (to, token, baseUrl) => {
    const link = `${baseUrl}/reset-password?token=${token}`;
    await (0, exports.sendEmail)(to, 'Reset your JihWorld password', `<p>Click the link below to reset your password:</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour.</p>`);
};
exports.sendPasswordResetEmail = sendPasswordResetEmail;
