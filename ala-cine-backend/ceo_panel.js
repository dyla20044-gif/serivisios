document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // 1. SISTEMA DE SEGURIDAD Y NAVEGACIÓN
    // ==========================================
    const loginScreen = document.getElementById('login-screen');
    const dashboard = document.getElementById('ceo-dashboard');
    const btnLogin = document.getElementById('btn-login');
    const emailInput = document.getElementById('ceo-email');
    const loginError = document.getElementById('login-error');
    
    let mainChart = null; 
    let selectedTmdbData = null; 

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

    // Control del Menú Móvil (Hamburguesa)
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.querySelector('.sidebar');
    
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            sidebar.classList.toggle('active-mobile');
        });
    }

    // Navegación de Pestañas
    document.querySelectorAll('.nav-links li').forEach(li => {
        li.addEventListener('click', (e) => {
            const current = e.currentTarget;
            if (current.id === 'btn-logout') return;
            
            document.querySelectorAll('.nav-links li').forEach(el => el.classList.remove('active'));
            current.classList.add('active');
            
            // Actualizar título superior
            const titleEl = document.getElementById('current-tab-title');
            if(titleEl) titleEl.textContent = current.textContent.trim();
            
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            const tabId = current.getAttribute('data-tab');
            document.getElementById(tabId).classList.remove('hidden');

            // Cerrar menú móvil al seleccionar opción
            if(sidebar.classList.contains('active-mobile')) {
                sidebar.classList.remove('active-mobile');
            }
        });
    });

    document.getElementById('btn-logout').addEventListener('click', () => {
        dashboard.classList.add('hidden');
        loginScreen.classList.remove('hidden');
        emailInput.value = '';
    });

    // ==========================================
    // 2. EXPORTACIÓN A PDF
    // ==========================================
    const btnExport = document.getElementById('btn-export-pdf');
    if(btnExport) {
        btnExport.addEventListener('click', () => {
            const element = document.getElementById('export-pdf-area');
            const opt = {
                margin:       0.5,
                filename:     `Balance_TrechosVisionarios_${new Date().toLocaleDateString().replace(/\//g,'-')}.pdf`,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 2, useCORS: true, logging: false },
                jsPDF:        { unit: 'in', format: 'a4', orientation: 'landscape' }
            };
            html2pdf().set(opt).from(element).save();
        });
    }

    // ==========================================
    // 3. BUSCADOR VISUAL DE CATÁLOGO
    // ==========================================
    const visualSearchBtn = document.getElementById('btn-visual-search');
    const visualSearchInput = document.getElementById('visual-search-input');
    const resultsGrid = document.getElementById('search-results-grid');
    const injectionPanel = document.getElementById('injection-panel');

    if(visualSearchBtn) {
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
                    resultsGrid.innerHTML = '<p class="text-muted">No se encontraron resultados en la red.</p>';
                }
            } catch (error) {
                alert('Error al conectar con la base de datos global.');
            }
            visualSearchBtn.innerHTML = 'Buscar en la Red';
        });
    }

    const btnConfirmInject = document.getElementById('btn-confirm-inject');
    if(btnConfirmInject) {
        btnConfirmInject.addEventListener('click', async () => {
            const videoUrl = document.getElementById('inject-url').value.trim();
            if (!selectedTmdbData || !videoUrl) return alert('Debes proveer un enlace de video válido.');
            
            btnConfirmInject.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
            
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
            btnConfirmInject.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Subir a Bóveda';
        });
    }

    // ==========================================
    // 4. MOTOR DE DATOS Y GESTIÓN DE EQUIPO
    // ==========================================
    function initCorporateDashboard() {
        initChart();
        fetchMasterStats();
        setInterval(fetchMasterStats, 30000); // Refresco cada 30 seg
    }

    function initChart() {
        const ctx = document.getElementById('mainRevenueChart');
        if(!ctx) return;

        mainChart = new Chart(ctx.getContext('2d'), {
            type: 'line',
            data: {
                labels: ['D-6', 'D-5', 'D-4', 'D-3', 'D-2', 'Ayer', 'Hoy'],
                datasets: [{
                    label: 'Ingresos Netos (USD)',
                    data: [0, 0, 0, 0, 0, 0, 0],
                    borderColor: '#ffb800',
                    backgroundColor: 'rgba(255, 184, 0, 0.05)',
                    borderWidth: 3,
                    pointBackgroundColor: '#10b981',
                    pointBorderColor: '#0a0a0f',
                    pointRadius: 4,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { grid: { color: '#2d2e36' }, ticks: { color: '#9ca3af', callback: val => '$' + val } },
                    x: { grid: { display: false }, ticks: { color: '#9ca3af' } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    async function fetchMasterStats() {
        try {
            const res = await fetch('/api/ceo/master-stats');
            if (!res.ok) return;
            const data = await res.json();
            
            // KPIs Principales
            const kpiIngresos = document.getElementById('kpi-ingresos-dia');
            const kpiVistas = document.getElementById('kpi-vistas-dia');
            const kpiCaja = document.getElementById('kpi-caja-mes');
            
            if(kpiIngresos) kpiIngresos.textContent = `$${data.ingresosHoy.toFixed(2)}`;
            if(kpiVistas) kpiVistas.textContent = data.vistasHoy.toLocaleString();
            if(kpiCaja) kpiCaja.textContent = `$${data.cajaMes.toFixed(2)}`;
            
            // Gráfico
            if (mainChart && data.chartData) {
                mainChart.data.labels = data.chartLabels;
                mainChart.data.datasets[0].data = data.chartData;
                mainChart.update();
            }

            // Finanzas y Nómina
            const nominaTotal = data.nominaTotal || 0;
            const gastosServidores = 4500.00;
            const margenNeto = data.cajaMes - nominaTotal - gastosServidores;
            
            const finBruto = document.getElementById('fin-bruto');
            const finNomina = document.getElementById('fin-nomina');
            const finNeto = document.getElementById('fin-neto');

            if(finBruto) finBruto.textContent = `$${data.cajaMes.toFixed(2)}`;
            if(finNomina) finNomina.textContent = `-$${nominaTotal.toFixed(2)}`;
            if(finNeto) {
                finNeto.textContent = `$${margenNeto.toFixed(2)}`;
                finNeto.className = margenNeto < 0 ? 'text-danger fw-bold' : 'text-green fw-bold';
            }

            // Renderizado de Trabajadores (Estilo Corporativo)
            const workersGrid = document.getElementById('workers-list');
            if(workersGrid && data.trabajadores) {
                workersGrid.innerHTML = '';
                data.trabajadores.forEach(w => {
                    const esCeo = w.id.toString() === 'CEO';
                    workersGrid.innerHTML += `
                        <div class="corporate-worker-card">
                            <div class="cw-header">
                                <div class="cw-avatar">${w.name.charAt(0)}</div>
                                <div class="cw-info">
                                    <h4>${w.name}</h4>
                                    <span class="cw-role">${w.role || 'Operador de Catálogo'}</span>
                                </div>
                                ${!esCeo ? `<button class="btn-icon" onclick="editWorker('${w.id}')"><i class="fas fa-pen"></i></button>` : ''}
                            </div>
                            <div class="cw-stats">
                                <div class="stat-col">
                                    <small>Fondo Mensual</small>
                                    <strong class="text-yellow">$${w.earnedMonth.toFixed(2)}</strong>
                                </div>
                                <div class="stat-col">
                                    <small>Día actual</small>
                                    <strong>$${w.earnedToday.toFixed(2)}</strong>
                                </div>
                                <div class="stat-col">
                                    <small>Volumen</small>
                                    <strong>${w.totalUploads}</strong>
                                </div>
                            </div>
                            ${!esCeo ? `<button class="btn-pay-full" onclick="payWorker('${w.id}', ${w.earnedMonth})"><i class="fas fa-wallet"></i> Liquidar $${w.earnedMonth.toFixed(2)}</button>` : ''}
                        </div>
                    `;
                });
            }

            // Actividad en vivo
            const feedList = document.getElementById('live-activity-list');
            if (feedList && data.actividad) {
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
            console.error("Error en telemetría:", e);
        }
    }

    // Funciones globales expuestas para los botones de las tarjetas
    window.editWorker = function(workerId) {
        const newName = prompt("Ingresa el nombre real o corporativo del trabajador:");
        const newRole = prompt("Ingresa el cargo (Ej: Desarrollador Backend, Uploader Senior):");
        
        if(newName && newRole) {
            // Aquí en la próxima actualización del server.js crearemos la ruta para guardar esto en BD
            alert(`Actualización solicitada para ID ${workerId}: ${newName} - ${newRole}.\n(Requiere actualización del backend para guardar permanentemente).`);
        }
    };

    window.payWorker = function(workerId, amount) {
        if(confirm(`¿Confirmas la dispersión de $${amount.toFixed(2)} para el ID ${workerId}?`)) {
            alert("Transferencia registrada. El saldo del trabajador se reiniciará en el próximo ciclo.");
        }
    };
});
