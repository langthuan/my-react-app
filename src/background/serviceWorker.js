/**
 * Background Service Worker for Chrome Extension
 * Coordinates between popup and content script
 */

const FLOW_URL = 'https://labs.google/fx/tools/flow'
let flowTabId = null
let isProcessing = false
let shouldStop = false
let isCollectingDownloads = false
let nextDownloadIndex = 0
const VIDEO_URLS_KEY = 'videoUrls'

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse)
  return true // Keep channel open for async response
})

// Capture real download URLs when user/content-script triggers downloads
chrome.downloads.onCreated.addListener(async (downloadItem) => {
  try {
    if (!isCollectingDownloads) return
    if (!downloadItem || !downloadItem.url) return

    const data = await chrome.storage.local.get(VIDEO_URLS_KEY)
    const videoUrls = data[VIDEO_URLS_KEY] || []

    const idx = nextDownloadIndex
    nextDownloadIndex += 1

    videoUrls[idx] = {
      url: downloadItem.url,
      timestamp: Date.now(),
      promptIndex: idx,
    }

    await chrome.storage.local.set({ [VIDEO_URLS_KEY]: videoUrls })

    chrome.runtime.sendMessage({
      type: 'VIDEO_COMPLETED',
      promptIndex: idx,
      videoUrl: downloadItem.url,
    }).catch(() => {})
  } catch (e) {
    console.error('downloads.onCreated handler error:', e)
  }
})

async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.type) {
      case 'OPEN_FLOW_PAGE':
        await handleOpenFlowPage()
        sendResponse({ success: true })
        break

      case 'PROCESS_PROMPT':
        await handleProcessPrompt(message.prompt, message.promptIndex)
        sendResponse({ success: true })
        break

      case 'STOP_QUEUE':
        handleStopQueue()
        sendResponse({ success: true })
        break

      case 'COLLECT_ALL_VIDEO_LINKS':
        await handleCollectAllVideoLinks()
        sendResponse({ success: true })
        break

      case 'PROMPT_SUBMITTED':
        // Forward to popup
        chrome.runtime.sendMessage({
          type: 'PROMPT_SUBMITTED',
          promptIndex: message.promptIndex
        }).catch(() => {
          // Popup might be closed, ignore error
        })
        sendResponse({ success: true })
        break

      case 'VIDEO_COMPLETED':
        // Forward to popup
        chrome.runtime.sendMessage({
          type: 'VIDEO_COMPLETED',
          promptIndex: message.promptIndex,
          videoUrl: message.videoUrl
        }).catch(() => {
          // Popup might be closed, ignore error
        })
        sendResponse({ success: true })
        break

      case 'VIDEO_ERROR':
        // Forward to popup
        chrome.runtime.sendMessage({
          type: 'VIDEO_ERROR',
          promptIndex: message.promptIndex,
          error: message.error
        }).catch(() => {
          // Popup might be closed, ignore error
        })
        sendResponse({ success: true })
        break

      case 'STATUS_UPDATE':
        // Forward to popup
        chrome.runtime.sendMessage({
          type: 'STATUS_UPDATE',
          status: message.status
        }).catch(() => {
          // Popup might be closed, ignore error
        })
        sendResponse({ success: true })
        break

      default:
        sendResponse({ success: false, error: 'Unknown message type' })
    }
  } catch (error) {
    console.error('Error handling message:', error)
    sendResponse({ success: false, error: error.message })
  }
}

async function handleOpenFlowPage() {
  try {
    // Check if Flow tab already exists
    const tabs = await chrome.tabs.query({ url: '*://labs.google/fx/tools/flow*' })
    
    if (tabs.length > 0) {
      flowTabId = tabs[0].id
      // Switch to existing tab
      await chrome.tabs.update(flowTabId, { active: true })
    } else {
      // Create new tab
      const tab = await chrome.tabs.create({ url: FLOW_URL })
      flowTabId = tab.id
    }

    // Wait for page to load
    await waitForTabReady(flowTabId)
    
    // Notify popup
    chrome.runtime.sendMessage({
      type: 'STATUS_UPDATE',
      status: 'Đã mở trang Flow'
    }).catch(() => {})
  } catch (error) {
    console.error('Error opening Flow page:', error)
    chrome.runtime.sendMessage({
      type: 'VIDEO_ERROR',
      promptIndex: -1,
      error: `Lỗi mở trang: ${error.message}`
    }).catch(() => {})
  }
}

async function handleProcessPrompt(prompt, promptIndex) {
  if (shouldStop) {
    return
  }

  isProcessing = true

  try {
    if (!flowTabId) {
      await handleOpenFlowPage()
    }

    // Ensure tab is active
    await chrome.tabs.update(flowTabId, { active: true })

    // Wait a bit for page to be ready
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Send message to content script
    const response = await chrome.tabs.sendMessage(flowTabId, {
      type: 'FILL_AND_SUBMIT',
      prompt: prompt,
      promptIndex: promptIndex
    })

    if (!response || !response.success) {
      throw new Error(response?.error || 'Content script failed')
    }
  } catch (error) {
    console.error('Error processing prompt:', error)
    
    // Try to inject content script if it's not loaded
    if (error.message.includes('Could not establish connection')) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: flowTabId },
          files: ['content/flowContentScript.js']
        })
        
        // Retry after injection
        await new Promise(resolve => setTimeout(resolve, 1000))
        await chrome.tabs.sendMessage(flowTabId, {
          type: 'FILL_AND_SUBMIT',
          prompt: prompt,
          promptIndex: promptIndex
        })
      } catch (retryError) {
        chrome.runtime.sendMessage({
          type: 'VIDEO_ERROR',
          promptIndex: promptIndex,
          error: `Lỗi: ${retryError.message}`
        }).catch(() => {})
      }
    } else {
      chrome.runtime.sendMessage({
        type: 'VIDEO_ERROR',
        promptIndex: promptIndex,
        error: `Lỗi: ${error.message}`
      }).catch(() => {})
    }
  } finally {
    isProcessing = false
  }
}

function handleStopQueue() {
  shouldStop = true
  isProcessing = false
  
  // Notify content script to stop
  if (flowTabId) {
    chrome.tabs.sendMessage(flowTabId, {
      type: 'STOP'
    }).catch(() => {
      // Tab might be closed, ignore
    })
  }
}

async function handleCollectAllVideoLinks() {
  try {
    if (!flowTabId) {
      throw new Error('Flow tab not found')
    }

    // reset collection state + storage
    isCollectingDownloads = true
    nextDownloadIndex = 0
    await chrome.storage.local.set({ [VIDEO_URLS_KEY]: [] })

    // Ensure tab is active
    await chrome.tabs.update(flowTabId, { active: true })
    await new Promise(resolve => setTimeout(resolve, 1000))

    chrome.runtime.sendMessage({
      type: 'STATUS_UPDATE',
      status: 'Đang click nút Download trên Flow để lấy link thật...',
    }).catch(() => {})

    // Send message to content script to trigger downloads (we capture URLs via downloads.onCreated)
    await chrome.tabs.sendMessage(flowTabId, {
      type: 'COLLECT_ALL_VIDEO_LINKS'
    })
  } catch (error) {
    console.error('Error collecting video links:', error)
    chrome.runtime.sendMessage({
      type: 'VIDEO_ERROR',
      promptIndex: -1,
      error: `Lỗi khi lấy link: ${error.message}`
    }).catch(() => {})
  }
}

function waitForTabReady(tabId) {
  return new Promise((resolve) => {
    const checkReady = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          setTimeout(checkReady, 500)
          return
        }
        if (tab.status === 'complete') {
          resolve()
        } else {
          setTimeout(checkReady, 500)
        }
      })
    }
    checkReady()
  })
}

// Reset stop flag when new queue starts
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'OPEN_FLOW_PAGE') {
    shouldStop = false
  }
})
