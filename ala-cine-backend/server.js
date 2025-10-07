const express = require('express');
const bodyParser = require('body-parser');
const paypal = require('paypal-rest-sdk');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const axios = require('axios');
const dotenv = require('dotenv');

const app = express();

dotenv.config();

const PORT = process.env.PORT || 3000;

// === CONFIGURACIONES ===
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SDK);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
const messaging = admin.messaging(); // <--- CRÍTICO: Inicialización del servicio de mensajería

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

// -------------------------------------------------------------------------
// === RUTA CRÍTICA: MANEJO DE APP LINK Y REDIRECCIÓN DE FALLO ===
// -------------------------------------------------------------------------

/* Esta ruta se activa si el usuario toca el botón "Abrir en App Nativa" 
  y la aplicación de Android NO está instalada (App Link falla). 
  Redirige al usuario a la tienda personalizada.
*/
app.get('/app/details/:tmdbId', (req, res) => {
    const tmdbId = req.params.tmdbId;
    
    // Si la App Nativa falla, redirigimos a la URL de tu tienda personalizada
    if (process.env.APP_DOWNLOAD_URL) {
        console.log(`App Nativa no instalada. Redirigiendo a la Tienda Personalizada: ${process.env.APP_DOWNLOAD_URL}`);
        return res.redirect(302, process.env.APP_DOWNLOAD_URL);
    }

    // Último Fallback: Si no hay tienda definida, redirigimos a la TMA.
    if (process.env.TELEGRAM_MINIAPP_URL) {
        const tmaLink = process.env.TELEGRAM_MINIAPP_URL + '?startapp=' + tmdbId;
        console.log('APP_DOWNLOAD_URL no definida. Redirigiendo al fallback de la TMA.');
        return res.redirect(302, tmaLink);
    }

    // Fallo Total
    res.status(404).send('No se encontró la aplicación de destino ni un enlace de descarga.');
});


app.post('/request-movie', async (req, res) => {
    const movieTitle = req.body.title;
    const posterPath = req.body.poster_path;
    const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : 'https://placehold.co/500x750?text=No+Poster';
    
    const tmdbId = req.body.tmdbId;

    const message = `🔔 *Solicitud de película:* ${movieTitle}\n\nUn usuario ha solicitado esta película.`;
    
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

// -----------------------------------------------------------
// === ENDPOINT DE VIDEO ===
// -----------------------------------------------------------

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
        
        // Verificar si el tmdbId es válido antes de intentar guardar
        if (!tmdbId) {
            console.error("Error: Intentando guardar película sin tmdbId.");
            return res.status(400).json({ error: 'tmdbId es requerido para guardar la película.' });
        }

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
                // Si se envía como GRATIS, se sobreescribe isPremium a false. Si se envía como PRO, se sobreesscribe a true.
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

// === MODIFICADO: Envía el userId a PayPal ===
app.post('/create-paypal-payment', (req, res) => {
    const plan = req.body.plan;
    const amount = (plan === 'annual') ? '19.99' : '1.99';
    const userId = req.body.userId; // NUEVO: Capturamos el ID de Firebase

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
            "description": `Suscripción al plan ${plan} de Sala Cine`,
            "invoice_number": userId // NUEVO: Lo pasamos a PayPal para recuperarlo luego
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

// === CRÍTICO MODIFICADO: Ejecuta el pago y activa el Premium ===
app.get('/paypal/success', (req, res) => {
    const payerId = req.query.PayerID;
    const paymentId = req.query.paymentId;
    
    // 1. Ejecutar la transacción (Capturar el dinero)
    paypal.payment.execute(paymentId, { "payer_id": payerId }, async function (error, payment) {
        if (error) {
            console.error("Error al ejecutar el pago:", error.response);
            // Mensaje de error visible para el usuario
            return res.send('<html><body><h1>❌ ERROR: El pago no pudo ser procesado.</h1><p>Por favor, contacta con soporte con tu ID de transacción.</p></body></html>');
        }

        // 2. Verificar el estado y obtener el ID de usuario
        if (payment.state === 'approved' || payment.state === 'completed') {
            // El invoice_number contiene el ID de usuario de Firebase
            const userId = payment.transactions[0].invoice_number; 
            
            if (userId) {
                try {
                    // 3. Activar la cuenta Premium en Firebase
                    const userDocRef = db.collection('users').doc(userId);
                    // Usar set con merge: true para crear el documento si no existe, o actualizar si existe
                    await userDocRef.set({ isPro: true }, { merge: true });
                    
                    // Notificar al usuario que regrese a la app
                    res.send('<html><body><h1>✅ ¡Pago Exitoso! Cuenta Premium Activada.</h1><p>Vuelve a la aplicación para disfrutar de tu contenido PRO.</p></body></html>');
                } catch (dbError) {
                    console.error("Error al actualizar la base de datos de Firebase:", dbError);
                    // El pago se ejecutó, pero la base de datos falló (necesita revisión manual)
                    res.send('<html><body><h1>⚠️ Advertencia: Pago recibido, pero la cuenta Premium no se activó automáticamente.</h1><p>Por favor, contacta con soporte con el ID de transacción: ' + paymentId + '</p></body></html>');
                }
            } else {
                // El pago se ejecutó, pero el ID de usuario no fue guardado en la transacción
                 res.send('<html><body><h1>✅ ¡Pago Exitoso! Contacta a soporte para activar tu Premium</h1><p>Vuelve a la aplicación y contacta a soporte con tu ID de transacción: ' + paymentId + '</p></body></html>');
            }
        } else {
            // Estado no aprobado (puede ser "pendiente", "fallido", etc.)
            res.send('<html><body><h1>❌ ERROR: El pago no fue aprobado.</h1><p>Estado del pago: ' + payment.state + '</p></body></html>');
        }
    });
});

app.get('/paypal/cancel', (req, res) => {
    res.send('<html><body><h1>Pago con PayPal cancelado.</h1></body></html>');
});

app.post('/create-binance-payment', (req, res) => {
    res.json({ message: 'Pago con Binance simulado. Lógica de backend real necesaria.' });
});

// -----------------------------------------------------------
// === INICIO DE NUEVAS FUNCIONES Y ENDPOINT DE NOTIFICACIÓN PUSH ===
// -----------------------------------------------------------

// Función para buscar tokens y enviar notificación push con Firebase Cloud Messaging (FCM)
async function sendPushNotification(tmdbId, mediaType, contentTitle) {
    try {
        // Seleccionamos todos los usuarios que tienen un token FCM
        const tokensSnapshot = await db.collection('users').select('fcmToken').get();
        const registrationTokens = tokensSnapshot.docs
            .map(doc => doc.data().fcmToken)
            .filter(token => token); // Filtrar tokens nulos o vacíos

        if (registrationTokens.length === 0) {
            console.log("No se encontraron tokens FCM para enviar notificaciones.");
            return { success: true, message: "No hay tokens de dispositivos registrados." };
        }

        const message = {
            notification: {
                title: `🎉 ¡Nuevo Contenido Agregado!`,
                body: `¡Ya puedes ver ${contentTitle} en Sala Cine!`,
            },
            data: {
                // CRÍTICO: Enviamos el ID para que MyFirebaseMessagingService sepa dónde redirigir
                tmdbId: tmdbId.toString(), 
                mediaType: mediaType,
                action: 'open_content' 
            },
            tokens: registrationTokens // Envía a la lista de tokens
        };

        // Envía el mensaje a todos los tokens
        const response = await messaging.sendEachForMulticast(message);

        console.log('Notificación FCM enviada con éxito:', response.successCount);
        return { success: true, response: response };

    } catch (error) {
        console.error("Error al enviar notificación FCM:", error);
        return { success: false, error: error.message };
    }
}

// ENDPOINT DEDICADO: POST /api/notify
// Este es llamado por el bot de Telegram para enviar la notificación
app.post('/api/notify', async (req, res) => {
    const { tmdbId, mediaType, title } = req.body;
    
    if (!tmdbId || !mediaType || !title) {
        return res.status(400).json({ error: "Faltan parámetros: tmdbId, mediaType, o title." });
    }
    
    try {
        const result = await sendPushNotification(tmdbId, mediaType, title);
        
        if (result.success) {
            res.status(200).json({ message: 'Notificaciones push programadas para envío.', details: result.response });
        } else {
            res.status(500).json({ error: 'Error al enviar notificaciones push.', details: result.error });
        }
    } catch (error) {
        console.error("Error en el endpoint /api/notify:", error);
        res.status(500).json({ error: "Error interno del servidor al procesar la notificación." });
    }
});

// -----------------------------------------------------------
// === FIN DE NUEVAS FUNCIONES Y ENDPOINT DE NOTIFICACIÓN PUSH ===
// -----------------------------------------------------------


// -----------------------------------------------------------
// === INICIO DE FUNCIONES DE PUBLICACIÓN EN CANAL (CORREGIDAS Y MEJORADAS) ===
// -----------------------------------------------------------

// Función para publicar una nueva película en el canal de Telegram (CORREGIDA)
async function publishMovieToChannel(movieData) {
    // CRÍTICO: Asegúrate de que process.env.TELEGRAM_CHANNEL_ID contenga el ID de tu canal 
    // (ej. -1001234567890) y que el bot sea administrador con permisos de publicación.
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || ADMIN_CHAT_ID; 

    // Obtener la URL del póster (usando fallback si no hay)
    const posterUrl = movieData.poster_path ? `https://image.tmdb.org/t/p/w500${movieData.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
    
    // Contenido del mensaje para el canal
    const caption = `🎬 **${movieData.title}**\n\n` +
                    `${movieData.overview || 'Sin sinopsis disponible.'}\n\n` +
                    `⭐ ${movieData.isPremium ? 'Contenido PRO' : 'Contenido GRATIS/PRO'}`;

    // Enlaces dinámicos
    const tmaLink = process.env.TELEGRAM_MINIAPP_URL + '?startapp=' + movieData.tmdbId;
    // Esto resuelve en la ruta /app/details/:tmdbId que redirigirá a tu App Nativa o Tienda
    const appDeepLinkFallback = `${RENDER_BACKEND_URL}/app/details/${movieData.tmdbId}`;

    const options = {
        caption: caption,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                // Fila 1: Botón principal para la Mini App (web_app)
                [{ 
                    text: '▶️ Ver ahora en la App', 
                    web_app: { url: tmaLink } 
                }],
                // Fila 2: Botón de fallback para el App Link Nativo (url) - EN FILA SEPARADA
                [{ 
                    text: '📱 Abrir en Android', 
                    url: appDeepLinkFallback 
                }]
            ]
        }
    };

    // Publicar la película en el canal
    try {
        await bot.sendPhoto(CHANNEL_ID, posterUrl, options);
    } catch (error) {
        console.error('Error CRÍTICO al publicar la película en el canal:', error.message);
        // Notificar al administrador si la publicación falla
        bot.sendMessage(ADMIN_CHAT_ID, `⚠️ Error al publicar la película *${movieData.title}* en el canal. Revisa los logs. Posiblemente el bot no es admin del canal o el ID es incorrecto.`, { parse_mode: 'Markdown' });
    }
}

// Función para publicar un nuevo episodio en el canal de Telegram (CORREGIDA)
async function publishSeriesEpisodeToChannel(seriesData) {
    // CRÍTICO: Asegúrate de que process.env.TELEGRAM_CHANNEL_ID contenga el ID de tu canal 
    // (ej. -1001234567890) y que el bot sea administrador con permisos de publicación.
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || ADMIN_CHAT_ID; 

    // Obtener la URL del póster (usando fallback si no hay)
    const posterUrl = seriesData.poster_path ? `https://image.tmdb.org/t/p/w500${seriesData.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
    const contentTitle = seriesData.title + ` - T${seriesData.seasonNumber} E${seriesData.episodeNumber}`;
    
    // Contenido del mensaje para el canal
    const caption = `🆕 **¡Nuevo Episodio!**\n\n` +
                    `🎬 **${contentTitle}**\n\n` +
                    `📺 ${seriesData.overview || 'Sin sinopsis disponible.'}\n\n` +
                    `⭐ ${seriesData.isPremium ? 'Contenido PRO' : 'Contenido GRATIS/PRO'}`;

    // Enlaces dinámicos
    const tmaLink = process.env.TELEGRAM_MINIAPP_URL + '?startapp=' + seriesData.tmdbId;
    // Esto resuelve en la ruta /app/details/:tmdbId que redirigirá a tu App Nativa o Tienda
    const appDeepLinkFallback = `${RENDER_BACKEND_URL}/app/details/${seriesData.tmdbId}`;

    const options = {
        caption: caption,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                // Fila 1: Botón principal para la Mini App (web_app)
                [{ 
                    text: '▶️ Ver ahora en la App', 
                    web_app: { url: tmaLink } 
                }],
                // Fila 2: Botón de fallback para el App Link Nativo (url) - EN FILA SEPARADA
                [{ 
                    text: '📱 Abrir en Android', 
                    url: appDeepLinkFallback 
                }]
            ]
        }
    };

    // Publicar el episodio en el canal
    try {
        await bot.sendPhoto(CHANNEL_ID, posterUrl, options);
    } catch (error) {
        console.error('Error CRÍTICO al publicar el episodio en el canal:', error.message);
        // Notificar al administrador si la publicación falla
        bot.sendMessage(ADMIN_CHAT_ID, `⚠️ Error al publicar el episodio *${contentTitle}* en el canal. Revisa los logs. Posiblemente el bot no es admin del canal o el ID es incorrecto.`, { parse_mode: 'Markdown' });
    }
}

// -----------------------------------------------------------
// === FIN DE FUNCIONES DE PUBLICACIÓN EN CANAL (CORREGIDAS Y MEJORADAS) ===
// -----------------------------------------------------------


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
                [{ text: 'Eventos', callback_data: 'eventos' }], // MODIFICADO: Carrusel -> Eventos
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
                [{ text: 'Eventos', callback_data: 'eventos' }], // MODIFICADO: Carrusel -> Eventos
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
            message += `🎬 ${data.movieTitle}\n_Solicitado por...
