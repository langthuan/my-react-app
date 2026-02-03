/**
 * Wrapper for Chrome Extension APIs
 */

// Check if running in Chrome extension context
const isChromeExtension = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id

/**
 * Send message to background service worker
 */
export const sendMessage = (message) => {
  if (!isChromeExtension) {
    console.warn('Not running in Chrome extension context')
    return Promise.reject(new Error('Not in Chrome extension'))
  }
  return chrome.runtime.sendMessage(message)
}

/**
 * Get current active tab
 */
export const getCurrentTab = async () => {
  if (!isChromeExtension) {
    return null
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

/**
 * Open or navigate to Flow page
 */
export const openFlowPage = async () => {
  if (!isChromeExtension) {
    return null
  }
  const flowUrl = 'https://labs.google/fx/tools/flow'
  
  // Check if Flow tab already exists
  const tabs = await chrome.tabs.query({ url: '*://labs.google/fx/tools/flow*' })
  
  if (tabs.length > 0) {
    // Switch to existing tab
    await chrome.tabs.update(tabs[0].id, { active: true })
    return tabs[0]
  } else {
    // Create new tab
    const tab = await chrome.tabs.create({ url: flowUrl })
    return tab
  }
}

/**
 * Storage operations
 */
export const storage = {
  get: async (keys) => {
    if (!isChromeExtension) {
      return {}
    }
    return chrome.storage.local.get(keys)
  },
  
  set: async (items) => {
    if (!isChromeExtension) {
      return
    }
    return chrome.storage.local.set(items)
  },
  
  remove: async (keys) => {
    if (!isChromeExtension) {
      return
    }
    return chrome.storage.local.remove(keys)
  },
  
  clear: async () => {
    if (!isChromeExtension) {
      return
    }
    return chrome.storage.local.clear()
  }
}

/**
 * Download file
 */
export const downloadFile = async (url, filename) => {
  if (!isChromeExtension) {
    console.warn('Download not available outside Chrome extension')
    return
  }
  return chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: false
  })
}

/**
 * Listen for messages from background
 */
export const onMessage = (callback) => {
  if (!isChromeExtension) {
    return () => {}
  }
  chrome.runtime.onMessage.addListener(callback)
  return () => {
    chrome.runtime.onMessage.removeListener(callback)
  }
}
