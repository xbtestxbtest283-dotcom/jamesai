# James AI — Render deployment

This package contains the current UI with:
- Plans & Purchase
- Plus 7 Days / Plus 15 Days / Plus Pro
- AI Image Generator via Pollinations
- Google Sign-In
- Usage quotas

## Render
Use `render.yaml` or set the environment variables manually in Render.
Required secrets:
- OPENAI_API_KEY
- POLLINATIONS_API_KEY
- WAVE_PAY_PHONE
- WAVE_PAY_NAME
- ADMIN_PAYMENT_SECRET

After deployment, open the Render URL in a fresh/private browser window or
clear the site's service-worker data once. The service worker is now v2 and
the app shell uses network-first loading, so new deployments should not keep
the old UI.

Google OAuth:
Add the Render URL as an Authorized JavaScript origin in Google Cloud.
Example:
https://YOUR-RENDER-DOMAIN.onrender.com

Do not commit `.env`; use Render Environment Variables for production.
