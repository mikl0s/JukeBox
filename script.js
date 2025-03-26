// script.js (Client-Side for Player Page + Stats Modal)
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const audioPlayer = document.getElementById('audio-player');
    const playPauseButton = document.getElementById('play-pause-btn');
    const playPauseIcon = playPauseButton?.querySelector('i');
    const seekBar = document.getElementById('seek-bar');
    const timeIndicator = document.getElementById('time-indicator');
    const volumeBar = document.getElementById('volume-bar');
    const volumeIcon = document.getElementById('volume-icon');
    const volumeIconInner = volumeIcon?.querySelector('i');
    const playModeButton = document.getElementById('play-mode-btn');
    const playModeIcon = playModeButton?.querySelector('i');
    const playlistElement = document.getElementById('playlist');
    const currentTrackTitleElement = document.getElementById('current-track-title');
    const previousButton = document.getElementById('prev-btn');
    const nextButton = document.getElementById('next-btn');
    const downloadLink = document.getElementById('download-link');
    const visualizationStyleSelector = document.getElementById('viz-style-selector');

    // --- Stats Modal Elements ---
    const statsIconButton = document.getElementById('stats-icon-btn');
    const statsModalOverlay = document.getElementById('stats-modal-overlay');
    const statsModalContent = document.getElementById('stats-modal-content');
    const modalCloseButton = document.getElementById('modal-close-btn');
    const totalVisitsElement = document.getElementById('total-visits');
    const totalPlaysElement = document.getElementById('total-plays');
    const totalDownloadsElement = document.getElementById('total-downloads');
    const chartCanvas = document.getElementById('activityChart');
    let activityChart = null; // Chart instance
    const statsDaysDisplay = document.getElementById('stats-days-display'); // For chart title

    // --- Visualization Elements ---
    const canvas = document.getElementById('visualizer-canvas');
    const canvasContext = canvas ? canvas.getContext('2d') : null;
    let audioContext, analyser, source, dataArray, bufferLength, visualizationFrameId;
    let currentVisualizationStyle = 'bars';

    // --- State ---
    let songs = [];
    let currentSongIndex = 0;
    let isPlaying = false;
    let playMode = 'repeat-all';
    let previousVolume = 1;
    let isSeeking = false;
    let isTrackedForPlay = false;
    let prefixToRemove = null; // Will be fetched from server
    let debugLogging = false; // Default to false until config is loaded

    // --- Constants ---
    const DEFAULT_SONG_SHORT_TITLE = "Blues";
    const PLAY_TRACK_THRESHOLD = 0.5;

    // --- Helper Functions ---
    const log = (message, isError = false, isWarning = false) => {
        if (debugLogging || isError || isWarning) {
            if (isError) {
                console.error(message);
            } else if (isWarning) {
                console.warn(message);
            } else if (debugLogging) {
                console.log(message);
            }
        }
    };

    const trackVisit = async () => {
        try {
            const response = await fetch('/api/trackvisit', { method: 'POST' });
            if (response.ok) {
                log('[Client] Visit tracked.');
            } else {
                log('[Client] Failed to track visit, status: ' + response.status, false, true);
            }
        } catch (error) {
            log('[Client] Error tracking visit: ' + error, true);
        }
    };

    const trackDownload = async (filename) => {
        if (!filename) return;
        log(`[Client] Tracking download: ${filename}`);
        try {
            const response = await fetch('/api/trackdownload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename })
            });
            if (!response.ok) {
                log(`[Client] Error tracking download (${response.status})`, true);
            } else {
                log('[Client] Download tracked successfully.');
            }
        } catch (error) {
            log('[Client] Network error tracking download: ' + error, true);
        }
    };

    // Fetch Configuration (including prefixToRemove)
    async function fetchConfig() {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            const config = await response.json();
            
            // Set debug logging first before using it
            debugLogging = config.debugLogging || false;
            
            if (config.playlistPrefixFilter) {
                prefixToRemove = new RegExp(config.playlistPrefixFilter, 'i'); // Set dynamically
                log('[Client] Loaded prefixToRemove from config: ' + config.playlistPrefixFilter);
            } else {
                prefixToRemove = null; // No prefix removal if not defined
                log('[Client] No prefix removal configured');
            }
            
            log('[Client] Debug logging enabled');
        } catch (error) {
            log('[Client] Error fetching config: ' + error, true); // Always log config fetch errors
            prefixToRemove = null; // No fallback, just don't remove anything
            debugLogging = false; // Default to false if config fetch fails
        }
    }

    // --- Modal Functions ---
    function showStatsModal() {
        if (!statsModalOverlay) {
            log("Stats modal overlay not found!", false, true);
            return;
        }
        fetchAndShowStats(); // Fetch data when modal is opened
        statsModalOverlay.classList.remove('hidden');
    }

    function hideStatsModal() {
        if (!statsModalOverlay) {
            log("Stats modal overlay not found!", false, true);
            return;
        }
        statsModalOverlay.classList.add('hidden');
    }

    async function fetchAndShowStats() {
        if (!totalVisitsElement || !statsDaysDisplay) {
            log("Stats modal elements not found!", false, true);
            return;
        }
        totalVisitsElement.textContent = 'Loading...';
        if (activityChart) {
            activityChart.destroy();
            activityChart = null;
        } // Clear old chart

        try {
            const response = await fetch('/api/stats');
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            const stats = await response.json();
            renderStatsInModal(stats);
        } catch (error) {
            log('Error fetching stats: ' + error, true);
            totalVisitsElement.textContent = 'Error';
        }
    }

    function renderStatsInModal(stats) {
        if (!totalVisitsElement || !statsDaysDisplay) return;
        totalVisitsElement.textContent = stats.totalVisits || 0;
        
        // Calculate total plays and downloads
        let totalPlays = 0;
        let totalDownloads = 0;
        
        if (!stats.tracks || stats.tracks.length === 0) {
            // No track data
        } else {
            stats.tracks.forEach(track => {
                // Add to totals
                totalPlays += track.play_count || 0;
                totalDownloads += track.download_count || 0;
            });
        }
        
        // Update total plays and downloads in the summary section
        if (totalPlaysElement) totalPlaysElement.textContent = totalPlays;
        if (totalDownloadsElement) totalDownloadsElement.textContent = totalDownloads;
        
        statsDaysDisplay.textContent = stats.dailyData?.labels?.length || '?';
        renderChartInModal(stats.dailyData);
    }

    function renderChartInModal(dailyData) {
        if (!dailyData || !chartCanvas) {
            log("Missing daily data or chart canvas for rendering.", false, true);
            return;
        }
        const context = chartCanvas.getContext('2d');
        if (activityChart) activityChart.destroy();

        activityChart = new Chart(context, {
            type: 'bar',
            data: {
                labels: dailyData.labels || [],
                datasets: [
                    {
                        label: 'Visits',
                        data: dailyData.visits || [],
                        backgroundColor: 'rgba(0, 188, 212, 0.6)',
                        borderColor: 'rgba(0, 188, 212, 1)',
                        borderWidth: 1,
                        order: 3
                    },
                    {
                        label: 'Plays',
                        data: dailyData.plays || [],
                        backgroundColor: 'rgba(255, 64, 129, 0.6)',
                        borderColor: 'rgba(255, 64, 129, 1)',
                        borderWidth: 1,
                        order: 2
                    },
                    {
                        label: 'Downloads',
                        data: dailyData.downloads || [],
                        backgroundColor: 'rgba(255, 235, 59, 0.6)',
                        borderColor: 'rgba(255, 235, 59, 1)',
                        borderWidth: 1,
                        order: 1
                    }
                ]
            },
            options: {
                responsive: true,
                scales: {
                    y: { beginAtZero: true, ticks: { color: '#bdbdbd', stepSize: 1 }, grid: { color: 'rgba(255, 255, 255, 0.1)' } },
                    x: { ticks: { color: '#bdbdbd' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } }
                },
                plugins: { legend: { labels: { color: '#e0e0e0' } } }
            }
        });
    }

    // --- Core Player Functions ---
    function disableControls() {
        log("[Client] Disabling controls...");
        if (playPauseButton) playPauseButton.disabled = true;
        if (seekBar) seekBar.disabled = true;
        if (previousButton) previousButton.disabled = true;
        if (nextButton) nextButton.disabled = true;
    }

    function enableControls() {
        log("[Client] Enabling controls...");
        if (songs.length > 0) {
            if (playPauseButton) playPauseButton.disabled = false;
            if (seekBar) seekBar.disabled = false;
            if (previousButton) previousButton.disabled = false;
            if (nextButton) nextButton.disabled = false;
        }
    }

    // Check if title needs scrolling and apply animation if needed
    function checkTitleScrolling() {
        if (!currentTrackTitleElement) return;
        
        // Remove scrolling class first to get accurate width measurement
        currentTrackTitleElement.classList.remove('scrolling-title');
        
        // Get the width of the title and its container
        const titleContainer = currentTrackTitleElement.parentElement;
        const titleWidth = currentTrackTitleElement.scrollWidth;
        const containerWidth = titleContainer.clientWidth;
        
        // If title is wider than its container, add scrolling class
        if (titleWidth > containerWidth) {
            currentTrackTitleElement.classList.add('scrolling-title');
            log(`[Client] Title scrolling activated (${titleWidth}px > ${containerWidth}px)`);
        } else {
            log(`[Client] Title fits container (${titleWidth}px <= ${containerWidth}px)`);
        }
    }

    async function fetchPlaylist() {
        log("[Client] Fetching playlist...");
        try {
            const response = await fetch('/api/music');
            if (!response.ok) {
                let errorMessage = `HTTP error! ${response.status}`;
                try {
                    const data = await response.json();
                    errorMessage += ` - ${data.error || response.statusText}`;
                } catch {}
                throw new Error(errorMessage);
            }
            const fetchedSongs = await response.json();
            if (!Array.isArray(fetchedSongs)) throw new Error("Invalid format.");
            log(`[Client] Received ${fetchedSongs.length} sorted songs data.`);

            songs = fetchedSongs.map(data => {
                const filename = data?.filename;
                if (typeof filename !== 'string' || filename.trim() === '') {
                    log('[Client] Invalid filename data: ' + data, false, true);
                    return null;
                }
                return { ...data, title: filename.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) };
            }).filter(Boolean);

            if (songs.length > 0) {
                let defaultIndex = 0;
                const bluesIndex = songs.findIndex(song => prefixToRemove ? song.title.replace(prefixToRemove, '') === DEFAULT_SONG_SHORT_TITLE : song.title === DEFAULT_SONG_SHORT_TITLE);
                if (bluesIndex !== -1) {
                    defaultIndex = bluesIndex;
                    log(`[Client] Found "${DEFAULT_SONG_SHORT_TITLE}" at ${bluesIndex}`);
                } else {
                    log(`[Client] "${DEFAULT_SONG_SHORT_TITLE}" not found, using first.`);
                }
                currentSongIndex = loadFromLocalStorage() || defaultIndex;
                populatePlaylist();
                loadSong(currentSongIndex);
            } else {
                displayPlaylistMessage("No MP3 files found.");
                disableControls();
            }
        } catch (error) {
            log("[Client] Error fetching playlist: " + error, true);
            displayPlaylistMessage(`Error: ${error.message}`);
            if (currentTrackTitleElement) currentTrackTitleElement.textContent = "Error";
            disableControls();
        }
    }

    function displayPlaylistMessage(message) {
        if (playlistElement) playlistElement.innerHTML = `<div class="loading-error">${message}</div>`;
        if (currentTrackTitleElement) currentTrackTitleElement.textContent = "No Track Loaded";
        if (timeIndicator) timeIndicator.textContent = '0:00 / 0:00';
        if (seekBar) seekBar.value = 0;
    }

    function initAudioContext() {
        if (!audioContext) {
            try {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                analyser = audioContext.createAnalyser();
                analyser.fftSize = 256;
                bufferLength = analyser.frequencyBinCount;
                dataArray = new Uint8Array(bufferLength);
                if (!source || source.mediaElement !== audioPlayer) {
                    if (audioPlayer) {
                        source = audioContext.createMediaElementSource(audioPlayer);
                        source.connect(analyser);
                        analyser.connect(audioContext.destination);
                    } else {
                        log("Cannot create media element source: audioPlayer missing.", false, true);
                        return;
                    }
                }
                log("[Client] AudioContext initialized.");
            } catch (error) {
                log("[Client] Error initializing AudioContext: " + error, true);
                alert("AudioContext not supported. Visualization disabled.");
                if (visualizationStyleSelector) visualizationStyleSelector.disabled = true;
            }
        }
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().catch(error => log("[Client] Error resuming AudioContext: " + error, true));
        }
    }

    function loadSong(index) {
        log(`[Client] Attempting loadSong for index: ${index}`);
        if (index < 0 || index >= songs.length) {
            log(`[Client] loadSong Error: Invalid index ${index} / ${songs.length}`, false, true);
            pauseSong();
            if (currentTrackTitleElement) currentTrackTitleElement.textContent = "Error: Invalid Index";
            if (downloadLink) downloadLink.href = "#";
            return;
        }
        currentSongIndex = index;
        const song = songs[currentSongIndex];
        if (!song) {
            log(`[Client] loadSong Error: No song object at index ${currentSongIndex}.`, false, true);
            pauseSong();
            if (currentTrackTitleElement) currentTrackTitleElement.textContent = "Error: Missing Data";
            if (downloadLink) downloadLink.href = "#";
            return;
        }
        const songFileName = song.filename;
        if (typeof songFileName !== 'string' || songFileName.trim() === '') {
            log(`[Client] loadSong Error: Invalid filename property at index ${currentSongIndex}. Value: "${songFileName}"`, false, true);
            pauseSong();
            if (currentTrackTitleElement) currentTrackTitleElement.textContent = "Error: Invalid File";
            if (downloadLink) downloadLink.href = "#";
            return;
        }

        log(`[Client] loadSong: Checks passed index ${currentSongIndex}, filename: ${songFileName}`);
        const songUrl = `/music/${songFileName}.mp3`;
        if (audioPlayer) audioPlayer.src = songUrl;
        if (currentTrackTitleElement) currentTrackTitleElement.textContent = song.title;
        if (downloadLink) downloadLink.href = songUrl;
        if (downloadLink) downloadLink.setAttribute('download', `${songFileName}.mp3`);
        updatePlaylistUI();
        if (seekBar) {
            seekBar.value = 0;
            seekBar.max = 100;
        }
        if (timeIndicator) timeIndicator.textContent = '0:00 / 0:00';
        isTrackedForPlay = false;
        log(`[Client] Successfully set src: ${audioPlayer?.src}`);
        enableControls();
        checkTitleScrolling();
        saveToLocalStorage(); // Save when song changes
    }

    function playSong() {
        if (!audioPlayer?.src || audioPlayer.src.endsWith('/undefined.mp3') || !audioPlayer.src.includes('.mp3') || songs.length === 0) {
            log("[Client] playSong: Cannot play - invalid src or empty playlist.", false, true);
            if (songs.length > 0 && currentSongIndex < songs.length) {
                log("[Client] playSong: Attempting to reload current song data.");
                loadSong(currentSongIndex);
            }
            return;
        }
        initAudioContext();
        if (!audioPlayer) {
            log("playSong: audioPlayer element missing!", false, true);
            return;
        }
        audioPlayer.play().then(() => {
            isPlaying = true;
            if (playPauseIcon) {
                playPauseIcon.classList.remove('fa-play');
                playPauseIcon.classList.add('fa-pause');
            }
            startVisualization();
        }).catch(error => {
            log("[Client] Error playing audio: " + error, true);
            if (error.name === 'NotAllowedError') alert('Playback requires user interaction. Click play again.');
            else alert(`Error playing file: ${error.message}`);
            pauseSong();
        });
    }

    function pauseSong() {
        if (audioPlayer) audioPlayer.pause();
        isPlaying = false;
        if (playPauseIcon) {
            playPauseIcon.classList.remove('fa-pause');
            playPauseIcon.classList.add('fa-play');
        }
        stopVisualization();
    }

    function togglePlayPause() {
        if (!audioPlayer?.src && songs.length > 0) loadSong(currentSongIndex);
        if (!audioContext) initAudioContext();
        if (isPlaying) pauseSong();
        else playSong();
    }

    function previousSong() {
        if (songs.length <= 1) return;
        let newIndex;
        if (playMode === 'randomize') {
            newIndex = getRandomIndex();
        } else {
            newIndex = (currentSongIndex - 1 + songs.length) % songs.length;
        }
        loadSong(newIndex);
        playSong();
    }

    function nextSong() {
        if (songs.length <= 1) return;
        let newIndex;
        if (playMode === 'randomize') {
            newIndex = getRandomIndex();
        } else {
            newIndex = (currentSongIndex + 1) % songs.length;
        }
        loadSong(newIndex);
        playSong();
    }

    function getRandomIndex() {
        if (songs.length <= 1) return 0;
        let newIndex;
        do {
            newIndex = Math.floor(Math.random() * songs.length);
        } while (newIndex === currentSongIndex && songs.length > 1);
        return newIndex;
    }

    function handleSongEnd() {
        stopVisualization();
        if (playMode === 'repeat-one') {
            if (audioPlayer) audioPlayer.currentTime = 0;
            playSong();
        } else {
            nextSong();
        }
    }

    function updateProgress() {
        if (isNaN(audioPlayer?.duration) || audioPlayer.duration <= 0 || isSeeking) return;
        const currentTime = audioPlayer.currentTime;
        const duration = audioPlayer.duration;
        const ratio = currentTime / duration;
        if (isPlaying && seekBar) seekBar.value = currentTime;
        if (timeIndicator) timeIndicator.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
        if (!isTrackedForPlay && isPlaying && ratio >= PLAY_TRACK_THRESHOLD) {
            isTrackedForPlay = true;
            if (songs[currentSongIndex] && songs[currentSongIndex].filename) {
                trackPlay(songs[currentSongIndex].filename);
            } else {
                log('[Client] Cannot track play, invalid song at ' + currentSongIndex, false, true);
            }
        }
    }

    async function trackPlay(filename) {
        if (!filename) return;
        log(`[Client] Tracking play: ${filename}`);
        try {
            const response = await fetch('/api/trackplay', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename })
            });
            if (!response.ok) {
                log(`[Client] Error tracking play (${response.status})`, true);
            } else {
                log('[Client] Play tracked successfully.');
            }
        } catch (error) {
            log('[Client] Network error tracking play: ' + error, true);
        }
    }

    function formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return '0:00';
        const minutes = Math.floor(seconds / 60);
        const secondsRemaining = Math.floor(seconds % 60);
        return `${minutes}:${secondsRemaining < 10 ? '0' : ''}${secondsRemaining}`;
    }

    function setSeek(value) {
        if (!isNaN(audioPlayer?.duration)) {
            if (audioPlayer) audioPlayer.currentTime = value;
        }
    }

    function setVolume(value) {
        const newVolume = parseFloat(value);
        if (audioPlayer) audioPlayer.volume = newVolume;
        updateVolumeIcon(newVolume);
    }

    function toggleMute() {
        if (!audioPlayer) return;
        if (audioPlayer.volume > 0) {
            previousVolume = audioPlayer.volume;
            audioPlayer.volume = 0;
            if (volumeBar) volumeBar.value = 0;
            updateVolumeIcon(0);
        } else {
            const restoreVolume = previousVolume > 0 ? previousVolume : 0.5;
            audioPlayer.volume = restoreVolume;
            if (volumeBar) volumeBar.value = restoreVolume;
            updateVolumeIcon(restoreVolume);
        }
    }

    function updateVolumeIcon(volume) {
        if (volumeIconInner) {
            volumeIconInner.classList.remove('fa-volume-up', 'fa-volume-down', 'fa-volume-mute', 'fa-volume-off');
            if (volume === 0) {
                volumeIconInner.classList.add('fa-volume-off');
            } else if (volume < 0.5) {
                volumeIconInner.classList.add('fa-volume-down');
            } else {
                volumeIconInner.classList.add('fa-volume-up');
            }
        }
    }

    function changePlayMode() {
        if (!playModeButton || !playModeIcon) return;
        if (playMode === 'repeat-all') {
            playMode = 'repeat-one';
        } else if (playMode === 'repeat-one') {
            playMode = 'randomize';
        } else {
            playMode = 'repeat-all';
        }
        updatePlayModeIcon();
        saveToLocalStorage(); // Save play mode
    }

    function updatePlayModeIcon() {
        if (!playModeButton || !playModeIcon) return;
        playModeButton.classList.remove('mode-repeat-one', 'mode-randomize');
        playModeIcon.classList.remove('fa-random');
        playModeIcon.classList.add('fa-repeat');
        if (playMode === 'repeat-one') {
            playModeButton.title = 'Repeat One';
            playModeButton.classList.add('mode-repeat-one');
        } else if (playMode === 'randomize') {
            playModeButton.title = 'Randomize';
            playModeIcon.classList.remove('fa-repeat');
            playModeIcon.classList.add('fa-random');
            playModeButton.classList.add('mode-randomize');
        } else {
            playModeButton.title = 'Repeat All';
        }
        log("[Client] Play mode: " + playMode);
    }

    function populatePlaylist() {
        if (!playlistElement) return;
        playlistElement.innerHTML = '';
        if (songs.length === 0) {
            playlistElement.innerHTML = '<div class="playlist-item-loading">No songs found.</div>';
            return;
        }

        songs.forEach((song, index) => {
            const playlistItem = document.createElement('div');
            playlistItem.className = 'playlist-item';
            if (index === currentSongIndex) playlistItem.classList.add('active');
            playlistItem.dataset.index = index;

            const icon = document.createElement('i');
            icon.className = 'fas fa-music';
            playlistItem.appendChild(icon);

            // Create title container for scrolling
            const titleContainer = document.createElement('div');
            titleContainer.className = 'playlist-item-title-container';
            
            const title = document.createElement('span');
            title.className = 'playlist-item-title';
            const displayTitle = prefixToRemove ? song.title.replace(prefixToRemove, '') : song.title;
            title.textContent = displayTitle;
            titleContainer.appendChild(title);
            playlistItem.appendChild(titleContainer);

            // Check if title needs scrolling
            setTimeout(() => {
                if (title.scrollWidth > titleContainer.clientWidth) {
                    title.classList.add('scrolling-title');
                }
            }, 100); // Small delay to ensure DOM is fully rendered

            const count = document.createElement('span');
            count.className = 'playlist-item-count';
            count.textContent = `${song.play_count || 0} plays`;
            playlistItem.appendChild(count);

            playlistItem.addEventListener('click', () => {
                if (index !== currentSongIndex) {
                    loadSong(index);
                    playSong();
                } else if (!isPlaying) {
                    playSong();
                } else {
                    pauseSong();
                }
            });

            playlistElement.appendChild(playlistItem);
        });
    }

    function updatePlaylistUI() {
        if (!playlistElement) return;
        const listItems = playlistElement.querySelectorAll('div[data-index]');
        listItems.forEach(item => {
            if (parseInt(item.dataset.index, 10) === currentSongIndex) {
                item.classList.add('active');
                item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            } else {
                item.classList.remove('active');
            }
        });
    }

    // --- Local Storage Functions ---
    function saveToLocalStorage() {
        try {
            // Save current song index, volume, visualization style, and play mode
            const dataToSave = {
                currentSongIndex: currentSongIndex,
                volume: audioPlayer ? audioPlayer.volume : 1,
                visualizationStyle: visualizationStyleSelector ? visualizationStyleSelector.value : 'bars',
                playMode: playMode, // Save play mode (repeat-all, repeat-one, shuffle)
                lastUpdated: new Date().toISOString()
            };
            localStorage.setItem('jukeboxSettings', JSON.stringify(dataToSave));
            log('[Client] Settings saved to local storage');
        } catch (error) {
            log('[Client] Error saving to local storage: ' + error.message, false, true);
        }
    }

    function loadFromLocalStorage() {
        try {
            const savedData = localStorage.getItem('jukeboxSettings');
            if (savedData) {
                const parsedData = JSON.parse(savedData);
                log('[Client] Loaded settings from local storage');
                
                // Restore volume if available
                if (parsedData.volume !== undefined && audioPlayer) {
                    audioPlayer.volume = parsedData.volume;
                    if (volumeBar) volumeBar.value = parsedData.volume;
                    updateVolumeIcon(parsedData.volume);
                    log(`[Client] Restored volume: ${parsedData.volume}`);
                }
                
                // Restore visualization style if available
                if (parsedData.visualizationStyle && visualizationStyleSelector) {
                    visualizationStyleSelector.value = parsedData.visualizationStyle;
                    currentVisualizationStyle = parsedData.visualizationStyle;
                    log(`[Client] Restored visualization style: ${parsedData.visualizationStyle}`);
                }
                
                // Restore play mode if available
                if (parsedData.playMode) {
                    playMode = parsedData.playMode;
                    updatePlayModeIcon();
                    log(`[Client] Restored play mode: ${playMode}`);
                }
                
                // Return the saved song index to be used when loading the playlist
                return parsedData.currentSongIndex;
            }
        } catch (error) {
            log('[Client] Error loading from local storage: ' + error.message, false, true);
        }
        return 0; // Default to first song if nothing is saved
    }

    // --- Visualization Functions ---
    function startVisualization() {
        if (!audioContext || audioContext.state !== 'running' || !analyser) {
            log("[Client] Visualization skipped: Context/Analyser not ready.");
            return;
        }
        if (visualizationFrameId) cancelAnimationFrame(visualizationFrameId);
        log("[Client] Starting visualization: " + currentVisualizationStyle);
        drawVisualization();
    }

    function stopVisualization() {
        if (visualizationFrameId) {
            cancelAnimationFrame(visualizationFrameId);
            visualizationFrameId = null;
            clearCanvas();
            log("[Client] Visualization stopped.");
        }
    }

    function clearCanvas() {
        if (!canvasContext) return;
        try {
            canvasContext.clearRect(0, 0, canvas.width, canvas.height);
        } catch (error) {
            log("Error clearing canvas: " + error, true);
        }
    }

    function drawVisualization() {
        if (!isPlaying || !analyser) {
            stopVisualization();
            return;
        }
        visualizationFrameId = requestAnimationFrame(drawVisualization);
        try {
            if (canvas && canvasContext && (canvas.width !== canvas.offsetWidth || canvas.height !== canvas.offsetHeight)) {
                canvas.width = canvas.offsetWidth;
                canvas.height = canvas.offsetHeight;
            }
            if (!dataArray && bufferLength > 0) dataArray = new Uint8Array(bufferLength);
            if (!analyser || !dataArray) {
                log("Analyser or dataArray missing in drawVisualization", false, true);
                return;
            }
            if (currentVisualizationStyle === 'waveform') {
                analyser.getByteTimeDomainData(dataArray);
            } else {
                analyser.getByteFrequencyData(dataArray);
            }
            clearCanvas();
            switch (currentVisualizationStyle) {
                case 'bars':
                    drawBars(dataArray, bufferLength);
                    break;
                case 'bars_blocks':
                    drawBarBlocks(dataArray, bufferLength);
                    break;
                case 'waveform':
                    drawWaveform(dataArray, bufferLength);
                    break;
                default:
                    drawBars(dataArray, bufferLength);
            }
        } catch (error) {
            log("Error in drawVisualization: " + error, true);
            stopVisualization();
        }
    }

    function drawBars(data, length) {
        if (!canvas || !canvasContext || !data || !length) return;
        const barWidth = Math.max(1, (canvas.width / length) * 1.5);
        let barHeight;
        let x = 0;
        const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim();
        const secondaryColor = getComputedStyle(document.documentElement).getPropertyValue('--secondary-color').trim();
        for (let i = 0; i < length; i++) {
            barHeight = Math.max(1, (data[i] / 255) * canvas.height * 0.95);
            const gradient = canvasContext.createLinearGradient(x, canvas.height, x, canvas.height - barHeight);
            gradient.addColorStop(0, primaryColor);
            gradient.addColorStop(0.7, secondaryColor);
            canvasContext.fillStyle = gradient;
            canvasContext.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    }

    function drawBarBlocks(data, length) {
        if (!canvas || !canvasContext || !data || !length) return;
        const items = Math.max(1, Math.floor(length / 4));
        const itemWidth = canvas.width / items;
        const blockHeightUnit = canvas.height / 10;
        const gap = Math.max(1, itemWidth * 0.1);
        const blockWidth = Math.max(1, itemWidth - gap);
        const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-color');
        const secondaryColor = getComputedStyle(document.documentElement).getPropertyValue('--secondary-color');
        let x = gap / 2;
        for (let i = 0; i < items; i++) {
            let sum = 0;
            let count = 0;
            for (let j = 0; j < 4 && (i * 4 + j) < length; j++) {
                sum += data[i * 4 + j];
                count++;
            }
            let average = count > 0 ? sum / count : 0;
            let numberOfBlocks = Math.max(1, Math.floor((average / 255) * 10));
            for (let k = 0; k < numberOfBlocks; k++) {
                canvasContext.fillStyle = k < numberOfBlocks / 2 ? secondaryColor : primaryColor;
                const y = canvas.height - (k + 1) * blockHeightUnit + (blockHeightUnit * 0.1);
                const currentBlockHeight = blockHeightUnit * 0.8;
                canvasContext.fillRect(x, y, blockWidth, currentBlockHeight);
            }
            x += itemWidth;
        }
    }

    function drawWaveform(data, length) {
        if (!canvas || !canvasContext || !data || !length) return;
        const barWidth = Math.max(1, canvas.width / length);
        const centerY = canvas.height / 2;
        let x = 0;
        const gradient = canvasContext.createLinearGradient(0, 0, canvas.width, 0);
        gradient.addColorStop(0, getComputedStyle(document.documentElement).getPropertyValue('--secondary-color').trim());
        gradient.addColorStop(0.5, getComputedStyle(document.documentElement).getPropertyValue('--highlight-color').trim());
        gradient.addColorStop(1, getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim());
        canvasContext.fillStyle = gradient;
        const maxBarHeight = canvas.height / 2;
        for (let i = 0; i < length; i++) {
            const amplitude = (data[i] - 128);
            let derivedHeight = Math.abs(amplitude) * (canvas.height / 256) * 10.0;
            const barHeight = Math.min(derivedHeight, maxBarHeight);
            if (amplitude > 0) {
                canvasContext.fillRect(x, centerY - barHeight, barWidth, barHeight);
            } else {
                canvasContext.fillRect(x, centerY, barWidth, barHeight);
            }
            x += barWidth;
        }
    }

    // --- Event Listeners ---
    if (playPauseButton) playPauseButton.addEventListener('click', togglePlayPause);
    else log("Missing playPauseButton", false, true);
    if (previousButton) previousButton.addEventListener('click', previousSong);
    else log("Missing previousButton", false, true);
    if (nextButton) nextButton.addEventListener('click', nextSong);
    else log("Missing nextButton", false, true);
    if (audioPlayer) {
        audioPlayer.addEventListener('timeupdate', updateProgress);
        audioPlayer.addEventListener('loadedmetadata', () => {
            if (audioPlayer.duration) {
                if (seekBar) seekBar.max = audioPlayer.duration;
                updateProgress();
                log(`[Client] Metadata loaded: ${formatTime(audioPlayer.duration)}`);
            }
        });
        audioPlayer.addEventListener('ended', handleSongEnd);
        audioPlayer.addEventListener('volumechange', handleVolumeChange);
    } else {
        log("Missing audioPlayer", false, true);
    }
    if (seekBar) {
        seekBar.addEventListener('input', () => {
            isSeeking = true;
            if (!isNaN(audioPlayer?.duration) && timeIndicator) timeIndicator.textContent = `${formatTime(seekBar.value)} / ${formatTime(audioPlayer.duration)}`;
        });
        seekBar.addEventListener('change', () => {
            setSeek(seekBar.value);
            isSeeking = false;
            if (!isPlaying && !isNaN(audioPlayer?.duration)) {
                updateProgress();
            }
        });
    } else {
        log("Missing seekBar", false, true);
    }
    if (volumeBar) {
        volumeBar.addEventListener('input', (event) => setVolume(event.target.value));
    } else {
        log("volumeBar missing for listener", false, true);
    }
    if (volumeIcon) volumeIcon.addEventListener('click', toggleMute);
    else log("Missing volumeIcon", false, true);
    if (playModeButton) playModeButton.addEventListener('click', changePlayMode);
    else log("Missing playModeButton", false, true);
    if (visualizationStyleSelector) {
        visualizationStyleSelector.addEventListener('change', () => {
            currentVisualizationStyle = visualizationStyleSelector.value;
            if (isPlaying) {
                stopVisualization();
                startVisualization();
            }
            saveToLocalStorage(); // Save visualization preference
        });
    } else {
        log("Missing visualizationStyleSelector", false, true);
    }
    if (downloadLink) downloadLink.addEventListener('click', () => {
        if (songs.length > 0 && songs[currentSongIndex] && songs[currentSongIndex].filename) {
            trackDownload(songs[currentSongIndex].filename);
        }
    });
    else log("Missing downloadLink", false, true);
    if (statsIconButton) statsIconButton.addEventListener('click', showStatsModal);
    else log("Missing statsIconButton", false, true);
    if (modalCloseButton) modalCloseButton.addEventListener('click', hideStatsModal);
    else log("Missing modalCloseButton", false, true);
    if (statsModalOverlay) statsModalOverlay.addEventListener('click', (event) => {
        if (event.target === statsModalOverlay) {
            hideStatsModal();
        }
    });
    else log("Missing statsModalOverlay", false, true);

    // Add window resize listener to check title scrolling when window size changes
    window.addEventListener('resize', () => {
        if (currentTrackTitleElement) {
            checkTitleScrolling();
        }
    });

    function handleVolumeChange() {
        if (!audioPlayer || !volumeBar) return;
        audioPlayer.volume = volumeBar.value;
        updateVolumeIcon(audioPlayer.volume);
        saveToLocalStorage(); // Save volume setting
    }

    // --- Initialization ---
    async function initPlayer() {
        log("[Client] Initializing player...");
        disableControls();
        if (playlistElement) playlistElement.innerHTML = '<div class="playlist-item-loading">Loading playlist...</div>';
        else log("Missing playlistElement", false, true);
        if (volumeBar && audioPlayer) {
            volumeBar.value = audioPlayer.volume;
        } else {
            log("[Client] initPlayer: volumeBar or audioPlayer missing!", false, true);
        }
        updateVolumeIcon(audioPlayer ? audioPlayer.volume : 1); // Use default if player missing
        if (playModeIcon) playModeIcon.classList.add('fa-repeat');
        else log("Missing playModeIcon", false, true);
        clearCanvas();
        await fetchConfig(); // Fetch prefixToRemove before proceeding
        trackVisit();
        await fetchPlaylist();
        if (songs.length > 0) {
            loadSong(currentSongIndex);
            // Force check for title scrolling after a short delay to ensure rendering
            setTimeout(checkTitleScrolling, 500);
        }
        saveToLocalStorage(); // Save initial state
    }

    // Make sure all functions are defined before calling initPlayer
    initPlayer();

}); // End DOMContentLoaded
