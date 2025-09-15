const express = require('express');
const bodyParser = require('body-parser');
const paypal = require('paypal-rest-sdk');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const axios = require('axios');
const cheerio = require('cheerio');
const dotenv = require('dotenv'); // Nuevo
const app = express();

dotenv.config();

const PORT = process.env.PORT || 3000;

// === CONFIGURACIONES ===
// Inicializa Firebase Admin SDK con la variable de entorno
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SDK);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Configuración de PayPal con variables de entorno
paypal.configure({
    'mode': 'live',
    'client_id': process.env.PAYPAL_CLIENT_ID,
    'client_secret': process.env.PAYPAL_CLIENT_SECRET
});

// Configuración del bot de Telegram
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true }); // Usamos polling para Render
const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT_ID, 10);
const TMDB_API_KEY = process.env.TMDB_API_KEY;

// Un objeto para guardar el estado de la conversación con el administrador
const adminState = {};

// === MIDDLEWARE ===
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

// === RUTAS DEL SERVIDOR WEB ===
// Nueva ruta para mantener vivo el servicio en Render
app.get('/', (req, res) => {
  res.send('¡El bot y el servidor de Sala Cine están activos!');
});

// ... (Aquí van las rutas que ya tenías como '/create-paypal-payment' y '/request-movie') ...

// NUEVA RUTA: Recibe solicitudes de películas de la mini-aplicación
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
            tmdbId: tmdbId,
            title: title,
            poster_path: poster_path,
            mirrors: mirrors,
            isPremium: isPremium
        }, { merge: true });

        res.status(200).json({ message: 'Película agregada a la base de datos.' });
    } catch (error) {
        console.error("Error al agregar película a Firestore:", error);
        res.status(500).json({ error: 'Error al agregar la película a la base de datos.' });
    }
});

// ... (Resto de tus rutas de PayPal y Binance) ...

// === LÓGICA DEL BOT DE TELEGRAM ===
// Escucha el comando /start
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
                [{ text: 'Subir película gratis', callback_data: 'subir_gratis' }],
                [{ text: 'Subir película Premium', callback_data: 'subir_premium' }]
            ]
        }
    };
    bot.sendMessage(chatId, '¡Hola! ¿Qué quieres hacer hoy?', options);
});

// Escucha los mensajes de texto
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userText = msg.text;

    if (chatId !== ADMIN_CHAT_ID || userText.startsWith('/')) {
        return;
    }

    if (adminState[chatId] && adminState[chatId].step === 'search') {
        try {
            const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(userText)}&language=es-ES`;
            const response = await axios.get(searchUrl);
            const data = response.data;

            if (data.results && data.results.length > 0) {
                const results = data.results.slice(0, 5);
                adminState[chatId].results = data.results;
                adminState[chatId].step = 'select_movie';

                for (const movie of results) {
                    const posterUrl = movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                    const message = `🎬 *${movie.title}* (${movie.release_date ? movie.release_date.substring(0, 4) : 'N/A'})\n\n${movie.overview || 'Sin sinopsis disponible.'}`;
                    const options = {
                        caption: message,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[{
                                text: '✅ Agregar a la aplicación',
                                callback_data: `add_movie_${movie.id}`
                            }]]
                        }
                    };
                    bot.sendPhoto(chatId, posterUrl, options);
                }
            } else {
                bot.sendMessage(chatId, 'No se encontraron resultados para tu búsqueda. Intenta de nuevo con otro nombre.');
                adminState[chatId].step = 'search';
            }
        } catch (error) {
            console.error("Error al buscar en TMDB:", error);
            bot.sendMessage(chatId, 'Hubo un error al buscar la película. Intenta de nuevo.');
            adminState[chatId].step = 'search';
        }
    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_video_link') {
        const videoLinks = userText.split(/\s+/).filter(link => link.length > 0);
        const movieId = adminState[chatId].selectedMovieId;
        const movieData = adminState[chatId].results.find(m => m.id === movieId);
        const isPremium = adminState[chatId].isPremium;

        try {
            const response = await axios.post(`${process.env.RENDER_BACKEND_URL}/add-movie`, {
                tmdbId: movieData.id,
                title: movieData.title,
                poster_path: movieData.poster_path,
                mirrors: videoLinks,
                isPremium: isPremium
            });

            if (response.status === 200) {
                bot.sendMessage(chatId, `¡La película "${movieData.title}" fue agregada exitosamente con ${videoLinks.length} mirrors!`);
            } else {
                bot.sendMessage(chatId, `Hubo un error al agregar la película: ${response.data.error}`);
            }
        } catch (error) {
            console.error("Error al comunicarse con el backend:", error);
            bot.sendMessage(chatId, "No se pudo conectar con el servidor para agregar la película.");
        } finally {
            adminState[chatId] = { step: 'menu' };
        }
    }
});

// Escucha los clics en los botones
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = msg.chat.id;

    if (chatId !== ADMIN_CHAT_ID) {
        bot.sendMessage(chatId, 'Lo siento, no tienes permiso para usar este bot.');
        return;
    }

    if (data === 'subir_gratis' || data === 'subir_premium') {
        adminState[chatId] = {
            step: 'search',
            isPremium: data === 'subir_premium'
        };
        bot.sendMessage(chatId, `Has elegido subir una película ${adminState[chatId].isPremium ? 'Premium' : 'gratis'}. Por favor, escribe el nombre de la película para buscar en TMDB.`);
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
                    selectedMovieId: selectedMovie.id,
                    results: movieData.results,
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
    } else if (data.startsWith('add_movie_') && adminState[chatId] && adminState[chatId].step === 'select_movie') {
        const movieId = parseInt(data.replace('add_movie_', ''), 10);
        const movieData = adminState[chatId].results.find(m => m.id === movieId);

        if (movieData) {
            adminState[chatId].step = 'awaiting_video_link';
            adminState[chatId].selectedMovieId = movieId;

            const posterUrl = movieData.poster_path ? `https://image.tmdb.org/t/p/w500${movieData.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
            const message = `Seleccionaste "${movieData.title}".\n\nPor favor, envía los enlaces de video, separados por un espacio.`;
            bot.sendPhoto(chatId, posterUrl, { caption: message });
        } else {
            bot.sendMessage(chatId, 'Error: Película no encontrada. Intenta buscar de nuevo.');
            adminState[chatId].step = 'search';
        }
    }
});

app.listen(PORT, () => {
    console.log(`Servidor de backend de Sala Cine iniciado en el puerto ${PORT}`);
});
