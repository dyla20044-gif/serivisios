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
    
    // ✅ Corregido: Se usa el ID de la película para el callback_data.
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
// === INICIO DEL CÓDIGO MEJORADO PARA EL ENDPOINT DE VIDEO ===
// -----------------------------------------------------------

// ✅ Nuevo Endpoint para obtener el código embed
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


// -----------------------------------------------------------
// === FIN DEL CÓDIGO MEJORADO PARA EL ENDPOINT DE VIDEO ===
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
                adminState[chatId].results = results;
                
                // === REVERTIR AL FORMATO ORIGINAL DE RESULTADOS ===
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
                                text: '✅ Agregar',
                                callback_data: `add_movie_select_${item.id}`
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
    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_free_video_link') {
        adminState[chatId].freeEmbedCode = userText;
        adminState[chatId].step = 'awaiting_pro_video_link';
        bot.sendMessage(chatId, '¡Código gratis recibido! Ahora, por favor, envía el código HTML del reproductor PRO.');
    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_pro_video_link') {
        adminState[chatId].proEmbedCode = userText;
        adminState[chatId].step = 'awaiting_publication_option';
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Publicar solo en Gratis', callback_data: 'publish_free_only' }],
                    [{ text: 'Publicar solo en PRO', callback_data: 'publish_pro_only' }],
                    [{ text: 'Publicar en ambas versiones', callback_data: 'publish_both' }]
                ]
            }
        };
        bot.sendMessage(chatId, '¡Códigos recibidos! ¿Cómo quieres publicar la película?', options);
    } else if (adminState[chatId] && adminState[chatId].step === 'search_series') {
        try {
            const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(userText)}&language=es-ES`;
            const response = await axios.get(searchUrl);
            const data = response.data;
            if (data.results && data.results.length > 0) {
                const results = data.results.slice(0, 5);
                adminState[chatId].results = results;
                
                for (const item of results) {
                    const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                    const title = item.title || item.name;
                    const date = item.first_air_date;
                    const message = `🎬 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${item.overview || 'Sin sinopsis disponible.'}`;
                    const options = {
                        caption: message,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[{
                                text: '✅ Agregar',
                                callback_data: `add_series_select_${item.id}`
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
    } else if (adminState[chatId] && adminState[chatId].step === 'search_delete') {
         // Lógica para el botón 'Eliminar película'
        try {
            const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(userText)}&language=es-ES`;
            const response = await axios.get(searchUrl);
            const data = response.data;
            if (data.results && data.results.length > 0) {
                const results = data.results.slice(0, 5).filter(m => m.media_type === 'movie' || m.media_type === 'tv');
                adminState[chatId].results = results;
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
    } else if (data.startsWith('add_movie_select_')) {
        const tmdbId = data.replace('add_movie_select_', '');
        const movieData = adminState[chatId].results.find(m => m.id === parseInt(tmdbId, 10));
        adminState[chatId] = { step: 'awaiting_free_video_link', selectedMovie: movieData };
        bot.sendMessage(chatId, `Seleccionaste "${movieData.title}". Por favor, envía el código HTML del reproductor GRATIS.`);
    } else if (data === 'add_series') {
        adminState[chatId] = { step: 'search_series' };
        bot.sendMessage(chatId, 'Por favor, escribe el nombre de la serie que quieres agregar.');
    } else if (data.startsWith('add_series_select_')) {
        const tmdbId = data.replace('add_series_select_', '');
        const seriesData = adminState[chatId].results.find(m => m.id === parseInt(tmdbId, 10));
        adminState[chatId] = { step: 'add_episode', selectedSeries: seriesData, season: 1, episode: 1 };
        bot.sendMessage(chatId, `Seleccionaste "${seriesData.name}". Ahora, envía el código del reproductor GRATIS para el episodio 1 de la temporada 1.`);
    } else if (data === 'publish_free_only' || data === 'publish_pro_only' || data === 'publish_both') {
        const { selectedMovie, freeEmbedCode, proEmbedCode } = adminState[chatId];
        let isPremium;
        const body = {
            tmdbId: selectedMovie.id,
            title: selectedMovie.title,
            poster_path: selectedMovie.poster_path,
        };

        if (data === 'publish_pro_only') {
            isPremium = true;
            body.proEmbedCode = proEmbedCode;
        } else if (data === 'publish_free_only') {
            isPremium = false;
            body.freeEmbedCode = freeEmbedCode;
        } else { // publish_both
            isPremium = false;
            body.freeEmbedCode = freeEmbedCode;
            body.proEmbedCode = proEmbedCode;
        }
        
        // Asigna isPremium al final, después de toda la lógica
        body.isPremium = isPremium;

        try {
            const response = await axios.post(`${RENDER_BACKEND_URL}/add-movie`, body);
            
            if (response.status === 200) {
                bot.sendMessage(chatId, `¡La película "${selectedMovie.title}" ha sido publicada con éxito!`);
            } else {
                bot.sendMessage(chatId, `Hubo un error al publicar la película: ${response.data.error}`);
            }
        } catch (error) {
            console.error("Error al publicar la película:", error);
            bot.sendMessage(chatId, 'Hubo un error al publicar la película.');
        } finally {
            adminState[chatId] = { step: 'menu' };
        }
    } else if (data === 'manage_movies') {
        adminState[chatId] = { step: 'search_manage' };
        bot.sendMessage(chatId, 'Por favor, escribe el nombre de la película o serie que quieres gestionar.');
    } else if (data.startsWith('delete_select_')) {
        const [_, tmdbId, mediaType] = data.split('_');
        // Aquí iría la lógica para eliminar.
        bot.sendMessage(chatId, `La lógica para eliminar el contenido ${tmdbId} (${mediaType}) está lista para ser implementada.`);
    } else if (data === 'delete_movie') {
        adminState[chatId] = { step: 'search_delete' };
        bot.sendMessage(chatId, 'Por favor, escribe el nombre de la película o serie que quieres eliminar.');
    }
});


app.listen(PORT, () => {
    console.log(`Servidor de backend de Sala Cine iniciado en el puerto ${PORT}`);
});
