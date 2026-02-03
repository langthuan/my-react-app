# Flow Video Automation - Chrome Extension Setup

## Build Extension

1. Install dependencies:
```bash
npm install
```

2. Build the extension:
```bash
npm run build
```

3. Load extension in Chrome:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `dist` folder from this project

## Usage

1. Click the extension icon to open the popup
2. Enter up to 10 prompts in the textareas
3. Click "Tạo video" to start the automation
4. The extension will:
   - Open the Google Flow page (labs.google/fx/tools/flow)
   - Fill each prompt sequentially
   - Wait for each video to complete before moving to the next
   - Store video URLs for download
5. Click "Download All" to download all completed videos
6. Use "Stop" button to pause the queue at any time
7. Use "Clear All" to reset all prompts

## Features

- ✅ 10 independent prompt inputs
- ✅ Sequential video creation with automatic progression
- ✅ Stop functionality to pause queue
- ✅ Download all videos feature
- ✅ Progress tracking and status updates
- ✅ Automatic form filling and submission
- ✅ Video completion detection

## Technical Notes

- The extension uses content scripts to interact with the Flow page
- Background service worker coordinates between popup and content script
- Video URLs are stored in Chrome's local storage
- The extension requires permissions for tabs, storage, downloads, and scripting

## Troubleshooting

If videos are not being created:
1. Make sure you're on the correct Flow page (labs.google/fx/tools/flow)
2. Check browser console for errors
3. Verify the form selectors match the current Flow page structure
4. The content script may need selector updates if Google changes their UI
