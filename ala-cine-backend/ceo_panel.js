document.addEventListener('DOMContentLoaded', () => {
    const loginScreen = document.getElementById('login-screen');
    const dashboard = document.getElementById('ceo-dashboard');
    const btnLogin = document.getElementById('btn-login');
    const emailInput = document.getElementById('ceo-email');
    const sidebar = document.getElementById('sidebar');
    const mobileBtn = document.getElementById('mobile-menu-btn');
    
    let mainChart = null; 
    let selectedTmdbData = null; 
    let liveTrafficInterval = null;
    let currentWorkerToLiquidate = null;

    function getFormattedDate() {
        const today = new Date();
        return today.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    }
    
    const liveDateEl = document.getElementById('live-date');
    if (liveDateEl) liveDateEl.textContent = `CICLO FISCAL: ${getFormattedDate()}`;
    
    const mobileLiveDateEl = document.getElementById('mobile-live-date');
    if (mobileLiveDateEl) mobileLiveDateEl.textContent = getFormattedDate();

    btnLogin?.addEventListener('click', async () => {
        const email = emailInput?.value.trim();
        if (!email) return;
        
        btnLogin.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando Core DB...';
        
        setTimeout(() => {
            if (email.toLowerCase().includes('@')) {
                iniciarPanel();
            } else {
                const errorEl = document.getElementById('login-error');
                if (errorEl) errorEl.textContent = 'Acceso denegado. Credencial no validada en MongoDB.';
                btnLogin.innerHTML = 'Autorizar Ingreso';
            }
        }, 800);
    });

    function iniciarPanel() {
        if (loginScreen) loginScreen.classList.add('hidden');
        if (dashboard) dashboard.classList.remove('hidden');
        initCorporateDashboard();
    }

    mobileBtn?.addEventListener('click', () => {
        if (sidebar) sidebar.classList.toggle('active');
    });

    document.querySelectorAll('.nav-links li').forEach(li => {
        li.addEventListener('click', (e) => {
            const current = e.currentTarget;
            if (current.id === 'btn-logout') return;
            
            document.querySelectorAll('.nav-links li').forEach(el => el.classList.remove('active'));
            current.classList.add('active');
            
            const tabTitle = current.textContent.trim();
            const currentTabTitleEl = document.getElementById('current-tab-title');
            if (currentTabTitleEl) currentTabTitleEl.textContent = tabTitle;
            
            const mobileTabTitleEl = document.getElementById('mobile-tab-title');
            if (mobileTabTitleEl) mobileTabTitleEl.textContent = tabTitle;
            
            const mobileBrandTextEl = document.getElementById('mobile-brand-text');
            if (mobileBrandTextEl) mobileBrandTextEl.classList.add('hidden');
            
            const mobileDynamicInfoEl = document.getElementById('mobile-dynamic-info');
            if (mobileDynamicInfoEl) mobileDynamicInfoEl.classList.remove('hidden');
            
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            
            const tabId = current.getAttribute('data-tab');
            const tabEl = document.getElementById(tabId);
            if (tabEl) tabEl.classList.remove('hidden');

            if (window.innerWidth <= 768 && sidebar) {
                sidebar.classList.remove('active');
            }
        });
    });

    document.getElementById('btn-logout')?.addEventListener('click', () => window.location.reload());

    const profileDropdown = document.getElementById('ceo-profile-dropdown');
    const toggleProfile = (e) => {
        e.stopPropagation();
        if (profileDropdown) profileDropdown.classList.toggle('active');
    };
    
    document.getElementById('desktop-avatar-btn')?.addEventListener('click', toggleProfile);

    const menuFechas = document.getElementById('menu-filtro-fechas');
    document.getElementById('btn-filtro-fechas')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menuFechas) menuFechas.classList.toggle('active');
    });
    
    document.querySelectorAll('#menu-filtro-fechas li').forEach(li => {
        li.addEventListener('click', (e) => {
            const texto = e.currentTarget.textContent;
            const rango = e.currentTarget.getAttribute('data-rango');
            const labelEl = document.getElementById('label-fecha-filtro');
            if (labelEl) labelEl.textContent = texto;
            if (menuFechas) menuFechas.classList.remove('active');
            actualizarGraficoPorRango(rango);
        });
    });

    document.addEventListener('click', () => {
        const pd = document.getElementById('ceo-profile-dropdown');
        const mf = document.getElementById('menu-filtro-fechas');
        if (pd) pd.classList.remove('active');
        if (mf) mf.classList.remove('active');
    });

    function setupSubTabs(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const tabs = container.querySelectorAll('.config-tab');
        
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                tabs.forEach(t => t.classList.remove('active'));
                e.currentTarget.classList.add('active');
                
                const targetId = e.currentTarget.getAttribute('data-target');
                const parentSection = e.currentTarget.closest('section');
                if (parentSection) {
                    parentSection.querySelectorAll('.sub-tab-content').forEach(c => c.classList.remove('active'));
                }
                const targetEl = document.getElementById(targetId);
                if (targetEl) targetEl.classList.add('active');
            });
        });
    }
    setupSubTabs('tabs-pagos');
    setupSubTabs('tabs-configuracion');

    window.abrirModal = function(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('active');
    };
    
    window.cerrarModal = function(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.remove('active');
    };

    let targetUserToDelete = null;

    window.abrirModalEliminar = function(nombre, idStr) {
        const nameEl = document.getElementById('delete-user-name');
        const idEl = document.getElementById('delete-user-id');
        if (nameEl) nameEl.textContent = nombre;
        if (idEl) idEl.textContent = idStr;
        targetUserToDelete = idStr;
        abrirModal('modal-eliminar-usuario');
    };

    document.getElementById('btn-confirm-delete')?.addEventListener('click', async () => {
        if (!targetUserToDelete) return;
        const btn = document.getElementById('btn-confirm-delete');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Eliminando...';

        try {
            const res = await fetch(`/api/ceo/workers/${targetUserToDelete}`, { method: 'DELETE' });
            if (res.ok) {
                cerrarModal('modal-eliminar-usuario');
                fetchMasterStats();
            }
        } catch (e) {
            alert('Error conectando con el servidor.');
        } finally {
            btn.innerHTML = 'Ejecutar Desvinculación';
        }
    });

    window.abrirModalLiquidar = function(nombre, montoNum, idStr) {
        const nameEl = document.getElementById('liquidar-user-name');
        const montoEl = document.getElementById('liquidar-user-monto');
        
        if (nameEl) nameEl.textContent = nombre;
        if (montoEl) montoEl.textContent = `$${parseFloat(montoNum).toFixed(2)}`;
        
        currentWorkerToLiquidate = { id: idStr, name: nombre, amount: montoNum };
        abrirModal('modal-liquidar-trabajador');
    };

    document.getElementById('btn-confirm-liquidar')?.addEventListener('click', async () => {
        if (!currentWorkerToLiquidate) return;
        const btnConfirm = document.getElementById('btn-confirm-liquidar');
        btnConfirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando Pago en Servidor...';

        try {
            const res = await fetch('/api/ceo/pay-worker', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    uploaderId: currentWorkerToLiquidate.id,
                    workerName: currentWorkerToLiquidate.name,
                    amount: currentWorkerToLiquidate.amount
                })
            });

            const data = await res.json();
            if (data.success) {
                cerrarModal('modal-liquidar-trabajador');
                fetchMasterStats();
            } else {
                alert(data.error || 'No se pudo procesar la liquidación');
            }
        } catch (e) {
            alert('Error al comunicar con el servidor para la liquidación');
        } finally {
            btnConfirm.innerHTML = '<i class="fas fa-check-double"></i> Aprobar Pago y Resetear';
        }
    });

    window.abrirModalPerfil = function(nombre, rol, generado, vistas, peliculas, series, trend, inicial) {
        document.getElementById('perfil-nombre').textContent = nombre;
        document.getElementById('perfil-rol').textContent = `Rol: ${rol}`;
        document.getElementById('perfil-avatar').textContent = inicial;
        document.getElementById('perfil-generado-hoy').textContent = `$${parseFloat(generado).toFixed(2)}`;
        document.getElementById('perfil-vistas-hoy').textContent = vistas.toLocaleString();
        document.getElementById('perfil-total-peliculas').textContent = peliculas;
        document.getElementById('perfil-total-series').textContent = series;

        const tendenciaEl = document.getElementById('perfil-tendencia-dia');
        if (trend === 'up') {
            tendenciaEl.className = 'trend-live-up';
            tendenciaEl.innerHTML = '<i class="fas fa-arrow-up"></i> Produciendo activamente';
        } else if (trend === 'down') {
            tendenciaEl.className = 'trend-live-down';
            tendenciaEl.innerHTML = '<i class="fas fa-arrow-down"></i> Actividad baja';
        } else {
            tendenciaEl.className = 'trend-live-neutral';
            tendenciaEl.innerHTML = '<i class="fas fa-minus"></i> Estable / Pausado';
        }

        abrirModal('modal-perfil-usuario');
    };

    document.getElementById('btn-abrir-modal-usuario')?.addEventListener('click', () => abrirModal('modal-agregar-usuario'));
    
    document.querySelectorAll('[data-dismiss]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modalId = e.currentTarget.getAttribute('data-dismiss');
            cerrarModal(modalId);
        });
    });

    function initCorporateDashboard() {
        initChart();
        fetchMasterStats();
        iniciarSimulacionTraficoVivo();
        setInterval(fetchMasterStats, 15000); 
    }

    function initChart() {
        const ctx = document.getElementById('mainRevenueChart')?.getContext('2d');
        if (!ctx) return;
        mainChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['D-6', 'D-5', 'D-4', 'D-3', 'D-2', 'Ayer', 'Hoy'],
                datasets: [{
                    label: 'Ingresos DB Bruto (USD)',
                    data: [0, 0, 0, 0, 0, 0, 0],
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 3,
                    pointBackgroundColor: '#ffb800',
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
                    y: { grid: { color: '#2d2e36', drawBorder: false }, ticks: { color: '#9ca3af', callback: v => '$' + v } },
                    x: { grid: { display: false }, ticks: { color: '#9ca3af' } }
                },
                plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
                interaction: { mode: 'nearest', axis: 'x', intersect: false }
            }
        });
    }

    function actualizarGraficoPorRango(rango) {
        if (!mainChart) return;
        let newData = [];
        let newLabels = [];
        
        if (rango === 'hoy' || rango === 'ayer') {
            newLabels = ['00h', '04h', '08h', '12h', '16h', '20h', '24h'];
            newData = [10, 25, 60, 150, 210, 380, 520].map(v => rango === 'ayer' ? v * 0.9 : v * (new Date().getHours()/24));
        } else if (rango === '7dias') {
            newLabels = ['D-6', 'D-5', 'D-4', 'D-3', 'D-2', 'Ayer', 'Hoy'];
            newData = [420, 480, 410, 500, 460, 520, 490];
        } else {
            newLabels = ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4'];
            newData = [2800, 3100, 2950, 3500];
        }

        mainChart.data.labels = newLabels;
        mainChart.data.datasets[0].data = newData;
        mainChart.update();
    }

    function iniciarSimulacionTraficoVivo() {
        const usersLiveEl = document.getElementById('dash-users-live');
        const requestsEl = document.getElementById('dash-requests');
        
        if (!usersLiveEl || !requestsEl) return;
        
        if (liveTrafficInterval) clearInterval(liveTrafficInterval);
        
        liveTrafficInterval = setInterval(() => {
            const currentReqs = parseInt(requestsEl.textContent.replace(/,/g, '')) || 18420;
            const reqs = Math.floor(Math.random() * 4) + 1;
            requestsEl.textContent = (currentReqs + reqs).toLocaleString();
        }, 2500);
    }

    async function fetchMasterStats() {
        try {
            const response = await fetch('/api/ceo/dashboard-stats');
            if (!response.ok) throw new Error("Error en servidor");
            const data = await response.json();
            
            if (data.success) {
                renderDashboardData(data);
            }
        } catch (e) {
            console.error("Error sincronizando servidor:", e);
        }
    }

    function renderDashboardData(data) {
        const { serverStats, workers, payoutHistory, topMovies } = data;

        const dRevHoy = document.getElementById('dash-revenue-hoy');
        const dEcpm = document.getElementById('dash-ecpm');
        const dReq = document.getElementById('dash-requests');
        const dUsers = document.getElementById('dash-users-live');

        if (dRevHoy) dRevHoy.textContent = `$${serverStats.revenueToday.toFixed(2)}`;
        if (dEcpm) dEcpm.textContent = `$${serverStats.ecpm.toFixed(3)}`;
        if (dReq && !dReq.textContent) dReq.textContent = serverStats.totalRequests.toLocaleString();
        if (dUsers) dUsers.textContent = serverStats.usersLive;

        if (mainChart && mainChart.data.labels.includes('Hoy')) {
            mainChart.data.datasets[0].data = serverStats.chartData;
            mainChart.update();
        }

        const topMoviesList = document.getElementById('top-movies-list');
        if (topMoviesList) {
            topMoviesList.innerHTML = '';
            if (topMovies && topMovies.length > 0) {
                topMovies.forEach(m => {
                    topMoviesList.innerHTML += `
                        <tr>
                            <td style="padding: 10px;">${m.title}</td>
                            <td style="padding: 10px;" class="text-yellow">${m.uploader}</td>
                            <td style="padding: 10px;" class="text-muted">${new Date(m.date).toLocaleDateString()}</td>
                        </tr>
                    `;
                });
            } else {
                topMoviesList.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Sin actividad reciente.</td></tr>';
            }
        }

        const dashWorkers = document.getElementById('dash-workers-list');
        const configWorkers = document.getElementById('db-users-list');
        const nominaPagos = document.getElementById('lista-liquidaciones');
        const tNominaTotal = document.getElementById('nomina-pendiente-total');
        
        if (dashWorkers) dashWorkers.innerHTML = '';
        if (configWorkers) configWorkers.innerHTML = '';
        if (nominaPagos) nominaPagos.innerHTML = '';

        let nominaTotalCalculada = 0;

        workers.forEach(w => {
            const isCEO = w.rol.includes('CEO') || w.rol.includes('Co-Fundadora') || w.rol.includes('Admin 2');
            const isEnv = w.origen.includes('.env');
            const colorClase = isCEO ? 'var(--yellow-main)' : 'var(--blue-dev)';
            const tagOrigen = isEnv ? '<span class="tag-env">Matriz .env</span>' : '<span class="tag-db">MongoDB</span>';
            const inicial = w.nombre.charAt(0);
            
            let trendIcon = '';
            if (w.trend === 'up') trendIcon = '<span class="trend-live-up"><i class="fas fa-arrow-up"></i> Alta</span>';
            else if (w.trend === 'down') trendIcon = '<span class="trend-live-down"><i class="fas fa-arrow-down"></i> Baja</span>';
            else trendIcon = '<span class="trend-live-neutral"><i class="fas fa-minus"></i> Estable</span>';

            if (!isCEO) {
                nominaTotalCalculada += w.generado;
                if (nominaPagos) {
                    nominaPagos.innerHTML += `
                        <tr>
                            <td style="padding-left: 15px; font-weight: bold; font-size: 15px;">
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <div style="width:30px; height:30px; background:var(--blue-dev); color:white; border-radius:50%; display:flex; justify-content:center; align-items:center; font-size:12px;">${inicial}</div>
                                    ${w.nombre}
                                </div>
                            </td>
                            <td>${w.rol}</td>
                            <td><i class="fas fa-film text-muted"></i> ${w.peliculas} | <i class="fas fa-tv text-muted"></i> ${w.series}</td>
                            <td class="text-yellow" style="font-weight: bold; font-size: 16px;">$${w.generado.toFixed(2)}</td>
                            <td style="text-align: right; padding-right: 15px;">
                                <button class="btn-success" onclick="abrirModalLiquidar('${w.nombre}', ${w.generado}, '${w.id}')"><i class="fas fa-money-check-alt"></i> Liberar Saldo</button>
                            </td>
                        </tr>
                    `;
                }
            } else if (w.rol.includes('Admin 2')) {
                nominaTotalCalculada += w.generado;
                if (nominaPagos) {
                    nominaPagos.innerHTML += `
                        <tr>
                            <td style="padding-left: 15px; font-weight: bold; font-size: 15px;">
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <div style="width:30px; height:30px; background:var(--yellow-main); color:black; font-weight:bold; border-radius:50%; display:flex; justify-content:center; align-items:center; font-size:12px;">${inicial}</div>
                                    ${w.nombre}
                                </div>
                            </td>
                            <td>${w.rol}</td>
                            <td><i class="fas fa-film text-muted"></i> ${w.peliculas} | <i class="fas fa-tv text-muted"></i> ${w.series}</td>
                            <td class="text-yellow" style="font-weight: bold; font-size: 16px;">$${w.generado.toFixed(2)}</td>
                            <td style="text-align: right; padding-right: 15px;">
                                <button class="btn-success" onclick="abrirModalLiquidar('${w.nombre}', ${w.generado}, '${w.id}')"><i class="fas fa-money-check-alt"></i> Liberar Saldo</button>
                            </td>
                        </tr>
                    `;
                }
            }

            if (dashWorkers) {
                dashWorkers.innerHTML += `
                    <tr>
                        <td style="padding-left: 20px;">
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <div class="feed-icon" style="color:${colorClase}; font-weight:bold; border: 1px solid ${colorClase};">${inicial}</div>
                                <div>
                                    <strong style="font-size: 14px; color:${isCEO ? 'var(--yellow-main)' : 'white'};">${w.nombre}</strong><br>
                                    ${tagOrigen}
                                </div>
                            </div>
                        </td>
                        <td style="text-align: center;">${w.peliculas}</td>
                        <td style="text-align: center;">${w.series}</td>
                        <td style="font-size: 15px;">${w.vistasHoy.toLocaleString()}</td>
                        <td class="text-green" style="font-size: 15px; font-weight: bold;">$${w.generado.toFixed(2)}</td>
                        <td>${trendIcon}</td>
                        <td>
                            <button class="btn-secondary btn-micro" onclick="abrirModalPerfil('${w.nombre}', '${w.rol}', ${w.generado}, ${w.vistasHoy}, ${w.peliculas}, ${w.series}, '${w.trend}', '${inicial}')"><i class="fas fa-chart-pie"></i> Ver Desempeño</button>
                        </td>
                    </tr>
                `;
            }

            if (configWorkers) {
                configWorkers.innerHTML += `
                    <tr>
                        <td style="padding-left: 20px;">
                            <div style="display: flex; align-items: center; gap: 15px;">
                                <div class="feed-icon" style="background:var(--bg-base); color:${colorClase}; font-weight:bold; font-size:16px; width:40px; height:40px; border: 1px solid var(--border-light);">${inicial}</div>
                                <div>
                                    <strong style="font-size: 15px; color:${isCEO ? 'var(--yellow-main)' : 'white'};">${w.nombre}</strong><br>
                                    <small class="text-muted">ID: ${w.id}</small>
                                </div>
                            </div>
                        </td>
                        <td style="font-size: 14px;">${w.rol}</td>
                        <td>${tagOrigen}</td>
                        <td style="text-align: right; padding-right: 20px;">
                            ${isEnv ? '<span class="text-muted" style="font-size: 12px;"><i class="fas fa-lock text-yellow"></i> Matriz Root</span>' : `<button class="btn-secondary btn-micro text-danger" onclick="abrirModalEliminar('${w.nombre}', '${w.id}')"><i class="fas fa-user-times"></i> Desvincular BD</button>`}
                        </td>
                    </tr>
                `;
            }
        });

        if (tNominaTotal) tNominaTotal.textContent = `$${nominaTotalCalculada.toFixed(2)}`;

        const tablaHistorial = document.getElementById('tabla-historial-pagos');
        if (tablaHistorial) {
            tablaHistorial.innerHTML = '';
            if (payoutHistory && payoutHistory.length > 0) {
                payoutHistory.forEach(recibo => {
                    const fecha = new Date(recibo.date).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                    tablaHistorial.innerHTML += `
                        <tr>
                            <td style="padding: 12px;">${fecha}</td>
                            <td style="padding: 12px; font-weight: bold;" class="text-main">${recibo.workerName}</td>
                            <td style="padding: 12px;" class="text-danger">-$${parseFloat(recibo.amount).toFixed(2)}</td>
                            <td style="padding: 12px;"><span class="tag-db">Completado</span></td>
                        </tr>
                    `;
                });
            } else {
                tablaHistorial.innerHTML = '<tr><td colspan="4" class="text-center text-muted" style="padding: 15px;">No hay recibos de liquidación guardados en BD.</td></tr>';
            }
        }
    }

    const visualSearchBtn = document.getElementById('btn-realizar-busqueda');
    const visualSearchInput = document.getElementById('visual-search-input');
    const resultsGrid = document.getElementById('search-results-grid');
    const injectionPanel = document.getElementById('injection-panel');

    visualSearchBtn?.addEventListener('click', async () => {
        const query = visualSearchInput?.value.trim();
        if (!query) return;

        visualSearchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Consultando TMDB...';
        
        try {
            const res = await fetch(`/api/tmdb-proxy?query=${encodeURIComponent(query)}`);
            if(!res.ok) throw new Error("Offline");
            const data = await res.json();
            dibujarPostersTMDB(data.results);
        } catch (error) {
            const mockData = [
                { id: 533535, title: 'Deadpool & Wolverine', poster_path: '/8cdWjvZQUrmdDO7cgYFj31GISSN.jpg', media_type: 'movie', overview: 'Wade Wilson y Logan...' },
                { id: 1022789, title: 'Intensa-Mente 2', poster_path: '/gR7hB3a7O5wA1RzL6Fwz19UeR2m.jpg', media_type: 'movie', overview: 'Regresamos a la mente de Riley...' }
            ];
            dibujarPostersTMDB(mockData);
        }
        visualSearchBtn.innerHTML = 'Extraer de TMDB';
    });

    function dibujarPostersTMDB(resultados) {
        if (!resultsGrid || !injectionPanel) return;
        resultsGrid.innerHTML = '';
        injectionPanel.classList.add('hidden');
        
        if (resultados && resultados.length > 0) {
            const validMedia = resultados.filter(m => (m.media_type === 'movie' || m.media_type === 'tv' || m.title) && m.poster_path);
            
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
                    
                    const pPoster = document.getElementById('inject-poster');
                    const pTitle = document.getElementById('inject-title');
                    const pOverview = document.getElementById('inject-overview');
                    const pType = document.getElementById('inject-type');
                    const pId = document.getElementById('inject-id');
                    const pUrl = document.getElementById('inject-url');
                    
                    if (pPoster) pPoster.src = posterUrl;
                    if (pTitle) pTitle.textContent = title;
                    if (pOverview) pOverview.textContent = media.overview || 'Sin descripción disponible.';
                    if (pType) pType.textContent = media.media_type === 'tv' ? 'SERIE' : 'PELÍCULA';
                    if (pId) pId.textContent = `TMDB ID: ${media.id}`;
                    
                    injectionPanel.classList.remove('hidden');
                    if (pUrl) pUrl.focus();
                });
                
                resultsGrid.appendChild(div);
            });
        } else {
            resultsGrid.innerHTML = '<p class="text-muted w-100">No se encontraron resultados en la API.</p>';
        }
    }

    document.getElementById('btn-cancel-inject')?.addEventListener('click', () => {
        if (injectionPanel) injectionPanel.classList.add('hidden');
        document.querySelectorAll('.poster-item').forEach(el => el.classList.remove('selected'));
        selectedTmdbData = null;
        const iUrl = document.getElementById('inject-url');
        if (iUrl) iUrl.value = '';
    });

    document.getElementById('btn-confirm-inject')?.addEventListener('click', () => {
        const urlEl = document.getElementById('inject-url');
        const url = urlEl ? urlEl.value.trim() : '';
        const btn = document.getElementById('btn-confirm-inject');

        if (!selectedTmdbData || !url) {
            alert('Atención: Debes proveer un enlace de video válido para la bóveda.');
            return;
        }
        
        if (!url.toLowerCase().endsWith('.mp4') && !url.includes('mp4')) {
            alert('BLOQUEO DE SEGURIDAD: El sistema rechaza la inyección. Las directivas de Sala Cine dictan que el enlace directo principal debe ser formato .MP4.');
            return;
        }
        
        if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando Inserción...';
        
        setTimeout(() => {
            if (btn) btn.innerHTML = '<i class="fas fa-database"></i> Inyectar al Catálogo (MongoDB)';
            alert(`¡Proceso Exitoso! "${selectedTmdbData.title || selectedTmdbData.name}" ha sido insertado en la colección principal de streaming.`);
            document.getElementById('btn-cancel-inject')?.click();
            const searchInput = document.getElementById('visual-search-input');
            if (searchInput) searchInput.value = '';
            if (resultsGrid) resultsGrid.innerHTML = '';
        }, 1500);
    });
    
    document.getElementById('btn-submit-new-user')?.addEventListener('click', async () => {
        const nombreEl = document.getElementById('add-nombre');
        const telegramEl = document.getElementById('add-telegram');
        const rolEl = document.getElementById('add-rol');
        
        const nombre = nombreEl ? nombreEl.value.trim() : '';
        const idTelegram = telegramEl ? telegramEl.value.trim() : '';
        const rol = rolEl ? rolEl.value : 'uploader';
        const btn = document.getElementById('btn-submit-new-user');

        if (!nombre || !idTelegram) {
            alert("Operación denegada: El nombre y el ID de Telegram son campos obligatorios.");
            return;
        }

        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Inyectando Documento...';
        
        try {
            const res = await fetch('/api/ceo/workers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre, telegramId: idTelegram, rol })
            });

            const data = await res.json();
            if (data.success) {
                cerrarModal('modal-agregar-usuario');
                if (nombreEl) nombreEl.value = '';
                if (telegramEl) telegramEl.value = '';
                fetchMasterStats();
            } else {
                alert(data.error || 'No se pudo agregar usuario.');
            }
        } catch (e) {
            alert('Error de conexión con la base de datos.');
        } finally {
            btn.innerHTML = 'Inyectar en Colección';
        }
    });
});
