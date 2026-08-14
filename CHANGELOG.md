# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
