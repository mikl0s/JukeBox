// server.js
require('dotenv').config({ path: '.env.local' }); // Load .env.local variables
const express = require('express');
const fs = require('fs').promises; // Use the promise-based fs module
const path = require('path');
const loki = require('lokijs'); // Import LokiJS

const app = express();
// Use environment variable for port, fallback to 4000
const port = process.env.PORT || 4000;

const projectRoot = __dirname;
// Use environment variable for music folder name
const musicFolderName = process.env.MUSIC_FOLDER || 'music';
const musicDir = path.join(projectRoot, musicFolderName);
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

// GET /api/music - Returns sorted list of { filename, play_count, download_count }
app.get('/api/music', async (req, res) => {
    console.log(`[Server] API request: /api/music`);
    if (!playsCollection) {
        console.warn('[Server] /api/music requested before DB ready.');
        return res.status(503).json({ error: 'Database initializing, please try again shortly.' });
    }

    try {
        // 1. Read directory
        let files = [];
        try {
             files = await fs.readdir(musicDir);
        } catch (dirErr) {
             console.error(`[Server] Error reading music directory "${musicDir}":`, dirErr);
             // Send empty list if directory is missing/unreadable
             return res.json([]);
        }

        // Filter valid music files (basenames without extension) - async filtering
        const readDirPromises = files.map(async (file) => {
            const filePath = path.join(musicDir, file);
            try {
                const stats = await fs.stat(filePath);
                if (stats.isFile() && path.extname(file).toLowerCase() === allowedExtension) {
                    return path.basename(file, allowedExtension);
                }
            } catch (statErr) { console.warn(`[Server] Error stating file ${filePath}:`, statErr.message); }
            return null;
        });
        const currentMusicFiles = (await Promise.all(readDirPromises)).filter(Boolean);

        // 2. Get play counts from LokiJS collection
        const playCountDocs = playsCollection.find();
        const dataMap = {};
        playCountDocs.forEach(doc => {
             if (doc.filename) { // Ensure doc has a filename property
                dataMap[doc.filename] = {
                    play_count: doc.play_count || 0,
                    download_count: doc.download_count || 0
                };
             }
        });
        console.log('[Server] Play counts retrieved from LokiJS:', Object.keys(dataMap).length);

        // 3. Create combined list, ensuring all files from dir are included
        const combinedList = currentMusicFiles.map(filename => ({
            filename: filename, // filename is guaranteed string here from filtering
            play_count: dataMap[filename]?.play_count || 0, // Safely access with optional chaining
            download_count: dataMap[filename]?.download_count || 0
        }));

        // 4. Sort combined list primarily by play_count (desc), secondarily by filename (asc)
        combinedList.sort((a, b) => {
            if (b.play_count !== a.play_count) return b.play_count - a.play_count;
            return a.filename.localeCompare(b.filename);
        });

        console.log(`[Server] Found ${combinedList.length} MP3 files, sorted by plays.`);
        res.json(combinedList); // Send array of objects

    } catch (error) {
        console.error("[Server] Error processing /api/music request:", error);
        res.status(500).json({ error: 'Failed to process music list.' });
    }
});

// POST /api/trackplay - Increment total count and log event
app.post('/api/trackplay', (req, res) => {
    const { filename } = req.body;
    if (!playsCollection || !eventsCollection) return res.status(503).json({ error: 'DB initializing' });
    if (!filename || typeof filename !== 'string' || filename.trim() === '') { return res.status(400).json({ error: 'Invalid filename.' }); }

    console.log(`[Server] Tracking play: ${filename}`);
    try {
        // Increment total count
        let doc = playsCollection.findOne({ filename });
        if (doc) { doc.play_count = (doc.play_count || 0) + 1; doc.download_count = doc.download_count || 0; playsCollection.update(doc); console.log(`[Server] Incremented play count for ${filename}: ${doc.play_count}`); }
        else { doc = playsCollection.insert({ filename, play_count: 1, download_count: 0 }); console.log(`[Server] Added ${filename} to plays (play count 1)`); }

        // Log event
        eventsCollection.insert({ type: 'play', filename: filename, timestamp: Date.now() });

        res.status(200).json({ message: 'Play tracked.' });
    } catch (e) { console.error(`[Server] Error tracking play for ${filename}:`, e); res.status(500).json({ error: 'Failed to track play.' }); }
});

// POST /api/trackdownload - Increment total count and log event
app.post('/api/trackdownload', (req, res) => {
    const { filename } = req.body;
    if (!playsCollection || !eventsCollection) return res.status(503).json({ error: 'DB initializing' });
    if (!filename || typeof filename !== 'string' || filename.trim() === '') { return res.status(400).json({ error: 'Invalid filename.' }); }

    console.log(`[Server] Tracking download: ${filename}`);
    try {
        // Increment total count
        let doc = playsCollection.findOne({ filename });
        if (doc) { doc.download_count = (doc.download_count || 0) + 1; doc.play_count = doc.play_count || 0; playsCollection.update(doc); console.log(`[Server] Incremented download count for ${filename}: ${doc.download_count}`); }
        else { doc = playsCollection.insert({ filename, play_count: 0, download_count: 1 }); console.log(`[Server] Added ${filename} to plays (download count 1)`); }

        // Log event
        eventsCollection.insert({ type: 'download', filename: filename, timestamp: Date.now() });

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
                download_count: doc.download_count || 0
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
    console.log(`[Server] Using LokiJS database at: ${dbPath}`);
    console.log(`[Server] Stats graph showing last ${STATS_DAYS} days.`);
    // Check if music dir exists
    fs.access(musicDir).catch(() => console.warn(`[Server] WARNING: Music directory ${musicDir} does not exist.`));
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
