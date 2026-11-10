# FCC — Railway relaunch

- Runtime: Node.js 22.12+ / Express. Start command: `npm start`.
- Existing Railway service: project `proactive-wonder`, service `fcc-platform`, environment `production`.
- Attach one Railway Volume at `/app/data` before launching the refreshed code.
- Set `FCC_UPLOAD_DIR=/app/data/uploads`; the JSON database remains `/app/data/fcc_data.json`, and uploaded files are saved under `/app/data/uploads` while keeping `/uploads/...` public URLs.
- Set `JWT_SECRET` and `ADMIN_INVITE_CODE` in Railway Variables. Google login remains disabled unless a real `GOOGLE_CLIENT_ID` is configured for the Railway domain.
- To preserve the supplied database, set `FCC_BOOTSTRAP_DATA_GZIP_B64` to the gzip+base64 contents of the private `data/fcc_data.json` before the first deploy with the new Volume. On first boot, the app imports it only when the Volume has no `fcc_data.json`. Clear this variable after checking the import log; the live copy remains in the Volume.
- Never commit `.env`, `data/fcc_data.json`, backups, or user uploads.
