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

    function getFormattedDate() {
        const today = new Date();
        return today.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    }
    
    const liveDateEl = document.getElementById('live-date');
    if (liveDateEl) liveDateEl.textContent = `CICLO FISCAL: ${getFormattedDate()}`;
    
    const mobileLiveDateEl = document.getElementById('mobile-live-date');
    if (mobileLiveDateEl) mobileLiveDateEl.textContent = getFormattedDate();

    // ==========================================
    // 2. SISTEMA DE AUTENTICACIÓN (LOGIN)
    // ==========================================
    btnLogin?.addEventListener('click', async () => {
        const email = emailInput?.value.trim();
        if (!email) return;
        
        btnLogin.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando Core DB...';
        
        try {
            // Lógica de simulación para entorno frontend de visualización
            setTimeout(() => {
                if (email.toLowerCase().includes('@')) {
                    iniciarPanel();
                } else {
                    const errorEl = document.getElementById('login-error');
                    if (errorEl) errorEl.textContent = 'Acceso denegado. Credencial no validada en MongoDB.';
                    btnLogin.innerHTML = 'Autorizar Ingreso';
                }
            }, 800);
        } catch (e) {
            setTimeout(iniciarPanel, 800);
        }
    });

    function iniciarPanel() {
        if (loginScreen) loginScreen.classList.add('hidden');
        if (dashboard) dashboard.classList.remove('hidden');
        initCorporateDashboard();
    }

    // ==========================================
    // 3. NAVEGACIÓN Y MENÚS FLOTANTES
    // ==========================================
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
    document.getElementById('mobile-avatar-btn')?.addEventListener('click', toggleProfile);

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

    // CERRAR MENÚS AL HACER CLIC AFUERA
    document.addEventListener('click', (e) => {
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
    setupSubTabs('tabs-reportes');

    // ==========================================
    // 4. FUNCIONES GLOBALES DE MODALES (RRHH Y NÓMINA)
    // ==========================================
    window.abrirModal = function(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('active');
    };
    
    window.cerrarModal = function(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.remove('active');
    };

    window.abrirModalEliminar = function(nombre, idStr) {
        const nameEl = document.getElementById('delete-user-name');
        const idEl = document.getElementById('delete-user-id');
        if (nameEl) nameEl.textContent = nombre;
        if (idEl) idEl.textContent = idStr;
        abrirModal('modal-eliminar-usuario');
    };

    // FUNCIÓN PARA ABRIR LA LIQUIDACIÓN CON EL ID DEL USUARIO A PAGAR
    window.abrirModalLiquidar = function(nombre, montoNum, userId) {
        const nameEl = document.getElementById('liquidar-user-name');
        const montoEl = document.getElementById('liquidar-user-monto');
        const idInput = document.getElementById('liquidar-user-id');
        
        if (nameEl) nameEl.textContent = nombre;
        if (montoEl) montoEl.textContent = `$${parseFloat(montoNum).toFixed(2)}`;
        if (idInput) idInput.value = userId; 
        
        abrirModal('modal-liquidar-trabajador');
    };

    // APROBAR LIQUIDACION
    const btnConfirmLiquidar = document.getElementById('btn-confirm-liquidar');
    if (btnConfirmLiquidar) {
        btnConfirmLiquidar.addEventListener('click', async function() {
            const btnOriginalText = btnConfirmLiquidar.innerHTML;
            btnConfirmLiquidar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ejecutando Liquidación DB...';
            
            const userId = document.getElementById('liquidar-user-id').value;
            const amount = document.getElementById('liquidar-user-monto').textContent.replace('$', '');

            try {
                // Hacer el llamado a server.js -> '/api/ceo/pay-worker'
                const response = await fetch('/api/ceo/pay-worker', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uploaderId: userId, amount: amount, paymentMethod: 'Automático' })
                });

                if(response.ok) {
                    btnConfirmLiquidar.innerHTML = '<i class="fas fa-check-double"></i> Pago Aprobado';
                    setTimeout(() => {
                        btnConfirmLiquidar.innerHTML = btnOriginalText;
                        cerrarModal('modal-liquidar-trabajador');
                        fetchMasterStats(); // Recargamos las tablas del panel
                    }, 1500);
                } else {
                    btnConfirmLiquidar.innerHTML = 'Error al procesar';
                    setTimeout(() => btnConfirmLiquidar.innerHTML = btnOriginalText, 2000);
                }

            } catch (error) {
                console.error("Error pagando trabajador", error);
                btnConfirmLiquidar.innerHTML = btnOriginalText;
                cerrarModal('modal-liquidar-trabajador');
            }
        });
    }

    // NUEVO: Función para inyectar datos al Perfil de Usuario
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

    // ==========================================
    // 5. MOTOR DE DATOS (DASHBOARD Y GRÁFICOS)
    // ==========================================
    function initCorporateDashboard() {
        fetchMasterStats();
        // Recargar estadísticas cada 60 segundos automáticamente
        setInterval(fetchMasterStats, 60000); 
    }

    async function fetchMasterStats() {
        try {
            const res = await fetch('/api/ceo/master-stats');
            if(!res.ok) throw new Error("Error en servidor");
            const data = await res.json();
            
            // 1. Actualizar KPIs Principales
            document.getElementById('dash-revenue-hoy').textContent = `$${(data.ingresosHoy || 0).toFixed(2)}`;
            document.getElementById('dash-users-live').textContent = (data.vistasHoy || 0).toLocaleString();
            document.getElementById('dash-requests').textContent = ((data.vistasHoy || 0) * 3).toLocaleString(); // Estimación peticiones
            
            // 2. Poblar la tabla de Nómina y Pagos (Donde va el Botón Liquidar para admins)
            const nominaList = document.getElementById('lista-liquidaciones');
            const dashWorkersList = document.getElementById('dash-workers-list');
            const dbUsersList = document.getElementById('db-users-list');
            
            nominaList.innerHTML = '';
            dashWorkersList.innerHTML = '';
            dbUsersList.innerHTML = '';
            
            let htmlNomina = '';
            let htmlDashWorkers = '';
            let htmlDbUsers = '';
            
            data.trabajadores.forEach(worker => {
                // Rellenar Lista Nomina (Pestaña Pagos) -> Con botón para Admin 2 y workers, saltamos el CEO principal (si quieres le puedes poner el botón también quitando el if)
                if (worker.role !== "Propietario") {
                    htmlNomina += `
                        <tr>
                            <td><strong>${worker.name}</strong></td>
                            <td>${worker.role}</td>
                            <td>${worker.totalUploads} uploads</td>
                            <td class="text-yellow" style="font-size: 16px; font-weight:bold;">$${worker.earnedMonth.toFixed(2)}</td>
                            <td>
                                <button class="btn-success" style="padding: 5px 12px; font-size: 12px;" onclick="abrirModalLiquidar('${worker.name}', ${worker.earnedMonth}, '${worker.id}')">
                                    <i class="fas fa-money-bill-wave"></i> Liquidar
                                </button>
                            </td>
                        </tr>
                    `;
                }

                // Rellenar lista Dashboard Principal
                htmlDashWorkers += `
                    <tr>
                        <td><strong>${worker.name}</strong><br><small class="text-muted">ID: ${worker.id}</small></td>
                        <td>${Math.floor(worker.totalUploads * 0.7)}</td> <!-- Estimado movies -->
                        <td>${Math.ceil(worker.totalUploads * 0.3)}</td> <!-- Estimado series -->
                        <td><i class="fas fa-eye text-blue-dev"></i> - </td>
                        <td class="text-yellow"><strong>$${worker.earnedToday.toFixed(2)}</strong></td>
                        <td><span class="${worker.earnedToday > 0 ? 'trend-live-up' : 'trend-live-neutral'}"><i class="fas fa-arrow-${worker.earnedToday > 0 ? 'up' : 'minus'}"></i></span></td>
                        <td>
                            <button class="btn-secondary" style="padding: 4px 10px; font-size: 11px;" onclick="abrirModalPerfil('${worker.name}', '${worker.role}', ${worker.earnedToday}, 0, 0, 0, '${worker.earnedToday > 0 ? 'up' : 'neutral'}', '${worker.name.charAt(0)}')">Auditar</button>
                        </td>
                    </tr>
                `;

                // Rellenar Lista Personal (RRHH)
                htmlDbUsers += `
                    <tr>
                        <td><strong>${worker.name}</strong> <br><small class="text-muted">Telegram ID: ${worker.id}</small></td>
                        <td><span class="tag-db">${worker.role}</span></td>
                        <td><span class="text-green"><i class="fas fa-check-circle"></i> Sincronizado</span></td>
                        <td>
                            <button class="btn-secondary" style="border-color: var(--red-expense); color: var(--red-expense); padding: 5px 10px;" onclick="abrirModalEliminar('${worker.name}', '${worker.id}')">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `;
            });

            if (htmlNomina === '') htmlNomina = '<tr><td colspan="5" class="text-center text-muted">No hay trabajadores pendientes de liquidar.</td></tr>';
            
            nominaList.innerHTML = htmlNomina;
            dashWorkersList.innerHTML = htmlDashWorkers;
            dbUsersList.innerHTML = htmlDbUsers;
            
            document.getElementById('nomina-pendiente-total').textContent = `$${(data.nominaTotal || 0).toFixed(2)}`;

            // 3. Renderizar el Gráfico (Si existe Chart.js)
            if (window.Chart) {
                const ctx = document.getElementById('mainRevenueChart');
                if (ctx) {
                    if (mainChart) mainChart.destroy();
                    mainChart = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: data.chartLabels,
                            datasets: [{
                                label: 'Ingresos Brutos ($)',
                                data: data.chartData,
                                borderColor: '#ffb800',
                                backgroundColor: 'rgba(255, 184, 0, 0.1)',
                                borderWidth: 3,
                                fill: true,
                                tension: 0.4
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { display: false } },
                            scales: {
                                x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#9ca3af' } },
                                y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#9ca3af' } }
                            }
                        }
                    });
                }
            }

        } catch (error) {
            console.error("Error cargando dashboard:", error);
        }
    }

});
