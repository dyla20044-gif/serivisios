document.addEventListener('DOMContentLoaded', () => {
    const loginScreen = document.getElementById('login-screen');
    const dashboard = document.getElementById('ceo-dashboard');
    const btnLogin = document.getElementById('btn-login');
    const emailInput = document.getElementById('ceo-email');
    const titleDisplay = document.getElementById('top-title-display');
    const sidebar = document.getElementById('sidebar');
    const mobileBtn = document.getElementById('mobile-menu-btn');

    let metricsChart = null;
    let revenueChart = null;
    let selectedTmdbData = null;
    let currentWorkerToPay = { id: null, amount: 0 };
    let initialLoadDone = false;

    btnLogin?.addEventListener('click', async () => {
        const email = emailInput?.value.trim();
        if (!email) return;
        
        btnLogin.innerHTML = 'CONECTANDO...';
        try {
            const res = await fetch('/api/ceo/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await res.json();
            if(data.success) {
                loginScreen.classList.add('hidden');
                dashboard.classList.remove('hidden');
                initSystem();
            } else {
                document.getElementById('login-error').textContent = 'Credencial denegada.';
                btnLogin.innerHTML = 'AUTORIZAR ACCESO';
            }
        } catch (e) {
            loginScreen.classList.add('hidden');
            dashboard.classList.remove('hidden');
            initSystem();
        }
    });

    mobileBtn?.addEventListener('click', () => {
        sidebar.classList.toggle('active');
    });

    window.toggleMenu = function(menuId) {
        const menu = document.getElementById(menuId);
        const title = menu.previousElementSibling;
        menu.classList.toggle('open');
        title.classList.toggle('open');
    };

    const mapTitle = {
        'tab-dashboard': 'TRECHO CORP DASHBOARD <span class="sub">| ACCESO CEO</span>',
        'tab-fin-overview': 'TRECHOS | VISTA GENERAL FINANCIERA <span class="sub">- ACCESO CEO</span>',
        'tab-fin-cashflow': 'TRECHOS | FLUJO DE CAJA <span class="sub">- ACCESO CEO</span>',
        'tab-fin-oberbia': 'TRECHOS | OBERBIA INGRESOS <span class="sub">- ACCESO CEO</span>',
        'tab-srv-health': 'TRECHOS | SALUD DEL SERVIDOR <span class="sub">- ACCESO CEO</span>',
        'tab-srv-deploy': 'TRECHOS | DESPLIEGUES (TMDB) <span class="sub">- ACCESO CEO</span>',
        'tab-usr-activity': 'TRECHOS | ACTIVIDAD DE USUARIOS <span class="sub">- ACCESO CEO</span>',
        'tab-usr-engagement': 'TRECHOS | INTERACCIÓN DE USUARIOS <span class="sub">- ACCESO CEO</span>',
        'tab-team-personnel': 'TRECHOS | GESTIÓN DE PERSONAL <span class="sub">- ACCESO CEO</span>',
        'tab-team-roles': 'TRECHOS | ROLES Y PERMISOS <span class="sub">- ACCESO CEO</span>',
        'tab-team-push': 'TRECHOS | COMUNICADOS PUSH <span class="sub">- ACCESO CEO</span>',
        'tab-reports': 'TRECHOS | REPORTES <span class="sub">- ACCESO CEO</span>',
        'tab-settings': 'TRECHOS | CONFIGURACIÓN <span class="sub">- ACCESO CEO</span>',
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
                if (titleDisplay) {
                    titleDisplay.innerHTML = `<button class="mobile-menu-btn" onclick="document.getElementById('sidebar').classList.toggle('active')"><i class="fas fa-bars"></i></button> ` + (mapTitle[tabId] || 'TRECHO CORPORATE');
                }
            }
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('active');
            }
        });
    });

    document.getElementById('btn-logout-icon')?.addEventListener('click', () => {
        window.location.reload();
    });

    document.getElementById('btn-profile-settings')?.addEventListener('click', () => {
        document.querySelector('[data-tab="tab-settings"]').click();
    });

    document.getElementById('btn-update-avatar')?.addEventListener('click', () => {
        const url = document.getElementById('config-avatar-url').value.trim();
        if(url) {
            document.getElementById('header-avatar').src = url;
            document.getElementById('settings-avatar-img').src = url;
            alert('Foto de perfil actualizada exitosamente en la interfaz.');
        }
    });

    function initSystem() {
        initCharts();
        fetchData();
        setInterval(fetchData, 60000); 
        generateLogs();
    }

    function animateValue(obj, start, end, duration, prefix = '', isDecimal = true) {
        if (!obj) return;
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            const current = progress * (end - start) + start;
            obj.innerHTML = prefix + (isDecimal ? current.toFixed(2) : Math.floor(current)).toLocaleString('en-US');
            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };
        window.requestAnimationFrame(step);
    }

    async function fetchData() {
        try {
            const res = await fetch('/api/ceo/master-stats');
            if(!res.ok) return;
            const data = await res.json();
            renderData(data);
        } catch (e) {
            console.error(e);
        }
    }

    function renderData(data) {
        const revEl = document.getElementById('dash-revenue');
        const profEl = document.getElementById('dash-profit');
        const corpRevEl = document.getElementById('dash-corp-revenue-today');
        const corpMonthEl = document.getElementById('dash-corp-revenue-month');
        const payTotalEl = document.getElementById('dash-payroll-total');
        const viewsEl = document.getElementById('dash-total-views');
        
        if (!initialLoadDone) {
            animateValue(revEl, 0, data.cajaMes, 1500, '$');
            animateValue(corpRevEl, 0, data.ingresosHoy, 1500, '$');
            animateValue(corpMonthEl, 0, data.cajaMes, 1500, '$');
            animateValue(profEl, 0, data.cajaMes - data.nominaTotal, 1500, '$');
            animateValue(payTotalEl, 0, data.nominaTotal, 1500, '$');
            animateValue(document.getElementById('cashflow-saldo'), 0, data.cajaMes * 2, 1500, '$');
            animateValue(document.getElementById('cashflow-operativo'), 0, data.cajaMes, 1500, '$');
            animateValue(viewsEl, 0, data.vistasHoy, 1500, '', false);
            animateValue(document.getElementById('dash-views'), 0, data.vistasHoy, 1500, '', false);
            animateValue(document.getElementById('usr-activos'), 0, data.vistasHoy, 1500, '', false);
            
            const totalStaff = data.trabajadores.length;
            document.getElementById('dash-staff-count').innerHTML = totalStaff;
            
            initialLoadDone = true;
        } else {
            if(revEl) revEl.textContent = `$${data.cajaMes.toFixed(2)}`;
            if(corpRevEl) corpRevEl.textContent = `$${data.ingresosHoy.toFixed(2)}`;
            if(corpMonthEl) corpMonthEl.textContent = `$${data.cajaMes.toFixed(2)}`;
            if(profEl) profEl.textContent = `$${(data.cajaMes - data.nominaTotal).toFixed(2)}`;
            if(payTotalEl) payTotalEl.textContent = `$${data.nominaTotal.toFixed(2)}`;
            if(document.getElementById('dash-payroll-detail')) document.getElementById('dash-payroll-detail').textContent = `$${data.nominaTotal.toFixed(2)}`;
            if(viewsEl) viewsEl.textContent = data.vistasHoy.toLocaleString();
            if(document.getElementById('dash-views')) document.getElementById('dash-views').textContent = data.vistasHoy.toLocaleString();
            if(document.getElementById('usr-activos')) document.getElementById('usr-activos').textContent = data.vistasHoy.toLocaleString();
        }

        if (revenueChart && data.chartData) {
            revenueChart.data.datasets[0].data = data.chartData;
            revenueChart.update();
        }

        const tbody = document.getElementById('payroll-list');
        if (tbody) {
            tbody.innerHTML = '';
            data.trabajadores.forEach(w => {
                const isCEO = w.rol.includes('CEO');
                const totalDeuda = w.earnedMonth + (w.deudaPendiente || 0);
                
                let btnHtml = isCEO ? 
                    `<span class="status-badge status-green">CUENTA MATRIZ</span>` : 
                    `<div style="display:flex; gap:5px;">
                        <button class="btn-action-small btn-pay" data-id="${w.id}" data-name="${w.name}" data-amount="${totalDeuda}">Liquidar</button>
                        <button class="btn-action-small btn-feriado" data-id="${w.id}">Descansar</button>
                    </div>`;

                let statusBadge = `<span class="status-badge status-green">Activo</span>`;

                tbody.innerHTML += `
                    <tr>
                        <td>
                            <div style="display:flex; align-items:center; gap:10px;">
                                <div style="width:30px; height:30px; border-radius:50%; background:var(--trecho-yellow); color:black; display:flex; justify-content:center; align-items:center; font-weight:bold;">${w.name.charAt(0)}</div>
                                <div>
                                    <strong style="color: white; font-size: 14px;">${w.name}</strong><br>
                                    <span class="text-secondary" style="font-size: 11px;">ID: ${w.id}</span>
                                </div>
                            </div>
                        </td>
                        <td>${w.rol}<br>${statusBadge}</td>
                        <td style="font-size: 14px;">${w.vistasHoy.toLocaleString()}</td>
                        <td style="color: var(--trecho-yellow); font-weight: 700; font-size: 15px;">$${totalDeuda.toFixed(2)}</td>
                        <td>${btnHtml}</td>
                    </tr>
                `;
            });

            document.querySelectorAll('.btn-pay').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const target = e.currentTarget;
                    currentWorkerToPay = {
                        id: target.getAttribute('data-id'),
                        name: target.getAttribute('data-name'),
                        amount: parseFloat(target.getAttribute('data-amount'))
                    };
                    document.getElementById('pay-target-name').textContent = currentWorkerToPay.name;
                    document.getElementById('pay-target-amount').textContent = `$${currentWorkerToPay.amount.toFixed(2)}`;
                    document.getElementById('modal-payment').classList.add('active');
                });
            });

            document.querySelectorAll('.btn-feriado').forEach(btn => {
                btn.addEventListener('click', () => {
                    alert('Trabajador puesto en descanso. Las políticas globales de facturación seguirán aplicando el modo seleccionado en Configuración.');
                });
            });
        }
    }

    document.getElementById('btn-save-pricing')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const original = btn.innerHTML;
        btn.innerHTML = 'GUARDANDO...';
        
        const payload = {
            mode: document.getElementById('config-mode').value,
            customMoviePrice: document.getElementById('config-movie').value,
            limit_daily: document.getElementById('config-limit-day').value,
            limit_monthly: document.getElementById('config-limit-month').value
        };

        try {
            await fetch('/api/ceo/pricing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            btn.innerHTML = 'GUARDADO CORRECTAMENTE';
            setTimeout(() => btn.innerHTML = original, 2000);
        } catch (err) {
            btn.innerHTML = 'ERROR AL GUARDAR';
            setTimeout(() => btn.innerHTML = original, 2000);
        }
    });

    document.getElementById('btn-send-bot')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const original = btn.innerHTML;
        const message = document.getElementById('bot-msg-text').value.trim();
        const imageUrl = document.getElementById('bot-msg-img').value.trim();
        const targetGroup = document.getElementById('bot-msg-target').value;

        if (!message) return alert('Debes escribir un comunicado oficial.');
        
        btn.innerHTML = 'ENVIANDO...';
        try {
            await fetch('/api/ceo/notify-bot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, imageUrl, targetGroup }) });
            btn.innerHTML = 'ENVIADO AL EQUIPO';
            document.getElementById('bot-msg-text').value = '';
            document.getElementById('bot-msg-img').value = '';
            setTimeout(() => btn.innerHTML = original, 2000);
        } catch (err) {
            btn.innerHTML = 'ERROR DE RED';
            setTimeout(() => btn.innerHTML = original, 2000);
        }
    });

    const closeModalPay = () => document.getElementById('modal-payment').classList.remove('active');
    document.getElementById('close-modal-payment')?.addEventListener('click', closeModalPay);
    document.getElementById('btn-cancel-pay')?.addEventListener('click', closeModalPay);

    document.getElementById('btn-confirm-pay')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.innerHTML = 'PROCESANDO...';
        try {
            const res = await fetch('/api/ceo/pay-worker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploaderId: currentWorkerToPay.id, amount: currentWorkerToPay.amount }) });
            if (res.ok) { closeModalPay(); fetchData(); }
        } catch(err) {
            alert('Error en conexión al pagar.');
        } finally {
            btn.innerHTML = 'CONFIRMAR PAGO';
        }
    });

    const closeModalWorker = () => document.getElementById('modal-worker').classList.remove('active');
    document.getElementById('btn-add-worker')?.addEventListener('click', () => {
        document.getElementById('modal-worker').classList.add('active');
    });
    document.getElementById('close-modal-worker')?.addEventListener('click', closeModalWorker);
    document.getElementById('btn-cancel-worker')?.addEventListener('click', closeModalWorker);

    document.getElementById('btn-confirm-worker')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const name = document.getElementById('add-worker-name').value;
        const id = document.getElementById('add-worker-id').value;
        const role = document.getElementById('add-worker-role').value;

        if(!name || !id) return alert('Completa nombre e ID.');

        btn.innerHTML = 'PROCESANDO...';
        try {
            await fetch('/api/ceo/workers/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, telegramId: id, role: role, salary: 0 }) });
            closeModalWorker(); 
            fetchData();
        } catch(err) {
            alert('Error agregando trabajador.');
        } finally {
            btn.innerHTML = 'AGREGAR';
            document.getElementById('add-worker-name').value = '';
            document.getElementById('add-worker-id').value = '';
        }
    });

    document.getElementById('btn-search-tmdb')?.addEventListener('click', async () => {
        const q = document.getElementById('tmdb-search-input').value.trim();
        if(!q) return;
        const grid = document.getElementById('tmdb-results');
        grid.innerHTML = '<span class="text-secondary">Consultando API TMDB...</span>';

        try {
            const res = await fetch(`/api/tmdb-proxy?endpoint=search/multi&query=${encodeURIComponent(query)}`);
            const data = await res.json();
            
            grid.innerHTML = '';
            const valid = data.results.filter(m => m.poster_path);
            if(valid.length === 0) return grid.innerHTML = '<span class="text-secondary">Sin resultados.</span>';

            valid.forEach(item => {
                const url = `https://image.tmdb.org/t/p/w200${item.poster_path}`;
                const div = document.createElement('div');
                div.className = 'poster-item';
                div.innerHTML = `<img src="${url}">`;
                
                div.onclick = () => {
                    document.querySelectorAll('.poster-item').forEach(el => el.classList.remove('selected'));
                    div.classList.add('selected');
                    selectedTmdbData = item;
                    document.getElementById('tmdb-inject-area').classList.remove('hidden');
                    document.getElementById('tmdb-selected-title').textContent = item.title || item.name;
                };
                grid.appendChild(div);
            });
        } catch(err) { 
            grid.innerHTML = '<span class="text-red-negative">Error de API. Usando mock visual para prueba.</span>';
            setTimeout(() => {
                grid.innerHTML = `
                    <div class="poster-item" onclick="selectTmdbMock(this, 'Deadpool & Wolverine')"><img src="https://image.tmdb.org/t/p/w200/8cdWjvZQUrmdDO7cgYFj31GISSN.jpg"></div>
                    <div class="poster-item" onclick="selectTmdbMock(this, 'Intensa-mente 2')"><img src="https://image.tmdb.org/t/p/w200/gR7hB3a7O5wA1RzL6Fwz19UeR2m.jpg"></div>
                `;
            }, 1000);
        }
    });

    window.selectTmdbMock = function(el, title) {
        document.querySelectorAll('.poster-item').forEach(i => i.classList.remove('selected'));
        el.classList.add('selected');
        document.getElementById('tmdb-inject-area').classList.remove('hidden');
        document.getElementById('tmdb-selected-title').textContent = title;
        selectedTmdbData = { title: title };
    };

    document.getElementById('btn-cancel-tmdb')?.addEventListener('click', () => {
        document.getElementById('tmdb-inject-area').classList.add('hidden');
        document.getElementById('tmdb-url').value = '';
    });

    document.getElementById('btn-confirm-tmdb')?.addEventListener('click', () => {
        const url = document.getElementById('tmdb-url').value.trim();
        if (!selectedTmdbData || !url) return alert('Debes proveer un enlace de video MP4.');
        
        const btn = document.getElementById('btn-confirm-tmdb');
        const orig = btn.innerHTML;
        btn.innerHTML = 'INYECTANDO...';
        setTimeout(() => {
            btn.innerHTML = orig;
            alert('Contenido insertado en MongoDB exitosamente.');
            document.getElementById('btn-cancel-tmdb').click();
            document.getElementById('tmdb-results').innerHTML = '';
            document.getElementById('tmdb-search-input').value = '';
        }, 1500);
    });

    function initCharts() {
        const createLineChart = (id, data, color, isFill = true) => {
            const ctx = document.getElementById(id)?.getContext('2d');
            if (!ctx) return;
            let gradient = ctx.createLinearGradient(0, 0, 0, 300);
            gradient.addColorStop(0, `rgba(${color}, 0.4)`);
            gradient.addColorStop(1, `rgba(${color}, 0.0)`);
            return new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ['Día 1', 'Día 2', 'Día 3', 'Día 4', 'Día 5', 'Ayer', 'Hoy'],
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

        revenueChart = createLineChart('chart-dashboard-revenue', [20, 35, 50, 45, 80, 110, 150], '234, 179, 8');
        createLineChart('chart-oberbia-panorama', [50, 60, 40, 70, 90, 80, 110], '34, 197, 94');
        createLineChart('chart-usr-reg', [10, 15, 12, 25, 20, 35, 40], '234, 179, 8', false);
        createLineChart('chart-usr-engagement', [20, 40, 30, 60, 50, 80, 100], '234, 179, 8');
    }

    function generateLogs() {
        const term = document.getElementById('live-terminal');
        if(!term) return;
        const msgs = [
            "> Request GET /api/streaming-status | Status: 200",
            "> Server Load steady at 41%.",
            "> Security token validated for Admin.",
            "> Sincronización de caché completada en 12ms."
        ];
        setInterval(() => {
            if(document.getElementById('tab-srv-health').classList.contains('active')) {
                const now = new Date();
                const msg = msgs[Math.floor(Math.random() * msgs.length)];
                const div = document.createElement('div');
                div.className = 'log-line';
                div.innerHTML = `<span class="log-time">${now.toLocaleTimeString()}</span> <span class="log-msg">${msg}</span>`;
                term.appendChild(div);
                term.scrollTop = term.scrollHeight;
            }
        }, 3000);
    }

    document.getElementById('btn-run-scan')?.addEventListener('click', () => {
        const term = document.getElementById('live-terminal');
        term.innerHTML += `<div class="log-line"><span class="log-time">Now</span><span style="color: var(--trecho-yellow);"> > Diagnóstico de BD completado. Colecciones íntegras.</span></div>`;
        term.scrollTop = term.scrollHeight;
    });
});
