document.addEventListener('DOMContentLoaded', () => {
    const loginScreen = document.getElementById('login-screen');
    const dashboard = document.getElementById('ceo-dashboard');
    const btnLogin = document.getElementById('btn-login');
    const emailInput = document.getElementById('ceo-email');
    const titleDisplay = document.getElementById('top-title-display');
    
    let currentCharts = {}; // Para destruir gráficos viejos al recargar

    btnLogin?.addEventListener('click', () => {
        const email = emailInput?.value.trim();
        if (!email) return;
        
        btnLogin.innerHTML = 'CONECTANDO AL CLUSTER...';
        setTimeout(() => {
            loginScreen.classList.add('hidden');
            dashboard.classList.remove('hidden');
            initSystem();
        }, 800);
    });

    window.toggleMenu = function(menuId) {
        const menu = document.getElementById(menuId);
        const title = menu.previousElementSibling;
        menu.classList.toggle('open');
        title.classList.toggle('open');
    };

    // Títulos traducidos al español corporativo
    const mapTitle = {
        'tab-dashboard': 'PANEL DE CONTROL PRINCIPAL <span class="sub">| ACCESO CEO</span>',
        'tab-fin-overview': 'FINANZAS | VISIÓN GENERAL <span class="sub">- ACCESO CEO</span>',
        'tab-fin-revenue': 'FINANZAS | DETALLE DE INGRESOS <span class="sub">- ACCESO CEO</span>',
        'tab-fin-expenses': 'FINANZAS | DETALLE DE GASTOS <span class="sub">- ACCESO CEO</span>',
        'tab-fin-cashflow': 'FINANZAS | FLUJO DE CAJA <span class="sub">- ACCESO CEO</span>',
        'tab-fin-oberbia': 'FINANZAS | RESUMEN CORPORATIVO <span class="sub">- ACCESO CEO</span>',
        'tab-srv-health': 'SERVIDORES | ESTADO Y SALUD <span class="sub">- ACCESO CEO</span>',
        'tab-srv-deploy': 'SERVIDORES | DESPLIEGUES MANUALES (TMDB)',
        'tab-usr-activity': 'PLATAFORMA | ACTIVIDAD GLOBAL <span class="sub">- ACCESO CEO</span>',
        'tab-usr-payments': 'PLATAFORMA | UPLOADERS & PAGOS <span class="sub">- RECURSOS HUMANOS</span>',
        'tab-usr-engagement': 'PLATAFORMA | RETENCIÓN DE USUARIOS <span class="sub">- ACCESO CEO</span>',
        'tab-team-personnel': 'RECURSOS HUMANOS | NÓMINA Y PERSONAL',
        'tab-team-roles': 'RECURSOS HUMANOS | ROLES Y JERARQUÍAS',
        'tab-reports': 'CENTRO DE REPORTES Y ANALÍTICA',
        'tab-settings': 'CONFIGURACIONES DEL SISTEMA',
        'tab-empresa': 'TRECHOS CORPORATE <span class="sub">| ACERCA DE LA EMPRESA</span>'
    };

    document.querySelectorAll('.nav-item, .nav-sub-item').forEach(li => {
        li.addEventListener('click', (e) => {
            if (e.currentTarget.id === 'btn-logout') {
                window.location.reload();
                return;
            }
            document.querySelectorAll('.nav-item, .nav-sub-item').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            
            const current = e.currentTarget;
            current.classList.add('active');
            
            const tabId = current.getAttribute('data-tab');
            const tabElement = document.getElementById(tabId);
            if (tabElement) {
                tabElement.classList.add('active');
                titleDisplay.innerHTML = mapTitle[tabId] || 'TRECHOS CORPORATE';
            }
        });
    });

    document.getElementById('btn-logout-icon')?.addEventListener('click', () => {
        window.location.reload();
    });

    // SISTEMA NÚCLEO: Conexión asíncrona preparada para la Fase 2
    async function initSystem() {
        try {
            // Animación de carga visual
            document.getElementById('dash-revenue-today').innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            document.getElementById('dash-revenue-month').innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            document.getElementById('dash-revenue-total').innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

            // INTENTO DE CONEXIÓN A TU API REAL (Se implementará en Fase 2)
            const response = await fetch('/api/ceo/master-stats').catch(() => null);
            
            let data;
            if (response && response.ok) {
                data = await response.json();
            } else {
                // FALLBACK: Datos simulados para visualizar la interfaz hoy mientras programamos la Fase 2
                data = generarDatosDePrueba();
            }

            // Inyectar datos al DOM
            document.getElementById('dash-revenue-today').innerText = `$${parseFloat(data.ingresosHoy).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            document.getElementById('dash-revenue-month').innerText = `$${parseFloat(data.cajaMes).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            document.getElementById('dash-revenue-total').innerText = `$${parseFloat(data.ingresosHistoricos).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            document.getElementById('dash-active-users').innerText = data.vistasHoy.toLocaleString();

            renderDynamicCharts(data);
            renderWorkersTable(data.trabajadores);

        } catch (error) {
            console.error("Fallo al inicializar el sistema:", error);
            document.getElementById('dash-revenue-today').innerText = "ERROR";
        }
    }

    function generarDatosDePrueba() {
        // Esto se borrará en la Fase 2 cuando Node.js devuelva los datos reales
        return {
            ingresosHoy: 543.20,
            cajaMes: 16296.00,
            ingresosHistoricos: 245890.50,
            vistasHoy: 152430,
            chartLabels: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Hoy'],
            chartData: [450, 480, 520, 590, 610, 580, 543.20],
            trabajadores: [
                { id: "11111111", name: "Dylan (CEO)", rol: "Admin CEO", totalUploads: 5, earnedToday: 0.00, deudaPendiente: 0.00, trend: 'neutral' },
                { id: "22222222", name: "Uploader Externo 1", rol: "Uploader", totalUploads: 42, earnedToday: 12.50, deudaPendiente: 85.00, trend: 'up' },
                { id: "33333333", name: "Uploader Externo 2", rol: "Uploader", totalUploads: 18, earnedToday: 4.20, deudaPendiente: 22.10, trend: 'down' }
            ]
        };
    }

    function renderDynamicCharts(apiData) {
        const ctxRevenue = document.getElementById('chart-dashboard-revenue');
        if (ctxRevenue) {
            if(currentCharts['revenue']) currentCharts['revenue'].destroy();
            
            let gradient = ctxRevenue.getContext('2d').createLinearGradient(0, 0, 0, 300);
            gradient.addColorStop(0, 'rgba(234, 179, 8, 0.4)');
            gradient.addColorStop(1, 'rgba(234, 179, 8, 0.0)');

            currentCharts['revenue'] = new Chart(ctxRevenue.getContext('2d'), {
                type: 'line',
                data: {
                    labels: apiData.chartLabels,
                    datasets: [{
                        data: apiData.chartData,
                        borderColor: 'rgb(234, 179, 8)',
                        backgroundColor: gradient,
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4,
                        pointBackgroundColor: 'rgb(234, 179, 8)',
                        pointBorderColor: '#fff',
                        pointRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { grid: { color: '#2b2f3a' }, ticks: { color: '#9ca3af' } },
                        x: { grid: { display: false }, ticks: { color: '#9ca3af' } }
                    },
                    plugins: { legend: { display: false } }
                }
            });
        }
    }

    function renderWorkersTable(trabajadores) {
        const tbody = document.getElementById('workers-table-body');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        if(trabajadores.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No hay trabajadores activos.</td></tr>';
            return;
        }

        trabajadores.forEach(t => {
            const badgeClass = t.rol.includes('CEO') ? 'status-green' : 'status-yellow';
            const html = `
                <tr>
                    <td><strong>${t.name}</strong><br><span style="font-size: 11px; color: var(--text-secondary);">ID: ${t.id}</span></td>
                    <td><span class="status-badge ${badgeClass}">${t.rol}</span></td>
                    <td>${t.totalUploads}</td>
                    <td class="text-green">+$${t.earnedToday.toFixed(2)}</td>
                    <td style="font-weight: bold; color: var(--trecho-yellow);">$${t.deudaPendiente.toFixed(2)}</td>
                    <td><button class="btn-outline" style="padding: 5px 10px; width: auto; font-size: 11px;" onclick="alert('Módulo de Pago en Fase 3')">Liquidar</button></td>
                </tr>
            `;
            tbody.insertAdjacentHTML('beforeend', html);
        });
    }

    // Botón de Enlace Mágico
    document.getElementById('btn-generar-enlace')?.addEventListener('click', () => {
        const fakeLink = "https://app.trechovisionaries.com/invite?token=" + Math.random().toString(36).substr(2, 9);
        prompt("Copia este enlace y envíalo a tu nuevo trabajador por WhatsApp:", fakeLink);
    });

    document.getElementById('btn-search-tmdb')?.addEventListener('click', async () => {
        const q = document.getElementById('tmdb-search-input').value.trim();
        if(!q) return;
        const grid = document.getElementById('tmdb-results');
        grid.innerHTML = '<span class="text-secondary">Buscando en TMDB...</span>';
        setTimeout(() => {
            grid.innerHTML = `
                <div class="poster-item" style="width: 130px; height: 195px; background: #333; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: 2px solid transparent;" onclick="this.style.borderColor='var(--trecho-yellow)'">Película 1</div>
                <div class="poster-item" style="width: 130px; height: 195px; background: #333; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: 2px solid transparent;" onclick="this.style.borderColor='var(--trecho-yellow)'">Película 2</div>
            `;
        }, 800);
    });
});
