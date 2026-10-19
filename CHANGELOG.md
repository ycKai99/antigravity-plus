# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-10-19

### Added
- **Multi-Module Injector Runner (`inject.js`)**: Unified orchestrator supporting multi-script injection via `config.json`, CLI argument overrides (`--all`, `--limits`, `--rail`, etc.), and hot revert (`npm run revert` / `node inject.js --revert`).
- **Configuration Support (`config.json`)**: Configurable module presets allowing customized default injection bundles.
- **Theme Presets**: Added three light-theme styles (`inject-theme-contrast.js` for High Contrast, `inject-theme-purewhite.js` for ClaudeDesktop Pure White, and `inject-theme-vintage.js` for Vintage Deep).
- **Interaction Enhancements (`inject-enhancements.js`)**: Injected TanStack Router settings dialog deadlock guard and React appearance setting crash guard.
- **Enhanced Quota Reset Formatting**: Added `formatResetTime` helper in `inject-limits.js` displaying both exact reset timestamps and relative countdowns, plus persistent mutation observer management.

### Changed
- **NPM Scripts**: Added `inject`, `inject:all`, `revert`, `inject:theme:contrast`, `inject:theme:white`, `inject:theme:vintage`, and `inject:enhancements` to `package.json`.
- **Documentation**: Updated `README.md` and `README_zh.md` with multi-module runner instructions, `config.json` configuration, and hot revert guides.

## [1.1.0] - 2026-08-14

### Added
- **Turn Rail Navigator (`inject:rail`)**: Injects a floating conversation turn rail for navigating dialogue history and jumping directly to user/agent prompts.
- **Custom Font Injector (`inject:font`)**: Injects modern typography enhancements (MiSans for conversation output and Maple Mono NF for code blocks).
- **Skill Manager Daemon & UI (`inject:skills`)**: Integrated local skill parser on port 9527 and injected visual skill management controls.
- **Enhanced npm scripts**: Added `inject:limits`, `inject:skills`, `inject:rail`, and `inject:font` to `package.json`.
- **Documentation**: Updated `README.md` and `README_zh.md` covering all injection modules, project structure, and usage guides.

## [1.0.0] - 2026-07-19

### Added
- Initial release with real-time Weekly Limit and 5-Hour Limit indicators.
- Skin manager supporting default pill skin and compact battery skin.
- Tooltip cards with live countdowns and usage breakdown.
