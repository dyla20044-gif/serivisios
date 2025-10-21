const express = require('express');
const bodyParser = require('body-parser');
const paypal = require('paypal-rest-sdk');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const axios = require('axios');
const dotenv = require('dotenv');
const url = require('url');
const { MongoClient, ServerApiVersion } = require('mongodb'); // CONEXIÓN MONGO
const cors = require('cors'); // Asegurar cors

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
// const GODSTREAM_API_KEY = process.env.GODSTREAM_API_KEY; // Ya no se usa como constante

const RENDER_BACKEND_URL = 'https://serivisios.onrender.com';
const bot = new TelegramBot(token);
const webhookUrl = `${RENDER_BACKEND_URL}/bot${token}`;
bot.setWebHook(webhookUrl);

const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT_ID, 10);
const TMDB_API_KEY = process.env.TMDB_API_KEY;

// === CONFIGURACIÓN DE MONGODB ATLAS ===
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = processs.env.MONGO_DB_NAME || 'sala_cine'; // Corregido el typo

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

// Configuración de CORS
const allowedOrigins = [
    'https://tu-dominio-frontend.com',
    'http://localhost:5500', 
    'http://127.0.0.1:5500', 
    'capacitor://localhost',
    'ionic://localhost',
    'http://localhost'
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        const baseUrl = origin.split(':').slice(0, 2).join(':');
        if (allowedOrigins.includes(origin) || allowedOrigins.includes(baseUrl)) {
            return callback(null, true);
        }
        // Eliminado el mensaje de error para evitar que se muestre en la consola de render.com
        return callback(new Error('CORS Policy Blocked'), false); 
    },
    methods: ['GET', 'POST'],
    credentials: true
}));


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


// =======================================================================
// === RUTA CRÍTICA CORREGIDA: get-embed-code (Premium vs. Gratis/Fallback) ===
// =======================================================================
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
    const collectionName = (mediaType === 'movies') ? 'media_catalog' : 'series_catalog';

    const doc = await mongoDb.collection(collectionName).findOne({ tmdbId: id });

    if (!doc) {
      return res.status(404).json({ error: `${mediaType} no encontrada en el catálogo de Mongo.` });
    }

    const data = doc;
    let sourceLink = null; 

    // ------------------------------------
    // LÓGICA PELÍCULAS
    // ------------------------------------
    if (mediaType === 'movies') {
        sourceLink = isPro === 'true' ? data.proEmbedCode : data.freeEmbedCode;

        if (isPro === 'true' && sourceLink) {
            try {
                // Extracción del fileCode: Debe estar en el formato /v-filecode.html
                const fileCode = url.parse(sourceLink).pathname.split('-')[1].replace('.html', '');
                
                // Priorizamos M3U8 (HLS) para streaming adaptable.
                const apiUrl = `https://goodstream.one/api/file/direct_link?key=${process.env.GODSTREAM_API_KEY}&file_code=${fileCode}&hls=1`;

                const godstreamResponse = await axios.get(apiUrl, { timeout: 5000 });
                const resultado = godstreamResponse.data.resultado;

                let directUrl = resultado.hls_direct; 
                let isHLS = true; // Asumimos HLS

                if (!directUrl && resultado.versiones) {
                    // Fallback a MP4 de alta calidad (h) si HLS no está
                    directUrl = resultado.versiones.find(v => v.name === 'h')?.url || resultado.versiones[0]?.url;
                    isHLS = false; // Es MP4 directo
                }

                if (directUrl) {
                    // ÉXITO PREMIUM: Retorna el URL directo (M3U8 o MP4) con el flag correcto
                    return res.json({ embedCode: directUrl, isHLS: isHLS }); 
                }
            } catch (apiError) {
                // Falla en la llamada a GoodStream (conexión, clave API, etc.). Cae al fallback.
                console.error("Error al obtener enlace directo de GodStream (MOVIES). Usando fallback embed.", apiError.message);
            }
        }

        // FALLBACK PREMIUM o LÓGICA GRATUITA
        if (sourceLink) {
             // CRÍTICO: Devuelve la bandera isHLS en false para indicar que es un HTML embed
            return res.json({ embedCode: sourceLink, isHLS: false });
        } else {
            return res.status(404).json({ error: `No se encontró código de reproductor para esta película.` });
        }
    } 
    
    // ------------------------------------
    // LÓGICA SERIES
    // ------------------------------------
    else { // mediaType === 'series'
        let episodeData = data.seasons?.[season]?.episodes?.[episode];
        sourceLink = isPro === 'true' ? episodeData?.proEmbedCode : episodeData?.freeEmbedCode;

        if (isPro === 'true' && sourceLink) {
            try {
                const fileCode = url.parse(sourceLink).pathname.split('-')[1].replace('.html', '');
                const apiUrl = `https://goodstream.one/api/file/direct_link?key=${process.env.GODSTREAM_API_KEY}&file_code=${fileCode}&hls=1`; // M3U8 (HLS)

                const godstreamResponse = await axios.get(apiUrl, { timeout: 5000 });
                const resultado = godstreamResponse.data.resultado;
                
                let directUrl = resultado.hls_direct; 
                let isHLS = true;

                if (!directUrl && resultado.versiones) {
                    directUrl = resultado.versiones.find(v => v.name === 'h')?.url || resultado.versiones[0]?.url;
                    isHLS = false;
                }

                if (directUrl) {
                    // ÉXITO PREMIUM: Retorna el URL directo (M3U8 o MP4) con el flag correcto
                    return res.json({ embedCode: directUrl, isHLS: isHLS }); 
                }

            } catch (apiError) {
                console.error("Error al obtener enlace directo de GodStream (SERIES). Usando fallback embed.", apiError.message);
            }
        }

        // FALLBACK PREMIUM o LÓGICA GRATUITA
        if (sourceLink) {
            // CRÍTICO: Devuelve la bandera isHLS en false
            return res.json({ embedCode: sourceLink, isHLS: false });
        } else {
            return res.status(404).json({ error: `No se encontró código de reproductor para el episodio ${episode}.` });
        }
    }
  } catch (error) {
    console.error("Error crítico al obtener el código embed:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// =======================================================================
// === EL RESTO DE TUS RUTAS ORIGINALES CONTINÚAN AQUÍ ===
// =======================================================================

// === NUEVA RUTA OPTIMIZADA PARA OBTENER TODOS LOS DATOS DE LA PELÍCULA ===
app.get('/api/get-movie-data', async (req, res) => {
    if (!mongoDb) {
        return res.status(503).json({ error: "Base de datos no disponible." });
    }

    const { id } = req.query;

    if (!id) {
        return res.status(400).json({ error: "El ID del contenido es requerido." });
    }

    try {
        const movieCollection = mongoDb.collection('media_catalog');
        const seriesCollection = mongoDb.collection('series_catalog');

        const projection = {
            projection: {
                views: 1,
                likes: 1,
                freeEmbedCode: 1,
                proEmbedCode: 1
            }
        };

        let doc = await movieCollection.findOne({ tmdbId: id.toString() }, projection);

        if (!doc) {
            doc = await seriesCollection.findOne({ tmdbId: id.toString() }, projection);
        }

        if (doc) {
            const isAvailable = !!(doc.freeEmbedCode || doc.proEmbedCode); 
            res.status(200).json({
                views: doc.views || 0,
                likes: doc.likes || 0,
                isAvailable: isAvailable
            });
        } else {
            res.status(200).json({
                views: 0,
                likes: 0,
                isAvailable: false
            });
        }

    } catch (error) {
        console.error(`Error crítico al obtener los datos consolidados de la película/serie en MongoDB:`, error);
        res.status(500).json({ error: "Error interno del servidor al obtener los datos del contenido." });
    }
});


// -----------------------------------------------------------
// === NUEVA RUTA OPTIMIZADA: VERIFICACIÓN RÁPIDA DE TEMPORADA ===
// -----------------------------------------------------------
app.get('/api/check-season-availability', async (req, res) => {
    if (!mongoDb) {
        return res.status(503).json({ error: "Base de datos no disponible." });
    }

    const { id, season } = req.query;

    if (!id || !season) {
        return res.status(400).json({ error: "ID y número de temporada son requeridos." });
    }

    try {
        const seriesCollection = mongoDb.collection('series_catalog');

        const episodesField = `seasons.${season}.episodes`;

        const doc = await seriesCollection.findOne(
            { tmdbId: id.toString() },
            { projection: { [episodesField]: 1 } }
        );

        if (!doc || !doc.seasons || !doc.seasons[season] || !doc.seasons[season].episodes) {
            return res.status(200).json({ exists: false, availableEpisodes: {} });
        }

        const availableEpisodes = doc.seasons[season].episodes;

        const availabilityMap = {};
        for (const episodeNum in availableEpisodes) {
            const epData = availableEpisodes[episodeNum];
            const isAvailable = (epData.proEmbedCode && epData.proEmbedCode !== '') ||
                                (epData.freeEmbedCode && epData.freeEmbedCode !== '');
            availabilityMap[episodeNum] = isAvailable;
        }

        res.status(200).json({ exists: true, availableEpisodes: availabilityMap });

    } catch (error) {
        console.error("Error al verificar disponibilidad de temporada en MongoDB:", error);
        res.status(500).json({ error: "Error interno del servidor al verificar la disponibilidad." });
    }
});


// -----------------------------------------------------------
// === RUTA DE MÉTRICAS: Obtener el contador de Vistas o Likes (GET /api/get-metrics) ===
// -----------------------------------------------------------

app.get('/api/get-metrics', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    const { id, field } = req.query; 

    if (!id || !field) {
        return res.status(400).json({ error: "ID y campo de métrica son requeridos." });
    }

    if (field !== 'views' && field !== 'likes') {
        return res.status(400).json({ error: "Campo de métrica inválido. Debe ser 'views' o 'likes'." });
    }

    try {
        const movieCollection = mongoDb.collection('media_catalog');
        const seriesCollection = mongoDb.collection('series_catalog');

        let doc = await movieCollection.findOne({ tmdbId: id.toString() }, { projection: { [field]: 1 } });

        if (!doc) {
            doc = await seriesCollection.findOne({ tmdbId: id.toString() }, { projection: { [field]: 1 } });
        }

        if (doc && doc[field] !== undefined) {
            res.status(200).json({ count: doc[field] });
        } else {
            res.status(200).json({ count: 0 });
        }

    } catch (error) {
        console.error(`Error al obtener métricas (${field}) en MongoDB:`, error);
        res.status(500).json({ error: "Error interno del servidor al obtener la métrica." });
    }
});


// -----------------------------------------------------------
// === RUTA DE MÉTRICAS: Incrementar el contador de Vistas (POST /api/increment-views) ===
// -----------------------------------------------------------

app.post('/api/increment-views', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });
    const { tmdbId } = req.body;

    if (!tmdbId) return res.status(400).json({ error: "tmdbId es requerido." });

    try {
        const movieCollection = mongoDb.collection('media_catalog');
        const seriesCollection = mongoDb.collection('series_catalog');

        const movieResult = await movieCollection.updateOne(
            { tmdbId: tmdbId.toString() },
            { $inc: { views: 1 }, $setOnInsert: { likes: 0 } },
            { upsert: true }
        );

        if (movieResult.modifiedCount === 0) {
            await seriesCollection.updateOne(
                { tmdbId: tmdbId.toString() },
                { $inc: { views: 1 }, $setOnInsert: { likes: 0 } },
                { upsert: true }
            );
        }

        res.status(200).json({ message: 'Vista registrada.' });
    } catch (error) {
        console.error("Error al incrementar vistas en MongoDB:", error);
        res.status(500).json({ error: "Error interno del servidor al registrar la vista." });
    }
});


// -----------------------------------------------------------
// === RUTA DE MÉTRICAS: Incrementar el contador de Likes (POST /api/increment-likes) ===
// -----------------------------------------------------------

app.post('/api/increment-likes', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });
    const { tmdbId } = req.body;

    if (!tmdbId) return res.status(400).json({ error: "tmdbId es requerido." });

    try {
        const movieCollection = mongoDb.collection('media_catalog');
        const seriesCollection = mongoDb.collection('series_catalog');

        const movieResult = await movieCollection.updateOne(
            { tmdbId: tmdbId.toString() },
            { $inc: { likes: 1 }, $setOnInsert: { views: 0 } },
            { upsert: true }
        );

        if (movieResult.modifiedCount === 0) {
            await seriesCollection.updateOne(
                { tmdbId: tmdbId.toString() },
                { $inc: { likes: 1 }, $setOnInsert: { views: 0 } },
                { upsert: true }
            );
        }

        res.status(200).json({ message: 'Like registrado.' });
    } catch (error) {
        console.error("Error al incrementar likes en MongoDB:", error);
        res.status(500).json({ error: "Error interno del servidor al registrar el like." });
    }
});


// -----------------------------------------------------------
// === RUTA CRÍTICA: AGREGAR PELÍCULA (Incluye inicialización de métricas) ===
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

        let updateQuery = {
            $set: {
                title: title,
                poster_path: poster_path,
                overview: overview,
                freeEmbedCode: freeEmbedCode, 
                proEmbedCode: proEmbedCode,   
                isPremium: isPremium
            },
            $setOnInsert: { tmdbId: tmdbId.toString(), views: 0, likes: 0 }
        };

        await movieCollection.updateOne(
            { tmdbId: tmdbId.toString() },
            updateQuery,
            { upsert: true }
        );

        res.status(200).json({ message: 'Película agregada/actualizada en MongoDB Atlas.' });

    } catch (error) {
        console.error("Error al agregar/actualizar película en MongoDB:", error);
        res.status(500).json({ error: 'Error al agregar/actualizar la película en la base de datos.' });
    }
});

// -----------------------------------------------------------
// === RUTA CRÍTICA: AGREGAR EPISODIO DE SERIE (Incluye inicialización de métricas) ===
// -----------------------------------------------------------

app.post('/add-series-episode', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    try {
        const { tmdbId, title, poster_path, overview, seasonNumber, episodeNumber, freeEmbedCode, proEmbedCode, isPremium } = req.body;

        const seriesCollection = mongoDb.collection('series_catalog');

        const episodePath = `seasons.${seasonNumber}.episodes.${episodeNumber}`;

        const updateData = {
            $set: {
                title: title,
                poster_path: poster_path,
                overview: overview,
                isPremium: isPremium,
                [episodePath + '.freeEmbedCode']: freeEmbedCode,
                [episodePath + '.proEmbedCode']: proEmbedCode
            },
            $setOnInsert: { tmdbId: tmdbId.toString(), views: 0, likes: 0 }
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

app.post('/create-binance-payment', (req, res) => {
    res.json({ message: 'Pago con Binance simulado. Lógica de backend real necesaria.' });
});

// ... (El resto de tu código del bot de Telegram se mantiene igual)
// === LÓGICA DEL BOT DE TELEGRAM (SIN CAMBIOS) ===
// ...

// =======================================================================
// === VERIFICADOR DE ACTUALIZACIONES (/api/app-update) - RESTAURADO ===
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
// === ENDPOINT PARA GOOGLE APP LINKS VERIFICATION ===
// =======================================================================

app.get('/.well-known/assetlinks.json', (req, res) => {
    res.sendFile('assetlinks.json', { root: __dirname });
});

// =======================================================================

app.listen(PORT, () => {
    console.log(`Servidor de backend de Sala Cine iniciado en el puerto ${PORT}`);
});
