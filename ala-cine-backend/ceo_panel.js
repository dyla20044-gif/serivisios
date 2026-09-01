document.addEventListener('DOMContentLoaded', () => {
    const loginScreen = document.getElementById('login-screen');
    const dashboard = document.getElementById('ceo-dashboard');
    const btnLogin = document.getElementById('btn-login');
    const emailInput = document.getElementById('ceo-email');
    const titleDisplay = document.getElementById('top-title-display');

    window.myCharts = {}; 
    let deleteQueue = [];
    let currentTestItem = null;

    window.openCustomModal = function(id) {
        const modal = document.getElementById(id);
        if(modal) modal.classList.add('active');
        
        if(id === 'modal-detalle-hoy') {
            const options = { day: 'numeric', month: 'long', year: 'numeric' };
            document.getElementById('modal-hoy-date').innerText = new Date().toLocaleDateString('es-ES', options);
            document.getElementById('modal-hoy-monto').innerText = document.getElementById('dash-revenue-today').innerText;
        }

        if(id === 'modal-crecimiento') {
            document.getElementById('modal-mes-monto').innerText = document.getElementById('dash-revenue-month').innerText;
            document.getElementById('modal-mes-trafico').innerText = document.getElementById('dash-active-users').innerText;
            
            const ctx = document.getElementById('mini-chart-crecimiento')?.getContext('2d');
            if(ctx && !window.miniChartCreado) {
                new Chart(ctx, {
                    type: 'line',
                    data: { labels: ['1','2','3','4','5','6','7'], datasets: [{ data: [10, 30, 20, 50, 70, 90, 150], borderColor: '#22c55e', backgroundColor: 'rgba(34, 197, 94, 0.2)', fill: true, tension: 0.4 }] },
                    options: { responsive: true, maintainAspectRatio: false, scales: { x: {display: false}, y: {display: false} }, plugins: { legend: {display: false} } }
                });
                window.miniChartCreado = true;
            }
        }
        
        if(id === 'modal-gastos-operativos') {
            const ctx = document.getElementById('chart-modal-gastos-detalle')?.getContext('2d');
            if(ctx && !window.chartModalGastosCreado) {
                new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        datasets: [{
                            data: [8.28, 13.91, 51.21, 12.77, 8.20, 5.62],
                            backgroundColor: ['#3b82f6', '#8b5cf6', '#eab308', '#f97316', '#06b6d4', '#6b7280'],
                            borderWidth: 0,
                            cutout: '65%'
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
                });
                window.chartModalGastosCreado = true;
            }
        }
    };

    window.closeCustomModal = function(id) {
        const modal = document.getElementById(id);
        if(modal) modal.classList.remove('active');
        if(id === 'modal-test-video') {
            const iframe = document.getElementById('test-video-iframe');
            if(iframe) iframe.src = '';
        }
    };

    window.openSidePanel = function(id) {
        document.getElementById('panel-teso-total').innerText = document.getElementById('dash-revenue-today').innerText;
        const panel = document.getElementById(id);
        if(panel) panel.classList.add('open');
    };

    window.closeSidePanel = function(id) {
        const panel = document.getElementById(id);
        if(panel) panel.classList.remove('open');
    };

    btnLogin?.addEventListener('click', async () => {
        const role = document.getElementById('login-role').value;
        const email = emailInput?.value.trim();
        const password = document.getElementById('ceo-password').value.trim();
        
        if (!email || !password) {
            document.getElementById('login-error').innerText = "Completa todos los campos.";
            return;
        }
        
        btnLogin.innerHTML = 'CONECTANDO...';
        
        try {
            const res = await fetch('/api/ceo/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, role, password })
            });
            const data = await res.json();
            
            if (data.success) {
                const headerName = document.getElementById('header-ceo-name');
                if (headerName) {
                    headerName.innerHTML = `${data.role === 'ceo' ? 'Admin CEO' : 'Co-Fundadora'} <i class="fas fa-chevron-down" style="font-size: 10px; margin-left: 5px;"></i>`;
                }
                loginScreen.classList.add('hidden');
                dashboard.classList.remove('hidden');
                initCharts(); 
                initSystem(); 
                setInterval(initSystem, 10000); 
            } else {
                document.getElementById('login-error').innerText = data.message;
                btnLogin.innerHTML = 'AUTORIZAR ACCESO';
            }
        } catch (error) {
            document.getElementById('login-error').innerText = "Error de conexión al servidor.";
            btnLogin.innerHTML = 'AUTORIZAR ACCESO';
        }
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
        'tab-srv-deploy': 'SERVIDORES | GESTOR DE ENLACES',
        'tab-usr-activity': 'PLATAFORMA | ACTIVIDAD GLOBAL <span class="sub">- ACCESO CEO</span>',
        'tab-usr-payments': 'PLATAFORMA | UPLOADERS & PAGOS <span class="sub">- RECURSOS HUMANOS</span>',
        'tab-bot-broadcast': 'PLATAFORMA | BROADCAST & BOT <span class="sub">- COMUNICADOS</span>',
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

    async function initSystem() {
        try {
            const response = await fetch('/api/ceo/master-stats').catch(() => null);
            if (!response || !response.ok) throw new Error("No hay conexión con el servidor");
            
            const data = await response.json();

            document.getElementById('dash-revenue-today').innerText = `$${parseFloat(data.ingresosHoy || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            document.getElementById('dash-revenue-month').innerText = `$${parseFloat(data.cajaMes || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            document.getElementById('dash-revenue-total').innerText = `$${parseFloat(data.ingresosHistoricos || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            document.getElementById('dash-active-users').innerText = (data.vistasHoy || 0).toLocaleString();

            const trendEl = document.getElementById('dash-trend');
            if (trendEl) {
                trendEl.innerHTML = `<i class="fas fa-arrow-up"></i> Sistema Online`;
                trendEl.className = 'trend-up text-green';
            }

            const totalHistoricoStr = `$${parseFloat(data.ingresosHistoricos || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            
            const revenueYtdEl = document.getElementById('fin-revenue-ytd');
            if(revenueYtdEl) revenueYtdEl.innerText = totalHistoricoStr;
            
            const netCashflowEl = document.getElementById('fin-net-cashflow');
            if(netCashflowEl) netCashflowEl.innerText = totalHistoricoStr;

            if (window.myCharts['chart-dashboard-revenue'] && data.chartLabels && data.chartData) {
                window.myCharts['chart-dashboard-revenue'].data.labels = data.chartLabels;
                window.myCharts['chart-dashboard-revenue'].data.datasets[0].data = data.chartData;
                window.myCharts['chart-dashboard-revenue'].update();
            }

            renderWorkersTable(data.trabajadores || []);
            renderElegantTeamList(data.trabajadores || []);

        } catch (error) {
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
        const tbodyBank = document.getElementById('tabla-retiros-bancarios');
        const godSelect = document.getElementById('god-uid');
        const inspectorSelect = document.getElementById('inspector-uid');
        
        if (tbody) tbody.innerHTML = '';
        if (tbodyBank) tbodyBank.innerHTML = '';
        
        const currentValueGod = godSelect ? godSelect.value : '';
        const currentValueInspector = inspectorSelect ? inspectorSelect.value : '';

        if (godSelect) godSelect.innerHTML = '<option value="">Selecciona un usuario...</option>';
        if (inspectorSelect) inspectorSelect.innerHTML = '<option value="">Selecciona un Uploader...</option>';
        
        let hasBank = false;

        trabajadores.forEach(t => {
            const badgeClass = t.rol.includes('CEO') ? 'status-green' : (t.rol.includes('Co-Fundador') ? 'status-yellow' : 'status-neutral');
            
            if (tbody) {
                tbody.insertAdjacentHTML('beforeend', `
                    <tr>
                        <td><strong>${t.name}</strong><br><span style="font-size: 11px; color: var(--text-secondary);">ID: ${t.id}</span></td>
                        <td><span class="status-badge ${badgeClass}">${t.rol}</span></td>
                        <td>${t.totalUploads}</td>
                        <td class="text-green">+$${(t.earnedToday || 0).toFixed(2)}</td>
                        <td style="font-weight: bold; color: var(--trecho-yellow);">$${(t.deudaPendiente || 0).toFixed(2)}</td>
                        <td><button class="btn-outline" style="padding: 5px 10px; width: auto; font-size: 11px;" onclick="prepararLiquidacion('${t.id}', '${t.name}', ${t.deudaPendiente}, 'Panel Principal')">Liquidar</button></td>
                    </tr>
                `);
            }

            if (t.bank && tbodyBank) {
                hasBank = true;
                tbodyBank.insertAdjacentHTML('beforeend', `
                    <tr>
                        <td><strong>${t.name}</strong><br><span style="font-size: 11px; color: var(--text-secondary);">ID: ${t.id}</span></td>
                        <td>${t.bank.banco}</td>
                        <td>${t.bank.cuenta}</td>
                        <td>${t.bank.titular}</td>
                        <td class="text-trecho" style="font-weight: bold;">$${(t.deudaPendiente || 0).toFixed(2)}</td>
                        <td><button class="btn-liquidar" onclick="prepararLiquidacion('${t.id}', '${t.name}', ${t.deudaPendiente}, 'Banco: ${t.bank.banco}')">Marcar Pagado</button></td>
                    </tr>
                `);
            }

            if (godSelect) {
                godSelect.insertAdjacentHTML('beforeend', `<option value="${t.id}">${t.name} (Saldo: $${(t.deudaPendiente || 0).toFixed(2)})</option>`);
            }
            if (inspectorSelect) {
                inspectorSelect.insertAdjacentHTML('beforeend', `<option value="${t.id}">${t.name} (${t.id})</option>`);
            }
        });

        if (!hasBank && tbodyBank) {
            tbodyBank.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">No hay solicitudes bancarias guardadas.</td></tr>';
        }

        if (godSelect && currentValueGod) godSelect.value = currentValueGod;
        if (inspectorSelect && currentValueInspector) inspectorSelect.value = currentValueInspector;
    }

    let liquidacionActual = null;
    
    window.prepararLiquidacion = function(uid, name, amount, defaultMethod = "Transferencia Bancaria") {
        liquidacionActual = uid;
        document.getElementById('liq-name').innerText = name;
        document.getElementById('liq-amount').innerText = `$${parseFloat(amount).toFixed(2)}`;
        document.getElementById('liq-method').value = defaultMethod;
        openCustomModal('modal-liquidar');
    };

    document.getElementById('btn-confirm-liquidar')?.addEventListener('click', async () => {
        if (!liquidacionActual) return;
        const amountStr = document.getElementById('liq-amount').innerText.replace('$', '');
        const method = document.getElementById('liq-method').value;

        try {
            const res = await fetch('/api/ceo/pay-worker', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uploaderId: liquidacionActual, amount: parseFloat(amountStr), paymentMethod: method })
            });
            const result = await res.json();
            if (result.success) {
                closeCustomModal('modal-liquidar');
                alert('Pago registrado correctamente. El saldo del usuario ha vuelto a $0.00');
                initSystem(); 
            }
        } catch(e) {
            alert('Error al liquidar.');
        }
    });

    document.getElementById('btn-force-balance')?.addEventListener('click', async () => {
        const uid = document.getElementById('god-uid').value;
        const newBalance = document.getElementById('god-balance').value;
        if(!uid || newBalance === '') return alert("Completa los campos.");

        try {
            const res = await fetch('/api/ceo/fix-balance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid, newBalance })
            });
            const result = await res.json();
            if(result.success) {
                alert("Saldo sobrescrito con éxito. Errores negativos borrados.");
                document.getElementById('god-balance').value = '';
                initSystem();
            }
        } catch(e) { 
            alert("Error al intentar corregir."); 
        }
    });

    document.getElementById('btn-send-broadcast')?.addEventListener('click', async () => {
        const message = document.getElementById('bot-msg-text').value;
        const imageUrl = document.getElementById('bot-msg-img').value;
        if(!message) return alert("El mensaje no puede estar vacío.");

        const btn = document.getElementById('btn-send-broadcast');
        btn.innerText = "ENVIANDO...";

        try {
            const res = await fetch('/api/ceo/notify-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, imageUrl, targetGroup: 'all_admins' })
            });
            const result = await res.json();
            if(result.success) {
                alert("Comunicado enviado con éxito al Bot de Telegram.");
                document.getElementById('bot-msg-text').value = '';
                document.getElementById('bot-msg-img').value = '';
            }
        } catch(e) { 
            alert("Error al enviar el comunicado."); 
        }
        
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> ENVIAR COMUNICADO AHORA';
    });

    document.getElementById('btn-load-content')?.addEventListener('click', async () => {
        const uid = document.getElementById('inspector-uid').valueEl script del panel de administración centraliza la lógica de autenticación, visualización de métricas financieras mediante Chart.js, gestión de trabajadores y envío de comunicados[cite: 1]. 

```javascript
document.addEventListener('DOMContentLoaded', () => {
    const loginScreen = document.getElementById('login-screen');
    const dashboard = document.getElementById('ceo-dashboard');
    const btnLogin = document.getElementById('btn-login');
    const emailInput = document.getElementById('ceo-email');
    const titleDisplay = document.getElementById('top-title-display');

    window.myCharts = {}; 

    window.openCustomModal = function(id) {
        const modal = document.getElementById(id);
        if(modal) modal.classList.add('active');
        
        if(id === 'modal-detalle-hoy') {
            const options = { day: 'numeric', month: 'long', year: 'numeric' };
            document.getElementById('modal-hoy-date').innerText = new Date().toLocaleDateString('es-ES', options);
            document.getElementById('modal-hoy-monto').innerText = document.getElementById('dash-revenue-today').innerText;
        }

        if(id === 'modal-crecimiento') {
            document.getElementById('modal-mes-monto').innerText = document.getElementById('dash-revenue-month').innerText;
            document.getElementById('modal-mes-trafico').innerText = document.getElementById('dash-active-users').innerText;
            
            const ctx = document.getElementById('mini-chart-crecimiento')?.getContext('2d');
            if(ctx && !window.miniChartCreado) {
                new Chart(ctx, {
                    type: 'line',
                    data: { labels: ['1','2','3','4','5','6','7'], datasets: [{ data: [10, 30, 20, 50, 70, 90, 150], borderColor: '#22c55e', backgroundColor: 'rgba(34, 197, 94, 0.2)', fill: true, tension: 0.4 }] },
                    options: { responsive: true, maintainAspectRatio: false, scales: { x: {display: false}, y: {display: false} }, plugins: { legend: {display: false} } }
                });
                window.miniChartCreado = true;
            }
        }
        
        if(id === 'modal-gastos-operativos') {
            const ctx = document.getElementById('chart-modal-gastos-detalle')?.getContext('2d');
            if(ctx && !window.chartModalGastosCreado) {
                new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        datasets: [{
                            data: [8.28, 13.91, 51.21, 12.77, 8.20, 5.62],
                            backgroundColor: ['#3b82f6', '#8b5cf6', '#eab308', '#f97316', '#06b6d4', '#6b7280'],
                            borderWidth: 0,
                            cutout: '65%'
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
                });
                window.chartModalGastosCreado = true;
            }
        }
    };

    window.closeCustomModal = function(id) {
        const modal = document.getElementById(id);
        if(modal) modal.classList.remove('active');
    };

    window.openSidePanel = function(id) {
        document.getElementById('panel-teso-total').innerText = document.getElementById('dash-revenue-today').innerText;
        const panel = document.getElementById(id);
        if(panel) panel.classList.add('open');
    };

    window.closeSidePanel = function(id) {
        const panel = document.getElementById(id);
        if(panel) panel.classList.remove('open');
    };

    btnLogin?.addEventListener('click', () => {
        const email = emailInput?.value.trim();
        if (!email) return;
        
        btnLogin.innerHTML = 'CONECTANDO...';
        setTimeout(() => {
            loginScreen.classList.add('hidden');
            dashboard.classList.remove('hidden');
            initCharts(); 
            initSystem(); 
            setInterval(initSystem, 10000); 
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
        'tab-bot-broadcast': 'PLATAFORMA | BROADCAST & BOT <span class="sub">- COMUNICADOS</span>',
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

    async function initSystem() {
        try {
            const response = await fetch('/api/ceo/master-stats').catch(() => null);
            if (!response || !response.ok) throw new Error("No hay conexión con el servidor");
            
            const data = await response.json();

            document.getElementById('dash-revenue-today').innerText = `$${parseFloat(data.ingresosHoy || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            document.getElementById('dash-revenue-month').innerText = `$${parseFloat(data.cajaMes || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            document.getElementById('dash-revenue-total').innerText = `$${parseFloat(data.ingresosHistoricos || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            document.getElementById('dash-active-users').innerText = (data.vistasHoy || 0).toLocaleString();

            const trendEl = document.getElementById('dash-trend');
            if (trendEl) {
                trendEl.innerHTML = `<i class="fas fa-arrow-up"></i> Sistema Online`;
                trendEl.className = 'trend-up text-green';
            }

            const totalHistoricoStr = `$${parseFloat(data.ingresosHistoricos || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
            
            const revenueYtdEl = document.getElementById('fin-revenue-ytd');
            if(revenueYtdEl) revenueYtdEl.innerText = totalHistoricoStr;
            
            const netCashflowEl = document.getElementById('fin-net-cashflow');
            if(netCashflowEl) netCashflowEl.innerText = totalHistoricoStr;

            if (window.myCharts['chart-dashboard-revenue'] && data.chartLabels && data.chartData) {
                window.myCharts['chart-dashboard-revenue'].data.labels = data.chartLabels;
                window.myCharts['chart-dashboard-revenue'].data.datasets[0].data = data.chartData;
                window.myCharts['chart-dashboard-revenue'].update();
            }

            renderWorkersTable(data.trabajadores || []);
            renderElegantTeamList(data.trabajadores || []);

        } catch (error) {
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
        const tbodyBank = document.getElementById('tabla-retiros-bancarios');
        const godSelect = document.getElementById('god-uid');
        
        if (tbody) tbody.innerHTML = '';
        if (tbodyBank) tbodyBank.innerHTML = '';
        if (godSelect) godSelect.innerHTML = '<option value="">Selecciona un usuario...</option>';
        
        let hasBank = false;

        trabajadores.forEach(t => {
            const badgeClass = t.rol.includes('CEO') ? 'status-green' : (t.rol.includes('Co-Fundador') ? 'status-yellow' : 'status-neutral');
            
            if (tbody) {
                tbody.insertAdjacentHTML('beforeend', `
                    <tr>
                        <td><strong>${t.name}</strong><br><span style="font-size: 11px; color: var(--text-secondary);">ID: ${t.id}</span></td>
                        <td><span class="status-badge ${badgeClass}">${t.rol}</span></td>
                        <td>${t.totalUploads}</td>
                        <td class="text-green">+$${(t.earnedToday || 0).toFixed(2)}</td>
                        <td style="font-weight: bold; color: var(--trecho-yellow);">$${(t.deudaPendiente || 0).toFixed(2)}</td>
                        <td><button class="btn-outline" style="padding: 5px 10px; width: auto; font-size: 11px;" onclick="prepararLiquidacion('${t.id}', '${t.name}', ${t.deudaPendiente}, 'Panel Principal')">Liquidar</button></td>
                    </tr>
                `);
            }

            if (t.bank && tbodyBank) {
                hasBank = true;
                tbodyBank.insertAdjacentHTML('beforeend', `
                    <tr>
                        <td><strong>${t.name}</strong><br><span style="font-size: 11px; color: var(--text-secondary);">ID: ${t.id}</span></td>
                        <td>${t.bank.banco}</td>
                        <td>${t.bank.cuenta}</td>
                        <td>${t.bank.titular}</td>
                        <td class="text-trecho" style="font-weight: bold;">$${(t.deudaPendiente || 0).toFixed(2)}</td>
                        <td><button class="btn-liquidar" onclick="prepararLiquidacion('${t.id}', '${t.name}', ${t.deudaPendiente}, 'Banco: ${t.bank.banco}')">Marcar Pagado</button></td>
                    </tr>
                `);
            }

            if (godSelect) {
                godSelect.insertAdjacentHTML('beforeend', `<option value="${t.id}">${t.name} (Saldo: $${(t.deudaPendiente || 0).toFixed(2)})</option>`);
            }
        });

        if (!hasBank && tbodyBank) {
            tbodyBank.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">No hay solicitudes bancarias guardadas.</td></tr>';
        }
    }

    let liquidacionActual = null;
    
    window.prepararLiquidacion = function(uid, name, amount, defaultMethod = "Transferencia Bancaria") {
        liquidacionActual = uid;
        document.getElementById('liq-name').innerText = name;
        document.getElementById('liq-amount').innerText = `$${parseFloat(amount).toFixed(2)}`;
        document.getElementById('liq-method').value = defaultMethod;
        openCustomModal('modal-liquidar');
    };

    document.getElementById('btn-confirm-liquidar')?.addEventListener('click', async () => {
        if (!liquidacionActual) return;
        const amountStr = document.getElementById('liq-amount').innerText.replace('$', '');
        const method = document.getElementById('liq-method').value;

        try {
            const res = await fetch('/api/ceo/pay-worker', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uploaderId: liquidacionActual, amount: parseFloat(amountStr), paymentMethod: method })
            });
            const result = await res.json();
            if (result.success) {
                closeCustomModal('modal-liquidar');
                alert('Pago registrado correctamente. El saldo del usuario ha vuelto a $0.00');
                initSystem(); 
            }
        } catch(e) {
            alert('Error al liquidar.');
        }
    });

    document.getElementById('btn-force-balance')?.addEventListener('click', async () => {
        const uid = document.getElementById('god-uid').value;
        const newBalance = document.getElementById('god-balance').value;
        if(!uid || newBalance === '') return alert("Completa los campos.");

        try {
            const res = await fetch('/api/ceo/fix-balance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid, newBalance })
            });
            const result = await res.json();
            if(result.success) {
                alert("Saldo sobrescrito con éxito. Errores negativos borrados.");
                document.getElementById('god-balance').value = '';
                initSystem();
            }
        } catch(e) { 
            alert("Error al intentar corregir."); 
        }
    });

    document.getElementById('btn-send-broadcast')?.addEventListener('click', async () => {
        const message = document.getElementById('bot-msg-text').value;
        const imageUrl = document.getElementById('bot-msg-img').value;
        if(!message) return alert("El mensaje no puede estar vacío.");

        const btn = document.getElementById('btn-send-broadcast');
        btn.innerText = "ENVIANDO...";

        try {
            const res = await fetch('/api/ceo/notify-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, imageUrl, targetGroup: 'all_admins' })
            });
            const result = await res.json();
            if(result.success) {
                alert("Comunicado enviado con éxito al Bot de Telegram.");
                document.getElementById('bot-msg-text').value = '';
                document.getElementById('bot-msg-img').value = '';
            }
        } catch(e) { 
            alert("Error al enviar el comunicado."); 
        }
        
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> ENVIAR COMUNICADO AHORA';
    });

    function renderElegantTeamList(trabajadores) {
        const container = document.getElementById('dashboard-team-list');
        if (!container) return;
        
        container.innerHTML = '';
        if(trabajadores.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-secondary);">No hay personal activo en la plataforma.</div>';
            return;
        }

        trabajadores.forEach(t => {
            const statusClass = t.earnedToday > 0 ? 'badge-success' : 'badge-neutral';
            const statusText = t.earnedToday > 0 ? '<i class="fas fa-check-circle"></i> Activo Hoy' : '<i class="fas fa-moon"></i> Inactivo';
            const avatarUrl = `[https://ui-avatars.com/api/?name=$](https://ui-avatars.com/api/?name=$){encodeURIComponent(t.name)}&background=random&color=fff&bold=true`;

            const html = `
                <div class="team-list-item">
                    <div class="team-info">
                        <img src="${avatarUrl}" alt="user">
                        <div class="team-meta">
                            <span style="font-weight: 600; font-size: 13px; color: var(--text-primary);">${t.name}</span>
                            <span class="badge-status ${statusClass}">${statusText}</span>
                        </div>
                    </div>
                    <div class="team-financial">
                        <span style="font-size: 11px; color: var(--text-secondary);">Saldo: <strong style="color: var(--trecho-yellow);">$${(t.deudaPendiente || 0).toFixed(2)}</strong></span>
                        <button class="btn-liquidar" onclick="prepararLiquidacion('${t.id}', '${t.name}', ${t.deudaPendiente}, 'Panel Rápido')">Liquidar</button>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', html);
        });
    }

    document.getElementById('btn-generar-enlace')?.addEventListener('click', () => {
        const fakeLink = "[https://app.trechovisionaries.com/invite?token=](https://app.trechovisionaries.com/invite?token=)" + Math.random().toString(36).substr(2, 9);
        prompt("Copia este enlace y envíalo a tu nuevo trabajador por WhatsApp:", fakeLink);
    });

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
        
        const ctxActivity = document.getElementById('chart-dashboard-activity')?.getContext('2d');
        if (ctxActivity) {
            window.myCharts['chart-dashboard-activity'] = new Chart(ctxActivity, {
                type: 'line',
                data: {
                    labels: ['0:00', '4:00', '8:00', '12:00', '16:00', '20:00', '24:00'],
                    datasets: [
                        { label: 'Tráfico 4K', data: [5, 10, 5, 25, 15, 30, 10], borderColor: '#eab308', tension: 0.4, borderWidth: 2 },
                        { label: 'Tráfico HD', data: [2, 5, 8, 15, 10, 20, 5], borderColor: '#22c55e', tension: 0.4, borderWidth: 2 },
                        { label: 'Tráfico SD', data: [1, 2, 3, 8, 5, 10, 2], borderColor: '#ef4444', tension: 0.4, borderWidth: 2 }
                    ]
                },
                options: {
                    responsive: true, 
                    maintainAspectRatio: false,
                    scales: { 
                        x: { grid: {display: false}, ticks: {color: '#9ca3af'} }, 
                        y: { display: false } 
                    },
                    plugins: { legend: { display: false } },
                    elements: { point: { radius: 0 } }
                }
            });
        }

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
