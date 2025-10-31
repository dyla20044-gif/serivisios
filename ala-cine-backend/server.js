const express = require('express');
const bodyParser = require('body-parser');
const paypal = require('paypal-rest-sdk');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const axios = require('axios');
const dotenv = require('dotenv');
const url = require('url');
const { MongoClient, ServerApiVersion } = require('mongodb');
// const godstreamService = require('./GoodStreamServers.js'); // <--- ELIMINADO
const initializeBot = require('./bot.js');

// +++ INICIO DE CAMBIOS PARA CACHÉ +++
const NodeCache = require('node-cache');
// Caché para enlaces (1 hora TTL - 3600 segundos)
const embedCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
// ¡NUEVO! Caché para contadores (5 minutos TTL - 300 segundos)
const countsCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
// +++ FIN DE CAMBIOS PARA CACHÉ +++

const app = express();
dotenv.config();

const PORT = process.env.PORT || 3000;

// === CONFIGURACIONES ===
try {
    // Intenta parsear la variable de entorno
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SDK);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("✅ Firebase Admin SDK inicializado correctamente.");
} catch (error) {
    console.error("❌ ERROR FATAL: No se pudo parsear FIREBASE_ADMIN_SDK. Verifica la variable de entorno.", error);
    // Considera salir del proceso si Firebase Admin es crítico
    // process.exit(1);
}
const db = admin.firestore(); // Firestore sigue siendo útil
const messaging = admin.messaging(); // Messaging para enviar notificaciones

paypal.configure({
    'mode': process.env.PAYPAL_MODE || 'sandbox',
    'client_id': process.env.PAYPAL_CLIENT_ID,
    'client_secret': process.env.PAYPAL_CLIENT_SECRET
});

const token = process.env.TELEGRAM_BOT_TOKEN;
// const GODSTREAM_API_KEY = process.env.GODSTREAM_API_KEY; // <--- ELIMINADO
const RENDER_BACKEND_URL = process.env.RENDER_EXTERNAL_URL || 'https://serivisios.onrender.com';
const bot = new TelegramBot(token); // Creamos la instancia de bot aquí
const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT_ID, 10);
const TMDB_API_KEY = process.env.TMDB_API_KEY;

let GLOBAL_STREAMING_ACTIVE = true;

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
        return mongoDb;
    } catch (e) {
        console.error("❌ Error al conectar a MongoDB Atlas:", e);
        process.exit(1);
    }
}

// === FUNCIÓN DE AYUDA MEJORADA PARA EXTRAER CÓDIGO ===
// <--- TODA LA FUNCIÓN "extractGodStreamCode" HA SIDO ELIMINADA --->


// === ESTADO DEL BOT ===
const adminState = {};

// === MIDDLEWARE ===
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { return res.sendStatus(200); }
    next();
});

// === RUTAS DEL SERVIDOR WEB ===
// ... (rutas /, /bot{token}, /app/details/:tmdbId sin cambios) ...
app.get('/', (req, res) => {
  res.send('¡El bot y el servidor de Sala Cine están activos!');
});

if (process.env.NODE_ENV === 'production' && token) { // Añadido chequeo de token
    app.post(`/bot${token}`, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });
} else if (!token && process.env.NODE_ENV === 'production'){
    console.warn("⚠️  Webhook de Telegram no configurado porque TELEGRAM_BOT_TOKEN no está definido.");
}


app.get('/app/details/:tmdbId', (req, res) => {
    const tmdbId = req.params.tmdbId;
    // Prioridad 1: URL de descarga directa de la app (si existe)
    if (process.env.APP_DOWNLOAD_URL) {
        console.log(`Deep Link no manejado por app nativa. Redirigiendo a URL de descarga: ${process.env.APP_DOWNLOAD_URL}`);
        return res.redirect(302, process.env.APP_DOWNLOAD_URL);
    }
    // Prioridad 2: URL de la Mini App de Telegram (si existe)
    if (process.env.TELEGRAM_MINIAPP_URL) {
        const tmaLink = process.env.TELEGRAM_MINIAPP_URL + (process.env.TELEGRAM_MINIAPP_URL.includes('?') ? '&' : '?') + 'startapp=' + tmdbId;
        console.log('APP_DOWNLOAD_URL no definida. Redirigiendo al fallback de la TMA.');
        return res.redirect(302, tmaLink);
    }
    // Si ninguna URL está definida
    console.error('Ni APP_DOWNLOAD_URL ni TELEGRAM_MINIAPP_URL están definidas en las variables de entorno.');
    res.status(404).send('No se encontró la aplicación de destino ni un enlace de descarga o fallback.');
});

// ... (ruta /request-movie, /api/streaming-status SIN CAMBIOS) ...
app.post('/request-movie', async (req, res) => {
    // ... (sin cambios en esta ruta)
    const { title, poster_path, tmdbId, priority } = req.body;
    const posterUrl = poster_path ? `https://image.tmdb.org/t/p/w500${poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
    let priorityText = '';
    switch (priority) {
        case 'fast': priorityText = '⚡ Rápido (~24h)'; break;
        case 'immediate': priorityText = '🚀 Inmediato (~1h)'; break;
        case 'premium': priorityText = '👑 PREMIUM (Prioridad)'; break;
        default: priorityText = '⏳ Regular (1-2 semanas)';
    }
    const message = `🔔 *Solicitud ${priority === 'premium' ? 'Premium' : 'Normal'}:* ${title}\n` +
                    `*Prioridad:* ${priorityText}\n\n` +
                    `Un usuario ha solicitado este contenido.`;
    try {
        
        // +++ CAMBIO REALIZADO +++
        // Comentamos la notificación simple
        // await bot.sendMessage(ADMIN_CHAT_ID, `Recibida solicitud para: ${title} (Prioridad: ${priorityText})`); // Notificación simple
        
        // Descomentamos la notificación con foto y botón
        await bot.sendPhoto(ADMIN_CHAT_ID, posterUrl, {
            caption: message, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '✅ Agregar ahora', callback_data: `solicitud_${tmdbId}` }]] }
        });
        // +++ FIN DEL CAMBIO +++

        res.status(200).json({ message: 'Solicitud enviada al administrador.' });
    } catch (error) {
        console.error("Error al procesar la solicitud:", error);
        res.status(500).json({ error: 'Error al enviar la notificación o guardar la solicitud.' });
    }
});

// =======================================================================
// === INICIO: NUEVA RUTA PARA PEDIDOS DE DIAMANTES
// =======================================================================
app.post('/api/request-diamond', async (req, res) => {
    // 1. Extraer los datos del cuerpo de la solicitud (enviados desde rewards.js)
    const { userId, email, gameId, diamonds, costInCoins } = req.body;

    if (!userId || !gameId || !diamonds) {
        return res.status(400).json({ error: 'Faltan datos (userId, gameId, diamonds).' });
    }

    // 2. Formatear el mensaje para el bot (igual que el de películas)
    const posterUrl = "https://i.ibb.co/L6TqT2V/ff-100.png"; // URL genérica de FF
    const message = `💎 *¡Solicitud de Diamantes!* 💎\n\n` +
                    `*Usuario:* ${email || 'No especificado'}\n` +
                    `*ID de Jugador:* \`${gameId}\`\n` + // Usar \` (comilla grave) para que se pueda copiar
                    `*Producto:* ${diamonds} Diamantes\n` +
                    `*Costo:* ${costInCoins} 🪙`;

    try {
        // 3. Enviar la notificación al admin con un botón de "Completado"
        await bot.sendPhoto(ADMIN_CHAT_ID, posterUrl, {
            caption: message, 
            parse_mode: 'Markdown',
            reply_markup: { 
                inline_keyboard: [
                    // Este botón le avisará al bot que ya hiciste la recarga
                    [{ text: '✅ Marcar como Recargado', callback_data: `diamond_completed_${gameId}` }]
                ] 
            }
        });

        // 4. Responder a la app que todo salió bien
        res.status(200).json({ message: 'Solicitud de diamantes enviada al administrador.' });
    } catch (error) {
        console.error("Error al procesar la solicitud de diamantes:", error);
        res.status(500).json({ error: 'Error al enviar la notificación de diamantes.' });
    }
});
// =======================================================================
// === FIN: NUEVA RUTA PARA PEDIDOS DE DIAMANTES
// =======================================================================


app.get('/api/streaming-status', (req, res) => {
    console.log(`[Status Check] Devolviendo estado de streaming global: ${GLOBAL_STREAMING_ACTIVE}`);
    res.status(200).json({ isStreamingActive: GLOBAL_STREAMING_ACTIVE });
});


// =======================================================================
// === RUTA /api/get-movie-data MODIFICADA CON CACHÉ ===
// =======================================================================
app.get('/api/get-movie-data', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "El ID del contenido es requerido." });

    // +++ INICIO DE LÓGICA DE CACHÉ (5 MINUTOS) +++
    const cacheKey = `counts-data-${id}`;
    try {
        const cachedData = countsCache.get(cacheKey);
        if (cachedData) {
            console.log(`[Cache HIT] Sirviendo contadores desde caché para: ${cacheKey}`);
            return res.status(200).json(cachedData);
        }
    } catch (err) {
        console.error("Error al leer del caché de contadores:", err);
    }
    console.log(`[Cache MISS] Buscando contadores en MongoDB para: ${cacheKey}`);
    // +++ FIN DE LÓGICA DE CACHÉ +++
    
    try {
        const movieCollection = mongoDb.collection('media_catalog');
        const seriesCollection = mongoDb.collection('series_catalog');
        let docMovie = null; let docSeries = null; let views = 0; let likes = 0; let isAvailable = false;
        const seriesProjection = { projection: { views: 1, likes: 1, seasons: 1 } };
        docSeries = await seriesCollection.findOne({ tmdbId: id.toString() }, seriesProjection);
        if (docSeries) {
            views = docSeries.views || 0; likes = docSeries.likes || 0;
            if (docSeries.seasons) {
                isAvailable = Object.values(docSeries.seasons).some(season => season && season.episodes && Object.values(season.episodes).some(ep => (ep.freeEmbedCode && ep.freeEmbedCode !== '') || (ep.proEmbedCode && ep.proEmbedCode !== '')));
            }
            if (isAvailable) {
                const responseData = { views: views, likes: likes, isAvailable: true };
                countsCache.set(cacheKey, responseData); // Guardar en caché
                return res.status(200).json(responseData);
            }
        }
        const movieProjection = { projection: { views: 1, likes: 1, freeEmbedCode: 1, proEmbedCode: 1 } };
        docMovie = await movieCollection.findOne({ tmdbId: id.toString() }, movieProjection);
        if (docMovie) {
            if (views === 0) views = docMovie.views || 0; if (likes === 0) likes = docMovie.likes || 0;
            isAvailable = !!(docMovie.freeEmbedCode || docMovie.proEmbedCode);
            
            const responseData = { views: views, likes: likes, isAvailable: isAvailable };
            countsCache.set(cacheKey, responseData); // Guardar en caché
            return res.status(200).json(responseData);
        }
        
        const responseData_NotFound = { views: views, likes: likes, isAvailable: false };
        countsCache.set(cacheKey, responseData_NotFound); // Guardar en caché (incluso si no se encuentra)
        res.status(200).json(responseData_NotFound); // Devuelve 0s si no se encuentra
    } catch (error) {
        console.error(`Error crítico al obtener los datos consolidados en MongoDB:`, error);
        res.status(500).json({ error: "Error interno del servidor al obtener los datos." });
    }
});


// =======================================================================
// === RUTA /api/get-embed-code MODIFICADA CON CACHÉ ===
// =======================================================================
app.get('/api/get-embed-code', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });
    const { id, season, episode, isPro } = req.query;
    if (!id) return res.status(400).json({ error: "ID no proporcionado" });

    // +++ INICIO DE LÓGICA DE CACHÉ (1 HORA) +++
    const cacheKey = `embed-${id}-${season || 'movie'}-${episode || '1'}-${isPro === 'true' ? 'pro' : 'free'}`;

    try {
        // Usamos embedCache (el de 1 hora)
        const cachedData = embedCache.get(cacheKey);
        if (cachedData) {
            console.log(`[Cache HIT] Sirviendo embed desde caché para: ${cacheKey}`);
            return res.json({ embedCode: cachedData });
        }
    } catch (err) {
        console.error("Error al leer del caché de embeds:", err);
    }

    console.log(`[Cache MISS] Buscando embed en MongoDB para: ${cacheKey}`);
    try {
        const mediaType = season && episode ? 'series' : 'movies';
        const collectionName = (mediaType === 'movies') ? 'media_catalog' : 'series_catalog';
        const doc = await mongoDb.collection(collectionName).findOne({ tmdbId: id.toString() }); // Buscar por String
        if (!doc) return res.status(404).json({ error: `${mediaType} no encontrada.` });

        let embedCode;
        if (mediaType === 'movies') {
            embedCode = isPro === 'true' ? doc.proEmbedCode : doc.freeEmbedCode;
        } else {
            const episodeData = doc.seasons?.[season]?.episodes?.[episode];
            embedCode = isPro === 'true' ? episodeData?.proEmbedCode : episodeData?.freeEmbedCode;
        }

        if (!embedCode) {
            console.log(`[Embed Code] No se encontró código para ${id} (isPro: ${isPro})`);
            return res.status(404).json({ error: `No se encontró código de reproductor.` });
        }
        
        // Guardamos en embedCache (el de 1 hora)
        embedCache.set(cacheKey, embedCode);

        console.log(`[MongoDB] Sirviendo embed directo y guardando en caché para ${id} (isPro: ${isPro})`);
        return res.json({ embedCode: embedCode });
        
    } catch (error) {
        console.error("Error crítico get-embed-code:", error);
        res.status(500).json({ error: "Error interno" });
    }
});


app.get('/api/check-season-availability', async (req, res) => {
    // ... (sin cambios)
     if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });
     const { id, season } = req.query;
     if (!id || !season) return res.status(400).json({ error: "ID y temporada son requeridos." });
     try {
         const seriesCollection = mongoDb.collection('series_catalog');
         const episodesField = `seasons.${season}.episodes`;
         const doc = await seriesCollection.findOne({ tmdbId: id.toString() }, { projection: { [episodesField]: 1 } });
         if (!doc?.seasons?.[season]?.episodes) { return res.status(200).json({ exists: false, availableEpisodes: {} }); }
         const episodesData = doc.seasons[season].episodes; const availabilityMap = {};
         for (const episodeNum in episodesData) { const ep = episodesData[episodeNum]; availabilityMap[episodeNum] = !!(ep.proEmbedCode || ep.freeEmbedCode); }
         res.status(200).json({ exists: true, availableEpisodes: availabilityMap });
     } catch (error) { console.error("Error check-season-availability:", error); res.status(500).json({ error: "Error interno." }); }
});


// =======================================================================
// === RUTA /api/get-metrics MODIFICADA CON CACHÉ ===
// =======================================================================
app.get('/api/get-metrics', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    const { id, field } = req.query;
    if (!id || !field || (field !== 'views' && field !== 'likes')) { return res.status(400).json({ error: "ID y campo ('views' o 'likes') requeridos." }); }

    // +++ INICIO DE LÓGICA DE CACHÉ (5 MINUTOS) +++
    const cacheKey = `counts-metrics-${id}-${field}`;
    try {
        const cachedData = countsCache.get(cacheKey);
        if (cachedData) {
            console.log(`[Cache HIT] Sirviendo métrica desde caché para: ${cacheKey}`);
            return res.status(200).json(cachedData);
        }
    } catch (err) {
        console.error("Error al leer del caché de métricas:", err);
    }
    console.log(`[Cache MISS] Buscando métrica en MongoDB para: ${cacheKey}`);
    // +++ FIN DE LÓGICA DE CACHÉ +++

    try {
        let doc = await mongoDb.collection('media_catalog').findOne({ tmdbId: id.toString() }, { projection: { [field]: 1 } });
        if (!doc) doc = await mongoDb.collection('series_catalog').findOne({ tmdbId: id.toString() }, { projection: { [field]: 1 } });
        
        const responseData = { count: doc?.[field] || 0 };
        countsCache.set(cacheKey, responseData); // Guardar en caché
        res.status(200).json(responseData);

    } catch (error) { console.error(`Error get-metrics (${field}):`, error); res.status(500).json({ error: "Error interno." }); }
});


// =======================================================================
// === RUTAS DE ESCRITURA (INCREMENTS) - SIN CACHÉ ===
// =======================================================================

app.post('/api/increment-views', async (req, res) => {
    // ¡ESTA RUTA NO LLEVA CACHÉ! ES UNA ESCRITURA.
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    const { tmdbId } = req.body; if (!tmdbId) return res.status(400).json({ error: "tmdbId requerido." });
    try {
        const update = { $inc: { views: 1 }, $setOnInsert: { likes: 0 } }; const options = { upsert: true };
        let result = await mongoDb.collection('media_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options);
        if (result.matchedCount === 0 && result.upsertedCount === 0) {
           result = await mongoDb.collection('series_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options);
        }
        
        // ¡IMPORTANTE! Invalidar el caché de contadores para este ID
        // para que la próxima lectura muestre la vista nueva.
        countsCache.del(`counts-data-${tmdbId}`);
        countsCache.del(`counts-metrics-${tmdbId}-views`);

        res.status(200).json({ message: 'Vista registrada.' });
    } catch (error) { console.error("Error increment-views:", error); res.status(500).json({ error: "Error interno." }); }
});

app.post('/api/increment-likes', async (req, res) => {
    // ¡ESTA RUTA NO LLEVA CACHÉ! ES UNA ESCRITURA.
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    const { tmdbId } = req.body; if (!tmdbId) return res.status(400).json({ error: "tmdbId requerido." });
    try {
        const update = { $inc: { likes: 1 }, $setOnInsert: { views: 0 } }; const options = { upsert: true };
        let result = await mongoDb.collection('media_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options);
         if (result.matchedCount === 0 && result.upsertedCount === 0) {
            result = await mongoDb.collection('series_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options);
         }

        // ¡IMPORTANTE! Invalidar el caché de contadores para este ID
        countsCache.del(`counts-data-${tmdbId}`);
        countsCache.del(`counts-metrics-${tmdbId}-likes`);

        res.status(200).json({ message: 'Like registrado.' });
    } catch (error) { console.error("Error increment-likes:", error); res.status(500).json({ error: "Error interno." }); }
});

app.post('/add-movie', async (req, res) => {
    // ... (sin cambios)
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    try {
        const { tmdbId, title, poster_path, freeEmbedCode, proEmbedCode, isPremium, overview } = req.body;
        if (!tmdbId) return res.status(400).json({ error: 'tmdbId requerido.' });
        const updateQuery = { $set: { title, poster_path, overview, freeEmbedCode, proEmbedCode, isPremium }, $setOnInsert: { tmdbId: tmdbId.toString(), views: 0, likes: 0, addedAt: new Date() } }; // Añadir fecha de adición
        await mongoDb.collection('media_catalog').updateOne({ tmdbId: tmdbId.toString() }, updateQuery, { upsert: true });
        
        // Invalidar cachés existentes para este ID
        embedCache.del(`embed-${tmdbId}-movie-1-pro`);
        embedCache.del(`embed-${tmdbId}-movie-1-free`);
        countsCache.del(`counts-data-${tmdbId}`);

        res.status(200).json({ message: 'Película agregada/actualizada.' });
    } catch (error) { console.error("Error add-movie:", error); res.status(500).json({ error: 'Error interno.' }); }
});

app.post('/add-series-episode', async (req, res) => {
    // ... (sin cambios)
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    try {
        const { tmdbId, title, poster_path, overview, seasonNumber, episodeNumber, freeEmbedCode, proEmbedCode, isPremium } = req.body;
        if (!tmdbId || !seasonNumber || !episodeNumber) return res.status(400).json({ error: 'tmdbId, seasonNumber y episodeNumber requeridos.' });
        const episodePath = `seasons.${seasonNumber}.episodes.${episodeNumber}`;
        const updateData = {
            $set: {
                title, poster_path, overview, isPremium,
                [`seasons.${seasonNumber}.name`]: `Temporada ${seasonNumber}`, // Asegura nombre de temporada
                [episodePath + '.freeEmbedCode']: freeEmbedCode,
                [episodePath + '.proEmbedCode']: proEmbedCode,
                 [episodePath + '.addedAt']: new Date() // Añadir fecha de adición del episodio
            },
            $setOnInsert: { tmdbId: tmdbId.toString(), views: 0, likes: 0, addedAt: new Date() } // Añadir fecha si la serie es nueva
        };
        await mongoDb.collection('series_catalog').updateOne({ tmdbId: tmdbId.toString() }, updateData, { upsert: true });

        // Invalidar cachés existentes para este episodio
        embedCache.del(`embed-${tmdbId}-${seasonNumber}-${episodeNumber}-pro`);
        embedCache.del(`embed-${tmdbId}-${seasonNumber}-${episodeNumber}-free`);
        countsCache.del(`counts-data-${tmdbId}`);

        res.status(200).json({ message: `Episodio S${seasonNumber}E${episodeNumber} agregado/actualizado.` });
    } catch (error) { console.error("Error add-series-episode:", error); res.status(500).json({ error: 'Error interno.' }); }
});

// =======================================================================
// === INICIO: RUTA DE CANJE PREMIUM CON DEPURACIÓN AÑADIDA
// =======================================================================
app.post('/api/redeem-premium-time', async (req, res) => {
    const { userId, daysToAdd } = req.body;

    // +++ PASO DE DEPURACIÓN 1: Ver lo que recibimos +++
    console.log("==============================================");
    console.log("🔥 INICIANDO CANJE PREMIUM (/api/redeem-premium-time)");
    console.log(`[DATOS RECIBIDOS] User ID: ${userId}, Días a sumar: ${daysToAdd}`);
    // +++ FIN DEPURACIÓN +++

    if (!userId || !daysToAdd) { 
        console.error("❌ ERROR: Faltan userId o daysToAdd. La app no los envió.");
        return res.status(400).json({ success: false, error: 'userId y daysToAdd son requeridos.' }); 
    }
    const days = parseInt(daysToAdd, 10); 
    if (isNaN(days) || days <= 0) { 
        console.error(`❌ ERROR: 'daysToAdd' no es un número válido: ${daysToAdd}`);
        return res.status(400).json({ success: false, error: 'daysToAdd debe ser un número positivo.' }); 
    }
    
    try {
        // +++ PASO DE DEPURACIÓN 2: Verificar el Documento de Firebase y el Reloj +++
        console.log(`[FIREBASE] Apuntando a la colección 'users' con el ID: '${userId}'`);
        const userDocRef = db.collection('users').doc(userId); 
        const docSnap = await userDocRef.get(); 
        let newExpiryDate; 
        const now = new Date(); // <--- Esta es la hora del servidor
        console.log(`[RELOJ SERVIDOR] La hora 'now' del servidor es: ${now.toISOString()}`);
        
        if (docSnap.exists && docSnap.data().premiumExpiry) {
            let currentExpiry; const expiryData = docSnap.data().premiumExpiry;
            // Lógica para leer la fecha (Timestamp de Firebase o string)
            if (expiryData.toDate && typeof expiryData.toDate === 'function') { currentExpiry = expiryData.toDate(); }
            else if (typeof expiryData === 'string') { currentExpiry = new Date(expiryData); }
            else { console.warn(`Formato de 'premiumExpiry' inesperado. Iniciando desde ahora.`); currentExpiry = now; }
            
            console.log(`[CALCULO FECHA] Expiración actual encontrada en BD: ${currentExpiry.toISOString()}`);
            
            if (currentExpiry > now) { 
                newExpiryDate = new Date(currentExpiry.getTime() + days * 24 * 60 * 60 * 1000); 
                console.log("[CALCULO FECHA] Se está extendiendo una suscripción existente.");
            } else { 
                newExpiryDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000); 
                console.log("[CALCULO FECHA] Creando nueva suscripción (o renovando una expirada).");
            }
        } else { 
            newExpiryDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000); 
            console.log(`[CALCULO FECHA] Usuario no existe o no tiene 'premiumExpiry'. Creando nueva suscripción.`);
        }
        
        console.log(`[CALCULO FECHA] Nueva fecha de expiración calculada: ${newExpiryDate.toISOString()}`);
        
        // +++ PASO DE DEPURACIÓN 3: Intentar la escritura en Firebase +++
        const dataToSet = { 
            isPro: true, 
            premiumExpiry: newExpiryDate 
        };
        console.log(`[FIREBASE] Intentando .set({ isPro: true, ... }) en 'users/${userId}'`);
        await userDocRef.set(dataToSet, { merge: true });
        
        // Esta línea SOLO se ejecuta si el 'await' anterior NO falló
        console.log(`✅ [FIREBASE ESCRITURA EXITOSA!] Premium activado para ${userId}.`);
        console.log("==============================================");

        res.status(200).json({ success: true, message: `Premium activado por ${days} días.` });
    
    } catch (error) { 
        // +++ PASO DE DEPURACIÓN 4: Capturar cualquier error +++
        console.error("==============================================");
        console.error(`❌ ERROR FATAL en /api/redeem-premium-time para User ID: ${userId}`);
        console.error("El 'await userDocRef.set(...)' falló. Detalles del error:");
        console.error(error); // Imprime el error completo de Firebase
        console.error("==============================================");
        res.status(500).json({ success: false, error: 'Error interno del servidor al actualizar el estado del usuario.' }); 
    }
});
// =======================================================================
// === FIN: RUTA DE CANJE PREMIUM
// =======================================================================


// --- Rutas PayPal (sin cambios) ---
app.post('/create-paypal-payment', (req, res) => {
    // ... (sin cambios)
    const plan = req.body.plan; const amount = (plan === 'annual') ? '19.99' : '1.99'; const userId = req.body.userId; if (!userId) return res.status(400).json({ error: "userId es requerido." });
    const create_payment_json = { /* ... */ };
    paypal.payment.create(create_payment_json, (error, payment) => { /* ... */ });
});
app.get('/paypal/success', (req, res) => {
    // ... (sin cambios)
});
app.get('/paypal/cancel', (req, res) => {
    // ... (sin cambios)
});

// --- Ruta Binance (sin cambios) ---
app.post('/create-binance-payment', (req, res) => {
    // ... (sin cambios)
    res.json({ message: 'Pago con Binance simulado.' });
});

// =======================================================================
// === INICIO: LÓGICA DE NOTIFICACIONES PUSH (MODIFICADA) ===
// =======================================================================

/**
 * Envía una notificación push a TODOS los usuarios suscritos al topic 'new_content'.
 * @param {string} title - Título de la notificación.
 * @param {string} body - Cuerpo del mensaje.
 * @param {string} imageUrl - URL de la imagen a mostrar (opcional).
 * @param {string} tmdbId - ID de TMDB del contenido.
 * @param {string} mediaType - 'movie' o 'tv'.
 * @returns {Promise<{success: boolean, message?: string, error?: string, response?: any}>}
*/
async function sendNotificationToTopic(title, body, imageUrl, tmdbId, mediaType) {
    const topic = 'new_content'; // El topic al que se suscriben todos los usuarios

    // Construir el payload de datos (lo que recibe MyFirebaseMessagingService.kt)
    const dataPayload = {
        title: title,
        body: body,
        tmdbId: tmdbId.toString(), // Asegurar que sea string
        mediaType: mediaType,
        // Incluir imageUrl solo si existe
        ...(imageUrl && { imageUrl: imageUrl })
    };

    // Construir el mensaje completo para FCM
    const message = {
        topic: topic,
        data: dataPayload,
        // Opcional: Configuración específica de Android (ej. prioridad)
        android: {
            priority: 'high', // Asegura entrega rápida
             // Puedes añadir configuraciones de notificación aquí si quieres que FCM
             // maneje notificaciones simples cuando la app está en segundo plano,
             // pero es mejor manejarlo todo en MyFirebaseMessagingService con 'data'.
             /*
             notification: {
                 title: title,
                 body: body,
                 imageUrl: imageUrl, // FCM puede intentar mostrarla en algunos casos
                 channelId: "sala_cine_default_channel" // Debe coincidir con el creado en Android
             }
             */
        }
    };

    try {
        console.log(`🚀 Intentando enviar notificación al topic '${topic}'... Payload:`, JSON.stringify(dataPayload));
        const response = await messaging.send(message); // Usar send() para topics
        console.log('✅ Notificación FCM enviada exitosamente al topic:', response);
        return { success: true, message: `Notificación enviada al topic '${topic}'.`, response: response };
    } catch (error) {
        console.error(`❌ Error al enviar notificación FCM al topic '${topic}':`, error);
        return { success: false, error: error.message };
    }
}

// --- NUEVO ENDPOINT: Recibe la orden del bot y llama a sendNotificationToTopic ---
app.post('/api/notify-new-content', async (req, res) => {
    const { title, body, imageUrl, tmdbId, mediaType } = req.body;

    // Validación básica
    if (!title || !body || !tmdbId || !mediaType) {
        return res.status(400).json({ success: false, error: "Faltan datos requeridos (title, body, tmdbId, mediaType)." });
    }

    try {
        const result = await sendNotificationToTopic(title, body, imageUrl, tmdbId, mediaType);
        if (result.success) {
            res.status(200).json({ success: true, message: result.message, details: result.response });
        } else {
            res.status(500).json({ success: false, error: 'Error enviando notificación vía FCM.', details: result.error });
        }
    } catch (error) {
        console.error("Error crítico en /api/notify-new-content:", error);
        res.status(500).json({ success: false, error: "Error interno del servidor al procesar la notificación." });
  }{ // <-- ESTA ES LA LLAVE QUE CORREGÍ (la que habías borrado con "Doy gracias")
});


// --- ENDPOINT OBSOLETO: /api/notify (Comentado, ya no se usará) ---
/*
async function sendPushNotification(tmdbId, mediaType, contentTitle) {
    // ... (código antiguo que buscaba tokens individuales) ...
}
app.post('/api/notify', async (req, res) => {
    // ... (código antiguo que llamaba a la función obsoleta) ...
});
*/

// =======================================================================
// === FIN: LÓGICA DE NOTIFICACIONES PUSH ===
// =======================================================================


// --- Rutas App Update, App Status, Assetlinks (sin cambios) ---
app.get('/api/app-update', (req, res) => {
    // ... (sin cambios)
    const updateInfo = { "latest_version_code": 4, "update_url": "https://google-play.onrender.com", "force_update": true, "update_message": "¡Nueva versión (1.4) disponible! Incluye TV en vivo y mejoras. Actualiza ahora." };
    res.status(200).json(updateInfo);
});
app.get('/api/app-status', (req, res) => {
    // ... (sin cambios)
    const status = { isAppApproved: true, safeContentIds: [11104, 539, 4555, 27205, 33045] };
    res.json(status);
});
app.get('/.well-known/assetlinks.json', (req, res) => {
    // ... (sin cambios)
    res.sendFile('assetlinks.json', { root: __dirname });
});

// =======================================================================
// === INICIO DEL SERVIDOR ===
// =======================================================================
async function startServer() {
    await connectToMongo();

    initializeBot(
        bot,
        db, // Firestore
        mongoDb, // MongoDB
        adminState,
        ADMIN_CHAT_ID,
T MDB_API_KEY,
        RENDER_BACKEND_URL,
        axios
        // extractGodStreamCode // <--- ELIMINADO
    );

    app.listen(PORT, () => {
        console.log(`🚀 Servidor de backend Sala Cine iniciado en puerto ${PORT}`);
        // Manejo de reconexión (sin cambios)
        client.on('close', () => {
            console.warn('Conexión a MongoDB cerrada. Intentando reconectar...');
            setTimeout(connectToMongo, 5000);
        });
    });
}

startServer();

// --- Manejo de errores no capturados (Sin cambios) ---
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
