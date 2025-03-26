// stats.js (Client-Side for Stats Page)

document.addEventListener('DOMContentLoaded', () => {
    const totalVisitsEl = document.getElementById('total-visits');
    const statsTableBodyEl = document.getElementById('stats-table-body');
    const chartCanvas = document.getElementById('activityChart');
    let activityChart = null; // To hold the chart instance

    const prefixToRemove = /^Tuesday Boys\s+/i; // Consistent formatting

    // Function to fetch stats data from the server
    async function fetchStats() {
        try {
            const response = await fetch('/api/stats');
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            const stats = await response.json();
            console.log('Received stats:', stats);
            renderStats(stats);
        } catch (error) {
            console.error('Error fetching stats:', error);
            totalVisitsEl.textContent = 'Error';
            statsTableBodyEl.innerHTML = `<tr><td colspan="3" class="loading-error">Error loading stats: ${error.message}</td></tr>`;
        }
    }

    // Function to render the fetched stats
    function renderStats(stats) {
        // Render Summary
        totalVisitsEl.textContent = stats.totalVisits || 0;

        // Render Table
        statsTableBodyEl.innerHTML = ''; // Clear loading message
        if (!stats.tracks || stats.tracks.length === 0) {
            statsTableBodyEl.innerHTML = '<tr><td colspan="3">No track data available yet.</td></tr>';
        } else {
            stats.tracks.forEach(track => {
                const row = statsTableBodyEl.insertRow();
                const title = track.filename.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                const shortTitle = title.replace(prefixToRemove, '');

                row.insertCell().textContent = shortTitle; // Display short title
                row.cells[0].title = title; // Full title on hover
                row.insertCell().textContent = track.play_count || 0;
                row.insertCell().textContent = track.download_count || 0;
            });
        }

         // Render Chart (using placeholder data for now)
         renderChart(stats.dailyData);
    }

     // Function to render the chart
     function renderChart(dailyData) {
        if (!dailyData || !chartCanvas) return;

        const ctx = chartCanvas.getContext('2d');

        // Destroy previous chart instance if exists
        if (activityChart) {
            activityChart.destroy();
        }

        activityChart = new Chart(ctx, {
            type: 'bar', // Use a bar chart
            data: {
                labels: dailyData.labels || [], // Dates
                datasets: [
                    {
                        label: 'Page Visits',
                        data: dailyData.visits || [],
                        backgroundColor: 'rgba(0, 188, 212, 0.6)', // Primary color transparent
                        borderColor: 'rgba(0, 188, 212, 1)',
                        borderWidth: 1
                    },
                    {
                        label: 'Tracks Played',
                        data: dailyData.plays || [],
                        backgroundColor: 'rgba(255, 64, 129, 0.6)', // Secondary color transparent
                        borderColor: 'rgba(255, 64, 129, 1)',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true, // Adjust as needed
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                             color: '#bdbdbd', // Text muted color for ticks
                             stepSize: 1 // Ensure integer steps if counts are low
                        },
                         grid: {
                             color: 'rgba(255, 255, 255, 0.1)' // Lighter grid lines
                         }
                    },
                    x: {
                         ticks: { color: '#bdbdbd' },
                         grid: { color: 'rgba(255, 255, 255, 0.1)' }
                    }
                },
                 plugins: {
                     legend: {
                         labels: { color: '#e0e0e0' } // Text color for legend
                     }
                 }
            }
        });
    }

    // Fetch stats when the page loads
    fetchStats();
});
