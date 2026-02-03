/**
 * Content Script for Google Flow page
 * Handles form filling, submission, and video completion detection
 */

let isProcessing = false
let shouldStop = false
let currentPromptIndex = -1

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse)
  return true // Keep channel open for async response
})

async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.type) {
      case 'FILL_AND_SUBMIT':
        await handleFillAndSubmit(message.prompt, message.promptIndex)
        sendResponse({ success: true })
        break

      case 'STOP':
        handleStop()
        sendResponse({ success: true })
        break

      case 'COLLECT_ALL_VIDEO_LINKS':
        await handleCollectAllVideoLinks()
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

function handleStop() {
  shouldStop = true
  isProcessing = false
}

async function handleFillAndSubmit(prompt, promptIndex) {
  if (shouldStop) {
    return
  }

  isProcessing = true
  currentPromptIndex = promptIndex

  try {
    // Wait for page to be ready
    await waitForPageReady()

    // Find and fill the text input/textarea
    const filled = await fillPrompt(prompt)
    if (!filled) {
      throw new Error('Không tìm thấy ô nhập prompt')
    }

    // Wait longer after filling to ensure form is ready and button is enabled
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Find and click submit button
    const submitted = await submitForm(prompt)
    if (!submitted) {
      throw new Error('Không tìm thấy nút submit')
    }

    // Notify background that prompt has been submitted
    chrome.runtime.sendMessage({
      type: 'STATUS_UPDATE',
      status: `Đã submit prompt ${promptIndex + 1}/10. Đợi 2 phút trước khi chạy prompt tiếp theo...`
    }).catch(() => {})

    // Notify that prompt was submitted successfully (không đợi video completion)
    chrome.runtime.sendMessage({
      type: 'PROMPT_SUBMITTED',
      promptIndex: promptIndex
    }).catch(() => {})
  } catch (error) {
    console.error('Error in fill and submit:', error)
    chrome.runtime.sendMessage({
      type: 'VIDEO_ERROR',
      promptIndex: promptIndex,
      error: error.message
    }).catch(() => {})
  } finally {
    isProcessing = false
  }
}

async function waitForPageReady() {
  let attempts = 0
  const maxAttempts = 20

  while (attempts < maxAttempts) {
    if (shouldStop) return

    // Check if page is loaded
    if (document.readyState === 'complete') {
      // Wait a bit more for React to render
      await new Promise(resolve => setTimeout(resolve, 1000))
      return
    }
    await new Promise(resolve => setTimeout(resolve, 500))
    attempts++
  }
}

async function fillPrompt(prompt) {
  console.log('Attempting to fill prompt:', prompt)
  
  // Try multiple selectors to find the prompt input
  const selectors = [
    'textarea[placeholder*="prompt" i]',
    'textarea[placeholder*="text" i]',
    'textarea[aria-label*="prompt" i]',
    'textarea[aria-label*="text" i]',
    'textarea[aria-label*="video" i]',
    'input[type="text"][placeholder*="prompt" i]',
    'textarea',
    'input[type="text"]',
    '[contenteditable="true"]',
    'div[role="textbox"]',
    '[data-testid*="prompt" i]',
    '[data-testid*="input" i]'
  ]

  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector)
    console.log(`Trying selector "${selector}", found ${elements.length} elements`)
    
    for (const element of elements) {
      // Skip if element is hidden or not visible
      if (element.offsetParent === null) {
        console.log('Element is hidden, skipping')
        continue
      }

      // Check if element is in viewport or scrollable
      const rect = element.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        // Scroll element into view
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        await new Promise(resolve => setTimeout(resolve, 300))
      }

      try {
        // Focus the element first
        element.focus()
        await new Promise(resolve => setTimeout(resolve, 200))

        if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
          // Clear existing value
          element.value = ''
          element.dispatchEvent(new Event('input', { bubbles: true }))
          
          // Set new value
          element.value = prompt
          
          // Trigger multiple events to ensure React/other frameworks detect the change
          element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))
          element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }))
          element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }))
          element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }))
          
          // Also try setting value via setter
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(element, prompt)
          element.dispatchEvent(new Event('input', { bubbles: true }))
          
        } else if (element.isContentEditable || element.contentEditable === 'true' || element.getAttribute('contenteditable') === 'true') {
          // For contenteditable elements
          element.textContent = ''
          element.textContent = prompt
          element.innerText = prompt
          
          // Trigger input event
          element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))
          element.dispatchEvent(new Event('textInput', { bubbles: true }))
        }
        
        // Blur and focus again to trigger validation
        element.blur()
        await new Promise(resolve => setTimeout(resolve, 100))
        element.focus()
        await new Promise(resolve => setTimeout(resolve, 200))
        
        // Verify value was set
        const currentValue = element.value || element.textContent || element.innerText
        if (currentValue.includes(prompt.substring(0, 10))) {
          console.log('Successfully filled prompt into element')
          return true
        }
      } catch (error) {
        console.warn('Error filling element:', error)
      }
    }
  }

  console.error('Failed to find or fill prompt input')
  return false
}

async function submitForm(prompt) {
  console.log('Attempting to find and click submit button')
  
  // First, try pressing Enter key on the textarea/input (common way to submit)
  const textareas = document.querySelectorAll('textarea, input[type="text"]')
  for (const textarea of textareas) {
    const value = textarea.value || textarea.textContent || textarea.innerText
    if (value && value.includes(prompt.substring(0, 10))) {
      console.log('Trying Enter key on textarea')
      textarea.focus()
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Try Enter key
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      })
      textarea.dispatchEvent(enterEvent)
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Also try Ctrl+Enter (common for multi-line inputs)
      const ctrlEnterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
      textarea.dispatchEvent(ctrlEnterEvent)
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  
  // Wait a bit for button to appear/enable after Enter key
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  // Get all potential buttons
  const allButtons = Array.from(document.querySelectorAll('button, [role="button"], [type="button"], [type="submit"], a[role="button"]'))
  console.log(`Found ${allButtons.length} potential buttons`)
  
  // Priority keywords for submit buttons
  const submitKeywords = ['create', 'generate', 'submit', 'tạo', 'go', 'run', 'start', 'make', 'video']
  
  // Find the textarea/input that was filled
  let filledElement = null
  for (const textarea of textareas) {
    const value = textarea.value || textarea.textContent || textarea.innerText
    if (value && value.includes(prompt.substring(0, 10))) {
      filledElement = textarea
      break
    }
  }
  
  // Try to find button by text content first
  for (const button of allButtons) {
    if (button.offsetParent === null) continue
    
    const text = (button.textContent || '').toLowerCase().trim()
    const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase()
    const title = (button.getAttribute('title') || '').toLowerCase()
    const dataTestId = (button.getAttribute('data-testid') || '').toLowerCase()
    const className = (button.className || '').toLowerCase()
    const id = (button.id || '').toLowerCase()
    
    // Check if button contains submit keywords
    const hasSubmitKeyword = submitKeywords.some(keyword => 
      text.includes(keyword) || 
      ariaLabel.includes(keyword) || 
      title.includes(keyword) ||
      dataTestId.includes(keyword) ||
      className.includes(keyword) ||
      id.includes(keyword)
    )
    
    // Check if button is near the filled input (higher priority)
    let isNearInput = false
    if (filledElement) {
      const buttonRect = button.getBoundingClientRect()
      const inputRect = filledElement.getBoundingClientRect()
      const distance = Math.abs(buttonRect.top - inputRect.bottom)
      isNearInput = distance < 500 // Within 500px
    }
    
    // Also check for disabled state - skip if disabled
    const isDisabled = button.disabled || 
                      button.getAttribute('aria-disabled') === 'true' ||
                      button.classList.contains('disabled') ||
                      button.hasAttribute('disabled') ||
                      button.style.pointerEvents === 'none'
    
    // Prioritize buttons with submit keywords or near input
    if ((hasSubmitKeyword || isNearInput) && !isDisabled) {
      try {
        console.log('Found potential submit button:', { text, ariaLabel, title, isNearInput, hasSubmitKeyword })
        
        // Scroll button into view
        button.scrollIntoView({ behavior: 'smooth', block: 'center' })
        await new Promise(resolve => setTimeout(resolve, 500))
        
        // Try multiple click methods
        // Method 1: Focus and click
        button.focus()
        await new Promise(resolve => setTimeout(resolve, 200))
        
        // Method 2: Mouse events
        const mouseOverEvent = new MouseEvent('mouseover', { bubbles: true, cancelable: true })
        const mouseEnterEvent = new MouseEvent('mouseenter', { bubbles: true, cancelable: true })
        button.dispatchEvent(mouseOverEvent)
        button.dispatchEvent(mouseEnterEvent)
        await new Promise(resolve => setTimeout(resolve, 100))
        
        const mouseDownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
        const mouseUpEvent = new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 })
        const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
        
        button.dispatchEvent(mouseDownEvent)
        await new Promise(resolve => setTimeout(resolve, 50))
        button.dispatchEvent(mouseUpEvent)
        await new Promise(resolve => setTimeout(resolve, 50))
        button.dispatchEvent(clickEvent)
        await new Promise(resolve => setTimeout(resolve, 100))
        
        // Method 3: Direct click
        button.click()
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        // Method 4: If button has form, try submitting form
        const form = button.closest('form')
        if (form) {
          try {
            form.requestSubmit(button)
            await new Promise(resolve => setTimeout(resolve, 500))
          } catch (e) {
            // requestSubmit might not be supported, try submit
            try {
              form.submit()
              await new Promise(resolve => setTimeout(resolve, 500))
            } catch (e2) {
              console.warn('Form submit failed:', e2)
            }
          }
        }
        
        // Method 5: Try pointer events
        if (button.onclick) {
          button.onclick()
          await new Promise(resolve => setTimeout(resolve, 500))
        }
        
        console.log('Successfully attempted to click submit button')
        return true
      } catch (error) {
        console.warn('Error clicking button:', error)
      }
    }
  }
  
  // Fallback: Try to find any enabled button near the textarea
  if (filledElement) {
    const inputRect = filledElement.getBoundingClientRect()
    for (const button of allButtons) {
      if (button.offsetParent === null) continue
      if (button.disabled) continue
      
      const buttonRect = button.getBoundingClientRect()
      const distance = Math.abs(buttonRect.top - inputRect.bottom)
      
      // If button is below the input and within reasonable distance
      if (buttonRect.top > inputRect.bottom && distance < 300) {
        try {
          console.log('Trying nearby button as fallback')
          button.scrollIntoView({ behavior: 'smooth', block: 'center' })
          await new Promise(resolve => setTimeout(resolve, 300))
          button.focus()
          button.click()
          await new Promise(resolve => setTimeout(resolve, 1500))
          return true
        } catch (error) {
          console.warn('Nearby button click failed:', error)
        }
      }
    }
  }

  console.error('Failed to find or click submit button')
  return false
}

async function waitForVideoCompletion() {
  return new Promise((resolve) => {
    let attempts = 0
    const maxAttempts = 180 // 3 minutes max (180 * 1 second) - đủ thời gian để video tạo xong
    const checkInterval = 1000 // Check every second
    let foundVideoUrl = null
    let videoFoundTime = null
    const STABILIZATION_TIME = 10000 // Đợi thêm 10 giây sau khi tìm thấy video để đảm bảo link ổn định

    const checkForVideo = setInterval(() => {
      if (shouldStop) {
        clearInterval(checkForVideo)
        resolve(null)
        return
      }

      attempts++

      // Try to find video element or download button
      const videoUrl = findVideoUrl()

      if (videoUrl && videoUrl !== foundVideoUrl) {
        // Tìm thấy video mới
        foundVideoUrl = videoUrl
        videoFoundTime = Date.now()
        
        // Notify background about progress
        chrome.runtime.sendMessage({
          type: 'STATUS_UPDATE',
          status: 'Đã tìm thấy video, đang đợi link ổn định...'
        }).catch(() => {})
      }

      // Nếu đã tìm thấy video, đợi thêm một chút để đảm bảo link ổn định
      if (foundVideoUrl && videoFoundTime) {
        const timeSinceFound = Date.now() - videoFoundTime
        if (timeSinceFound >= STABILIZATION_TIME) {
          clearInterval(checkForVideo)
          observer.disconnect()
          resolve(foundVideoUrl)
          return
        }
      }

      // Check for error indicators
      const errorElements = document.querySelectorAll(
        '[class*="error" i], [class*="failed" i], [aria-label*="error" i]'
      )
      if (errorElements.length > 0 && attempts > 30) {
        clearInterval(checkForVideo)
        observer.disconnect()
        resolve(null)
        return
      }

      if (attempts >= maxAttempts) {
        clearInterval(checkForVideo)
        observer.disconnect()
        // Nếu đã tìm thấy video nhưng chưa đủ thời gian, vẫn trả về
        resolve(foundVideoUrl)
        return
      }
    }, checkInterval)

    // Also use MutationObserver to watch for DOM changes
    const observer = new MutationObserver(() => {
      const videoUrl = findVideoUrl()
      if (videoUrl && videoUrl !== foundVideoUrl) {
        foundVideoUrl = videoUrl
        videoFoundTime = Date.now()
        
        chrome.runtime.sendMessage({
          type: 'STATUS_UPDATE',
          status: 'Đã tìm thấy video, đang đợi link ổn định...'
        }).catch(() => {})
      }
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true
    })
  })
}

function findVideoUrl() {
  // Try to find video element with src
  const videoElements = document.querySelectorAll('video')
  for (const video of videoElements) {
    if (video.src && video.src !== 'about:blank' && !video.src.startsWith('blob:')) {
      console.log('Found video element with src:', video.src)
      return video.src
    }
    // Also check currentSrc
    if (video.currentSrc && video.currentSrc !== 'about:blank' && !video.currentSrc.startsWith('blob:')) {
      console.log('Found video element with currentSrc:', video.currentSrc)
      return video.currentSrc
    }
  }

  // Try to find source elements inside video
  const sourceElements = document.querySelectorAll('video source')
  for (const source of sourceElements) {
    if (source.src && !source.src.startsWith('blob:')) {
      console.log('Found video source with src:', source.src)
      return source.src
    }
  }

  // Try to find download button/link
  const downloadSelectors = [
    'a[download]',
    'a[href*=".mp4"]',
    'a[href*=".webm"]',
    'a[href*="video"]',
    'button[aria-label*="download" i]',
    'a[aria-label*="download" i]',
    '[data-testid*="download" i]',
    '[data-testid*="video" i]'
  ]

  for (const selector of downloadSelectors) {
    const elements = document.querySelectorAll(selector)
    for (const element of elements) {
      const href = element.href || element.getAttribute('href')
      if (href && (href.includes('.mp4') || href.includes('.webm') || href.includes('video'))) {
        console.log('Found download link:', href)
        return href
      }
    }
  }

  // Try to find video in iframe
  const iframes = document.querySelectorAll('iframe')
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
      if (iframeDoc) {
        const video = iframeDoc.querySelector('video')
        if (video?.src && !video.src.startsWith('blob:')) {
          console.log('Found video in iframe:', video.src)
          return video.src
        }
      }
    } catch (e) {
      // Cross-origin, skip
    }
  }

  // Look for data attributes or other indicators
  const dataSelectors = [
    '[data-video-url]',
    '[data-src*="video"]',
    '[data-url*="video"]',
    '[data-video]',
    '[data-src]'
  ]
  
  for (const selector of dataSelectors) {
    const elements = document.querySelectorAll(selector)
    for (const element of elements) {
      const url = element.getAttribute('data-video-url') || 
                  element.getAttribute('data-url') ||
                  element.getAttribute('data-src') ||
                  element.getAttribute('data-video')
      if (url && (url.includes('.mp4') || url.includes('.webm') || url.includes('video'))) {
        console.log('Found video URL in data attribute:', url)
        return url
      }
    }
  }

  // Try to find canvas that might contain video data
  const canvases = document.querySelectorAll('canvas')
  for (const canvas of canvases) {
    try {
      const dataUrl = canvas.toDataURL('video/webm')
      if (dataUrl && dataUrl !== 'data:,') {
        // This is a fallback, might not work for actual video files
        console.log('Found canvas with video data')
      }
    } catch (e) {
      // Skip
    }
  }

  // Look for video URLs in script tags or JSON-LD
  const scripts = document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]')
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent)
      const videoUrl = findVideoUrlInObject(data)
      if (videoUrl) {
        console.log('Found video URL in JSON:', videoUrl)
        return videoUrl
      }
    } catch (e) {
      // Skip invalid JSON
    }
  }

  return null
}

function findVideoUrlInObject(obj) {
  if (typeof obj !== 'object' || obj === null) return null
  
  for (const key in obj) {
    if (key.toLowerCase().includes('video') || key.toLowerCase().includes('url') || key.toLowerCase().includes('src')) {
      const value = obj[key]
      if (typeof value === 'string' && (value.includes('.mp4') || value.includes('.webm') || value.includes('video'))) {
        return value
      }
    }
    if (typeof obj[key] === 'object') {
      const found = findVideoUrlInObject(obj[key])
      if (found) return found
    }
  }
  return null
}

async function handleCollectAllVideoLinks() {
  try {
    console.log('Starting to collect all video links by clicking Download buttons')
    chrome.runtime.sendMessage({
      type: 'STATUS_UPDATE',
      status: 'Đang tìm nút Download và click để Chrome tạo download (lấy link thật)...'
    }).catch(() => {})

    // Scroll to load lazy content (simple)
    window.scrollTo(0, 0)
    await new Promise(resolve => setTimeout(resolve, 800))
    window.scrollTo(0, document.documentElement.scrollHeight)
    await new Promise(resolve => setTimeout(resolve, 1200))
    window.scrollTo(0, 0)
    await new Promise(resolve => setTimeout(resolve, 800))

    // Find download buttons/links and click them sequentially.
    const candidates = Array.from(document.querySelectorAll('a, button, [role="button"]'))
      .filter((el) => el && el.offsetParent !== null)

    const isDownloadEl = (el) => {
      const text = (el.textContent || '').toLowerCase()
      const aria = (el.getAttribute('aria-label') || '').toLowerCase()
      const title = (el.getAttribute('title') || '').toLowerCase()
      const href = (el.getAttribute('href') || '').toLowerCase()
      const dt = (el.getAttribute('data-testid') || '').toLowerCase()
      return (
        text.includes('download') ||
        aria.includes('download') ||
        title.includes('download') ||
        dt.includes('download') ||
        href.includes('.mp4') ||
        href.includes('.webm')
      )
    }

    const downloadEls = candidates.filter(isDownloadEl)
    console.log(`Found ${downloadEls.length} download candidates`)

    if (downloadEls.length === 0) {
      chrome.runtime.sendMessage({
        type: 'VIDEO_ERROR',
        promptIndex: -1,
        error: 'Không tìm thấy nút/link Download trên trang Flow (có thể UI thay đổi hoặc chưa có video ready)',
      }).catch(() => {})
      return
    }

    const max = Math.min(10, downloadEls.length)
    for (let i = 0; i < max; i++) {
      if (shouldStop) return
      const el = downloadEls[i]
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        await new Promise(resolve => setTimeout(resolve, 400))

        chrome.runtime.sendMessage({
          type: 'STATUS_UPDATE',
          status: `Đang click Download ${i + 1}/${max}...`,
        }).catch(() => {})

        // If it's an <a href>, click should trigger download; otherwise click button.
        el.click()
        await new Promise(resolve => setTimeout(resolve, 1200))
      } catch (e) {
        console.warn('Download click failed:', e)
      }
    }

    chrome.runtime.sendMessage({
      type: 'STATUS_UPDATE',
      status: `Đã click ${max} nút Download. Đang đợi Chrome ghi nhận downloads để lấy link...`
    }).catch(() => {})
  } catch (error) {
    console.error('Error collecting video links:', error)
    chrome.runtime.sendMessage({
      type: 'VIDEO_ERROR',
      promptIndex: -1,
      error: `Lỗi khi lấy link: ${error.message}`
    }).catch(() => {})
  }
}

// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('Flow Content Script loaded')
  })
} else {
  console.log('Flow Content Script loaded')
}
