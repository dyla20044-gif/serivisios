document.addEventListener('DOMContentLoaded', () => {
    // REFERENCIAS DEL DOM PRINCIPAL
    const loginScreen = document.getElementById('login-screen');
    const dashboard = document.getElementById('ceo-dashboard');
    const btnLogin = document.getElementById('btn-login');
    const emailInput = document.getElementById('ceo-email');
    
    // MENÚ MÓVIL
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('sidebar');

    // FECHA GLOBAL
    function getFormattedDate() {
        const today = new Date();
        return today.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    }
    document.getElementById('live-date').textContent = `CICLO FISCAL: ${getFormattedDate()}`;

    // ==========================================
    // 1. SISTEMA DE LOGIN (Modo Offline/Prueba habilitado)
    // ==========================================
    btnLogin.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        if (!email) return;
        
        btnLogin.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
        
        // Simulación de ingreso instantáneo para el CEO
        setTimeout(() => {
            loginScreen.classList.add('hidden');
            dashboard.classList.remove('hidden');
            initCorporateDashboard();
        }, 800);
    });

    // ==========================================
    // 2. NAVEGACIÓN PRINCIPAL Y MENÚ FLOTANTE
    // ==========================================
    // Abrir/Cerrar Sidebar en móvil
    if (mobileBtn && sidebar) {
        mobileBtn.addEventListener('click', () => sidebar.classList.toggle('active'));
    }

    // Lógica de Pestañas Principales (Sidebar)
    document.querySelectorAll('.nav-links li').forEach(li => {
        li.addEventListener('click', (e) => {
            const current = e.currentTarget;
            if (current.id === 'btn-logout') return;
            
            // Activar botón en sidebar
            document.querySelectorAll('.nav-links li').forEach(el => el.classList.remove('active'));
            current.classList.add('active');
            
            // Actualizar Títulos
            const tabTitle = current.textContent.trim();
            document.getElementById('current-tab-title').textContent = tabTitle;
            document.getElementById('mobile-tab-title').textContent = tabTitle;
            document.getElementById('mobile-brand-text').classList.add('hidden');
            document.getElementById('mobile-dynamic-info').classList.remove('hidden');
            document.getElementById('mobile-live-date').textContent = getFormattedDate();
            
            // Ocultar todas las secciones y mostrar la elegida
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            document.getElementById(current.getAttribute('data-tab')).classList.remove('hidden');

            if (window.innerWidth <= 768 && sidebar) sidebar.classList.remove('active');
        });
    });

    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => window.location.reload());

    // Menú Flotante Perfil (Avatar Top Right)
    const profileDropdown = document.getElementById('ceo-profile-dropdown');
    document.getElementById('desktop-avatar-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        profileDropdown.classList.toggle('active');
    });
    document.getElementById('mobile-avatar-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        profileDropdown.classList.toggle('active');
    });
    // Cerrar al hacer clic en otra parte
    document.addEventListener('click', () => profileDropdown.classList.remove('active'));

    // Botones del menú flotante
    document.getElementById('btn-mi-cuenta').addEventListener('click', () => alert('Abriendo datos de cuenta matriz...'));
    document.getElementById('btn-seguridad').addEventListener('click', () => alert('Abriendo configuración de encriptación...'));

    // ==========================================
    // 3. LÓGICA DE SUB-PESTAÑAS (PAGOS Y CONFIG)
    // ==========================================
    function setupSubTabs(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const tabs = container.querySelectorAll('.config-tab');
        
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                tabs.forEach(t => t.classList.remove('active'));
                e.currentTarget.classList.add('active');
                
                const targetId = e.currentTarget.getAttribute('data-target');
                // Buscar el contenedor padre (section) y ocultar sus sub-tabs
                const parentSection = e.currentTarget.closest('section');
                parentSection.querySelectorAll('.sub-tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById(targetId).classList.add('active');
            });
        });
    }
    setupSubTabs('tabs-pagos');
    setupSubTabs('tabs-configuracion');

    // ==========================================
    // 4. BOTONES GENÉRICOS (ALERTAS DE INTERFAZ)
    // ==========================================
    const buttonActions = {
        'btn-filtro-7dias': 'Filtrando métricas a 7 días...',
        'btn-add-app': 'Abriendo conexión con API de Google Play...',
        'btn-informe-usuarios': 'Generando reporte detallado de visualizaciones...',
        'btn-informe-monetizacion': 'Consultando AdMob Network...',
        'btn-informe-trafico': 'Abriendo mapa de tráfico global...',
        'btn-reiniciar-nodos': 'Enviando señal de reinicio a los clusters en Render y España...',
        'btn-admin-pagos': 'Abriendo billetera de USDT y transferencias...',
        'btn-filtrar-historial': 'Abriendo filtros de auditoría...',
        'btn-agregar-usuario': 'Abriendo formulario de alta DB...',
        'btn-admin-roles': 'Abriendo matriz de permisos...'
    };

    for (const [id, msg] of Object.entries(buttonActions)) {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', () => alert(msg));
    }

    // ==========================================
    // 5. BÓVEDA DE INYECCIÓN (TMDB)
    // ==========================================
    document.getElementById('btn-visual-search').addEventListener('click', () => {
        const query = document.getElementById('visual-search-input').value;
        if(!query) return;
        document.getElementById('btn-visual-search').innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        // Simular búsqueda
        setTimeout(() => {
            const grid = document.getElementById('search-results-grid');
            grid.innerHTML = `
                <div class="poster-item" onclick="seleccionarPelicula(this, 'Deadpool & Wolverine', 'Wade Wilson y Logan...')">
                    <img src="https://image.tmdb.org/t/p/w200/8cdWjvZQUrmdDO7cgYFj31GISSN.jpg" alt="Pelicula 1">
                </div>
            `;
            document.getElementById('btn-visual-search').innerHTML = 'Buscar Activo';
        }, 1000);
    });

    window.seleccionarPelicula = function(elemento, titulo, overview) {
        document.querySelectorAll('.poster-item').forEach(el => el.classList.remove('selected'));
        elemento.classList.add('selected');
        document.getElementById('injection-panel').classList.remove('hidden');
        document.getElementById('inject-title').textContent = titulo;
        document.getElementById('inject-overview').textContent = overview;
        document.getElementById('inject-poster').src = elemento.querySelector('img').src;
    };

    document.getElementById('btn-cancel-inject').addEventListener('click', () => {
        document.getElementById('injection-panel').classList.add('hidden');
        document.getElementById('inject-url').value = '';
    });

    document.getElementById('btn-confirm-inject').addEventListener('click', () => {
        const url = document.getElementById('inject-url').value;
        if (!url.includes('mp4')) {
            alert('RECHAZADO: Como dictan las normas de la empresa, el enlace prioritario de subida directa debe ser MP4.');
            return;
        }
        alert('Activo inyectado en MongoDB exitosamente.');
        document.getElementById('btn-cancel-inject').click();
    });

    // ==========================================
    // 6. MOTOR DE DATOS Y GRÁFICO (DASHBOARD)
    // ==========================================
    let mainChart = null;
    
    function initCorporateDashboard() {
        // Inicializar gráfico
        const ctx = document.getElementById('mainRevenueChart')?.getContext('2d');
        if (ctx) {
            mainChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ['D-6', 'D-5', 'D-4', 'D-3', 'D-2', 'Ayer', 'Hoy'],
                    datasets: [{
                        label: 'Ingresos DB (USD)',
                        data: [420, 450, 410, 500, 480, 520, 180],
                        borderColor: '#ffb800',
                        backgroundColor: 'rgba(255, 184, 0, 0.05)',
                        borderWidth: 3,
                        pointBackgroundColor: '#10b981',
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { grid: { color: '#2d2e36' }, ticks: { color: '#9ca3af', callback: v => '$' + v } },
                        x: { grid: { display: false }, ticks: { color: '#9ca3af' } }
                    },
                    plugins: { legend: { display: false } }
                }
            });
        }
        
        cargarDatosSimulados();
    }

    function cargarDatosSimulados() {
        // Generar datos realistas
        const hoy = 184.50;
        const ayer = 520.00;
        const mes = 2840.30;
        const mesPasado = 15300.00;

        document.getElementById('home-hoy').textContent = `$${hoy.toFixed(2)}`;
        document.getElementById('home-ayer').textContent = `$${ayer.toFixed(2)}`;
        document.getElementById('home-mes').textContent = `$${mes.toFixed(2)}`;
        document.getElementById('home-pasado').textContent = `$${mesPasado.toFixed(2)}`;

        // Llenar Top Trabajadores
        const topWorkers = document.getElementById('top-workers-list');
        topWorkers.innerHTML = `
            <tr>
                <td><i class="fas fa-user-circle text-yellow"></i> Levin (CEO)</td>
                <td>14,500</td>
                <td class="text-green">$72.50</td>
            </tr>
            <tr>
                <td><i class="fas fa-user-circle text-blue-dev"></i> María (Dev)</td>
                <td>8,200</td>
                <td class="text-green">$41.00</td>
            </tr>
        `;

        // Generar Nómina Dinámica en la pestaña de Pagos
        const nominaTotal = 113.50; // Suma de todos los trabajadores (Excluyendo al CEO)
        document.getElementById('nomina-pendiente-total').textContent = `USD ${nominaTotal.toFixed(2)}`;
        
        const listaLiquidacion = document.getElementById('lista-liquidaciones');
        listaLiquidacion.innerHTML = `
            <tr>
                <td>María</td>
                <td>Uploader</td>
                <td class="text-green">$41.00</td>
                <td><button class="btn-success btn-micro" onclick="ejecutarPago('María', 41.00, this)"><i class="fas fa-check-circle"></i> Liquidar</button></td>
            </tr>
            <tr>
                <td>Nuevo Uploader</td>
                <td>Uploader</td>
                <td class="text-green">$72.50</td>
                <td><button class="btn-success btn-micro" onclick="ejecutarPago('Nuevo Uploader', 72.50, this)"><i class="fas fa-check-circle"></i> Liquidar</button></td>
            </tr>
        `;
    }

    // Función global para liquidar a un trabajador
    window.ejecutarPago = function(nombre, monto, boton) {
        if(confirm(`¿Estás seguro de liquidar $${monto.toFixed(2)} a ${nombre}? Esto pondrá su balance en $0 en la base de datos.`)) {
            boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            boton.classList.remove('btn-success');
            boton.classList.add('btn-secondary');
            
            setTimeout(() => {
                boton.innerHTML = '<i class="fas fa-check"></i> Pagado';
                boton.disabled = true;
                alert(`Pago a ${nombre} registrado en DB. Su ciclo se ha reiniciado.`);
            }, 1000);
        }
    };
});
