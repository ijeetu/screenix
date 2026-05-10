# Screenix

Screenix is a lightweight Chrome extension for website screenshots.

Features:

- current screen capture
- full-page auto-scroll capture
- export as `PNG`, `JPG`, `WEBP`, or `PDF`
- automatic download after capture
- compact popup UI

## Install

1. Clone or download this repository
2. Open `chrome://extensions`
3. Enable `Developer mode`
4. Click `Load unpacked`
5. Select the project folder

## Notes

- `Current` captures the visible viewport instantly.
- `Full` scrolls the page and stitches one image.
- `PDF` export is generated as paginated A4 pages from the stitched image.
- Some internal Chrome pages like `chrome://extensions` cannot be captured.
- For `file://` pages, Chrome may require enabling local file access for the extension.

## Project Structure

- `manifest.json` - Chrome extension manifest
- `popup.html`, `popup.css`, `popup.js` - popup UI
- `background.js` - capture, stitching, export, and download flow
- `page.js` - in-page helper for full-page capture
- `offscreen.html`, `offscreen.js`, `blob-store.js` - offscreen download support for MV3
