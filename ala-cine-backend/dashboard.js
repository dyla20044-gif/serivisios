document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('legalModal');
    const mainApp = document.getElementById('mainApp');
    const acceptBtn = document.getElementById('acceptBtn');
    mainApp.style.filter = 'blur(8px)';

    const navItems = document.querySelectorAll('.nav-item');
    const tabSections = document.querySelectorAll('.tab-section');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = item.getAttribute('data-target');
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            tabSections.forEach(tab => {
                tab.classList.remove('active');
                if(tab.id === targetId) tab.classList.add('active');
            });
        });
    });

    const closeBtns = document.querySelectorAll('.close-modal');
    closeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById(btn.getAttribute('data-target')).style.display = 'none';
        });
    });

    document.getElementById('btnGanarMas').addEventListener('click', () => {
        const mod = document.getElementById('pedidasModal');
        mod.style.display = 'flex';
        mod.style.opacity = '1';
    });

    document.getElementById('btnAbrirAdelanto').addEventListener('click', () => {
        const mod = document.getElementById('adelantoModal');
        mod.style.display = 'flex';
        mod.style.opacity = '1';
    });

    document.getElementById('spmCard').addEventListener('click', () => {
        const mod = document.getElementById('spmModal');
        mod.style.display = 'flex';
        mod.style.opacity = '1';
    });

    const ADMIN_2_ID = "00000000"; 
    const ADMIN_2_PHOTO = "https://iili.io/CTsdfdN.jpg"; 
    const ADMIN_2_NAME = "Nadia"; 

    const ADMIN_1_ID = "11111111"; 
    const ADMIN_1_PHOTO = "https://tu-imagen-aqui.jpg"; 
    const ADMIN_1_NAME = "Dylan (CEO)";
    
    const btnConfirmarAdelanto = document.getElementById('btnConfirmarAdelanto');
    if (btnConfirmarAdelanto) {
        btnConfirmarAdelanto.addEventListener('click', () => {
            window.location.href = 'https://t.me/Dylan_1m_oficial'; 
        });
    }

    const btnSolicitarRetiro = document.getElementById('btnSolicitarRetiro');
    if (btnSolicitarRetiro) {
        btnSolicitarRetiro.addEventListener('click', () => {
            alert("Al solicitar el retiro completo, el dinero llegará directamente a su cuenta bancaria. Los cortes y pagos automáticos se realizan el 21 de cada mes.");
        });
    }

    const urlParams = new URLSearchParams(window.location.search);
    const uploaderId = urlParams.get('uid');

    acceptBtn.addEventListener('click', () => {
        modal.style.opacity = '0';
        setTimeout(() => {
            modal.style.display = 'none';
            mainApp.style.filter = 'none';
            if (uploaderId) {
                iniciarConexionServidor(uploaderId);
                checkBankInfo(uploaderId);
            } else {
                alert("Error de seguridad: ID no detectado.");
            }
        }, 300);
    });

    const options = { day: 'numeric', month: 'short' };
    document.getElementById('fechaActual').innerText = new Date().toLocaleDateString('es-ES', options);

    function updateVal(id, value, prefix = "$") {
        const el = document.getElementById(id);
        if (!el) return;
        const text = `${prefix}${(value || 0).toFixed(2)}`;
        if (el.innerText !== text) {
            el.innerText = text;
            el.classList.remove('flash-update');
            void el.offsetWidth;
            el.classList.add('flash-update');
        }
    }

    async function checkBankInfo(uid) {
        try {
            const res = await fetch(`/api/bank-info/${uid}`);
            const data = await res.json();
            const formContainer = document.getElementById('formBancarioContainer');
            
            if (data.success && data.bank) {
                formContainer.innerHTML = `
                    <h3 style="margin-bottom: 15px; font-size: 14px;"><i class="fa-solid fa-building-columns"></i> DATOS BANCARIOS</h3>
                    <div style="background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); padding: 15px; border-radius: 8px;">
                        <p style="color: var(--green-positive); font-size: 13px; margin-bottom: 10px;"><i class="fa-solid fa-circle-check"></i> Tus datos de pago están guardados.</p>
                        <p style="font-size: 12px; color: var(--text-main);"><strong>Banco:</strong> ${data.bank.banco}</p>
                        <p style="font-size: 12px; color: var(--text-main);"><strong>Cuenta:</strong> ${data.bank.cuenta}</p>
                        <p style="font-size: 12px; color: var(--text-main);"><strong>Titular:</strong> ${data.bank.titular}</p>
                    </div>
                `;
            }
        } catch (e) {}
    }

    const formRetiroBancario = document.getElementById('formRetiroBancario');
    if (formRetiroBancario) {
        formRetiroBancario.addEventListener('submit', async (e) => {
            e.preventDefault();
            const bancoNombre = document.getElementById('bancoNombre').value;
            const cuentaNumero = document.getElementById('cuentaNumero').value;
            const titularNombre = document.getElementById('titularNombre').value;
            
            try {
                const res = await fetch('/api/bank-info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uid: uploaderId, banco: bancoNombre, cuenta: cuentaNumero, titular: titularNombre })
                });
                const data = await res.json();
                if (data.success) {
                    alert('Datos bancarios guardados correctamente.');
                    checkBankInfo(uploaderId);
                } else {
                    alert('Error al guardar datos.');
                }
            } catch (error) {
                alert('Error de conexión.');
            }
        });
    }

    async function fetchSpmStatus() {
        try {
            const res = await fetch('/api/spm-status');
            const data = await res.json();
            
            const spmCard = document.getElementById('spmCard');
            const spmValueText = document.getElementById('spmValueText');
            const spmRateText = document.getElementById('spmRateText');
            const modalSpmBoost = document.getElementById('modalSpmBoost');
            const spmTopPedidasList = document.getElementById('spmTopPedidasList');

            if (data.active && data.movieBoost > 0) {
                spmCard.classList.add('spm-active-anim');
                spmValueText.innerText = "¡ALTO!";
                spmValueText.classList.remove('text-yellow');
                spmValueText.classList.add('text-green');
                spmRateText.innerText = `+$${data.movieBoost} Extra`;
                modalSpmBoost.innerText = `+$${data.movieBoost}`;
            } else {
                spmCard.classList.remove('spm-active-anim');
                spmValueText.innerText = "Normal";
                spmValueText.classList.remove('text-green');
                spmValueText.classList.add('text-yellow');
                spmRateText.innerText = "Base";
                modalSpmBoost.innerText = "+$0.00";
            }

            if (data.topRequests && data.topRequests.length > 0) {
                spmTopPedidasList.innerHTML = '';
                data.topRequests.forEach(req => {
                    spmTopPedidasList.innerHTML += `<li><span>🎬 ${req.title}</span> <span class="votos" style="color: var(--accent-yellow); font-weight: bold;">${req.votes} peticiones</span></li>`;
                });
            } else {
                spmTopPedidasList.innerHTML = '<li>Sin peticiones masivas ahora.</li>';
            }
        } catch(e) {}
    }
    
    setInterval(fetchSpmStatus, 5000);
    fetchSpmStatus();

    async function iniciarConexionServidor(uid) {
        document.getElementById('userIdDisplay').innerText = `ID: ${uid}`;
        const userInitialSpan = document.getElementById('userInitial');
        const userAvatarImg = document.getElementById('userAvatarImg');
        const userNameDisplay = document.getElementById('userNameDisplay');

        let isAdmin = false;

        if (uid === ADMIN_2_ID) {
            userInitialSpan.style.display = 'none';
            userAvatarImg.style.display = 'block';
            userAvatarImg.src = ADMIN_2_PHOTO;
            userNameDisplay.innerText = ADMIN_2_NAME;
        } else if (uid === ADMIN_1_ID) {
            userInitialSpan.style.display = 'none';
            userAvatarImg.style.display = 'block';
            userAvatarImg.src = ADMIN_1_PHOTO;
            userNameDisplay.innerText = ADMIN_1_NAME;
            isAdmin = true;
        } else {
            userInitialSpan.innerText = uid.toString().charAt(0) || 'U';
            userNameDisplay.innerText = "Uploader";
        }

        const fetchStats = async () => {
            try {
                const endpoint = isAdmin ? `/api/admin-dashboard/${uid}` : `/api/uploader-stats/${uid}`;
                const res = await fetch(endpoint);
                const data = await res.json();
                
                if (data.success) {
                    if (isAdmin) {
                        renderAdminDashboard(data);
                    } else {
                        renderUserDashboard(data);
                    }
                }
            } catch (e) {}
        };

        fetchStats();
        setInterval(fetchStats, 5000); 
    }

    function renderUserDashboard(data) {
        const f = data.finances;
        updateVal('valHoy', f.todayEarned);
        updateVal('valTotal', f.totalGeneradoGlobal);
        updateVal('valSinRetirar', f.monthEarned);
        updateVal('valMesPasado', f.lastMonthEarned);
        updateVal('valRetirable', f.monthEarned); 
        updateVal('valRetirableGrande', f.monthEarned);
        updateVal('valBonos', f.bonos);

        const montoMax = document.getElementById('montoMaxAdelanto');
        if(montoMax) montoMax.innerText = `$${(f.monthEarned * 0.5).toFixed(2)}`;
        
        const pelisSubidas = document.getElementById('valPelisSubidas');
        if(pelisSubidas) pelisSubidas.innerText = f.moviesSubidas;
        
        const seriesSubidas = document.getElementById('valSeriesSubidas');
        if(seriesSubidas) seriesSubidas.innerText = f.episodiosSubidos;

        const trendIcon = document.getElementById('trendIcon');
        const trendText = document.getElementById('trendText');
        if(trendIcon && trendText) {
            const ayer = f.yesterdayEarned || 0.01; 
            const hoy = f.todayEarned;
            if (hoy >= ayer) {
                trendIcon.innerHTML = '<i class="fa-solid fa-arrow-trend-up"></i>';
                trendIcon.className = 'text-green';
                trendText.className = 'text-green';
                const percent = ayer > 0 ? ((hoy - ayer) / ayer * 100).toFixed(1) : 100;
                trendText.innerText = `+${percent}% subiendo`;
            } else {
                trendIcon.innerHTML = '<i class="fa-solid fa-arrow-trend-down"></i>';
                trendIcon.className = 'text-red';
                trendText.className = 'text-red';
                const percent = ayer > 0 ? ((ayer - hoy) / ayer * 100).toFixed(1) : 0;
                trendText.innerText = `-${percent}% bajando`;
            }
        }

        const listPedidas = document.getElementById('topPedidasList');
        if(listPedidas) {
            listPedidas.innerHTML = '';
            if (data.topRequests && data.topRequests.length > 0) {
                data.topRequests.forEach(req => {
                    listPedidas.innerHTML += `<li><span>🎬 ${req.title}</span> <span class="votos">${req.votes} votos</span></li>`;
                });
            } else {
                listPedidas.innerHTML = '<li>No hay solicitudes pendientes.</li>';
            }
        }

        const listaRecientes = document.getElementById('listaGananciasRecientes');
        if(listaRecientes) {
            listaRecientes.innerHTML = ''; 
            if (data.recentActivity && data.recentActivity.length > 0) {
                data.recentActivity.forEach(act => {
                    let icon = '<i class="fa-solid fa-circle-check text-muted"></i>';
                    if (act.type === 'movie' || act.type === 'estreno' || act.type === 'catalogo') icon = '<i class="fa-solid fa-film text-cyan"></i>';
                    else if (act.type === 'tv' || act.type === 'episodio') icon = '<i class="fa-solid fa-tv text-cyan"></i>';
                    else if (act.type === 'bonus') icon = '<i class="fa-solid fa-gift text-yellow"></i>';
                    else if (act.type === 'views') icon = '<i class="fa-solid fa-eye text-green"></i>';

                    const tituloCorto = act.title.length > 20 ? act.title.substring(0, 20) + "..." : act.title;
                    const timeObj = new Date(act.date);
                    const timeStr = isNaN(timeObj.getTime()) ? '' : timeObj.toLocaleTimeString('es-ES', {hour: '2-digit', minute:'2-digit'});

                    const li = document.createElement('li');
                    li.innerHTML = `<span>${icon} ${tituloCorto} <span style="font-size:10px; color:var(--text-muted);">(${timeStr})</span></span> <strong class="text-green">+$${act.earned.toFixed(3)}</strong>`;
                    listaRecientes.appendChild(li);
                });
            } else {
                listaRecientes.innerHTML = `<li><span><i class="fa-solid fa-clock text-muted"></i> Esperando actividad...</span></li>`;
            }
        }

        const listaPagos = document.getElementById('listaHistorialPagos');
        if (listaPagos) {
            listaPagos.innerHTML = '';
            if (data.payoutHistory && data.payoutHistory.length > 0) {
                data.payoutHistory.forEach(pago => {
                    const timeObj = new Date(pago.date);
                    const fechaStr = timeObj.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
                    const li = document.createElement('li');
                    li.innerHTML = `<span><i class="fa-solid fa-check-double text-green"></i> Ciclo cerrado <span style="font-size:10px; color:var(--text-muted);">(${fechaStr})</span></span> <strong class="text-green">$${(pago.amount || pago.amountPaid || 0).toFixed(2)}</strong>`;
                    listaPagos.appendChild(li);
                });
            } else {
                listaPagos.innerHTML = `<li><span class="text-muted"><i class="fa-solid fa-box-open"></i> Aún no hay liquidaciones registradas.</span></li>`;
            }
        }
    }

    function renderAdminDashboard(data) {
        let contenedor = document.getElementById('adminPanelContainer');
        if (!contenedor) {
            contenedor = document.createElement('div');
            contenedor.id = 'adminPanelContainer';
            contenedor.className = 'admin-grid-layout';
            const mainContent = document.querySelector('.main-content') || document.body;
            mainContent.innerHTML = ''; 
            mainContent.appendChild(contenedor);
        }
        
        contenedor.innerHTML = '<h2>Panel de Control CEO</h2>';
        
        data.users.forEach(user => {
            const userCard = document.createElement('div');
            userCard.className = 'admin-user-card';
            userCard.innerHTML = `
                <div style="padding: 15px; border: 1px solid #333; border-radius: 8px; margin-bottom: 15px; background: #1a1a1a;">
                    <h3>Uploader: ${user.name || user.uid}</h3>
                    <p>Pendiente de Pago (Mes Actual): <strong class="text-green">$${(user.finances.monthEarned || 0).toFixed(2)}</strong></p>
                    <p>Ganado Mes Pasado: <strong>$${(user.finances.lastMonthEarned || 0).toFixed(2)}</strong></p>
                    <p>Total Histórico: <strong>$${(user.finances.totalGeneradoGlobal || 0).toFixed(2)}</strong></p>
                    <div style="margin-top: 10px; display: flex; gap: 10px;">
                        <input type="number" id="payInput_${user.uid}" style="padding: 8px; border-radius: 4px; background: #222; color: #fff; border: 1px solid #444;" value="${(user.finances.monthEarned || 0).toFixed(2)}">
                        <button onclick="liberarPago('${user.uid}')" style="padding: 8px 15px; background: #007bff; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Aprobar y Reiniciar</button>
                    </div>
                </div>
            `;
            contenedor.appendChild(userCard);
        });
    }

    window.liberarPago = async function(uid) {
        const input = document.getElementById(`payInput_${uid}`);
        const monto = parseFloat(input.value);

        if (isNaN(monto) || monto <= 0) return;

        try {
            const res = await fetch('/api/pay-uploader', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: uid, amountPaid: monto })
            });
            const result = await res.json();
            
            if (result.success) {
                input.value = '0.00';
            }
        } catch (e) {}
    };
});
