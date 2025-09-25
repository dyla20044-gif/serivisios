const express = require('express');
const bodyParser = require('body-parser');
const paypal = require('paypal-rest-sdk');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const axios = require('axios');
const dotenv = require('dotenv');
const { MongoClient } = require('mongodb');
const cheerio = require('cheerio');
const schedule = require('node-schedule');
const { decode } = require('html-entities');

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
const TRAKT_CLIENT_ID = process.env.TRAKT_CLIENT_ID;
const TRAKT_CLIENT_SECRET = process.env.TRAKT_CLIENT_SECRET;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const USER_REQUEST_LIMIT = 5;
const REQUEST_LIMIT = 3;
const VOTES_THRESHOLD = 500;
const AUTO_POST_COUNT = 4;

// Canal ID
const TELEGRAM_MAIN_CHANNEL_ID = -1002240787394;
const TELEGRAM_PUBLIC_CHANNEL_ID = -1001945286271;
const MAIN_CHANNEL_USERNAME = "click_para_ver";
const MAIN_CHANNEL_INVITE_LINK = "https://t.me/click_para_ver";

const BASE_TMDB_URL = "https://api.themoviedb.org/3";
const POSTER_BASE_URL = "https://image.tmdb.org/t/p/w500";
const SEARCH_RESULTS_PER_PAGE = 5;

const WELCOME_IMAGE_URL = "https://i.imgur.com/DJSUzQh.jpeg";

// Géneros de TMDB
const GENRES = {
    "Acción": 28, "Aventura": 12, "Animación": 16, "Comedia": 35, "Crimen": 80,
    "Documental": 99, "Drama": 18, "Familia": 10751, "Fantasía": 14, "Historia": 36,
    "Terror": 27, "Música": 10402, "Misterio": 9648, "Romance": 10749, "Ciencia ficción": 878,
    "Película de TV": 10770, "Suspense": 53, "Guerra": 10752, "Western": 37
};

// === LÓGICA DE MongoDB (NUEVO) ===
let mongoDb;
async function connectToMongo() {
    try {
        const client = new MongoClient(process.env.DATABASE_URL);
        await client.connect();
        mongoDb = client.db("movies_database");
        console.log("Conectado a MongoDB con éxito.");
    } catch (error) {
        console.error("Error al conectar a MongoDB:", error);
    }
}
connectToMongo();

async function saveMovieToMongoDb(movieData) {
    const collection = mongoDb.collection("movies_collection");
    await collection.updateOne({ id: movieData.id }, { $set: movieData }, { upsert: true });
}

async function getMovieFromMongoDb(tmdbId) {
    const collection = mongoDb.collection("movies_collection");
    return await collection.findOne({ id: tmdbId });
}

async function getAllMoviesFromMongoDb() {
    const collection = mongoDb.collection("movies_collection");
    return await collection.find({}).sort({ added_at: -1 }).toArray();
}

async function deleteMovieFromMongoDb(movieId) {
    const collection = mongoDb.collection("movies_collection");
    await collection.deleteOne({ id: movieId });
}

// === CONFIGURACIÓN DE COMANDOS Y ESTADOS DEL BOT ===
bot.setMyCommands([
    { command: 'start', description: 'Reiniciar el bot y ver el menú principal' },
    { command: 'subir', description: 'Subir una película o serie a la base de datos' },
    { command: 'editar', description: 'Editar los enlaces de una película o serie existente' },
    { command: 'pedidos', description: 'Ver la lista de películas solicitadas por los usuarios' }
]);

const adminState = {};
const userDailyRequests = {};
const dailyRequests = {};

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

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ----------------------------------------------------------------------------------------------------
// A PARTIR DE AQUI SE ENCUENTRA LA LÓGICA DE AMBOS BOTS UNIFICADA
// ----------------------------------------------------------------------------------------------------

// === LÓGICA DEL BOT DE TELEGRAM DE LA APP DE CINE ===
// (Esto es el código que ya tenías, pero reorganizado)

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
        
        const movieRef = db.collection('movies').doc(tmdbId.toString());
        const movieDoc = await movieRef.get();

        let movieDataToSave = {};

        if (movieDoc.exists) {
            const existingData = movieDoc.data();
            movieDataToSave = {
                ...existingData,
                title: title,
                poster_path: poster_path,
                freeEmbedCode: freeEmbedCode !== undefined ? freeEmbedCode : existingData.freeEmbedCode,
                proEmbedCode: proEmbedCode !== undefined ? proEmbedCode : existingData.proEmbedCode,
                isPremium: isPremium
            };
        } else {
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

// === FIN DE LA LÓGICA DEL BOT DE LA APP DE CINE ===

// ----------------------------------------------------------------------------------------------------
// A PARTIR DE AQUI SE ENCUENTRAN LOS HANDLERS DEL BOT ADMINISTRADOR REESCRITOS DE PYTHON A JAVASCRIPT
// ----------------------------------------------------------------------------------------------------

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (userId == ADMIN_CHAT_ID) {
        adminState[chatId] = { step: 'menu' };
        const keyboard = {
            keyboard: [
                [{ text: "➕ Agregar película" }, { text: "📋 Ver catálogo" }],
                [{ text: "⚙️ Configuración auto-publicación" }, { text: "🗳️ Iniciar votación" }]
            ],
            resize_keyboard: true
        };
        bot.sendMessage(chatId, "¡Hola, Administrador! Elige una opción:", { reply_markup: keyboard });
    } else {
        const userKeyboard = {
            keyboard: [
                [{ text: "🔍 Buscar película" }, { text: "🎞️ Estrenos" }],
                [{ text: "✨ Recomiéndame" }, { text: "📌 Pedir película" }],
                [{ text: "🆘 Soporte" }]
            ],
            resize_keyboard: true
        };
        const caption = "¡Hola! Soy un bot que te ayuda a encontrar tus películas favoritas. ¡Usa el menú de abajo para empezar!";
        bot.sendPhoto(chatId, WELCOME_IMAGE_URL, { caption: caption, reply_markup: userKeyboard, parse_mode: 'Markdown' });
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userText = msg.text;

    if (chatId == ADMIN_CHAT_ID) {
        switch (userText) {
            case "➕ Agregar película":
                adminState[chatId] = { step: 'waiting_for_admin_movie_name' };
                bot.sendMessage(chatId, "Por favor, escribe el nombre de la película que quieres agregar.");
                break;
            case "📋 Ver catálogo":
                adminState[chatId] = { step: 'menu' };
                const allMovies = await getAllMoviesFromMongoDb();
                if (allMovies.length === 0) {
                    bot.sendMessage(chatId, "Aún no hay películas en el catálogo.");
                } else {
                    await sendCatalogPage(chatId, 0, allMovies);
                }
                break;
            case "⚙️ Configuración auto-publicación":
                adminState[chatId] = { step: 'menu' };
                bot.sendMessage(chatId, "Elige cuántas películas quieres que se publiquen automáticamente cada día:", {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "4 películas al día", callback_data: "set_auto_4" }],
                            [{ text: "6 películas al día", callback_data: "set_auto_6" }],
                        ]
                    }
                });
                break;
            case "🗳️ Iniciar votación":
                adminState[chatId] = { step: 'waiting_for_voting_movies', movies: [] };
                bot.sendMessage(chatId, "Por favor, envía los nombres de las 3 películas que quieres para la votación, cada una en un mensaje separado.");
                break;
        }

        if (adminState[chatId] && adminState[chatId].step === 'waiting_for_admin_movie_name') {
            const results = await getMovieResultsByTitle(userText);
            if (results.length === 0) {
                bot.sendMessage(chatId, "No se encontraron resultados. Intenta con otro nombre.");
                return;
            }
            results.slice(0, SEARCH_RESULTS_PER_PAGE).forEach(async (movie) => {
                const details = await getMovieDetails(movie.id);
                if (details) {
                    const movieInDb = await getMovieFromMongoDb(movie.id);
                    const keyboard = movieInDb ?
                        { inline_keyboard: [[{ text: "✅ Película ya en el catálogo", callback_data: "movie_exists_dummy" }]] } :
                        { inline_keyboard: [[{ text: "Agregar esta película", callback_data: `admin_add_movie:${movie.id}` }]] };
                    bot.sendPhoto(chatId, POSTER_BASE_URL + movie.poster_path, {
                        caption: createMovieMessage(details).text,
                        reply_markup: keyboard,
                        parse_mode: 'HTML'
                    });
                }
            });
            adminState[chatId] = { step: 'menu' };
        } else if (adminState[chatId] && adminState[chatId].step === 'waiting_for_voting_movies') {
            adminState[chatId].movies.push(userText);
            if (adminState[chatId].movies.length < 3) {
                bot.sendMessage(chatId, `Recibido. Faltan ${3 - adminState[chatId].movies.length} películas.`);
            } else {
                const moviesDetails = [];
                for (const movieName of adminState[chatId].movies) {
                    const results = await getMovieResultsByTitle(movieName);
                    if (results.length > 0) {
                        const details = await getMovieDetails(results[0].id);
                        if (details) moviesDetails.push(details);
                    }
                }
                if (moviesDetails.length === 3) {
                    startVoting(chatId, moviesDetails);
                } else {
                    bot.sendMessage(chatId, "No se pudieron encontrar 3 películas válidas. Intenta de nuevo.");
                    adminState[chatId] = { step: 'menu' };
                }
            }
        }
    } else {
        switch (userText) {
            case "🔍 Buscar película":
                adminState[chatId] = { step: 'waiting_for_search_query' };
                bot.sendMessage(chatId, "Por favor, escribe el nombre de la película. 🎬");
                break;
            case "🎞️ Estrenos":
                showUpcomingMovies(chatId, 1);
                break;
            case "✨ Recomiéndame":
                showPopularMovies(chatId, 1);
                break;
            case "📌 Pedir película":
                adminState[chatId] = { step: 'waiting_for_movie_name_to_request' };
                bot.sendMessage(chatId, "Por favor, escribe el nombre de la película que te gustaría solicitar.");
                break;
            case "🆘 Soporte":
                adminState[chatId] = { step: 'waiting_for_support_message' };
                bot.sendMessage(chatId, "Escribe tu mensaje para el equipo de soporte.");
                break;
            case "📰 Noticias":
                showNews(chatId);
                break;
            case "😂 Meme del día":
                showRandomMeme(chatId);
                break;
            default:
                if (adminState[chatId]?.step === 'waiting_for_search_query') {
                    const results = await getMovieResultsByTitle(userText);
                    if (results.length === 0) {
                        bot.sendMessage(chatId, "No se encontraron películas con ese nombre. Intenta con otro.");
                    } else {
                        results.slice(0, SEARCH_RESULTS_PER_PAGE).forEach(async (movie) => {
                            const details = await getMovieDetails(movie.id);
                            const movieInDb = await getMovieFromMongoDb(movie.id);
                            const keyboard = movieInDb ?
                                { inline_keyboard: [[{ text: "🎬 Ver ahora", url: movieInDb.link }]] } :
                                { inline_keyboard: [[{ text: "🎬 Pedir esta película", callback_data: `request_movie_by_id:${movie.id}` }]] };
                            bot.sendPhoto(chatId, POSTER_BASE_URL + movie.poster_path, {
                                caption: createMovieMessage(details).text,
                                reply_markup: keyboard,
                                parse_mode: 'HTML'
                            });
                        });
                    }
                    adminState[chatId] = { step: 'menu' };
                } else if (adminState[chatId]?.step === 'waiting_for_movie_name_to_request') {
                    handleMovieRequest(chatId, userText);
                    adminState[chatId] = { step: 'menu' };
                } else if (adminState[chatId]?.step === 'waiting_for_support_message') {
                    handleSupportMessage(chatId, msg.from, userText);
                    adminState[chatId] = { step: 'menu' };
                }
        }
    }
});

bot.on('callback_query', async (callbackQuery) => {
    const data = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;

    if (chatId == ADMIN_CHAT_ID) {
        if (data.startsWith('set_auto_')) {
            const count = data.split('_')[2];
            bot.editMessageText(`✅ Publicación automática configurada para ${count} películas al día.`, {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id
            });
        } else if (data.startsWith('admin_add_movie:')) {
            const tmdbId = data.split(':')[1];
            const movieDetails = await getMovieDetails(tmdbId);
            if (movieDetails) {
                adminState[chatId] = { step: 'waiting_for_admin_movie_link', movieDetails: movieDetails };
                bot.sendMessage(chatId, `Has seleccionado "${movieDetails.title}". Por favor, envía el enlace de la película.`);
            }
        } else if (data.startsWith('publish_now_admin:')) {
            const tmdbId = parseInt(data.split(':')[1]);
            const movieInfo = await getMovieFromMongoDb(tmdbId);
            if (movieInfo) {
                const tmdbData = await getMovieDetails(tmdbId);
                await deleteMoviePost(tmdbId);
                const { text, poster_url, post_keyboard } = createMovieMessage(tmdbData, movieInfo.link);
                sendMoviePost(TELEGRAM_MAIN_CHANNEL_ID, tmdbData, movieInfo.link, post_keyboard);
                bot.sendMessage(chatId, "✅ Película publicada con éxito.");
            }
        } else if (data.startsWith('catalog_page:')) {
            const page = parseInt(data.split(':')[1]);
            const allMovies = await getAllMoviesFromMongoDb();
            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            await sendCatalogPage(chatId, page, allMovies);
        } else if (data.startsWith('delete_movie:')) {
            const movieId = parseInt(data.split(':')[1]);
            const movieToDelete = await getMovieFromMongoDb(movieId);
            if (movieToDelete) {
                await deleteMovieFromMongoDb(movieId);
                bot.sendMessage(chatId, `✅ Película "${movieToDelete.title}" eliminada del catálogo.`);
            }
        } else if (data.startsWith('solicitud_')) {
            const tmdbId = data.replace('solicitud_', '');
            try {
                const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
                const response = await axios.get(tmdbUrl);
                const mediaData = response.data;
                adminState[chatId] = { selectedMedia: mediaData, mediaType: 'movie', step: 'awaiting_pro_link_movie' };
                bot.sendMessage(chatId, `Seleccionaste "${mediaData.title}". Envía el reproductor PRO. Si no hay, escribe "no".`);

                const requestsRef = db.collection('requests');
                const snapshot = await requestsRef.where('tmdbId', '==', tmdbId).get();
                snapshot.forEach(doc => {
                    doc.ref.delete();
                });
            } catch (error) {
                console.error("Error al obtener datos de TMDB para solicitud:", error);
                bot.sendMessage(chatId, 'Hubo un error al obtener la información de la película. Intenta de nuevo.');
            }
        }
    } else {
        if (data.startsWith('request_movie_by_id:')) {
            const tmdbId = data.split(':')[1];
            handleMovieRequestById(callbackQuery.message.chat.id, tmdbId, callbackQuery.from.id);
        }
    }
});

// === FUNCIONES DE UTILIDAD ===
function createMovieMessage(movieData, movieLink = null, fromChannel = false) {
    const title = decode(movieData.title || movieData.name || "Título no disponible");
    const overview = decode(movieData.overview || "Sinopsis no disponible.");
    const releaseDate = (movieData.release_date || movieData.first_air_date || "Fecha no disponible");
    const voteAverage = movieData.vote_average || 0;
    const posterPath = movieData.poster_path;

    const trimmedOverview = overview.length > 250 ? overview.substring(0, 250) + "..." : overview;

    const text = `<b>🎬 ${title}</b>\n\n` +
                 `<i>Sinopsis:</i> ${trimmedOverview}\n\n` +
                 `📅 <b>Fecha de estreno:</b> ${releaseDate}\n` +
                 `⭐ <b>Puntuación:</b> ${voteAverage.toFixed(1)}/10`;

    let postKeyboard;
    if (fromChannel) {
        postKeyboard = {
            inline_keyboard: [
                [{ text: "🎬 Ver ahora", url: movieLink }],
                [{ text: "✨ Pedir otra película", url: `https://t.me/sdmin_dy_bot?start=request` }]
            ]
        };
    } else if (movieLink) {
        postKeyboard = {
            inline_keyboard: [
                [{ text: "🎬 Ver ahora", url: movieLink }],
                [{ text: "📽️ Pedir otra película", url: `https://t.me/sdmin_dy_bot?start=request` }]
            ]
        };
    } else {
        postKeyboard = {
            inline_keyboard: [
                [{ text: "🎬 ¿Quieres pedir una película? Pídela aquí 👇", url: `https://t.me/sdmin_dy_bot?start=request` }]
            ]
        };
    }
    
    const posterUrl = posterPath ? `${POSTER_BASE_URL}${posterPath}` : null;

    return { text, posterUrl, postKeyboard };
}

async function deleteMoviePost(tmdbId) {
    const movieData = await getMovieFromMongoDb(tmdbId);
    if (movieData && movieData.last_message_id) {
        try {
            await bot.deleteMessage(TELEGRAM_MAIN_CHANNEL_ID, movieData.last_message_id);
        } catch (e) {
            console.error(`Error al borrar el mensaje ${movieData.last_message_id}:`, e);
        }
    }
}

async function sendMoviePost(chatId, movieData, movieLink, postKeyboard, userIdToNotify = null) {
    const { text, posterUrl } = createMovieMessage(movieData, movieLink, true);
    
    try {
        const message = await bot.sendPhoto(chatId, posterUrl, {
            caption: text,
            reply_markup: postKeyboard,
            parse_mode: 'HTML'
        });

        if (chatId === TELEGRAM_MAIN_CHANNEL_ID) {
            movieData.last_message_id = message.message_id;
            await saveMovieToMongoDb(movieData);
            const publicMessageId = await forwardPostToPublicChannel(message, movieData);
            if (publicMessageId) {
                movieData.last_message_id_public = publicMessageId;
                await saveMovieToMongoDb(movieData);
            }
        }
        
        if (userIdToNotify) {
            const notificationMessage = `🎉 ¡Tu película solicitada, **${movieData.title}**, ya está disponible en el canal!\n\nHaz clic en el botón de abajo para verla.`;
            const keyboard = {
                inline_keyboard: [
                    [{ text: "🎬 Ver ahora", url: `https://t.me/${MAIN_CHANNEL_USERNAME}/${message.message_id}` }],
                ]
            };
            await bot.sendMessage(userIdToNotify, notificationMessage, { reply_markup: keyboard, parse_mode: 'Markdown' });
        }

        return message.message_id;

    } catch (e) {
        console.error("Error al enviar la publicación:", e);
        return null;
    }
}

async function forwardPostToPublicChannel(originalMessage, movieData) {
    if (!TELEGRAM_PUBLIC_CHANNEL_ID) return;

    const postLink = `https://t.me/${MAIN_CHANNEL_USERNAME}/${originalMessage.message_id}`;
    const sinopsis = movieData.overview.length > 250 ? movieData.overview.substring(0, 250) + "..." : movieData.overview;
    
    const captionText = `🎬 **¡Nueva película disponible!**\n\n` +
                        `🍿 **${movieData.title}**\n\n` +
                        `📝 ${sinopsis}\n\n` +
                        `Presiona el botón 'Ver Película' para acceder al post original.`;

    const keyboard = {
        inline_keyboard: [
            [{ text: "🎬 Ver Película", url: postLink }],
            [{ text: "➡️ Ir al Canal", url: MAIN_CHANNEL_INVITE_LINK }],
            [{ text: "✨ Pedir una película", url: "https://t.me/sdmin_dy_bot?start=request" }]
        ]
    };
    
    const posterUrl = getMoviePosterUrl(movieData.poster_path);
    if (posterUrl) {
        const publicMessage = await bot.sendPhoto(TELEGRAM_PUBLIC_CHANNEL_ID, posterUrl, { caption: captionText, reply_markup: keyboard, parse_mode: 'Markdown' });
        return publicMessage.message_id;
    }
    return null;
}

async function sendCatalogPage(chatId, page, allMovies) {
    const moviesPerPage = 5;
    const start = page * moviesPerPage;
    const end = start + moviesPerPage;
    const pageMovies = allMovies.slice(start, end);
    const totalPages = Math.ceil(allMovies.length / moviesPerPage);

    let text = `**Catálogo de Películas** (Página ${page + 1}/${totalPages})\n\n`;
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });

    for (const movie of pageMovies) {
        const title = movie.title || "Título desconocido";
        const tmdbId = movie.id;
        
        const keyboard = {
            inline_keyboard: [
                [{ text: "📌 Publicar en el canal", callback_data: `publish_now_admin:${tmdbId}` }],
                [{ text: "✏️ Editar película", callback_data: `edit_movie:${tmdbId}` },
                { text: "🗑️ Eliminar película", callback_data: `delete_movie:${tmdbId}` }]
            ]
        };
        
        const messageText = `**${title}**\nID: \`${tmdbId}\``;
        
        await bot.sendMessage(chatId, messageText, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }

    const paginationButtons = [];
    if (page > 0) {
        paginationButtons.push({ text: "⬅️ Anterior", callback_data: `catalog_page:${page-1}` });
    }
    if (page + 1 < totalPages) {
        paginationButtons.push({ text: "Siguiente ➡️", callback_data: `catalog_page:${page+1}` });
    }
    
    if (paginationButtons.length > 0) {
        const keyboard = { inline_keyboard: [paginationButtons] };
        await bot.sendMessage(chatId, "Navegación:", { reply_markup: keyboard });
    }
}

async function startVoting(chatId, moviesDetails) {
    const votingData = {
        movie_ids: moviesDetails.map(m => m.id),
        votes: Object.fromEntries(moviesDetails.map(m => [m.id, 0])),
        voters: new Set(),
        voting_message_id: null
    };

    const mediaGroup = moviesDetails.map((movie, i) => ({
        type: 'photo',
        media: POSTER_BASE_URL + movie.poster_path,
        caption: `**Opción ${i+1}: ${movie.title}**`
    }));

    const keyboardButtons = moviesDetails.map((movie, i) => ([{ text: `Votar por ${i+1}`, callback_data: `vote_${movie.id}` }]));
    keyboardButtons.push([{ text: "📊 Ver estadísticas", callback_data: "show_voting_stats" }]);
    const keyboard = { inline_keyboard: keyboardButtons };

    await bot.sendMediaGroup(chatId, mediaGroup);
    const votingMessage = await bot.sendMessage(
        chatId,
        "🗳️ ¡Vota por la próxima película! La película que alcance 500 votos primero se publicará en el canal.",
        { reply_markup: keyboard, parse_mode: 'Markdown' }
    );
    votingData.voting_message_id = votingMessage.message_id;
    adminState[chatId] = { step: 'voting_active', votingData: votingData };

    schedule.scheduleJob('*/10 * * * *', async () => {
        // Lógica para terminar la votación si no hay actividad
    });
}

async function handleMovieRequest(chatId, movieTitle) {
    // Implementar la lógica del bot de Python aquí
}

async function handleMovieRequestById(chatId, tmdbId, requesterId) {
    // Implementar la lógica del bot de Python aquí
}

async function handleSupportMessage(chatId, userInfo, messageText) {
    // Implementar la lógica del bot de Python aquí
}

async function showUpcomingMovies(chatId, page) {
    // Implementar la lógica del bot de Python aquí
}

async function showPopularMovies(chatId, page) {
    // Implementar la lógica del bot de Python aquí
}

async function showNews(chatId) {
    // Implementar la lógica del bot de Python aquí
}

async function showRandomMeme(chatId) {
    // Implementar la lógica del bot de Python aquí
}

// === TAREAS AUTOMATIZADAS ===
async function autoPostScheduler() {
    const unpostedMovies = (await getAllMoviesFromMongoDb()).filter(m => !m.last_message_id);
    if (unpostedMovies.length > 0) {
        const movieToPost = unpostedMovies[Math.floor(Math.random() * unpostedMovies.length)];
        const details = await getMovieDetails(movieToPost.id);
        if (details) {
            await deleteMoviePost(movieToPost.id);
            const { text, posterUrl, postKeyboard } = createMovieMessage(details, movieToPost.link);
            sendMoviePost(TELEGRAM_MAIN_CHANNEL_ID, details, movieToPost.link, postKeyboard);
        }
    }
}

async function channelContentScheduler() {
    const contentToPost = Math.random() < 0.5 ? 'news' : 'meme';
    if (contentToPost === 'news') {
        const news = await getLatestNews();
        if (news.length > 0) {
            const article = news[Math.floor(Math.random() * news.length)];
            const text = `<b>${decode(article.title)}</b>\n\n<a href="${article.url}">Leer más</a>`;
            await bot.sendPhoto(TELEGRAM_PUBLIC_CHANNEL_ID, article.urlToImage, { caption: text, parse_mode: 'HTML' });
        }
    } else {
        const { memeUrl, memeCaption } = await getRandomMeme();
        if (memeUrl) {
            await bot.sendPhoto(TELEGRAM_PUBLIC_CHANNEL_ID, memeUrl, { caption: memeCaption });
        }
    }
}

// Inicia las tareas automáticas
schedule.scheduleJob('0 */6 * * *', autoPostScheduler);
schedule.scheduleJob('0 */4 * * *', channelContentScheduler);

app.listen(PORT, () => {
    console.log(`Servidor de backend de Sala Cine iniciado en el puerto ${PORT}`);
});
