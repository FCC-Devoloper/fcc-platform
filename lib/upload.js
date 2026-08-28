'use strict';

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/gif': ['.gif'],
    'image/webp': ['.webp'],
    'application/pdf': ['.pdf'],
    'text/plain': ['.txt']
};

function sniffMime(buffer, declared) {
    if (!buffer || buffer.length < 12) return declared || null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return 'image/webp';
    }
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return 'application/pdf';
    return declared || null;
}

function saveBase64Upload({ filename, mime, data }, destDir) {
    if (!data || !filename) {
        return { error: 'Файл не передан', status: 400 };
    }

    const base64 = String(data).replace(/^data:[^;]+;base64,/, '');
    let buffer;
    try {
        buffer = Buffer.from(base64, 'base64');
    } catch (e) {
        return { error: 'Некорректные данные файла', status: 400 };
    }

    if (!buffer.length) return { error: 'Пустой файл', status: 400 };
    if (buffer.length > MAX_BYTES) {
        return { error: 'Файл больше 5 МБ', status: 400 };
    }

    const declared = String(mime || '').toLowerCase();
    const sniffed = sniffMime(buffer, declared);
    if (!sniffed || !ALLOWED[sniffed]) {
        return { error: 'Разрешены только JPG, PNG, GIF, WEBP, PDF и TXT', status: 400 };
    }

    const extFromName = path.extname(filename).toLowerCase();
    const ext = ALLOWED[sniffed].includes(extFromName) ? extFromName : ALLOWED[sniffed][0];
    const safeBase = path.basename(filename, path.extname(filename)).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40);
    const safeName = Date.now() + '_' + uuidv4().slice(0, 8) + '_' + (safeBase || 'file') + ext;

    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const filePath = path.join(destDir, safeName);
    fs.writeFileSync(filePath, buffer);

    return { success: true, url: '/uploads/' + safeName, mime: sniffed, size: buffer.length };
}

module.exports = { saveBase64Upload, MAX_BYTES, ALLOWED };
