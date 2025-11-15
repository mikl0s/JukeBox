const fs = require('fs').promises;
const path = require('path');
const ytDlp = require('yt-dlp-exec');
const NodeID3 = require('node-id3');

// Configuration
const YOUTUBE_FOLDER = path.join(__dirname, 'youtube');
const URLS_FILE = path.join(__dirname, 'youtube-urls.txt');

// Ensure the YouTube folder exists
async function ensureYouTubeFolder() {
  try {
    await fs.mkdir(YOUTUBE_FOLDER, { recursive: true });
    console.log(`✓ YouTube folder ready: ${YOUTUBE_FOLDER}`);
  } catch (error) {
    console.error(`✗ Error creating YouTube folder: ${error.message}`);
    throw error;
  }
}

// Clean filename for filesystem
function sanitizeFilename(filename) {
  return filename
    .replace(/[<>:"\/\\|?*]/g, '') // Remove invalid characters
    .replace(/\s+/g, ' ')            // Normalize whitespace
    .trim()
    .substring(0, 200);              // Limit length
}

// Download and convert YouTube audio to MP3
async function downloadYouTubeAudio(url, index, total) {
  try {
    console.log(`\n[${index + 1}/${total}] Processing: ${url}`);

    // Get video info first
    const info = await ytDlp(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      noCheckCertificates: false,
      preferFreeFormats: true,
    });

    const title = info.title || 'Unknown Title';
    const artist = info.uploader || info.channel || 'Unknown Artist';
    const album = info.album || 'YouTube Downloads';
    const duration = info.duration || 0;
    const uploadDate = info.upload_date || '';
    const description = info.description || '';
    const thumbnail = info.thumbnail || '';

    console.log(`  Title: ${title}`);
    console.log(`  Artist: ${artist}`);
    console.log(`  Duration: ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`);

    // Create safe filename
    const safeTitle = sanitizeFilename(title);
    const outputPath = path.join(YOUTUBE_FOLDER, `${safeTitle}.mp3`);

    // Check if file already exists
    try {
      await fs.access(outputPath);
      console.log(`  ⊘ File already exists, skipping...`);
      return { success: true, skipped: true, title, path: outputPath };
    } catch {
      // File doesn't exist, proceed with download
    }

    // Download audio and convert to MP3
    console.log(`  ↓ Downloading audio...`);
    await ytDlp(url, {
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: 0, // Best quality
      output: outputPath,
      noWarnings: true,
      noCallHome: true,
      embedThumbnail: false, // We'll add metadata separately
      addMetadata: false,
    });

    console.log(`  ♫ Adding metadata tags...`);

    // Prepare ID3 tags
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

    // Download and embed thumbnail if available
    if (thumbnail) {
      try {
        const https = require('https');
        const http = require('http');

        const imageData = await new Promise((resolve, reject) => {
          const client = thumbnail.startsWith('https') ? https : http;
          client.get(thumbnail, (res) => {
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
        console.log(`  ⚠ Could not download thumbnail: ${error.message}`);
      }
    }

    // Write ID3 tags to MP3
    const success = NodeID3.write(tags, outputPath);

    if (success) {
      console.log(`  ✓ Successfully downloaded and tagged: ${safeTitle}.mp3`);
    } else {
      console.log(`  ✓ Downloaded: ${safeTitle}.mp3 (metadata tagging failed)`);
    }

    return { success: true, skipped: false, title, path: outputPath };

  } catch (error) {
    console.error(`  ✗ Error: ${error.message}`);
    return { success: false, error: error.message, url };
  }
}

// Parse URLs from text file
async function parseURLsFile() {
  try {
    const content = await fs.readFile(URLS_FILE, 'utf-8');
    const urls = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')) // Filter empty lines and comments
      .filter(line => line.includes('youtube.com') || line.includes('youtu.be'));

    return urls;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`\n✗ URLs file not found: ${URLS_FILE}`);
      console.log('\nPlease create a youtube-urls.txt file with one YouTube URL per line.');
      console.log('Example:');
      console.log('  https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      console.log('  https://youtu.be/dQw4w9WgXcQ');
    } else {
      console.error(`\n✗ Error reading URLs file: ${error.message}`);
    }
    throw error;
  }
}

// Main function
async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   JukeBox YouTube Audio Downloader        ║');
  console.log('╚════════════════════════════════════════════╝\n');

  try {
    // Ensure YouTube folder exists
    await ensureYouTubeFolder();

    // Parse URLs from file
    console.log(`\nReading URLs from: ${URLS_FILE}`);
    const urls = await parseURLsFile();

    if (urls.length === 0) {
      console.log('\n⚠ No valid YouTube URLs found in file.');
      return;
    }

    console.log(`\nFound ${urls.length} URL(s) to process.\n`);
    console.log('═'.repeat(50));

    // Download each URL
    const results = [];
    for (let i = 0; i < urls.length; i++) {
      const result = await downloadYouTubeAudio(urls[i], i, urls.length);
      results.push(result);

      // Small delay between downloads
      if (i < urls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Summary
    console.log('\n' + '═'.repeat(50));
    console.log('\n📊 DOWNLOAD SUMMARY');
    console.log('═'.repeat(50));

    const successful = results.filter(r => r.success && !r.skipped).length;
    const skipped = results.filter(r => r.skipped).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`✓ Successfully downloaded: ${successful}`);
    console.log(`⊘ Skipped (already exists): ${skipped}`);
    console.log(`✗ Failed: ${failed}`);
    console.log(`\nTotal files in YouTube folder: ${successful + skipped}`);

    if (failed > 0) {
      console.log('\n❌ Failed URLs:');
      results.filter(r => !r.success).forEach(r => {
        console.log(`  - ${r.url}`);
        console.log(`    Error: ${r.error}`);
      });
    }

    console.log('\n✓ Download process completed!');
    console.log(`\nYouTube audio files are stored in: ${YOUTUBE_FOLDER}`);
    console.log('\nStart the JukeBox server and toggle to "YouTube" to play these tracks.\n');

  } catch (error) {
    console.error(`\n✗ Fatal error: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { downloadYouTubeAudio, parseURLsFile, ensureYouTubeFolder };
