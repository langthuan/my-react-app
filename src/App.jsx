import { useVideoQueue } from './hooks/useVideoQueue'
import { downloadAllVideos, getAllVideoUrls, getVideoCount } from './utils/downloadManager'
import { sendMessage } from './utils/chromeAPI'
import { useState, useEffect } from 'react'

function App() {
  const {
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
  } = useVideoQueue()

  const [videoCount, setVideoCount] = useState(0)
  const [isDownloading, setIsDownloading] = useState(false)

  useEffect(() => {
    const updateVideoCount = async () => {
      const count = await getVideoCount()
      setVideoCount(count)
    }
    updateVideoCount()
    const interval = setInterval(updateVideoCount, 2000)
    return () => clearInterval(interval)
  }, [completedCount])

  // Listen for video completed messages to update count
  useEffect(() => {
    const messageListener = (message) => {
      if (message.type === 'VIDEO_COMPLETED') {
        // Update video count when a new video link is collected
        getVideoCount().then(count => setVideoCount(count))
      } else if (message.type === 'COLLECTION_COMPLETED') {
        // Quá trình xử lý video đã hoàn tất, enable lại nút Download all
        setIsDownloading(false)
        // Update video count
        getVideoCount().then(count => setVideoCount(count))
      }
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(messageListener)
      return () => {
        chrome.runtime.onMessage.removeListener(messageListener)
      }
    }
  }, [])

  const handleDownloadAll = async () => {
    setIsDownloading(true)
    try {
      // Mỗi lần click "Download All" sẽ LUÔN LUÔN tìm lại video trên trang (không dùng cache)
      setStatus('Đang tìm lại tất cả video trên trang và bắt đầu download...')
      
      try {
        // Gửi message để tìm lại video và download
        await sendMessage({
          type: 'COLLECT_ALL_VIDEO_LINKS'
        })
        
        // Việc download đã được thực hiện trực tiếp trong handleCollectAllVideoLinks
        // Không cần đợi hay kiểm tra storage nữa
        setStatus('Đã bắt đầu quá trình download tất cả video...')
      } catch (error) {
        console.error('Error collecting links:', error)
        alert('Không thể lấy link video. Vui lòng đảm bảo trang Flow đang mở và đã có video được tạo.')
        setStatus('')
        setIsDownloading(false)
        return
      }
    } catch (error) {
      console.error('Error downloading videos:', error)
      alert(`Lỗi khi download: ${error.message}`)
      setStatus('')
    } finally {
      // Không set isDownloading = false ngay vì quá trình download có thể đang diễn ra
      // Có thể để status update từ content script quản lý
    }
  }

  return (
    <div className="w-[500px] max-h-[600px] overflow-y-auto p-4 bg-gray-50">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">
          Flow Video Automation
        </h1>
        <p className="text-sm text-gray-600">
          Nhập tối đa 10 prompts để tạo video tự động
        </p>
      </div>

      {/* Status Display */}
      {(status || isRunning) && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold text-blue-800">Trạng thái:</span>
            {isRunning && (
              <span className="text-xs text-blue-600">
                {completedCount}/10 hoàn thành
              </span>
            )}
          </div>
          <p className="text-sm text-blue-700">{status || 'Đang chờ...'}</p>
          {currentIndex >= 0 && (
            <div className="mt-2">
              <div className="w-full bg-blue-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${((currentIndex + 1) / 10) * 100}%` }}
                ></div>
              </div>
              <p className="text-xs text-blue-600 mt-1">
                Đang xử lý prompt {currentIndex + 1}/10
              </p>
            </div>
          )}
        </div>
      )}

      {/* Prompts Input */}
      <div className="mb-4 space-y-3">
        {prompts.map((prompt, index) => (
          <div key={index} className="relative">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Prompt {index + 1}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => updatePrompt(index, e.target.value)}
              placeholder={`Nhập prompt ${index + 1}...`}
              disabled={isRunning}
              className={`w-full px-3 py-2 border rounded-lg resize-none text-sm ${
                isRunning
                  ? 'bg-gray-100 cursor-not-allowed'
                  : 'bg-white hover:border-blue-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200'
              } ${
                currentIndex === index && isRunning
                  ? 'border-blue-500 ring-2 ring-blue-200'
                  : 'border-gray-300'
              }`}
              rows={3}
            />
            {currentIndex === index && isRunning && (
              <div className="absolute top-8 right-2">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            onClick={clearQueue}
            disabled={isRunning}
            className={`flex-1 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              isRunning
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Clear All
          </button>
          {!isRunning ? (
            <button
              onClick={startQueue}
              disabled={prompts.every(p => !p.trim())}
              className={`flex-1 px-4 py-2 rounded-lg font-medium text-sm text-white transition-colors ${
                prompts.every(p => !p.trim())
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              Tạo video
            </button>
          ) : (
            <button
              onClick={stopQueue}
              className="flex-1 px-4 py-2 rounded-lg font-medium text-sm text-white bg-red-600 hover:bg-red-700 transition-colors"
            >
              Stop
            </button>
          )}
        </div>

        <button
          onClick={handleDownloadAll}
          disabled={isDownloading}
          className={`w-full px-4 py-2 rounded-lg font-medium text-sm text-white transition-colors ${
            isDownloading
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {isDownloading
            ? 'Đang xử lý...'
            : videoCount > 0
            ? `Download All (${videoCount} video)`
            : 'Download All (Lấy link & Download)'}
        </button>
      </div>

      {/* Video Count Info */}
      {videoCount > 0 && (
        <div className="mt-4 p-2 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-xs text-green-700">
            Có {videoCount} video đã sẵn sàng để download
          </p>
        </div>
      )}
    </div>
  )
}

export default App
