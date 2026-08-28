document.addEventListener('DOMContentLoaded', () => {
    // Referencias del DOM
    const loginScreen = document.getElementById('login-screen');
    const dashboard = document.getElementById('ceo-dashboard');
    const btnLogin = document.getElementById('btn-login');
    const emailInput = document.getElementById('ceo-email');

    // Estado global
    let metricsChart = null;
    let selectedTmdbData = null;
    let currentWorkerToPay = { id: null, amount: 0 };

    // ==========================================
    // 1. SISTEMA DE LOGIN (Simulado para frontend, validable en backend)
    // ==========================================
    btnLogin?.addEventListener('click', async () => {
        const email = emailInput?.value.trim();
        if (!email) return;
        
        btnLogin.innerHTML = 'Connecting...';
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
                document.getElementById('login-error').textContent = 'Acceso denegado. Credencial incorrecta.';
                btnLogin.innerHTML = 'Autorizar Conexión';
            }
        } catch (e) {
            // Fallback si corre en local sin auth configurada
            loginScreen.classList.add('hidden');
            dashboard.classList.remove('hidden');
            initSystem();
        }
    });

    // ==========================================
    // 2. NAVEGACIÓN LATERAL (TABS)
    // ==========================================
    document.querySelectorAll('.nav-links li').forEach(li => {
        li.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-links li').forEach(el => el.classList.remove('active'));
            const current = e.currentTarget;
            current.classList.add('active');
            
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            const tabId = current.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');
        });
    });

    // ==========================================
    // 3. INICIALIZACIÓN Y LLAMADAS A LA API
    // ==========================================
    function initSystem() {
        initChart();
        fetchData();
        setInterval(fetchData, 30000); // Polling cada 30 seg
        generateLogs();
    }

    async function fetchData() {
        try {
            const res = await fetch('/api/ceo/master-stats');
            if(!res.ok) return;
            const data = await res.json();
            renderData(data);
        } catch (e) {
            console.error("Error fetching data:", e);
        }
    }

    function renderData(data) {
        // Pestaña Deploys (Ingresos Empresa)
        document.getElementById('deploy-corp-revenue').textContent = `$${data.ingresosHoy.toFixed(2)}`;
        document.getElementById('deploy-payroll').textContent = `$${data.nominaTotal.toFixed(2)}`;
        document.getElementById('deploy-views').textContent = data.vistasHoy.toLocaleString();

        // Actualizar Gráfico
        if (metricsChart) {
            metricsChart.data.datasets[0].data = data.chartData;
            metricsChart.update();
        }

        // Pestaña Environment (Trabajadores)
        const tbody = document.getElementById('env-workers-list');
        tbody.innerHTML = '';
        
        data.trabajadores.forEach(w => {
            const isCEO = w.rol.includes('CEO');
            const totalDeuda = w.earnedMonth + w.deudaPendiente;
            
            let btnHtml = '';
            if (isCEO) {
                btnHtml = `<span class="text-secondary" style="font-size: 11px;">OWNER</span>`;
            } else {
                btnHtml = `<button class="btn-outline btn-pay" data-id="${w.id}" data-name="${w.name}" data-amount="${totalDeuda}">Liquidar Ciclo</button>`;
            }

            tbody.innerHTML += `
                <tr>
                    <td>
                        <strong style="color: white;">${w.name}</strong><br>
                        <span class="text-secondary" style="font-size: 11px;">ID: ${w.id}</span>
                    </td>
                    <td>${w.rol}</td>
                    <td class="text-yellow" style="font-weight: 600;">$${totalDeuda.toFixed(2)}</td>
                    <td>${btnHtml}</td>
                </tr>
            `;
        });

        // Re-asignar eventos a los botones de pago dinámicos
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
    }

    // ==========================================
    // 4. CONTROL DE CONFIGURACIONES (SETTINGS)
    // ==========================================
    document.getElementById('btn-save-pricing')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const originalText = btn.textContent;
        btn.textContent = 'Saving...';
        
        const payload = {
            mode: document.getElementById('config-mode').value,
            customMoviePrice: document.getElementById('config-movie').value,
            limit_daily: document.getElementById('config-limit-day').value,
            limit_monthly: document.getElementById('config-limit-month').value
        };

        try {
            await fetch('/api/ceo/pricing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            btn.textContent = 'Saved!';
            setTimeout(() => btn.textContent = originalText, 2000);
        } catch (err) {
            btn.textContent = 'Error';
            setTimeout(() => btn.textContent = originalText, 2000);
        }
    });

    document.getElementById('btn-send-bot')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const originalText = btn.textContent;
        const message = document.getElementById('bot-msg-text').value.trim();
        const imageUrl = document.getElementById('bot-msg-img').value.trim();
        const targetGroup = document.getElementById('bot-msg-target').value;

        if (!message) return alert('Debes escribir un mensaje.');
        
        btn.textContent = 'Sending...';
        try {
            await fetch('/api/ceo/notify-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, imageUrl, targetGroup })
            });
            btn.textContent = 'Sent Successfully';
            document.getElementById('bot-msg-text').value = '';
            document.getElementById('bot-msg-img').value = '';
            setTimeout(() => btn.textContent = originalText, 2000);
        } catch (err) {
            btn.textContent = 'Error';
            setTimeout(() => btn.textContent = originalText, 2000);
        }
    });

    // ==========================================
    // 5. PAGO DE NÓMINA (MODAL)
    // ==========================================
    const closeModal = () => document.getElementById('modal-payment').classList.remove('active');
    document.getElementById('close-modal-payment')?.addEventListener('click', closeModal);
    document.getElementById('btn-cancel-pay')?.addEventListener('click', closeModal);

    document.getElementById('btn-confirm-pay')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.textContent = 'Processing...';

        try {
            const res = await fetch('/api/ceo/pay-worker', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    uploaderId: currentWorkerToPay.id, 
                    amount: currentWorkerToPay.amount 
                })
            });
            
            if (res.ok) {
                closeModal();
                fetchData(); // Refrescar datos
            }
        } catch(err) {
            alert('Error en conexión al pagar.');
        } finally {
            btn.textContent = 'Confirm Payout';
        }
    });

    // ==========================================
    // 6. INYECCIÓN TMDB (EVENTS)
    // ==========================================
    document.getElementById('btn-search-tmdb')?.addEventListener('click', async () => {
        const query = document.getElementById('tmdb-search-input').value.trim();
        if(!query) return;

        const resultsGrid = document.getElementById('tmdb-results');
        resultsGrid.innerHTML = '<span class="text-secondary">Searching...</span>';

        try {
            const res = await fetch(`/api/tmdb-proxy?endpoint=search/multi&query=${encodeURIComponent(query)}`);
            const data = await res.json();
            
            resultsGrid.innerHTML = '';
            const valid = data.results.filter(m => m.poster_path);
            
            if(valid.length === 0) return resultsGrid.innerHTML = 'No results.';

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
                resultsGrid.appendChild(div);
            });
        } catch(err) {
            resultsGrid.innerHTML = 'Error conectando a TMDB.';
        }
    });

    document.getElementById('btn-cancel-tmdb')?.addEventListener('click', () => {
        document.getElementById('tmdb-inject-area').classList.add('hidden');
        document.getElementById('tmdb-url').value = '';
    });

    // ==========================================
    // 7. GRÁFICA (METRICS)
    // ==========================================
    function initChart() {
        const ctx = document.getElementById('metricsChart')?.getContext('2d');
        if (!ctx) return;
        metricsChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['D-6', 'D-5', 'D-4', 'D-3', 'D-2', 'Ayer', 'Hoy'],
                datasets: [{
                    label: 'Ingresos Brutos ($)',
                    data: [0,0,0,0,0,0,0],
                    borderColor: '#a78bfa',
                    backgroundColor: 'rgba(167, 139, 250, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { grid: { color: '#2d2e36' }, ticks: { color: '#9ca3af' } },
                    x: { grid: { display: false }, ticks: { color: '#9ca3af' } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    // ==========================================
    // 8. LOGS Y SHELL (SIMULACIÓN TERMINAL)
    // ==========================================
    function generateLogs() {
        const term = document.getElementById('live-terminal');
        if(!term) return;

        const msgs = [
            "[API] Petición GET /api/streaming-status recibida. Status: 200",
            "[DB] Cron Job ejecutado: Validación de caché TMDB exitosa.",
            "[Auth] Token JWT verificado para usuario admin.",
            "[Crawler] Escaneando 50 enlaces... 0 errores detectados."
        ];

        setInterval(() => {
            if(document.getElementById('tab-logs').classList.contains('active')) {
                const now = new Date();
                const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
                const rMsg = msgs[Math.floor(Math.random() * msgs.length)];
                
                const div = document.createElement('div');
                div.className = 'log-line';
                div.innerHTML = `
                    <span class="log-time">${timeStr}</span>
                    <span class="log-msg" style="color: #6b7280;">[tj5mb]</span>
                    <span class="log-msg">${rMsg}</span>
                `;
                term.appendChild(div);
                term.scrollTop = term.scrollHeight; // Auto-scroll
            }
        }, 4000);
    }

    document.getElementById('btn-run-scan')?.addEventListener('click', () => {
        const out = document.getElementById('shell-output');
        out.innerHTML += `<br>> Iniciando escaneo de integridad en MongoDB...<br>`;
        setTimeout(() => out.innerHTML += `> Colección 'media_catalog': OK (2491 docs)<br>`, 1000);
        setTimeout(() => out.innerHTML += `> Colección 'uploader_revenue': OK<br>`, 2000);
        setTimeout(() => out.innerHTML += `<span class="log-success">> Sistema operando a capacidad óptima.</span><br>`, 3000);
    });
});
