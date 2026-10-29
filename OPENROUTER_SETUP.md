# OpenRouter setup for James AI

1. In Render, open your James AI Web Service -> Environment.
2. Add `OPENROUTER_API_KEY` with your private OpenRouter key. Never put the key in frontend files or commit it to GitHub.
3. Add `OPENROUTER_MODEL=openrouter/free`. This asks OpenRouter to route to an available free model when possible.
4. Optional: set `OPENROUTER_FALLBACK_MODELS` to a comma-separated list of model IDs that are available to your account. If the first model returns a rate-limit/temporary error, James AI tries the next one.
5. Save and redeploy. You can leave `OPENAI_API_KEY` unset if you only want OpenRouter.

## Important

Fallbacks reduce interruptions but cannot guarantee zero HTTP 429 errors: free models have shared rate limits and can all be unavailable at once. James AI's own message/credit quota can also return 429 separately; this patch does not remove those app limits. Image generation still uses the existing Pollinations configuration.

Example (do not paste a real key into this file):

```env
OPENROUTER_API_KEY=your_private_key_here
OPENROUTER_MODEL=openrouter/free
OPENROUTER_FALLBACK_MODELS=provider/model-id-one:free,provider/model-id-two:free
```
