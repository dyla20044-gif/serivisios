const express = require('express');
const bodyParser = require('body-parser');
const paypal = require('paypal-rest-sdk');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const axios = require('axios');
const cheerio = require('cheerio');
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
const bot = new TelegramBot(token, { polling: true });
const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT_ID, 10);
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const RENDER_BACKEND_URL = process.env.RENDER_BACKEND_URL;

// === CONFIGURACIÓN DE ATJOS DEL BOT (NUEVO) ===
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

app.post('/request-movie', async (req, res) => {
    const movieTitle = req.body.title;
    const posterPath = req.body.poster_path;
    const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : 'https://placehold.co/500x750?text=No+Poster';

    const message = `🔔 *Solicitud de película:* ${movieTitle}\n\nUn usuario ha solicitado esta película.`;
    
    try {
        await bot.sendPhoto(ADMIN_CHAT_ID, posterUrl, {
            caption: message,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{
                    text: '✅ Agregar ahora',
                    callback_data: `solicitud_${movieTitle}`
                }]]
            }
        });
        res.status(200).json({ message: 'Solicitud enviada al administrador.' });
    } catch (error) {
        console.error("Error al enviar notificación a Telegram:", error);
        res.status(500).json({ error: 'Error al enviar la notificación al bot.' });
    }
});

// === FUNCIONES Y RUTAS DEL NUEVO ENDPOINT DE VIDEO ===
async function extractStreamTape(url) {
    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        const scriptContent = $('script').filter((i, el) => $(el).html().includes('document.getElementById')).html();
        if (scriptContent) {
            const part1Match = scriptContent.match(/document\.getElementById\('(.+)'\)\.innerHTML/);
            if (!part1Match) return null;
            const part1 = part1Match[1];
            const part2 = $(`#${part1}`).text();
            const decodedUrl = "https://streamtape.com/get_video" + part2.substring(8);
            return decodedUrl;
        }
        return null;
    } catch (error) {
        console.error("Error extrayendo StreamTape:", error);
        return null;
    }
}

async function extractFileMoon(url) {
    try {
        const response = await axios.get(url);
        const match = response.data.match(/file: \"(.*?\.mp4)\"/);
        if (match) {
            return match[1];
        }
        return null;
    } catch (error) {
        console.error("Error extrayendo FileMoon:", error);
        return null;
    }
}

app.post('/api/extract-video', async (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: "URL is missing" });
    }

    let videoUrl = null;
    if (url.includes('filemoon.sx')) {
        videoUrl = await extractFileMoon(url);
    } else if (url.includes('streamtape.com')) {
        videoUrl = await extractStreamTape(url);
    } else {
        return res.status(400).json({ error: "Unsupported video server" });
    }

    if (videoUrl) {
        res.json({ videoUrl });
    } else {
        res.status(500).json({ error: "Could not extract video URL" });
    }
});

app.post('/add-movie', async (req, res) => {
    try {
        const { tmdbId, title, poster_path, mirrors, isPremium } = req.body;
        if (!Array.isArray(mirrors) || mirrors.length === 0) {
            return res.status(400).json({ error: 'Debes proporcionar al menos un mirror de video.' });
        }
        const movieRef = db.collection('movies').doc(tmdbId.toString());
        await movieRef.set({
            tmdbId,
            title,
            poster_path,
            mirrors,
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
        const { tmdbId, title, poster_path, seasonNumber, episodeNumber, mirrors, isPremium } = req.body;

        if (!Array.isArray(mirrors) || mirrors.length === 0) {
            return res.status(400).json({ error: 'Debes proporcionar al menos un mirror para el episodio.' });
        }

        const seriesRef = db.collection('series').doc(tmdbId.toString());
        await seriesRef.set({
            tmdbId,
            title,
            poster_path,
            isPremium,
            [`seasons.${seasonNumber}.episodes.${episodeNumber}`]: { mirrors }
        }, { merge: true });

        res.status(200).json({ message: `Episodio ${episodeNumber} de la temporada ${seasonNumber} agregado a la base de datos.` });
    } catch (error) {
        console.error("Error al agregar episodio de serie a Firestore:", error);
        res.status(500).json({ error: 'Error al agregar el episodio de la serie a la base de datos.' });
    }
});

// Rutas de callback de PayPal
app.get('/paypal/success', (req, res) => {
    res.send('<html><body><h1>Pago con PayPal exitoso. Vuelve a tu aplicación para ver los cambios.</h1></body></html>');
});

app.get('/paypal/cancel', (req, res) => {
    res.send('<html><body><h1>Pago con PayPal cancelado.</h1></body></html>');
});

// Ruta de ejemplo para pagos con Binance (simulada)
app.post('/create-binance-payment', (req, res) => {
    res.json({ message: 'Pago con Binance simulado. Lógica de backend real necesaria.' });
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


// === LÓGICA DEL BOT DE TELEGRAM ===
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (msg.chat.id !== ADMIN_CHAT_ID) {
        bot.sendMessage(msg.chat.id, 'Lo siento, no tienes permiso para usar este bot.');
        return;
    }
    adminState[chatId] = { step: 'menu' };
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Subir película gratis', callback_data: 'subir_movie_gratis' }],
                [{ text: 'Subir película Premium', callback_data: 'subir_movie_premium' }],
                [{ text: 'Subir serie gratis', callback_data: 'subir_series_gratis' }],
                [{ text: 'Subir serie Premium', callback_data: 'subir_series_premium' }]
            ]
        }
    };
    bot.sendMessage(chatId, '¡Hola! ¿Qué quieres hacer hoy?', options);
});

bot.onText(/\/subir/, (msg) => {
    const chatId = msg.chat.id;
    if (msg.chat.id !== ADMIN_CHAT_ID) return;
    adminState[chatId] = { step: 'menu' };
    bot.emit('callback_query', { message: msg, data: 'start' });
});

bot.onText(/\/editar/, (msg) => {
    const chatId = msg.chat.id;
    if (msg.chat.id !== ADMIN_CHAT_ID) return;
    adminState[chatId] = { step: 'search_edit' };
    bot.sendMessage(chatId, 'Por favor, escribe el nombre de la película o serie que quieres editar.');
});

bot.onText(/\/pedidos/, async (msg) => {
    const chatId = msg.chat.id;
    if (msg.chat.id !== ADMIN_CHAT_ID) return;
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
    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_video_link') {
        const rawLinks = userText.split(/\s+/).filter(link => link.length > 0);
        const selectedId = adminState[chatId].selectedId;
        const mediaType = adminState[chatId].mediaType;
        const isPremium = adminState[chatId].isPremium;
        
        let itemData = null;
        try {
            const response = await axios.get(`https://api.themoviedb.org/3/${mediaType}/${selectedId}?api_key=${TMDB_API_KEY}&language=es-ES`);
            itemData = response.data;
        } catch (error) {
            console.error("Error al buscar en TMDB para agregar:", error);
            bot.sendMessage(chatId, "No se pudo encontrar la información del contenido. Intenta de nuevo.");
            adminState[chatId] = { step: 'menu' };
            return;
        }
        
        if (!itemData) {
            bot.sendMessage(chatId, "No se encontró la información del contenido seleccionado. Intenta de nuevo.");
            adminState[chatId] = { step: 'menu' };
            return;
        }

        const mirrors = rawLinks.map(link => ({ url: link, quality: 'normal' }));

        try {
            const endpoint = mediaType === 'movie' ? '/add-movie' : '/add-series-episode';
            const body = mediaType === 'movie' ? {
                tmdbId: itemData.id,
                title: itemData.title,
                poster_path: itemData.poster_path,
                mirrors,
                isPremium
            } : {
                tmdbId: itemData.id,
                title: itemData.name,
                poster_path: itemData.poster_path,
                mirrors,
                isPremium,
                seasonNumber: 1,
                episodeNumber: 1
            };

            const response = await axios.post(`${RENDER_BACKEND_URL}${endpoint}`, body);

            if (response.status === 200) {
                bot.sendMessage(chatId, `¡El contenido "${itemData.title || itemData.name}" fue agregado exitosamente con ${mirrors.length} mirrors!`);
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

    if (data === 'subir_movie_gratis' || data === 'subir_movie_premium') {
        adminState[chatId] = {
            step: 'search',
            isPremium: data === 'subir_movie_premium',
            mediaType: 'movie'
        };
        bot.sendMessage(chatId, `Has elegido subir una película ${adminState[chatId].isPremium ? 'Premium' : 'gratis'}. Por favor, escribe el nombre de la película para buscar en TMDB.`);
    } else if (data === 'subir_series_gratis' || data === 'subir_series_premium') {
        adminState[chatId] = {
            step: 'search',
            isPremium: data === 'subir_series_premium',
            mediaType: 'tv'
        };
        bot.sendMessage(chatId, `Has elegido subir una serie ${adminState[chatId].isPremium ? 'Premium' : 'gratis'}. Por favor, escribe el nombre de la serie para buscar en TMDB.`);
    } else if (data.startsWith('solicitud_')) {
        const movieTitle = data.replace('solicitud_', '');
        try {
            const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(movieTitle)}&language=es-ES`;
            const response = await axios.get(searchUrl);
            const movieData = response.data;
            
            if (movieData.results && movieData.results.length > 0) {
                const selectedMovie = movieData.results[0];
                adminState[chatId] = {
                    step: 'awaiting_video_link',
                    selectedId: selectedMovie.id,
                    mediaType: 'movie',
                    isPremium: false
                };
                const posterUrl = selectedMovie.poster_path ? `https://image.tmdb.org/t/p/w500${selectedMovie.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                const message = `Seleccionaste "${selectedMovie.title}".\n\nPor favor, envía los enlaces de video, separados por un espacio.`;
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
        adminState[chatId] = {
            ...adminState[chatId],
            step: 'awaiting_video_link',
            selectedId: parseInt(mediaId, 10),
            mediaType: mediaType
        };
        const itemData = adminState[chatId].results.find(m => m.id === adminState[chatId].selectedId);
        const posterUrl = itemData.poster_path ? `https://image.tmdb.org/t/p/w500${itemData.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
        bot.sendPhoto(chatId, posterUrl, { caption: `Seleccionaste "${itemData.title || itemData.name}".\n\nPor favor, envía los enlaces de video, separados por un espacio.` });
    }
});


app.listen(PORT, () => {
    console.log(`Servidor de backend de Sala Cine iniciado en el puerto ${PORT}`);
});
