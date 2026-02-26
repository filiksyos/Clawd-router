# clawd-router

Smart LLM router — auto-routes requests to the best OpenRouter model.

## Prerequisites

Provide an OpenRouter API key in one of these ways:

- `OPENROUTER_API_KEY` environment variable
- `env.OPENROUTER_API_KEY` in `~/.openclaw/openclaw.json`
- `openclaw onboard --token-provider openrouter --token "sk-or-..."` (clawd-router reuses this key)

## Install

```bash
curl -fsSL https://cdn.jsdelivr.net/npm/clawd-router/scripts/install.sh | bash
openclaw gateway restart
```

This installs the plugin and adds it to the allowlist so it enables immediately. If you already have OpenRouter configured in OpenClaw, clawd-router will reuse that key automatically.

## Usage

```bash
openclaw models set clawd-router/auto
openclaw gateway restart
```
