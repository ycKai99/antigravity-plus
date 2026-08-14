# Antigravity Plus

[English](README.md) | [简体中文](README_zh.md)

A lightweight, zero-dependency injector suite for UI customizations and productivity enhancements in **Antigravity 2.0**.

---

## 📸 Preview

### 1. Limits Indicator on Input Bar
![Limits Indicator on Input Bar](assets/preview.png)

### 2. Detailed Hover Tooltip Card
![Detailed Hover Tooltip Card](assets/hover.png)

### 3. Compact Battery Skin (Skin Manager)
![Compact Battery Skin](assets/battery_skin.png)

---

## ✨ Features & Modules

### 1. Quota Limits Indicator (`npm run inject:limits`)
* **Clean Inline Layout**: Positioned gracefully to the right of the model selector in the bottom toolbar flex row—never wraps, keeping the workspace neat and tidy.
* **Real-time Quota Sync**: Safely reads the local CSRF token to poll the Go backend gRPC-web endpoint (`RetrieveUserQuotaSummary`) every 5 seconds, displaying your exact remaining usage fractions.
* **Auto Group Detection**: Automatically detects the active model group (e.g. Gemini Models vs. Claude & GPT Models) and switches to display the correct quota buckets dynamically when you switch models in the client.
* **Dynamic Status Dots**: Glowing indicators transition colors automatically based on remaining capacity (Green for safe, Orange for warnings, Red for critical).
* **Interactive Tooltip Card**: Hovering over the pills reveals a sleek, modern glassmorphic card displaying detailed usage percentages, progress bars, and countdowns to the next quota reset.
* **Skin Manager**: Supports switching between default pill skin and compact battery skin, with full dark/light theme adaptation.

### 2. Skill Manager (`npm run inject:skills`)
* **Visual Skill Management**: Injects a visual skill browser directly into Antigravity 2.0 to browse, inspect, and toggle available skills.
* **Local Daemon Service**: Runs a lightweight local proxy server on port `9527` to parse and manage skills seamlessly.

### 3. Turn Rail Navigator (`npm run inject:rail`)
* **Quick Turn Navigation**: Injects a floating rail on the left side of the conversation view.
* **Direct Jump**: Easily jump between user prompts and agent responses across long conversation histories.

### 4. Custom Font Injector (`npm run inject:font`)
* **Typography Polish**: Injects clean typography enhancements, applying `MiSans` to AI conversational messages and `Maple Mono NF` to code blocks.

---

## 🛠️ Prerequisites

* **Node.js v22.0.0 or later**: The injectors use native global `WebSocket` and `fetch` APIs to keep the scripts 100% lightweight and dependency-free (no need to run `npm install`).
* **Antigravity 2.0** desktop client running.

---

## 🚀 Getting Started

1. Make sure your **Antigravity 2.0** client is running.
2. Run any of the injectors from the project root:

```bash
# Inject Quota Limits Indicator (default)
npm run inject:limits

# Inject Skill Manager UI & local daemon
npm run inject:skills

# Inject Conversation Turn Rail
npm run inject:rail

# Inject Custom Typography
npm run inject:font
```

3. The script will automatically detect the active debugging port via `DevToolsActivePort` and hot-inject into all active Antigravity windows.

---

## 📂 Project Structure

* `inject-limits.js` - Quota limits indicator and skin manager.
* `inject-skills.js` - Skill manager UI and local API proxy daemon.
* `inject-turn-rail.js` - Conversation turn rail navigation injector.
* `inject-font.js` - Custom font and typography injector.
* `package.json` - Node.js project metadata and npm scripts.
* `CHANGELOG.md` - Release and version change history.
* `.gitignore` - Git configuration.
* `LICENSE` - Open-source license (MIT).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
