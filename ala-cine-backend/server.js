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


// =======================================================================
// === NUEVA RUTA OPTIMIZADA PARA OBTENER TODOS LOS DATOS DE LA PELÍCULA ===
// =======================================================================
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

        // Definimos los campos que necesitamos para minimizar la transferencia de datos
        const projection = {
            projection: {
                views: 1,
                likes: 1,
                freeEmbedCode: 1,
                proEmbedCode: 1
            }
        };

        // 1. Buscamos primero en la colección de películas
        let doc = await movieCollection.findOne({ tmdbId: id.toString() }, projection);

        // 2. Si no se encuentra, buscamos en la colección de series
        if (!doc) {
            doc = await seriesCollection.findOne({ tmdbId: id.toString() }, projection);
        }

        // 3. Construimos la respuesta
        if (doc) {
            const isAvailable = !!(doc.freeEmbedCode || doc.proEmbedCode); // Es true si existe cualquiera de los dos enlaces
            res.status(200).json({
                views: doc.views || 0,
                likes: doc.likes || 0,
                isAvailable: isAvailable
            });
        } else {
            // Si el documento no existe en ninguna colección, devolvemos valores por defecto
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
            
            // ============ INICIO DE CORRECCIÓN (TypeError 1 y 2) ============
            const pathname = url.parse(embedCode).pathname || ''; // FIX: Obtener pathname de forma segura
            const parts = pathname.split('-');
            let fileCode = null;

            // FIX: Extraer fileCode de forma segura (maneja /v-XXXX.html y /XXXX.html)
            if (parts.length > 1) {
                fileCode = parts[parts.length - 1].replace('.html', ''); // Obtiene la última parte
            } else if (pathname.endsWith('.html')) {
                fileCode = pathname.replace('/', '').replace('.html', ''); // Maneja rutas sin guion
            }
            
            if (fileCode) { // Solo continuar si encontramos un fileCode
                const apiUrl = `https://goodstream.one/api/file/direct_link?key=${process.env.GODSTREAM_API_KEY}&file_code=${fileCode}`;

                try {
                    const godstreamResponse = await axios.get(apiUrl);
                    
                    // FIX: Validar que la respuesta de GodStream es exitosa antes de acceder a 'versiones'
                    if (godstreamResponse.data && godstreamResponse.data.resultado && godstreamResponse.data.resultado.versiones) {
                        const versions = godstreamResponse.data.resultado.versiones;
                        const mp4Url = versions.find(v => v.name === 'h')?.url || versions[0]?.url;

                        if (mp4Url) {
                            return res.json({ embedCode: mp4Url });
                        }
                    } else {
                        console.error("Respuesta inesperada de GodStream (Movie):", godstreamResponse.data);
                    }
                } catch (apiError) {
                    // Usar .message para un log más limpio
                    console.error("Error al obtener enlace directo de GodStream (Movie):", apiError.message);
                }
            } else {
                console.error("No se pudo extraer el fileCode del embedCode (Movie):", embedCode);
            }
            // ============ FIN DE CORRECCIÓN ============
        }

        if (embedCode) {
            // Fallback: Si la API de GodStream falló o no era 'pro', se envía el embed original
            res.json({ embedCode });
        } else {
            res.status(404).json({ error: `No se encontró código de reproductor para esta película.` });
        }
    } else { // series
        let episodeData = data.seasons?.[season]?.episodes?.[episode];
        let embedCode = isPro === 'true' ? episodeData?.proEmbedCode : episodeData?.freeEmbedCode;

        if (isPro === 'true' && embedCode) {

            // ============ INICIO DE CORRECCIÓN (TypeError 1 y 2) - SERIES ============
            const pathname = url.parse(embedCode).pathname || ''; // FIX: Obtener pathname de forma segura
            const parts = pathname.split('-');
            let fileCode = null;

            // FIX: Extraer fileCode de forma segura (maneja /v-XXXX.html y /XXXX.html)
            if (parts.length > 1) {
                fileCode = parts[parts.length - 1].replace('.html', ''); // Obtiene la última parte
            } else if (pathname.endsWith('.html')) {
                fileCode = pathname.replace('/', '').replace('.html', ''); // Maneja rutas sin guion
            }
            
            if (fileCode) { // Solo continuar si encontramos un fileCode
                const apiUrl = `https://goodstream.one/api/file/direct_link?key=${process.env.GODSTREAM_API_KEY}&file_code=${fileCode}`;

                try {
                    const godstreamResponse = await axios.get(apiUrl);

                    // FIX: Validar que la respuesta de GodStream es exitosa antes de acceder a 'versiones'
                    if (godstreamResponse.data && godstreamResponse.data.resultado && godstreamResponse.data.resultado.versiones) {
                        const versions = godstreamResponse.data.resultado.versiones;
                        const mp4Url = versions.find(v => v.name === 'h')?.url || versions[0]?.url;

                        if (mp4Url) {
                            return res.json({ embedCode: mp4Url });
                        }
                    } else {
                         console.error("Respuesta inesperada de GodStream (Series):", godstreamResponse.data);
                    }
                } catch (apiError) {
                    console.error("Error al obtener enlace directo de GodStream para serie:", apiError.message);
                }
            } else {
                console.error("No se pudo extraer el fileCode del embedCode (Series):", embedCode);
            }
            // ============ FIN DE CORRECCIÓN ============
        }

        if (embedCode) {
            // Fallback: Si la API de GodStream falló o no era 'pro', se envía el embed original
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
// === NUEVA RUTA OPTIMIZADA: VERIFICACIÓN RÁPIDA DE TEMPORADA ===
// -----------------------------------------------------------
/**
 * Nueva ruta para verificar la disponibilidad de todos los episodios de una temporada
 * con una sola consulta a MongoDB.
 * Endpoint: GET /api/check-season-availability?id={tmdbId}&season={seasonNumber}
 * Devuelve: { exists: boolean, totalEpisodes: number }
 */
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

        // 1. Definir el campo de proyección para obtener solo los episodios de la temporada específica
        const episodesField = `seasons.${season}.episodes`;

        // 2. Realizar la consulta a MongoDB
        const doc = await seriesCollection.findOne(
            { tmdbId: id.toString() },
            { projection: { [episodesField]: 1 } }
        );

        if (!doc || !doc.seasons || !doc.seasons[season] || !doc.seasons[season].episodes) {
            // El documento de la serie existe, pero la temporada o los episodios no.
            return res.status(200).json({ exists: false, availableEpisodes: {} });
        }

        const availableEpisodes = doc.seasons[season].episodes;

        // 3. Procesar los episodios encontrados y determinar si hay algún enlace (PRO o GRATIS)
        const availabilityMap = {};
        for (const episodeNum in availableEpisodes) {
            const epData = availableEpisodes[episodeNum];
            // Si existe proEmbedCode O freeEmbedCode, consideramos que el episodio está DISPONIBLE
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

    const { id, field } = req.query; // field can be 'views' or 'likes'

    if (!id || !field) {
        return res.status(400).json({ error: "ID y campo de métrica son requeridos." });
    }

    if (field !== 'views' && field !== 'likes') {
        return res.status(400).json({ error: "Campo de métrica inválido. Debe ser 'views' o 'likes'." });
    }

    try {
        const movieCollection = mongoDb.collection('media_catalog');
        const seriesCollection = mongoDb.collection('series_catalog');

        // 1. Buscar en películas
        let doc = await movieCollection.findOne({ tmdbId: id.toString() }, { projection: { [field]: 1 } });

        // 2. Si no es película, buscar en series
        if (!doc) {
            doc = await seriesCollection.findOne({ tmdbId: id.toString() }, { projection: { [field]: 1 } });
        }

        // Devolvemos el valor encontrado o 0 si el campo no existe.
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

        // Intentar actualizar como película (usa upsert: true para inicializar 'views' si no existe)
        const movieResult = await movieCollection.updateOne(
            { tmdbId: tmdbId.toString() },
            { $inc: { views: 1 }, $setOnInsert: { likes: 0 } },
            { upsert: true }
        );

        // Si no es una película, intentar actualizar como serie
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

        // Intentar actualizar como película (usa upsert: true para inicializar 'likes' si no existe)
        const movieResult = await movieCollection.updateOne(
            { tmdbId: tmdbId.toString() },
            { $inc: { likes: 1 }, $setOnInsert: { views: 0 } },
            { upsert: true }
        );

        // Si no es una película, intentar actualizar como serie
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
        res.status(5E0).json({ error: "Error interno del servidor al registrar el like." });
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
                freeEmbedCode: freeEmbedCode, // Se actualiza siempre, si es null, se guarda null
                proEmbedCode: proEmbedCode,   // Se actualiza siempre
                isPremium: isPremium
            },
            // CRÍTICO: Inicializar métricas si es un nuevo documento (upsert)
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
            // CRÍTICO: Inicializar métricas y otros campos si es un nuevo documento (upsert)
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

app.post('/create-binance-payment', (req, res) => {
    res.json({ message: 'Pago con Binance simulado. Lógica de backend real necesaria.' });
});

// =======================================================================
// === INICIO: LÓGICA DEL BOT (IMPORTADA DE SERVER14.JS) ===
// =======================================================================

// -----------------------------------------------------------
// === INICIO DE NUEVAS FUNCIONES Y ENDPOINT DE NOTIFICACIÓN PUSH ===
// -----------------------------------------------------------

async function sendPushNotification(tmdbId, mediaType, contentTitle) {
    try {
        const tokensSnapshot = await db.collection('users').select('fcmToken').get();
        const registrationTokens = tokensSnapshot.docs
            .map(doc => doc.data().fcmToken)
            .filter(token => token); 

        if (registrationTokens.length === 0) {
            console.log("No se encontraron tokens FCM para enviar notificaciones.");
            return { success: true, message: "No hay tokens de dispositivos registrados." };
        }

        const message = {
            notification: {
                title: `🎉 ¡Nuevo Contenido Agregado!`,
                body: `¡Ya puedes ver ${contentTitle} en Sala Cine!`,
            },
            data: {
                tmdbId: tmdbId.toString(), 
                mediaType: mediaType,
                action: 'open_content' 
            },
            tokens: registrationTokens
        };

        const response = await messaging.sendEachForMulticast(message);
        console.log('Notificación FCM enviada con éxito:', response.successCount);
        return { success: true, response: response };

    } catch (error) {
        console.error("Error al enviar notificación FCM:", error);
        return { success: false, error: error.message };
    }
}

app.post('/api/notify', async (req, res) => {
    const { tmdbId, mediaType, title } = req.body;
    
    if (!tmdbId || !mediaType || !title) {
        return res.status(400).json({ error: "Faltan parámetros: tmdbId, mediaType, o title." });
    }
    
    try {
        const result = await sendPushNotification(tmdbId, mediaType, title);
        
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
// === FIN DE NUEVAS FUNCIONES Y ENDPOINT DE NOTIFICACIÓN PUSH ===
// -----------------------------------------------------------


// -----------------------------------------------------------
// === NUEVAS FUNCIONES PARA EL FLUJO DE PUBLICACIÓN EN CANALES ===
// -----------------------------------------------------------

const TELEGRAM_CHANNEL_A_ID = process.env.TELEGRAM_CHANNEL_A_ID;
const TELEGRAM_CHANNEL_B_ID = process.env.TELEGRAM_CHANNEL_B_ID;
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME;
const COOLDOWN_REPUBLISH_DAYS = parseInt(process.env.COOLDOWN_REPUBLISH_DAYS, 10) || 30;

async function publishToCommunityChannel(permalink, mediaData, mediaType, contentTitle) {
    try {
        const posterUrl = mediaData.poster_path ? `https://image.tmdb.org/t/p/w500${mediaData.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
        const description = (mediaType === 'movie') 
            ? `🎥 ¡Nueva película agregada! Haz clic para verla en Sala Cine.`
            : `📺 ¡Nuevo episodio agregado! Haz clic para ver los detalles.`;

        const options = {
            caption: `**¡Nuevo en Sala Cine!**\n\n${description}\n\n*${contentTitle}*`,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '▶️ ver ahora ', url: permalink }]
                ]
            }
        };

        await bot.sendPhoto(TELEGRAM_CHANNEL_B_ID, posterUrl, options);
    } catch (error) {
        console.error('Error al publicar en el canal de la comunidad:', error.message);
        bot.sendMessage(ADMIN_CHAT_ID, `⚠️ Error al publicar el post de ${contentTitle} en el canal de la comunidad. Revisa los logs.`);
    }
}

async function publishMovieToChannels(movieData) {
    const posterUrl = movieData.poster_path ? `https://image.tmdb.org/t/p/w500${movieData.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
    const caption = `🎬 **${movieData.title}**\n\n` +
                    `${movieData.overview || 'Sin sinopsis disponible.'}\n\n` +
                    `⭐ ${movieData.isPremium ? 'Contenido PRO' : 'Contenido GRATIS/PRO'}`;

    const tmeDeepLink = `https://t.me/${TELEGRAM_BOT_USERNAME}/?startapp=${movieData.tmdbId}`;
    const appDeepLinkFallback = `${RENDER_BACKEND_URL}/app/details/${movieData.tmdbId}`;

   const options = {
    caption: caption,
    parse_mode: 'Markdown',
    reply_markup: {
        inline_keyboard: [
            [{ text: '🤖 Ver ahora (Android)', url: appDeepLinkFallback }],
            [{ text: '🍎 Ver ahora (iPhone)', url: tmeDeepLink }]
        ]
    }
};
    try {
        const sentMessage = await bot.sendPhoto(TELEGRAM_CHANNEL_A_ID, posterUrl, options);
        
        const channelUsername = TELEGRAM_CHANNEL_A_ID.startsWith('@') ? TELEGRAM_CHANNEL_A_ID.substring(1) : TELEGRAM_CHANNEL_A_ID;
        const permalink = `https://tme.me/${channelUsername}/${sentMessage.message_id}`; // CORREGIDO: T.ME
        
        setTimeout(async () => {
            await publishToCommunityChannel(permalink, movieData, 'movie', movieData.title);
        }, 10000); 

        return { success: true };
    } catch (error) {
        console.error('Error al publicar película en canales:', error.message);
        bot.sendMessage(ADMIN_CHAT_ID, `⚠️ Error al publicar la película *${movieData.title}* en el canal principal. Revisa los logs.`);
        return { success: false, error: error.message };
    }
}

async function publishSeriesEpisodeToChannels(seriesData) {
    const posterUrl = seriesData.poster_path ? `https://image.tmdb.org/t/p/w500${seriesData.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
    const contentTitle = seriesData.title + ` - T${seriesData.seasonNumber} E${seriesData.episodeNumber}`;
    const caption = `🆕 **¡Nuevo Episodio!**\n\n` +
                    `🎬 **${contentTitle}**\n\n` +
                    `📺 ${seriesData.overview || 'Sin sinopsis disponible.'}\n\n` +
                    `⭐ ${seriesData.isPremium ? 'Contenido PRO' : 'Contenido GRATIS/PRO'}`;

    const tmeDeepLink = `https://t.me/${TELEGRAM_BOT_USERNAME}/?startapp=${seriesData.tmdbId}`;
    const appDeepLinkFallback = `${RENDER_BACKEND_URL}/app/details/${seriesData.tmdbId}`;

    const options = {
        caption: caption,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '▶️ Ver ahora', url: tmeDeepLink }],
                [{ text: '📱 Ver en el celular (Android)', url: appDeepLinkFallback }]
            ]
        }
    };

    try {
        const sentMessage = await bot.sendPhoto(TELEGRAM_CHANNEL_A_ID, posterUrl, options);

        const channelUsername = TELEGRAM_CHANNEL_A_ID.startsWith('@') ? TELEGRAM_CHANNEL_A_ID.substring(1) : TELEGRAM_CHANNEL_A_ID;
        const permalink = `https://tme.me/${channelUsername}/${sentMessage.message_id}`; // CORREGIDO: T.ME

        setTimeout(async () => {
            await publishToCommunityChannel(permalink, seriesData, 'series', contentTitle);
        }, 10000); 

        return { success: true };
    } catch (error) {
        console.error('Error al publicar episodio en canales:', error.message);
        bot.sendMessage(ADMIN_CHAT_ID, `⚠️ Error al publicar el episodio *${contentTitle}* en el canal principal. Revisa los logs.`);
        return { success: false, error: error.message };
    }
}

// -----------------------------------------------------------
// === FIN DE NUEVAS FUNCIONES PARA EL FLUJO DE PUBLICACIÓN EN CANALES ===
// -----------------------------------------------------------


// === LÓGICA DEL BOT DE TELEGRAM ===
bot.onText(/\/start|\/subir/, (msg) => {
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
                    // === ARREGLO CRÍTICO: BÚSQUEDA DE EXISTENCIA EN MONGODB ===
                    const existingMovie = await mongoDb.collection('media_catalog').findOne({ tmdbId: item.id.toString() });
                    const existingData = existingMovie || null;
                    // === FIN ARREGLO CRÍTICO ===

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
                    // === ARREGLO CRÍTICO: BÚSQUEDA DE EXISTENCIA EN MONGODB ===
                    const existingSeries = await mongoDb.collection('series_catalog').findOne({ tmdbId: item.id.toString() });
                    const existingData = existingSeries || null;
                    // === FIN ARREGLO CRÍTICO ===

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
    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_event_image') {
        if (!userText.startsWith('http')) {
            bot.sendMessage(chatId, '❌ Por favor, envía un ENLACE (URL) de imagen válido.');
            return;
        }
        adminState[chatId].imageUrl = userText;
        adminState[chatId].step = 'awaiting_event_description';
        bot.sendMessage(chatId, '¡Enlace de la fotografía recibido! Ahora, envía la DESCRIPCIÓN del evento.');

    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_event_description') {
        const { imageUrl } = adminState[chatId];
        const description = userText;
        
        try {
            await db.collection('userNotifications').add({
                title: '🎉 Nuevo Evento Publicado',
                description: description,
                image: imageUrl,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                isRead: false,
                type: 'event', 
                targetScreen: 'profile-screen'
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
        
        if (!selectedMedia || !selectedMedia.id) {
            bot.sendMessage(chatId, '❌ ERROR CRÍTICO: El ID de la película se perdió. Reinicia el proceso de subir la película con /subir.');
            adminState[chatId] = { step: 'menu' };
            return;
        }

        const freeEmbedCode = userText !== 'no' ? userText : null;

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
        
        const seriesDataToSave = {
            tmdbId: selectedSeries.tmdbId || selectedSeries.id, 
            title: selectedSeries.title || selectedSeries.name,
            poster_path: selectedSeries.poster_path,
            seasonNumber: season,
            episodeNumber: episode,
            proEmbedCode: proEmbedCode,
            freeEmbedCode: freeEmbedCode,
            isPremium: !!proEmbedCode && !freeEmbedCode
        };

        try {
            await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, seriesDataToSave);
            bot.sendMessage(chatId, `✅ Episodio ${episode} de la temporada ${season} guardado con éxito en la app.`);
            
            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➡️ Agregar Siguiente Episodio', callback_data: `add_next_episode_${seriesDataToSave.tmdbId}_${seriesDataToSave.seasonNumber}` }],
                        [{ text: '✅ Publicar en el canal y finalizar', callback_data: `save_and_publish_series_${seriesDataToSave.tmdbId}` }],
                        [{ text: '✅ Finalizar', callback_data: `finish_series_${seriesDataToSave.tmdbId}` }]
                    ]
                }
            };

            bot.sendMessage(chatId, '¿Qué quieres hacer ahora?', options);
            adminState[chatId] = { step: 'awaiting_series_action' };
        } catch (error) {
            console.error("Error al guardar el episodio:", error);
            bot.sendMessage(chatId, 'Hubo un error al guardar el episodio.');
        } finally {
        }
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
    } else if (data === 'eventos') {
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
        // La consulta de gestión debe ir a MongoDB
        const existingData = await mongoDb.collection('media_catalog').findOne({ tmdbId: tmdbId });

        if (!existingData) {
            bot.sendMessage(chatId, 'Error: Película no encontrada en la base de datos de MongoDB.');
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
        // La consulta de gestión debe ir a MongoDB
        const seriesData = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
        
        if (!seriesData) {
            bot.sendMessage(chatId, 'Error: Serie no encontrada en la base de datos de MongoDB.');
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
        const existingData = await mongoDb.collection('media_catalog').findOne({ tmdbId: tmdbId });
        
        if (!existingData) {
             bot.sendMessage(chatId, 'Error: Película no encontrada para gestionar.');
             return;
        }

        adminState[chatId] = { selectedMedia: existingData, mediaType: 'movie', freeEmbedCode: existingData.freeEmbedCode };
        adminState[chatId].step = 'awaiting_pro_link_movie';
        bot.sendMessage(chatId, `Envía el reproductor PRO para "${existingData.title}".`);
    } else if (data.startsWith('add_free_movie_')) {
        const tmdbId = data.replace('add_free_movie_', '');
        const existingData = await mongoDb.collection('media_catalog').findOne({ tmdbId: tmdbId });

        if (!existingData) {
             bot.sendMessage(chatId, 'Error: Película no encontrada para gestionar.');
             return;
        }
        
        adminState[chatId] = { selectedMedia: existingData, mediaType: 'movie', proEmbedCode: existingData.proEmbedCode };
        adminState[chatId].step = 'awaiting_free_link_movie';
        bot.sendMessage(chatId, `Envía el reproductor GRATIS para "${existingData.title}".`);
    } else if (data.startsWith('add_episode_series_')) {
        const tmdbId = data.replace('add_episode_series_', '');
        const seriesData = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
        
        if (!seriesData) {
            bot.sendMessage(chatId, 'Error: Serie no encontrada en la base de datos de MongoDB.');
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
        const parts = data.split('_');
        const tmdbId = parts[3];
        const seasonNumber = parts[4];

        const seriesData = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });

        if (!seriesData) {
            bot.sendMessage(chatId, 'Error: Serie no encontrada en la base de datos de MongoDB.');
            return;
        }
        
        let lastEpisode = 0;
        if (seriesData.seasons && seriesData.seasons[seasonNumber] && seriesData.seasons[seasonNumber].episodes) {
            const episodes = seriesData.seasons[seasonNumber].episodes;
            lastEpisode = Object.keys(episodes).length;
        }
        const nextEpisode = lastEpisode + 1;

        seriesData.tmdbId = tmdbId;

        adminState[chatId] = {
            step: 'awaiting_pro_link_series',
            selectedSeries: seriesData,
            season: parseInt(seasonNumber),
            episode: nextEpisode
        };
        bot.sendMessage(chatId, `Genial. Ahora, envía el reproductor PRO para el episodio ${nextEpisode} de la temporada ${seasonNumber}. Si no hay, escribe "no".`);

    } else if (data.startsWith('add_new_season_')) {
        const tmdbId = data.replace('add_new_season_', '');
        try {
            const tmdbUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
            const response = await axios.get(tmdbUrl);
            const tmdbSeries = response.data;

            const existingSeasons = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId }, { projection: { seasons: 1 } });
            const existingSeasonNumbers = existingSeasons && existingSeasons.seasons ? Object.keys(existingSeasons.seasons) : [];

            const availableSeasons = tmdbSeries.seasons.filter(s => !existingSeasonNumbers.includes(s.season_number.toString()));

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
        
        const selectedSeries = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
        
        if (!selectedSeries) {
             bot.sendMessage(chatId, 'Error: Serie no encontrada en la base de datos de MongoDB.');
             return;
        }

        let lastEpisode = 0;
        if (selectedSeries.seasons && selectedSeries.seasons[seasonNumber] && selectedSeries.seasons[seasonNumber].episodes) {
            const episodes = selectedSeries.seasons[seasonNumber].episodes;
            lastEpisode = Object.keys(episodes).length;
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
            if (!movieDataToSave || !movieDataToSave.tmdbId) {
                throw new Error("Datos de película incompletos o tmdbId faltante.");
            }
            await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
            bot.sendMessage(chatId, `✅ Película "${movieDataToSave.title}" guardada con éxito en la app.`);
            adminState[chatId] = { step: 'menu' };
        } catch (error) {
            console.error("Error al guardar la película:", error);
            bot.sendMessage(chatId, 'Hubo un error al guardar la película.');
            adminState[chatId] = { step: 'menu' };
        }
    } else if (data.startsWith('save_and_publish_')) {
        const { movieDataToSave } = adminState[chatId];
        try {
            if (!movieDataToSave || !movieDataToSave.tmdbId) {
                throw new Error("Datos de película incompletos o tmdbId faltante.");
            }
            await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
            bot.sendMessage(chatId, `✅ Película "${movieDataToSave.title}" guardada con éxito en la app.`);
            
            await publishMovieToChannels(movieDataToSave);
            
            adminState[chatId] = { step: 'menu' };
        } catch (error) {
            console.error("Error al guardar/publicar la película:", error);
            bot.sendMessage(chatId, 'Hubo un error al guardar o publicar la película. Revisa el estado de la película en Firestore y reinicia con /subir.');
            adminState[chatId] = { step: 'menu' };
        }
    } else if (data.startsWith('save_only_series_')) {
        const { seriesDataToSave } = adminState[chatId];
        try {
            if (!seriesDataToSave || !seriesDataToSave.tmdbId) {
                throw new Error("Datos de la serie incompletos o tmdbId faltante.");
            }
            await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, seriesDataToSave);
            
            const tmdbId = seriesDataToSave.tmdbId;
            const seasonNumber = seriesDataToSave.seasonNumber;
            const episodeNumber = seriesDataToSave.episodeNumber;

            const seriesData = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });

            let lastEpisode = 0;
            if (seriesData?.seasons?.[seasonNumber]?.episodes) {
                lastEpisode = Object.keys(seriesData.seasons[seasonNumber].episodes).length;
            }
            const nextEpisode = lastEpisode + 1;

            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `➡️ Agregar Episodio ${nextEpisode}`, callback_data: `add_next_episode_${tmdbId}_${seasonNumber}` }],
                        [{ text: '✅ Finalizar', callback_data: `finish_series_${tmdbId}` }]
                    ]
                },
                parse_mode: 'Markdown'
            };
            
            bot.sendMessage(chatId, `✅ Episodio ${episodeNumber} de la temporada ${seasonNumber} guardado con éxito. ¿Quieres agregar el siguiente?`, options);
            adminState[chatId] = { step: 'awaiting_series_action' }; 
            
        } catch (error) {
            console.error("Error al guardar el episodio:", error);
            bot.sendMessage(chatId, 'Hubo un error al guardar el episodio.');
            adminState[chatId] = { step: 'menu' };
        }
    } else if (data.startsWith('save_and_publish_series_')) {
        const { selectedSeries, season, episode, proEmbedCode, freeEmbedCode } = adminState[chatId];
        try {
            if (!selectedSeries || !selectedSeries.tmdbId) {
                throw new Error("Datos de la serie incompletos o tmdbId faltante.");
            }
            
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

            await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, seriesDataToSave);
            bot.sendMessage(chatId, `✅ Episodio ${seriesDataToSave.episodeNumber} de la temporada ${seriesDataToSave.seasonNumber} guardado y publicado con éxito.`);
            
            await publishSeriesEpisodeToChannels(seriesDataToSave);

            const tmdbId = seriesDataToSave.tmdbId;
            const seasonNumber = seriesDataToSave.seasonNumber;
            const seriesData = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });

            let lastEpisode = 0;
            if (seriesData?.seasons?.[seasonNumber]?.episodes) {
                lastEpisode = Object.keys(seriesData.seasons[seasonNumber].episodes).length;
            }
            const nextEpisode = lastEpisode + 1;

            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `➡️ Agregar Episodio ${nextEpisode}`, callback_data: `add_next_episode_${tmdbId}_${seasonNumber}` }],
                        [{ text: '✅ Finalizar', callback_data: `finish_series_${tmdbId}` }]
                    ]
                }
            };
            
            bot.sendMessage(chatId, '¿Quieres agregar el siguiente episodio?', options);
            adminState[chatId] = { step: 'awaiting_series_action' };
        } catch (error) {
            console.error("Error al guardar/publicar el episodio:", error);
            bot.sendMessage(chatId, 'Hubo un error al guardar o publicar el episodio.');
            adminState[chatId] = { step: 'menu' };
        }
    } else if (data.startsWith('send_push_')) {
        const parts = data.split('_');
        const tmdbId = parts[2];
        const mediaType = parts[3];
        const state = adminState[chatId];
        const title = state.title;

        if (!title) {
             bot.editMessageReplyMarkup({ inline_keyboard: [] }, { 
                 chat_id: chatId, 
                 message_id: msg.message_id
             });
             bot.sendMessage(chatId, '❌ Error: El estado de la acción se perdió. Por favor, intente /start.');
             adminState[chatId] = { step: 'menu' };
             return;
        }

        try {
            await axios.post(`${RENDER_BACKEND_URL}/api/notify`, {
                tmdbId,
                mediaType,
                title
            });
            
            bot.editMessageText(`✅ Notificaciones push para *${title}* programadas para envío.`, {
                chat_id: chatId, 
                message_id: msg.message_id,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [] } 
            });

        } catch (error) {
            console.error("Error al llamar al endpoint /api/notify:", error);
            bot.editMessageText(`❌ Hubo un error al solicitar el envío de notificaciones para *${title}*. Revisa los logs.`, {
                chat_id: chatId, 
                message_id: msg.message_id,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [] } 
            });
        } finally {
            adminState[chatId] = { step: 'menu' }; 
        }
    } else if (data.startsWith('finish_series_')) {
        const tmdbId = data.replace('finish_series_', '');
        // NOTA: 'status: completed' era de Firestore, en Mongo no es necesario
        // pero mantenemos el flujo para el bot.
        bot.sendMessage(chatId, '✅ Proceso de adición de episodios finalizado. Volviendo al menú principal.');
        adminState[chatId] = { step: 'menu' };
    }
});

// =======================================================================
// === FIN: LÓGICA DEL BOT (IMPORTADA DE SERVER14.JS) ===
// =======================================================================


// =======================================================================
// === VERIFICADOR DE ACTUALIZACIONES (/api/app-update) - RESTAURADO ===
// =======================================================================

app.get('/api/app-update', (req, res) => {
  // CRÍTICO: latest_version_code DEBE coincidir con el versionCode del APK más reciente (en tu caso, 2)
  const updateInfo = {
    "latest_version_code": 4, // <-- PUEDES CAMBIAR ESTE NÚMERO PARA FORZAR LA ACTUALIZACIÓN
    "update_url": "https://google-play.onrender.com",
    "force_update": true,
    "update_message": "¡Tenemos una nueva versión (1.4) con TV en vivo y mejoras! Presiona 'Actualizar Ahora' para ir a la tienda de descarga."
  };

  res.status(200).json(updateInfo);
});

// =======================================================================
// === TAREA 1: ENDPOINT DE CONTROL REMOTO (FEATURE GATE) ===
// =======================================================================

app.get('/api/app-status', (req, res) => {
    const status = {
        // CRÍTICO: Debe estar en 'false' para el envío inicial a la Play Store.
        // Cambia esto a 'true' en tu servidor DESPUÉS de que Google apruebe la app.
        isAppApproved: false, 
        
        // IDs de contenido seguro (ej. trailers, contenido familiar o público)
        safeContentIds: [
            11104, // ID TMDB Película Segura 1 (Proporcionado)
            539,   // ID TMDB Película Segura 2 (Proporcionado)
            4555,  // ID TMDB Película Segura 3 (Proporcionado)
            27205, // ID TMDB 'Big Buck Bunny' (Película de código abierto)
            33045  // ID TMDB 'Sintel' (Película de código abierto)
        ]
    };
    res.json(status);
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
