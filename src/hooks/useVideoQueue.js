import { useState, useEffect, useCallback } from 'react'
import { storage, sendMessage } from '../utils/chromeAPI.js'
import { saveVideoUrl } from '../utils/downloadManager.js'

const STORAGE_KEY = 'videoQueue'
const DELAY_BETWEEN_PROMPTS = 120000 // 2 minutes - delay giữa các prompts

export const useVideoQueue = () => {
  const [prompts, setPrompts] = useState(Array(10).fill(''))
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [isRunning, setIsRunning] = useState(false)
  const [isStopped, setIsStopped] = useState(false)
  const [status, setStatus] = useState('')
  const [completedCount, setCompletedCount] = useState(0)
  const [isCollectingLinks, setIsCollectingLinks] = useState(false)

  // Load prompts from storage on mount
  useEffect(() => {
    const loadPrompts = async () => {
      try {
        const data = await storage.get(STORAGE_KEY)
        if (data[STORAGE_KEY]) {
          setPrompts(data[STORAGE_KEY])
        }
      } catch (error) {
        console.error('Error loading prompts:', error)
      }
    }
    loadPrompts()
  }, [])

  // Save prompts to storage whenever they change
  useEffect(() => {
    const savePrompts = async () => {
      try {
        await storage.set({ [STORAGE_KEY]: prompts })
      } catch (error) {
        console.error('Error saving prompts:', error)
      }
    }
    savePrompts()
  }, [prompts])

  const processNextPrompt = useCallback(async (index) => {
    if (index >= prompts.length) {
      // Đã chạy hết tất cả prompts, bắt đầu lấy link download
      setIsRunning(false)
      setCurrentIndex(-1)
      setStatus('Đã chạy hết tất cả prompts. Bắt đầu lấy link download...')
      startCollectingLinks()
      return
    }

    const prompt = prompts[index]
    if (!prompt || prompt.trim() === '') {
      // Skip empty prompts
      if (index < prompts.length - 1) {
        setTimeout(() => {
          processNextPrompt(index + 1)
        }, 1000)
      } else {
        setIsRunning(false)
        setCurrentIndex(-1)
        setStatus('Đã chạy hết tất cả prompts. Bắt đầu lấy link download...')
        startCollectingLinks()
      }
      return
    }

    setCurrentIndex(index)
    setStatus(`Đang submit prompt ${index + 1}/10...`)

    try {
      await sendMessage({
        type: 'PROCESS_PROMPT',
        prompt: prompt.trim(),
        promptIndex: index
      })
      // Không đợi video completion ở đây, sẽ đợi trong handlePromptSubmitted
    } catch (error) {
      console.error('Error processing prompt:', error)
      setStatus(`Lỗi ở prompt ${index + 1}: ${error.message}`)
      // Continue to next prompt even on error
      if (!isStopped && index < prompts.length - 1) {
        setTimeout(() => {
          processNextPrompt(index + 1)
        }, DELAY_BETWEEN_PROMPTS)
      } else {
        setIsRunning(false)
        setCurrentIndex(-1)
      }
    }
  }, [prompts, isStopped])

  const handlePromptSubmitted = useCallback(async (promptIndex) => {
    // Sau khi submit prompt, đợi 2 phút rồi chạy prompt tiếp theo
    if (!isStopped && promptIndex < prompts.length - 1) {
      // Hiển thị countdown
      let remainingSeconds = DELAY_BETWEEN_PROMPTS / 1000
      const countdownInterval = setInterval(() => {
        remainingSeconds--
        if (remainingSeconds > 0 && !isStopped) {
          const minutes = Math.floor(remainingSeconds / 60)
          const seconds = remainingSeconds % 60
          setStatus(`Đã submit prompt ${promptIndex + 1}/10. Đợi ${minutes}:${seconds.toString().padStart(2, '0')} trước khi chạy prompt ${promptIndex + 2}...`)
        }
      }, 1000)
      
      setTimeout(() => {
        clearInterval(countdownInterval)
        if (!isStopped) {
          setStatus(`Bắt đầu submit prompt ${promptIndex + 2}...`)
          processNextPrompt(promptIndex + 1)
        }
      }, DELAY_BETWEEN_PROMPTS)
    } else if (promptIndex >= prompts.length - 1) {
      // Đã chạy hết prompts, bắt đầu lấy link
      setIsRunning(false)
      setCurrentIndex(-1)
      setStatus('Đã chạy hết tất cả prompts. Bắt đầu lấy link download...')
      startCollectingLinks()
    }
  }, [isStopped, prompts.length, processNextPrompt])

  const startCollectingLinks = useCallback(async () => {
    setIsCollectingLinks(true)
    setStatus('Đã chạy hết tất cả prompts. Đợi một chút rồi bắt đầu lấy link download...')
    
    // Đợi thêm một chút để đảm bảo tất cả video đã được tạo
    setTimeout(async () => {
      try {
        setStatus('Đang lấy link download cho tất cả video...')
        // Gửi message để content script bắt đầu lấy link cho tất cả prompts
        await sendMessage({
          type: 'COLLECT_ALL_VIDEO_LINKS'
        })
      } catch (error) {
        console.error('Error starting link collection:', error)
        setStatus(`Lỗi khi lấy link: ${error.message}`)
        setIsCollectingLinks(false)
      }
    }, 5000) // Đợi 5 giây trước khi bắt đầu lấy link
  }, [])

  const handleVideoCompleted = useCallback(async (promptIndex, videoUrl) => {
    try {
      await saveVideoUrl(promptIndex, videoUrl)
      const newCount = completedCount + 1
      setCompletedCount(newCount)
      
      const validPromptsCount = prompts.filter(p => p && p.trim() !== '').length
      setStatus(`Đã lấy link video ${newCount}/${validPromptsCount}...`)
      
      // Nếu đã lấy hết tất cả links
      if (newCount >= validPromptsCount) {
        setIsCollectingLinks(false)
        setStatus('Đã lấy link cho tất cả video! Có thể download ngay bây giờ.')
      }
    } catch (error) {
      console.error('Error handling video completion:', error)
    }
  }, [completedCount, prompts])

  const handleVideoError = useCallback((promptIndex, error) => {
    setStatus(`Lỗi ở prompt ${promptIndex + 1}: ${error}`)
    // Continue to next prompt even on error
    if (!isStopped && promptIndex < prompts.length - 1) {
      setTimeout(() => {
        processNextPrompt(promptIndex + 1)
      }, DELAY_BETWEEN_PROMPTS)
    } else {
      setIsRunning(false)
      setCurrentIndex(-1)
    }
  }, [isStopped, prompts.length, processNextPrompt])

  // Listen for messages from background script
  useEffect(() => {
    const messageListener = (message, sender, sendResponse) => {
      if (message.type === 'PROMPT_SUBMITTED') {
        handlePromptSubmitted(message.promptIndex)
        sendResponse({ success: true })
      } else if (message.type === 'VIDEO_COMPLETED') {
        handleVideoCompleted(message.promptIndex, message.videoUrl)
        sendResponse({ success: true })
      } else if (message.type === 'VIDEO_ERROR') {
        handleVideoError(message.promptIndex, message.error)
        sendResponse({ success: true })
      } else if (message.type === 'STATUS_UPDATE') {
        setStatus(message.status)
        sendResponse({ success: true })
      }
      return true // Keep channel open for async response
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(messageListener)
      return () => {
        chrome.runtime.onMessage.removeListener(messageListener)
      }
    }
  }, [handlePromptSubmitted, handleVideoCompleted, handleVideoError])

  const startQueue = useCallback(async () => {
    const validPrompts = prompts.filter(p => p && p.trim() !== '')
    if (validPrompts.length === 0) {
      setStatus('Vui lòng nhập ít nhất một prompt!')
      return
    }

    setIsRunning(true)
    setIsStopped(false)
    setCurrentIndex(-1)
    setCompletedCount(0)
    setIsCollectingLinks(false)
    setStatus('Đang khởi động...')

    try {
      // Open Flow page
      await sendMessage({ type: 'OPEN_FLOW_PAGE' })
      
      // Wait a bit for page to load, then start first prompt
      setTimeout(() => {
        processNextPrompt(0)
      }, 2000)
    } catch (error) {
      console.error('Error starting queue:', error)
      setStatus(`Lỗi: ${error.message}`)
      setIsRunning(false)
    }
  }, [prompts, processNextPrompt])

  const stopQueue = useCallback(() => {
    setIsStopped(true)
    setIsRunning(false)
    setStatus('Đã dừng')
    
    sendMessage({ type: 'STOP_QUEUE' }).catch(error => {
      console.error('Error stopping queue:', error)
    })
  }, [])

  const clearQueue = useCallback(() => {
    setPrompts(Array(10).fill(''))
    setCurrentIndex(-1)
    setIsRunning(false)
    setIsStopped(false)
    setStatus('')
    setCompletedCount(0)
  }, [])

  const updatePrompt = useCallback((index, value) => {
    setPrompts(prev => {
      const newPrompts = [...prev]
      newPrompts[index] = value
      return newPrompts
    })
  }, [])

  return {
    prompts,
    updatePrompt,
    currentIndex,
    isRunning,
    isStopped,
    status,
    setStatus,
    completedCount,
    startQueue,
    stopQueue,
    clearQueue
  }
}
