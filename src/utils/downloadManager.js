/**
 * Download Manager for videos
 */
import { storage, downloadFile } from './chromeAPI.js'

const STORAGE_KEY = 'videoUrls'

/**
 * Save video URL to storage
 */
export const saveVideoUrl = async (promptIndex, videoUrl) => {
  const data = await storage.get(STORAGE_KEY)
  const videoUrls = data[STORAGE_KEY] || []
  
  // Update or add video URL for this prompt
  videoUrls[promptIndex] = {
    url: videoUrl,
    timestamp: Date.now(),
    promptIndex
  }
  
  await storage.set({ [STORAGE_KEY]: videoUrls })
  return videoUrls
}

/**
 * Get all saved video URLs
 */
export const getAllVideoUrls = async () => {
  const data = await storage.get(STORAGE_KEY)
  return data[STORAGE_KEY] || []
}

/**
 * Clear all video URLs
 */
export const clearVideoUrls = async () => {
  await storage.remove(STORAGE_KEY)
}

/**
 * Download all videos
 */
export const downloadAllVideos = async () => {
  const videoUrls = await getAllVideoUrls()
  
  if (videoUrls.length === 0) {
    throw new Error('No videos to download')
  }
  
  const downloadPromises = videoUrls
    .filter(item => item && item.url)
    .map((item, index) => {
      const filename = `flow-video-${item.promptIndex + 1}-${Date.now()}.mp4`
      return downloadFile(item.url, filename)
    })
  
  return Promise.all(downloadPromises)
}

/**
 * Get video count
 */
export const getVideoCount = async () => {
  const videoUrls = await getAllVideoUrls()
  return videoUrls.filter(item => item && item.url).length
}
