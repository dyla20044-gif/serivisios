const express = require('express');
const bodyParser = require('body-parser');
const paypal = require('paypal-rest-sdk');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const axios = require('axios');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer'); 
const moment = require('moment'); 

const app = express();

dotenv.config();

const PORT = process.env.PORT || 3000;

// === CONFIGURACIONES ===

// FIX CRÍTICO PARA RENDER y uso de la variable existente FIREBASE_ADMIN_SDK
const serviceKey = process.env.FIREBASE_ADMIN_SDK;

if (serviceKey && serviceKey !== 'undefined') {
    try {
        const serviceAccount = JSON.parse(serviceKey);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin SDK inicializado correctamente.");
    } catch (error) {
        console.error("ERROR CRÍTICO: Error al inicializar Firebase Admin. La variable FIREBASE_ADMIN_SDK puede ser JSON inválido.", error.message);
        process.exit(1);
    }
} else {
    console.error("ERROR CRÍTICO: La variable de entorno FIREBASE_ADMIN_SDK no está definida. Terminando la aplicación.");
    console.error("Instrucción: Por favor, establece FIREBASE_ADMIN_SDK en Render con el JSON de la clave de servicio de Firebase.");
    process.exit(1);
}

const db = admin.firestore();

paypal.configure({
    'mode': 'live',
    'client_id': process.env.PAYPAL_CLIENT_ID,
    'client_secret': process.env.PAYPAL_CLIENT_SECRET
});

const token = process.env.TELEGRAM_BOT_TOKEN;

// === SOLUCIÓN 1: CAMBIO DE POLLING A WEBHOOK PARA TELEGRAM ===
const RENDER_BACKEND_URL = 'https://serivisios.onrender.com';
const bot = new TelegramBot(token);
const webhookUrl = `${RENDER_BACKEND_URL}/bot${token}`;
bot.setWebHook(webhookUrl);

const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT_ID, 10);
const TMDB_API_KEY = process.env.TMDB_API_KEY;

// === CONFIGURACIÓN DE NODEMAILER (PARA BREVO/SMTP) ===
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false, // O true si usas 465, depende de tu SMTP_PORT
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// === CONFIGURACIÓN DE ATJOS DEL BOT ===
bot.setMyCommands([
    { command: 'start', description: 'Reiniciar el bot y ver el menú principal' },
    { command: 'subir', description: 'Subir una película o serie a la base de datos' },
    { command: 'editar', description: 'Editar los enlaces de una película o serie existente' },
    { command: 'pedidos', description: 'Ver la lista de películas solicitadas por los usuarios' }
]);

const adminState = {};

// === MIDDLEWARE ===
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// === RUTAS DEL SERVIDOR WEB ===
app.get('/', (req, res) => {
  res.send('¡El bot y el servidor de Sala Cine están activos!');
});

// === NUEVO ENDPOINT PARA RECIBIR ACTUALIZACIONES DEL WEBHOOK DE TELEGRAM ===
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// RUTA MODIFICADA: /request-movie (PRIORIZACIÓN)
app.post('/request-movie', async (req, res) => {
    // Captura username y userStatus del frontend
    const { title, poster_path, tmdbId, username, userStatus } = req.body;
    
    if (!title || !username || !userStatus) {
        return res.status(400).json({ success: false, error: 'Faltan datos requeridos (title, username, userStatus).' });
    }
    
    const posterUrl = poster_path ? `https://image.tmdb.org/t/p/w500${poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
    
    // Genera el mensaje con prioridad
    const statusIcon = userStatus.includes('PREMIUM') ? '👑' : userStatus.includes('PRUEBA') ? '⏱️' : '🆓';
    const statusText = `*Prioridad:* ${userStatus} ${statusIcon}`;

    const message = `🔔 *SOLICITUD DE PELÍCULA*\n
------------------------------
*Título:* ${title}
*ID TMDB:* ${tmdbId}
*Solicitante:* ${username}
${statusText} 🚨`; 
    
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
        res.status(200).json({ success: true, message: 'Solicitud enviada al administrador.' });
    } catch (error) {
        console.error("Error al enviar notificación a Telegram:", error);
        res.status(500).json({ success: false, error: 'Error al enviar la notificación al bot.' });
    }
});

// RUTA MODIFICADA: /api/signup-and-verify (REGISTRO SIMPLE - ACCESO INMEDIATO)
app.post('/api/signup-and-verify', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        // 1. Crear usuario en Firebase sin verificación forzada
        const userRecord = await admin.auth().createUser({ email, password });
        
        // 2. Guardar estado inicial en Firestore
        await db.collection('users').doc(userRecord.uid).set({
            email: email,
            isVerified: false, // Ahora es solo un marcador.
            isVerifiedByCode: false, // Nueva bandera para el Trial
            isTrial: false,
            isPro: false,
            trialEndDate: null,
            hasUsername: false,
            username: null 
        });

        res.status(200).json({ success: true, message: 'Cuenta creada con éxito. Requiere verificación para funciones premium.' });
    } catch (error) {
        console.error("Error en /api/signup-and-verify:", error.message);
        let errorMessage = 'Error al crear la cuenta. Intenta con otro correo o revisa la contraseña.';
        if (error.code === 'auth/email-already-in-use') {
             errorMessage = 'Esta dirección de correo ya está registrada.';
        }
        res.status(500).json({ success: false, error: errorMessage });
    }
});

// RUTA NUEVA: /api/send-otp-email (ENVÍO DE CÓDIGO OTP)
app.post('/api/send-otp-email', async (req, res) => {
    const { email } = req.body;
    
    try {
        const user = await admin.auth().getUserByEmail(email);
        
        // 1. Generar Código OTP de 6 dígitos
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expirationTime = moment().add(10, 'minutes').toDate(); // Código válido por 10 minutos
        
        // 2. Almacenar el código y expiración en Firestore (colección temporal)
        await db.collection('verification_codes').doc(user.uid).set({
            code: otpCode,
            email: email,
            expiration: admin.firestore.Timestamp.fromDate(expirationTime),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 3. Enviar el correo con Nodemailer/Brevo
        const mailOptions = {
            from: `"Cine Activación" <${process.env.SMTP_USER}>`, 
            to: email,
            subject: 'Tu Código de Verificación para el Trial',
            html: `
                <p>Hola,</p>
                <p>Tu código de verificación para activar la prueba gratuita es:</p>
                <h1 style="color: #e50914; font-size: 30px;">${otpCode}</h1>
                <p>Este código expira en 10 minutos.</p>
            `
        };
        await transporter.sendMail(mailOptions);

        res.status(200).json({ success: true, message: 'Código de verificación enviado.' });
    } catch (error) {
        console.error("Error en /api/send-otp-email:", error.message);
        let errorMessage = "Error al enviar el código. Intenta de nuevo más tarde.";
        if (error.message.includes('TOO_MANY_ATTEMPTS')) {
            errorMessage = "Has excedido el límite de seguridad de verificación. Intenta de nuevo en 30 minutos.";
        }
        res.status(500).json({ success: false, error: errorMessage });
    }
});

// RUTA NUEVA: /api/verify-otp (VERIFICACIÓN DEL CÓDIGO OTP)
app.post('/api/verify-otp', async (req, res) => {
    const { userId, code } = req.body;

    try {
        const docRef = db.collection('verification_codes').doc(userId);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            return res.status(400).json({ success: false, error: "No se encontró ningún código. Solicita uno nuevo." });
        }

        const data = docSnap.data();
        const currentTime = moment();

        if (data.code !== code) {
            return res.status(400).json({ success: false, error: "Código incorrecto." });
        }
        
        if (moment(data.expiration.toDate()).isBefore(currentTime)) {
            // Eliminar código expirado y pedir uno nuevo
            await docRef.delete(); 
            return res.status(400).json({ success: false, error: "El código ha expirado. Solicita un nuevo código." });
        }

        // Éxito: Eliminar el código y marcar al usuario como verificado por código
        await docRef.delete(); 
        await db.collection('users').doc(userId).update({
            isVerifiedByCode: true // Nueva bandera para el Trial
        });

        res.status(200).json({ success: true, message: "Verificación exitosa. Puedes activar tu Trial." });

    } catch (error) {
        console.error("Error en /api/verify-otp:", error.message);
        res.status(500).json({ success: false, error: "Error interno durante la verificación." });
    }
});

// RUTA OBSOLETA ELIMINADA: /api/confirm-email (Eliminada)

// RUTA MODIFICADA: /activate-trial (CHEQUEA LA NUEVA BANDERA isVerifiedByCode)
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
        
        // ✅ Bloqueo de Trial por la nueva bandera de código
        if (!userData.isVerifiedByCode) {
            return res.status(403).json({ success: false, error: 'Debes verificar el código de tu correo para activar la prueba gratuita.' });
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

// RUTA NUEVA: /update-username (GUARDAR NOMBRE DE USUARIO - PASO 4)
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

app.get('/api/get-embed-code', async (req, res) => {
  const { id, season, episode, isPro } = req.query;
  
  if (!id) {
    return res.status(400).json({ error: "ID de la película o serie no proporcionado" });
  }

  try {
    const mediaType = season && episode ? 'series' : 'movies';
    const docRef = db.collection(mediaType).doc(id);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: `${mediaType} no encontrada` });
    }

    const data = doc.data();

    if (mediaType === 'movies') {
        const embedCode = isPro === 'true' ? data.proEmbedCode : data.freeEmbedCode;
        if (embedCode) {
            res.json({ embedCode });
        } else {
            res.status(404).json({ error: `No se encontró código de reproductor para esta película.` });
        }
    } else { // series
        const episodeData = data.seasons?.[season]?.episodes?.[episode];
        const embedCode = isPro === 'true' ? episodeData?.proEmbedCode : episodeData?.freeEmbedCode;
        if (embedCode) {
            res.json({ embedCode });
        } else {
            res.status(404).json({ error: `No se encontró código de reproductor para el episodio ${episode}.` });
        }
    }
  } catch (error) {
    console.error("Error al obtener el código embed:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});


app.post('/add-movie', async (req, res) => {
    try {
        const { tmdbId, title, poster_path, freeEmbedCode, proEmbedCode, isPremium } = req.body;
        
        // Verificar si la película ya existe
        const movieRef = db.collection('movies').doc(tmdbId.toString());
        const movieDoc = await movieRef.get();

        let movieDataToSave = {};

        if (movieDoc.exists) {
            const existingData = movieDoc.data();
            // Lógica para no sobreescribir si el código es nulo
            movieDataToSave = {
                ...existingData,
                title: title,
                poster_path: poster_path,
                freeEmbedCode: freeEmbedCode !== undefined ? freeEmbedCode : existingData.freeEmbedCode,
                proEmbedCode: proEmbedCode !== undefined ? proEmbedCode : existingData.proEmbedCode,
                // Si se envía como GRATIS, se sobreescribe isPremium a false. Si se envía como PRO, se sobreescribe a true.
                isPremium: isPremium
            };
        } else {
            // Si la película no existe, la creamos
            movieDataToSave = {
                tmdbId,
                title,
                poster_path,
                freeEmbedCode, 
                proEmbedCode,
                isPremium
            };
        }
        await movieRef.set(movieDataToSave);
        res.status(200).json({ message: 'Película agregada/actualizada en la base de datos.' });

    } catch (error) {
        console.error("Error al agregar/actualizar película en Firestore:", error);
        res.status(500).json({ error: 'Error al agregar/actualizar la película en la base de datos.' });
    }
});

app.post('/add-series-episode', async (req, res) => {
    try {
        const { tmdbId, title, poster_path, seasonNumber, episodeNumber, freeEmbedCode, proEmbedCode, isPremium } = req.body;

        const seriesRef = db.collection('series').doc(tmdbId.toString());
        const seriesDoc = await seriesRef.get();

        let seriesDataToSave = {};

        if (seriesDoc.exists) {
            const existingData = seriesDoc.data();
            const existingEpisode = existingData.seasons?.[seasonNumber]?.episodes?.[episodeNumber] || {};
            
            const newEpisodeData = {
                freeEmbedCode: freeEmbedCode !== undefined ? freeEmbedCode : existingEpisode.freeEmbedCode,
                proEmbedCode: proEmbedCode !== undefined ? proEmbedCode : existingEpisode.proEmbedCode
            };
            
            seriesDataToSave = {
                ...existingData,
                title: title,
                poster_path: poster_path,
                isPremium: isPremium,
                seasons: {
                    ...existingData.seasons,
                    [seasonNumber]: {
                        episodes: {
                            ...(existingData.seasons?.[seasonNumber]?.episodes),
                            [episodeNumber]: newEpisodeData
                        }
                    }
                }
            };
        } else {
            seriesDataToSave = {
                tmdbId,
                title,
                poster_path,
                isPremium,
                seasons: {
                    [seasonNumber]: {
                        episodes: {
                            [episodeNumber]: { freeEmbedCode, proEmbedCode }
                        }
                    }
                }
            };
        }
        await seriesRef.set(seriesDataToSave);
        res.status(200).json({ message: `Episodio ${episodeNumber} de la temporada ${seasonNumber} agregado/actualizado en la base de datos.` });
    } catch (error) {
        console.error("Error al agregar/actualizar episodio de serie en Firestore:", error);
        res.status(500).json({ error: 'Error al agregar/actualizar el episodio de la serie en la base de datos.' });
    }
});

app.post('/create-paypal-payment', (req, res) => {
    const plan = req.body.plan;
    const amount = (plan === 'annual') ? '19.99' : '1.99';

    const create_payment_json = {
        "intent": "sale",
        "payer": {
            "payment_method": "paypal"
        },
        "redirect_urls": {
            "return_url": `${RENDER_BACKEND_URL}/paypal/success`,
            "cancel_url": `${RENDER_BACKEND_URL}/paypal/cancel`
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

app.get('/paypal/success', (req, res) => {
    res.send('<html><body><h1>Pago con PayPal exitoso. Vuelve a tu aplicación para ver los cambios.</h1></body></html>');
});

app.get('/paypal/cancel', (req, res) => {
    res.send('<html><body><h1>Pago con PayPal cancelado.</h1></body></html>');
});

app.post('/create-binance-payment', (req, res) => {
    res.json({ message: 'Pago con Binance simulado. Lógica de backend real necesaria.' });
});

// === LÓGICA DEL BOT DE TELEGRAM ===
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_CHAT_ID) {
        bot.sendMessage(chatId, 'Lo siento, no tienes permiso para usar este bot.');
        return;
    }
    adminState[chatId] = { step: 'menu' };
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Agregar películas', callback_data: 'add_movie' }],
                [{ text: 'Agregar series', callback_data: 'add_series' }],
                [{ text: 'Carrusel', callback_data: 'carousel' }],
                [{ text: 'Gestionar películas', callback_data: 'manage_movies' }],
                [{ text: 'Eliminar película', callback_data: 'delete_movie' }]
            ]
        }
    };
    bot.sendMessage(chatId, '¡Hola! ¿Qué quieres hacer hoy?', options);
});

bot.onText(/\/subir/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_CHAT_ID) return;
    adminState[chatId] = { step: 'menu' };
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Agregar películas', callback_data: 'add_movie' }],
                [{ text: 'Agregar series', callback_data: 'add_series' }],
                [{ text: 'Carrusel', callback_data: 'carousel' }],
                [{ text: 'Gestionar películas', callback_data: 'manage_movies' }],
                [{ text: 'Eliminar película', callback_data: 'delete_movie' }]
            ]
        }
    };
    bot.sendMessage(chatId, '¡Hola! ¿Qué quieres hacer hoy?', options);
});

bot.onText(/\/editar/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_CHAT_ID) return;
    adminState[chatId] = { step: 'search_edit', mediaType: 'movie' };
    bot.sendMessage(chatId, 'Por favor, escribe el nombre de la película o serie que quieres editar.');
});

bot.onText(/\/pedidos/, async (msg) => {
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_CHAT_ID) return;
    try {
        const requestsRef = db.collection('requests');
        const snapshot = await requestsRef.get();
        if (snapshot.empty) {
            return bot.sendMessage(chatId, 'No hay solicitudes pendientes en este momento.');
        }
        let message = '📋 *Solicitudes de Películas:*\n\n';
        snapshot.forEach(doc => {
            const data = doc.data();
            message += `🎬 ${data.movieTitle}\n_Solicitado por: ${data.userName || 'Anónimo'} el ${data.requestedAt.toDate().toLocaleDateString()}_\n\n`;
        });
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error("Error fetching requests:", error);
        bot.sendMessage(chatId, 'Hubo un error al obtener las solicitudes.');
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userText = msg.text;
    if (chatId !== ADMIN_CHAT_ID || userText.startsWith('/')) {
        return;
    }

    if (adminState[chatId] && adminState[chatId].step === 'search_movie') {
        try {
            const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(userText)}&language=es-ES`;
            const response = await axios.get(searchUrl);
            const data = response.data;
            if (data.results && data.results.length > 0) {
                const results = data.results.slice(0, 5);
                
                for (const item of results) {
                    const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                    const title = item.title || item.name;
                    const date = item.release_date || item.first_air_date;
                    const message = `🎬 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${item.overview || 'Sin sinopsis disponible.'}`;
                    
                    const docRef = db.collection('movies').doc(item.id.toString());
                    const doc = await docRef.get();
                    const existingData = doc.exists ? doc.data() : null;
                    
                    let buttons = [];
                    if (existingData) {
                        buttons.push([{ text: '✅ Gestionar', callback_data: `manage_movie_${item.id}` }]);
                    } else {
                         buttons.push([{ text: '✅ Agregar', callback_data: `add_new_movie_${item.id}` }]);
                    }
                    
                    const options = {
                        caption: message,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: buttons }
                    };
                    bot.sendPhoto(chatId, posterUrl, options);
                }
            } else {
                bot.sendMessage(chatId, `No se encontraron resultados para tu búsqueda. Intenta de nuevo.`);
            }
        } catch (error) {
            console.error("Error al buscar en TMDB:", error);
            bot.sendMessage(chatId, 'Hubo un error al buscar el contenido. Intenta de nuevo.');
        }
    } else if (adminState[chatId] && adminState[chatId].step === 'search_series') {
        try {
            const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(userText)}&language=es-ES`;
            const response = await axios.get(searchUrl);
            const data = response.data;
            if (data.results && data.results.length > 0) {
                const results = data.results.slice(0, 5);
                
                for (const item of results) {
                    const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                    const title = item.title || item.name;
                    const date = item.first_air_date;
                    const message = `🎬 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${item.overview || 'Sin sinopsis disponible.'}`;
                    
                    const docRef = db.collection('series').doc(item.id.toString());
                    const doc = await docRef.get();
                    const existingData = doc.exists ? doc.data() : null;

                    let buttons = [];
                    if (existingData) {
                        buttons.push([{ text: '✅ Gestionar', callback_data: `manage_series_${item.id}` }]);
                    } else {
                        buttons.push([{ text: '✅ Agregar', callback_data: `add_new_series_${item.id}` }]);
                    }

                    const options = {
                        caption: message,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: buttons }
                    };
                    bot.sendPhoto(chatId, posterUrl, options);
                }
            } else {
                bot.sendMessage(chatId, `No se encontraron resultados para tu búsqueda. Intenta de nuevo.`);
            }
        } catch (error) {
            console.error("Error al buscar en TMDB:", error);
            bot.sendMessage(chatId, 'Hubo un error al buscar el contenido. Intenta de nuevo.');
        }
    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_pro_link_movie') {
        const { selectedMedia } = adminState[chatId];
        adminState[chatId].proEmbedCode = userText;
        adminState[chatId].step = 'awaiting_free_link_movie';
        bot.sendMessage(chatId, `¡Reproductor PRO recibido! Ahora, envía el reproductor GRATIS para "${selectedMedia.title}". Si no hay, escribe "no".`);
    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_free_link_movie') {
        const { selectedMedia, proEmbedCode } = adminState[chatId];
        const freeEmbedCode = userText !== 'no' ? userText : null;
        
        // Guardar los datos de la película en el estado para usarlos después
        adminState[chatId].movieDataToSave = {
            tmdbId: selectedMedia.id.toString(), 
            title: selectedMedia.title,
            overview: selectedMedia.overview,
            poster_path: selectedMedia.poster_path,
            proEmbedCode: proEmbedCode,
            freeEmbedCode: freeEmbedCode,
            isPremium: !!proEmbedCode && !freeEmbedCode
        };

        adminState[chatId].step = 'awaiting_publish_choice';
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💾 Guardar solo en la app', callback_data: `save_only_${selectedMedia.id}` }],
                    [{ text: '🚀 Guardar y publicar en el canal', callback_data: `save_and_publish_${selectedMedia.id}` }]
                ]
            }
        };
        bot.sendMessage(chatId, `¡Reproductor GRATIS recibido! ¿Qué quieres hacer ahora?`, options);
    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_pro_link_series') {
        // ✅ CORRECCIÓN CLAVE: Se añade una validación para asegurar que selectedSeries existe.
        if (!adminState[chatId].selectedSeries) {
            bot.sendMessage(chatId, 'Error: El estado de la serie se ha perdido. Por favor, reinicia el proceso.');
            adminState[chatId] = { step: 'menu' };
            return;
        }

        const { selectedSeries, season, episode } = adminState[chatId];
        adminState[chatId].proEmbedCode = userText;
        adminState[chatId].step = 'awaiting_free_link_series';
        bot.sendMessage(chatId, `¡Reproductor PRO recibido! Ahora, envía el reproductor GRATIS para el episodio ${episode} de la temporada ${season}. Si no hay, escribe "no".`);
    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_free_link_series') {
        if (!adminState[chatId].selectedSeries) {
            bot.sendMessage(chatId, 'Error: El estado de la serie se ha perdido. Por favor, reinicia el proceso.');
            adminState[chatId] = { step: 'menu' };
            return;
        }

        const { selectedSeries, season, episode, proEmbedCode } = adminState[chatId];
        const freeEmbedCode = userText !== 'no' ? userText : null;

        // Guardar los datos de la serie en el estado para usarlos después
        const tmdbIdToUse = selectedSeries.tmdbId || selectedSeries.id;
        adminState[chatId].seriesDataToSave = {
            tmdbId: tmdbIdToUse.toString(), 
            title: selectedSeries.title || selectedSeries.name,
            overview: selectedSeries.overview,
            poster_path: selectedSeries.poster_path,
            seasonNumber: season,
            episodeNumber: episode,
            proEmbedCode: proEmbedCode,
            freeEmbedCode: freeEmbedCode,
            isPremium: !!proEmbedCode && !freeEmbedCode
        };
        
        adminState[chatId].step = 'awaiting_publish_choice_series';
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💾 Guardar solo en la app', callback_data: `save_only_series_${tmdbIdToUse}` }],
                    [{ text: '🚀 Guardar y publicar en el canal', callback_data: `save_and_publish_series_${tmdbIdToUse}` }]
                ]
            }
        };
        bot.sendMessage(chatId, `¡Reproductor GRATIS recibido para el episodio ${episode} de la temporada ${season}! ¿Qué quieres hacer ahora?`, options);
    } else if (adminState[chatId] && adminState[chatId].step === 'search_delete') {
         try {
            const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(userText)}&language=es-ES`;
            const response = await axios.get(searchUrl);
            const data = response.data;
            if (data.results && data.results.length > 0) {
                const results = data.results.slice(0, 5).filter(m => m.media_type === 'movie' || m.media_type === 'tv');
                
                for (const item of results) {
                    const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                    const title = item.title || item.name;
                    const date = item.release_date || item.first_air_date;
                    const message = `🎬 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${item.overview || 'Sin sinopsis disponible.'}`;
                    const options = {
                        caption: message,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[{
                                text: '🗑️ Eliminar',
                                callback_data: `delete_select_${item.id}_${item.media_type}`
                            }]]
                        }
                    };
                    bot.sendPhoto(chatId, posterUrl, options);
                }
            } else {
                bot.sendMessage(chatId, `No se encontraron resultados para tu búsqueda. Intenta de nuevo.`);
            }
        } catch (error) {
            console.error("Error al buscar en TMDB:", error);
            bot.sendMessage(chatId, 'Hubo un error al buscar el contenido. Intenta de nuevo.');
        }
    }
});

bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_CHAT_ID) return;

    if (data === 'add_movie') {
        adminState[chatId] = { step: 'search_movie' };
        bot.sendMessage(chatId, 'Por favor, escribe el nombre de la película que quieres agregar.');
    } else if (data === 'add_series') {
        adminState[chatId] = { step: 'search_series' };
        bot.sendMessage(chatId, 'Por favor, escribe el nombre de la serie que quieres agregar.');
    } else if (data.startsWith('add_new_movie_')) {
        const tmdbId = data.replace('add_new_movie_', '');
        try {
            const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
            const response = await axios.get(tmdbUrl);
            const mediaData = response.data;
            adminState[chatId] = { selectedMedia: mediaData, mediaType: 'movie', step: 'awaiting_pro_link_movie' };
            bot.sendMessage(chatId, `Seleccionaste "${mediaData.title}". Envía el reproductor PRO. Si no hay, escribe "no".`);
        } catch (error) {
            console.error("Error al obtener datos de TMDB:", error);
            bot.sendMessage(chatId, 'Hubo un error al obtener la información. Por favor, intenta la búsqueda de nuevo.');
        }
    } else if (data.startsWith('add_new_series_')) {
        const tmdbId = data.replace('add_new_series_', '');
        try {
            const tmdbUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
            const response = await axios.get(tmdbUrl);
            const mediaData = response.data;
            adminState[chatId] = { selectedSeries: mediaData, mediaType: 'series', step: 'awaiting_season_selection' };
            
            const seasons = mediaData.seasons;
            if (seasons && seasons.length > 0) {
                const buttons = seasons.map(s => [{
                    text: `Temporada ${s.season_number}`,
                    callback_data: `select_season_${tmdbId}_${s.season_number}`
                }]);
                bot.sendMessage(chatId, `Seleccionaste "${mediaData.name}". Por favor, selecciona la temporada que quieres agregar:`, {
                    reply_markup: { inline_keyboard: buttons }
                });
            } else {
                bot.sendMessage(chatId, `No se encontraron temporadas para esta serie. Intenta con otra.`);
                adminState[chatId] = { step: 'menu' };
            }

        } catch (error) {
            console.error("Error al obtener datos de TMDB:", error);
            bot.sendMessage(chatId, 'Hubo un error al obtener la información. Por favor, intenta la búsqueda de nuevo.');
        }
    } else if (data.startsWith('manage_movie_')) {
        const tmdbId = data.replace('manage_movie_', '');
        const docRef = db.collection('movies').doc(tmdbId);
        const doc = await docRef.get();
        const existingData = doc.exists ? doc.data() : null;

        if (!existingData) {
            bot.sendMessage(chatId, 'Error: Película no encontrada en la base de datos.');
            return;
        }
        
        let buttons = [];
        if (!existingData.proEmbedCode) {
            buttons.push([{ text: 'Agregar PRO', callback_data: `add_pro_movie_${tmdbId}` }]);
        }
        if (!existingData.freeEmbedCode) {
            buttons.push([{ text: 'Agregar Gratis', callback_data: `add_free_movie_${tmdbId}` }]);
        }

        const options = {
            reply_markup: {
                inline_keyboard: buttons
            }
        };
        bot.sendMessage(chatId, `Gestionando "${existingData.title}". ¿Qué versión quieres agregar?`, options);
    } else if (data.startsWith('manage_series_')) {
        const tmdbId = data.replace('manage_series_', '');
        const seriesRef = db.collection('series').doc(tmdbId);
        const seriesDoc = await seriesRef.get();
        const seriesData = seriesDoc.exists ? seriesDoc.data() : null;
        
        if (!seriesData) {
            bot.sendMessage(chatId, 'Error: Serie no encontrada en la base de datos.');
            return;
        }

        let buttons = [];
        if (seriesData.seasons) {
            for (const seasonNumber in seriesData.seasons) {
                buttons.push([{
                    text: `Gestionar Temporada ${seasonNumber}`,
                    callback_data: `manage_season_${tmdbId}_${seasonNumber}`
                }]);
            }
        }
        
        buttons.push([{
            text: `Añadir nueva temporada`,
            callback_data: `add_new_season_${tmdbId}`
        }]);

        const options = {
            reply_markup: {
                inline_keyboard: buttons
            },
            parse_mode: 'Markdown'
        };
        bot.sendMessage(chatId, `Gestionando "${seriesData.title || seriesData.name}". Selecciona una temporada:`, options);

    } else if (data.startsWith('add_pro_movie_')) {
        const tmdbId = data.replace('add_pro_movie_', '');
        const docRef = db.collection('movies').doc(tmdbId);
        const doc = await docRef.get();
        const existingData = doc.data();
        adminState[chatId] = { selectedMedia: existingData, mediaType: 'movie', freeEmbedCode: existingData.freeEmbedCode };
        adminState[chatId].step = 'awaiting_pro_link_movie';
        bot.sendMessage(chatId, `Envía el reproductor PRO para "${existingData.title}".`);
    } else if (data.startsWith('add_free_movie_')) {
        const tmdbId = data.replace('add_free_movie_', '');
        const docRef = db.collection('movies').doc(tmdbId);
        const doc = await docRef.get();
        const existingData = doc.data();
        adminState[chatId] = { selectedMedia: existingData, mediaType: 'movie', proEmbedCode: existingData.proEmbedCode };
        adminState[chatId].step = 'awaiting_free_link_movie';
        bot.sendMessage(chatId, `Envía el reproductor GRATIS para "${existingData.title}".`);
    } else if (data.startsWith('add_episode_series_')) {
        const tmdbId = data.replace('add_episode_series_', '');
        const seriesRef = db.collection('series').doc(tmdbId);
        const seriesDoc = await seriesRef.get();
        const seriesData = seriesDoc.exists ? seriesDoc.data() : null;
        
        if (!seriesData) {
            bot.sendMessage(chatId, 'Error: Serie no encontrada en la base de datos.');
            return;
        }

        let lastEpisode = 0;
        if (seriesData.seasons && seriesData.seasons[1] && seriesData.seasons[1].episodes) {
            const episodes = seriesData.seasons[1].episodes;
            lastEpisode = Object.keys(episodes).length;
        }
        const nextEpisode = lastEpisode + 1;
        
        adminState[chatId] = { 
            step: 'awaiting_pro_link_series', 
            selectedSeries: seriesData, 
            season: 1, 
            episode: nextEpisode
        };
        bot.sendMessage(chatId, `Seleccionaste "${seriesData.title || seriesData.name}". Envía el reproductor PRO para el episodio ${nextEpisode} de la temporada 1. Si no hay, escribe "no".`);

    } else if (data.startsWith('add_next_episode_')) {
        // CORRECCIÓN: Arreglo del problema de "Serie no encontrada en la base de datos"
        const parts = data.split('_');
        const tmdbId = parts[3];
        const seasonNumber = parts[4];

        const seriesRef = db.collection('series').doc(tmdbId);
        const seriesDoc = await seriesRef.get();
        const seriesData = seriesDoc.exists ? seriesDoc.data() : null;

        if (!seriesData) {
            bot.sendMessage(chatId, 'Error: Serie no encontrada en la base de datos.');
            return;
        }
        
        let lastEpisode = 0;
        if (seriesData.seasons && seriesData.seasons[seasonNumber] && seriesData.seasons[seasonNumber].episodes) {
            const episodes = seriesData.seasons[seasonNumber].episodes;
            lastEpisode = Object.keys(episodes).length;
        }
        const nextEpisode = lastEpisode + 1;

        // Se añade el tmdbId a la data de la serie para ser consistente.
        seriesData.tmdbId = tmdbId;

        adminState[chatId] = {
            step: 'awaiting_pro_link_series',
            selectedSeries: seriesData,
            season: parseInt(seasonNumber),
            episode: nextEpisode
        };
        bot.sendMessage(chatId, `Genial. Ahora, envía el reproductor PRO para el episodio ${nextEpisode} de la temporada ${seasonNumber}. Si no hay, escribe "no".`);

    } else if (data.startsWith('add_new_season_')) {
        // CORRECCIÓN: Lógica para el botón "Añadir nueva temporada"
        const tmdbId = data.replace('add_new_season_', '');
        try {
            const tmdbUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
            const response = await axios.get(tmdbUrl);
            const tmdbSeries = response.data;

            const seriesRef = db.collection('series').doc(tmdbId);
            const seriesDoc = await seriesRef.get();
            const existingSeasons = seriesDoc.exists && seriesDoc.data().seasons ? Object.keys(seriesDoc.data().seasons) : [];

            const availableSeasons = tmdbSeries.seasons.filter(s => !existingSeasons.includes(s.season_number.toString()));

            if (availableSeasons.length > 0) {
                const buttons = availableSeasons.map(s => [{
                    text: `Temporada ${s.season_number}`,
                    callback_data: `select_season_${tmdbId}_${s.season_number}`
                }]);
                bot.sendMessage(chatId, `Seleccionaste "${tmdbSeries.name}". ¿Qué temporada quieres agregar?`, {
                    reply_markup: { inline_keyboard: buttons }
                });
            } else {
                bot.sendMessage(chatId, 'Todas las temporadas de esta serie ya han sido agregadas.');
            }
        } catch (error) {
            console.error("Error al obtener datos de TMDB para nueva temporada:", error);
            bot.sendMessage(chatId, 'Hubo un error al obtener la información de las temporadas.');
        }

    } else if (data.startsWith('solicitud_')) {
        // CORRECCIÓN: Lógica para manejar el botón de solicitud de película
        const tmdbId = data.replace('solicitud_', '');
        try {
            const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
            const response = await axios.get(tmdbUrl);
            const mediaData = response.data;
            adminState[chatId] = { selectedMedia: mediaData, mediaType: 'movie', step: 'awaiting_pro_link_movie' };
            bot.sendMessage(chatId, `Seleccionaste "${mediaData.title}". Envía el reproductor PRO. Si no hay, escribe "no".`);

            // Eliminar la solicitud de la base de datos de pedidos
            const requestsRef = db.collection('requests');
            const snapshot = await requestsRef.where('tmdbId', '==', tmdbId).get();
            snapshot.forEach(doc => {
                doc.ref.delete();
            });
        } catch (error) {
            console.error("Error al obtener datos de TMDB para solicitud:", error);
            bot.sendMessage(chatId, 'Hubo un error al obtener la información de la película. Intenta de nuevo.');
        }

    } else if (data === 'manage_movies') {
        adminState[chatId] = { step: 'search_manage' };
        bot.sendMessage(chatId, 'Por favor, escribe el nombre de la película o serie que quieres gestionar.');
    } else if (data.startsWith('delete_select_')) {
        const [_, __, tmdbId, mediaType] = data.split('_');
        bot.sendMessage(chatId, `La lógica para eliminar el contenido ${tmdbId} (${mediaType}) está lista para ser implementada.`);
    } else if (data === 'delete_movie') {
        adminState[chatId] = { step: 'search_delete' };
        bot.sendMessage(chatId, 'Por favor, escribe el nombre de la película o serie que quieres eliminar.');
    } else if (data === 'no_action') {
        bot.sendMessage(chatId, 'No se requiere ninguna acción para este contenido.');
    } else if (data.startsWith('select_season_')) {
        const [_, __, tmdbId, seasonNumber] = data.split('_'); 
        try {
            const tmdbUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
            const response = await axios.get(tmdbUrl);
            const mediaData = response.data;
            
            // ✅ CORRECCIÓN CLAVE: Se añade la propiedad tmdbId a los datos del estado
            mediaData.tmdbId = mediaData.id.toString();
            
            adminState[chatId] = { 
                step: 'awaiting_pro_link_series', 
                selectedSeries: mediaData, 
                season: parseInt(seasonNumber), 
                episode: 1
            };
            bot.sendMessage(chatId, `Perfecto, Temporada ${seasonNumber} seleccionada. Ahora, envía el reproductor PRO para el episodio 1. Si no hay, escribe "no".`);
        } catch (error) {
            console.error("Error al seleccionar temporada:", error);
            bot.sendMessage(chatId, 'Hubo un error al obtener la información de la temporada. Por favor, intenta de nuevo.');
        }
    } else if (data.startsWith('manage_season_')) {
        const [_, __, tmdbId, seasonNumber] = data.split('_');
        
        const seriesRef = db.collection('series').doc(tmdbId);
        const seriesDoc = await seriesRef.get();
        const selectedSeries = seriesDoc.exists ? seriesDoc.data() : null;
        
        if (!selectedSeries) {
             bot.sendMessage(chatId, 'Error: Serie no encontrada en la base de datos.');
             return;
        }

        let lastEpisode = 0;
        if (selectedSeries.seasons && selectedSeries.seasons[seasonNumber] && selectedSeries.seasons[seasonNumber].episodes) {
            lastEpisode = Object.keys(selectedSeries.seasons[seasonNumber].episodes).length;
        }
        const nextEpisode = lastEpisode + 1;

        adminState[chatId] = {
            step: 'awaiting_pro_link_series',
            selectedSeries: selectedSeries, 
            season: parseInt(seasonNumber),
            episode: nextEpisode
        };
        bot.sendMessage(chatId, `Gestionando Temporada ${seasonNumber}. Envía el reproductor PRO para el episodio ${nextEpisode}. Si no hay, escribe "no".`);
    } else if (data.startsWith('save_only_')) {
        const { movieDataToSave } = adminState[chatId];
        try {
            await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
            bot.sendMessage(chatId, `✅ Película "${movieDataToSave.title}" guardada con éxito en la app.`);
        } catch (error) {
            console.error("Error al guardar la película:", error);
            bot.sendMessage(chatId, 'Hubo un error al guardar la película.');
        } finally {
            adminState[chatId] = { step: 'menu' };
        }
    } else if (data.startsWith('save_and_publish_')) {
        const { movieDataToSave } = adminState[chatId];
        try {
            await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
            bot.sendMessage(chatId, `✅ Película "${movieDataToSave.title}" guardada con éxito en la app. Ahora publicando en el canal...`);
            await publishMovieToChannel(movieDataToSave);
            bot.sendMessage(chatId, `🎉 ¡Película publicada en el canal con éxito!`);
        } catch (error) {
            console.error("Error al publicar la película en el canal:", error);
            bot.sendMessage(chatId, 'Hubo un error al publicar la película en el canal.');
        } finally {
            adminState[chatId] = { step: 'menu' };
        }
    } else if (data.startsWith('save_only_series_')) {
        const { seriesDataToSave } = adminState[chatId];
        try {
            await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, seriesDataToSave);
            bot.sendMessage(chatId, `✅ Episodio ${seriesDataToSave.episodeNumber} de la temporada ${seriesDataToSave.seasonNumber} guardado con éxito.`);
        } catch (error) {
            console.error("Error al guardar el episodio:", error);
            bot.sendMessage(chatId, 'Hubo un error al guardar el episodio.');
        } finally {
            adminState[chatId] = { step: 'menu' };
        }
    } else if (data.startsWith('save_and_publish_series_')) {
        const { seriesDataToSave } = adminState[chatId];
        try {
            await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, seriesDataToSave);
            bot.sendMessage(chatId, `✅ Episodio ${seriesDataToSave.episodeNumber} de la temporada ${seriesDataToSave.seasonNumber} guardado. Ahora publicando en el canal...`);
            await publishSeriesEpisodeToChannel(seriesDataToSave);
            bot.sendMessage(chatId, `🎉 ¡Episodio publicado en el canal con éxito!`);
        } catch (error) {
            console.error("Error al publicar el episodio en el canal:", error);
            bot.sendMessage(chatId, 'Hubo un error al publicar el episodio en el canal.');
        } finally {
            adminState[chatId] = { step: 'menu' };
        }
    }
});

// Función para publicar película en el canal
async function publishMovieToChannel(movieData) {
    const channelId = process.env.TELEGRAM_CHANNEL_ID;
    const miniAppUrl = process.env.TELEGRAM_MINIAPP_URL;

    const message = `🎬 *${movieData.title}*
    
    ${movieData.overview || 'Sinopsis no disponible.'}`;

    const options = {
        caption: message,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{
                    text: '▶️ Ver aquí',
                    url: `${miniAppUrl}?startapp=${movieData.tmdbId}`
                }]
            ]
        }
    };
    
    const posterUrl = movieData.poster_path ? `https://image.tmdb.org/t/p/w500${movieData.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';

    try {
        const sentMessage = await bot.sendPhoto(channelId, posterUrl, options);
        // Aquí debes guardar el message_id para la futura eliminación.
        // Por ejemplo, guardándolo en la base de datos junto con el timestamp.
        console.log(`Mensaje publicado en el canal con ID: ${sentMessage.message_id}`);
    } catch (error) {
        console.error("Error al enviar el mensaje al canal:", error);
    }
}

// Función para publicar episodio de serie en el canal
async function publishSeriesEpisodeToChannel(seriesData) {
    const channelId = process.env.TELEGRAM_CHANNEL_ID;
    const miniAppUrl = process.env.TELEGRAM_MINIAPP_URL;

    const message = `🎬 *${seriesData.title}*
    
    _Temporada ${seriesData.seasonNumber} - Episodio ${seriesData.episodeNumber}_
    
    ${seriesData.overview || 'Sinopsis no disponible.'}`;

    const options = {
        caption: message,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{
                    text: '▶️ Ver aquí',
                    url: `${miniAppUrl}?startapp=${seriesData.tmdbId}`
                }]
            ]
        }
    };
    
    const posterUrl = seriesData.poster_path ? `https://image.tmdb.org/t/p/w500${seriesData.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';

    try {
        const sentMessage = await bot.sendPhoto(channelId, posterUrl, options);
        console.log(`Mensaje publicado en el canal con ID: ${sentMessage.message_id}`);
    } catch (error) {
        console.error("Error al enviar el mensaje al canal:", error);
    }
}

app.listen(PORT, () => {
    console.log(`Servidor de backend de Sala Cine iniciado en el puerto ${PORT}`);
});
