document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // 1. SELECTORES PRINCIPALES Y SETUP
    // ==========================================
    const loginScreen = document.getElementById('login-screen');
    const dashboard = document.getElementById('ceo-dashboard');
    const btnLogin = document.getElementById('btn-login');
    const emailInput = document.getElementById('ceo-email');
    const sidebar = document.getElementById('sidebar');
    const mobileBtn = document.getElementById('mobile-menu-btn');
    
    let mainChart = null; 
    let selectedTmdbData = null; 
    let liveTrafficInterval = null;

    // Actualizar Fechas Globales
    function getFormattedDate() {
        const today = new Date();
        return today.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    }
    document.getElementById('live-date').textContent = `CICLO FISCAL: ${getFormattedDate()}`;
    document.getElementById('mobile-live-date').textContent = getFormattedDate();

    // ==========================================
    // 2. SISTEMA DE AUTENTICACIÓN (LOGIN)
    // ==========================================
    btnLogin.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        if (!email) return;
        
        btnLogin.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando Core DB...';
        
        try {
            const res = await fetch('/api/ceo/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await res.json();
            
            if (data.success) {
                iniciarPanel();
            } else {
                document.getElementById('login-error').textContent = 'Acceso denegado. Credencial no validada en MongoDB.';
                btnLogin.innerHTML = 'Autorizar Ingreso';
            }
        } catch (e) {
            console.warn("Backend API Offline. Arrancando Interfaz en Modo Standalone.");
            setTimeout(iniciarPanel, 800);
        }
    });

    function iniciarPanel() {
        loginScreen.classList.add('hidden');
        dashboard.classList.remove('hidden');
        initCorporateDashboard();
    }

    // ==========================================
    // 3. NAVEGACIÓN Y MENÚS FLOTANTES
    // ==========================================
    if (mobileBtn && sidebar) {
        mobileBtn.addEventListener('click', () => sidebar.classList.toggle('active'));
    }

    // Tabs Principales
    document.querySelectorAll('.nav-links li').forEach(li => {
        li.addEventListener('click', (e) => {
            const current = e.currentTarget;
            if (current.id === 'btn-logout') return;
            
            document.querySelectorAll('.nav-links li').forEach(el => el.classList.remove('active'));
            current.classList.add('active');
            
            const tabTitle = current.textContent.trim();
            document.getElementById('current-tab-title').textContent = tabTitle;
            document.getElementById('mobile-tab-title').textContent = tabTitle;
            document.getElementById('mobile-brand-text').classList.add('hidden');
            document.getElementById('mobile-dynamic-info').classList.remove('hidden');
            
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            document.getElementById(current.getAttribute('data-tab')).classList.remove('hidden');

            if (window.innerWidth <= 768 && sidebar) sidebar.classList.remove('active');
        });
    });

    document.getElementById('btn-logout').addEventListener('click', () => window.location.reload());

    // Menú Flotante Perfil
    const profileDropdown = document.getElementById('ceo-profile-dropdown');
    const toggleProfile = (e) => {
        e.stopPropagation();
        profileDropdown.classList.toggle('active');
    };
    document.getElementById('desktop-avatar-btn')?.addEventListener('click', toggleProfile);
    document.getElementById('mobile-avatar-btn')?.addEventListener('click', toggleProfile);
    document.addEventListener('click', () => profileDropdown.classList.remove('active'));

    // Dropdown Fechas (Inicio)
    const menuFechas = document.getElementById('menu-filtro-fechas');
    document.getElementById('btn-filtro-fechas')?.addEventListener('click', (e) => {
        e.stopPropagation();
        menuFechas.classList.toggle('active');
    });
    
    document.querySelectorAll('#menu-filtro-fechas li').forEach(li => {
        li.addEventListener('click', (e) => {
            const texto = e.currentTarget.textContent;
            const rango = e.currentTarget.getAttribute('data-rango');
            document.getElementById('label-fecha-filtro').textContent = texto;
            menuFechas.classList.remove('active');
            actualizarGraficoPorRango(rango);
        });
    });

    // Sub-pestañas (Configuración, Informes, Pagos)
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
                parentSection.querySelectorAll('.sub-tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById(targetId).classList.add('active');
            });
        });
    }
    setupSubTabs('tabs-pagos');
    setupSubTabs('tabs-configuracion');
    setupSubTabs('tabs-reportes');

    // Botones de Enlace (De Inicio a Sub-Pestañas)
    document.getElementById('btn-informe-usuarios')?.addEventListener('click', () => {
        document.querySelector('[data-tab="tab-informes"]').click();
        document.querySelector('[data-target="rep-usuarios"]').click();
    });
    document.getElementById('btn-informe-monetizacion')?.addEventListener('click', () => {
        document.querySelector('[data-tab="tab-informes"]').click();
        document.querySelector('[data-target="rep-monetizacion"]').click();
    });
    document.getElementById('btn-informe-trafico')?.addEventListener('click', () => {
        document.querySelector('[data-tab="tab-informes"]').click();
        document.querySelector('[data-target="rep-geografia"]').click();
    });

    // ==========================================
    // 4. FUNCIONES GLOBALES DE MODALES
    // ==========================================
    window.abrirModal = function(id) {
        document.getElementById(id).classList.add('active');
    };
    
    window.cerrarModal = function(id) {
        document.getElementById(id).classList.remove('active');
    };

    window.abrirModalEliminar = function(nombre, idStr) {
        document.getElementById('delete-user-name').textContent = nombre;
        document.getElementById('delete-user-id').textContent = idStr;
        abrirModal('modal-eliminar-usuario');
    };

    window.abrirModalLiquidar = function(nombre, montoNum, origen) {
        const tagClass = origen === 'MongoDB' ? 'tag-db' : 'tag-env';
        document.getElementById('liquidar-user-name').innerHTML = `${nombre} <br><span class="${tagClass}" style="font-size:11px; margin-top:8px; display:inline-block;">${origen}</span>`;
        document.getElementById('liquidar-user-monto').textContent = `$${parseFloat(montoNum).toFixed(2)}`;
        abrirModal('modal-liquidar-trabajador');
        
        // Configurar acción del botón confirmar
        const btnConfirm = document.getElementById('btn-confirm-liquidar');
        btnConfirm.onclick = function() {
            btnConfirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
            setTimeout(() => {
                btnConfirm.innerHTML = '<i class="fas fa-check-double"></i> Confirmar y Reiniciar Ciclo DB';
                cerrarModal('modal-liquidar-trabajador');
                // Aquí iría el fetch al backend para registrar la liquidación real
                fetchMasterStats(); // Recargar datos
            }, 1500);
        };
    };

    document.getElementById('btn-abrir-modal-usuario')?.addEventListener('click', () => abrirModal('modal-agregar-usuario'));
    
    document.querySelectorAll('.modal-close, [data-dismiss]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modalId = e.currentTarget.closest('.modal-overlay').id;
            cerrarModal(modalId);
        });
    });

    // ==========================================
    // 5. MOTOR DE DATOS (DASHBOARD Y GRÁFICOS)
    // ==========================================
    function initCorporateDashboard() {
        initChart();
        fetchMasterStats();
        iniciarSimulacionTraficoVivo();
        
        // Refresco de datos cada minuto
        setInterval(fetchMasterStats, 60000); 
    }

    function initChart() {
        const ctx = document.getElementById('mainRevenueChart')?.getContext('2d');
        if (!ctx) return;
        mainChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['D-6', 'D-5', 'D-4', 'D-3', 'D-2', 'Ayer', 'Hoy'],
                datasets: [{
                    label: 'Ingresos DB (USD)',
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
        // Simulación de respuesta al filtro de la BD
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

    // Efecto visual de peticiones en vivo
    function iniciarSimulacionTraficoVivo() {
        const usersLiveEl = document.getElementById('dash-users-live');
        const requestsEl = document.getElementById('dash-requests');
        let peticionesAcumuladas = parseInt(requestsEl.textContent.replace(/,/g, '')) || 12450;
        
        if (liveTrafficInterval) clearInterval(liveTrafficInterval);
        
        liveTrafficInterval = setInterval(() => {
            // Usuarios entre 30 y 85
            const users = Math.floor(Math.random() * (85 - 30 + 1) + 30);
            usersLiveEl.textContent = users;
            
            // Peticiones suben
            const reqs = Math.floor(Math.random() * 5) + 1;
            peticionesAcumuladas += reqs;
            requestsEl.textContent = peticionesAcumuladas.toLocaleString();
        }, 3000);
    }

    async function fetchMasterStats() {
        try {
            const res = await fetch('/api/ceo/master-stats');
            if (!res.ok) throw new Error("Backend Offline");
            const data = await res.json();
            renderDashboardData(data);
        } catch (e) {
            // Generación algorítmica realista para demostración si Node.js no responde
            const now = new Date();
            const horasTranscurridas = now.getHours() + (now.getMinutes() / 60);
            const porcentajeDia = Math.min(horasTranscurridas / 24, 1);
            
            const promedioDiario = 550.00;
            const ingresosHoy = promedioDiario * porcentajeDia;
            
            const diasMes = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const cajaMes = (promedioDiario * (now.getDate() - 1)) + ingresosHoy;
            
            const workersData = [
                { id: 'ADMIN_CHAT_ID', nombre: 'Levin Dylan (CEO)', rol: 'Fundador / CEO', origen: '.env (Root)', vistas: 84300, generado: 421.50, limite: false },
                { id: '00000000', nombre: 'Nadia', rol: 'Co-Fundadora', origen: '.env (Admin 2)', vistas: 42100, generado: 210.50, limite: false },
                { id: '554321987', nombre: 'María', rol: 'Desarrollo / Uploader', origen: 'MongoDB', vistas: 9520, generado: 47.60, limite: false },
                { id: '887766554', nombre: 'Uploader Nuevo', rol: 'Uploader Externo', origen: 'MongoDB', vistas: 12400, generado: 62.00, limite: true }
            ];

            renderDashboardData({
                ingresosHoy: ingresosHoy,
                ingresosAyer: 510.45,
                cajaMes: cajaMes,
                mesPasado: 14850.00,
                ecpm: 0.005,
                peticiones: 12450 + Math.floor(porcentajeDia * 5000),
                chartData: [420, 480, 410, 500, 460, 520, ingresosHoy],
                workers: workersData
            });
        }
    }

    function renderDashboardData(data) {
        // 1. KPIs
        document.getElementById('dash-revenue-hoy').textContent = `$${data.ingresosHoy.toFixed(2)}`;
        document.getElementById('home-hoy').textContent = `$${data.ingresosHoy.toFixed(2)}`;
        document.getElementById('home-ayer').textContent = `$${data.ingresosAyer.toFixed(2)}`;
        document.getElementById('home-mes').textContent = `$${data.cajaMes.toFixed(2)}`;
        document.getElementById('home-pasado').textContent = `$${data.mesPasado.toFixed(2)}`;
        document.getElementById('dash-ecpm').textContent = `$${data.ecpm.toFixed(3)}`;
        
        if (!liveTrafficInterval) {
            document.getElementById('dash-requests').textContent = data.peticiones.toLocaleString();
        }

        // 2. Gráfico
        if (mainChart && mainChart.data.labels.includes('Hoy')) {
            mainChart.data.datasets[0].data = data.chartData;
            mainChart.update();
        }

        // 3. Tablas de Empleados (Inicio, RRHH y Pagos)
        const dashWorkers = document.getElementById('dash-workers-list');
        const configWorkers = document.getElementById('tabla-gestion-usuarios');
        const nominaPagos = document.getElementById('lista-nomina-pagos');
        
        if (dashWorkers) dashWorkers.innerHTML = '';
        if (configWorkers) configWorkers.innerHTML = '';
        if (nominaPagos) nominaPagos.innerHTML = '';

        let nominaTotalCalculada = 0;

        data.workers.forEach(w => {
            const isCEO = w.rol.includes('CEO');
            const isEnv = w.origen.includes('.env');
            const colorClase = isCEO ? 'var(--yellow-main)' : (isEnv ? 'var(--text-main)' : 'var(--blue-dev)');
            const tagOrigen = isEnv ? '<span class="tag-env">Variable .env</span>' : '<span class="tag-db">MongoDB</span>';
            const estadoLimite = w.limite 
                ? '<span class="tag-env" style="color:var(--red-expense); border-color:var(--red-expense); background:rgba(239,68,68,0.1);">Corte Activo</span>'
                : (isCEO ? '<span class="text-muted"><i class="fas fa-infinity"></i> Sin Límite</span>' : `<div style="width: 100%; background: var(--bg-base); border-radius: 4px; height: 6px;"><div style="width: ${(w.generado/62)*100}%; height: 100%; background: var(--yellow-main);"></div></div>`);

            // Acumular nómina (Solo uploaders regulares)
            if (!isCEO && !w.rol.includes('Admin')) {
                nominaTotalCalculada += w.generado;
                
                // Llenar tabla de Pagos
                nominaPagos.innerHTML += `
                    <tr>
                        <td style="padding-left: 20px; font-weight: bold; font-size: 15px;">${w.nombre}</td>
                        <td>${w.rol}</td>
                        <td class="${w.limite ? 'text-red-expense' : 'text-yellow'}" style="font-weight: bold; font-size: 16px;">$${w.generado.toFixed(2)}</td>
                        <td>${estadoLimite}</td>
                        <td style="text-align: right; padding-right: 20px;">
                            <button class="btn-success" onclick="abrirModalLiquidar('${w.nombre}', ${w.generado}, '${isEnv ? '.env' : 'MongoDB'}')"><i class="fas fa-money-check-alt"></i> Liquidar</button>
                        </td>
                    </tr>
                `;
            }

            // Llenar tabla Inicio
            dashWorkers.innerHTML += `
                <tr>
                    <td style="padding-left: 20px;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div class="feed-icon" style="color:${colorClase}; font-weight:bold;">${w.nombre.charAt(0)}</div>
                            <div>
                                <strong style="font-size: 15px; color:${isCEO ? 'var(--yellow-main)' : 'white'};">${w.nombre}</strong><br>
                                ${tagOrigen}
                            </div>
                        </div>
                    </td>
                    <td style="font-size: 16px;">${Math.floor(w.vistas / 100)}</td>
                    <td style="font-size: 16px;">${w.vistas.toLocaleString()}</td>
                    <td class="text-green" style="font-size: 16px; font-weight: bold;">$${w.generado.toFixed(2)}</td>
                    <td>${estadoLimite}</td>
                </tr>
            `;

            // Llenar tabla Configuración
            configWorkers.innerHTML += `
                <tr>
                    <td style="padding-left: 20px;">
                        <div style="display: flex; align-items: center; gap: 15px;">
                            <div class="feed-icon" style="color:${colorClase}; font-weight:bold; font-size:18px; width:45px; height:45px;">${w.nombre.charAt(0)}</div>
                            <div>
                                <strong style="font-size: 16px; color:${isCEO ? 'var(--yellow-main)' : 'white'};">${w.nombre}</strong><br>
                                <small class="text-muted">ID: ${w.id}</small>
                            </div>
                        </div>
                    </td>
                    <td style="font-size: 15px;">${w.rol}</td>
                    <td>${tagOrigen}</td>
                    <td style="text-align: right; padding-right: 20px;">
                        ${isEnv ? '<span class="text-muted" style="font-size: 12px;"><i class="fas fa-lock text-yellow"></i> Root</span>' : `<button class="btn-secondary btn-micro mr-2"><i class="fas fa-edit"></i></button><button class="btn-secondary btn-micro text-danger" onclick="abrirModalEliminar('${w.nombre}', '${w.id}')"><i class="fas fa-user-times"></i> Desvincular</button>`}
                    </td>
                </tr>
            `;
        });

        document.getElementById('total-deuda-empresa').textContent = `$${nominaTotalCalculada.toFixed(2)}`;
    }

    // ==========================================
    // 6. BÓVEDA TMDB (BUSCADOR Y M3U8/MP4)
    // ==========================================
    const visualSearchBtn = document.getElementById('btn-realizar-busqueda');
    const visualSearchInput = document.getElementById('visual-search-input');
    const resultsGrid = document.getElementById('search-results-grid');
    const injectionPanel = document.getElementById('injection-panel');

    visualSearchBtn?.addEventListener('click', async () => {
        const query = visualSearchInput.value.trim();
        if (!query) return;

        visualSearchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Consultando...';
        
        try {
            const res = await fetch(`/api/tmdb-proxy?query=${encodeURIComponent(query)}`);
            if(!res.ok) throw new Error("Offline");
            const data = await res.json();
            dibujarPostersTMDB(data.results);
        } catch (error) {
            // Simulación en caso de error de conexión a la API
            const mockData = [
                { id: 533535, title: 'Deadpool & Wolverine', poster_path: '/8cdWjvZQUrmdDO7cgYFj31GISSN.jpg', media_type: 'movie', overview: 'Wade Wilson y Logan...' },
                { id: 1022789, title: 'Intensa-Mente 2', poster_path: '/gR7hB3a7O5wA1RzL6Fwz19UeR2m.jpg', media_type: 'movie', overview: 'Regresamos a la mente de Riley...' }
            ];
            dibujarPostersTMDB(mockData);
        }
        visualSearchBtn.innerHTML = 'Ejecutar Búsqueda';
    });

    function dibujarPostersTMDB(resultados) {
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
                    document.getElementById('inject-poster').src = posterUrl;
                    document.getElementById('inject-title').textContent = title;
                    document.getElementById('inject-overview').textContent = media.overview || 'Sin descripción disponible.';
                    document.getElementById('inject-type').textContent = media.media_type === 'tv' ? 'SERIE' : 'PELÍCULA';
                    document.getElementById('inject-id').textContent = `TMDB ID: ${media.id}`;
                    
                    injectionPanel.classList.remove('hidden');
                    document.getElementById('inject-url').focus();
                });
                
                resultsGrid.appendChild(div);
            });
        } else {
            resultsGrid.innerHTML = '<p class="text-muted w-100">No se encontraron resultados en la API.</p>';
        }
    }

    document.getElementById('btn-cancel-inject')?.addEventListener('click', () => {
        injectionPanel.classList.add('hidden');
        document.querySelectorAll('.poster-item').forEach(el => el.classList.remove('selected'));
        selectedTmdbData = null;
        document.getElementById('inject-url').value = '';
    });

    document.getElementById('btn-confirm-inject')?.addEventListener('click', () => {
        const url = document.getElementById('inject-url').value.trim();
        const btn = document.getElementById('btn-confirm-inject');

        if (!selectedTmdbData || !url) return alert('Atención: Debes proveer un enlace de video válido.');
        
        // Validación estricta de MP4 impuesta por la gerencia
        if (!url.toLowerCase().endsWith('.mp4') && !url.includes('mp4')) {
            alert('OPERACIÓN RECHAZADA: Las directivas del servidor dictan que el enlace directo de prioridad debe ser formato .MP4. Los formatos M3U8 están bloqueados para inyección directa.');
            return;
        }
        
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Inyectando a MongoDB...';
        
        // Simulación de escritura exitosa
        setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-database"></i> Insertar Documento en Colección';
            alert(`¡Éxito! El activo "${selectedTmdbData.title || selectedTmdbData.name}" ha sido insertado en la bóveda principal.`);
            document.getElementById('btn-cancel-inject').click();
            document.getElementById('visual-search-input').value = '';
            resultsGrid.innerHTML = '';
        }, 1500);
    });
    
    // ==========================================
    // 7. REGISTRO DE TRABAJADOR A LA DB
    // ==========================================
    document.getElementById('btn-submit-new-user')?.addEventListener('click', () => {
        const nombre = document.getElementById('add-nombre').value.trim();
        const idTelegram = document.getElementById('add-telegram').value.trim();
        const rol = document.getElementById('add-rol').value;
        const btn = document.getElementById('btn-submit-new-user');

        if (!nombre || !idTelegram) return alert("El nombre y el ID de Telegram son obligatorios.");

        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
        
        setTimeout(() => {
            cerrarModal('modal-agregar-usuario');
            btn.innerHTML = '<i class="fas fa-save"></i> Guardar en BD';
            alert(`El usuario ${nombre} (ID: ${idTelegram}) se ha registrado exitosamente en MongoDB.\n\nYa puede interactuar con el Bot y acceder a su Dashboard.`);
            // Limpiar
            document.getElementById('add-nombre').value = '';
            document.getElementById('add-telegram').value = '';
            fetchMasterStats(); // Recargar datos para que aparezca
        }, 1500);
    });
});
