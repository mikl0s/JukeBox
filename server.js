// server.js
require('dotenv').config({ path: '.env.local' }); // Load .env.local variables
const express = require('express');
const fs = require('fs').promises; // Use the promise-based fs module
const path = require('path');
const loki = require('lokijs'); // Import LokiJS
const youtubeApi = require('./youtube-downloader-api'); // YouTube downloader API
const mm = require('music-metadata'); // MP3 metadata reader

const app = express();
// Use environment variable for port, fallback to 4000
const port = process.env.PORT || 4000;

const projectRoot = __dirname;
// Use environment variable for music folder name
const musicFolderName = process.env.MUSIC_FOLDER || 'music';
const musicDir = path.join(projectRoot, musicFolderName);
const youtubeFolderName = process.env.YOUTUBE_FOLDER || 'youtube';
const youtubeDir = path.join(projectRoot, youtubeFolderName);
const allowedExtension = '.mp3';
// Use environment variable for DB filename
const dbFilename = process.env.DB_FILENAME || 'jukebox.db.json';
const dbPath = path.join(projectRoot, dbFilename);
// Use environment variable for stats days, fallback to 7
const STATS_DAYS = parseInt(process.env.STATS_DAYS || '7', 10);

// --- Initialize LokiJS Database ---
let playsCollection; // Tracks totals per song { filename, play_count, download_count }
let statsCollection; // Tracks overall total visits { type: 'totalVisits', count }
let eventsCollection; // Tracks individual timestamped events { type, filename?, timestamp }
const db = new loki(dbPath, {
    adapter: new loki.LokiFsAdapter(), // Use Node.js filesystem adapter
    autoload: true, // Automatically load DB from file if exists
    autoloadCallback: databaseInitialize, // Callback after loading
    autosave: true, // Automatically save changes periodically
    autosaveInterval: 4000 // Save every 4 seconds (adjust as needed)
});

// Callback function after DB is loaded/initialized
function databaseInitialize() {
    // Initialize 'plays' collection (totals per song)
    playsCollection = db.getCollection("plays");
    if (playsCollection === null) {
        playsCollection = db.addCollection("plays", {
             unique: ['filename'], // Ensure filename is unique index
        });
        console.log('[Server] LokiJS "plays" collection created.');
    } else {
        // Ensure existing docs have download_count (simple migration)
        playsCollection.find().forEach(doc => {
            if (doc.download_count === undefined) doc.download_count = 0;
            if (doc.play_count === undefined) doc.play_count = 0; // Also ensure play_count
        });
        db.saveDatabase(); // Save potential changes immediately
        console.log('[Server] LokiJS "plays" collection loaded/verified.');
    }

    // Initialize 'stats' collection (overall total visits)
    statsCollection = db.getCollection("stats");
    if (statsCollection === null) {
        statsCollection = db.addCollection("stats");
        // Initialize total visits if collection is new
        statsCollection.insert({ type: 'totalVisits', count: 0 });
        console.log('[Server] LokiJS "stats" collection created/initialized.');
    } else {
         console.log('[Server] LokiJS "stats" collection loaded.');
         // Ensure totalVisits doc exists if collection existed but doc didn't
         if (!statsCollection.findOne({ type: 'totalVisits' })) {
             statsCollection.insert({ type: 'totalVisits', count: 0 });
             db.saveDatabase(); // Save if we had to insert it
         }
    }

     // Initialize 'events' collection (for daily tracking)
    eventsCollection = db.getCollection("events");
    if (eventsCollection === null) {
        eventsCollection = db.addCollection("events", {
            indices: ['timestamp'] // Index timestamp for efficient querying
        });
        console.log('[Server] LokiJS "events" collection created.');
    } else {
        console.log('[Server] LokiJS "events" collection loaded.');
    }

    console.log('[Server] LokiJS Database initialization complete.');
}

// --- Helper: Date Formatting ---
function getLocalDateString(date) {
    // Ensures YYYY-MM-DD format based on the server's local timezone
    // Crucially handles timezone offset to get the date *as it is on the server*
    const offset = date.getTimezoneOffset(); // Offset in minutes
    const adjustedDate = new Date(date.getTime() - (offset * 60 * 1000));
    return adjustedDate.toISOString().split('T')[0];
}

// --- Middleware ---
app.use(express.json()); // To parse JSON request bodies for POST

// --- API Endpoints ---

// GET /api/config - Expose environment variables to client
app.get('/api/config', (req, res) => {
    console.log('[Server] API request: /api/config');
    res.json({
        playlistPrefixFilter: process.env.PLAYLIST_PREFIX_FILTER || '',
        debugLogging: process.env.DEBUG_LOGGING === 'true'
    });
});

// Helper function to recursively scan directories for MP3 files
async function scanDirectoryRecursive(directory, baseDir = directory) {
    let mp3Files = [];

    try {
        const items = await fs.readdir(directory);

        for (const item of items) {
            const itemPath = path.join(directory, item);
            try {
                const stats = await fs.stat(itemPath);

                if (stats.isDirectory()) {
                    // Recursively scan subdirectory
                    const subFiles = await scanDirectoryRecursive(itemPath, baseDir);
                    mp3Files = mp3Files.concat(subFiles);
                } else if (stats.isFile() && path.extname(item).toLowerCase() === allowedExtension) {
                    // Store relative path from base directory (e.g., "Mixed/songname" or "Album1/songname")
                    const relativePath = path.relative(baseDir, itemPath);
                    // Remove .mp3 extension but keep the folder structure
                    // Convert to forward slashes for URL compatibility
                    const urlPath = relativePath.replace(/\.mp3$/i, '').replace(/\\/g, '/');
                    mp3Files.push(urlPath);
                }
            } catch (statErr) {
                console.warn(`[Server] Error stating ${itemPath}:`, statErr.message);
            }
        }
    } catch (readErr) {
        console.error(`[Server] Error reading directory "${directory}":`, readErr.message);
    }

    return mp3Files;
}

// Helper function to get music from a specific directory
async function getMusicFromDirectory(directory, source = 'music', includeMetadata = false) {
    // 1. Read directory (recursively for YouTube to scan Mixed/, Album folders, etc.)
    let currentMusicFiles = [];

    try {
        if (source === 'youtube') {
            // Recursively scan all subdirectories for YouTube source
            currentMusicFiles = await scanDirectoryRecursive(directory);
        } else {
            // For music source, only scan top level (original behavior)
            const files = await fs.readdir(directory);
            const readDirPromises = files.map(async (file) => {
                const filePath = path.join(directory, file);
                try {
                    const stats = await fs.stat(filePath);
                    if (stats.isFile() && path.extname(file).toLowerCase() === allowedExtension) {
                        return path.basename(file, allowedExtension);
                    }
                } catch (statErr) {
                    console.warn(`[Server] Error stating file ${filePath}:`, statErr.message);
                }
                return null;
            });
            currentMusicFiles = (await Promise.all(readDirPromises)).filter(Boolean);
        }
    } catch (dirErr) {
        console.error(`[Server] Error reading ${source} directory "${directory}":`, dirErr);
        return [];
    }

    // 2. Get play counts from LokiJS collection
    const playCountDocs = playsCollection.find();
    const dataMap = {};
    playCountDocs.forEach(doc => {
         if (doc.filename) {
            dataMap[doc.filename] = {
                play_count: doc.play_count || 0,
                download_count: doc.download_count || 0
            };
         }
    });

    // 3. Create combined list with source information and optional metadata
    const combinedList = await Promise.all(currentMusicFiles.map(async (filename) => {
        const item = {
            filename: filename,
            play_count: dataMap[filename]?.play_count || 0,
            download_count: dataMap[filename]?.download_count || 0,
            source: source
        };

        // Read MP3 metadata if requested
        if (includeMetadata) {
            try {
                const filePath = path.join(directory, `${filename}.mp3`);
                const metadata = await mm.parseFile(filePath, { skipCovers: true, duration: true });

                item.metadata = {
                    artist: metadata.common?.artist || metadata.common?.albumartist || 'Unknown Artist',
                    album: metadata.common?.album || 'Unknown Album',
                    title: metadata.common?.title || filename,
                    duration: metadata.format?.duration || 0,
                    bitrate: metadata.format?.bitrate ? Math.round(metadata.format?.bitrate / 1000) : 0, // Convert to kbps
                    sampleRate: metadata.format?.sampleRate || 0,
                    codec: metadata.format?.codec || 'Unknown'
                };
            } catch (metadataErr) {
                console.warn(`[Server] Error reading metadata for ${filename}:`, metadataErr.message);
                // Provide default metadata on error
                item.metadata = {
                    artist: 'Unknown',
                    album: 'Unknown',
                    title: filename,
                    duration: 0,
                    bitrate: 0,
                    sampleRate: 0,
                    codec: 'Unknown'
                };
            }
        }

        return item;
    }));

    // 4. Sort combined list primarily by play_count (desc), secondarily by filename (asc)
    combinedList.sort((a, b) => {
        if (b.play_count !== a.play_count) return b.play_count - a.play_count;
        return a.filename.localeCompare(b.filename);
    });

    return combinedList;
}

// GET /api/music - Returns sorted list of { filename, play_count, download_count, source }
// Query parameters: ?source=music|youtube (defaults to music), ?metadata=true (include MP3 metadata)
app.get('/api/music', async (req, res) => {
    const source = req.query.source || 'music';
    const includeMetadata = req.query.metadata === 'true';
    console.log(`[Server] API request: /api/music?source=${source}&metadata=${includeMetadata}`);

    if (!playsCollection) {
        console.warn('[Server] /api/music requested before DB ready.');
        return res.status(503).json({ error: 'Database initializing, please try again shortly.' });
    }

    try {
        let combinedList = [];

        if (source === 'youtube') {
            combinedList = await getMusicFromDirectory(youtubeDir, 'youtube', includeMetadata);
        } else {
            combinedList = await getMusicFromDirectory(musicDir, 'music', includeMetadata);
        }

        console.log(`[Server] Found ${combinedList.length} MP3 files from ${source}, sorted by plays.`);
        res.json(combinedList);

    } catch (error) {
        console.error("[Server] Error processing /api/music request:", error);
        res.status(500).json({ error: 'Failed to process music list.' });
    }
});

// POST /api/trackplay - Increment total count and log event
app.post('/api/trackplay', (req, res) => {
    const { filename, source } = req.body;
    if (!playsCollection || !eventsCollection) return res.status(503).json({ error: 'DB initializing' });
    if (!filename || typeof filename !== 'string' || filename.trim() === '') { return res.status(400).json({ error: 'Invalid filename.' }); }

    const trackSource = source || 'music'; // Default to music if not specified
    console.log(`[Server] Tracking play (${trackSource}): ${filename}`);
    try {
        // Increment total count
        let doc = playsCollection.findOne({ filename });
        if (doc) {
            doc.play_count = (doc.play_count || 0) + 1;
            doc.download_count = doc.download_count || 0;
            doc.source = trackSource; // Update source
            playsCollection.update(doc);
            console.log(`[Server] Incremented play count for ${filename}: ${doc.play_count}`);
        }
        else {
            doc = playsCollection.insert({ filename, play_count: 1, download_count: 0, source: trackSource });
            console.log(`[Server] Added ${filename} to plays (play count 1, source: ${trackSource})`);
        }

        // Log event
        eventsCollection.insert({ type: 'play', filename: filename, source: trackSource, timestamp: Date.now() });

        res.status(200).json({ message: 'Play tracked.' });
    } catch (e) { console.error(`[Server] Error tracking play for ${filename}:`, e); res.status(500).json({ error: 'Failed to track play.' }); }
});

// POST /api/trackdownload - Increment total count and log event
app.post('/api/trackdownload', (req, res) => {
    const { filename, source } = req.body;
    if (!playsCollection || !eventsCollection) return res.status(503).json({ error: 'DB initializing' });
    if (!filename || typeof filename !== 'string' || filename.trim() === '') { return res.status(400).json({ error: 'Invalid filename.' }); }

    const trackSource = source || 'music'; // Default to music if not specified
    console.log(`[Server] Tracking download (${trackSource}): ${filename}`);
    try {
        // Increment total count
        let doc = playsCollection.findOne({ filename });
        if (doc) {
            doc.download_count = (doc.download_count || 0) + 1;
            doc.play_count = doc.play_count || 0;
            doc.source = trackSource; // Update source
            playsCollection.update(doc);
            console.log(`[Server] Incremented download count for ${filename}: ${doc.download_count}`);
        }
        else {
            doc = playsCollection.insert({ filename, play_count: 0, download_count: 1, source: trackSource });
            console.log(`[Server] Added ${filename} to plays (download count 1, source: ${trackSource})`);
        }

        // Log event
        eventsCollection.insert({ type: 'download', filename: filename, source: trackSource, timestamp: Date.now() });

        res.status(200).json({ message: 'Download tracked.' });
    } catch (e) { console.error(`[Server] Error tracking download for ${filename}:`, e); res.status(500).json({ error: 'Failed to track download.' }); }
});

// POST /api/trackvisit - Increment total count and log event
app.post('/api/trackvisit', (req, res) => {
    if (!statsCollection || !eventsCollection) return res.status(503).json({ error: 'DB initializing' });
    try {
        // Increment total count
        let visitsDoc = statsCollection.findOne({ type: 'totalVisits' });
        if (visitsDoc) { visitsDoc.count = (visitsDoc.count || 0) + 1; statsCollection.update(visitsDoc); console.log(`[Server] Total visits incremented: ${visitsDoc.count}`); }
        else { visitsDoc = statsCollection.insert({ type: 'totalVisits', count: 1 }); console.log(`[Server] Initialized total visits: 1`); }

        // Log event
        eventsCollection.insert({ type: 'visit', timestamp: Date.now() });

        res.status(200).json({ message: 'Visit tracked.' });
    } catch (e) { console.error(`[Server] Error tracking visit:`, e); res.status(500).json({ error: 'Track visit fail.' }); }
});

// GET /api/stats - Provide REAL daily data based on config
app.get('/api/stats', (req, res) => {
    console.log(`[Server] API request: /api/stats`);
    if (!playsCollection || !statsCollection || !eventsCollection) return res.status(503).json({ error: 'DB initializing' });

    try {
        // Get total visits (for summary)
        const visitsDoc = statsCollection.findOne({ type: 'totalVisits' });
        const totalVisits = visitsDoc ? visitsDoc.count : 0;

        // Get all track totals for the table
        const tracks = playsCollection.chain()
            .find()
            .simplesort('play_count', true)
            .data()
            .map(doc => ({
                filename: doc.filename || '?',
                play_count: doc.play_count || 0,
                download_count: doc.download_count || 0,
                source: doc.source || 'music' // Include source information
            }));

        // Calculate Real Daily Data for last N days (using STATS_DAYS)
        const N_DAYS = STATS_DAYS; // Use configured value
        const dailyCounts = {}; // { 'YYYY-MM-DD': { visits: 0, plays: 0, downloads: 0 } }
        const labels = []; // Array of 'YYYY-MM-DD' strings

        const today = new Date();
        today.setHours(0, 0, 0, 0); // Start of today in server's local time

        // Generate labels and initialize counts for the last N days
        for (let i = N_DAYS - 1; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            const dateString = getLocalDateString(date); // Use helper for YYYY-MM-DD
            labels.push(dateString);
            dailyCounts[dateString] = { visits: 0, plays: 0, downloads: 0 };
        }

        // Define time range for query (start of the first day to now)
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - (N_DAYS - 1));
        const startTimestamp = startDate.getTime();

        // Query events within the time range using indexed timestamp
        const recentEvents = eventsCollection.find({ 'timestamp': { '$gte': startTimestamp } });
        console.log(`[Server] Found ${recentEvents.length} events in the last ${N_DAYS} days for stats.`);

        // Aggregate events by day
        recentEvents.forEach(event => {
            const eventDate = new Date(event.timestamp);
            const dateString = getLocalDateString(eventDate); // Get date string in server's local time

            if (dailyCounts[dateString]) { // Check if the date is within our N-day window
                if (event.type === 'visit') dailyCounts[dateString].visits++;
                if (event.type === 'play') dailyCounts[dateString].plays++;
                if (event.type === 'download') dailyCounts[dateString].downloads++;
            }
        });
        console.log(`[Server] Aggregated daily counts:`, dailyCounts);

        // Prepare data arrays for Chart.js
        const visitsData = labels.map(label => dailyCounts[label]?.visits || 0);
        const playsData = labels.map(label => dailyCounts[label]?.plays || 0);
        const downloadsData = labels.map(label => dailyCounts[label]?.downloads || 0);

        const realDailyData = {
            labels: labels,
            visits: visitsData,
            plays: playsData,
            downloads: downloadsData
        };

        // Send the real aggregated data
        res.json({
            totalVisits: totalVisits,
            tracks: tracks,
            dailyData: realDailyData
        });

    } catch (error) {
        console.error("[Server] Error fetching stats:", error);
        res.status(500).json({ error: 'Failed to fetch stats.' });
    }
});

// --- YouTube Download API ---

// GET /api/youtube/albums - Get list of albums (folders)
app.get('/api/youtube/albums', async (req, res) => {
    console.log('[Server] API request: /api/youtube/albums');
    try {
        const result = await youtubeApi.getAlbums();
        res.json(result);
    } catch (error) {
        console.error('[Server] Error getting albums:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/youtube/album/:name - Get files in specific album
app.get('/api/youtube/album/:name', async (req, res) => {
    const albumName = req.params.name;
    console.log(`[Server] API request: /api/youtube/album/${albumName}`);
    try {
        const result = await youtubeApi.getAlbumFiles(albumName);
        res.json(result);
    } catch (error) {
        console.error(`[Server] Error getting album files for ${albumName}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/youtube/detect - Detect if URL is a playlist
app.post('/api/youtube/detect', async (req, res) => {
    const { url } = req.body;
    console.log(`[Server] API request: /api/youtube/detect - ${url}`);

    if (!url || typeof url !== 'string') {
        return res.status(400).json({ success: false, error: 'Invalid URL' });
    }

    try {
        const result = await youtubeApi.detectPlaylist(url);
        res.json(result);
    } catch (error) {
        console.error('[Server] Error detecting playlist:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/youtube/download - Download videos from URLs (batch)
app.post('/api/youtube/download', async (req, res) => {
    const { urls, albumName, downloadVideo = false } = req.body;
    console.log(`[Server] API request: /api/youtube/download - ${urls?.length || 0} URL(s)`);

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ success: false, error: 'Invalid URLs array' });
    }

    try {
        // Generate download ID first
        const downloadId = youtubeApi.generateDownloadId();

        // Start batch download in background (don't await)
        youtubeApi.batchDownload(urls, {
            customAlbumName: albumName,
            includeVideo: downloadVideo,
            downloadId: downloadId
        }).then(result => {
            console.log('[Server] Batch download completed:', result);
        }).catch(error => {
            console.error('[Server] Background download error:', error);
        });

        // Immediately return the download ID so client can poll for progress
        res.json({ success: true, downloadId });

    } catch (error) {
        console.error('[Server] Error starting download:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/youtube/progress/:downloadId - Get download progress
app.get('/api/youtube/progress/:downloadId', (req, res) => {
    const { downloadId } = req.params;
    console.log(`[Server] API request: /api/youtube/progress/${downloadId}`);

    const progress = youtubeApi.getProgress(downloadId);

    if (!progress) {
        return res.json({
            success: false,
            error: 'Download ID not found or expired'
        });
    }

    res.json({
        success: true,
        progress
    });
});

// --- Serve Static Files & Routes ---
console.log(`[Server] Serving static files from root: ${projectRoot}`);
app.use(express.static(projectRoot)); // Serve HTML, CSS, JS, music files

// Route for the main player page
app.get('/', (req, res) => {
  res.sendFile(path.join(projectRoot, 'index.html'));
});

// --- Handle 404 --- (Must be last)
app.use((req, res) => {
    res.status(404).send("Sorry, can't find that!");
});

// --- Start Server & Shutdown ---
app.listen(port, () => {
    console.log(`[Server] Node.js server listening at http://localhost:${port}`);
    console.log(`[Server] Serving static files from: ${projectRoot}`);
    console.log(`[Server] Expecting music files in: ${musicDir}`);
    console.log(`[Server] Expecting YouTube audio in: ${youtubeDir}`);
    console.log(`[Server] Using LokiJS database at: ${dbPath}`);
    console.log(`[Server] Stats graph showing last ${STATS_DAYS} days.`);
    // Check if music dir exists
    fs.access(musicDir).catch(() => console.warn(`[Server] WARNING: Music directory ${musicDir} does not exist.`));
    fs.access(youtubeDir).catch(() => console.warn(`[Server] WARNING: YouTube directory ${youtubeDir} does not exist. Run 'npm run download-youtube' to create it.`));
});

// Graceful Shutdown for LokiJS
function shutdown() {
    console.log('[Server] Closing LokiJS database...');
    db.saveDatabase(saveErr => { // Ensure data is saved on shutdown
        if (saveErr) console.error('[Server] Error saving database during shutdown:', saveErr);
        else console.log('[Server] Database saved before closing.');
        db.close(closeErr => { // Close connection
            if (closeErr) console.error('[Server] Error closing LokiJS database:', closeErr);
            else console.log('[Server] LokiJS database closed.');
            process.exit(saveErr || closeErr ? 1 : 0); // Exit cleanly or with error
        });
    });
}
process.on('SIGINT', shutdown); // Handle Ctrl+C
process.on('SIGTERM', shutdown); // Handle kill commands
