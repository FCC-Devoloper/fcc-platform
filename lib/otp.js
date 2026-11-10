'use strict';
const crypto = require('crypto');

// in-memory OTP store: key -> { hash, exp, attempts }
const store = new Map();

function hashCode(code) {
    return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function generateCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function put(key, ttlMs = 10 * 60 * 1000) {
    const code = generateCode();
    store.set(String(key), {
        hash: hashCode(code),
        exp: Date.now() + ttlMs,
        attempts: 0
    });
    return code;
}

function verify(key, code) {
    const row = store.get(String(key));
    if (!row) return { ok: false, error: 'Код не запрошен или истёк' };
    if (Date.now() > row.exp) {
        store.delete(String(key));
        return { ok: false, error: 'Код истёк' };
    }
    row.attempts += 1;
    if (row.attempts > 5) {
        store.delete(String(key));
        return { ok: false, error: 'Слишком много попыток' };
    }
    if (row.hash !== hashCode(code)) return { ok: false, error: 'Неверный код' };
    store.delete(String(key));
    return { ok: true };
}

/** Send OTP — uses SMTP if env set, else logs to console */
async function sendEmailOtp(toEmail, code, purpose) {
    const subject = purpose === 'admin'
        ? 'FCC Admin OTP'
        : 'FCC код подтверждения';
    const body = `Ваш код: ${code}\nДействует 10 минут.\nЕсли это не вы — игнорируйте письмо.`;

    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || user || 'noreply@fcc.local';

    if (!host || !user) {
        console.log('[OTP]', purpose, 'to=', toEmail, 'code=', code);
        return { sent: false, logged: true, code: process.env.NODE_ENV === 'production' ? undefined : code };
    }

    // Minimal SMTP via nodemailer-less: use fetch to a webhook if SMTP_WEBHOOK set
    if (process.env.SMTP_WEBHOOK) {
        try {
            await fetch(process.env.SMTP_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: toEmail, subject, text: body, from, code })
            });
            return { sent: true };
        } catch (e) {
            console.error('[OTP] webhook failed', e.message);
            console.log('[OTP] fallback code=', code);
            return { sent: false, logged: true };
        }
    }

    console.log('[OTP] SMTP configured but no transport lib — logging code for', toEmail, code);
    return { sent: false, logged: true, code: process.env.ALLOW_OTP_IN_RESPONSE === '1' ? code : undefined };
}

module.exports = { put, verify, sendEmailOtp, generateCode };
