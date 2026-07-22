document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('legalModal');
    const dashboard = document.getElementById('mainDashboard');
    const acceptBtn = document.getElementById('acceptBtn');

    // Quitar modal al aceptar
    acceptBtn.addEventListener('click', () => {
        modal.style.opacity = '0';
        setTimeout(() => {
            modal.style.display = 'none';
            dashboard.classList.remove('blur-background');
            iniciarSimulador();
        }, 400);
    });

    // Referencias a los IDs donde inyectaremos los números
    const elHoy = document.getElementById('valHoy');
    const elMes = document.getElementById('valMes');
    const elTotal = document.getElementById('valTotal');

    // Valores iniciales exactos pasados por el usuario
    let gananciasHoy = 1.00;
    let gananciasMes = 11.00;
    let gananciasTotal = 237.18;

    // Función para animar cambio de valor sin recargar
    function updateValueHTML(element, value) {
        element.innerText = `USD${value.toFixed(2)}`;
        element.classList.remove('flash-update');
        // Pequeño hack para reiniciar la animación CSS
        void element.offsetWidth;
        element.classList.add('flash-update');
    }

    // Simulador de ingresos en tiempo real (Vistas entrando)
    function iniciarSimulador() {
        setInterval(() => {
            // Simulamos que entra una pequeña ganancia por vista (ej: $0.01 a $0.05)
            const gananciaAleatoria = (Math.random() * 0.04 + 0.01);
            
            gananciasHoy += gananciaAleatoria;
            gananciasMes += gananciaAleatoria;
            gananciasTotal += gananciaAleatoria;

            // Actualizamos el DOM
            updateValueHTML(elHoy, gananciasHoy);
            updateValueHTML(elMes, gananciasMes);
            updateValueHTML(elTotal, gananciasTotal);

        }, 4500); // Se actualiza cada 4.5 segundos para dar efecto de "Tiempo Real"
    }
});
