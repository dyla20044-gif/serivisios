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

    // ==========================================
    // CONFIGURACIÓN DE USUARIOS (AVATARES Y NOMBRES)
    // ==========================================
    const ADMIN_2_ID = "00000000"; // <--- Pega aquí el ID de Telegram del Admin 2
    const ADMIN_2_PHOTO = "https://iili.io/CTsdfdN.jpg"; // <--- URL de la foto del Admin 2
    const ADMIN_2_NAME = "Nadia"; // Nombre a mostrar

    const ADMIN_1_ID = "11111111"; // <--- Pega aquí tu ID de Telegram (Dylan)
    const ADMIN_1_PHOTO = "https://tu-imagen-aqui.jpg"; // <--- Tu foto de perfil
    const ADMIN_1_NAME = "Dylan (CEO)";
    
    // ==========================================
    // LÓGICA DE BOTONES DE RETIRO Y ADELANTO
    // ==========================================
    const btnConfirmarAdelanto = document.getElementById('btnConfirmarAdelanto');
    if (btnConfirmarAdelanto) {
        btnConfirmarAdelanto.addEventListener('click', () => {
            // Te redirige a tu usuario de Telegram
            window.location.href = 'https://t.me/Dylan_1m_oficial'; 
        });
    }

    const btnSolicitarRetiro = document.getElementById('btnSolicitarRetiro');
    if (btnSolicitarRetiro) {
        btnSolicitarRetiro.addEventListener('click', () => {
            alert("Al solicitar el retiro completo, el dinero llegará directamente a su cuenta bancaria. Los cortes y pagos automáticos se realizan el 21 de cada mes.");
        });
    }

    // ==========================================
    // LÓGICA DE CONEXIÓN AL SERVIDOR
    // ==========================================
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

    const options = { day: 'numeric', month: 'short' };
    document.getElementById('fechaActual').innerText = new Date().toLocaleDateString('es-ES', options);

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
        
        // Configurar Nombre y Foto de Perfil basado en el ID
        const userInitialSpan = document.getElementById('userInitial');
        const userAvatarImg = document.getElementById('userAvatarImg');
        const userNameDisplay = document.getElementById('userNameDisplay');

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
        } else {
            userInitialSpan.innerText = uid.toString().charAt(0) || 'U';
            userNameDisplay.innerText = "Uploader";
        }

        const fetchStats = async () => {
            try {
                const res = await fetch(`/api/uploader-stats/${uid}`);
                const data = await res.json();
                
                if (data.success) {
                    const f = data.finances;
                    updateVal('valHoy', f.todayEarned);
                    updateVal('valTotal', f.totalGeneradoGlobal);
                    
                    updateVal('valSinRetirar', f.monthEarned);
                    updateVal('valRetirable', f.monthEarned); 
                    updateVal('valRetirableGrande', f.monthEarned);
                    updateVal('valBonos', f.bonos);

                    document.getElementById('montoMaxAdelanto').innerText = `$${(f.monthEarned * 0.5).toFixed(2)}`;
                    document.getElementById('valPelisSubidas').innerText = f.moviesSubidas;
                    document.getElementById('valSeriesSubidas').innerText = f.episodiosSubidos;

                    // LÓGICA DE FLECHA DE RENDIMIENTO (Sube / Baja comparado con ayer)
                    const trendIcon = document.getElementById('trendIcon');
                    const trendText = document.getElementById('trendText');
                    const ayer = f.yesterdayEarned || 0.01; // Fallback si ayer hizo 0
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
        setInterval(fetchStats, 5000); 
    }
});
