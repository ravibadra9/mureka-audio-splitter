# 🎵 Mureka Audio Splitter - Chrome Extension

> **Download, Split, and Export YouTube Audio Segments with Automatic YouTube Cookie Bypass & Bot-Check Protection.**

Designed with the exact same sleek, dark studio GUI and precision splitting engine as the desktop application.

---

## 🚀 How to Install in Google Chrome

1. Open Google Chrome.
2. In the address bar, type `chrome://extensions/` and hit **Enter**.
3. In the top-right corner, turn **ON** the switch for **Developer mode**.
4. Click the **Load unpacked** button in the top-left corner.
5. Select this folder:
   ```
   C:\Users\admin\Desktop\tools\extension
   ```
6. **Done!** You will see **Mureka Audio Splitter** pinned to your Chrome toolbar with its icon.

---

## ✨ Features & Usage

### 1. 🔑 Automatic YouTube Cookie Bypass (Bypass 403 & Bot Check)
- **Auto Chrome/Edge**: Click the purple **🌐 Auto Chrome/Edge** button to automatically import all active YouTube cookies (`LOGIN_INFO`, `__Secure-3PSID`, `SID`, etc.) directly from your Google Chrome session into the extension.
- **Upload Cookies (.txt / JSON)**: Directly upload exported Netscape cookies files or JSON cookies.
- **Paste & Save**: Paste any cookie token or Netscape text into the input field and click **💾 Save**.
- **⚡ Verify**: Validates that your YouTube session is active and verified to bypass bot-checks and 403 Forbidden errors.

### 2. 🎵 YouTube URL & Local Audio File
- **Download Audio**: Paste any YouTube link (`https://www.youtube.com/watch?v=...`) and click **⬇ Download Audio**.
- **📌 Use Current Tab Video**: Auto-detects the YouTube video currently open in your browser tab.
- **✂ Split in Mureka (On YouTube Pages)**: Adds a 1-click button directly under YouTube videos!
- **Browse Existing File**: Click **Browse…** to load any local audio file (`.mp3`, `.wav`, `.m4a`, `.opus`, `.ogg`, `.flac`, `.aac`) directly from your computer.

### 3. ✂ Precision Segment Splitting
- **＋ Add Row**: Add individual segments manually.
- **📋 Paste & Auto-Parse**: Copy tracklists or timestamp lines from YouTube descriptions, comments, or ChatGPT and click to auto-parse any format!
- **📝 Bulk Paste**: Opens a dedicated modal dialog for pasting and previewing complex tracklists.
- **📋 Format Prompt**: Copies the ChatGPT formatting prompt with 1 click:
  ```
  Please provide the timestamp of these songs in this format:

  Song Title 1 (0:00:00 - 0:03:30)
  Song Title 2 (0:03:30 - 0:06:45)
  Song Title 3 (0:06:45 - 0:10:20)
  ```
- **✂ Split & Export**: Automatically slices each segment and exports in either **320kbps High Quality MP3** or **Lossless WAV**, packaged as a clean ZIP archive or separate files.

### 4. ⚡ Standalone & Optional Companion Bridge
- **100% Standalone in Chrome**: Works entirely inside your browser using the Web Audio API without needing anything else running!
- **Optional Companion Bridge**: If you want the full hardware-accelerated `yt-dlp` + `FFmpeg` processing engine, simply double-click `start_bridge.bat`! The extension will auto-detect it.

---

## 📁 File Structure

- `manifest.json`: Manifest V3 configuration
- `popup.html`: Studio user interface
- `popup.js`: Controller & audio slicing engine
- `background.js`: Service worker & cookie manager
- `content.js`: YouTube page video detector
- `css/style.css`: Studio dark theme styling
- `css/content.css`: Injected YouTube button styling
- `lib/jszip.min.js`: Fast ZIP compressor
- `lib/lame.min.js`: 320kbps MP3 encoder
- `lib/wav-encoder.js`: Lossless 16-bit PCM WAV generator
- `icons/`: Extension icons (16px, 32px, 48px, 128px)
- `bridge.py` & `start_bridge.bat`: Optional high-speed local helper
