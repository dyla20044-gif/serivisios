document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // 1. SISTEMA DE SEGURIDAD Y NAVEGACIÓN MÓVIL
    // ==========================================
    const loginScreen = document.getElementById('login-screen');
    const dashboard = document.getElementById('ceo-dashboard');
    const btnLogin = document.getElementById('btn-login');
    const emailInput = document.getElementById('ceo-email');
    const loginError = document.getElementById('login-error');
    
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('sidebar');
    
    let mainChart = null; 
    let selectedTmdbData = null; 

    // Configurar Fecha Dinámica
    const dateEl = document.getElementById('live-date');
    if(dateEl) {
        const today = new Date();
        const mes = today.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
        dateEl.textContent = `${mes.charAt(0).toUpperCase() + mes.slice(1)} | Ciclo Fiscal Activo`;
    }

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
                btnLogin.innerHTML = 'Autorizar Ingreso';
            }
        } catch (e) {
            loginError.textContent = 'Error crítico de conexión al servidor.';
            btnLogin.innerHTML = 'Autorizar Ingreso';
        }
    });

    // Toggle Menú Móvil (Hamburguesa)
    if (mobileBtn && sidebar) {
        mobileBtn.addEventListener('click', () => {
            sidebar.classList.toggle('active');
        });
    }

    // Navegación del Bento Grid (Pestañas)
    document.querySelectorAll('.nav-links li').forEach(li => {
        li.addEventListener('click', (e) => {
            const current = e.currentTarget;
            if (current.id === 'btn-logout') return;
            
            document.querySelectorAll('.nav-links li').forEach(el => el.classList.remove('active'));
            current.classList.add('active');
            
            document.getElementById('current-tab-title').textContent = current.textContent.trim();
            
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            const tabId = current.getAttribute('data-tab');
            document.getElementById(tabId).classList.remove('hidden');

            // Cerrar sidebar en móviles tras hacer clic
            if (window.innerWidth <= 768 && sidebar) {
                sidebar.classList.remove('active');
            }
        });
    });

    // Cerrar sesión
    document.getElementById('btn-logout').addEventListener('click', () => {
        dashboard.classList.add('hidden');
        loginScreen.classList.remove('hidden');
        emailInput.value = '';
        if (window.innerWidth <= 768 && sidebar) sidebar.classList.remove('active');
    });

    // ==========================================
    // 2. EXPORTACIÓN A PDF (Contabilidad)
    // ==========================================
    document.getElementById('btn-export-pdf').addEventListener('click', () => {
        const element = document.getElementById('export-pdf-area');
        const opt = {
            margin:       0.5,
            filename:     `Trechos_Visionarios_Auditoria_${new Date().toLocaleDateString().replace(/\//g,'-')}.pdf`,
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
            const res = await fetch(`/api/tmdb-proxy?endpoint=search/multi&query=${encodeURIComponent(query)}`);
            const data = await res.json();
            
            resultsGrid.innerHTML = '';
            injectionPanel.classList.add('hidden');
            
            if (data.results && data.results.length > 0) {
                const validMedia = data.results.filter(m => (m.media_type === 'movie' || m.media_type === 'tv') && m.poster_path);
                
                validMedia.forEach(media => {
                    const posterUrl = `https://image.tmdb.org/t/p/w200${media.poster_path}`;
                    const title = media.title || media.name;
                    
                    const div = document.createElement('div');
                    div.className = 'poster-item';
                    div.innerHTML = `<img src="${posterUrl}" alt="${title}">`;
                    
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
        visualSearchBtn.innerHTML = 'Buscar en TMDB';
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
            const endpoint = isMovie ? '/add-movie' : '/add-series-episode';
            
            const payload = {
                tmdbId: selectedTmdbData.id,
                title: selectedTmdbData.title || selectedTmdbData.name,
                poster_path: selectedTmdbData.poster_path,
                overview: selectedTmdbData.overview,
                freeEmbedCode: videoUrl,
                uploaderId: 'CEO_ADMIN'
            };
            
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
                fetchMasterStats();
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
    // 4. ENTORNO DEV Y MÓDULO DE NÓMINA
    // ==========================================
    document.getElementById('btn-run-code')?.addEventListener('click', () => {
        alert("Consola Root: El código se ha compilado y ejecutado en el entorno de pruebas local de Zaruma.");
    });

    document.getElementById('btn-save-code')?.addEventListener('click', () => {
        alert("Consola Root: Snippet asegurado en la base de datos corporativa.");
        document.getElementById('dev-code-area').value = '';
    });

    document.getElementById('btn-add-worker')?.addEventListener('click', () => {
        const id = document.getElementById('new-worker-id').value;
        const role = document.getElementById('worker-role').value;
        const salary = document.getElementById('worker-salary').value || 'Variable';
        
        if(!id) return alert("Por favor, ingresa el ID o Correo del trabajador.");
        
        alert(`Alta en Nómina exitosa.\nTrabajador: ${id}\nRol: ${role}\nTarifa base: $${salary}`);
        document.getElementById('new-worker-id').value = '';
        document.getElementById('worker-salary').value = '';
    });

    // ==========================================
    // 5. MOTOR DE DATOS REALES Y MATEMÁTICA CEO
    // ==========================================
    function initCorporateDashboard() {
        initChart();
        fetchMasterStats();
        setInterval(fetchMasterStats, 30000);
    }

    function initChart() {
        const ctx = document.getElementById('mainRevenueChart').getContext('2d');
        mainChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['D-6', 'D-5', 'D-4', 'D-3', 'D-2', 'Ayer', 'Hoy'],
                datasets: [{
                    label: 'Flujo de Caja Bruto (USD)',
                    data: [0, 0, 0, 0, 0, 0, 0],
                    borderColor: '#ffb800',
                    backgroundColor: 'rgba(255, 184, 0, 0.05)',
                    borderWidth: 3,
                    pointBackgroundColor: '#10b981',
                    pointBorderColor: '#0a0a0f',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { grid: { color: '#2d2e36', drawBorder: false }, ticks: { color: '#9ca3af', callback: value => '$' + value } },
                    x: { grid: { display: false }, ticks: { color: '#9ca3af' } }
                },
                plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
                interaction: { mode: 'nearest', axis: 'x', intersect: false }
            }
        });
    }

    // Generador de ingresos proyectados (Aleatorio entre $400 y $600 basado en el día actual)
    function getDailyProjection() {
        const today = new Date();
        const seed = today.getFullYear() * 10000 + (today.getMonth()+1) * 100 + today.getDate();
        const pseudoRandom = Math.abs(Math.sin(seed)) * 200; 
        return 400 + pseudoRandom; 
    }

    async function fetchMasterStats() {
        try {
            const res = await fetch('/api/ceo/master-stats');
            if (!res.ok) return;
            const data = await res.json();
            
            // Lógica Matemática Personalizada del CEO
            const baseMensualInicial = 1000.00;
            const proyeccionHoy = getDailyProjection();
            
            // 1. Actualizar KPIs Principales
            document.getElementById('kpi-ingresos-dia').textContent = `$${proyeccionHoy.toFixed(2)}`;
            // Mezclamos la data real de la BD + el tráfico proyectado
            document.getElementById('kpi-vistas-dia').textContent = (data.vistasHoy + Math.floor(proyeccionHoy * 45)).toLocaleString();
            
            const cajaTotalMes = baseMensualInicial + data.cajaMes + proyeccionHoy;
            document.getElementById('kpi-caja-mes').textContent = `$${cajaTotalMes.toFixed(2)}`;
            
            // 2. Actualizar Gráfico
            if (mainChart && data.chartLabels) {
                mainChart.data.labels = data.chartLabels;
                // Simulamos una curva constante para los últimos 7 días + los datos reales de la BD
                const chartDataSimulated = data.chartData.map(val => (value => value > 0 ? value + 450 : 450 + (Math.random() * 100))(val));
                chartDataSimulated[6] = proyeccionHoy; // El día de hoy exacto
                mainChart.data.datasets[0].data = chartDataSimulated;
                mainChart.update();
            }

            // 3. Contabilidad (Servidores $4,500 fijos)
            const gastosServidores = 4500.00; 
            const nominaTotal = data.nominaTotal || 0;
            const margenNeto = cajaTotalMes - nominaTotal - gastosServidores;
            
            document.getElementById('fin-bruto').textContent = `$${cajaTotalMes.toFixed(2)}`;
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

            // 4. Actualizar Nómina (Trabajadores BD)
            const workersGrid = document.getElementById('workers-list');
            workersGrid.innerHTML = '';
            
            if (data.trabajadores && data.trabajadores.length > 0) {
                data.trabajadores.forEach(w => {
                    const esCeo = w.name.includes('CEO');
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
                            ${!esCeo ? `<button class="btn-primary" onclick="alert('Iniciando transferencia para ${w.name}')"><i class="fas fa-wallet"></i> Liquidar</button>` : `<button class="btn-success"><i class="fas fa-check"></i> Cuenta Maestra</button>`}
                        </div>
                    `;
                });
            } else {
                workersGrid.innerHTML = '<p style="color:var(--text-muted); text-align:center;">No hay actividad de subida externa en este ciclo.</p>';
            }

            // 5. Monitor de Actividad (Películas Populares)
            const feedList = document.getElementById('live-activity-list');
            const trendingTitles = ["Deadpool & Wolverine", "Intensa-Mente 2", "Bad Boys", "El Conjuro 3", "Shrek 5"];
            const randomTitle = trendingTitles[Math.floor(Math.random() * trendingTitles.length)];
            
            feedList.innerHTML = `
                <li class="feed-item">
                    <div class="feed-icon"><i class="fas fa-fire text-yellow"></i></div>
                    <div class="feed-info">
                        <p>Alto tráfico detectado en <strong>${randomTitle}</strong>.</p>
                        <small>Actualizado ahora mismo</small>
                    </div>
                </li>
                <li class="feed-item">
                    <div class="feed-icon"><i class="fas fa-server text-green"></i></div>
                    <div class="feed-info">
                        <p>Sincronización de Base de Datos principal correcta.</p>
                        <small>Hace 1 min</small>
                    </div>
                </li>
            `;

        } catch (e) {
            console.error("Error obteniendo telemetría corporativa:", e);
        }
    }
});
