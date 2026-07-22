document.addEventListener('DOMContentLoaded', () => {
    // Modal Principal
    const modal = document.getElementById('legalModal');
    const mainApp = document.getElementById('mainApp');
    const acceptBtn = document.getElementById('acceptBtn');
    mainApp.style.filter = 'blur(8px)';

    // Navegación Inferior (Tabs)
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

    // Modales Secundarios
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

    // Validar Usuario y Conectar API
    const urlParams = new URLSearchParams(window.location.search);
    const uploaderId = urlParams.get('uid');

    acceptBtn.addEventListener('click', () => {
        modal.style.opacity = '0';
        setTimeout(() => {
            modal.style.display = 'none';
            mainApp.style.filter = 'none';
            if (uploaderId) {
                iniciarConexionServidor(uploaderId);
            } else {
                alert("⚠️ Error de seguridad: ID de Telegram no detectado. Abre esto desde el Bot oficial.");
            }
        }, 300);
    });

    // Setear Fecha Actual en UI
    const options = { day: 'numeric', month: 'short' };
    document.getElementById('fechaActual').innerText = new Date().toLocaleDateString('es-ES', options);

    // Funciones de Actualización de Interfaz
    function updateVal(id, value, prefix = "$") {
        const el = document.getElementById(id);
        const text = `${prefix}${value.toFixed(2)}`;
        if (el && el.innerText !== text) {
            el.innerText = text;
            el.classList.remove('flash-update');
            void el.offsetWidth;
            el.classList.add('flash-update');
        }
    }

    async function iniciarConexionServidor(uid) {
        document.getElementById('userIdDisplay').innerText = `ID: ${uid}`;
        // Extrae inicial para el Avatar (simulado por el número de ID)
        document.getElementById('userInitial').innerText = uid.toString().charAt(0) || 'U';

        const fetchStats = async () => {
            try {
                const res = await fetch(`/api/uploader-stats/${uid}`);
                const data = await res.json();
                
                if (data.success) {
                    const f = data.finances;
                    updateVal('valHoy', f.todayEarned);
                    updateVal('valTotal', f.totalGeneradoGlobal);
                    
                    // Cálculo de retirable y sin retirar (Lógica interna del Frontend)
                    // Para el diseño: "Sin retirar" es lo de este mes. "Retirable" es el saldo total histórico no pagado (simularemos que es lo mismo para el demo visual).
                    updateVal('valSinRetirar', f.monthEarned);
                    updateVal('valRetirable', f.monthEarned); // O la variable de la DB que uses para saldo vivo
                    updateVal('valRetirableGrande', f.monthEarned);
                    updateVal('valBonos', f.bonos);

                    // Límites de adelanto (Máx 50% de lo sin retirar)
                    document.getElementById('montoMaxAdelanto').innerText = `$${(f.monthEarned * 0.5).toFixed(2)}`;

                    document.getElementById('valPelisSubidas').innerText = f.moviesSubidas;
                    document.getElementById('valSeriesSubidas').innerText = f.episodiosSubidos;

                    // Llenar películas más pedidas
                    const listPedidas = document.getElementById('topPedidasList');
                    listPedidas.innerHTML = '';
                    if (data.topRequests && data.topRequests.length > 0) {
                        data.topRequests.forEach(req => {
                            listPedidas.innerHTML += `<li><span>🎬 ${req.title}</span> <span class="votos">${req.votes} votos</span></li>`;
                        });
                    } else {
                        listPedidas.innerHTML = '<li>No hay solicitudes pendientes.</li>';
                    }

                    // Historial simulado de actividad reciente para dar efecto vivo
                    if(f.todayEarned > 0) {
                        const listaRecientes = document.getElementById('listaGananciasRecientes');
                        const time = new Date().toLocaleTimeString('es-ES', {hour: '2-digit', minute:'2-digit', second:'2-digit'});
                        const li = document.createElement('li');
                        li.innerHTML = `<span><i class="fa-regular fa-clock"></i> Hoy ${time}</span> <strong class="text-green">+$${f.currentPayoutRate.toFixed(3)}</strong>`;
                        listaRecientes.prepend(li);
                        if(listaRecientes.children.length > 5) listaRecientes.lastChild.remove();
                    }
                }
            } catch (e) { console.error("Error fetching stats:", e); }
        };

        fetchStats();
        setInterval(fetchStats, 5000); // Llama al backend cada 5 segundos
    }
});
