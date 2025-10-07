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
const messaging = admin.messaging(); // Inicialización del servicio de mensajería

paypal.configure({
    'mode': 'live',
    'client_id': process.env.PAYPAL_CLIENT_ID,
    'client_secret': process.env.PAYPAL_CLIENT_SECRET
});

const token = process.env.TELEGRAM_BOT_TOKEN;

// === SOLUCIÓN 1: CAMBIO DE POLLING A WEBHOOK PARA TELEGRAM ===
const RENDER_BACKEND_URL = process.env.RENDER_BACKEND_URL || 'https://serivisios.onrender.com';
const bot = new TelegramBot(token);
const webhookUrl = `${RENDER_BACKEND_URL}/bot${token}`;
bot.setWebHook(webhookUrl);

const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT_ID, 10);
// CRÍTICO PARA EL BUG DE PUBLICACIÓN: El ID del canal (ej: @mi_canal o -10012345678)
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID; 
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
 * y la aplicación de Android NO está instalada (App Link falla). 
 * Redirige al usuario a la tienda personalizada.
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
                res.send('<html><body><h1>⚠️ Advertencia: Pago recibido, pero el ID de usuario no pudo ser recuperado.</h1><p>Por favor, contacta con soporte con el ID de transacción: ' + paymentId + '</p></body></html>');
            }
        } else {
            // El pago no fue aprobado
            res.send('<html><body><h1>❌ Pago No Aprobado.</h1><p>Tu transacción no fue completada. Por favor, inténtalo de nuevo o contacta con soporte.</p></body></html>');
        }
    });
});

app.get('/paypal/cancel', (req, res) => {
    res.send('<html><body><h1>❌ Transacción Cancelada.</h1><p>Puedes volver a intentar el pago desde la aplicación.</p></body></html>');
});

// -----------------------------------------------------------
// === NUEVA LÓGICA DE NOTIFICACIONES PUSH CON PÓSTER ===
// -----------------------------------------------------------

/**
 * Función auxiliar para publicar contenido en el canal de Telegram.
 * (CRÍTICO: Incluye manejo de errores para el bug reportado)
 */
async function publishContentToTelegramChannel(contentData, type) {
    if (!CHANNEL_ID) {
        throw new Error("TELEGRAM_CHANNEL_ID no está definido. Por favor, revisa tus variables de entorno.");
    }

    const { tmdbId, title, poster_path, overview } = contentData;
    const isSeries = type === 'series';
    const contentTitle = isSeries ? `${title}` : `${title}`;
    const tmdbUrl = isSeries ? `https://www.themoviedb.org/tv/${tmdbId}` : `https://www.themoviedb.org/movie/${tmdbId}`;
    const posterUrl = poster_path ? `https://image.tmdb.org/t/p/w500${poster_path}` : 'https://placehold.co/500x750?text=No+Poster';

    const message = `🎬 **${contentTitle}**\n\n${overview || 'Descripción no disponible.'}\n\n[Ver Detalles en TMDB](${tmdbUrl})`;
    
    // Generar el link para abrir la aplicación (App Link)
    const appLinkUrl = `${RENDER_BACKEND_URL}/app/details/${tmdbId}`;
    
    const options = {
        caption: message,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '▶️ Abrir en Sala Cine App', url: appLinkUrl }
                ]
            ]
        }
    };
    
    // Usa sendPhoto, que es mejor para canales con imágenes.
    return bot.sendPhoto(CHANNEL_ID, posterUrl, options);
}


/**
 * Función para buscar tokens y enviar notificación push.
 * @param {string} tmdbId - ID de la película/serie.
 * @param {string} mediaType - 'movie' o 'series'.
 * @param {string} contentTitle - Título del contenido.
 * @param {string} posterPath - Path de la imagen (ej: /qNl4Jb4L4L4P4X0X0X0.jpg)
 */
async function sendPushNotification(tmdbId, mediaType, contentTitle, posterPath) { // <-- MODIFICADO
    try {
        const tokensSnapshot = await db.collection('users').select('fcmToken').get();
        const registrationTokens = tokensSnapshot.docs
            .map(doc => doc.data().fcmToken)
            .filter(token => token);

        if (registrationTokens.length === 0) {
            console.log("No se encontraron tokens FCM para enviar notificaciones.");
            return { success: true, message: "No hay tokens de dispositivos registrados." };
        }
        
        // 🚨 CRÍTICO: CREAMOS LA URL DE LA IMAGEN GRANDE PARA LA NOTIFICACIÓN 🚨
        const posterUrl = posterPath ? `https://image.tmdb.org/t/p/original${posterPath}` : null;
        
        const message = {
            notification: {
                title: `🎉 ¡Nuevo Contenido Agregado!`,
                body: `¡Ya puedes ver ${contentTitle} en Sala Cine!`,
                imageUrl: posterUrl, // FCM usa esta URL para mostrar la imagen grande (BigPictureStyle)
            },
            data: {
                tmdbId: tmdbId.toString(), 
                mediaType: mediaType,
                action: 'open_content' 
            },
            tokens: registrationTokens // Envía a la lista de tokens
        };

        const response = await messaging.sendEachForMulticast(message);

        console.log('Notificación FCM enviada con éxito:', response.successCount);
        return { success: true, response: response };

    } catch (error) {
        console.error("Error al enviar notificación FCM:", error);
        return { success: false, error: error.message };
    }
}

// ENDPOINT DEDICADO: POST /api/notify
// Llamado por el bot para enviar la notificación push
app.post('/api/notify', async (req, res) => {
    const { tmdbId, mediaType, title, poster_path } = req.body; // <-- MODIFICADO: Recibe poster_path
    
    if (!tmdbId || !mediaType || !title || !poster_path) {
        return res.status(400).json({ error: "Faltan parámetros: tmdbId, mediaType, title, o poster_path." });
    }
    
    try {
        const result = await sendPushNotification(tmdbId, mediaType, title, poster_path); // <-- MODIFICADO: Pasar poster_path
        
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
// === LÓGICA DEL BOT DE TELEGRAM ===
// -----------------------------------------------------------

// ... (El bot.on('message') handler iría aquí, asumiendo que ya lo tienes) ...

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    await bot.answerCallbackQuery(query.id);
    
    // Función para obtener datos de la TMDB (Necesaria para publicar en canal)
    async function getTmdbDetails(tmdbId, isSeries) {
        const url = `https://api.themoviedb.org/3/${isSeries ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
        const response = await axios.get(url);
        return response.data;
    }


    // === 1. MANEJO DE PUBLICACIÓN DE PELÍCULAS ===
    if (data.startsWith('save_only_') || data.startsWith('save_and_publish_')) {
        const tmdbId = data.split('_')[2];
        const state = adminState[chatId];
        
        if (!state || !state.poster_path || !state.overview) {
            return bot.sendMessage(chatId, 'Error: Faltan datos críticos (póster/descripción) en el estado. Por favor, empieza de nuevo con /subir.');
        }

        // Creamos la estructura de datos que se necesita para publicar y notificar
        const movieDataForPost = { 
            tmdbId: tmdbId, 
            title: state.title, 
            overview: state.overview, 
            poster_path: state.poster_path
        };
        
        // 🚨 FIX DEL BUG: PUBLICACIÓN A CANAL 🚨
        if (data.startsWith('save_and_publish_')) {
            try {
                await publishContentToTelegramChannel(movieDataForPost, 'movie'); // <-- Uso de la función auxiliar
                bot.sendMessage(chatId, `✅ Película publicada en el canal de Telegram.`);
            } catch (postError) {
                console.error(`Error al publicar película en el canal: ${postError.message}`);
                // Notificación clara al administrador sobre el fallo
                bot.sendMessage(chatId, `⚠️ La película fue guardada PERO hubo un error al publicar en el canal de Telegram. Causa más común: El Bot no es administrador o el CHANNEL_ID (${CHANNEL_ID}) es incorrecto. Error: ${postError.message}`);
            }
        }
        
        // FCM STATE UPDATE (Añadido poster_path para el siguiente paso)
        adminState[chatId] = { 
            step: 'awaiting_push_action', 
            tmdbId: tmdbId, 
            mediaType: 'movie', 
            title: movieDataForPost.title,
            poster_path: movieDataForPost.poster_path // <-- CRÍTICO: GUARDAR POSTER PATH
        };
        
        const pushOptions = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👍 Sí, enviar Push ahora', callback_data: `send_push_yes` }],
                    [{ text: 'Skip', callback_data: `send_push_no` }]
                ]
            }
        };
        bot.sendMessage(chatId, `¿Quieres notificar a los usuarios de la aplicación sobre esta película? (La imagen de la notificación será la portada)`, pushOptions);

    } 
    // === 2. MANEJO DE PUBLICACIÓN DE SERIES ===
    else if (data.startsWith('save_only_series_') || data.startsWith('save_and_publish_series_')) {
        const parts = data.split('_');
        const tmdbId = parts[3];
        const state = adminState[chatId];

        if (!state || !state.poster_path || !state.overview) {
            return bot.sendMessage(chatId, 'Error: Faltan datos críticos (póster/descripción) en el estado. Por favor, empieza de nuevo con /subir.');
        }

        // Creamos la estructura de datos que se necesita para publicar y notificar
        const seriesDataForPost = { 
            tmdbId: tmdbId, 
            title: state.title, 
            overview: state.overview, 
            poster_path: state.poster_path
        };
        
        // 🚨 FIX DEL BUG: PUBLICACIÓN A CANAL 🚨
        if (data.startsWith('save_and_publish_series_')) {
            try {
                await publishContentToTelegramChannel(seriesDataForPost, 'series'); // <-- Uso de la función auxiliar
                bot.sendMessage(chatId, `✅ Episodio/Serie publicada en el canal de Telegram.`);
            } catch (postError) {
                console.error(`Error al publicar serie/episodio en el canal: ${postError.message}`);
                 // Notificación clara al administrador sobre el fallo
                bot.sendMessage(chatId, `⚠️ El contenido de la serie fue guardado PERO hubo un error al publicar en el canal de Telegram. Causa más común: El Bot no es administrador o el CHANNEL_ID (${CHANNEL_ID}) es incorrecto. Error: ${postError.message}`);
            }
        }
        
        // FCM STATE UPDATE (Añadido poster_path para el siguiente paso)
        adminState[chatId] = { 
            step: 'awaiting_push_action', 
            tmdbId: tmdbId, 
            mediaType: 'series', 
            title: seriesDataForPost.title,
            poster_path: seriesDataForPost.poster_path // <-- CRÍTICO: GUARDAR POSTER PATH
        };
        
        const pushOptions = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👍 Sí, enviar Push ahora', callback_data: `send_push_yes` }],
                    [{ text: 'Skip', callback_data: `send_push_no` }]
                ]
            }
        };
        bot.sendMessage(chatId, `¿Quieres notificar a los usuarios de la aplicación sobre este nuevo episodio? (La imagen de la notificación será la portada)`, pushOptions);
    }
    
    // === 3. MANEJO DE ENVÍO DE NOTIFICACIÓN PUSH (CRÍTICO) ===
    else if (data.startsWith('send_push_')) {
        const action = data.split('_')[2]; // 'yes' o 'no'
        const state = adminState[chatId];

        if (!state || state.step !== 'awaiting_push_action') {
            return bot.sendMessage(chatId, 'Error de estado. Por favor, usa /subir para empezar de nuevo.');
        }

        if (action === 'yes') {
            const tmdbId = state.tmdbId;
            const mediaType = state.mediaType;
            const title = state.title;
            const posterPath = state.poster_path; // <-- CRÍTICO: OBTENER POSTER PATH

            if (!title || !posterPath) {
                 return bot.sendMessage(chatId, 'Error: Faltan datos para la notificación (título o póster).');
            }

            try {
                // Llama al nuevo endpoint para enviar la notificación push
                await axios.post(`${RENDER_BACKEND_URL}/api/notify`, {
                    tmdbId,
                    mediaType,
                    title,
                    poster_path: posterPath // <-- CRÍTICO: ENVIAR POSTER PATH
                });
                bot.sendMessage(chatId, '🚀 Notificación Push enviada a todos los dispositivos.');
            } catch (error) {
                console.error("Error al enviar notificación push desde el bot:", error);
                bot.sendMessage(chatId, `❌ Error al enviar Notificación Push. Revisa los logs. Error: ${error.message}`);
            }
        } else {
            bot.sendMessage(chatId, 'Notificación Push omitida. Volviendo al menú principal.');
        }

        adminState[chatId] = { step: 'menu' }; // Resetear estado al menú principal
    }

    // ... (El resto de tu lógica de bot on('callback_query') iría aquí) ...

});


// ... (El bot.on('message') handler iría aquí, asumiendo que ya lo tienes) ...


app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
