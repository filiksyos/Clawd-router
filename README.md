# clawd-router

Smart LLM router — auto-routes requests to the best OpenRouter model.

## Prerequisites

Set the `OPENROUTER_API_KEY` environment variable.

## Install

```bash
curl -fsSL https://cdn.jsdelivr.net/npm/clawd-router/scripts/install.sh | bash
openclaw gateway restart
```

This installs the plugin and adds it to the allowlist so it enables immediately. Set `OPENROUTER_API_KEY` and run `openclaw models set clawd-router/auto`.

## Usage

```bash
openclaw models set clawd-router/auto
openclaw gateway restart
```
