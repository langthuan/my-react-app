/**
 * Content Script for Google Flow page
 * Handles form filling, submission, and video completion detection
 */

let isProcessing = false
let shouldStop = false
let currentPromptIndex = -1

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle sync messages immediately
  if (message.type === 'PING') {
    sendResponse({ success: true, ready: true })
    return false
  }

  if (message.type === 'STOP') {
    handleStop()
    sendResponse({ success: true })
    return false
  }

  // Handle async messages
  handleMessage(message, sender, sendResponse)
    .then(() => {
      // Response already sent in handleMessage
    })
    .catch((error) => {
      console.error('Error in message handler:', error)
      sendResponse({ success: false, error: error.message })
    })

  return true // Keep channel open for async response
})

async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.type) {
      case 'FILL_AND_SUBMIT':
        await handleFillAndSubmit(message.prompt, message.promptIndex)
        sendResponse({ success: true })
        break

      case 'COLLECT_ALL_VIDEO_LINKS':
        // Don't await this as it's a long-running operation
        // Send response immediately to acknowledge receipt
        sendResponse({ success: true, message: 'Started collecting video links' })
        
        // Run the operation in background
        handleCollectAllVideoLinks()
          .then(() => {
            // Operation completed, but response already sent
            console.log('Video collection completed')
          })
          .catch((error) => {
            console.error('Error in video collection:', error)
            // Send error status update
            chrome.runtime.sendMessage({
              type: 'VIDEO_ERROR',
              promptIndex: -1,
              error: error.message
            }).catch(() => {})
          })
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
      status: 'Đang tìm tất cả video và download từng video...'
    }).catch(() => {})

    // Scroll to top first to ensure we can find all videos
    window.scrollTo(0, 0)
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Scroll through page to load all lazy-loaded videos
    // Scroll nhiều lần để đảm bảo tất cả video được load
    let previousScrollHeight = 0
    let scrollAttempts = 0
    const maxScrollAttempts = 10
    
    while (scrollAttempts < maxScrollAttempts) {
      const currentScrollHeight = document.documentElement.scrollHeight
      const scrollPosition = document.documentElement.scrollTop
      const clientHeight = document.documentElement.clientHeight
      const maxScroll = currentScrollHeight - clientHeight
      
      // Scroll đến cuối trang
      window.scrollTo(0, currentScrollHeight)
      await new Promise(resolve => setTimeout(resolve, 800))
      
      // Kiểm tra xem có thêm nội dung được load không
      const newScrollHeight = document.documentElement.scrollHeight
      if (newScrollHeight === previousScrollHeight && scrollPosition >= maxScroll - 100) {
        // Không có thêm nội dung, đã scroll đến cuối
        break
      }
      
      previousScrollHeight = newScrollHeight
      scrollAttempts++
    }
    
    // Scroll lại từ đầu đến cuối một lần nữa để đảm bảo
    console.log('Scroll lại từ đầu đến cuối để đảm bảo tất cả video được load...')
    window.scrollTo(0, 0)
    await new Promise(resolve => setTimeout(resolve, 500))
    
    let scrollPosition = 0
    const scrollStep = 300
    const maxScroll = document.documentElement.scrollHeight
    
    while (scrollPosition < maxScroll) {
      window.scrollTo(0, scrollPosition)
      await new Promise(resolve => setTimeout(resolve, 400))
      scrollPosition += scrollStep
    }
    
    // Scroll đến cuối cùng một lần nữa để đảm bảo video cuối cùng được load
    window.scrollTo(0, document.documentElement.scrollHeight)
    await new Promise(resolve => setTimeout(resolve, 1500)) // Đợi lâu hơn để video cuối cùng load
    
    // Scroll lại một chút để trigger lazy loading nếu cần
    window.scrollTo(0, document.documentElement.scrollHeight - 100)
    await new Promise(resolve => setTimeout(resolve, 500))
    window.scrollTo(0, document.documentElement.scrollHeight)
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Scroll back to top
    window.scrollTo(0, 0)
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Find all video elements on the page (after scrolling to load them)
    console.log('\n=== Bắt đầu tìm tất cả video trên trang ===')
    
    // Tìm videos nhiều lần để đảm bảo không bỏ sót video cuối cùng
    let allVideos = Array.from(document.querySelectorAll('video'))
    let previousVideoCount = 0
    let findAttempts = 0
    const maxFindAttempts = 3
    
    while (findAttempts < maxFindAttempts) {
      const currentVideos = Array.from(document.querySelectorAll('video'))
      if (currentVideos.length === previousVideoCount && previousVideoCount > 0) {
        // Số lượng video không thay đổi, đã tìm đủ
        allVideos = currentVideos
        break
      }
      
      // Scroll lại đến cuối để trigger load
      if (findAttempts > 0) {
        window.scrollTo(0, document.documentElement.scrollHeight)
        await new Promise(resolve => setTimeout(resolve, 1000))
        allVideos = Array.from(document.querySelectorAll('video'))
      }
      
      previousVideoCount = allVideos.length
      findAttempts++
    }
    
    console.log(`Tìm thấy tổng cộng ${allVideos.length} video elements trên trang`)
    
    const videos = allVideos.filter((video, index) => {
      // Check if video is visible and has meaningful dimensions
      const rect = video.getBoundingClientRect()
      const isValid = (
        video.offsetParent !== null &&
        rect.width > 50 &&
        rect.height > 50
      )
      
      if (isValid) {
        console.log(`  Video ${index + 1}: Kích thước ${Math.round(rect.width)}x${Math.round(rect.height)}px, vị trí (${Math.round(rect.left)}, ${Math.round(rect.top)})`)
      }
      
      return isValid
    })
    
    console.log(`✅ Tìm thấy ${videos.length} video hợp lệ để xử lý\n`)

    if (videos.length === 0) {
      chrome.runtime.sendMessage({
        type: 'VIDEO_ERROR',
        promptIndex: -1,
        error: 'Không tìm thấy video nào trên trang (có thể chưa có video được tạo)',
      }).catch(() => {})
      return
    }

    // Process each video sequentially
    console.log(`\n=== BẮT ĐẦU XỬ LÝ ${videos.length} VIDEO ===`)
    for (let i = 0; i < videos.length; i++) {
      if (shouldStop) {
        console.log(`⚠️ Đã dừng, bỏ qua ${videos.length - i} video còn lại`)
        return
      }
      
      const video = videos[i]
      const isLastVideo = (i === videos.length - 1)
      let keepMenuInterval = null // Declare outside try block so it can be cleared in catch
      
      try {
        console.log(`\n=== Bắt đầu xử lý video ${i + 1}/${videos.length} ${isLastVideo ? '(VIDEO CUỐI CÙNG)' : ''} ===`)
        chrome.runtime.sendMessage({
          type: 'STATUS_UPDATE',
          status: `Đang xử lý video ${i + 1}/${videos.length}${isLastVideo ? ' (video cuối cùng)' : ''}...`,
        }).catch(() => {})
        
        // Đối với video cuối cùng, đảm bảo scroll đến đúng vị trí
        if (isLastVideo) {
          console.log(`[Video ${i + 1}] ⚠️ Đây là video cuối cùng, đảm bảo scroll đến đúng vị trí...`)
          window.scrollTo(0, document.documentElement.scrollHeight)
          await new Promise(resolve => setTimeout(resolve, 1000))
        }

        // Step 1: Scroll to video
        console.log(`[Video ${i + 1}] Đang scroll đến video...`)
        video.scrollIntoView({ behavior: 'smooth', block: 'center' })
        await new Promise(resolve => setTimeout(resolve, 800))
        console.log(`[Video ${i + 1}] Đã scroll đến video`)

        // Step 2: Mouse over the video
        console.log(`[Video ${i + 1}] Đang mouse over vào video...`)
        const mouseOverEvent = new MouseEvent('mouseover', {
          bubbles: true,
          cancelable: true,
          view: window
        })
        const mouseEnterEvent = new MouseEvent('mouseenter', {
          bubbles: true,
          cancelable: true,
          view: window
        })
        video.dispatchEvent(mouseOverEvent)
        video.dispatchEvent(mouseEnterEvent)
        await new Promise(resolve => setTimeout(resolve, 500))
        console.log(`[Video ${i + 1}] Đã mouse over vào video`)

        // Step 3: Find download button near the video
        console.log(`[Video ${i + 1}] Đang tìm nút download...`)
        const downloadButton = findDownloadButtonNearVideo(video)
        
        if (!downloadButton) {
          console.warn(`[Video ${i + 1}] ❌ KHÔNG TÌM THẤY nút download cho video này`)
          chrome.runtime.sendMessage({
            type: 'STATUS_UPDATE',
            status: `Video ${i + 1}/${videos.length}: Không tìm thấy nút download, bỏ qua...`,
          }).catch(() => {})
          continue
        }

        // Log thông tin về download button
        const buttonText = downloadButton.textContent || downloadButton.getAttribute('aria-label') || 'N/A'
        const buttonTag = downloadButton.tagName
        const buttonClass = downloadButton.className || 'N/A'
        const buttonId = downloadButton.id || 'N/A'
        console.log(`[Video ${i + 1}] ✅ ĐÃ TÌM THẤY nút download:`)
        console.log(`  - Tag: ${buttonTag}`)
        console.log(`  - ID: "${buttonId}"`)
        console.log(`  - Text/Label: "${buttonText.trim()}"`)
        console.log(`  - Class: ${buttonClass}`)
        
        chrome.runtime.sendMessage({
          type: 'STATUS_UPDATE',
          status: `Video ${i + 1}/${videos.length}: Đã tìm thấy nút download (id: ${buttonId}), đang click...`,
        }).catch(() => {})

        // Step 3: Click the download button immediately
        console.log(`[Video ${i + 1}] Đang scroll đến nút download...`)
        downloadButton.scrollIntoView({ behavior: 'smooth', block: 'center' })
        await new Promise(resolve => setTimeout(resolve, 800))
        
        // Check if button is disabled
        const isDisabled = downloadButton.disabled || 
                          downloadButton.getAttribute('aria-disabled') === 'true' ||
                          downloadButton.classList.contains('disabled') ||
                          downloadButton.hasAttribute('disabled')
        
        if (isDisabled) {
          console.warn(`[Video ${i + 1}] ⚠️ Button bị disabled, không thể click`)
          chrome.runtime.sendMessage({
            type: 'STATUS_UPDATE',
            status: `Video ${i + 1}/${videos.length}: Button download bị disabled, bỏ qua...`,
          }).catch(() => {})
          continue
        }
        
        // Get button position for accurate clicking
        const buttonRect = downloadButton.getBoundingClientRect()
        const buttonCenterX = buttonRect.left + buttonRect.width / 2
        const buttonCenterY = buttonRect.top + buttonRect.height / 2
        console.log(`[Video ${i + 1}] Button position: (${Math.round(buttonCenterX)}, ${Math.round(buttonCenterY)}), size: ${Math.round(buttonRect.width)}x${Math.round(buttonRect.height)}`)
        console.log(`[Video ${i + 1}] Button disabled: ${isDisabled}`)
        
        // Click the download button with multiple methods
        console.log(`[Video ${i + 1}] Bắt đầu click vào nút download...`)
        
        // Method 1: Focus and ensure button is ready
        downloadButton.focus()
        await new Promise(resolve => setTimeout(resolve, 300))
        console.log(`[Video ${i + 1}] Method 1: Đã focus button`)
        
        // Method 2: Hover over button first (important for some UI frameworks)
        console.log(`[Video ${i + 1}] Method 2: Đang hover vào button...`)
        const mouseOver = new MouseEvent('mouseover', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: buttonCenterX,
          clientY: buttonCenterY,
          relatedTarget: null
        })
        const mouseEnter = new MouseEvent('mouseenter', {
          bubbles: true,
          cancelable: true,
          view: window
        })
        const mouseMove = new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: buttonCenterX,
          clientY: buttonCenterY
        })
        
        downloadButton.dispatchEvent(mouseMove)
        downloadButton.dispatchEvent(mouseOver)
        downloadButton.dispatchEvent(mouseEnter)
        await new Promise(resolve => setTimeout(resolve, 300))
        console.log(`[Video ${i + 1}] Method 2: Đã hover vào button`)
        
        // Method 3: Try pointer events (for modern frameworks)
        console.log(`[Video ${i + 1}] Method 3: Đang thử pointer events...`)
        try {
          const pointerOver = new PointerEvent('pointerover', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: buttonCenterX,
            clientY: buttonCenterY,
            pointerId: 1,
            pointerType: 'mouse'
          })
          const pointerEnter = new PointerEvent('pointerenter', {
            bubbles: true,
            cancelable: true,
            view: window,
            pointerId: 1,
            pointerType: 'mouse'
          })
          downloadButton.dispatchEvent(pointerOver)
          downloadButton.dispatchEvent(pointerEnter)
          await new Promise(resolve => setTimeout(resolve, 200))
        } catch (e) {
          console.warn(`[Video ${i + 1}] Pointer events không được hỗ trợ:`, e)
        }
        
        // Method 4: Mouse down and up
        console.log(`[Video ${i + 1}] Method 4: Đang dispatch mousedown và mouseup...`)
        const mouseDown = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          view: window,
          clientX: buttonCenterX,
          clientY: buttonCenterY,
          detail: 1
        })
        const mouseUp = new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 0,
          view: window,
          clientX: buttonCenterX,
          clientY: buttonCenterY,
          detail: 1
        })
        
        downloadButton.dispatchEvent(mouseDown)
        await new Promise(resolve => setTimeout(resolve, 100))
        downloadButton.dispatchEvent(mouseUp)
        await new Promise(resolve => setTimeout(resolve, 100))
        console.log(`[Video ${i + 1}] Method 4: Đã dispatch mousedown và mouseup`)
        
        // Method 5: Click event
        console.log(`[Video ${i + 1}] Method 5: Đang dispatch click event...`)
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 0,
          view: window,
          clientX: buttonCenterX,
          clientY: buttonCenterY,
          detail: 1
        })
        downloadButton.dispatchEvent(clickEvent)
        await new Promise(resolve => setTimeout(resolve, 200))
        console.log(`[Video ${i + 1}] Method 5: Đã dispatch click event`)
        
        // Method 6: Direct click() method
        // console.log(`[Video ${i + 1}] Method 6: Đang gọi .click() trực tiếp...`)
        // try {
        //   downloadButton.click()
        //   await new Promise(resolve => setTimeout(resolve, 300))
        //   console.log(`[Video ${i + 1}] Method 6: Đã gọi .click() thành công`)
        // } catch (e) {
        //   console.warn(`[Video ${i + 1}] .click() failed:`, e)
        // }
        
        // // Method 7: Try triggering via onmousedown/onclick if exists
        // if (downloadButton.onmousedown) {
        //   console.log(`[Video ${i + 1}] Method 7: Đang gọi onmousedown handler...`)
        //   try {
        //     downloadButton.onmousedown(mouseDown)
        //     await new Promise(resolve => setTimeout(resolve, 100))
        //   } catch (e) {
        //     console.warn(`[Video ${i + 1}] onmousedown failed:`, e)
        //   }
        // }
        // if (downloadButton.onclick) {
        //   console.log(`[Video ${i + 1}] Method 8: Đang gọi onclick handler...`)
        //   try {
        //     downloadButton.onclick(clickEvent)
        //     await new Promise(resolve => setTimeout(resolve, 100))
        //   } catch (e) {
        //     console.warn(`[Video ${i + 1}] onclick failed:`, e)
        //   }
        // }
        
        // Wait a bit more to ensure click is processed
        await new Promise(resolve => setTimeout(resolve, 500))
        console.log(`[Video ${i + 1}] ✅ Đã thử tất cả các phương pháp click vào nút download`)
        
        // Step 4: Wait for menu to appear and find the menu container
        console.log(`[Video ${i + 1}] Đang đợi menu hiển thị...`)
        chrome.runtime.sendMessage({
          type: 'STATUS_UPDATE',
          status: `Video ${i + 1}/${videos.length}: Đã click download, đang đợi menu hiển thị...`,
        }).catch(() => {})
        
        // Wait and find the menu container that appears (pass button element for better search)
        const menuContainer = await waitForMenuContainer(5000, downloadButton)
        
        if (!menuContainer) {
          console.warn(`[Video ${i + 1}] ❌ KHÔNG TÌM THẤY menu container sau khi click download`)
          chrome.runtime.sendMessage({
            type: 'STATUS_UPDATE',
            status: `Video ${i + 1}/${videos.length}: Không tìm thấy menu, bỏ qua...`,
          }).catch(() => {})
          continue
        }
        
        console.log(`[Video ${i + 1}] ✅ Đã tìm thấy menu container`)
        const menuRect = menuContainer.getBoundingClientRect()
        console.log(`  - Menu container position: (${Math.round(menuRect.left)}, ${Math.round(menuRect.top)}), size: ${Math.round(menuRect.width)}x${Math.round(menuRect.height)}`)
        
        // Find the actual menu element with role="menu" inside the container
        let menuElement = menuContainer
        if (menuContainer.getAttribute('role') !== 'menu') {
          // Try to find element with role="menu" inside container
          const menuWithRole = menuContainer.querySelector('[role="menu"]')
          if (menuWithRole) {
            menuElement = menuWithRole
            console.log(`[Video ${i + 1}] Tìm thấy element role="menu" bên trong container`)
          } else {
            // Try to find in parent or nearby
            const allMenus = document.querySelectorAll('[role="menu"]')
            for (const menu of allMenus) {
              if (menu.contains(menuContainer) || menuContainer.contains(menu)) {
                menuElement = menu
                console.log(`[Video ${i + 1}] Tìm thấy element role="menu" liên quan đến container`)
                break
              }
            }
          }
        }
        
        const menuElementRect = menuElement.getBoundingClientRect()
        console.log(`[Video ${i + 1}] Sử dụng element để giữ menu: tag=${menuElement.tagName}, role=${menuElement.getAttribute('role') || 'N/A'}`)
        console.log(`  - Menu element position: (${Math.round(menuElementRect.left)}, ${Math.round(menuElementRect.top)}), size: ${Math.round(menuElementRect.width)}x${Math.round(menuElementRect.height)}`)
        
        // Function to keep menu visible by continuously dispatching mouse events
        const keepMenuVisible = () => {
          try {
            // Update menu position in case it moved
            const currentRect = menuElement.getBoundingClientRect()
            if (currentRect.width > 0 && currentRect.height > 0) {
              const centerX = currentRect.left + currentRect.width / 2
              const centerY = currentRect.top + currentRect.height / 2
              
              // Dispatch multiple mouse events to keep menu open
              const mouseEnter = new MouseEvent('mouseenter', {
                bubbles: true,
                cancelable: true,
                view: window
              })
              const mouseOver = new MouseEvent('mouseover', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: centerX,
                clientY: centerY
              })
              const mouseMove = new MouseEvent('mousemove', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: centerX,
                clientY: centerY
              })
              
              // Dispatch to menu element
              menuElement.dispatchEvent(mouseEnter)
              menuElement.dispatchEvent(mouseOver)
              menuElement.dispatchEvent(mouseMove)
              
              // Also dispatch to container
              if (menuContainer !== menuElement) {
                menuContainer.dispatchEvent(mouseOver)
                menuContainer.dispatchEvent(mouseMove)
              }
              
              // Dispatch to first child if exists (some frameworks listen to child events)
              const firstChild = menuElement.firstElementChild
              if (firstChild) {
                const childRect = firstChild.getBoundingClientRect()
                if (childRect.width > 0 && childRect.height > 0) {
                  const childCenterX = childRect.left + childRect.width / 2
                  const childCenterY = childRect.top + childRect.height / 2
                  const childMouseOver = new MouseEvent('mouseover', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: childCenterX,
                    clientY: childCenterY
                  })
                  firstChild.dispatchEvent(childMouseOver)
                }
              }
              
              // Also try pointer events
              try {
                const pointerEnter = new PointerEvent('pointerenter', {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  pointerId: 1,
                  pointerType: 'mouse'
                })
                const pointerOver = new PointerEvent('pointerover', {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  clientX: centerX,
                  clientY: centerY,
                  pointerId: 1,
                  pointerType: 'mouse'
                })
                const pointerMove = new PointerEvent('pointermove', {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  clientX: centerX,
                  clientY: centerY,
                  pointerId: 1,
                  pointerType: 'mouse'
                })
                menuElement.dispatchEvent(pointerEnter)
                menuElement.dispatchEvent(pointerOver)
                menuElement.dispatchEvent(pointerMove)
              } catch (e) {
                // Pointer events not supported, skip
              }
            }
          } catch (e) {
            // Menu might have been removed, stop trying
            console.warn(`[Video ${i + 1}] Không thể giữ menu hiển thị:`, e)
          }
        }
        
        // Start keeping menu visible with interval (more frequent to ensure menu stays open)
        console.log(`[Video ${i + 1}] Bắt đầu giữ menu hiển thị bằng cách dispatch mouse events liên tục vào element role="menu"...`)
        keepMenuInterval = setInterval(keepMenuVisible, 100) // Dispatch every 100ms for better responsiveness
        
        // Also hover immediately multiple times
        keepMenuVisible()
        await new Promise(resolve => setTimeout(resolve, 50))
        keepMenuVisible()
        await new Promise(resolve => setTimeout(resolve, 50))
        keepMenuVisible()
        console.log(`[Video ${i + 1}] Đã dispatch events ban đầu để giữ menu hiển thị`)
        
        // Step 5: Find and click "Original size (720p)" option in the menu container
        console.log(`[Video ${i + 1}] Đang tìm option "Original size (720p)" trong menu container...`)
        const originalSizeOption = findOriginalSizeOptionInContainer(menuContainer)
        
        if (!originalSizeOption) {
          // Clear interval if option not found
          if (keepMenuInterval) {
            clearInterval(keepMenuInterval)
            console.log(`[Video ${i + 1}] Đã clear interval do không tìm thấy option`)
          }
          console.warn(`[Video ${i + 1}] ❌ KHÔNG TÌM THẤY option "Original size (720p)" trong menu container`)
          chrome.runtime.sendMessage({
            type: 'STATUS_UPDATE',
            status: `Video ${i + 1}/${videos.length}: Không tìm thấy option "Original size (720p)", bỏ qua...`,
          }).catch(() => {})
          continue
        }

        // Log thông tin về option
        const optionText = originalSizeOption.textContent || originalSizeOption.getAttribute('aria-label') || 'N/A'
        const optionTag = originalSizeOption.tagName
        const optionId = originalSizeOption.id || 'N/A'
        console.log(`[Video ${i + 1}] ✅ ĐÃ TÌM THẤY option "Original size (720p)":`)
        console.log(`  - Tag: ${optionTag}`)
        console.log(`  - ID: "${optionId}"`)
        console.log(`  - Text/Label: "${optionText.trim()}"`)
        
        chrome.runtime.sendMessage({
          type: 'STATUS_UPDATE',
          status: `Video ${i + 1}/${videos.length}: Đã tìm thấy "Original size (720p)", đang click...`,
        }).catch(() => {})
        
        // Click the "Original size (720p)" option (menu is kept visible by interval)
        console.log(`[Video ${i + 1}] Đang scroll đến option "Original size (720p)"...`)
        originalSizeOption.scrollIntoView({ behavior: 'smooth', block: 'center' })
        await new Promise(resolve => setTimeout(resolve, 300))
        
        // Keep menu visible while scrolling
        keepMenuVisible()
        
        // Get option position for accurate clicking
        const optionRect = originalSizeOption.getBoundingClientRect()
        const optionCenterX = optionRect.left + optionRect.width / 2
        const optionCenterY = optionRect.top + optionRect.height / 2
        console.log(`[Video ${i + 1}] Option position: (${Math.round(optionCenterX)}, ${Math.round(optionCenterY)}), size: ${Math.round(optionRect.width)}x${Math.round(optionRect.height)}`)
        
        // Hover over option first (menu is still kept visible by interval)
        console.log(`[Video ${i + 1}] Đang hover vào option...`)
        const optionMouseOver = new MouseEvent('mouseover', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: optionCenterX,
          clientY: optionCenterY
        })
        const optionMouseEnter = new MouseEvent('mouseenter', {
          bubbles: true,
          cancelable: true,
          view: window
        })
        originalSizeOption.dispatchEvent(optionMouseOver)
        originalSizeOption.dispatchEvent(optionMouseEnter)
        
        // Keep menu visible
        keepMenuVisible()
        await new Promise(resolve => setTimeout(resolve, 200))
        
        // Focus and click (menu is still kept visible by interval)
        originalSizeOption.focus()
        keepMenuVisible()
        await new Promise(resolve => setTimeout(resolve, 200))
        
        const optionMouseDown = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          view: window,
          clientX: optionCenterX,
          clientY: optionCenterY
        })
        const optionMouseUp = new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          button: 0,
          view: window,
          clientX: optionCenterX,
          clientY: optionCenterY
        })
        const optionClickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          button: 0,
          view: window,
          clientX: optionCenterX,
          clientY: optionCenterY
        })
        
        // Keep menu visible before clicking
        keepMenuVisible()
        
        originalSizeOption.dispatchEvent(optionMouseDown)
        await new Promise(resolve => setTimeout(resolve, 50))
        originalSizeOption.dispatchEvent(optionMouseUp)
        await new Promise(resolve => setTimeout(resolve, 50))
        originalSizeOption.dispatchEvent(optionClickEvent)
        originalSizeOption.click()
        
        // Keep menu visible after click (don't clear interval - keep menu open)
        keepMenuVisible()
        await new Promise(resolve => setTimeout(resolve, 300))
        
        console.log(`[Video ${i + 1}] ✅ Đã click vào "Original size (720p)" - Download đã được kích hoạt!`)
        console.log(`[Video ${i + 1}] Menu vẫn được giữ hiển thị (interval vẫn chạy)`)
        
        chrome.runtime.sendMessage({
          type: 'STATUS_UPDATE',
          status: `Video ${i + 1}/${videos.length}: ✅ Đã click "Original size (720p)" - Download thành công! Menu vẫn hiển thị.`,
        }).catch(() => {})
        
        // Continue keeping menu visible while waiting
        keepMenuVisible()
        await new Promise(resolve => setTimeout(resolve, 500))
        keepMenuVisible()
        await new Promise(resolve => setTimeout(resolve, 500))
        
        // Check if this is the last video (already calculated at start of loop, but recalculate to be sure)
        // isLastVideo is already defined at the start of the loop
        
        if (isLastVideo) {
          console.log(`[Video ${i + 1}] ⚠️ Đây là video CUỐI CÙNG - Đảm bảo download được kích hoạt đầy đủ...`)
          // For last video, wait longer and keep menu visible to ensure download is triggered
          keepMenuVisible()
          await new Promise(resolve => setTimeout(resolve, 1000))
          keepMenuVisible()
          await new Promise(resolve => setTimeout(resolve, 1000))
          console.log(`[Video ${i + 1}] ✅ Đã đợi đủ lâu để đảm bảo download video cuối cùng được kích hoạt`)
        } else {
          // Wait a bit before moving to next video (menu still kept visible by interval)
          console.log(`[Video ${i + 1}] Đang đợi trước khi chuyển sang video tiếp theo (menu vẫn hiển thị)...`)
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
        
        // Clear interval only when moving to next video (or after last video is processed)
        if (keepMenuInterval) {
          clearInterval(keepMenuInterval)
          keepMenuInterval = null
          if (isLastVideo) {
            console.log(`[Video ${i + 1}] Đã dừng giữ menu hiển thị (đã xử lý xong video cuối cùng)`)
          } else {
            console.log(`[Video ${i + 1}] Đã dừng giữ menu hiển thị (chuyển sang video tiếp theo)`)
          }
        }
        
        console.log(`[Video ${i + 1}] Hoàn thành xử lý video này${isLastVideo ? ' (VIDEO CUỐI CÙNG)' : ''}\n`)

      } catch (error) {
        // Clear interval if it was set
        if (keepMenuInterval) {
          clearInterval(keepMenuInterval)
          keepMenuInterval = null
          console.log(`[Video ${i + 1}] Đã clear interval do lỗi`)
        }
        
        // isLastVideo is already defined at the start of the loop (before try block)
        console.error(`[Video ${i + 1}] ❌ LỖI khi xử lý video${isLastVideo ? ' (VIDEO CUỐI CÙNG)' : ''}:`, error)
        chrome.runtime.sendMessage({
          type: 'STATUS_UPDATE',
          status: `Video ${i + 1}/${videos.length}${isLastVideo ? ' (CUỐI CÙNG)' : ''}: Lỗi - ${error.message}`,
        }).catch(() => {})
        
        // If this is the last video and there was an error, still log completion
        if (isLastVideo) {
          console.log(`\n⚠️ Video cuối cùng gặp lỗi, nhưng đã xử lý xong ${i} video trước đó`)
        }
        
        continue
      }
    }

    console.log(`\n=== ✅ ĐÃ HOÀN THÀNH XỬ LÝ TẤT CẢ ${videos.length} VIDEO ===`)
    console.log(`Tất cả video đã được xử lý và download đã được kích hoạt!`)
    
    chrome.runtime.sendMessage({
      type: 'STATUS_UPDATE',
      status: `✅ Đã hoàn thành xử lý và kích hoạt download cho tất cả ${videos.length} video!`
    }).catch(() => {})
    
    // Gửi message để báo rằng quá trình xử lý đã hoàn tất
    chrome.runtime.sendMessage({
      type: 'COLLECTION_COMPLETED',
      videoCount: videos.length
    }).catch(() => {})
  } catch (error) {
    console.error('Error collecting video links:', error)
    chrome.runtime.sendMessage({
      type: 'VIDEO_ERROR',
      promptIndex: -1,
      error: `Lỗi khi lấy link: ${error.message}`
    }).catch(() => {})
    
    // Gửi message để báo rằng quá trình xử lý đã kết thúc (có lỗi)
    chrome.runtime.sendMessage({
      type: 'COLLECTION_COMPLETED',
      videoCount: 0,
      error: error.message
    }).catch(() => {})
  }
}

// Helper function to find download button near a video element
function findDownloadButtonNearVideo(video) {
  // Get video's bounding rect
  const videoRect = video.getBoundingClientRect()
  console.log(`  [Tìm download button] Video position: (${Math.round(videoRect.left)}, ${Math.round(videoRect.top)})`)
  
  // Search in the video's parent container and nearby elements
  const searchContainer = video.closest('div, section, article') || document.body
  console.log(`  [Tìm download button] Đang tìm trong container: ${searchContainer.tagName}`)
  
  // Strategy 1: Find buttons with radix id pattern (radix-:*:)
  console.log(`  [Tìm download button] Strategy 1: Tìm button có id dạng radix-:*:`)
  const radixButtons = Array.from(searchContainer.querySelectorAll('[id*="radix-"], [id*="radix:"]'))
    .filter(el => {
      if (!el || el.offsetParent === null) return false
      const id = el.id || ''
      return id.includes('radix-') || id.includes('radix:')
    })
  
  console.log(`  [Tìm download button] Tìm thấy ${radixButtons.length} buttons có id radix`)
  
  // Check radix buttons for download text
  for (const button of radixButtons) {
    const text = (button.textContent || '').toLowerCase().trim()
    const aria = (button.getAttribute('aria-label') || '').toLowerCase()
    const title = (button.getAttribute('title') || '').toLowerCase()
    const id = button.id || ''
    
    if (
      text.includes('download') ||
      aria.includes('download') ||
      title.includes('download')
    ) {
      const buttonRect = button.getBoundingClientRect()
      const distance = Math.sqrt(
        Math.pow(buttonRect.left - videoRect.left, 2) +
        Math.pow(buttonRect.top - videoRect.top, 2)
      )
      console.log(`  [Tìm download button] ✅ Tìm thấy radix button có "download": id="${id}", text="${text || aria || title}" (khoảng cách: ${Math.round(distance)}px)`)
      return button
    }
  }
  
  // Strategy 2: Find all potential buttons/links in container
  console.log(`  [Tìm download button] Strategy 2: Tìm tất cả buttons/links trong container`)
  const candidates = Array.from(searchContainer.querySelectorAll('a, button, [role="button"], [data-testid*="download" i], [id*="radix"]'))
    .filter(el => el && el.offsetParent !== null)
  
  console.log(`  [Tìm download button] Tìm thấy ${candidates.length} candidates trong container`)
  
  // Log all candidates for debugging
  candidates.slice(0, 10).forEach((candidate, idx) => {
    const text = (candidate.textContent || '').trim()
    const id = candidate.id || ''
    const aria = candidate.getAttribute('aria-label') || ''
    console.log(`  [Tìm download button] Candidate ${idx + 1}: tag=${candidate.tagName}, id="${id.substring(0, 30)}", text="${text.substring(0, 30)}", aria="${aria.substring(0, 30)}"`)
  })
  
  // Check each candidate
  let downloadCandidates = []
  for (const candidate of candidates) {
    const text = (candidate.textContent || '').toLowerCase().trim()
    const aria = (candidate.getAttribute('aria-label') || '').toLowerCase()
    const title = (candidate.getAttribute('title') || '').toLowerCase()
    const dataTestId = (candidate.getAttribute('data-testid') || '').toLowerCase()
    const id = (candidate.id || '').toLowerCase()
    
    // Check if it's a download button
    if (
      text.includes('download') ||
      aria.includes('download') ||
      title.includes('download') ||
      dataTestId.includes('download') ||
      id.includes('download')
    ) {
      // Check if it's near the video (within reasonable distance)
      const candidateRect = candidate.getBoundingClientRect()
      const distance = Math.sqrt(
        Math.pow(candidateRect.left - videoRect.left, 2) +
        Math.pow(candidateRect.top - videoRect.top, 2)
      )
      
      const candidateInfo = {
        element: candidate,
        text: text || aria || title || id || 'N/A',
        distance: Math.round(distance),
        tag: candidate.tagName,
        id: candidate.id || 'N/A'
      }
      downloadCandidates.push(candidateInfo)
      console.log(`  [Tìm download button] Tìm thấy candidate có "download": id="${candidateInfo.id}", text="${candidateInfo.text.substring(0, 50)}" (khoảng cách: ${candidateInfo.distance}px)`)
      
      // If within 500px, consider it as the download button for this video
      if (distance < 500) {
        console.log(`  [Tìm download button] ✅ Chọn candidate này (khoảng cách < 500px)`)
        return candidate
      }
    }
  }
  
  if (downloadCandidates.length > 0) {
    console.log(`  [Tìm download button] Có ${downloadCandidates.length} candidates có "download" nhưng khoảng cách > 500px, thử tìm trong phạm vi rộng hơn...`)
  }
  
  // Strategy 3: Search in a wider area around the video
  console.log(`  [Tìm download button] Strategy 3: Tìm trong phạm vi rộng hơn (1000px)...`)
  const allButtons = Array.from(document.querySelectorAll('a, button, [role="button"], [id*="radix"]'))
    .filter(el => {
      if (!el || el.offsetParent === null) return false
      
      const elRect = el.getBoundingClientRect()
      const distance = Math.sqrt(
        Math.pow(elRect.left - videoRect.left, 2) +
        Math.pow(elRect.top - videoRect.top, 2)
      )
      return distance < 1000 // Wider search radius
    })
  
  console.log(`  [Tìm download button] Tìm thấy ${allButtons.length} buttons trong phạm vi 1000px`)
  
  // Sort by distance and check for download
  const buttonsWithDistance = allButtons.map(button => {
    const buttonRect = button.getBoundingClientRect()
    const distance = Math.sqrt(
      Math.pow(buttonRect.left - videoRect.left, 2) +
      Math.pow(buttonRect.top - videoRect.top, 2)
    )
    return { button, distance }
  }).sort((a, b) => a.distance - b.distance)
  
  for (const { button, distance } of buttonsWithDistance) {
    const text = (button.textContent || '').toLowerCase().trim()
    const aria = (button.getAttribute('aria-label') || '').toLowerCase()
    const title = (button.getAttribute('title') || '').toLowerCase()
    const id = (button.id || '').toLowerCase()
    
    if (
      text.includes('download') ||
      aria.includes('download') ||
      title.includes('download') ||
      id.includes('download')
    ) {
      console.log(`  [Tìm download button] ✅ Tìm thấy trong phạm vi rộng: id="${id.substring(0, 30)}", text="${(text || aria || title).substring(0, 50)}" (khoảng cách: ${Math.round(distance)}px)`)
      return button
    }
  }
  
  console.log(`  [Tìm download button] ❌ Không tìm thấy button download nào`)
  return null
}

// Helper function to wait for menu container to appear after clicking download button
async function waitForMenuContainer(maxWaitTime = 5000, buttonElement = null) {
  const startTime = Date.now()
  const checkInterval = 150 // Check every 150ms
  
  console.log(`  [Đợi menu container] Bắt đầu đợi menu hiển thị (tối đa ${maxWaitTime}ms)...`)
  
  // Get button position if provided
  let buttonRect = null
  if (buttonElement) {
    buttonRect = buttonElement.getBoundingClientRect()
  }
  
  let lastMenuCount = 0
  
  while (Date.now() - startTime < maxWaitTime) {
    const elapsed = Date.now() - startTime
    if (elapsed % 1000 < checkInterval) {
      console.log(`  [Đợi menu container] Đã đợi ${Math.round(elapsed / 1000)}s...`)
    }
    
    // Try to find menu containers with various selectors
    const menuSelectors = [
      '[role="menu"]',
      '[role="listbox"]',
      '[role="menu"]:not([hidden])',
      '[role="listbox"]:not([hidden])',
      '[data-radix-portal]',
      '[data-radix-popper-content-wrapper]',
      '[data-radix-dropdown-menu-content]',
      '[data-radix-popover-content]',
      '[id*="radix"]:not([hidden])',
      '.menu:not([hidden])',
      '.dropdown:not([hidden])',
      '[class*="menu"]:not([hidden])',
      '[class*="dropdown"]:not([hidden])',
      '[class*="Menu"]:not([hidden])',
      '[class*="Dropdown"]:not([hidden])',
      '[class*="popover"]:not([hidden])',
      '[class*="Popover"]:not([hidden])'
    ]
    
    for (const selector of menuSelectors) {
      try {
        const menus = document.querySelectorAll(selector)
        if (menus.length > lastMenuCount) {
          console.log(`  [Đợi menu container] Tìm thấy ${menus.length} elements với selector: ${selector}`)
          lastMenuCount = menus.length
        }
        
        for (const menu of menus) {
          if (menu && menu.offsetParent !== null) {
            const rect = menu.getBoundingClientRect()
            // Check if menu is visible and has reasonable size
            if (rect.width > 50 && rect.height > 50 && 
                rect.top >= -100 && rect.left >= -100 &&
                rect.top < window.innerHeight + 100 && 
                rect.left < window.innerWidth + 100) {
              
              // If we have button position, prefer menu near the button
              if (buttonRect) {
                const distance = Math.sqrt(
                  Math.pow(rect.left - buttonRect.left, 2) +
                  Math.pow(rect.top - buttonRect.top, 2)
                )
                // Prefer menu within 500px of button
                if (distance < 500) {
                  console.log(`  [Đợi menu container] ✅ Tìm thấy menu container gần button: ${selector} (khoảng cách: ${Math.round(distance)}px)`)
                  return menu
                }
              } else {
                console.log(`  [Đợi menu container] ✅ Tìm thấy menu container: ${selector}`)
                return menu
              }
            }
          }
        }
      } catch (e) {
        // Skip invalid selectors
        continue
      }
    }
    
    // Also check for elements that appeared recently (might be the menu)
    // Look for divs/uls that are visible and contain menu-like content
    const allElements = document.querySelectorAll('div, ul, [role="menu"], [role="listbox"]')
    for (const el of allElements) {
      if (el && el.offsetParent !== null) {
        const rect = el.getBoundingClientRect()
        // Check if element is visible, has reasonable size
        if (rect.width > 100 && rect.height > 50 && 
            rect.top >= -100 && rect.left >= -100 &&
            rect.top < window.innerHeight + 100 && 
            rect.left < window.innerWidth + 100) {
          // Check if it contains menu-like content
          const text = (el.textContent || '').toLowerCase()
          if (text.includes('720p') || text.includes('original') || text.includes('download') || 
              text.includes('size') || text.includes('quality') || text.includes('resolution')) {
            console.log(`  [Đợi menu container] ✅ Tìm thấy menu container có nội dung liên quan: ${el.tagName}, text: "${text.substring(0, 50)}"`)
            return el
          }
        }
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, checkInterval))
  }
  
  console.log(`  [Đợi menu container] ❌ Không tìm thấy menu container sau ${maxWaitTime}ms`)
  console.log(`  [Đợi menu container] Debug: Kiểm tra tất cả elements có role="menu" hoặc role="listbox"...`)
  const debugMenus = document.querySelectorAll('[role="menu"], [role="listbox"]')
  console.log(`  [Đợi menu container] Debug: Tìm thấy ${debugMenus.length} elements với role="menu" hoặc role="listbox"`)
  debugMenus.forEach((menu, idx) => {
    const rect = menu.getBoundingClientRect()
    const hidden = menu.offsetParent === null
    console.log(`  [Đợi menu container] Debug ${idx + 1}: hidden=${hidden}, size=${Math.round(rect.width)}x${Math.round(rect.height)}, pos=(${Math.round(rect.left)}, ${Math.round(rect.top)})`)
  })
  
  return null
}

// Helper function to find "Original size (720p)" option in a specific container
function findOriginalSizeOptionInContainer(container) {
  console.log(`  [Tìm "Original size (720p)" trong container] Bắt đầu tìm kiếm...`)
  
  if (!container) {
    console.log(`  [Tìm "Original size (720p)" trong container] Container không hợp lệ`)
    return null
  }
  
  // Search for elements containing "Original size" or "720p" in the container
  const candidates = Array.from(container.querySelectorAll('a, button, div, span, [role="button"], [role="menuitem"], [role="option"], li, [data-radix-collection-item]'))
    .filter(el => {
      if (!el || el.offsetParent === null) return false
      // Check if element is visible
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
  
  console.log(`  [Tìm "Original size (720p)" trong container] Tìm thấy ${candidates.length} candidates trong container`)
  
  // Priority 1: Exact match "Original size (720p)" or "Original size 720p"
  for (const candidate of candidates) {
    const text = (candidate.textContent || '').toLowerCase().trim()
    const aria = (candidate.getAttribute('aria-label') || '').toLowerCase()
    
    if (
      (text.includes('original size') && text.includes('720p')) ||
      (text.includes('original size') && text.includes('720')) ||
      (aria.includes('original size') && aria.includes('720p')) ||
      (aria.includes('original size') && aria.includes('720'))
    ) {
      console.log(`  [Tìm "Original size (720p)" trong container] ✅ Tìm thấy (Priority 1 - Exact match): "${text || aria}"`)
      return candidate
    }
  }
  
  // Priority 2: Contains both "original" and "720p" or "720"
  for (const candidate of candidates) {
    const text = (candidate.textContent || '').toLowerCase().trim()
    const aria = (candidate.getAttribute('aria-label') || '').toLowerCase()
    
    if (
      (text.includes('original') && (text.includes('720p') || text.includes('720'))) ||
      (aria.includes('original') && (aria.includes('720p') || aria.includes('720')))
    ) {
      console.log(`  [Tìm "Original size (720p)" trong container] ✅ Tìm thấy (Priority 2 - Contains both): "${text || aria}"`)
      return candidate
    }
  }
  
  // Priority 3: Just "720p" (might be the only quality option)
  for (const candidate of candidates) {
    const text = (candidate.textContent || '').toLowerCase().trim()
    if (text === '720p' || (text.includes('720p') && text.length < 20)) {
      console.log(`  [Tìm "Original size (720p)" trong container] ✅ Tìm thấy (Priority 3 - Just 720p): "${text}"`)
      return candidate
    }
  }
  
  console.log(`  [Tìm "Original size (720p)" trong container] ❌ Không tìm thấy option nào`)
  return null
}

// Helper function to find "Original size (720p)" option (fallback - searches entire document)
function findOriginalSizeOption() {
  console.log(`  [Tìm "Original size (720p)"] Bắt đầu tìm kiếm...`)
  
  // First, try to find menu/dropdown containers that might contain the option
  const menuSelectors = [
    '[role="menu"]',
    '[role="listbox"]',
    '.menu',
    '.dropdown',
    '[class*="menu"]',
    '[class*="dropdown"]',
    '[class*="Menu"]',
    '[class*="Dropdown"]'
  ]
  
  let menuContainer = null
  for (const selector of menuSelectors) {
    const menus = document.querySelectorAll(selector)
    if (menus.length > 0) {
      for (const menu of menus) {
        if (menu && menu.offsetParent !== null) {
          menuContainer = menu
          console.log(`  [Tìm "Original size (720p)"] Tìm thấy menu container: ${selector}`)
          break
        }
      }
      if (menuContainer) break
    }
  }
  
  if (!menuContainer) {
    console.log(`  [Tìm "Original size (720p)"] Không tìm thấy menu container, tìm trong toàn bộ document`)
  }
  
  // Search in menu container first, then fallback to entire document
  const searchArea = menuContainer || document.body
  
  // Search for elements containing "Original size" or "720p"
  const candidates = Array.from(searchArea.querySelectorAll('a, button, div, span, [role="button"], [role="menuitem"], [role="option"], li'))
    .filter(el => {
      if (!el || el.offsetParent === null) return false
      // Check if element is visible
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
  
  console.log(`  [Tìm "Original size (720p)"] Tìm thấy ${candidates.length} candidates để kiểm tra`)
  
  // Priority 1: Exact match "Original size (720p)" or "Original size 720p"
  for (const candidate of candidates) {
    const text = (candidate.textContent || '').toLowerCase().trim()
    const aria = (candidate.getAttribute('aria-label') || '').toLowerCase()
    
    if (
      (text.includes('original size') && text.includes('720p')) ||
      (text.includes('original size') && text.includes('720')) ||
      (aria.includes('original size') && aria.includes('720p')) ||
      (aria.includes('original size') && aria.includes('720'))
    ) {
      console.log(`  [Tìm "Original size (720p)"] ✅ Tìm thấy (Priority 1 - Exact match): "${text || aria}"`)
      return candidate
    }
  }
  
  // Priority 2: Contains both "original" and "720p" or "720"
  for (const candidate of candidates) {
    const text = (candidate.textContent || '').toLowerCase().trim()
    const aria = (candidate.getAttribute('aria-label') || '').toLowerCase()
    
    if (
      (text.includes('original') && (text.includes('720p') || text.includes('720'))) ||
      (aria.includes('original') && (aria.includes('720p') || aria.includes('720')))
    ) {
      console.log(`  [Tìm "Original size (720p)"] ✅ Tìm thấy (Priority 2 - Contains both): "${text || aria}"`)
      return candidate
    }
  }
  
  // Priority 3: Just "720p" (might be the only quality option)
  for (const candidate of candidates) {
    const text = (candidate.textContent || '').toLowerCase().trim()
    if (text === '720p' || (text.includes('720p') && text.length < 20)) {
      console.log(`  [Tìm "Original size (720p)"] ✅ Tìm thấy (Priority 3 - Just 720p): "${text}"`)
      return candidate
    }
  }
  
  console.log(`  [Tìm "Original size (720p)"] ❌ Không tìm thấy option nào`)
  return null
}

// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('Flow Content Script loaded')
  })
} else {
  console.log('Flow Content Script loaded')
}
