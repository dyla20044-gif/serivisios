document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('legalModal');
    const dashboard = document.getElementById('mainDashboard');
    const acceptBtn = document.getElementById('acceptBtn');

    // 1. CAPTURAR EL ID DEL USUARIO DESDE LA URL DE TELEGRAM
    const urlParams = new URLSearchParams(window.location.search);
    const uploaderId = urlParams.get('uid');

    // Quitar modal al aceptar
    acceptBtn.addEventListener('click', () => {
        modal.style.opacity = '0';
        setTimeout(() => {
            modal.style.display = 'none';
            dashboard.classList.remove('blur-background');
            
            // Validar que el usuario sí entró desde el bot
            if (uploaderId) {
                iniciarActualizacionReal(uploaderId);
            } else {
                alert("⚠️ Error: No se encontró tu ID de usuario. Por favor, abre este panel directamente desde el menú del bot de Telegram.");
            }
        }, 400);
    });

    // Referencias a los IDs en el HTML donde inyectaremos los números
    const elHoy = document.getElementById('valHoy');
    const elMes = document.getElementById('valMes');
    const elTotal = document.getElementById('valTotal');

    // Variables locales para evitar animar si el número no ha cambiado
    let currentHoy = -1;
    let currentMes = -1;
    let currentTotal = -1;

    // Función para animar cambio de valor visualmente (Flasheo verde)
    function updateValueHTML(element, newValue, oldValue) {
        if (newValue !== oldValue) {
            element.innerText = `USD${newValue.toFixed(2)}`;
            element.classList.remove('flash-update');
            // Hack para reiniciar la animación CSS
            void element.offsetWidth;
            element.classList.add('flash-update');
        }
    }

    // 2. FUNCIÓN PARA LLAMAR AL SERVIDOR REAL (routes_stats.js)
    async function obtenerFinanzasReales(uid) {
        try {
            const respuesta = await fetch(`/api/uploader-stats/${uid}`);
            const data = await respuesta.json();

            if (data.success) {
                // Actualizar los valores en pantalla con lo que manda la base de datos
                updateValueHTML(elHoy, data.finances.todayEarned, currentHoy);
                updateValueHTML(elMes, data.finances.monthEarned, currentMes);
                updateValueHTML(elTotal, data.finances.totalGeneradoGlobal, currentTotal);

                // Guardar el estado actual
                currentHoy = data.finances.todayEarned;
                currentMes = data.finances.monthEarned;
                currentTotal = data.finances.totalGeneradoGlobal;
            }
        } catch (error) {
            console.error("Error conectando con el servidor de finanzas:", error);
        }
    }

    // 3. INICIAR EL BUCLE EN TIEMPO REAL (Llama al backend cada 5 segundos)
    function iniciarActualizacionReal(uid) {
        // Primera llamada inmediata apenas cierra el modal
        obtenerFinanzasReales(uid);

        // Llamadas repetitivas cada 5 segundos para mantener el "Tiempo Real"
        setInterval(() => {
            obtenerFinanzasReales(uid);
        }, 5000); 
    }
});
