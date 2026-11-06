#!/usr/bin/env node
// Keep the theme daemon in the same process tree as the existing runner.
await import('./theme/core/daemon.mjs');
