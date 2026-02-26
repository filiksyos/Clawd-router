#!/bin/bash
set -e

# Clawd Router — install plugin and add to plugins.allow so it enables immediately.
# Run: curl -fsSL https://cdn.jsdelivr.net/npm/clawd-router/scripts/install.sh | bash

echo "🦞 clawd-router"
echo ""

echo "→ Installing clawd-router..."
openclaw plugins install clawd-router

echo "→ Adding to plugins allow list..."
node -e "
const os = require('os');
const fs = require('fs');
const path = require('path');
const configPath = process.env.OPENCLAW_CONFIG_PATH || path.join(os.homedir(), '.openclaw', 'openclaw.json');

if (!fs.existsSync(configPath)) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ plugins: { allow: ['clawd-router'], entries: { 'clawd-router': { enabled: true } } } }, null, 2));
  console.log('  Created config with clawd-router in allow list');
  process.exit(0);
}

try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!config.plugins) config.plugins = {};
  if (!Array.isArray(config.plugins.allow)) config.plugins.allow = [];
  if (!config.plugins.allow.includes('clawd-router')) {
    config.plugins.allow.push('clawd-router');
    console.log('  Added clawd-router to plugins.allow');
  } else {
    console.log('  clawd-router already in allow list');
  }
  if (!config.plugins.entries) config.plugins.entries = {};
  if (!config.plugins.entries['clawd-router']) {
    config.plugins.entries['clawd-router'] = { enabled: true };
    console.log('  Enabled clawd-router');
  } else if (!config.plugins.entries['clawd-router'].enabled) {
    config.plugins.entries['clawd-router'].enabled = true;
    console.log('  Enabled clawd-router');
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
} catch (e) {
  console.error('  Error:', e.message);
  process.exit(1);
}
"

echo ""
echo "✓ clawd-router installed and enabled."
echo ""
echo "Set your OpenRouter API key:"
echo "  export OPENROUTER_API_KEY=sk-or-..."
echo ""
echo "Restart OpenClaw to apply:"
echo "  openclaw gateway restart"
echo ""
echo "Set default model:"
echo "  openclaw models set clawd-router/auto"
echo ""
