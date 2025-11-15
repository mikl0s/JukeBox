const fs = require('fs').promises;
const path = require('path');
const ytDlp = require('yt-dlp-exec');
const NodeID3 = require('node-id3');

// Configuration
const YOUTUBE_FOLDER = path.join(__dirname, 'youtube');
const MIXED_FOLDER = path.join(YOUTUBE_FOLDER, 'Mixed');
const COOKIES_FILE = process.env.YOUTUBE_COOKIES_FILE || null;

// Progress tracking
const activeDownloads = new Map(); // Map<downloadId, progressData>

// Helper to add cookies option if available
function addCookiesOption(options = {}) {
  if (COOKIES_FILE) {
    options.cookies = COOKIES_FILE;
  }
  return options;
}

// Ensure folders exist
async function ensureFolders() {
  try {
    await fs.mkdir(YOUTUBE_FOLDER, { recursive: true });
    await fs.mkdir(MIXED_FOLDER, { recursive: true });
    return { success: true };
  } catch (error) {
    console.error(`Error creating folders: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Clean filename for filesystem
function sanitizeFilename(filename) {
  return filename
    .replace(/[<>:"\/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200);
}

// Generate unique download ID
function generateDownloadId() {
  return `dl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Update progress for a download
function updateProgress(downloadId, progress) {
  activeDownloads.set(downloadId, {
    ...activeDownloads.get(downloadId),
    ...progress,
    lastUpdate: Date.now()
  });
}

// Get progress for a download
function getProgress(downloadId) {
  return activeDownloads.get(downloadId) || null;
}

// Clear completed download
function clearDownload(downloadId) {
  setTimeout(() => {
    activeDownloads.delete(downloadId);
  }, 60000); // Keep for 1 minute after completion
}

// Detect if URL is a playlist
async function detectPlaylist(url) {
  try {
    const info = await ytDlp(url, addCookiesOption({
      dumpSingleJson: true,
      noWarnings: true,
      flatPlaylist: true,
    }));

    if (info._type === 'playlist') {
      return {
        isPlaylist: true,
        title: info.title || 'Unnamed Playlist',
        count: info.entries?.length || 0,
        entries: info.entries || []
      };
    }

    return { isPlaylist: false };
  } catch (error) {
    console.error('Error detecting playlist:', error.message);
    return { isPlaylist: false, error: error.message };
  }
}

// Download single video (video + audio or audio-only)
async function downloadVideo(url, options = {}) {
  const {
    albumFolder = null,
    includeVideo = false, // true = video+audio, false = audio-only
    downloadId = generateDownloadId()
  } = options;

  try {
    // Determine output folder
    const outputFolder = albumFolder ? path.join(YOUTUBE_FOLDER, albumFolder) : MIXED_FOLDER;
    await fs.mkdir(outputFolder, { recursive: true });

    // Initialize progress
    updateProgress(downloadId, {
      stage: 'fetching_info',
      url,
      progress: 0,
      status: 'Fetching video information...'
    });

    // Get video info
    const info = await ytDlp(url, addCookiesOption({
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
    }));

    const title = info.title || 'Unknown Title';
    const artist = info.uploader || info.channel || 'Unknown Artist';
    const album = albumFolder || 'YouTube Downloads';
    const duration = info.duration || 0;
    const uploadDate = info.upload_date || '';
    const description = info.description || '';
    const thumbnail = info.thumbnail || '';

    // Create safe filename
    const safeTitle = sanitizeFilename(title);
    const audioPath = path.join(outputFolder, `${safeTitle}.mp3`);
    const videoPath = includeVideo ? path.join(outputFolder, `${safeTitle}.mp4`) : null;

    // Check if files already exist
    try {
      await fs.access(audioPath);
      if (!includeVideo || (includeVideo && videoPath)) {
        try {
          if (videoPath) await fs.access(videoPath);
          updateProgress(downloadId, {
            stage: 'complete',
            progress: 100,
            status: 'Already exists',
            skipped: true
          });
          return {
            success: true,
            skipped: true,
            title,
            audioPath,
            videoPath,
            filename: `${safeTitle}.mp3`,
            folder: albumFolder || 'Mixed',
            downloadId
          };
        } catch {
          // Video doesn't exist, continue
        }
      }
    } catch {
      // Audio doesn't exist, proceed with download
    }

    // Download video if requested
    if (includeVideo && videoPath) {
      updateProgress(downloadId, {
        stage: 'downloading_video',
        title,
        progress: 10,
        status: `Downloading video: ${title}...`
      });

      await ytDlp(url, addCookiesOption({
        format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        output: videoPath,
        noWarnings: true,
        noCallHome: true,
      }));

      updateProgress(downloadId, {
        stage: 'extracting_audio',
        progress: 60,
        status: 'Extracting audio from video...'
      });
    }

    // Download/extract audio
    updateProgress(downloadId, {
      stage: 'downloading_audio',
      title,
      progress: includeVideo ? 70 : 30,
      status: includeVideo ? 'Extracting audio...' : `Downloading audio: ${title}...`
    });

    await ytDlp(url, addCookiesOption({
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: 0,
      output: audioPath,
      noWarnings: true,
      noCallHome: true,
      embedThumbnail: false,
      addMetadata: false,
    }));

    // Add metadata
    updateProgress(downloadId, {
      stage: 'tagging',
      progress: 85,
      status: 'Adding metadata tags...'
    });

    const tags = {
      title: title,
      artist: artist,
      album: album,
      year: uploadDate ? uploadDate.substring(0, 4) : new Date().getFullYear().toString(),
      comment: {
        language: 'eng',
        text: `Downloaded from YouTube\nURL: ${url}\n${description.substring(0, 200)}`
      },
      userDefinedUrl: [{
        description: 'Source URL',
        url: url
      }]
    };

    // Download and embed thumbnail
    if (thumbnail) {
      try {
        const https = require('https');
        const http = require('http');

        const imageData = await new Promise((resolve, reject) => {
          const client = thumbnail.startsWith('https') ? https : http;
          const timeout = setTimeout(() => reject(new Error('Thumbnail download timeout')), 10000);

          client.get(thumbnail, (res) => {
            clearTimeout(timeout);
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
          }).on('error', reject);
        });

        tags.image = {
          mime: 'image/jpeg',
          type: { id: 3, name: 'front cover' },
          description: 'Cover',
          imageBuffer: imageData
        };
      } catch (error) {
        console.log(`Could not download thumbnail: ${error.message}`);
      }
    }

    NodeID3.write(tags, audioPath);

    updateProgress(downloadId, {
      stage: 'complete',
      progress: 100,
      status: 'Download complete!',
      completed: true
    });

    clearDownload(downloadId);

    return {
      success: true,
      skipped: false,
      title,
      audioPath,
      videoPath: includeVideo ? videoPath : null,
      filename: `${safeTitle}.mp3`,
      folder: albumFolder || 'Mixed',
      duration,
      artist,
      downloadId,
      hasVideo: includeVideo
    };

  } catch (error) {
    updateProgress(downloadId, {
      stage: 'error',
      progress: 0,
      status: `Error: ${error.message}`,
      error: error.message
    });
    clearDownload(downloadId);
    return { success: false, error: error.message, url, downloadId };
  }
}

// Download playlist as album
async function downloadPlaylist(url, options = {}) {
  const {
    customAlbumName = null,
    includeVideo = false,
    downloadId = generateDownloadId()
  } = options;

  try {
    updateProgress(downloadId, {
      stage: 'detecting_playlist',
      progress: 0,
      status: 'Detecting playlist...',
      url
    });

    const playlistInfo = await detectPlaylist(url);

    if (!playlistInfo.isPlaylist) {
      // Not a playlist, download as single video
      return await downloadVideo(url, { includeVideo, downloadId });
    }

    const albumName = customAlbumName || sanitizeFilename(playlistInfo.title);
    const entries = playlistInfo.entries || [];
    const totalVideos = entries.length;

    updateProgress(downloadId, {
      stage: 'playlist_detected',
      progress: 5,
      status: `Playlist detected: ${albumName}`,
      albumName,
      totalVideos,
      currentVideo: 0
    });

    const results = [];

    for (let i = 0; i < entries.length; i++) {
      const videoUrl = entries[i].url || `https://www.youtube.com/watch?v=${entries[i].id}`;
      const videoTitle = entries[i].title || `Video ${i + 1}`;

      updateProgress(downloadId, {
        stage: 'downloading_video',
        progress: Math.floor((i / totalVideos) * 90) + 5,
        status: `Downloading ${i + 1}/${totalVideos}: ${videoTitle}`,
        currentVideo: i + 1,
        totalVideos,
        videoTitle
      });

      const result = await downloadVideo(videoUrl, {
        albumFolder: albumName,
        includeVideo,
        downloadId: `${downloadId}_${i}`
      });

      results.push(result);

      // Small delay between downloads
      if (i < entries.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const successful = results.filter(r => r.success && !r.skipped).length;
    const skipped = results.filter(r => r.skipped).length;
    const failed = results.filter(r => !r.success).length;

    updateProgress(downloadId, {
      stage: 'complete',
      progress: 100,
      status: 'Playlist download complete!',
      completed: true,
      successful,
      skipped,
      failed
    });

    clearDownload(downloadId);

    return {
      success: true,
      isPlaylist: true,
      albumName,
      totalVideos,
      successful,
      skipped,
      failed,
      results,
      downloadId
    };

  } catch (error) {
    updateProgress(downloadId, {
      stage: 'error',
      progress: 0,
      status: `Error: ${error.message}`,
      error: error.message
    });
    clearDownload(downloadId);
    return { success: false, error: error.message, url, downloadId };
  }
}

// Batch download from URLs
async function batchDownload(urls, options = {}) {
  const {
    customAlbumName = null,
    includeVideo = false,
    downloadId = generateDownloadId()
  } = options;

  const totalUrls = urls.length;

  updateProgress(downloadId, {
    stage: 'batch_starting',
    progress: 0,
    status: `Starting batch download of ${totalUrls} URL(s)...`,
    totalUrls,
    currentUrl: 0
  });

  const results = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];

    updateProgress(downloadId, {
      stage: 'processing_url',
      progress: Math.floor((i / totalUrls) * 90),
      status: `Processing URL ${i + 1}/${totalUrls}...`,
      currentUrl: i + 1,
      totalUrls,
      url
    });

    // Detect if playlist
    const playlistInfo = await detectPlaylist(url);

    let result;
    if (playlistInfo.isPlaylist) {
      result = await downloadPlaylist(url, {
        customAlbumName,
        includeVideo,
        downloadId: `${downloadId}_pl_${i}`
      });
    } else {
      result = await downloadVideo(url, {
        albumFolder: customAlbumName,
        includeVideo,
        downloadId: `${downloadId}_v_${i}`
      });
    }

    results.push(result);

    // Small delay between URLs
    if (i < urls.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  const successful = results.filter(r => r.success && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  const failed = results.filter(r => !r.success).length;
  const playlists = results.filter(r => r.isPlaylist).length;

  updateProgress(downloadId, {
    stage: 'complete',
    progress: 100,
    status: 'Batch download complete!',
    completed: true,
    totalUrls,
    successful,
    skipped,
    failed,
    playlists
  });

  clearDownload(downloadId);

  return {
    success: true,
    downloadId,
    totalUrls,
    successful,
    skipped,
    failed,
    playlists,
    results
  };
}

// Get list of albums (folders in youtube directory)
async function getAlbums() {
  try {
    await ensureFolders();
    const items = await fs.readdir(YOUTUBE_FOLDER, { withFileTypes: true });
    const albums = items
      .filter(item => item.isDirectory())
      .map(item => item.name)
      .sort();

    return { success: true, albums };
  } catch (error) {
    return { success: false, error: error.message, albums: [] };
  }
}

// Get files in a specific album
async function getAlbumFiles(albumName) {
  try {
    const albumPath = path.join(YOUTUBE_FOLDER, albumName);
    const files = await fs.readdir(albumPath);
    const mp3Files = files.filter(f => f.toLowerCase().endsWith('.mp3'));
    const mp4Files = files.filter(f => f.toLowerCase().endsWith('.mp4'));

    return {
      success: true,
      audioFiles: mp3Files,
      videoFiles: mp4Files,
      totalAudio: mp3Files.length,
      totalVideo: mp4Files.length
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      audioFiles: [],
      videoFiles: [],
      totalAudio: 0,
      totalVideo: 0
    };
  }
}

module.exports = {
  ensureFolders,
  detectPlaylist,
  downloadVideo,
  downloadPlaylist,
  batchDownload,
  getAlbums,
  getAlbumFiles,
  sanitizeFilename,
  getProgress,
  generateDownloadId
};
