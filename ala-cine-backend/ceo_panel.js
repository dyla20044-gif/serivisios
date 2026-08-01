document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // 1. SISTEMA DE SEGURIDAD Y NAVEGACIÓN
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

    // Configurar Fecha Dinámica y Ciclo Fiscal
    function getFormattedDate() {
        const today = new Date();
        const opciones = { day: '2-digit', month: 'short', year: 'numeric' };
        return today.toLocaleDateString('es-ES', opciones).toUpperCase();
    }
    
    document.getElementById('live-date').textContent = `CICLO FISCAL: ${getFormattedDate()}`;

    // Login corporativo (Apunta al backend real)
    btnLogin.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        if (!email) return;
        
        btnLogin.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando DB...';
        
        try {
            // Se espera que el server.js devuelva éxito si el correo coincide con el del CEO
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
                loginError.textContent = 'Acceso denegado. Credencial no autorizada en MongoDB.';
                btnLogin.innerHTML = 'Autorizar Ingreso';
            }
        } catch (e) {
            // Fallback temporal para que puedas probar la interfaz visual antes de levantar el server
            console.warn("Servidor backend no detectado. Iniciando en modo interfaz (Offline).");
            loginScreen.classList.add('hidden');
            dashboard.classList.remove('hidden');
            initCorporateDashboard();
        }
    });

    // ==========================================
    // 2. UI/UX MÓVIL (TOP BAR DINÁMICO)
    // ==========================================
    if (mobileBtn && sidebar) {
        mobileBtn.addEventListener('click', () => {
            sidebar.classList.toggle('active');
        });
    }

    document.querySelectorAll('.nav-links li').forEach(li => {
        li.addEventListener('click', (e) => {
            const current = e.currentTarget;
            if (current.id === 'btn-logout') return;
            
            // UI Activa
            document.querySelectorAll('.nav-links li').forEach(el => el.classList.remove('active'));
            current.classList.add('active');
            
            const tabTitle = current.textContent.trim();
            
            // Actualizar Header PC
            document.getElementById('current-tab-title').textContent = tabTitle;
            
            // Actualizar Header Móvil Fijo
            document.getElementById('mobile-brand-text').classList.add('hidden');
            const mobileDynamic = document.getElementById('mobile-dynamic-info');
            mobileDynamic.classList.remove('hidden');
            document.getElementById('mobile-tab-title').textContent = tabTitle;
            document.getElementById('mobile-live-date').textContent = getFormattedDate();
            
            // Cambiar Tab
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            const tabId = current.getAttribute('data-tab');
            document.getElementById(tabId).classList.remove('hidden');

            // Cerrar sidebar en móviles
            if (window.innerWidth <= 768 && sidebar) {
                sidebar.classList.remove('active');
            }
        });
    });

    document.getElementById('btn-logout').addEventListener('click', () => {
        window.location.reload();
    });

    // ==========================================
    // 3. EXPORTACIÓN A PDF (Balance Financiero)
    // ==========================================
    document.getElementById('btn-export-pdf').addEventListener('click', () => {
        const element = document.getElementById('export-pdf-area');
        const opt = {
            margin:       0.5,
            filename:     `TrechosCorp_Balance_${new Date().getTime()}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true, logging: false },
            jsPDF:        { unit: 'in', format: 'a4', orientation: 'landscape' }
        };
        html2pdf().set(opt).from(element).save();
    });

    // ==========================================
    // 4. BÓVEDA DE CONTENIDO (TMDB -> MONGODB)
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
            // Llama a un endpoint proxy en tu servidor para evitar exponer API keys en el frontend
            const res = await fetch(`/api/tmdb-proxy?query=${encodeURIComponent(query)}`);
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
                        document.getElementById('inject-overview').textContent = media.overview || 'Sin descripción.';
                        
                        injectionPanel.classList.remove('hidden');
                        document.getElementById('inject-url').focus();
                    });
                    
                    resultsGrid.appendChild(div);
                });
            } else {
                resultsGrid.innerHTML = '<p class="text-muted w-100">Cero coincidencias en la red TMDB.</p>';
            }
        } catch (error) {
            resultsGrid.innerHTML = '<p class="text-danger w-100">Error de red. Verifica la conexión del servidor central.</p>';
        }
        visualSearchBtn.innerHTML = 'Buscar Activo';
    });

    document.getElementById('btn-cancel-inject').addEventListener('click', () => {
        injectionPanel.classList.add('hidden');
        document.querySelectorAll('.poster-item').forEach(el => el.classList.remove('selected'));
        selectedTmdbData = null;
        document.getElementById('inject-url').value = '';
    });

    document.getElementById('btn-confirm-inject').addEventListener('click', async () => {
        const videoUrl = document.getElementById('inject-url').value.trim();
        if (!selectedTmdbData || !videoUrl) return alert('Debes proveer un enlace de fuente cifrado o válido.');
        
        const btn = document.getElementById('btn-confirm-inject');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Escribiendo en MongoDB...';
        
        try {
            const payload = {
                tmdbId: selectedTmdbData.id,
                title: selectedTmdbData.title || selectedTmdbData.name,
                posterPath: selectedTmdbData.poster_path,
                type: selectedTmdbData.media_type,
                sourceUrl: videoUrl,
                injectedBy: 'CEO_Levin'
            };
            
            const res = await fetch('/api/ceo/vault/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (res.ok) {
                alert('¡Activo compilado e inyectado a la base de datos de producción con éxito!');
                document.getElementById('btn-cancel-inject').click();
                visualSearchInput.value = '';
                resultsGrid.innerHTML = '';
            } else {
                throw new Error("Error en DB");
            }
        } catch (e) {
            alert('Atención: El servidor backend (Node) no está respondiendo. La inyección se abortó.');
        }
        btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Escribir en MongoDB';
    });

    // ==========================================
    // 5. MÓDULO DE RECURSOS HUMANOS (CRUD)
    // ==========================================
    document.getElementById('hr-add-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('hr-real-name').value;
        const telegramId = document.getElementById('hr-telegram-id').value;
        const role = document.getElementById('hr-role').value;
        const salary = document.getElementById('hr-salary').value;
        
        const btn = document.getElementById('btn-add-worker');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registrando...';
        
        try {
            const res = await fetch('/api/ceo/workers/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, telegramId, role, salary })
            });
            
            if (res.ok) {
                alert(`Alta confirmada en MongoDB.\n${name} vinculado al ID: ${telegramId}`);
                document.getElementById('hr-add-form').reset();
                fetchMasterStats(); // Recargar tablas de trabajadores
            } else {
                alert('Error al registrar en la base de datos.');
            }
        } catch (error) {
            console.warn("Backend apagado. Simulación local de HR activada.");
            alert(`[Modo Local] Alta simulada para: ${name}`);
            document.getElementById('hr-add-form').reset();
        }
        btn.innerHTML = '<i class="fas fa-user-plus"></i> Registrar en DB';
    });

    // ==========================================
    // 6. TRÁFICO EN VIVO (FILTROS)
    // ==========================================
    document.querySelectorAll('.traffic-filters button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.traffic-filters button').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            const filter = e.currentTarget.getAttribute('data-filter');
            fetchLiveTraffic(filter);
        });
    });

    async function fetchLiveTraffic(filter = 'hoy') {
        const feedList = document.getElementById('live-movies-list');
        feedList.innerHTML = '<li class="feed-item placeholder-item"><i class="fas fa-spinner fa-spin"></i> Consultando métricas reales...</li>';
        
        try {
            const res = await fetch(`/api/ceo/stats/top-movies?filter=${filter}`);
            const data = await res.json();
            
            feedList.innerHTML = '';
            if (data.movies && data.movies.length > 0) {
                data.movies.forEach(movie => {
                    feedList.innerHTML += `
                        <li class="feed-item">
                            <div class="feed-icon"><i class="fas fa-fire text-yellow"></i></div>
                            <div class="feed-info">
                                <p><strong>${movie.title}</strong></p>
                                <small>${movie.views.toLocaleString()} clics registrados ${filter === 'hoy' ? 'hoy' : 'en este periodo'}</small>
                            </div>
                        </li>
                    `;
                });
            } else {
                feedList.innerHTML = '<li class="feed-item placeholder-item">No hay datos suficientes en este periodo.</li>';
            }
        } catch (error) {
            // Fallback de demostración
            feedList.innerHTML = `
                <li class="feed-item"><div class="feed-icon"><i class="fas fa-chart-line text-green"></i></div><div class="feed-info"><p><strong>Deadpool & Wolverine</strong></p><small>4,320 clics (Lectura Local)</small></div></li>
                <li class="feed-item"><div class="feed-icon"><i class="fas fa-eye text-yellow"></i></div><div class="feed-info"><p><strong>Intensa-Mente 2</strong></p><small>2,150 clics (Lectura Local)</small></div></li>
            `;
        }
    }

    // ==========================================
    // 7. MOTOR DE DATOS REALES Y MATEMÁTICA CEO
    // ==========================================
    function initCorporateDashboard() {
        initChart();
        fetchMasterStats();
        fetchLiveTraffic('hoy');
        
        // Polling cada 60 segundos para mantener el panel vivo sin saturar la BD
        setInterval(fetchMasterStats, 60000); 
    }

    function initChart() {
        const ctx = document.getElementById('mainRevenueChart').getContext('2d');
        mainChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['D-6', 'D-5', 'D-4', 'D-3', 'D-2', 'Ayer', 'Hoy'],
                datasets: [{
                    label: 'Ingresos Netos BD (USD)',
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

    // Algoritmo Incremental de Ingresos (Curva suave hora por hora)
    function calculateDailyIncremental() {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        
        // Semilla para generar un margen aleatorio pero estático durante el día ($500 - $650)
        const seed = now.getFullYear() * 1000 + (now.getMonth() + 1) * 100 + now.getDate();
        const dailyTarget = 500 + (Math.abs(Math.sin(seed)) * 150);
        
        // Calcular porcentaje del día transcurrido
        const hoursElapsed = currentHour + (currentMinute / 60);
        const percentageElapsed = Math.min(hoursElapsed / 24, 1);
        
        return dailyTarget * percentageElapsed;
    }

    async function fetchMasterStats() {
        try {
            // Solicitud a la API central
            const res = await fetch('/api/ceo/master-stats');
            
            // Si el servidor Node no está levantado, forzamos un error para usar la matemática local de demostración
            if (!res.ok) throw new Error("No backend");
            
            const data = await res.json();
            renderDashboardData(data);
            
        } catch (e) {
            // ==========================================
            // FALLBACK LOCAL (Mientras conectas server.js)
            // ==========================================
            const todayRevenue = calculateDailyIncremental();
            const pastDaysAvg = 520; 
            
            // Cálculo a futuro (IA): Promedio diario * días del mes actual
            const date = new Date();
            const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
            const estimatedMonthly = pastDaysAvg * daysInMonth;

            // Caja mensual arranca en $0, le sumamos los días anteriores + hoy
            const daysPassed = date.getDate() - 1;
            const cajaRealMes = (daysPassed * pastDaysAvg) + todayRevenue;

            renderDashboardData({
                ingresosHoy: todayRevenue,
                vistasReales: Math.floor(todayRevenue * 35),
                gananciaEstimadaIA: estimatedMonthly,
                cajaRealMes: cajaRealMes,
                nominaTotal: 850,
                gastosHardware: 4500, // Infraestructura
                chartData: [480, 510, 495, 530, 550, 520, todayRevenue], // Histórico
                trabajadoresActivos: [
                    { nombre: 'Levin Dylan (CEO)', rol: 'Root Admin', sueldo: 'N/A' },
                    { nombre: 'Empleado 1 (Mapeado)', rol: 'Uploader', sueldo: '$15/día' }
                ],
                trabajadoresInactivos: [
                    { nombre: 'Amanda', rol: 'Asistente', fecha: 'Ciclo Ant.', estado: 'Inactivo' },
                    { nombre: 'William', rol: 'Moderador', fecha: 'Ciclo Ant.', estado: 'Inactivo' }
                ]
            });
        }
    }

    // Renderizador visual (Separa la lógica de la manipulación del DOM)
    function renderDashboardData(data) {
        // 1. KPIs Generales
        document.getElementById('kpi-ingresos-dia').textContent = `$${data.ingresosHoy.toFixed(2)}`;
        document.getElementById('kpi-vistas-dia').textContent = data.vistasReales.toLocaleString();
        document.getElementById('kpi-caja-estimada').textContent = `$${data.gananciaEstimadaIA.toLocaleString('en-US', {minimumFractionDigits: 2})}`;

        // 2. Gráfico
        if (mainChart) {
            mainChart.data.datasets[0].data = data.chartData;
            mainChart.update();
        }

        // 3. Finanzas y Egresos (Lectura Estricta)
        const egresosTotales = data.gastosHardware + data.nominaTotal;
        const utilidadNeta = data.cajaRealMes - egresosTotales;

        document.getElementById('fin-caja-real').textContent = `$${data.cajaRealMes.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
        document.getElementById('fin-egresos').textContent = `-$${egresosTotales.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
        
        const netEl = document.getElementById('fin-neto');
        netEl.textContent = `$${utilidadNeta.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
        if (utilidadNeta < 0) {
            netEl.classList.remove('text-green'); netEl.classList.add('text-danger');
        } else {
            netEl.classList.remove('text-danger'); netEl.classList.add('text-green');
        }

        // 4. Inyección de Trabajadores (MongoDB Mapeo)
        const activeList = document.getElementById('active-workers-list');
        activeList.innerHTML = '';
        data.trabajadoresActivos.forEach(w => {
            const isCEO = w.nombre.includes('CEO');
            activeList.innerHTML += `
                <div class="worker-card ${isCEO ? 'ceo-highlight' : ''}">
                    <div class="worker-header">
                        <div class="worker-avatar">${w.nombre.charAt(0)}</div>
                        <div>
                            <h4 style="margin-bottom: 3px;">${w.nombre}</h4>
                            <small class="text-muted">${w.rol}</small>
                        </div>
                    </div>
                    <div class="worker-stats">
                        <p>Tarifa BD: <span>${w.sueldo}</span></p>
                    </div>
                    ${!isCEO ? `<button class="btn-primary btn-micro" onclick="alert('Generando reporte para ${w.nombre}')"><i class="fas fa-file-invoice"></i> Auditoría</button>` : `<button class="btn-success btn-micro"><i class="fas fa-shield-alt"></i> Cuenta Maestra</button>`}
                </div>
            `;
        });

        const inactiveList = document.getElementById('inactive-workers-list');
        inactiveList.innerHTML = '';
        data.trabajadoresInactivos.forEach(w => {
            inactiveList.innerHTML += `
                <tr>
                    <td>${w.nombre}</td>
                    <td>${w.rol}</td>
                    <td>${w.fecha}</td>
                    <td><span class="text-danger">${w.estado}</span></td>
                </tr>
            `;
        });
    }
});
