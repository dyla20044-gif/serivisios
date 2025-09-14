const express = require('express');
const bodyParser = require('body-parser');
const paypal = require('paypal-rest-sdk');
const app = express();

const PORT = process.env.PORT || 3000;

// Configuración de PayPal con variables de entorno
paypal.configure({
    'mode': 'sandbox', // ¡Asegúrate de que esta línea diga 'live'!
    'client_id': process.env.PAYPAL_CLIENT_ID,
    'client_secret': process.env.PAYPAL_CLIENT_SECRET
});
// Configuración de Binance Pay con variables de entorno
// NOTA: La integración de Binance es más compleja y requiere una configuración de servidor más detallada.
// Esto es un placeholder para mostrar dónde iría la lógica.
const BINANCE_PAY_API_KEY = process.env.BINANCE_PAY_API_KEY;
const BINANCE_PAY_SECRET_KEY = process.env.BINANCE_PAY_SECRET_KEY;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Habilitar CORS para permitir que tu frontend se comunique con este servidor
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

// Ruta para procesar pagos con PayPal
app.post('/create-paypal-payment', (req, res) => {
    const plan = req.body.plan;
    const amount = (plan === 'annual') ? '19.99' : '1.99';

    const create_payment_json = {
        "intent": "sale",
        "payer": {
            "payment_method": "paypal"
        },
        "redirect_urls": {
            "return_url": "https://serivisios.onrender.com/paypal/success",
            "cancel_url": "https://serivisios.onrender.com/paypal/cancel"
        },
        "transactions": [{
            "amount": {
                "currency": "USD",
                "total": amount
            },
            "description": `Suscripción al plan ${plan} de Sala Cine`
        }]
    };

    paypal.payment.create(create_payment_json, function (error, payment) {
        if (error) {
            // Este console.error imprimirá la respuesta detallada de PayPal en tus logs de Render
            console.error("Error de PayPal:", error.response);
            res.status(500).json({ error: "Error al crear el pago con PayPal. Revisa los logs de tu servidor para más detalles." });
        } else {
            for (let i = 0; i < payment.links.length; i++) {
                if (payment.links[i].rel === 'approval_url') {
                    res.json({ approval_url: payment.links[i].href });
                    return;
                }
            }
            res.status(500).json({ error: "URL de aprobación de PayPal no encontrada." });
        }
    });
});

// Rutas de callback de PayPal
app.get('/paypal/success', (req, res) => {
    // Aquí puedes verificar la transacción y actualizar el estado de la cuenta del usuario
    res.send('<html><body><h1>Pago con PayPal exitoso. Vuelve a tu aplicación para ver los cambios.</h1></body></html>');
});

app.get('/paypal/cancel', (req, res) => {
    res.send('<html><body><h1>Pago con PayPal cancelado.</h1></body></html>');
});

// Ruta de ejemplo para pagos con Binance (simulada)
app.post('/create-binance-payment', (req, res) => {
    // En un entorno real, aquí iría la lógica para interactuar con la API de Binance Pay.
    // Simplemente enviamos una respuesta de éxito.
    res.json({ message: 'Pago con Binance simulado. Lógica de backend real necesaria.' });
});

// Inicia el servidor
app.listen(PORT, () => {
    console.log(`Servidor de backend de Sala Cine iniciado en el puerto ${PORT}`);
});
