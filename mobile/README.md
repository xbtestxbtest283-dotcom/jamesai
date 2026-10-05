# James AI Android wrapper

This folder contains the Android packaging configuration. The APK loads the deployed James AI web app so the server-side OpenAI key stays on the server.

## Build
1. Deploy the root project to Render (or another HTTPS host).
2. Replace `https://YOUR-JAMESAI-DOMAIN.example.com` in `capacitor.config.ts` with the real HTTPS URL.
3. From the repository root, run:
   `npm install`
   `npm install --save-dev @capacitor/cli @capacitor/core @capacitor/android`
   `npx cap add android`
   `npx cap sync android`
   `npx cap open android`

For CI, use the included GitHub Actions workflow and set the repository variable `JAMESAI_URL` to the deployed HTTPS URL.
