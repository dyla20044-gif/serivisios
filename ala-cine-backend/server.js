const express = require('express');
const bodyParser = require('body-parser');
const paypal = require('paypal-rest-sdk');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const axios = require('axios');
const dotenv = require('dotenv');
// === NUEVO: Módulo 'url' para manipulación de URLs ===
const url = require('url'); 

const app = express();

dotenv.config();

const PORT = process.env.PORT || 3000;

// === CONFIGURACIONES ===
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SDK);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
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

// --------------------------------------------------------------------------
// === FUNCIÓN DE UTILIDAD: EXTRAE LA URL DE LA ETIQUETA IFRAME (¡CRÍTICO!) ===
// --------------------------------------------------------------------------
function extractUrlFromIframe(iframeString) {
    // Busca el valor del atributo SRC dentro de comillas simples o dobles
    const match = iframeString.match(/src=["'](.*?)["']/i);
    // Si encuentra la coincidencia, devuelve el primer grupo de captura (la URL)
    return match ? match[1] : null;
}

// --------------------------------------------------------------------------
// === ENDPONT MODIFICADO: PROXY INVERSO (CON EXTRACCIÓN Y BASE TAG) ===
// --------------------------------------------------------------------------

app.get('/api/get-embed-code', async (req, res) => {
  const { id, season, episode, isPro } = req.query;
  
  if (!id) {
    return res.status(400).send("ID no proporcionado");
  }

  let embedCodeFromDB;
  let finalUrlToProxy;

  try {
    const mediaType = season && episode ? 'series' : 'movies';
    const docRef = db.collection(mediaType).doc(id);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return res.status(404).send(`${mediaType} no encontrada`);
    }

    const data = doc.data();

    // 1. OBTENER EL CÓDIGO (IFRAME) DE GOAT STREAMING DESDE FIRESTORE
    if (mediaType === 'movies') {
        embedCodeFromDB = isPro === 'true' ? data.proEmbedCode : data.freeEmbedCode;
    } else { // series
        const episodeData = data.seasons?.[season]?.episodes?.[episode];
        embedCodeFromDB = isPro === 'true' ? episodeData?.proEmbedCode : episodeData?.freeEmbedCode;
    }

    if (!embedCodeFromDB) {
      return res.status(404).send("No se encontró código de reproductor.");
    }
    
    // 2. EXTRAER LA URL LIMPIA DEL IFRAME (¡SOLUCIÓN AL ERROR 'Invalid URL'!)
    finalUrlToProxy = extractUrlFromIframe(embedCodeFromDB);
    
    // Si la extracción falla o devuelve null, asumimos que la DB tiene la URL directa
    if (!finalUrlToProxy) {
        finalUrlToProxy = embedCodeFromDB;
    }

    // 3. EL SERVIDOR HACE LA PETICIÓN A GOAT STREAMING (PROXY)
    const goatStreamingResponse = await axios.get(finalUrlToProxy, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Referer': 'https://www.google.com/' 
        }
    });

    let proxiedHtml = goatStreamingResponse.data;
    
    // 4. INYECCIÓN DEL BASE TAG (¡SOLUCIÓN A LA FALTA DE COMANDOS DE PLAY!)
    const parsedUrl = url.parse(finalUrlToProxy);
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
    const baseTag = `<base href="${baseUrl}">`;

    if (proxiedHtml.includes('<head>')) {
        proxiedHtml = proxiedHtml.replace('<head>', `<head>${baseTag}`);
    } else if (proxiedHtml.includes('</head>')) {
         proxiedHtml = proxiedHtml.replace('</head>', `${baseTag}</head>`);
    } else {
         // Fallback si no hay etiquetas head (poco probable, pero seguro)
         proxiedHtml = baseTag + proxiedHtml;
    }


    // 5. DEVOLVER EL CONTENIDO HTML MANIPULADO
    res.send(proxiedHtml);

  } catch (error) {
    console.error("Error al obtener el código embed mediante proxy:", error.message);
    
    // >>>>>> REGISTRO CRÍTICO PARA DIAGNÓSTICO <<<<<<
    if (finalUrlToProxy) {
        console.error("URL de Goat Streaming fallida (proxy final):", finalUrlToProxy);
    }
    if (error.response) {
      console.error("Respuesta HTTP de Goat Streaming:", error.response.status);
      res.status(500).send(`Error interno del servidor al cargar el reproductor. HTTP Status: ${error.response.status}. Por favor, revisa los logs.`);
      return;
    }

    res.status(500).send("Error interno del servidor al cargar el reproductor.");
  }
});

// -----------------------------------------------------------
// === FIN DEL ENDPOINT DE PROXY INVERSO ===
// -----------------------------------------------------------


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
    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_event_image') { // NUEVO HANDLER: Evento - Recibe URL
        // Step 2: User sends the image URL
        // Simple validación de URL (puede ser una URL de imagen o un archivo subido, asumimos URL simple)
        if (!userText.startsWith('http')) {
            bot.sendMessage(chatId, '❌ Por favor, envía un ENLACE (URL) de imagen válido.');
            return;
        }
        adminState[chatId].imageUrl = userText;
        adminState[chatId].step = 'awaiting_event_description';
        bot.sendMessage(chatId, '¡Enlace de la fotografía recibido! Ahora, envía la DESCRIPCIÓN del evento.');

    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_event_description') { // NUEVO HANDLER: Evento - Recibe Descripción
        // Step 3: User sends the description and we save the event as a notification.
        const { imageUrl } = adminState[chatId];
        const description = userText;
        
        try {
            // Guardar el evento en la colección userNotifications (para que aparezca en la campana)
            await db.collection('userNotifications').add({
                title: '🎉 Nuevo Evento Publicado',
                description: description,
                image: imageUrl,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                isRead: false,
                type: 'event', 
                targetScreen: 'profile-screen' // Muestra el perfil donde debería estar el botón de Eventos.
            });

            bot.sendMessage(chatId, '✅ Evento guardado con éxito y listo para notificar a los usuarios de la aplicación.');

        } catch (error) {
            console.error("Error al guardar evento en Firestore:", error);
            bot.sendMessage(chatId, '❌ Hubo un error al guardar el evento. Revisa los logs de Firebase.');
        } finally {
            adminState[chatId] = { step: 'menu' };
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
    } else if (data === 'eventos') { // NUEVO HANDLER: Eventos
        adminState[chatId] = { step: 'awaiting_event_image' };
        bot.sendMessage(chatId, 'Perfecto, vamos a crear un evento. Primero, envía el ENLACE (URL) de la fotografía para el evento.');
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
            season: seasonNumber,
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
