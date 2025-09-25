const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const dotenv = require('dotenv');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const paypal = require('paypal-rest-sdk');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer'); // NUEVO
const moment = require('moment'); // NUEVO

const app = express();

dotenv.config();

// Configuración de Firebase Admin
// Asume que el archivo serviceAccountKey.json está configurado correctamente
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} catch (error) {
    console.error("Error al inicializar Firebase Admin:", error);
    process.exit(1);
}

const db = admin.firestore();

// Configuración de Telegram Bot
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const RENDER_BACKEND_URL = process.env.RENDER_BACKEND_URL;
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// Configuración de Nodemailer (para Brevo/SMTP)
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

// Ruta de pago de PayPal
app.post('/pay', (req, res) => {
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

// Ruta de éxito de pago de PayPal
app.get('/success', async (req, res) => {
    const { paymentId, PayerID, userId, plan } = req.query;
    const execute_payment_json = {
        "payer_id": PayerID,
        "transactions": [{
            "amount": {
                "currency": "USD",
                "total": plan === 'Basic' ? '5.00' : '10.00' // Ajustar según los planes
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
            hasFreeTrial: true, // Asumimos que si paga, ya no necesita la prueba
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

// Ruta de cancelación de PayPal
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

// Ruta de solicitud de película (Modificada para incluir el estado Premium)
app.post('/request-movie', async (req, res) => {
    const { title, poster_path, tmdbId, userId } = req.body;
    const posterUrl = poster_path ? `https://image.tmdb.org/t/p/w500${poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
    
    // OBTENER INFORMACIÓN ADICIONAL DEL USUARIO
    let userName = 'Usuario Anónimo';
    let status = 'GRATIS 🆓';
    
    if (userId) {
        const userDocSnap = await db.collection('users').doc(userId).get();
        if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            userName = userData.username || userData.email;
            
            // Lógica para determinar el estado Premium/Prueba
            const isTrialActive = userData.hasFreeTrial && userData.trialEndDate && moment(userData.trialEndDate.toDate()).isAfter(moment());
            
            if (userData.isPro || isTrialActive) {
                status = `PREMIUM 👑 (${isTrialActive ? 'Prueba Activa' : 'Pagado'})`;
            } else if (userData.hasFreeTrial) {
                status = 'GRATIS (Prueba Expirada)';
            }
        }
    }

    const message = `🔔 *Solicitud de película:* ${title}\n
    *Usuario:* ${userName}\n
    *Estado:* ${status}\n\nUn usuario ha solicitado esta película.`;
    
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

// RUTA 1: REGISTRO CON VERIFICACIÓN DE EMAIL
app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    try {
        const userRecord = await admin.auth().createUser({ email, password });
        
        // Generar enlace de verificación
        const emailVerificationLink = await admin.auth().generateEmailVerificationLink(email, { url: `${RENDER_BACKEND_URL}/api/confirm-email` });

        // Enviar el correo con Nodemailer/Brevo
        const mailOptions = {
            from: `"Cine Activación" <${process.env.EMAIL_SENDER}>`, // Nombre profesional: Cine Activación
            to: email,
            subject: '¡Bienvenido! Confirma tu cuenta de Ala Cine',
            html: `
                <!DOCTYPE html><html><head><style>
                    body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
                    .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); }
                    .header { background-color: #A31F37; padding: 20px; text-align: center; color: white; }
                    .header h1 { margin: 0; font-size: 24px; }
                    .content { padding: 30px; text-align: center; }
                    .button-container { margin-top: 30px; margin-bottom: 20px; }
                    .button {
                        background-color: #A31F37; color: white; padding: 12px 25px; text-decoration: none;
                        border-radius: 5px; font-weight: bold; display: inline-block;
                    }
                    .footer { background-color: #eeeeee; padding: 15px; text-align: center; font-size: 12px; color: #777777; }
                </style></head><body>
                    <div class="container"><div class="header"><h1>Ala Cine</h1></div>
                    <div class="content"><h2>¡Un paso más para disfrutar del cine!</h2>
                    <p>Gracias por registrarte. Para activar tu cuenta, haz clic en el botón:</p>
                    <div class="button-container">
                        <a href="${emailVerificationLink}" class="button">VERIFICAR MI CORREO</a>
                    </div>
                    <p style="margin-top: 40px;">El equipo de Ala Cine.</p></div>
                    <div class="footer">Este es un correo automático.</div></div>
                </body></html>
            `
        };
        await transporter.sendMail(mailOptions);
        
        // Guardar estado inicial en Firestore
        await db.collection('users').doc(userRecord.uid).set({
            email: email,
            isVerified: false,
            hasFreeTrial: false,
            isPro: false,
            trialEndDate: null,
            username: null // Campo para el nombre de usuario
        });

        res.status(200).json({ message: 'Usuario registrado. Revisa tu correo para verificar tu cuenta.' });
    } catch (error) {
        console.error("Error al registrar el usuario:", error);
        res.status(500).json({ error: 'Error al crear la cuenta. Intenta con otro correo o revisa la contraseña.' });
    }
});

// RUTA 2: VERIFICACIÓN DE EMAIL (Llamada desde el correo)
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
        
        res.send('<html><body><h1>✅ ¡Verificación exitosa! Tu cuenta está activada. Vuelve a la aplicación para iniciar sesión.</h1></body></html>');
    } catch (error) {
        console.error("Error al verificar el correo:", error);
        res.status(400).send('Error al verificar el correo. El enlace pudo haber expirado.');
    }
});

// RUTA 3: ACTIVAR PRUEBA GRATUITA
app.post('/activate-trial', async (req, res) => {
    const { userId } = req.body;
    try {
        const userRef = db.collection('users').doc(userId);
        const doc = await userRef.get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }
        const userData = doc.data();

        if (!userData.isVerified) {
            return res.status(403).json({ error: 'Debes verificar tu correo para activar la prueba gratuita.' });
        }
        if (userData.hasFreeTrial) {
            return res.status(403).json({ error: 'Ya has utilizado tu prueba gratuita. Por favor, compra un plan.' });
        }

        const trialEndDate = moment().add(2, 'days').toDate(); // 2 días de prueba
        await userRef.update({
            hasFreeTrial: true,
            isPro: true,
            trialEndDate: trialEndDate
        });

        res.status(200).json({ message: 'Prueba gratuita de 2 días activada con éxito.' });
    } catch (error) {
        console.error("Error al activar la prueba gratuita:", error);
        res.status(500).json({ error: 'Error al activar la prueba.' });
    }
});

// RUTA 4: GUARDAR NOMBRE DE USUARIO
app.post('/update-username', async (req, res) => {
    const { userId, username } = req.body;
    
    if (!username || username.length < 3) {
        return res.status(400).json({ error: 'El nombre de usuario debe tener al menos 3 caracteres.' });
    }

    try {
        // 1. Verificar duplicados
        const usersRef = db.collection('users');
        const q = usersRef.where('username', '==', username).limit(1);
        const snapshot = await q.get();

        if (!snapshot.empty) {
            return res.status(409).json({ error: 'Este nombre de usuario ya está en uso. Intenta con otro.' });
        }

        const userDocRef = usersRef.doc(userId);
        const userDoc = await userDocRef.get();
        
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }
        
        const userData = userDoc.data();
        
        // 2. Actualizar el documento de Firestore
        await userDocRef.update({
            username: username
        });

        const isTrialActive = userData.hasFreeTrial && userData.trialEndDate && moment(userData.trialEndDate.toDate()).isAfter(moment());
        const isProStatus = userData.isPro || isTrialActive;

        res.status(200).json({ 
            message: 'Nombre de usuario guardado.', 
            username: username,
            isPro: isProStatus
        });
    } catch (error) {
        console.error("Error al actualizar el nombre de usuario:", error);
        res.status(500).json({ error: 'Error interno al guardar el nombre de usuario.' });
    }
});


// COMANDOS DE BOT DE TELEGRAM (Manejo de callback_query)
bot.on('callback_query', async (callbackQuery) => {
    const action = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;

    if (action.startsWith('solicitud_')) {
        const tmdbId = action.split('_')[1];
        try {
            const movieDetails = await fetchMovieDetails(tmdbId);
            const movieRef = db.collection('movies').doc(tmdbId);
            await movieRef.set(movieDetails);
            
            bot.sendMessage(chatId, `¡Película agregada! ${movieDetails.title} ya está en la colección.`);
        } catch (error) {
            console.error("Error al agregar película:", error);
            bot.sendMessage(chatId, 'Hubo un error al agregar la película.');
        }
    }
});

// Función para obtener detalles de TMDB
async function fetchMovieDetails(tmdbId) {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es`;
    const response = await axios.get(url);
    const movie = response.data;
    
    // Simplificar el objeto
    return {
        id: movie.id.toString(),
        title: movie.title,
        overview: movie.overview,
        release_date: movie.release_date,
        poster_path: movie.poster_path,
        backdrop_path: movie.backdrop_path,
        vote_average: movie.vote_average,
        genres: movie.genres.map(g => g.name),
        runtime: movie.runtime,
        status: 'pending' // Estado inicial
    };
}


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor Node.js escuchando en el puerto ${PORT}`);
});
