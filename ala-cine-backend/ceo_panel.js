document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // 1. SISTEMA DE SEGURIDAD Y NAVEGACIÓN
    // ==========================================
    const loginScreen = document.getElementById('login-screen');
    const dashboard = document.getElementById('ceo-dashboard');
    const btnLogin = document.getElementById('btn-login');
    const emailInput = document.getElementById('ceo-email');
    const loginError = document.getElementById('login-error');
    
    let mainChart = null; // Instancia global del gráfico
    let selectedTmdbData = null; // Guarda la película seleccionada visualmente

    // Login corporativo
    btnLogin.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        if (!email) return;
        
        btnLogin.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
        
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
                initCorporateDashboard();
            } else {
                loginError.textContent = 'Acceso denegado. Credencial inválida.';
                btnLogin.innerHTML = 'Verificar Identidad';
            }
        } catch (e) {
            loginError.textContent = 'Error crítico de conexión al servidor.';
            btnLogin.innerHTML = 'Verificar Identidad';
        }
    });

    // Navegación del Bento Grid (Pestañas)
    document.querySelectorAll('.nav-links li').forEach(li => {
        li.addEventListener('click', (e) => {
            const current = e.currentTarget;
            if (current.id === 'btn-logout') return;
            
            // Actualizar menú
            document.querySelectorAll('.nav-links li').forEach(el => el.classList.remove('active'));
            current.classList.add('active');
            
            // Actualizar título global
            document.getElementById('current-tab-title').textContent = current.textContent.trim();
            
            // Cambiar vista
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            const tabId = current.getAttribute('data-tab');
            document.getElementById(tabId).classList.remove('hidden');
        });
    });

    // Cerrar sesión
    document.getElementById('btn-logout').addEventListener('click', () => {
        dashboard.classList.add('hidden');
        loginScreen.classList.remove('hidden');
        emailInput.value = '';
    });

    // ==========================================
    // 2. EXPORTACIÓN A PDF (Contabilidad)
    // ==========================================
    document.getElementById('btn-export-pdf').addEventListener('click', () => {
        const element = document.getElementById('export-pdf-area');
        const opt = {
            margin:       0.5,
            filename:     `Trechos_Visionarios_Reporte_${new Date().toLocaleDateString().replace(/\//g,'-')}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true, logging: false },
            jsPDF:        { unit: 'in', format: 'a4', orientation: 'landscape' }
        };
        html2pdf().set(opt).from(element).save();
    });

    // ==========================================
    // 3. BUSCADOR VISUAL Y SUBIDA DE CATÁLOGO
    // ==========================================
    const visualSearchBtn = document.getElementById('btn-visual-search');
    const visualSearchInput = document.getElementById('visual-search-input');
    const resultsGrid = document.getElementById('search-results-grid');
    const injectionPanel = document.getElementById('injection-panel');

    visualSearchBtn.addEventListener('click', async () => {
        const query = visualSearchInput.value.trim();
        if (!query) return;

        visualSearchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        try {
            // Buscamos películas y series mezcladas
            const res = await fetch(`/api/tmdb-proxy?endpoint=search/multi&query=${encodeURIComponent(query)}`);
            const data = await res.json();
            
            resultsGrid.innerHTML = '';
            injectionPanel.classList.add('hidden');
            
            if (data.results && data.results.length > 0) {
                // Filtramos personas, solo queremos películas o series con póster
                const validMedia = data.results.filter(m => (m.media_type === 'movie' || m.media_type === 'tv') && m.poster_path);
                
                validMedia.forEach(media => {
                    const posterUrl = `https://image.tmdb.org/t/p/w200${media.poster_path}`;
                    const title = media.title || media.name;
                    
                    const div = document.createElement('div');
                    div.className = 'poster-item';
                    div.innerHTML = `<img src="${posterUrl}" alt="${title}">`;
                    
                    // Al hacer clic en un póster, preparamos la inyección
                    div.addEventListener('click', () => {
                        document.querySelectorAll('.poster-item').forEach(el => el.classList.remove('selected'));
                        div.classList.add('selected');
                        
                        selectedTmdbData = media;
                        document.getElementById('inject-poster').src = posterUrl;
                        document.getElementById('inject-title').textContent = title;
                        document.getElementById('inject-overview').textContent = media.overview || 'Sin descripción disponible.';
                        
                        injectionPanel.classList.remove('hidden');
                        document.getElementById('inject-url').focus();
                    });
                    
                    resultsGrid.appendChild(div);
                });
            } else {
                resultsGrid.innerHTML = '<p style="color:var(--text-muted); grid-column: 1/-1;">No se encontraron resultados.</p>';
            }
        } catch (error) {
            alert('Error al buscar en la red de TMDB.');
        }
        visualSearchBtn.innerHTML = 'Buscar en la Red';
    });

    document.getElementById('btn-cancel-inject').addEventListener('click', () => {
        injectionPanel.classList.add('hidden');
        document.querySelectorAll('.poster-item').forEach(el => el.classList.remove('selected'));
        selectedTmdbData = null;
        document.getElementById('inject-url').value = '';
    });

    document.getElementById('btn-confirm-inject').addEventListener('click', async () => {
        const videoUrl = document.getElementById('inject-url').value.trim();
        if (!selectedTmdbData || !videoUrl) return alert('Debes proveer un enlace de video válido.');
        
        const btn = document.getElementById('btn-confirm-inject');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo...';
        
        try {
            const isMovie = selectedTmdbData.media_type === 'movie';
            const endpoint = isMovie ? '/add-movie' : '/add-series-episode'; // Si es serie, requiere lógica de episodios extra, aquí enviamos a la ruta principal adaptada
            
            const payload = {
                tmdbId: selectedTmdbData.id,
                title: selectedTmdbData.title || selectedTmdbData.name,
                poster_path: selectedTmdbData.poster_path,
                overview: selectedTmdbData.overview,
                freeEmbedCode: videoUrl,
                uploaderId: 'CEO_ADMIN' // Marca institucional
            };
            
            // Si es serie, forzamos T1 E1 como atajo rápido desde el panel CEO
            if (!isMovie) {
                payload.seasonNumber = 1;
                payload.episodeNumber = 1;
            }
            
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (res.ok) {
                alert('¡Activo inyectado exitosamente a la bóveda central!');
                document.getElementById('btn-cancel-inject').click();
                visualSearchInput.value = '';
                resultsGrid.innerHTML = '';
                fetchMasterStats(); // Refrescar los números tras subir contenido
            } else {
                const result = await res.json();
                alert(result.error || 'Error al compilar el activo.');
            }
        } catch (e) {
            alert('Error de conexión con el núcleo del servidor.');
        }
        btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Subir a Bóveda';
    });

    // ==========================================
    // 4. MOTOR DE DATOS REALES (Gráficos y KPIs)
    // ==========================================
    function initCorporateDashboard() {
        initChart();
        fetchMasterStats();
        
        // Ciclo de actualización en vivo (cada 30 segundos)
        setInterval(fetchMasterStats, 30000);
    }

    function initChart() {
        const ctx = document.getElementById('mainRevenueChart').getContext('2d');
        
        // Configuramos la estética del gráfico para que se vea como panel de Trading/Finanzas
        mainChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['D-6', 'D-5', 'D-4', 'D-3', 'D-2', 'Ayer', 'Hoy'],
                datasets: [{
                    label: 'Flujo de Caja (USD)',
                    data: [0, 0, 0, 0, 0, 0, 0], // Se llenará con la base de datos
                    borderColor: '#ffb800',
                    backgroundColor: 'rgba(255, 184, 0, 0.05)',
                    borderWidth: 3,
                    pointBackgroundColor: '#10b981',
                    pointBorderColor: '#0a0a0f',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    fill: true,
                    tension: 0.4 // Curva suave
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { 
                        grid: { color: '#2d2e36', drawBorder: false }, 
                        ticks: { color: '#9ca3af', callback: function(value) { return '$' + value; } } 
                    },
                    x: { 
                        grid: { display: false }, 
                        ticks: { color: '#9ca3af' } 
                    }
                },
                plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
                interaction: { mode: 'nearest', axis: 'x', intersect: false }
            }
        });
    }

    async function fetchMasterStats() {
        try {
            // Llamamos al nuevo Endpoint que crearemos en server.js
            const res = await fetch('/api/ceo/master-stats');
            if (!res.ok) return;
            const data = await res.json();
            
            // 1. Actualizar KPIs Principales
            document.getElementById('kpi-ingresos-dia').textContent = `$${data.ingresosHoy.toFixed(2)}`;
            document.getElementById('kpi-vistas-dia').textContent = data.vistasHoy.toLocaleString();
            document.getElementById('kpi-caja-mes').textContent = `$${data.cajaMes.toFixed(2)}`;
            
            // 2. Actualizar Gráfico
            if (mainChart && data.chartData && data.chartLabels) {
                mainChart.data.labels = data.chartLabels;
                mainChart.data.datasets[0].data = data.chartData;
                mainChart.update();
            }

            // 3. Actualizar Finanzas e Impuestos (Matemática Real)
            const gastosServidores = 4500.00; // Costo fijo proyectado en la tabla HTML
            const nominaTotal = data.nominaTotal || 0;
            const margenNeto = data.cajaMes - nominaTotal - gastosServidores;
            
            document.getElementById('fin-bruto').textContent = `$${data.cajaMes.toFixed(2)}`;
            document.getElementById('fin-nomina').textContent = `-$${nominaTotal.toFixed(2)}`;
            
            const finNetoEl = document.getElementById('fin-neto');
            finNetoEl.textContent = `$${margenNeto.toFixed(2)}`;
            if (margenNeto < 0) {
                finNetoEl.classList.remove('text-green');
                finNetoEl.classList.add('text-danger');
            } else {
                finNetoEl.classList.remove('text-danger');
                finNetoEl.classList.add('text-green');
            }

            // 4. Actualizar Nómina (Trabajadores)
            const workersGrid = document.getElementById('workers-list');
            workersGrid.innerHTML = '';
            
            if (data.trabajadores && data.trabajadores.length > 0) {
                data.trabajadores.forEach(w => {
                    const esCeo = w.id.toString() === 'CEO';
                    workersGrid.innerHTML += `
                        <div class="worker-card ${esCeo ? 'ceo-highlight' : ''}">
                            <div class="worker-header">
                                <div class="worker-avatar">${w.name.charAt(0)}</div>
                                <h4>${w.name}</h4>
                            </div>
                            <div class="worker-stats">
                                <p>Generado hoy: <span>$${w.earnedToday.toFixed(2)}</span></p>
                                <p>Fondo Acumulado (Mes): <span class="text-yellow">$${w.earnedMonth.toFixed(2)}</span></p>
                                <p>Activos Subidos: <span>${w.totalUploads}</span></p>
                            </div>
                            ${!esCeo ? `<button class="btn-pay" onclick="alert('Iniciando transferencia segura para ${w.name} por $${w.earnedMonth.toFixed(2)}')"><i class="fas fa-wallet"></i> Liquidar Saldo</button>` : `<button class="btn-success"><i class="fas fa-check"></i> Cuenta Maestra</button>`}
                        </div>
                    `;
                });
            } else {
                workersGrid.innerHTML = '<p style="color:var(--text-muted); text-align:center;">No hay actividad en la nómina este ciclo.</p>';
            }

            // 5. Monitor de Actividad en Vivo
            const feedList = document.getElementById('live-activity-list');
            if (data.actividad && data.actividad.length > 0) {
                feedList.innerHTML = '';
                data.actividad.forEach(item => {
                    feedList.innerHTML += `
                        <li class="feed-item">
                            <div class="feed-icon"><i class="fas fa-bolt"></i></div>
                            <div class="feed-info">
                                <p>${item.msg}</p>
                                <small>${item.time}</small>
                            </div>
                        </li>
                    `;
                });
            }

        } catch (e) {
            console.error("Error obteniendo telemetría corporativa:", e);
        }
    }
});
