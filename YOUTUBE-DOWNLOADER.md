# YouTube Audio Downloader for JukeBox

This feature extends the JukeBox music player with the ability to download audio from YouTube videos, automatically tag them with proper metadata, and play them seamlessly alongside your regular music collection.

## Features

- **Download YouTube Audio**: Convert YouTube videos to high-quality MP3 files
- **Automatic Metadata Tagging**: Extract and embed title, artist, album, and thumbnail from YouTube
- **Smart File Management**: Organize YouTube downloads in a separate folder
- **Elegant UI Toggle**: Switch between regular music and YouTube audio with a single click
- **Batch Processing**: Download multiple videos from a simple text file
- **Duplicate Detection**: Skip files that have already been downloaded

## Installation

### Prerequisites

1. **yt-dlp**: A YouTube downloader (replaces youtube-dl)
   ```bash
   # Ubuntu/Debian
   sudo apt update && sudo apt install yt-dlp

   # macOS (with Homebrew)
   brew install yt-dlp

   # Or install via pip
   pip install yt-dlp
   ```

2. **FFmpeg**: Required for audio conversion
   ```bash
   # Ubuntu/Debian
   sudo apt install ffmpeg

   # macOS (with Homebrew)
   brew install ffmpeg
   ```

### NPM Dependencies

Install the required Node.js packages:

```bash
npm install
# or
pnpm install
```

This will install:
- `yt-dlp-exec` - Node.js wrapper for yt-dlp
- `node-id3` - MP3 metadata tagging library

## Usage

### 1. Add YouTube URLs

Edit the `youtube-urls.txt` file and add one YouTube URL per line:

```
# Example youtube-urls.txt
https://www.youtube.com/watch?v=dQw4w9WgXcQ
https://www.youtube.com/watch?v=9bZkp7q19f0
https://youtu.be/jNQXAC9IVRw

# Lines starting with # are ignored as comments
# Both full URLs and youtu.be short links work
```

### 2. Download YouTube Audio

Run the downloader script:

```bash
npm run download-youtube
```

The script will:
1. Read all URLs from `youtube-urls.txt`
2. Download each video's audio
3. Convert to MP3 format (best quality)
4. Extract metadata (title, artist, album, thumbnail)
5. Tag the MP3 files with ID3v2 metadata
6. Save files to the `youtube/` folder
7. Skip files that already exist

### 3. Play YouTube Audio

1. Start the JukeBox server:
   ```bash
   npm start
   ```

2. Open your browser to `http://localhost:4000`

3. Click the **YouTube** button in the playlist header to switch sources

4. Your downloaded YouTube audio files will appear in the playlist

5. Click the **Music** button to switch back to regular music

## Download Output Example

```
╔════════════════════════════════════════════╗
║   JukeBox YouTube Audio Downloader        ║
╚════════════════════════════════════════════╝

✓ YouTube folder ready: /home/user/JukeBox/youtube

Reading URLs from: /home/user/JukeBox/youtube-urls.txt

Found 3 URL(s) to process.

══════════════════════════════════════════════════

[1/3] Processing: https://www.youtube.com/watch?v=dQw4w9WgXcQ
  Title: Rick Astley - Never Gonna Give You Up
  Artist: Rick Astley
  Duration: 3:32
  ↓ Downloading audio...
  ♫ Adding metadata tags...
  ✓ Successfully downloaded and tagged: Rick Astley - Never Gonna Give You Up.mp3

[2/3] Processing: https://www.youtube.com/watch?v=9bZkp7q19f0
  Title: PSY - GANGNAM STYLE
  Artist: officialpsy
  Duration: 4:12
  ⊘ File already exists, skipping...

══════════════════════════════════════════════════

📊 DOWNLOAD SUMMARY
══════════════════════════════════════════════════
✓ Successfully downloaded: 2
⊘ Skipped (already exists): 1
✗ Failed: 0

Total files in YouTube folder: 3

✓ Download process completed!

YouTube audio files are stored in: /home/user/JukeBox/youtube
```

## Metadata Tagging

Each downloaded MP3 file is automatically tagged with:

- **Title**: Video title from YouTube
- **Artist**: Channel/uploader name
- **Album**: "YouTube Downloads"
- **Year**: Upload year
- **Cover Art**: Video thumbnail (if available)
- **Comment**: Source URL and description snippet
- **Custom URL**: Original YouTube URL

This metadata is displayed by most music players and helps organize your collection.

## File Naming

Files are named based on the video title with:
- Invalid characters removed (e.g., `< > : " / \ | ? *`)
- Whitespace normalized
- Length limited to 200 characters
- `.mp3` extension added

Example:
- YouTube title: `Artist - Song Name (Official Video)`
- File name: `Artist - Song Name (Official Video).mp3`

## Folder Structure

```
JukeBox/
├── music/                    # Regular music files
│   ├── song1.mp3
│   └── song2.mp3
├── youtube/                  # YouTube downloads
│   ├── Video Title 1.mp3
│   └── Video Title 2.mp3
├── youtube-urls.txt         # URL list for downloads
├── youtube-downloader.js    # Downloader script
└── server.js                # JukeBox server
```

## Configuration

You can customize the YouTube folder location in `.env.local`:

```bash
# Default: youtube
YOUTUBE_FOLDER=youtube

# Or use a custom path
YOUTUBE_FOLDER=my-youtube-audio
```

## Tips & Best Practices

1. **Organize URLs**: Use comments in `youtube-urls.txt` to organize by genre, artist, or playlist
   ```
   # Electronic Music
   https://www.youtube.com/watch?v=...
   https://www.youtube.com/watch?v=...

   # Classical
   https://www.youtube.com/watch?v=...
   ```

2. **Bulk Downloads**: Add many URLs at once and let the script process them sequentially

3. **Re-run Safety**: The script automatically skips existing files, so you can safely re-run it

4. **Quality**: The script downloads the best available audio quality from YouTube

5. **Playlists**: You can extract URLs from YouTube playlists using tools like `yt-dlp --flat-playlist`

## Troubleshooting

### "yt-dlp: command not found"

Install yt-dlp:
```bash
pip install yt-dlp
# or
sudo apt install yt-dlp
```

### "ffmpeg: not found"

Install FFmpeg:
```bash
sudo apt install ffmpeg
# or
brew install ffmpeg
```

### Download fails with "HTTP Error 403"

YouTube may be blocking requests. Try:
1. Update yt-dlp: `pip install --upgrade yt-dlp`
2. Wait a few minutes and try again
3. Check if the video is available in your region

### No audio in downloaded file

Ensure FFmpeg is properly installed and accessible in your PATH.

### Thumbnails not embedding

This is usually fine - the audio will still work. Some videos don't have accessible thumbnails.

## Advanced Usage

### Direct Script Usage

You can also use the downloader module programmatically:

```javascript
const { downloadYouTubeAudio } = require('./youtube-downloader.js');

const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const result = await downloadYouTubeAudio(url, 0, 1);

if (result.success) {
  console.log('Downloaded:', result.title);
  console.log('Path:', result.path);
}
```

### Custom Output Options

Edit `youtube-downloader.js` to customize:
- Audio quality (`audioQuality: 0` for best)
- Audio format (default: `mp3`)
- Metadata fields
- Filename sanitization rules

## Legal & Ethical Considerations

- **Copyright**: Only download content you have the right to download
- **Terms of Service**: Respect YouTube's Terms of Service
- **Personal Use**: This tool is intended for personal, non-commercial use
- **Fair Use**: Consider fair use and copyright laws in your jurisdiction
- **Support Creators**: Consider supporting content creators through official channels

## Support

For issues or feature requests related to the YouTube downloader:
1. Check the troubleshooting section above
2. Ensure yt-dlp and FFmpeg are up to date
3. Open an issue on the JukeBox repository

## License

This feature is part of the JukeBox project and uses the same license.

---

**Happy listening! 🎵**
