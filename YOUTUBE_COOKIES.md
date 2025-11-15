# YouTube Cookie Authentication for Containers

Since you're running JukeBox in a Linux container from Windows, you need to export cookies from your browser to bypass YouTube's bot detection.

## Quick Start

### Option 1: Try Without Cookies First
The code will work without cookies for many videos. Simply **restart your server** and try downloading again:

```bash
# In your screen session, stop the server (Ctrl+C)
# Then restart
npm start
```

### Option 2: Export Cookies (If Bot Detection Occurs)

If you get "Sign in to confirm you're not a bot" errors, follow these steps:

## Step 1: Export Cookies from Chrome (Windows)

1. **Install a cookie export extension** in Chrome:
   - [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)

2. **Go to YouTube** and make sure you're logged in

3. **Export cookies**:
   - Click the extension icon
   - Click "Export"
   - Save as `youtube-cookies.txt`

## Step 2: Mount Cookies to Container

Place the cookies file where your container can access it. For example:

```bash
# On your Windows host, copy to your project directory
# (Assuming your project is mounted at /home/user/JukeBox in the container)
cp youtube-cookies.txt /path/to/JukeBox/youtube-cookies.txt
```

## Step 3: Configure Environment Variable

Edit your `.env.local` file in the container:

```bash
# Add this line:
YOUTUBE_COOKIES_FILE=/home/user/JukeBox/youtube-cookies.txt
```

Or set it when running the container:

```bash
docker run -e YOUTUBE_COOKIES_FILE=/app/youtube-cookies.txt ...
```

## Step 4: Restart Server

```bash
# Stop the server (Ctrl+C in screen)
npm start
```

## Troubleshooting

### Still getting bot detection?
- Make sure you're logged into YouTube when exporting cookies
- Cookies expire - re-export if they stop working
- Try a different browser (Firefox, Edge, etc.)

### File not found errors?
- Check the path in YOUTUBE_COOKIES_FILE matches where you mounted the file
- Use absolute paths in the container

### Works without cookies?
- Great! You don't need them. YouTube's bot detection is intermittent.
- Remove the YOUTUBE_COOKIES_FILE variable if you don't need it

## Notes

- Cookies are sensitive - don't commit them to git (already in `.gitignore`)
- Re-export cookies periodically as they expire
- Each browser stores cookies differently - use the extension to export properly
