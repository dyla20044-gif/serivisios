const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const dotenv = require('dotenv');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const paypal = require('paypal-rest-sdk');
const nodemailer = require('nodemailer'); 
const moment = require('moment'); 

const app = express();

dotenv.config();

// Configuración de Firebase Admin
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} catch (error) {
    console.error("Error al inicializar Firebase Admin:", error);
    // process.exit(1); // Descomentar para asegurar que el servidor no inicie sin credenciales
}

const db = admin.firestore();

// Configuración de Telegram Bot
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const RENDER_BACKEND_URL = process.env.RENDER_BACKEND_URL || 'http://localhost:3000';
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// Configuración de Nodemailer (para Brevo/SMTP - Remitente "Cine Activación")
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false, // Usamos 587 con STARTTLS (no seguro: true)
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});


// Configuración de PayPal
paypal.configure({
    mode: 'sandbox', // Cambiar a 'live' para producción
    client_id: process.env.PAYPAL_CLIENT_ID,
    client_secret: process.env.PAYPAL_CLIENT_SECRET
});

// Middlewares
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// Habilitar CORS para permitir solicitudes desde el frontend
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    next();
});

// === RUTAS DEL SERVIDOR WEB ===

// Ruta de inicio de Telegram Webhook
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});


// RUTA DE CREACIÓN DE PAGO (mantenida)
app.post('/create-paypal-payment', (req, res) => {
    const { amount, plan, userId } = req.body;
    const create_payment_json = {
        "intent": "sale",
        "payer": {
            "payment_method": "paypal"
        },
        "redirect_urls": {
            "return_url": `${RENDER_BACKEND_URL}/success?userId=${userId}&plan=${plan}`,
            "cancel_url": `${RENDER_BACKEND_URL}/cancel`
        },
        "transactions": [{
            "item_list": {
                "items": [{
                    "name": plan,
                    "sku": plan,
                    "price": amount,
                    "currency": "USD",
                    "quantity": "1"
                }]
            },
            "amount": {
                "currency": "USD",
                "total": amount
            },
            "description": `Pago de plan ${plan} para Ala Cine.`
        }]
    };

    paypal.payment.create(create_payment_json, function (error, payment) {
        if (error) {
            console.error("Error al crear pago de PayPal:", error);
            res.status(500).send("Error al procesar el pago.");
        } else {
            for (let i = 0; i < payment.links.length; i++) {
                if (payment.links[i].rel === 'approval_url') {
                    res.json({ approval_url: payment.links[i].href });
                    return;
                }
            }
        }
    });
});

// Ruta de éxito de pago de PayPal (mantenida)
app.get('/success', async (req, res) => {
    const { paymentId, PayerID, userId, plan } = req.query;
    const execute_payment_json = {
        "payer_id": PayerID,
        "transactions": [{
            "amount": {
                "currency": "USD",
                "total": plan === 'monthly' ? '1.99' : '19.99' // Usar montos correctos
            }
        }]
    };

    try {
        const payment = await new Promise((resolve, reject) => {
            paypal.payment.execute(paymentId, execute_payment_json, function (error, payment) {
                if (error) {
                    reject(error);
                } else {
                    resolve(payment);
                }
            });
        });

        // Actualizar estado en Firestore
        await db.collection('users').doc(userId).update({
            isPro: true,
            isTrial: false, 
            trialEndDate: null,
            plan: plan,
            lastPayment: admin.firestore.FieldValue.serverTimestamp()
        });

        const successMessage = `
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <title>Pago Exitoso</title>
                <style>body{font-family: Arial, sans-serif; text-align: center; padding: 50px;} h1{color: #4CAF50;} button{padding: 10px 20px; background-color: #A31F37; color: white; border: none; border-radius: 5px; cursor: pointer;}</style>
            </head>
            <body>
                <h1>✅ ¡Pago Exitoso!</h1>
                <p>Tu plan ${plan} ha sido activado. Puedes cerrar esta ventana y regresar a la aplicación.</p>
                <button onclick="window.close()">Volver a la App</button>
            </body>
            </html>
        `;
        res.send(successMessage);
    } catch (error) {
        console.error("Error al ejecutar o procesar PayPal:", error);
        res.status(500).send("Error al procesar la confirmación del pago.");
    }
});

// Ruta de cancelación de PayPal (mantenida)
app.get('/cancel', (req, res) => {
    const cancelMessage = `
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Pago Cancelado</title>
            <style>body{font-family: Arial, sans-serif; text-align: center; padding: 50px;} h1{color: #FF5733;} button{padding: 10px 20px; background-color: #A31F37; color: white; border: none; border-radius: 5px; cursor: pointer;}</style>
        </head>
        <body>
            <h1>❌ Pago Cancelado</h1>
            <p>La transacción ha sido cancelada. Puedes cerrar esta ventana y volver a la aplicación.</p>
            <button onclick="window.close()">Volver a la App</button>
        </body>
        </html>
    `;
    res.send(cancelMessage);
});

// RUTA MODIFICADA (Priorización de Pedidos)
app.post('/request-movie', async (req, res) => {
    // ✅ RECIBE username y userStatus directamente desde el frontend
    const { title, poster_path, tmdbId, userId, username, userStatus } = req.body;
    const posterUrl = poster_path ? `https://image.tmdb.org/t/p/w500${poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
    
    // Simplificación de estatus para Telegram
    const statusIcon = userStatus.includes('PREMIUM') ? '👑' : userStatus.includes('PRUEBA') ? '⏱️' : '🆓';
    const statusText = `*Prioridad:* ${userStatus} ${statusIcon}`;

    const message = `🔔 *SOLICITUD DE PELÍCULA*\n
------------------------------
*Título:* ${title}
*ID TMDB:* ${tmdbId}
*Solicitante:* ${username}
${statusText} 🚨`; // ✅ Mensaje con prioridad y username

    try {
        await bot.sendPhoto(ADMIN_CHAT_ID, posterUrl, {
            caption: message,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{
                    text: '✅ Agregar ahora',
                    callback_data: `solicitud_${tmdbId}`
                }]]
            }
        });
        res.status(200).json({ message: 'Solicitud enviada al administrador.' });
    } catch (error) {
        console.error("Error al enviar notificación a Telegram:", error);
        res.status(500).json({ error: 'Error al enviar la notificación al bot.' });
    }
});


// === NUEVAS RUTAS DE AUTENTICACIÓN Y PERFIL ===

// RUTA 1: REGISTRO CON VERIFICACIÓN DE EMAIL (Paso 1)
app.post('/api/signup-and-verify', async (req, res) => {
    const { email, password } = req.body;
    try {
        // 1. Crear usuario no verificado en Firebase
        const userRecord = await admin.auth().createUser({ email, password });
        
        // 2. Generar enlace de verificación (usa RENDER_BACKEND_URL como dominio de acción)
        const emailVerificationLink = await admin.auth().generateEmailVerificationLink(email, { url: `${RENDER_BACKEND_URL}/api/confirm-email` });

        // 3. Enviar el correo con Nodemailer/Brevo (configurado como "Cine Activación")
        const mailOptions = {
            from: `"Cine Activación" <${process.env.SMTP_USER}>`, 
            to: email,
            subject: '¡Activa tu Cuenta Cine!',
            html: `
                <!DOCTYPE html><html><head><style>
                    body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
                    .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); }
                    .header { background-color: #e50914; padding: 20px; text-align: center; color: white; }
                    .header h1 { margin: 0; font-size: 24px; }
                    .content { padding: 30px; text-align: center; }
                    .button-container { margin-top: 30px; margin-bottom: 20px; }
                    .button {
                        background-color: #e50914; color: white; padding: 12px 25px; text-decoration: none;
                        border-radius: 5px; font-weight: bold; display: inline-block;
                    }
                    .footer { background-color: #eeeeee; padding: 15px; text-align: center; font-size: 12px; color: #777777; }
                </style></head><body>
                    <div class="container"><div class="header"><h1>Cine</h1></div>
                    <div class="content"><h2>¡Un paso más para disfrutar del cine!</h2>
                    <p>Gracias por registrarte. Para activar tu cuenta, haz clic en el botón:</p>
                    <div class="button-container">
                        <a href="${emailVerificationLink}" class="button">VERIFICAR MI CORREO</a>
                    </div>
                    <p style="margin-top: 40px;">El equipo de Cine.</p></div>
                    <div class="footer">Este es un correo automático.</div></div>
                </body></html>
            `
        };
        await transporter.sendMail(mailOptions);
        
        // 4. Guardar estado inicial en Firestore (para username/pro)
        await db.collection('users').doc(userRecord.uid).set({
            email: email,
            isVerified: false,
            isTrial: false,
            isPro: false,
            trialEndDate: null,
            hasUsername: false,
            username: null 
        });

        res.status(200).json({ success: true, message: 'Usuario registrado. Revisa tu correo para verificar tu cuenta.' });
    } catch (error) {
        console.error("Error al registrar el usuario:", error);
        res.status(500).json({ success: false, error: 'Error al crear la cuenta. Intenta con otro correo o revisa la contraseña.' });
    }
});

// RUTA 2: VERIFICACIÓN DE EMAIL (Paso 3)
app.get('/api/confirm-email', async (req, res) => {
    const { oobCode } = req.query;
    if (!oobCode) {
        return res.status(400).send('Falta el token de verificación.');
    }

    try {
        const actionCodeInfo = await admin.auth().checkActionCode(oobCode);
        const email = actionCodeInfo.data.email;
        
        await admin.auth().applyActionCode(oobCode);
        
        const user = await admin.auth().getUserByEmail(email);
        await db.collection('users').doc(user.uid).update({
            isVerified: true
        });
        
        // Redirige al login de la app después de la verificación
        const successMessage = `
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <title>Verificación Exitosa</title>
                <style>body{font-family: Arial, sans-serif; text-align: center; padding: 50px;} h1{color: #4CAF50;} button{padding: 10px 20px; background-color: #A31F37; color: white; border: none; border-radius: 5px; cursor: pointer;}</style>
            </head>
            <body>
                <h1>✅ ¡Verificación Exitosa!</h1>
                <p>Tu cuenta está activada. Vuelve a la aplicación para iniciar sesión.</p>
                <button onclick="window.close()">Volver a la App</button>
            </body>
            </html>
        `;
        res.send(successMessage);

    } catch (error) {
        console.error("Error al verificar el correo:", error);
        res.status(400).send('Error al verificar el correo. El enlace pudo haber expirado.');
    }
});

// RUTA 3: ACTIVAR PRUEBA GRATUITA (Requisito)
app.post('/activate-trial', async (req, res) => {
    const { userId } = req.body;
    try {
        const userRef = db.collection('users').doc(userId);
        const doc = await userRef.get();
        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
        }
        const userData = doc.data();

        if (userData.isTrial) {
            return res.status(403).json({ success: false, error: 'Ya has utilizado tu prueba gratuita. Por favor, compra un plan.' });
        }
        if (!userData.isVerified) {
            return res.status(403).json({ success: false, error: 'Debes verificar tu correo para activar la prueba gratuita.' });
        }


        const trialEndDate = moment().add(2, 'days').toDate(); // 2 días de prueba
        await userRef.update({
            isTrial: true,
            isPro: false, // El frontend gestiona el acceso con isTrial
            trialEndDate: admin.firestore.Timestamp.fromDate(trialEndDate)
        });

        res.status(200).json({ success: true, message: 'Prueba gratuita de 2 días activada con éxito.' });
    } catch (error) {
        console.error("Error al activar la prueba gratuita:", error);
        res.status(500).json({ success: false, error: 'Error al activar la prueba.' });
    }
});

// RUTA 4: GUARDAR NOMBRE DE USUARIO (Paso 4)
app.post('/update-username', async (req, res) => {
    const { userId, username } = req.body;
    
    if (!username || username.length < 3) {
        return res.status(400).json({ success: false, error: 'El nombre de usuario debe tener al menos 3 caracteres.' });
    }

    try {
        // 1. Verificar duplicados (excluyendo el usuario actual)
        const usersRef = db.collection('users');
        const q = usersRef.where('username', '==', username).limit(1);
        const snapshot = await q.get();

        if (!snapshot.empty) {
             const existingUserId = snapshot.docs[0].id;
             if (existingUserId !== userId) {
                 return res.status(409).json({ success: false, error: 'Este nombre de usuario ya está en uso. Intenta con otro.' });
             }
        }

        const userDocRef = usersRef.doc(userId);
        
        // 2. Actualizar el documento de Firestore (username y hasUsername)
        await userDocRef.update({
            username: username,
            hasUsername: true
        });

        // 3. Actualizar Firebase Auth display name
        await admin.auth().updateUser(userId, { displayName: username });


        res.status(200).json({ success: true, message: 'Nombre de usuario guardado.' });
    } catch (error) {
        console.error("Error al actualizar el nombre de usuario:", error);
        res.status(500).json({ success: false, error: 'Error interno al guardar el nombre de usuario.' });
    }
});


// COMANDOS DE BOT DE TELEGRAM (Manejo de callback_query)
bot.on('callback_query', async (callbackQuery) => {
    const action = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;

    if (action.startsWith('solicitud_')) {
        const tmdbId = action.split('_')[1];
        try {
            bot.sendMessage(chatId, `Procesando solicitud para TMDB ID: ${tmdbId}`);
        } catch (error) {
            console.error("Error al agregar película:", error);
            bot.sendMessage(chatId, 'Hubo un error al agregar la película.');
        }
    }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor Node.js escuchando en el puerto ${PORT}`);
});
