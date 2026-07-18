# Antigravity Plus

[English](README.md) | [简体中文](README_zh.md)

A lightweight, zero-dependency injector for UI customizations and enhancements in **Antigravity 2.0**. 

Currently features real-time **Weekly Limit** and **5-Hour Limit** indicators next to the model selector in the chat input bar, dynamically synchronized with the local gRPC backend daemon.

---

## 📸 Preview

### 1. Limits Indicator on Input Bar
![Limits Indicator on Input Bar](assets/preview.png)

### 2. Detailed Hover Tooltip Card
![Detailed Hover Tooltip Card](assets/hover.png)

---

## ✨ Features

*   **Clean Inline Layout**: Positioned gracefully to the right of the model selector in the bottom toolbar flex row—never wraps, keeping the workspace neat and tidy.
*   **Real-time Quota Sync**: Safely reads the local CSRF token to poll the Go backend gRPC-web endpoint (`RetrieveUserQuotaSummary`) every 5 seconds, displaying your exact remaining usage fractions.
*   **Auto Group Detection**: Automatically detects the active model group (e.g. Gemini Models vs. Claude & GPT Models) and switches to display the correct quota buckets dynamically when you switch models in the client.
*   **Dynamic Status Dots**: Glowing indicators transition colors automatically based on remaining capacity (Green for safe, Orange for warnings, Red for critical).
*   **Interactive Tooltip Card**: Hovering over the pills reveals a sleek, modern glassmorphic (blurred background) card displaying detailed usage percentages, progress bars, and countdowns to the next quota reset (e.g. "1 day 11 hours left").

---

## 🛠️ Prerequisites

*   **Node.js v22.0.0 or later**: The injector uses native global `WebSocket` and `fetch` APIs to keep the script 100% lightweight and dependency-free (no need to run `npm install`).
*   **Antigravity 2.0** desktop client running.

---

## 🚀 Getting Started

1.  Make sure your **Antigravity 2.0** client is running.
2.  Open your terminal in the project root directory and run:
    ```bash
    node inject.js
    ```
3.  The script will automatically detect the active debugging port via `DevToolsActivePort` and hot-inject the limits interface into all active chat windows.

---

## 📂 Project Structure

*   `inject.js` - Core injector script that handles OS detection, port discovery, and DOM injection.
*   `package.json` - Node.js project metadata and start scripts.
*   `.gitignore` - Git configuration to ignore local dependency and active port logs.
*   `LICENSE` - Open-source license (MIT).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
