// script.js (Client-Side for Player Page + Stats Modal)
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const audioPlayer = document.getElementById('audio-player');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const playPauseIcon = playPauseBtn?.querySelector('i');
    const seekBar = document.getElementById('seek-bar');
    const timeIndicator = document.getElementById('time-indicator');
    const volumeBar = document.getElementById('volume-bar');
    const volumeIcon = document.getElementById('volume-icon');
    const volumeIconI = volumeIcon?.querySelector('i');
    const playModeBtn = document.getElementById('play-mode-btn');
    const playModeIcon = playModeBtn?.querySelector('i');
    const playlistElement = document.getElementById('playlist');
    const currentTrackTitleElement = document.getElementById('current-track-title');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const downloadLink = document.getElementById('download-link');
    const vizStyleSelector = document.getElementById('viz-style-selector');

    // --- Stats Modal Elements ---
    const statsIconBtn = document.getElementById('stats-icon-btn');
    const statsModalOverlay = document.getElementById('stats-modal-overlay');
    const statsModalContent = document.getElementById('stats-modal-content');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const totalVisitsEl = document.getElementById('total-visits');
    const statsTableBodyEl = document.getElementById('stats-table-body');
    const chartCanvas = document.getElementById('activityChart');
    let activityChart = null; // Chart instance
    const statsDaysDisplay = document.getElementById('stats-days-display'); // For chart title

    // --- Visualization Elements ---
    const canvas = document.getElementById('visualizer-canvas');
    const canvasCtx = canvas ? canvas.getContext('2d') : null;
    let audioCtx, analyser, source, dataArray, bufferLength, visualizationFrameId;
    let currentVizStyle = 'bars';

    // --- State ---
    let songs = [];
    let currentSongIndex = 0;
    let isPlaying = false;
    let playMode = 'repeat-all';
    let previousVolume = 1;
    let isSeeking = false;
    let isTrackedForPlay = false;

    // --- Constants ---
    const prefixToRemove = /^Tuesday Boys\s+/i;
    const DEFAULT_SONG_SHORT_TITLE = "Blues";
    const PLAY_TRACK_THRESHOLD = 0.5;

    // --- Helper Functions ---
    const trackVisit = async () => { try { const res = await fetch('/api/trackvisit',{method:'POST'}); if(res.ok){ console.log('[Client] Visit tracked.'); } else { console.warn('[Client] Failed to track visit, status:', res.status); } } catch(e){ console.error('[Client] Error track visit:',e); } };
    const trackDownload = async (filename) => { if(!filename) return; console.log(`[Client] Track DL: ${filename}`); try { const r=await fetch('/api/trackdownload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename})}); if(!r.ok) console.error(`[Client] Err track DL (${r.status})`); else console.log('[Client] DL tracked OK.'); } catch(e){ console.error('[Client] Net err track DL:',e); } };

    // --- Modal Functions ---
    function showStatsModal() {
        if (!statsModalOverlay) { console.error("Stats modal overlay not found!"); return; }
        fetchAndShowStats(); // Fetch data when modal is opened
        statsModalOverlay.classList.remove('hidden');
        // document.body.style.overflow = 'hidden'; // Optional: disable body scroll
    }
    function hideStatsModal() {
        if (!statsModalOverlay) { console.error("Stats modal overlay not found!"); return; }
        statsModalOverlay.classList.add('hidden');
        // document.body.style.overflow = ''; // Optional: enable body scroll
    }

    // Fetch and Render Stats inside Modal
    async function fetchAndShowStats() {
        if (!totalVisitsEl || !statsTableBodyEl || !statsDaysDisplay) { console.error("Stats modal elements not found!"); return; }
        totalVisitsEl.textContent = 'Loading...';
        statsTableBodyEl.innerHTML = `<tr><td colspan="3">Loading...</td></tr>`;
        if (activityChart) { activityChart.destroy(); activityChart = null; } // Clear old chart

        try {
            const response = await fetch('/api/stats');
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            const stats = await response.json();
            renderStatsInModal(stats);
        } catch (error) {
            console.error('Error fetching stats:', error);
            totalVisitsEl.textContent = 'Error';
            statsTableBodyEl.innerHTML = `<tr><td colspan="3" class="loading-error">Error loading stats.</td></tr>`;
        }
    }

    // Render data into the modal elements
    function renderStatsInModal(stats) {
        if(!totalVisitsEl || !statsTableBodyEl || !statsDaysDisplay) return; // Extra safety check
        totalVisitsEl.textContent = stats.totalVisits || 0;
        statsTableBodyEl.innerHTML = ''; // Clear loading/error
        if (!stats.tracks || stats.tracks.length === 0) {
            statsTableBodyEl.innerHTML = '<tr><td colspan="3">No track data yet.</td></tr>';
        } else {
            stats.tracks.forEach(track => {
                const row = statsTableBodyEl.insertRow();
                const title = track.filename.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase());
                const shortTitle = title.replace(prefixToRemove, '');
                row.insertCell().textContent = shortTitle; row.cells[0].title = title;
                row.insertCell().textContent = track.play_count || 0;
                row.insertCell().textContent = track.download_count || 0;
            });
        }
        // Update the number of days displayed in the chart title
        statsDaysDisplay.textContent = stats.dailyData?.labels?.length || '?';
        renderChartInModal(stats.dailyData); // Render chart with data
    }

    // Render the chart inside the modal - Includes Downloads dataset
    function renderChartInModal(dailyData) {
        if (!dailyData || !chartCanvas) { console.error("Missing daily data or chart canvas for rendering."); return; }
        const ctx = chartCanvas.getContext('2d');
        if (activityChart) activityChart.destroy(); // Destroy existing chart first

        activityChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: dailyData.labels || [], // Dates from server
                datasets: [
                    {
                        label: 'Visits',
                        data: dailyData.visits || [], // Real visits data
                        backgroundColor: 'rgba(0, 188, 212, 0.6)', // Primary
                        borderColor: 'rgba(0, 188, 212, 1)',
                        borderWidth: 1,
                        order: 3
                    },
                    {
                        label: 'Plays',
                        data: dailyData.plays || [], // Real plays data
                        backgroundColor: 'rgba(255, 64, 129, 0.6)', // Secondary
                        borderColor: 'rgba(255, 64, 129, 1)',
                        borderWidth: 1,
                        order: 2
                    },
                    {
                        label: 'Downloads',
                        data: dailyData.downloads || [], // Real downloads data
                        backgroundColor: 'rgba(255, 235, 59, 0.6)', // Highlight (yellow)
                        borderColor: 'rgba(255, 235, 59, 1)',
                        borderWidth: 1,
                        order: 1
                    }
                ]
            },
            options: {
                responsive: true,
                scales: { y: { beginAtZero: true, ticks: { color: '#bdbdbd', stepSize: 1 }, grid: { color: 'rgba(255, 255, 255, 0.1)' } }, x: { ticks: { color: '#bdbdbd' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } } },
                plugins: { legend: { labels: { color: '#e0e0e0' } } }
            }
        });
    }

    // --- Core Player Functions ---

    // Disable Core Controls
    function disableControls() {
        console.log("[Client] Disabling controls...");
        if(playPauseBtn) playPauseBtn.disabled = true;
        if(seekBar) seekBar.disabled = true;
        if(prevBtn) prevBtn.disabled = true;
        if(nextBtn) nextBtn.disabled = true;
    }

    // Enable Core Controls
    function enableControls() {
        console.log("[Client] Enabling controls...");
        if(songs.length > 0) {
            if(playPauseBtn) playPauseBtn.disabled = false;
            if(seekBar) seekBar.disabled = false;
            if(prevBtn) prevBtn.disabled = false;
            if(nextBtn) nextBtn.disabled = false;
        } else {
            disableControls();
        }
    }

    // Fetch Playlist
    async function fetchPlaylist() {
        console.log("[Client] Fetching playlist...");
        try {
            const response = await fetch('/api/music');
            if (!response.ok) { let e=`HTTP err! ${response.status}`; try{const d=await response.json();e+=` - ${d.error||response.statusText}`}catch{} throw new Error(e); }
            const fetchedSongs = await response.json();
            if (!Array.isArray(fetchedSongs)) throw new Error("Invalid format.");
            console.log(`[Client] Received ${fetchedSongs.length} sorted songs data.`);

            songs = fetchedSongs.map(d => {
                const fn = d?.filename;
                if (typeof fn!=='string'||fn.trim()===''){ console.warn('[Client] Invalid filename data:', d); return null; }
                return {...d, title: fn.replace(/_/g,' ').replace(/\b\w/g, l=>l.toUpperCase())};
            }).filter(Boolean);

            if (songs.length > 0) {
                let dI=0; const bI=songs.findIndex(s => s.title.replace(prefixToRemove,'')===DEFAULT_SONG_SHORT_TITLE);
                if(bI!==-1){ dI=bI; console.log(`[Client] Found "${DEFAULT_SONG_SHORT_TITLE}" @ ${bI}`); }
                else { console.log(`[Client] "${DEFAULT_SONG_SHORT_TITLE}" not found, using first.`); }
                currentSongIndex = dI;
                populatePlaylist();
                loadSong(currentSongIndex); // Load song but controls enabled inside loadSong now
                // enableControls(); // Removed from here
            } else {
                displayPlaylistMessage("No MP3 files found.");
                disableControls();
            }
        } catch (error) {
            console.error("[Client] Error fetch playlist:", error);
            displayPlaylistMessage(`Error: ${error.message}`);
            if(currentTrackTitleElement) currentTrackTitleElement.textContent="Error";
            disableControls();
        }
    }

    // Display Message in Playlist Area
    function displayPlaylistMessage(message) {
        if (playlistElement) playlistElement.innerHTML = `<div class="loading-error">${message}</div>`;
        if (currentTrackTitleElement) currentTrackTitleElement.textContent = "No Track Loaded";
        if (timeIndicator) timeIndicator.textContent = '0:00 / 0:00';
        if (seekBar) seekBar.value = 0;
    }

    // Initialize Web Audio API Context
    function initAudioContext() {
        if (!audioCtx) {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 256;
                bufferLength = analyser.frequencyBinCount;
                dataArray = new Uint8Array(bufferLength);
                if (!source || source.mediaElement !== audioPlayer) {
                    if (audioPlayer) { // Check if audioPlayer exists
                         source = audioCtx.createMediaElementSource(audioPlayer);
                         source.connect(analyser);
                         analyser.connect(audioCtx.destination);
                    } else {
                         console.error("Cannot create media element source: audioPlayer missing.");
                         return; // Stop if no audio player
                    }
                }
                console.log("[Client] AudioContext initialized.");
            } catch (e) {
                console.error("[Client] Error initializing AudioContext:", e);
                alert("AudioContext not supported. Visualization disabled.");
                if (vizStyleSelector) vizStyleSelector.disabled = true;
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(e => console.error("[Client] Error resuming AudioContext:", e));
        }
    }

    // Load Song Data into Player
    function loadSong(index) {
        console.log(`[Client] Attempting loadSong for index: ${index}`);
        if (index < 0 || index >= songs.length) { console.error(`[Client] loadSong Error: Invalid index ${index} / ${songs.length}`); pauseSong(); if(currentTrackTitleElement) currentTrackTitleElement.textContent = "Error: Invalid Index"; if(downloadLink) downloadLink.href = "#"; return; }
        currentSongIndex = index;
        const song = songs[currentSongIndex];
        if (!song) { console.error(`[Client] loadSong Error: No song object @ index ${currentSongIndex}.`); pauseSong(); if(currentTrackTitleElement) currentTrackTitleElement.textContent = "Error: Missing Data"; if(downloadLink) downloadLink.href = "#"; return; }
        const songFileName = song.filename;
        if (typeof songFileName !== 'string' || songFileName.trim() === '') { console.error(`[Client] loadSong Error: Invalid filename property @ index ${currentSongIndex}. Value: "${songFileName}"`, song); pauseSong(); if(currentTrackTitleElement) currentTrackTitleElement.textContent = "Error: Invalid File"; if(downloadLink) downloadLink.href = "#"; return; }

        console.log(`[Client] loadSong: Checks passed index ${currentSongIndex}, filename: ${songFileName}`);
        const songUrl = `/music/${songFileName}.mp3`;
        if(audioPlayer) audioPlayer.src = songUrl;
        if(currentTrackTitleElement) currentTrackTitleElement.textContent = song.title;
        if(downloadLink) downloadLink.href = songUrl;
        if(downloadLink) downloadLink.setAttribute('download', `${songFileName}.mp3`);
        updatePlaylistUI();
        if(seekBar) { seekBar.value = 0; seekBar.max = 100; }
        if(timeIndicator) timeIndicator.textContent = '0:00 / 0:00';
        isTrackedForPlay = false;
        console.log(`[Client] Successfully set src: ${audioPlayer?.src}`);
        enableControls(); // Enable controls now that a song is successfully loaded
    }

    // Start Playback
    function playSong() {
        if (!audioPlayer?.src || audioPlayer.src.endsWith('/undefined.mp3') || !audioPlayer.src.includes('.mp3') || songs.length === 0) { console.warn("[Client] playSong: Cannot play - invalid src or empty playlist.", { src: audioPlayer?.src, songsLength: songs.length }); if (songs.length > 0 && currentSongIndex < songs.length) { console.log("[Client] playSong: Attempting to reload current song data."); loadSong(currentSongIndex); } return; }
        initAudioContext(); // Ensure audio context is ready
        if(!audioPlayer) { console.error("playSong: audioPlayer element missing!"); return; } // Safety check
        audioPlayer.play().then(() => { isPlaying = true; if(playPauseIcon){ playPauseIcon.classList.remove('fa-play'); playPauseIcon.classList.add('fa-pause');} startVisualization(); }).catch(error => { console.error("[Client] Error playing audio:", error); if(error.name === 'NotAllowedError') alert('Playback requires user interaction. Click play again.'); else alert(`Error playing file: ${error.message}`); pauseSong(); });
    }

    // Pause Playback
    function pauseSong() { if(audioPlayer) audioPlayer.pause(); isPlaying = false; if(playPauseIcon) { playPauseIcon.classList.remove('fa-pause'); playPauseIcon.classList.add('fa-play');} stopVisualization(); }

    // Toggle Play/Pause State
    function togglePlayPause() { if (!audioPlayer?.src && songs.length > 0) loadSong(currentSongIndex); if (!audioCtx) initAudioContext(); if (isPlaying) pauseSong(); else playSong(); }

    // Go to Previous Song
    function prevSong() { if (songs.length <= 1) return; let newIndex; if (playMode === 'randomize') { newIndex = getRandomIndex(); } else { newIndex = (currentSongIndex - 1 + songs.length) % songs.length; } loadSong(newIndex); playSong(); }

    // Go to Next Song
    function nextSong() { if (songs.length <= 1) return; let newIndex; if (playMode === 'randomize') { newIndex = getRandomIndex(); } else { newIndex = (currentSongIndex + 1) % songs.length; } loadSong(newIndex); playSong(); }

    // Get Random Index (avoiding current)
    function getRandomIndex() { if (songs.length <= 1) return 0; let newIndex; do { newIndex = Math.floor(Math.random() * songs.length); } while (newIndex === currentSongIndex && songs.length > 1); return newIndex; }

    // Handle Song Reaching End
    function handleSongEnd() { stopVisualization(); if (playMode === 'repeat-one') { if(audioPlayer) audioPlayer.currentTime = 0; playSong(); } else { nextSong(); } }

    // Update Progress Bar and Time Indicator, Track Play
    function updateProgress() { if (isNaN(audioPlayer?.duration)||audioPlayer.duration<=0||isSeeking) return; const cur=audioPlayer.currentTime; const dur=audioPlayer.duration; const ratio=cur/dur; if(isPlaying && seekBar) seekBar.value = cur; if(timeIndicator) timeIndicator.textContent = `${formatTime(cur)} / ${formatTime(dur)}`; if (!isTrackedForPlay && isPlaying && ratio >= PLAY_TRACK_THRESHOLD) { isTrackedForPlay = true; if (songs[currentSongIndex] && songs[currentSongIndex].filename) { trackPlay(songs[currentSongIndex].filename); } else { console.warn('[Client] Cannot track play, invalid song @', currentSongIndex); } } }

    // Send Play Tracking Data
    async function trackPlay(filename) { if (!filename) return; console.log(`[Client] Track Play: ${filename}`); try { const r=await fetch('/api/trackplay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename})}); if (!r.ok) console.error(`[Client] Err track play (${r.status})`); else console.log('[Client] Play tracked OK.'); } catch(e){ console.error('[Client] Net err track play:',e); } }

    // Format Time (seconds to M:SS)
    function formatTime(seconds) { if (isNaN(seconds) || seconds < 0) return '0:00'; const minutes = Math.floor(seconds / 60); const secs = Math.floor(seconds % 60); return `${minutes}:${secs < 10 ? '0' : ''}${secs}`; }

    // Set Audio Time from Seek Bar
    function setSeek(value) { if (!isNaN(audioPlayer?.duration)) { if(audioPlayer) audioPlayer.currentTime = value; } }

    // Set Audio Volume from Volume Bar
    function setVolume(value) { const newVolume = parseFloat(value); if(audioPlayer) audioPlayer.volume = newVolume; updateVolumeIcon(newVolume); }

    // Toggle Mute State
    function toggleMute() { if(!audioPlayer) return; if (audioPlayer.volume > 0) { previousVolume = audioPlayer.volume; audioPlayer.volume = 0; if(volumeBar) volumeBar.value = 0; updateVolumeIcon(0); } else { const restoreVolume = previousVolume > 0 ? previousVolume : 0.5; audioPlayer.volume = restoreVolume; if(volumeBar) volumeBar.value = restoreVolume; updateVolumeIcon(restoreVolume); } }

    // Update Volume Icon Based on Level
    function updateVolumeIcon(volume) { if(volumeIconI){ volumeIconI.classList.remove('fa-volume-up', 'fa-volume-down', 'fa-volume-mute', 'fa-volume-off'); if (volume === 0) { volumeIconI.classList.add('fa-volume-off'); } else if (volume < 0.5) { volumeIconI.classList.add('fa-volume-down'); } else { volumeIconI.classList.add('fa-volume-up'); } } }

    // Change Play Mode - Uses CSS classes for styling modes
    function changePlayMode() {
        if(!playModeBtn || !playModeIcon) return;
        playModeBtn.classList.remove('mode-repeat-one', 'mode-randomize');
        playModeIcon.classList.remove('fa-random'); playModeIcon.classList.add('fa-repeat');
        if (playMode === 'repeat-all') { playMode = 'repeat-one'; playModeBtn.title = 'Repeat One'; playModeBtn.classList.add('mode-repeat-one'); }
        else if (playMode === 'repeat-one') { playMode = 'randomize'; playModeBtn.title = 'Randomize'; playModeIcon.classList.remove('fa-repeat'); playModeIcon.classList.add('fa-random'); playModeBtn.classList.add('mode-randomize'); }
        else { playMode = 'repeat-all'; playModeBtn.title = 'Repeat All'; }
        console.log("[Client] Play mode:", playMode);
    }

    // Populate Playlist Grid
    function populatePlaylist() { if (!playlistElement) return; playlistElement.innerHTML = ''; if (songs.length === 0) { playlistElement.innerHTML = '<div class="playlist-item-loading">No songs loaded.</div>'; return; } songs.forEach((song, index) => { const itemDiv = document.createElement('div'); itemDiv.classList.add('playlist-item'); itemDiv.dataset.index = index; const icon = document.createElement('i'); icon.classList.add('fas', 'fa-music'); const titleSpan = document.createElement('span'); titleSpan.classList.add('playlist-item-title'); titleSpan.textContent = song.title.replace(prefixToRemove, ''); titleSpan.title = song.title; const countSpan = document.createElement('span'); countSpan.classList.add('playlist-item-count'); countSpan.textContent = `${song.play_count || 0} plays`; countSpan.title = `${song.play_count || 0} plays, ${song.download_count || 0} downloads`; itemDiv.appendChild(icon); itemDiv.appendChild(titleSpan); itemDiv.appendChild(countSpan); itemDiv.addEventListener('click', () => { if (index !== currentSongIndex) loadSong(index); playSong(); }); playlistElement.appendChild(itemDiv); }); }

    // Update Active Class on Playlist Items
    function updatePlaylistUI() { if (!playlistElement) return; const listItems = playlistElement.querySelectorAll('div[data-index]'); listItems.forEach(item => { if (parseInt(item.dataset.index, 10) === currentSongIndex) { item.classList.add('active'); item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }); } else { item.classList.remove('active'); } }); }

    // --- Visualization Functions ---
    function startVisualization() { if (!audioCtx || audioCtx.state !== 'running' || !analyser) { console.log("[Client] Viz skipped: Context/Analyser not ready."); return; } if (visualizationFrameId) cancelAnimationFrame(visualizationFrameId); console.log("[Client] Starting visualization:", currentVizStyle); drawVisualization(); }
    function stopVisualization() { if (visualizationFrameId) { cancelAnimationFrame(visualizationFrameId); visualizationFrameId = null; clearCanvas(); console.log("[Client] Viz stopped."); } }
    function clearCanvas() { if (!canvasCtx) return; try{ canvasCtx.clearRect(0, 0, canvas.width, canvas.height); } catch(e){ console.error("Error clearing canvas:", e); } }
    function drawVisualization() { if (!isPlaying || !analyser) { stopVisualization(); return; } visualizationFrameId = requestAnimationFrame(drawVisualization); try { if (canvas && canvasCtx && (canvas.width !== canvas.offsetWidth || canvas.height !== canvas.offsetHeight)) { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; } if(!dataArray && bufferLength > 0) dataArray = new Uint8Array(bufferLength); if(!analyser || !dataArray) { console.warn("Analyser or dataArray missing in drawVisualization"); return; } if (currentVizStyle === 'waveform') { analyser.getByteTimeDomainData(dataArray); } else { analyser.getByteFrequencyData(dataArray); } clearCanvas(); switch (currentVizStyle) { case 'bars': drawBars(dataArray, bufferLength); break; case 'bars_blocks': drawBarBlocks(dataArray, bufferLength); break; case 'waveform': drawWaveform(dataArray, bufferLength); break; default: drawBars(dataArray, bufferLength); } } catch(e){ console.error("Error in drawVisualization:", e); stopVisualization(); }}
    function drawBars(data, length) { if(!canvas || !canvasCtx || !data || !length) return; const barWidth = Math.max(1, (canvas.width / length) * 1.5); let barHeight; let x = 0; const pC = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim(); const sC = getComputedStyle(document.documentElement).getPropertyValue('--secondary-color').trim(); for (let i = 0; i < length; i++) { barHeight = Math.max(1, (data[i] / 255) * canvas.height * 0.95); const grad = canvasCtx.createLinearGradient(x, canvas.height, x, canvas.height - barHeight); grad.addColorStop(0, pC); grad.addColorStop(0.7, sC); canvasCtx.fillStyle = grad; canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight); x += barWidth + 1; } }
    function drawBarBlocks(data, length) { if(!canvas || !canvasCtx || !data || !length) return; const it = Math.max(1, Math.floor(length / 4)); const iW = canvas.width / it; const bHU = canvas.height / 10; const gap = Math.max(1, iW * 0.1); const bW = Math.max(1, iW - gap); const pC = getComputedStyle(document.documentElement).getPropertyValue('--primary-color'); const sC = getComputedStyle(document.documentElement).getPropertyValue('--secondary-color'); let x = gap / 2; for (let i = 0; i < it; i++) { let sum = 0; let count = 0; for (let j = 0; j < 4 && (i*4+j) < length; j++) { sum += data[i*4+j]; count++; } let avg = count>0?sum/count:0; let nB = Math.max(1, Math.floor((avg / 255)*10)); for(let k = 0; k < nB; k++) { canvasCtx.fillStyle = k<nB/2?sC:pC; const y = canvas.height - (k+1)*bHU + (bHU*0.1); const cBH = bHU*0.8; canvasCtx.fillRect(x, y, bW, cBH); } x += iW; } }
    function drawWaveform(data, length) { if(!canvas || !canvasCtx || !data || !length) return; const bW = Math.max(1, canvas.width / length); const cY = canvas.height / 2; let x = 0; const grad = canvasCtx.createLinearGradient(0,0,canvas.width,0); grad.addColorStop(0,getComputedStyle(document.documentElement).getPropertyValue('--secondary-color').trim()); grad.addColorStop(0.5,getComputedStyle(document.documentElement).getPropertyValue('--highlight-color').trim()); grad.addColorStop(1,getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim()); canvasCtx.fillStyle = grad; const mBH = canvas.height / 2; for (let i = 0; i < length; i++) { const amp = (data[i] - 128); let dH = Math.abs(amp) * (canvas.height / 256) * 10.0; const bH = Math.min(dH, mBH); if (amp > 0) { canvasCtx.fillRect(x, cY - bH, bW, bH); } else { canvasCtx.fillRect(x, cY, bW, bH); } x += bW; } }

    // --- Event Listeners ---
    if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlayPause); else console.error("Missing playPauseBtn");
    if (prevBtn) prevBtn.addEventListener('click', prevSong); else console.error("Missing prevBtn");
    if (nextBtn) nextBtn.addEventListener('click', nextSong); else console.error("Missing nextBtn");
    if (audioPlayer) { audioPlayer.addEventListener('timeupdate', updateProgress); audioPlayer.addEventListener('loadedmetadata', () => { if (!isNaN(audioPlayer.duration)) { if(seekBar) seekBar.max = audioPlayer.duration; updateProgress(); console.log(`[Client] Meta loaded: ${formatTime(audioPlayer.duration)}`); } }); audioPlayer.addEventListener('ended', handleSongEnd); audioPlayer.addEventListener('volumechange', () => { if (volumeBar && document.activeElement !== volumeBar) { volumeBar.value = audioPlayer.volume; } updateVolumeIcon(audioPlayer.volume); }); } else { console.error("Missing audioPlayer"); }
    if (seekBar) { seekBar.addEventListener('input', () => { isSeeking = true; if (!isNaN(audioPlayer?.duration) && timeIndicator) timeIndicator.textContent = `${formatTime(seekBar.value)} / ${formatTime(audioPlayer.duration)}`; }); seekBar.addEventListener('change', () => { setSeek(seekBar.value); isSeeking = false; if(!isPlaying && !isNaN(audioPlayer?.duration)) { updateProgress(); } }); } else { console.error("Missing seekBar"); }
    if (volumeBar) { volumeBar.addEventListener('input', (e) => setVolume(e.target.value)); } else { console.error("VolumeBar missing for listener"); }
    if (volumeIcon) volumeIcon.addEventListener('click', toggleMute); else console.error("Missing volumeIcon");
    if (playModeBtn) playModeBtn.addEventListener('click', changePlayMode); else console.error("Missing playModeBtn");
    if (vizStyleSelector) vizStyleSelector.addEventListener('change', (e) => { currentVizStyle = e.target.value; console.log("[Client] Viz style:", currentVizStyle); if (!isPlaying) clearCanvas(); }); else console.error("Missing vizStyleSelector");
    if (downloadLink) downloadLink.addEventListener('click', () => { if (songs.length > 0 && songs[currentSongIndex] && songs[currentSongIndex].filename) { trackDownload(songs[currentSongIndex].filename); }}); else console.error("Missing downloadLink");
    if (statsIconBtn) statsIconBtn.addEventListener('click', showStatsModal); else console.error("Missing statsIconBtn");
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', hideStatsModal); else console.error("Missing modalCloseBtn");
    if (statsModalOverlay) statsModalOverlay.addEventListener('click', (event) => { if (event.target === statsModalOverlay) { hideStatsModal(); } }); else console.error("Missing statsModalOverlay");


    // --- Initialization ---
    function initPlayer() {
        console.log("[Client] Initializing player...");
        // Call disableControls *after* ensuring its definition is encountered
        disableControls();
        if(playlistElement) playlistElement.innerHTML = '<div class="playlist-item-loading">Loading playlist...</div>'; else console.error("Missing playlistElement");
        // Check audioPlayer exists before accessing volume
        if (volumeBar && audioPlayer) { volumeBar.value = audioPlayer.volume; }
        else { console.error("[Client] initPlayer: volumeBar or audioPlayer missing!"); }
        updateVolumeIcon(audioPlayer ? audioPlayer.volume : 1); // Use default if player missing
        if (playModeIcon) playModeIcon.classList.add('fa-repeat'); else console.error("Missing playModeIcon");
        clearCanvas();
        trackVisit();
        fetchPlaylist(); // Fetch playlist, which will call loadSong and enableControls on success
    }

    // Make sure all functions are defined before calling initPlayer
    initPlayer();

}); // End DOMContentLoaded
