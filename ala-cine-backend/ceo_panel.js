document.addEventListener('DOMContentLoaded', () => {
    const loginScreen = document.getElementById('login-screen');
    const dashboard = document.getElementById('ceo-dashboard');
    const btnLogin = document.getElementById('btn-login');
    const emailInput = document.getElementById('ceo-email');
    const loginError = document.getElementById('login-error');
    
    let currentTmdbData = null;

    btnLogin.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        if (!email) return;
        
        try {
            const res = await fetch('/api/ceo/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            
            const data = await res.json();
            
            if (data.success) {
                loginScreen.classList.add('hidden');
                dashboard.classList.remove('hidden');
                initDashboard();
            } else {
                loginError.textContent = 'Acceso denegado. Correo no autorizado.';
            }
        } catch (e) {
            loginError.textContent = 'Error de conexión con el servidor.';
        }
    });

    document.querySelectorAll('.nav-links li').forEach(li => {
        li.addEventListener('click', (e) => {
            if (e.currentTarget.id === 'btn-logout') return;
            
            document.querySelectorAll('.nav-links li').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            
            e.currentTarget.classList.add('active');
            const tabId = e.currentTarget.getAttribute('data-tab');
            document.getElementById(tabId).classList.remove('hidden');
        });
    });

    document.getElementById('btn-logout').addEventListener('click', () => {
        dashboard.classList.add('hidden');
        loginScreen.classList.remove('hidden');
        emailInput.value = '';
    });

    document.getElementById('btn-fetch-tmdb').addEventListener('click', async () => {
        const id = document.getElementById('tmdb-id-input').value.trim();
        if (!id) return;
        
        try {
            const res = await fetch(`/api/tmdb-proxy?endpoint=movie/${id}`);
            const data = await res.json();
            
            if (data.id) {
                currentTmdbData = data;
                document.getElementById('movie-preview').classList.remove('hidden');
                document.getElementById('preview-poster').src = `https://image.tmdb.org/t/p/w200${data.poster_path}`;
                document.getElementById('preview-title').textContent = data.title;
                document.getElementById('preview-overview').textContent = data.overview;
            }
        } catch (e) {
            alert('Error obteniendo datos de TMDB');
        }
    });

    document.getElementById('btn-publish').addEventListener('click', async () => {
        const videoUrl = document.getElementById('video-url-input').value.trim();
        if (!currentTmdbData || !videoUrl) return alert('Faltan datos o URL del video');
        
        try {
            const payload = {
                tmdbId: currentTmdbData.id,
                title: currentTmdbData.title,
                poster_path: currentTmdbData.poster_path,
                overview: currentTmdbData.overview,
                freeEmbedCode: videoUrl,
                uploaderId: 'CEO_ADMIN' 
            };
            
            const res = await fetch('/add-movie', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            const result = await res.json();
            
            if (res.ok) {
                alert('¡Contenido inyectado a Sala Cine exitosamente!');
                document.getElementById('tmdb-id-input').value = '';
                document.getElementById('video-url-input').value = '';
                document.getElementById('movie-preview').classList.add('hidden');
                currentTmdbData = null;
            } else {
                alert(result.error || 'Error al subir el contenido');
            }
        } catch (e) {
            alert('Error de conexión con el backend');
        }
    });

    function initDashboard() {
        initChart();
        loadWorkers();
    }

    function initChart() {
        const ctx = document.getElementById('revenueChart').getContext('2d');
        let baseRevenue = 500.00; 
        
        const chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', 'Ahora'],
                datasets: [{
                    label: 'Ingresos USD',
                    data: [410.50, 430.00, 460.75, 485.20, 495.00, 498.50, baseRevenue],
                    borderColor: '#ffcc00',
                    backgroundColor: 'rgba(255, 204, 0, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { grid: { color: '#33333b' }, ticks: { color: '#a0a0a8' } },
                    x: { grid: { color: '#33333b' }, ticks: { color: '#a0a0a8' } }
                },
                plugins: { legend: { labels: { color: '#ffffff' } } }
            }
        });

        setInterval(() => {
            baseRevenue += (Math.random() * 2);
            document.getElementById('ingresos-hoy').textContent = `$${baseRevenue.toFixed(2)}`;
            
            const dataArr = chart.data.datasets[0].data;
            dataArr.shift();
            dataArr.push(baseRevenue);
            
            const labelsArr = chart.data.labels;
            labelsArr.shift();
            const now = new Date();
            labelsArr.push(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`);
            
            chart.update();
        }, 6000); 
    }

    async function loadWorkers() {
        const workersGrid = document.getElementById('workers-list');
        try {
            const res = await fetch('/api/ceo/workers');
            const workers = await res.json();
            workersGrid.innerHTML = '';
            
            workers.forEach(w => {
                workersGrid.innerHTML += `
                    <div class="worker-card">
                        <div class="worker-header">
                            <div class="worker-avatar">${w.name.charAt(0)}</div>
                            <h4>${w.name}</h4>
                        </div>
                        <div class="worker-stats">
                            <p>Generado hoy: <span>$${w.earnedToday.toFixed(2)}</span></p>
                            <p>Total Subidas: <span>${w.totalUploads}</span></p>
                        </div>
                        <button class="btn-pay" onclick="alert('Iniciando pago para ${w.name}...')"><i class="fas fa-wallet"></i> Enviar Pago</button>
                    </div>
                `;
            });
        } catch (e) {
            workersGrid.innerHTML = '<p style="color:#a0a0a8; text-align:center;">Cargando estadísticas de red...</p>';
        }
    }
});
