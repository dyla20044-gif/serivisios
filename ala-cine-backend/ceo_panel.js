document.addEventListener('DOMContentLoaded', () => {
    const loginScreen = document.getElementById('login-screen');
    const dashboard = document.getElementById('ceo-dashboard');
    const btnLogin = document.getElementById('btn-login');
    const emailInput = document.getElementById('ceo-email');
    const titleDisplay = document.getElementById('top-title-display');

    window.myCharts = {}; 

    btnLogin?.addEventListener('click', () => {
        const email = emailInput?.value.trim();
        if (!email) return;
        
        btnLogin.innerHTML = 'CONECTANDO...';
        setTimeout(() => {
            loginScreen.classList.add('hidden');
            dashboard.classList.remove('hidden');
            initCharts(); 
            initSystem(); 
            setInterval(initSystem, 10000); // Se actualiza automáticamente cada 10 segundos
        }, 800);
    });

    window.toggleMenu = function(menuId) {
        const menu = document.getElementById(menuId);
        const title = menu.previousElementSibling;
        menu.classList.toggle('open');
        title.classList.toggle('open');
    };

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
                titleDisplay.innerHTML = mapTitle[tabId] || 'TRECHO CORPORATE';
            }
        });
    });

    document.getElementById('btn-logout-icon')?.addEventListener('click', () => {
        window.location.reload();
    });

    // -------- LÓGICA DE CONEXIÓN EN TIEMPO REAL A LA BASE DE DATOS -------- //

    async function initSystem() {
        try {
            const response = await fetch('/api/ceo/master-stats').catch(() => null);
            if (!response || !response.ok) throw new Error("No hay conexión con el servidor");
            
            const data = await response.json();

            // Actualización de montos sin datos falsos. Si la base está vacía, mostrará $0.00 hasta que entre tráfico.
            document.getElementById('dash-revenue-today').innerText = `$${parseFloat(data.ingresosHoy || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            document.getElementById('dash-revenue-month').innerText = `$${parseFloat(data.cajaMes || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            document.getElementById('dash-revenue-total').innerText = `$${parseFloat(data.ingresosHistoricos || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            document.getElementById('dash-active-users').innerText = (data.vistasHoy || 0).toLocaleString();

            const trendEl = document.getElementById('dash-trend');
            if (trendEl) {
                trendEl.innerHTML = `<i class="fas fa-arrow-up"></i> Sistema Online`;
                trendEl.className = 'trend-up text-green';
            }

            if (window.myCharts['chart-dashboard-revenue'] && data.chartLabels && data.chartData) {
                window.myCharts['chart-dashboard-revenue'].data.labels = data.chartLabels;
                window.myCharts['chart-dashboard-revenue'].data.datasets[0].data = data.chartData;
                window.myCharts['chart-dashboard-revenue'].update();
            }

            renderWorkersTable(data.trabajadores || []);

        } catch (error) {
            console.error("Fallo al inicializar el sistema dinámico:", error);
            document.getElementById('dash-revenue-today').innerText = "$0.00";
            document.getElementById('dash-revenue-month').innerText = "$0.00";
            document.getElementById('dash-revenue-total').innerText = "$0.00";
            const trendEl = document.getElementById('dash-trend');
            if (trendEl) {
                trendEl.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Desconectado`;
                trendEl.className = 'trend-down text-red';
            }
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
                    <td class="text-green">+$${(t.earnedToday || 0).toFixed(2)}</td>
                    <td style="font-weight: bold; color: var(--trecho-yellow);">$${(t.deudaPendiente || 0).toFixed(2)}</td>
                    <td><button class="btn-outline" style="padding: 5px 10px; width: auto; font-size: 11px;" onclick="alert('Módulo de Pago en Fase 3')">Liquidar</button></td>
                </tr>
            `;
            tbody.insertAdjacentHTML('beforeend', html);
        });
    }

    document.getElementById('btn-generar-enlace')?.addEventListener('click', () => {
        const fakeLink = "https://app.trechovisionaries.com/invite?token=" + Math.random().toString(36).substr(2, 9);
        prompt("Copia este enlace y envíalo a tu nuevo trabajador por WhatsApp:", fakeLink);
    });

    // -------- LÓGICA DE MAQUETACIÓN ORIGINAL DE GRÁFICOS -------- //

    function initCharts() {
        const createLineChart = (id, data, color, isFill = true) => {
            const ctx = document.getElementById(id)?.getContext('2d');
            if (!ctx) return;
            let gradient = ctx.createLinearGradient(0, 0, 0, 300);
            gradient.addColorStop(0, `rgba(${color}, 0.4)`);
            gradient.addColorStop(1, `rgba(${color}, 0.0)`);
            window.myCharts[id] = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ['1', '2', '3', '4', '5', '6', '7'],
                    datasets: [{
                        data: data,
                        borderColor: `rgb(${color})`,
                        backgroundColor: isFill ? gradient : 'transparent',
                        borderWidth: 3,
                        fill: isFill,
                        tension: 0.4,
                        pointBackgroundColor: `rgb(${color})`,
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
        };

        const createBarChart = (id, data, color) => {
            const ctx = document.getElementById(id)?.getContext('2d');
            if (!ctx) return;
            window.myCharts[id] = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ['1', '2', '3', '4', '5', '6', '7'],
                    datasets: [{
                        data: data,
                        backgroundColor: `rgb(${color})`,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { display: false },
                        x: { grid: { display: false }, ticks: { color: '#9ca3af', font: {size: 10} } }
                    },
                    plugins: { legend: { display: false } }
                }
            });
        };

        const createDonutChart = (id, dataArr, colorsArr) => {
            const ctx = document.getElementById(id)?.getContext('2d');
            if (!ctx) return;
            window.myCharts[id] = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    datasets: [{
                        data: dataArr,
                        backgroundColor: colorsArr,
                        borderWidth: 0,
                        cutout: '70%'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } }
                }
            });
        };

        createLineChart('chart-dashboard-revenue', [0, 0, 0, 0, 0, 0, 0], '234, 179, 8');
        createBarChart('chart-dashboard-activity', [40, 30, 60, 45, 80, 50, 90], '234, 179, 8');
        createBarChart('chart-dashboard-workforce', [60, 40, 80, 65, 90, 70, 100], '234, 179, 8');

        createLineChart('chart-fin-cashflow', [50, 60, 40, 70, 90, 80, 110], '234, 179, 8');
        createDonutChart('chart-fin-expense-donut', [40, 30, 20, 10], ['#eab308', '#f97316', '#ef4444', '#6b7280']);
        
        const ctxProduct = document.getElementById('chart-fin-product')?.getContext('2d');
        if (ctxProduct) {
            window.myCharts['chart-fin-product'] = new Chart(ctxProduct, {
                type: 'bar',
                data: {
                    labels: ['Producto 1', 'Producto 2', 'Producto 3', 'Producto 4', 'Legal'],
                    datasets: [{ data: [15, 12, 9, 6, 3], backgroundColor: '#eab308', borderRadius: 4 }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { x: { grid: { color: '#2b2f3a' }, ticks: { color: '#9ca3af' } }, y: { grid: { display: false }, ticks: { color: '#9ca3af' } } },
                    plugins: { legend: { display: false } }
                }
            });
        }

        createLineChart('chart-srv-performance', [10, 30, 20, 50, 40, 60, 80], '234, 179, 8');
        createDonutChart('chart-srv-cpu', [45, 25, 20, 10], ['#eab308', '#ef4444', '#22c55e', '#6b7280']);

        createLineChart('chart-usr-reg', [10, 15, 12, 25, 20, 35, 40], '234, 179, 8', false);
        createLineChart('chart-usr-engagement', [20, 40, 30, 60, 50, 80, 100], '234, 179, 8');
        createDonutChart('chart-usr-platform', [50, 30, 20], ['#eab308', '#ef4444', '#6b7280']);

        const ctxRadar = document.getElementById('chart-roles-radar')?.getContext('2d');
        if (ctxRadar) {
            window.myCharts['chart-roles-radar'] = new Chart(ctxRadar, {
                type: 'radar',
                data: {
                    labels: ['Finanzas', 'Servidor', 'Usuario', 'Equipo', 'Líder Producto'],
                    datasets: [{
                        data: [65, 59, 90, 81, 56],
                        backgroundColor: 'rgba(234, 179, 8, 0.2)',
                        borderColor: '#eab308',
                        pointBackgroundColor: '#eab308'
                    }, {
                        data: [28, 48, 40, 19, 96],
                        backgroundColor: 'rgba(34, 197, 94, 0.2)',
                        borderColor: '#22c55e',
                        pointBackgroundColor: '#22c55e'
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, scales: { r: { grid: { color: '#2b2f3a' }, ticks: { display: false } } }, plugins: { legend: { display: false } } }
            });
        }

        createDonutChart('chart-reports-donut', [35, 25, 20, 20], ['#22c55e', '#eab308', '#ef4444', '#6b7280']);
        createLineChart('chart-reports-usage', [5, 10, 8, 15, 12, 20, 25], '234, 179, 8');
    }

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

    window.selectTmdb = function(el, title) {
        document.querySelectorAll('.poster-item').forEach(i => i.classList.remove('selected'));
        el.classList.add('selected');
        document.getElementById('tmdb-inject-area').classList.remove('hidden');
        document.getElementById('tmdb-selected-title').textContent = title;
    };

    document.getElementById('btn-cancel-tmdb')?.addEventListener('click', () => {
        document.getElementById('tmdb-inject-area').classList.add('hidden');
        document.getElementById('tmdb-url').value = '';
    });
});
