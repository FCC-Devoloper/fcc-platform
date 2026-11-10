'use strict';

const fs = require('fs');
const path = require('path');

// Railway: mount a persistent Volume at /app/data and set FCC_UPLOAD_DIR=/app/data/uploads.
// Local development remains backward compatible with public/uploads.
const UPLOAD_DIR = path.resolve(
    process.env.FCC_UPLOAD_DIR || path.join(__dirname, '..', 'public', 'uploads')
);

function ensureUploadDir() {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    return UPLOAD_DIR;
}

module.exports = { UPLOAD_DIR, ensureUploadDir };
