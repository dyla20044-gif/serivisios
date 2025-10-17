const express = require('express');
const bodyParser = require('body-parser');
const paypal = require('paypal-rest-sdk');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const axios = require('axios');
const dotenv = require('dotenv');
const url = require('url'); 
const { MongoClient, ServerApiVersion } = require('mongodb'); // <<< NUEVO: Dependencia de MongoDB

const app = express();

dotenv.config();

const PORT = process.env.PORT || 3000;

// === CONFIGURACIONES DE FIREBASE (Mantenido para Auth y Pagos) ===
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
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'sala_cine'; // Usar variable de entorno o 'sala_cine' por defecto

const client = new MongoClient(MONGO_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let mongoDb; // Objeto de base de datos de MongoDB

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
        const { tmdbId, title, poster_path, freeEmbedCode, proEmbedCode, isPremium, overview } = req.body; // Añadir overview

        if (!tmdbId) {
            console.error("Error: Intentando guardar película sin tmdbId.");
            return res.status(400).json({ error: 'tmdbId es requerido para guardar la película.' });
        }
        
        // MONGODB: Colección de Catálogo
        const movieCollection = mongoDb.collection('media_catalog');
        
        // MONGODB: Buscar la película existente por tmdbId (String)
        const existingMovie = await movieCollection.findOne({ tmdbId: tmdbId.toString() });

        let updateQuery = {};
        let options = { upsert: true };

        if (existingMovie) {
            // Si la película existe, actualizamos los campos
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
            // Si la película no existe, la creamos
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
        
        // MONGODB: Usar updateOne con upsert para crear o actualizar de forma atómica
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
        
        // MONGODB: Colección de Catálogo
        const seriesCollection = mongoDb.collection('series_catalog');
        
        // MONGODB: El identificador del episodio que se va a actualizar
        const episodePath = `seasons.${seasonNumber}.episodes.${episodeNumber}`;

        const updateData = {
            $set: {
                tmdbId: tmdbId.toString(),
                title: title,
                poster_path: poster_path,
                overview: overview,
                isPremium: isPremium,
                // MONGODB: Usar notación de punto para actualizar solo el episodio específico
                [episodePath + '.freeEmbedCode']: freeEmbedCode,
                [episodePath + '.proEmbedCode']: proEmbedCode
            }
        };

        // MONGODB: Usar updateOne con upsert para crear o actualizar de forma atómica
        await seriesCollection.updateOne(
            { tmdbId: tmdbId.toString() },
            updateData,
            { upsert: true } // Crea la serie si no existe
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

// ... Rutas de PayPal (success/cancel) y el Bot de Telegram (pedidos) permanecen sin cambios
// ... porque usan Firestore para una sola escritura/lectura y no generan alto tráfico.

// === MODIFICADO: Envía el userId a PayPal ===
app.post('/create-paypal-payment', (req, res) => {
    // ... (Mantenemos esta ruta en el servidor de Render)
    const plan = req.body.plan;
    const amount = (plan === 'annual') ? '19.99' : '1.99';
    const userId = req.body.userId; 

    // ... (Lógica de PayPal.payment.create) ...
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
    // ... (Mantenemos esta ruta en el servidor de Render, usando Firestore para 'users')
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
                    // FIREBASE: Actualiza el estado PRO
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

// -----------------------------------------------------------
// === LÓGICA DE TELEGRAM BOT (Ajustada para MongoDB) ===
// -----------------------------------------------------------

// LÓGICA DEL BOT DE TELEGRAM (Solo las partes que gestionan el guardado/edición de contenido)

bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = msg.chat.id;

    // ... (MANTENER toda la lógica de /pedidos, /subir, /editar, etc.)

    if (data.startsWith('add_new_movie_')) {
        // ... (Lógica de TMDB) ...
    } else if (data.startsWith('add_new_series_')) {
        // ... (Lógica de TMDB) ...
    }
    
    // ... (Otras lógicas de navegación del bot) ...


    // === CAMBIO CRÍTICO: LÓGICA DE GUARDAR PELÍCULA ===
    else if (data.startsWith('save_only_')) {
        const { movieDataToSave } = adminState[chatId];
        try {
            if (!movieDataToSave || !movieDataToSave.tmdbId) throw new Error("Datos de película incompletos o tmdbId faltante.");
            
            // LLAMA AL NUEVO ENDPOINT (QUE USA MONGODB)
            await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
            
            bot.sendMessage(chatId, `✅ Película "${movieDataToSave.title}" guardada con éxito en la app (MongoDB).`);
            adminState[chatId] = { step: 'menu' };
        } catch (error) {
            console.error("Error al guardar la película:", error);
            bot.sendMessage(chatId, 'Hubo un error al guardar la película.');
            adminState[chatId] = { step: 'menu' };
        }
    } else if (data.startsWith('save_and_publish_')) {
        const { movieDataToSave } = adminState[chatId];
        try {
            if (!movieDataToSave || !movieDataToSave.tmdbId) throw new Error("Datos de película incompletos o tmdbId faltante.");
            
            // LLAMA AL NUEVO ENDPOINT (QUE USA MONGODB)
            await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
            bot.sendMessage(chatId, `✅ Película "${movieDataToSave.title}" guardada con éxito en la app (MongoDB).`);
            
            await publishMovieToChannels(movieDataToSave);
            
            adminState[chatId] = { step: 'menu' };
        } catch (error) {
            console.error("Error al guardar/publicar la película:", error);
            bot.sendMessage(chatId, 'Hubo un error al guardar o publicar la película. Revisa el estado de la película y reinicia con /subir.');
            adminState[chatId] = { step: 'menu' };
        }
    } 
    // === CAMBIO CRÍTICO: LÓGICA DE GUARDAR SERIE ===
    else if (data.startsWith('save_and_publish_series_')) {
        const { selectedSeries, season, episode, proEmbedCode, freeEmbedCode } = adminState[chatId];
        try {
            if (!selectedSeries || !selectedSeries.tmdbId) throw new Error("Datos de la serie incompletos o tmdbId faltante.");
            
            const seriesDataToSave = {
                tmdbId: selectedSeries.tmdbId, 
                title: selectedSeries.title || selectedSeries.name,
                overview: selectedSeries.overview,
                poster_path: selectedSeries.poster_path,
                seasonNumber: season,
                episodeNumber: episode,
                proEmbedCode: proEmbedCode,
                freeEmbedCode: freeEmbedCode,
                isPremium: !!proEmbedCode && !freeEmbedCode
            };

            // LLAMA AL NUEVO ENDPOINT (QUE USA MONGODB)
            await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, seriesDataToSave);
            bot.sendMessage(chatId, `✅ Episodio ${seriesDataToSave.episodeNumber} de la temporada ${seriesDataToSave.seasonNumber} guardado y publicado con éxito (MongoDB).`);
            
            // ... (Resto de la lógica de publicación y botones) ...
            await publishSeriesEpisodeToChannels(seriesDataToSave);

            // ... (Lógica de botones siguiente episodio) ...
            // (Esta lógica debe permanecer para que el bot siga funcionando)
            
            // ... (código que crea el botón siguiente) ...
            adminState[chatId] = { step: 'awaiting_series_action' };
        } catch (error) {
            console.error("Error al guardar/publicar el episodio:", error);
            bot.sendMessage(chatId, 'Hubo un error al guardar o publicar el episodio.');
            adminState[chatId] = { step: 'menu' };
        }
    } 
    // ... (El resto de la lógica de callback_query se mantiene igual) ...
});


// ... (MANTENER todas las funciones auxiliares de Telegram, como publishMovieToChannels) ...

// =======================================================================
// === NUEVA FUNCIÓN: VERIFICADOR DE ACTUALIZACIONES (/api/app-update) ===
// =======================================================================

app.get('/api/app-update', (req, res) => {
  const updateInfo = {
    "latest_version_code": 4, 
    "update_url": "https://google-play.onrender.com", 
    "force_update": true, 
    "update_message": "¡Tenemos una nueva versión (1.4) con TV en vivo y mejoras! Presiona 'Actualizar Ahora' para ir a la tienda de descarga."
  };
  
  res.status(200).json(updateInfo);
});

// =======================================================================

app.listen(PORT, () => {
    console.log(`Servidor de backend de Sala Cine iniciado en el puerto ${PORT}`);
});
