# FCC — Railway relaunch notes

- Runtime: Node.js / Express.
- Start command: `npm start` (runs `node server.js`).
- The server listens on `process.env.PORT` and binds to `0.0.0.0`.
- Set the variables from `.env.example` in Railway Variables; never upload `.env`.
- The app stores application data in `data/fcc_data.json` and user uploads in `public/uploads`.
- Before deploying a new version, back up the existing data and uploads.
- Configure persistent storage for data and uploads before relying on these paths in production. Do not remove the current data file until it has been copied and verified in persistent storage.
- Generate a fresh `package-lock.json` after synchronizing `package.json` by running `npm install`; commit both files together.
