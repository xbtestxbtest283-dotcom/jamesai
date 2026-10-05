# James AI — GitHub + Cloud Deployment

James AI is a Node.js/Express web app. **For AI to keep working when your laptop is OFF, deploy this repository to a cloud web service.** GitHub is the source-code repository; it is not the AI backend.

## Recommended setup (laptop can be OFF)

```text
GitHub repository
       │
       ▼
Cloud web service (Render)
       │
       ├── James AI website
       └── /api/chat + /api/images
                │
                ▼
           OpenAI API
                │
                ▼
          📱 Phone / PC
```

This project is already structured so the same cloud service serves both the website and the API. That is the easiest setup: **do not use GitHub Pages for the main James AI site**.

## 1. Upload to GitHub

Upload the **contents of this folder** to your GitHub repository. Do not upload `.env` or a real API key.

## 2. Deploy from GitHub to Render

1. Create/sign in to a Render account.
2. Choose **New → Web Service** and connect your GitHub repository.
3. Runtime: **Node**.
4. Build command: `npm ci`
5. Start command: `npm start`
6. Add environment variable `OPENAI_API_KEY` and paste your API key there.
7. Keep `OPENAI_MODEL=gpt-6-luna` and `OPENAI_IMAGE_MODEL=gpt-image-2` unless you intentionally change them.
8. Deploy.

After deployment Render gives you a URL similar to:

`https://james-ai-xxxx.onrender.com`

Open that URL on your phone. **Your laptop does not need to be on.**

## 3. Health check

Open:

`https://YOUR-RENDER-URL/api/health`

You should see JSON containing `"ok": true` and `"apiConfigured": true`.

If `apiConfigured` is false, the `OPENAI_API_KEY` environment variable has not been added correctly.

## GitHub Pages (optional)

GitHub Pages can host the static frontend, but it cannot run this Node.js/Express API. If you specifically want GitHub Pages, first deploy the backend above, then change this line in `public/index.html`:

```html
<script>window.JAMESAI_API_BASE_URL = "https://YOUR-RENDER-URL";</script>
```

Then redeploy the frontend to GitHub Pages. **Never put the OpenAI API key in this file or any `public/` file.**

## Local development

Requirements: Node.js 20+.

```bash
npm install
cp .env.example .env
# put your real key in .env
npm run dev
```

Open `http://localhost:3000`.

## Security

- `.env` is ignored by Git.
- Keep `OPENAI_API_KEY` only in the cloud service's secret/environment settings.
- Do not paste the API key into `public/`, GitHub Pages, screenshots, or chat messages.

## Android

The included Capacitor workflow can build an Android APK after you have a permanent HTTPS James AI URL. Set the GitHub repository variable `JAMESAI_URL` to your deployed URL and run the **Build James AI Android APK** workflow.
