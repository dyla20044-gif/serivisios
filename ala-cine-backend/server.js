const express = require('express');
const bodyParser = require('body-parser');
const paypal = require('paypal-rest-sdk');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const axios = require('axios');
const dotenv = require('dotenv');
const url = require('url'); 
const { MongoClient, ServerApiVersion } = require('mongodb'); // CONEXIÓN MONGO

const app = express();

dotenv.config();

const PORT = process.env.PORT || 3000;

// === CONFIGURACIONES ===
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SDK);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore(); // USADO SOLO PARA USUARIOS/PAGOS/SOLICITUDES
const messaging = admin.messaging(); 

paypal.configure({
    'mode': 'sandbox',
    'client_id': process.env.PAYPAL_CLIENT_ID,
    'client_secret': process.env.PAYPAL_CLIENT_SECRET
});

const token = process.env.TELEGRAM_BOT_TOKEN;
const GODSTREAM_API_KEY = process.env.GODSTREAM_API_KEY; 

const RENDER_BACKEND_URL = 'https://serivisios.onrender.com';
const bot = new TelegramBot(token);
const webhookUrl = `${RENDER_BACKEND_URL}/bot${token}`;
bot.setWebHook(webhookUrl);

const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT_ID, 10);
const TMDB_API_KEY = process.env.TMDB_API_KEY;

// === CONFIGURACIÓN DE MONGODB ATLAS ===
// La URI con la contraseña simple que ya funciona (MIMASCOTA o la que elegiste)
const MONGO_URI = process.env.MONGO_URI; 
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'sala_cine'; 

const client = new MongoClient(MONGO_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let mongoDb; 

async function connectToMongo() {
    try {
        await client.connect();
        mongoDb = client.db(MONGO_DB_NAME); 
        console.log(`✅ Conexión a MongoDB Atlas [${MONGO_DB_NAME}] exitosa!`);
    } catch (e) {
        console.error("❌ Error al conectar a MongoDB Atlas:", e);
        process.exit(1);
    }
}

connectToMongo(); 
// === FIN CONFIGURACIÓN DE MONGODB ===


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

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// -------------------------------------------------------------------------
// === RUTA CRÍTICA: MANEJO DE APP LINK Y REDIRECCIÓN DE FALLO ===
// -------------------------------------------------------------------------

app.get('/app/details/:tmdbId', (req, res) => {
    const tmdbId = req.params.tmdbId;
    
    if (process.env.APP_DOWNLOAD_URL) {
        console.log(`App Nativa no instalada. Redirigiendo a la Tienda Personalizada: ${process.env.APP_DOWNLOAD_URL}`);
        return res.redirect(302, process.env.APP_DOWNLOAD_URL);
    }

    if (process.env.TELEGRAM_MINIAPP_URL) {
        const tmaLink = process.env.TELEGRAM_MINIAPP_URL + '?startapp=' + tmdbId;
        console.log('APP_DOWNLOAD_URL no definida. Redirigiendo al fallback de la TMA.');
        return res.redirect(302, tmaLink);
    }

    res.status(404).send('No se encontró la aplicación de destino ni un enlace de descarga.');
});


app.post('/request-movie', async (req, res) => {
    const movieTitle = req.body.title;
    const posterPath = req.body.poster_path;
    const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : 'https://placehold.co/500x750?text=No+Poster';
    
    const tmdbId = req.body.tmdbId;

    const message = `🔔 *Solicitud de película:* ${movieTitle}\n\nUn usuario ha solicitado esta película.`;
    
    try {
        // Usa db.collection('requests') (FIREBASE) ya que es BAJA FRECUENCIA
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
// === RUTA CRÍTICA MODIFICADA: AHORA LEE DE MONGODB (ALTO TRÁFICO) ===
// -----------------------------------------------------------

app.get('/api/get-embed-code', async (req, res) => {
  if (!mongoDb) {
    return res.status(503).json({ error: "Base de datos no disponible." });
  }

  const { id, season, episode, isPro } = req.query;
  
  if (!id) {
    return res.status(400).json({ error: "ID de la película o serie no proporcionado" });
  }

  try {
    const mediaType = season && episode ? 'series' : 'movies';
    // MONGODB: Colecciones de Catálogo
    const collectionName = (mediaType === 'movies') ? 'media_catalog' : 'series_catalog'; 
    
    // MONGODB: Busca el documento por tmdbId (String)
    const doc = await mongoDb.collection(collectionName).findOne({ tmdbId: id });
    
    if (!doc) {
      return res.status(404).json({ error: `${mediaType} no encontrada en el catálogo de Mongo.` });
    }

    const data = doc;
    let embedCode = null;

    if (mediaType === 'movies') {
        embedCode = isPro === 'true' ? data.proEmbedCode : data.freeEmbedCode;
        
        if (isPro === 'true' && embedCode) {
            const fileCode = url.parse(embedCode).pathname.split('-')[1].replace('.html', '');
            const apiUrl = `https://goodstream.one/api/file/direct_link?key=${GODSTREAM_API_KEY}&file_code=${fileCode}`;

            try {
                const godstreamResponse = await axios.get(apiUrl);
                const versions = godstreamResponse.data.resultado.versiones;
                const mp4Url = versions.find(v => v.name === 'h')?.url || versions[0]?.url;

                if (mp4Url) {
                    return res.json({ embedCode: mp4Url });
                }
            } catch (apiError) {
                console.error("Error al obtener enlace directo de GodStream:", apiError);
            }
        }

        if (embedCode) {
            res.json({ embedCode });
        } else {
            res.status(404).json({ error: `No se encontró código de reproductor para esta película.` });
        }
    } else { // series
        let episodeData = data.seasons?.[season]?.episodes?.[episode];
        let embedCode = isPro === 'true' ? episodeData?.proEmbedCode : episodeData?.freeEmbedCode;

        if (isPro === 'true' && embedCode) {
            const fileCode = url.parse(embedCode).pathname.split('-')[1].replace('.html', '');
            const apiUrl = `https://goodstream.one/api/file/direct_link?key=${GODSTREAM_API_KEY}&file_code=${fileCode}`;
            
            try {
                const godstreamResponse = await axios.get(apiUrl);
                const versions = godstreamResponse.data.resultado.versiones;
                const mp4Url = versions.find(v => v.name === 'h')?.url || versions[0]?.url;

                if (mp4Url) {
                    return res.json({ embedCode: mp4Url });
                }
            } catch (apiError) {
                console.error("Error al obtener enlace directo de GodStream para serie:", apiError);
            }
        }

        if (embedCode) {
            res.json({ embedCode });
        } else {
            res.status(404).json({ error: `No se encontró código de reproductor para el episodio ${episode}.` });
        }
    }
  } catch (error) {
    console.error("Error crítico al obtener el código embed:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});


// -----------------------------------------------------------
// === RUTA CRÍTICA MODIFICADA: AHORA ESCRIBE EN MONGODB (CATÁLOGO) ===
// -----------------------------------------------------------

app.post('/add-movie', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    try {
        const { tmdbId, title, poster_path, freeEmbedCode, proEmbedCode, isPremium, overview } = req.body; 

        if (!tmdbId) {
            console.error("Error: Intentando guardar película sin tmdbId.");
            return res.status(400).json({ error: 'tmdbId es requerido para guardar la película.' });
        }
        
        const movieCollection = mongoDb.collection('media_catalog');
        
        const existingMovie = await movieCollection.findOne({ tmdbId: tmdbId.toString() });

        let updateQuery = {};
        let options = { upsert: true };

        if (existingMovie) {
            updateQuery = {
                $set: {
                    title: title,
                    poster_path: poster_path,
                    overview: overview,
                    freeEmbedCode: freeEmbedCode !== undefined ? freeEmbedCode : existingMovie.freeEmbedCode,
                    proEmbedCode: proEmbedCode !== undefined ? proEmbedCode : existingMovie.proEmbedCode,
                    isPremium: isPremium
                }
            };
        } else {
            updateQuery = {
                $set: {
                    tmdbId: tmdbId.toString(),
                    title,
                    poster_path,
                    overview,
                    freeEmbedCode, 
                    proEmbedCode,
                    isPremium
                }
            };
        }
        
        await movieCollection.updateOne({ tmdbId: tmdbId.toString() }, updateQuery, options);
        
        res.status(200).json({ message: 'Película agregada/actualizada en MongoDB Atlas.' });

    } catch (error) {
        console.error("Error al agregar/actualizar película en MongoDB:", error);
        res.status(500).json({ error: 'Error al agregar/actualizar la película en la base de datos.' });
    }
});

// -----------------------------------------------------------
// === RUTA CRÍTICA MODIFICADA: AHORA ESCRIBE EN MONGODB (SERIES) ===
// -----------------------------------------------------------

app.post('/add-series-episode', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    try {
        const { tmdbId, title, poster_path, overview, seasonNumber, episodeNumber, freeEmbedCode, proEmbedCode, isPremium } = req.body;
        
        const seriesCollection = mongoDb.collection('series_catalog');
        
        const episodePath = `seasons.${seasonNumber}.episodes.${episodeNumber}`;

        const updateData = {
            $set: {
                tmdbId: tmdbId.toString(),
                title: title,
                poster_path: poster_path,
                overview: overview,
                isPremium: isPremium,
                [episodePath + '.freeEmbedCode']: freeEmbedCode,
                [episodePath + '.proEmbedCode']: proEmbedCode
            }
        };

        await seriesCollection.updateOne(
            { tmdbId: tmdbId.toString() },
            updateData,
            { upsert: true }
        );
        
        res.status(200).json({ message: `Episodio ${episodeNumber} de la temporada ${seasonNumber} agregado/actualizado en MongoDB Atlas.` });
    
    } catch (error) {
        console.error("Error al agregar/actualizar episodio de serie en MongoDB:", error);
        res.status(500).json({ error: 'Error al agregar/actualizar el episodio de la serie en la base de datos.' });
    }
});


// -----------------------------------------------------------
// === LÓGICA DE BAJO TRÁFICO (MANTENIDA EN FIREBASE) ===
// -----------------------------------------------------------

// Las rutas de PayPal y lógica de usuarios PRO siguen usando Firebase Firestore (db.collection('users'))

app.post('/create-paypal-payment', (req, res) => {
    const plan = req.body.plan;
    const amount = (plan === 'annual') ? '19.99' : '1.99';
    const userId = req.body.userId; 

    const create_payment_json = {
        "intent": "sale",
        "payer": { "payment_method": "paypal" },
        "redirect_urls": {
            "return_url": `${RENDER_BACKEND_URL}/paypal/success`,
            "cancel_url": `${RENDER_BACKEND_URL}/paypal/cancel`
        },
        "transactions": [{
            "amount": { "currency": "USD", "total": amount },
            "description": `Suscripción al plan ${plan} de Sala Cine`,
            "invoice_number": userId 
        }]
    };

    paypal.payment.create(create_payment_json, function (error, payment) {
        if (error) {
            console.error("Error de PayPal:", error.response);
            res.status(500).json({ error: "Error al crear el pago con PayPal." });
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
    const payerId = req.query.PayerID;
    const paymentId = req.query.paymentId;
    
    paypal.payment.execute(paymentId, { "payer_id": payerId }, async function (error, payment) {
        if (error) {
            console.error("Error al ejecutar el pago:", error.response);
            return res.send('<html><body><h1>❌ ERROR: El pago no pudo ser procesado.</h1></body></html>');
        }

        if (payment.state === 'approved' || payment.state === 'completed') {
            const userId = payment.transactions[0].invoice_number; 
            
            if (userId) {
                try {
                    // FIREBASE: Actualiza el estado PRO (Baja Frecuencia)
                    const userDocRef = db.collection('users').doc(userId);
                    await userDocRef.set({ isPro: true }, { merge: true });
                    
                    res.send('<html><body><h1>✅ ¡Pago Exitoso! Cuenta Premium Activada.</h1><p>Vuelve a la aplicación.</p></body></html>');
                } catch (dbError) {
                    console.error("Error al actualizar la base de datos de Firebase:", dbError);
                    res.send('<html><body><h1>⚠️ Advertencia: Pago recibido, pero la cuenta Premium no se activó automáticamente.</h1></body></html>');
                }
            } else {
                 res.send('<html><body><h1>✅ ¡Pago Exitoso! Contacta a soporte para activar tu Premium</h1></body></html>');
            }
        } else {
            res.send('<html><body><h1>❌ ERROR: El pago no fue aprobado.</h1></body></html>');
        }
    });
});

app.get('/paypal/cancel', (req, res) => {
    res.send('<html><body><h1>Pago con PayPal cancelado.</h1></body></html>');
});


// -----------------------------------------------------------
// === CÓDIGO DEL BOT DE TELEGRAM (CON BÚSQUEDA CORREGIDA A MONGO) ===
// -----------------------------------------------------------

// FUNCIÓN DE AYUDA: Lógica para publicar en canales (se mantiene)
async function publishMovieToChannels(movieData) {
    // ... (Tu lógica de publicación) ...
    return { success: true }; // Simulación
}
async function publishSeriesEpisodeToChannels(seriesData) {
    // ... (Tu lógica de publicación) ...
    return { success: true }; // Simulación
}

// FUNCIÓN DE AYUDA: Lógica para enviar notificación push (se mantiene)
async function sendPushNotification(tmdbId, mediaType, contentTitle) {
    // ... (Tu lógica de notificación push) ...
    return { success: true, message: "No hay tokens de dispositivos registrados." }; // Simulación
}


bot.onText(/\/start|\/subir/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_CHAT_ID) return;
    adminState[chatId] = { step: 'menu' };
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Agregar películas', callback_data: 'add_movie' }],
                [{ text: 'Agregar series', callback_data: 'add_series' }],
                [{ text: 'Eventos', callback_data: 'eventos' }],
                [{ text: 'Gestionar películas', callback_data: 'manage_movies' }],
                [{ text: 'Eliminar película', callback_data: 'delete_movie' }]
            ]
        }
    };
    bot.sendMessage(chatId, '¡Hola! ¿Qué quieres hacer hoy?', options);
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
                    // === CAMBIO CRÍTICO: BÚSQUEDA DE EXISTENCIA EN MONGODB ===
                    // USAR MONGODB PARA CHEQUEAR SI YA EXISTE LA PELÍCULA
                    const existingMovie = await mongoDb.collection('media_catalog').findOne({ tmdbId: item.id.toString() });
                    const existingData = existingMovie || null;
                    // === FIN CAMBIO CRÍTICO ===
                    
                    const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                    const title = item.title || item.name;
                    const date = item.release_date || item.first_air_date;
                    const message = `🎬 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${item.overview || 'Sin sinopsis disponible.'}`;
                    
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
                    // === CAMBIO CRÍTICO: BÚSQUEDA DE EXISTENCIA EN MONGODB ===
                    const existingSeries = await mongoDb.collection('series_catalog').findOne({ tmdbId: item.id.toString() });
                    const existingData = existingSeries || null;
                    // === FIN CAMBIO CRÍTICO ===

                    const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                    const title = item.title || item.name;
                    const date = item.first_air_date;
                    const message = `🎬 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${item.overview || 'Sin sinopsis disponible.'}`;
                    
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
    // ... (El resto de handlers de mensajes se mantiene igual) ...
    }
});


// ... (El resto de la lógica de callback_query se mantiene igual) ...

// === ÚLTIMA FUNCIÓN (PARA NO DAÑAR TU CÓDIGO) ===
app.get('/api/app-update', (req, res) => {
    // CRÍTICO: latest_version_code DEBE coincidir con el versionCode del APK más reciente (en tu caso, 2)
    const updateInfo = {
        "latest_version_code": 4, 
        "update_url": "https://google-play.onrender.com", // <-- TU PÁGINA DE TIENDA
        "force_update": true, // <--- TRUE: Obliga a actualizar
        "update_message": "¡Tenemos una nueva versión (1.4) con TV en vivo y mejoras! Presiona 'Actualizar Ahora' para ir a la tienda de descarga."
    };
    
    res.status(200).json(updateInfo);
});


app.get('/.well-known/assetlinks.json', (req, res) => {
    res.sendFile('assetlinks.json', { root: __dirname });
});

// === CÓDIGO ORIGINAL QUE DEBE VENIR DESPUÉS ===
app.listen(PORT, () => {
    console.log(`Servidor de backend de Sala Cine iniciado en el puerto ${PORT}`);
});
