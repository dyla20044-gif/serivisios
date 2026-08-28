document.addEventListener('DOMContentLoaded', () => {
    const loginScreen = document.getElementById('login-screen');
    const dashboard = document.getElementById('ceo-dashboard');
    const btnLogin = document.getElementById('btn-login');
    const emailInput = document.getElementById('ceo-email');
    const titleDisplay = document.getElementById('top-title-display');

    btnLogin?.addEventListener('click', () => {
        const email = emailInput?.value.trim();
        if (!email) return;
        
        btnLogin.innerHTML = 'CONECTANDO...';
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

    const mapTitle = {
        'tab-dashboard': 'TRECHO CORP OVERVIEW DASHBOARD <span class="sub">| CEO ACCESS</span>',
        'tab-fin-overview': 'TRECHO VISIONARIOS | FINANCIAL OVERVIEW <span class="sub">- CEO ACCESS</span>',
        'tab-fin-policies': 'TRECHO VISIONARIOS | CONFIGURACIONES DE LA CUENTA Y SISTEMA',
        'tab-fin-cashflow': 'TRECHO VISIONARIOS | ANÁLISIS DE FLUJO DE CAJA - ACCESO CEO',
        'tab-fin-oberbia': 'TRECHO VISIONARIOS | RESUMEN GENERAL (OBERBIA) - ACCESO CEO',
        'tab-srv-health': 'TRECHO VISIONARIOS | SERVERS <span class="sub">- CEO ACCESS</span>',
        'tab-srv-deploy': 'TRECHO VISIONARIOS | MANUAL DEPLOYMENTS (TMDB)',
        'tab-usr-activity': 'TRECHO VISIONARIOS | USERS <span class="sub">- CEO ACCESS</span>',
        'tab-team-personnel': 'TRECHO VISIONARIOS | TEAM MANAGEMENT <span class="sub">- CEO ACCESS</span>',
        'tab-team-roles': 'TRECHO VISIONARIOS | ROLES & PERMISSIONS <span class="sub">- CEO ACCESS</span>',
        'tab-reports': 'TRECHO VISIONARIOS | CENTRO DE REPORTES <span class="sub">- ACCESO CEO</span>',
        'tab-settings': 'TRECHO VISIONARIOS | CONFIGURACIONES DE LA CUENTA Y SISTEMA',
        'tab-empresa': 'TRECHO CORPORATE <span class="sub">| ACERCA DE LA EMPRESA</span>'
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
                titleDisplay.innerHTML = mapTitle[tabId] || 'TRECHO VISIONARIOS';
            }
        });
    });

    document.getElementById('btn-logout-icon')?.addEventListener('click', () => {
        window.location.reload();
    });

    function initSystem() {
        initCharts();
    }

    function initCharts() {
        const createLineChart = (id, data, color, isFill = true) => {
            const ctx = document.getElementById(id)?.getContext('2d');
            if (!ctx) return;
            let gradient = ctx.createLinearGradient(0, 0, 0, 300);
            gradient.addColorStop(0, `rgba(${color}, 0.4)`);
            gradient.addColorStop(1, `rgba(${color}, 0.0)`);
            new Chart(ctx, {
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
            new Chart(ctx, {
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
            new Chart(ctx, {
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

        createLineChart('chart-dashboard-revenue', [20, 35, 50, 45, 80, 110, 150], '234, 179, 8');
        createBarChart('chart-dashboard-activity', [40, 30, 60, 45, 80, 50, 90], '234, 179, 8');
        createBarChart('chart-dashboard-workforce', [60, 40, 80, 65, 90, 70, 100], '234, 179, 8');

        createLineChart('chart-fin-cashflow', [50, 60, 40, 70, 90, 80, 110], '234, 179, 8');
        createDonutChart('chart-fin-expense-donut', [40, 30, 20, 10], ['#eab308', '#f97316', '#ef4444', '#6b7280']);
        
        const ctxProduct = document.getElementById('chart-fin-product')?.getContext('2d');
        if (ctxProduct) {
            new Chart(ctxProduct, {
                type: 'bar',
                data: {
                    labels: ['Product 1', 'Product 2', 'Product 3', 'Product 4', 'Legal'],
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
            new Chart(ctxRadar, {
                type: 'radar',
                data: {
                    labels: ['Finance', 'Server', 'User', 'Team', 'Product Lead'],
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
        grid.innerHTML = '<span class="text-secondary">Searching TMDB...</span>';
        setTimeout(() => {
            grid.innerHTML = `
                <div class="poster-item" onclick="selectTmdb(this, 'Movie 1')"><img src="https://image.tmdb.org/t/p/w200/8cdWjvZQUrmdDO7cgYFj31GISSN.jpg"></div>
                <div class="poster-item" onclick="selectTmdb(this, 'Movie 2')"><img src="https://image.tmdb.org/t/p/w200/gR7hB3a7O5wA1RzL6Fwz19UeR2m.jpg"></div>
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
