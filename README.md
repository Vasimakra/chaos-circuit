# Chaos Circuit

A static React + TypeScript arcade game. The frontend is hosted on Netlify; Firebase Authentication and Realtime Database synchronize rooms and players. There is no custom server.

## Run locally

1. Install Node.js 20 or newer.
2. Create `.env.local` in the project root (beside `package.json`) with the five required Vite variables shown below, then paste each matching value from Firebase Console → Project settings → General → Your apps → SDK setup. Get the database URL from Realtime Database → Data.
3. In Firebase Console, create a project, register a web app, enable **Authentication → Anonymous**, add `localhost` and your Netlify domain under **Authentication → Settings → Authorized domains**, and create a **Realtime Database**.
4. In Realtime Database → Rules, paste the contents of `database.rules.json` and publish them.
5. If you create or change `.env.local` while Vite is already running, stop the dev server and restart it with `npm run dev`; Vite reads these variables at startup. Then run `npm install` if needed.

```makefile
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_DATABASE_URL=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
```

The game requires Firebase configuration to create or join a room. The landing and setup screens still load without it.

## Firebase environment values

Set these in `.env.local` for local development and in Netlify → Site configuration → Environment variables for deployment:

| Variable | Firebase web app field |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `VITE_FIREBASE_DATABASE_URL` | Realtime Database URL |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` |
| `VITE_FIREBASE_APP_ID` | `appId` |

The five values above are required; `.env.local` is ignored by Git. `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, and `VITE_FIREBASE_MEASUREMENT_ID` are optional fields supported by the config. Never put a service account key or private key in the frontend or GitHub.

## Deploy to Netlify

1. Push this folder to a Git provider, or use Netlify's manual deploy after building.
2. In Netlify, import the repository. The included `netlify.toml` sets the build command to `npm run build` and publish folder to `dist`.
3. Add all five `VITE_FIREBASE_*` values in the Netlify environment variable settings.
4. Trigger a deploy. For manual deploy, run `npm install` and `npm run build`, then upload `dist/`.
5. Open the deployed site and create a room; open the invite URL/site in another browser to join and check multiplayer.

## Realtime behavior and limits

- Room codes are short and randomly generated. Seat claims are transactions over eight fixed seat records, preventing concurrent joins from exceeding room capacity. The rules require a matching seat claim before a new player record can be created.
- Anonymous Auth gives each browser a stable Firebase UID. Player movement writes are throttled to about 9 updates per second; animation remains local and remote positions interpolate in CSS.
- The 180-second clock uses the shared database start timestamp plus Firebase's server-time offset. Round selection is derived from elapsed time, and focus/visibility changes trigger an immediate clock refresh.
- Hazards and safe zones are derived from the shared match seed and elapsed segment, so all clients see the same layout.
- Scores update through a transaction on each player's own record with an elapsed-second guard. Rules prevent a client from writing another player's record. Since game logic runs in browsers, a modified client can still falsify its own movement or score. This setup improves synchronization and prevents accidental duplicate ticks; it is not server-authoritative anti-cheat.
- Match scores and rounds are shared through RTDB. On a rematch, the host reopens the lobby and each player's client resets its own score under the per-player rules.
- Database rules allow authenticated room reads to support invite-code entry. For production, add Firebase App Check and consider short room expiry/cleanup through an administrative process if one becomes available.

## Deploy checklist

- [ ] Anonymous Authentication enabled
- [ ] Realtime Database created and `database.rules.json` published
- [ ] Five `VITE_FIREBASE_*` settings present in local or Netlify environment
- [ ] `npm run build` succeeds and produces `dist/`
- [ ] Test room creation, joining from a second browser, start, round changes, timer completion, reconnect, and mobile controls
