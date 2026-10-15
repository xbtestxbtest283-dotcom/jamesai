# James AI — Render deployment and persistent user plans

This project stores Google account records, plans, quota usage, and pending purchases in `users.json`.

## Important: keep plans across redeploys

Render Free web services use an ephemeral filesystem. A normal `data/users.json` file can be lost on redeploy/restart, so **do not rely on the Free service filesystem for paid-plan records**.

### Option A — Render Persistent Disk

A persistent disk requires a Render service plan that supports disks and may incur a charge. Check Render's current pricing before upgrading.

1. Open the James AI Web Service in Render.
2. Open **Disks** and add a disk (mount path: `/var/data`; size: choose the smallest suitable size).
3. In **Environment**, add `DATA_DIR` with value `/var/data`.
4. Save changes and redeploy.
5. On the first startup with an empty disk, the server copies the bundled `data/users.json` into `/var/data/users.json`. After that, the mounted disk is the source of truth.
6. Test with a non-admin account first: sign in, check the plan, restart/redeploy, and check again.

Do not attach a new empty disk over an existing live data directory without taking a backup first. If live records already exist on Render, download/back them up before switching paths and copy the existing `users.json` to `/var/data/users.json`.

### Option B — External database

Use a persistent PostgreSQL database and update the application to store user records there. Do not set `DATA_DIR` and assume the Free filesystem is persistent; it is not.

## Required environment variables

Set secrets in Render Environment Variables, not in source code:
- `OPENAI_API_KEY`
- `POLLINATIONS_API_KEY` (if using Pollinations images)
- `WAVE_PAY_PHONE`
- `WAVE_PAY_NAME`
- `ADMIN_PAYMENT_SECRET`
- `GOOGLE_CLIENT_ID`

Keep `.env` out of GitHub and ZIPs shared publicly. Never expose API keys or admin secrets in screenshots.

## Google OAuth

Add the deployed Render URL as an Authorized JavaScript origin in Google Cloud, e.g. `https://YOUR-RENDER-DOMAIN.onrender.com`.

## Verify

Open `https://YOUR-RENDER-URL/api/health`; it should return `{"ok":true,...}`. Then log in with a test account and confirm the same plan/quota remains after restart.
