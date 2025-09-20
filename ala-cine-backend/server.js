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
        
        if (!isPremium && !freeEmbedCode) {
            return res.status(400).json({ error: 'Debes proporcionar el código de reproductor gratis para una película no premium.' });
        } else if (isPremium && !proEmbedCode) {
            return res.status(400).json({ error: 'Debes proporcionar el código de reproductor PRO para una película premium.' });
        }
        
        const movieRef = db.collection('movies').doc(tmdbId.toString());
        await movieRef.set({
            tmdbId,
            title,
            poster_path,
            freeEmbedCode, 
            proEmbedCode,
            isPremium
        }, { merge: true });
        res.status(200).json({ message: 'Película agregada a la base de datos.' });
    } catch (error) {
        console.error("Error al agregar película a Firestore:", error);
        res.status(500).json({ error: 'Error al agregar la película a la base de datos.' });
    }
});

app.post('/add-series-episode', async (req, res) => {
    try {
        const { tmdbId, title, poster_path, seasonNumber, episodeNumber, freeEmbedCode, proEmbedCode, isPremium } = req.body;

        if (!isPremium && !freeEmbedCode) {
            return res.status(400).json({ error: 'Debes proporcionar el código de reproductor gratis para una serie no premium.' });
        } else if (isPremium && !proEmbedCode) {
            return res.status(400).json({ error: 'Debes proporcionar el código de reproductor PRO para una serie premium.' });
        }

        const seriesRef = db.collection('series').doc(tmdbId.toString());
        await seriesRef.set({
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
        }, { merge: true });

        res.status(200).json({ message: `Episodio ${episodeNumber} de la temporada ${seasonNumber} agregado a la base de datos.` });
    } catch (error) {
        console.error("Error al agregar episodio de serie a Firestore:", error);
        res.status(500).json({ error: 'Error al agregar el episodio de la serie a la base de datos.' });
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
                [{ text: 'Subir película gratis', callback_data: 'subir_movie_gratis' }],
                [{ text: 'Subir película PRO', callback_data: 'subir_movie_pro' }],
                [{ text: 'Subir serie gratis', callback_data: 'subir_series_gratis' }],
                [{ text: 'Subir serie PRO', callback_data: 'subir_series_pro' }]
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
                [{ text: 'Subir película gratis', callback_data: 'subir_movie_gratis' }],
                [{ text: 'Subir película PRO', callback_data: 'subir_movie_pro' }],
                [{ text: 'Subir serie gratis', callback_data: 'subir_series_gratis' }],
                [{ text: 'Subir serie PRO', callback_data: 'subir_series_pro' }]
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

    if (adminState[chatId] && (adminState[chatId].step === 'search' || adminState[chatId].step === 'search_edit')) {
        const mediaType = adminState[chatId].mediaType || 'movie';
        try {
            const searchUrl = `https://api.themoviedb.org/3/search/${mediaType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(userText)}&language=es-ES`;
            const response = await axios.get(searchUrl);
            const data = response.data;
            if (data.results && data.results.length > 0) {
                const results = data.results.slice(0, 5);
                adminState[chatId].results = data.results;
                adminState[chatId].step = adminState[chatId].step === 'search' ? 'select' : 'select_edit';
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
                                text: adminState[chatId].step === 'select' ? '✅ Agregar' : '✏️ Editar',
                                callback_data: `${adminState[chatId].step}_${item.id}_${mediaType}`
                            }]]
                        }
                    };
                    bot.sendPhoto(chatId, posterUrl, options);
                }
            } else {
                bot.sendMessage(chatId, `No se encontraron resultados para tu búsqueda. Intenta de nuevo.`);
                adminState[chatId].step = 'search';
            }
        } catch (error) {
            console.error("Error al buscar en TMDB:", error);
            bot.sendMessage(chatId, 'Hubo un error al buscar el contenido. Intenta de nuevo.');
        }
    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_free_video_link') {
        const freeEmbedCode = userText;
        const { selectedId, mediaType, isPremium } = adminState[chatId];
        
        adminState[chatId].freeEmbedCode = freeEmbedCode;
        
        // Ahora, el flujo es diferente si la película es gratis o no.
        if (isPremium) {
            adminState[chatId].step = 'awaiting_pro_video_link'; // Si es PRO, pide el código PRO
            const itemData = adminState[chatId].itemData;
            const message = `Seleccionaste "${itemData.title || itemData.name}".\n\nAhora, por favor, envía el código HTML incrustado del reproductor PRO.`;
            bot.sendMessage(chatId, message);
        } else {
            // Si no es premium, guarda el código gratis y termina el proceso.
            try {
                const itemData = adminState[chatId].itemData;
                const endpoint = mediaType === 'movie' ? '/add-movie' : '/add-series-episode';
                const body = mediaType === 'movie' ? {
                    tmdbId: itemData.id,
                    title: itemData.title,
                    poster_path: itemData.poster_path,
                    freeEmbedCode,
                    isPremium: false
                } : {
                    tmdbId: itemData.id,
                    title: itemData.name,
                    poster_path: itemData.poster_path,
                    isPremium: false,
                    seasons: {
                        [1]: {
                            episodes: {
                                [1]: { freeEmbedCode }
                            }
                        }
                    }
                };
                const response = await axios.post(`${RENDER_BACKEND_URL}${endpoint}`, body);
                if (response.status === 200) {
                    bot.sendMessage(chatId, `¡El contenido "${itemData.title || itemData.name}" fue agregado exitosamente!`);
                } else {
                    bot.sendMessage(chatId, `Hubo un error al agregar el contenido: ${response.data.error}`);
                }
            } catch (error) {
                console.error("Error al comunicarse con el backend:", error);
                bot.sendMessage(chatId, "No se pudo conectar con el servidor para agregar el contenido.");
            } finally {
                adminState[chatId] = { step: 'menu' };
            }
        }

    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_pro_video_link') {
        const proEmbedCode = userText;
        const { selectedId, mediaType, freeEmbedCode, isPremium } = adminState[chatId];
        
        let itemData = adminState[chatId].itemData;
        if (!itemData) {
            bot.sendMessage(chatId, "No se encontró la información del contenido seleccionado. Intenta de nuevo.");
            adminState[chatId] = { step: 'menu' };
            return;
        }

        try {
            const endpoint = mediaType === 'movie' ? '/add-movie' : '/add-series-episode';
            
            const body = mediaType === 'movie' ? {
                tmdbId: itemData.id,
                title: itemData.title,
                poster_path: itemData.poster_path,
                freeEmbedCode,
                proEmbedCode,
                isPremium
            } : {
                tmdbId: itemData.id,
                title: itemData.name,
                poster_path: itemData.poster_path,
                isPremium,
                seasons: {
                    [1]: {
                        episodes: {
                            [1]: { freeEmbedCode, proEmbedCode }
                        }
                    }
                }
            };
            
            const response = await axios.post(`${RENDER_BACKEND_URL}${endpoint}`, body);

            if (response.status === 200) {
                bot.sendMessage(chatId, `¡El contenido "${itemData.title || itemData.name}" fue agregado exitosamente con ambos códigos embed!`);
            } else {
                bot.sendMessage(chatId, `Hubo un error al agregar el contenido: ${response.data.error}`);
            }
        } catch (error) {
            console.error("Error al comunicarse con el backend:", error);
            bot.sendMessage(chatId, "No se pudo conectar con el servidor para agregar el contenido.");
        } finally {
            adminState[chatId] = { step: 'menu' };
        }
    }
});

bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_CHAT_ID) return;

    if (data === 'subir_movie_pro' || data === 'subir_movie_gratis') {
        adminState[chatId] = {
            step: 'search',
            isPremium: data === 'subir_movie_pro',
            mediaType: 'movie'
        };
        bot.sendMessage(chatId, `Has elegido subir una película ${adminState[chatId].isPremium ? 'PRO' : 'gratis'}. Por favor, escribe el nombre de la película para buscar en TMDB.`);
    } else if (data === 'subir_series_pro' || data === 'subir_series_gratis') {
        adminState[chatId] = {
            step: 'search',
            isPremium: data === 'subir_series_pro',
            mediaType: 'tv'
        };
        bot.sendMessage(chatId, `Has elegido subir una serie ${adminState[chatId].isPremium ? 'PRO' : 'gratis'}. Por favor, escribe el nombre de la serie para buscar en TMDB.`);
    } else if (data.startsWith('solicitud_')) {
        const tmdbId = data.replace('solicitud_', '');
        try {
            const searchUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
            const response = await axios.get(searchUrl);
            const movieData = response.data;
            
            if (movieData) {
                const selectedMovie = movieData;
                adminState[chatId] = {
                    step: 'awaiting_free_video_link',
                    selectedId: selectedMovie.id,
                    mediaType: 'movie',
                    isPremium: false,
                    itemData: selectedMovie
                };
                const posterUrl = selectedMovie.poster_path ? `https://image.tmdb.org/t/p/w500${selectedMovie.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                const message = `Seleccionaste "${selectedMovie.title}".\n\nPor favor, envía el código HTML incrustado del reproductor GRATIS.`;
                bot.sendPhoto(chatId, posterUrl, { caption: message });
            } else {
                bot.sendMessage(chatId, 'Error: No se encontró la película solicitada en TMDB. Intenta buscarla manualmente.');
            }
        } catch (error) {
            console.error("Error al procesar solicitud:", error);
            bot.sendMessage(chatId, 'Hubo un error al procesar la solicitud.');
        }
    } else if (data.startsWith('select_')) {
        const [_, mediaId, mediaType] = data.split('_');
        const itemData = adminState[chatId].results.find(m => m.id === parseInt(mediaId, 10));
        
        // Ahora, el flujo cambia según si es PRO o gratis
        if (adminState[chatId].isPremium) {
            adminState[chatId] = {
                ...adminState[chatId],
                step: 'awaiting_pro_video_link',
                selectedId: parseInt(mediaId, 10),
                mediaType: mediaType,
                itemData: itemData
            };
            const posterUrl = itemData.poster_path ? `https://image.tmdb.org/t/p/w500${itemData.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
            bot.sendPhoto(chatId, posterUrl, { caption: `Seleccionaste "${itemData.title || itemData.name}".\n\nPor favor, envía el código HTML incrustado del reproductor PRO.` });
        } else {
            adminState[chatId] = {
                ...adminState[chatId],
                step: 'awaiting_free_video_link',
                selectedId: parseInt(mediaId, 10),
                mediaType: mediaType,
                itemData: itemData
            };
            const posterUrl = itemData.poster_path ? `https://image.tmdb.org/t/p/w500${itemData.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
            bot.sendPhoto(chatId, posterUrl, { caption: `Seleccionaste "${itemData.title || itemData.name}".\n\nPor favor, envía el código HTML incrustado del reproductor GRATIS.` });
        }
    }
});


app.listen(PORT, () => {
    console.log(`Servidor de backend de Sala Cine iniciado en el puerto ${PORT}`);
});
