# James AI — Phone / Android

James AI is now PWA-ready and includes an Android APK build workflow.

### Phone browser
Deploy the project over HTTPS. Open it on Android Chrome and choose **Add to Home screen**. It will launch like an app.

### APK
1. Push this repository to GitHub.
2. Deploy James AI to Render and copy the HTTPS URL.
3. GitHub → Settings → Secrets and variables → Actions → Variables → New repository variable.
4. Name: `JAMESAI_URL`
5. Value: your deployed James AI HTTPS URL.
6. Actions → **Build James AI Android APK** → Run workflow.
7. Download the generated `jamesai-debug-apk` artifact.

The OpenAI API key remains server-side; do not put it in the Android app or frontend.


### Google Login requirement

Before using the phone app, configure `GOOGLE_CLIENT_ID` on the deployed server. For the most reliable Google Sign-In on Android, use the HTTPS site in Chrome and **Add to Home screen**. Google may restrict embedded WebView sign-in, so a Capacitor debug APK is not a guaranteed replacement for the browser/PWA route.
