const express = require('express');
const bodyParser = require('body-parser');
const paypal = require('paypal-rest-sdk');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const axios = require('axios');
const dotenv = require('dotenv');
const url = require('url');
const { MongoClient, ServerApiVersion } = require('mongodb'); // CONEXIÓN MONGO
const godstreamService = require('./GoodStreamServers.js'); // <<< IMPORTAMOS TU NUEVO ARCHIVO

// +++ NUEVA LÍNEA: IMPORTAMOS EL ARCHIVO DEL BOT +++
const initializeBot = require('./bot.js');

const app = express();

dotenv.config();

const PORT = process.env.PORT || 3000;

// === CONFIGURACIONES ===
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SDK);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore(); // USADO PARA USUARIOS/PAGOS/SOLICITUDES/NOTIFICACIONES
const messaging = admin.messaging();

paypal.configure({
    'mode': process.env.PAYPAL_MODE || 'sandbox', // Usa variable de entorno o sandbox por defecto
    'client_id': process.env.PAYPAL_CLIENT_ID,
    'client_secret': process.env.PAYPAL_CLIENT_SECRET
});

const token = process.env.TELEGRAM_BOT_TOKEN;
const GODSTREAM_API_KEY = process.env.GODSTREAM_API_KEY;

const RENDER_BACKEND_URL = process.env.RENDER_EXTERNAL_URL || 'https://serivisios.onrender.com'; // Usa variable de Render o tu URL
const bot = new TelegramBot(token); // Creamos la instancia de bot aquí
// Configura el webhook solo si estás en producción (Render)
if (process.env.NODE_ENV === 'production') {
    const webhookUrl = `${RENDER_BACKEND_URL}/bot${token}`;
    bot.setWebHook(webhookUrl)
       .then(() => console.log(`Webhook configurado en ${webhookUrl}`))
       .catch((err) => console.error('Error configurando webhook:', err));
} else {
    console.log("Webhook no configurado (modo desarrollo). Usando polling.");
    // Si necesitas polling en desarrollo:
    // const bot = new TelegramBot(token, { polling: true });
}


const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT_ID, 10);
const TMDB_API_KEY = process.env.TMDB_API_KEY;

// =======================================================================
// === ¡INTERRUPTOR GLOBAL DE STREAMING! ===
// =======================================================================
//
// CAMBIA ESTE VALOR PARA ACTIVAR O DESACTIVAR TODO EL STREAMING EN LA APP
//
// true  = La app intentará reproducir contenido (si tiene enlaces).
// false = La app mostrará "Mantenimiento" en lugar de "Reproducir".
//
let GLOBAL_STREAMING_ACTIVE = true;
//
// =======================================================================


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

// === FUNCIÓN DE AYUDA MEJORADA PARA EXTRAER CÓDIGO ===
function extractGodStreamCode(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }

    // Caso 1: El admin pegó la URL completa
    if (text.includes('goodstream.one/embed-')) {
        try {
            // Usamos new URL() para parsear de forma segura
            const parsedUrl = new URL(text);
            const pathname = parsedUrl.pathname; // -> /embed-gurkbeec2awc.html
            const parts = pathname.split('-');   // -> ['/embed', 'gurkbeec2awc.html']
            if (parts.length > 1) {
                return parts[parts.length - 1].replace('.html', ''); // -> 'gurkbeec2awc'
            }
        } catch (e) {
            console.error("Error al parsear URL de GodStream:", e.message);
            return text; // Devolver original si falla el parseo
        }
    }

    // Caso 2: El admin pegó solo el código (o es un iframe/otra URL)
    // Si NO es un iframe y NO es una http URL, asumimos que es un código de GodStream
    if (!text.startsWith('<') && !text.startsWith('http')) {
         return text; // Asume que es un file_code (ej: 'gurkbeec2awc')
    }

    // Caso 3: Es un iframe u otra URL (Dood, Voe, etc.)
    return text;
}
// === FIN CONFIGURACIÓN DE MONGODB ===


// === ESTADO DEL BOT ===
// Lo mantenemos aquí para que la instancia del bot lo pueda usar
const adminState = {};

// === MIDDLEWARE ===
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Configuración básica de CORS
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Permite cualquier origen
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); // Métodos permitidos
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Cabeceras permitidas

    // Manejar preflight requests (OPTIONS)
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// === RUTAS DEL SERVIDOR WEB ===
app.get('/', (req, res) => {
  res.send('¡El bot y el servidor de Sala Cine están activos!');
});

// Ruta para procesar actualizaciones del bot (solo si usas webhook)
// ESTO SE QUEDA AQUÍ porque es una ruta de Express (app.post)
if (process.env.NODE_ENV === 'production') {
    app.post(`/bot${token}`, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });
}


// -------------------------------------------------------------------------
// === RUTA CRÍTICA: MANEJO DE APP LINK Y REDIRECCIÓN DE FALLO ===
// -------------------------------------------------------------------------

app.get('/app/details/:tmdbId', (req, res) => {
    const tmdbId = req.params.tmdbId;

    // Prioridad 1: Intentar redirigir a la URL de descarga personalizada si está definida
    if (process.env.APP_DOWNLOAD_URL) {
        console.log(`App Nativa no instalada o enlace no manejado. Redirigiendo a la Tienda Personalizada: ${process.env.APP_DOWNLOAD_URL}`);
        return res.redirect(302, process.env.APP_DOWNLOAD_URL);
    }

    // Prioridad 2: Fallback a la Telegram Mini App si la URL de descarga no está definida
    if (process.env.TELEGRAM_MINIAPP_URL) {
        const tmaLink = process.env.TELEGRAM_MINIAPP_URL + '?startapp=' + tmdbId;
        console.log('APP_DOWNLOAD_URL no definida. Redirigiendo al fallback de la TMA.');
        return res.redirect(302, tmaLink);
    }

    // Si ninguna URL está definida, devolver un error
    console.error('Ni APP_DOWNLOAD_URL ni TELEGRAM_MINIAPP_URL están definidas en las variables de entorno.');
    res.status(404).send('No se encontró la aplicación de destino ni un enlace de descarga o fallback.');
});

// -----------------------------------------------------------
// === RUTA PARA RECIBIR SOLICITUDES DESDE LA APP ===
// -----------------------------------------------------------
app.post('/request-movie', async (req, res) => {
    const { title, poster_path, tmdbId, priority } = req.body; // Se añade 'priority'
    const posterUrl = poster_path ? `https://image.tmdb.org/t/p/w500${poster_path}` : 'https://placehold.co/500x750?text=No+Poster';

    // Construir mensaje más detallado
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
        // Enviar notificación al admin por Telegram
        await bot.sendPhoto(ADMIN_CHAT_ID, posterUrl, {
            caption: message,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{
                    text: '✅ Agregar ahora',
                    callback_data: `solicitud_${tmdbId}` // Callback para iniciar el flujo de adición
                }]]
            }
        });

        // Opcional: Guardar la solicitud en Firestore (si quieres mantener un historial)
        // await db.collection('userRequests').add({ // Cambiado a 'userRequests' para claridad
        //      tmdbId: tmdbId,
        //      title: title,
        //      userId: req.body.userId, // Asegúrate que la app envíe userId si guardas
        //      priority: priority,
        //      status: 'pending',
        //      requestedAt: admin.firestore.FieldValue.serverTimestamp()
        // });

        res.status(200).json({ message: 'Solicitud enviada al administrador.' });
    } catch (error) {
        console.error("Error al procesar la solicitud:", error);
        res.status(500).json({ error: 'Error al enviar la notificación o guardar la solicitud.' });
    }
});

// =======================================================================
// === ¡NUEVA RUTA! ENDPOINT DE ESTADO DE STREAMING GLOBAL ===
// =======================================================================
/**
 * Esta es la ruta que la app (script.js) consultará al iniciar.
 * Devuelve el valor de la variable 'GLOBAL_STREAMING_ACTIVE'
 * que definiste manualmente al inicio del archivo.
 */
app.get('/api/streaming-status', (req, res) => {
    console.log(`[Status Check] Devolviendo estado de streaming global: ${GLOBAL_STREAMING_ACTIVE}`);
    res.status(200).json({
        isStreamingActive: GLOBAL_STREAMING_ACTIVE
    });
});
// =======================================================================
// === FIN DE LA NUEVA RUTA
// =======================================================================


// =======================================================================
// === RUTA OPTIMIZADA PARA OBTENER DATOS DE PELÍCULA/SERIE (MongoDB) ===
// =======================================================================
/**
 * ¡CÓDIGO CORREGIDO!
 * Esta ruta ahora comprueba primero la colección de SERIES.
 * Si encuentra una serie con episodios válidos, devuelve isAvailable: true.
 * Esto evita que las "entradas fantasma" en la colección de películas causen
 * que las series aparezcan como "no disponibles".
 */
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
        
        let docMovie = null;
        let docSeries = null;
        let views = 0;
        let likes = 0;
        let isAvailable = false;

        // --- LÓGICA CORREGIDA ---
        // 1. Siempre chequear si existe como SERIE primero.
        const seriesProjection = { projection: { views: 1, likes: 1, seasons: 1 } };
        docSeries = await seriesCollection.findOne({ tmdbId: id.toString() }, seriesProjection);

        if (docSeries) {
            // Si se encuentra como serie, calcular su disponibilidad.
            views = docSeries.views || 0;
            likes = docSeries.likes || 0;
            if (docSeries.seasons) {
                isAvailable = Object.values(docSeries.seasons).some(season =>
                    season && season.episodes && Object.values(season.episodes).some(ep =>
                        (ep.freeEmbedCode && ep.freeEmbedCode !== '') ||
                        (ep.proEmbedCode && ep.proEmbedCode !== '')
                    )
                );
            }
            // IMPORTANTE: Si está disponible como serie, retornamos DE INMEDIATO.
            // Esto ignora cualquier "entrada fantasma" en la colección de películas.
            if (isAvailable) {
                return res.status(200).json({
                    views: views,
                    likes: likes,
                    isAvailable: true
                });
            }
            // Si no está disponible como serie (ej. 0 episodios), seguimos por si acaso es una película.
        }

        // 2. Si NO se encontró como serie (o no tenía episodios), chequear como PELÍCULA.
        const movieProjection = { projection: { views: 1, likes: 1, freeEmbedCode: 1, proEmbedCode: 1 } };
        docMovie = await movieCollection.findOne({ tmdbId: id.toString() }, movieProjection);

        if (docMovie) {
            // Si se encuentra como película, calcular su disponibilidad.
            // Usamos estas métricas solo si no las encontramos en series.
            if (views === 0) views = docMovie.views || 0;
            if (likes === 0) likes = docMovie.likes || 0;
            
            isAvailable = !!(docMovie.freeEmbedCode || docMovie.proEmbedCode);
            
            return res.status(200).json({
                views: views,
                likes: likes,
                isAvailable: isAvailable
            });
        }
        
        // 3. Si no se encontró en NINGUNA colección (o no tenía enlaces en ninguna)
        res.status(200).json({ 
            views: views, // Retorna métricas de serie si se encontró, si no 0
            likes: likes, // Retorna métricas de serie si se encontró, si no 0
            isAvailable: false 
        });

    } catch (error) {
        console.error(`Error crítico al obtener los datos consolidados en MongoDB:`, error);
        res.status(500).json({ error: "Error interno del servidor al obtener los datos." });
    }
});

// =======================================================================
// === RUTA PARA OBTENER CÓDIGO EMBED (CON LÓGICA PRO/FREE Y FALLBACK) ===
// =======================================================================
app.get('/api/get-embed-code', async (req, res) => {
  if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

  const { id, season, episode, isPro } = req.query; // isPro viene como 'true' o 'false' (string)
  if (!id) return res.status(400).json({ error: "ID no proporcionado" });

  try {
    const mediaType = season && episode ? 'series' : 'movies';
    const collectionName = (mediaType === 'movies') ? 'media_catalog' : 'series_catalog';
    const doc = await mongoDb.collection(collectionName).findOne({ tmdbId: id });

    if (!doc) return res.status(404).json({ error: `${mediaType} no encontrada.` });

    // 1. Obtener el código/iframe de la base de datos
    let embedCode;
    if (mediaType === 'movies') {
        embedCode = isPro === 'true' ? doc.proEmbedCode : doc.freeEmbedCode;
    } else {
        const episodeData = doc.seasons?.[season]?.episodes?.[episode];
        embedCode = isPro === 'true' ? episodeData?.proEmbedCode : episodeData?.freeEmbedCode;
    }

    if (!embedCode) {
        return res.status(404).json({ error: `No se encontró código de reproductor.` });
    }

    // 2. Comprobar si es un código de GodStream
    // (Asumimos que es GodStream si NO es un iframe y NO es una URL completa)
    const isGodStreamCode = !embedCode.startsWith('<') && !embedCode.startsWith('http');

    // 3. Aplicar la lógica de PRO vs GRATIS
    if (isGodStreamCode) {
        const fileCode = embedCode; // ej: 'gurkbeec2awc'

        if (isPro === 'true') {
            // --- Lógica PREMIUM ---
            // Llama al servicio, que ya maneja el fallback
            // Usamos la función importada de GoodStreamServers.js
            const streamUrl = await godstreamService.getGodStreamLink(fileCode, GODSTREAM_API_KEY);
            return res.json({ embedCode: streamUrl }); // Devuelve MP4 o Embed (fallback)

        } else {
            // --- Lógica GRATIS ---
            // Devuelve solo el reproductor embed, sin llamar a la API
            const freeEmbedUrl = `https://goodstream.one/embed-${fileCode}.html`;
            return res.json({ embedCode: freeEmbedUrl });
        }

    } else {
        // --- Lógica para otros reproductores (IFRAMEs, etc.) ---
        // Si no es GodStream (ej: un <iframe>), devuélvelo tal cual
        return res.json({ embedCode });
    }

  } catch (error) {
    console.error("Error crítico get-embed-code:", error);
    res.status(500).json({ error: "Error interno" });
  }
});


// =======================================================================
// === RUTA PARA VERIFICAR DISPONIBILIDAD DE TEMPORADA (MongoDB) ===
// =======================================================================
app.get('/api/check-season-availability', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });
    const { id, season } = req.query;
    if (!id || !season) return res.status(400).json({ error: "ID y temporada son requeridos." });

    try {
        const seriesCollection = mongoDb.collection('series_catalog');
        const episodesField = `seasons.${season}.episodes`;
        const doc = await seriesCollection.findOne(
            { tmdbId: id.toString() },
            { projection: { [episodesField]: 1 } }
        );

        if (!doc?.seasons?.[season]?.episodes) {
            return res.status(200).json({ exists: false, availableEpisodes: {} });
        }

        const episodesData = doc.seasons[season].episodes;
        const availabilityMap = {};
        for (const episodeNum in episodesData) {
            const ep = episodesData[episodeNum];
            availabilityMap[episodeNum] = !!(ep.proEmbedCode || ep.freeEmbedCode);
        }
        res.status(200).json({ exists: true, availableEpisodes: availabilityMap });
    } catch (error) {
        console.error("Error check-season-availability:", error);
        res.status(500).json({ error: "Error interno." });
    }
});


// =======================================================================
// === RUTAS DE MÉTRICAS (Vistas y Likes - MongoDB) ===
// =======================================================================
// --- Obtener Métrica ---
app.get('/api/get-metrics', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    const { id, field } = req.query;
    if (!id || !field || (field !== 'views' && field !== 'likes')) {
        return res.status(400).json({ error: "ID y campo ('views' o 'likes') requeridos." });
    }
    try {
        let doc = await mongoDb.collection('media_catalog').findOne({ tmdbId: id.toString() }, { projection: { [field]: 1 } });
        if (!doc) doc = await mongoDb.collection('series_catalog').findOne({ tmdbId: id.toString() }, { projection: { [field]: 1 } });
        res.status(200).json({ count: doc?.[field] || 0 });
    } catch (error) {
        console.error(`Error get-metrics (${field}):`, error);
        res.status(500).json({ error: "Error interno." });
    }
});

// --- Incrementar Vistas ---
app.post('/api/increment-views', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    const { tmdbId } = req.body;
    if (!tmdbId) return res.status(400).json({ error: "tmdbId requerido." });
    try {
        const update = { $inc: { views: 1 }, $setOnInsert: { likes: 0 } };
        const options = { upsert: true };
        let result = await mongoDb.collection('media_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options);
        if (result.matchedCount === 0 && result.upsertedCount === 0) { // Si no era película y no se insertó
            await mongoDb.collection('series_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options);
        }
        res.status(200).json({ message: 'Vista registrada.' });
    } catch (error) {
        console.error("Error increment-views:", error);
        res.status(500).json({ error: "Error interno." });
    }
});

// --- Incrementar Likes ---
app.post('/api/increment-likes', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    const { tmdbId } = req.body;
    if (!tmdbId) return res.status(400).json({ error: "tmdbId requerido." });
    try {
        const update = { $inc: { likes: 1 }, $setOnInsert: { views: 0 } };
        const options = { upsert: true };
        let result = await mongoDb.collection('media_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options);
        if (result.matchedCount === 0 && result.upsertedCount === 0) {
            await mongoDb.collection('series_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options);
        }
        res.status(200).json({ message: 'Like registrado.' });
    } catch (error) {
        console.error("Error increment-likes:", error);
        res.status(500).json({ error: "Error interno." });
    }
});

// =======================================================================
// === RUTAS PARA AGREGAR/ACTUALIZAR CONTENIDO (MongoDB) ===
// =======================================================================
// --- Agregar/Actualizar Película ---
app.post('/add-movie', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    try {
        const { tmdbId, title, poster_path, freeEmbedCode, proEmbedCode, isPremium, overview } = req.body;
        if (!tmdbId) return res.status(400).json({ error: 'tmdbId requerido.' });
        const updateQuery = {
            $set: { title, poster_path, overview, freeEmbedCode, proEmbedCode, isPremium },
            $setOnInsert: { tmdbId: tmdbId.toString(), views: 0, likes: 0 }
        };
        await mongoDb.collection('media_catalog').updateOne({ tmdbId: tmdbId.toString() }, updateQuery, { upsert: true });
        res.status(200).json({ message: 'Película agregada/actualizada.' });
    } catch (error) {
        console.error("Error add-movie:", error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

// --- Agregar/Actualizar Episodio de Serie ---
app.post('/add-series-episode', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    try {
        const { tmdbId, title, poster_path, overview, seasonNumber, episodeNumber, freeEmbedCode, proEmbedCode, isPremium } = req.body;
        if (!tmdbId || !seasonNumber || !episodeNumber) return res.status(400).json({ error: 'tmdbId, seasonNumber y episodeNumber requeridos.' });

        const episodePath = `seasons.${seasonNumber}.episodes.${episodeNumber}`;
        const updateData = {
            $set: { title, poster_path, overview, isPremium,
                    [`seasons.${seasonNumber}.name`]: `Temporada ${seasonNumber}`, // Asegura que exista el objeto season
                    [episodePath + '.freeEmbedCode']: freeEmbedCode,
                    [episodePath + '.proEmbedCode']: proEmbedCode },
            $setOnInsert: { tmdbId: tmdbId.toString(), views: 0, likes: 0 }
        };
        await mongoDb.collection('series_catalog').updateOne({ tmdbId: tmdbId.toString() }, updateData, { upsert: true });
        res.status(200).json({ message: `Episodio S${seasonNumber}E${episodeNumber} agregado/actualizado.` });
    } catch (error) {
        console.error("Error add-series-episode:", error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

// =======================================================================
// === RUTA CORREGIDA PARA ACTIVAR PREMIUM CON MONEDAS ===
// =======================================================================
app.post('/api/redeem-premium-time', async (req, res) => {
    const { userId, daysToAdd } = req.body;

    // Validación básica
    if (!userId || !daysToAdd) {
        return res.status(400).json({ success: false, error: 'userId y daysToAdd son requeridos.' });
    }

    const days = parseInt(daysToAdd, 10);
    if (isNaN(days) || days <= 0) {
        return res.status(400).json({ success: false, error: 'daysToAdd debe ser un número positivo.' });
    }

    try {
        // Referencia al documento del usuario en Firestore
        const userDocRef = db.collection('users').doc(userId);
        const docSnap = await userDocRef.get(); // Leer el documento actual

        let newExpiryDate;
        const now = new Date(); // Fecha y hora actuales

        if (docSnap.exists && docSnap.data().premiumExpiry) {
            // --- Lógica de Extensión ---
            let currentExpiry;
            const expiryData = docSnap.data().premiumExpiry;
            // Manejar Timestamp de Firestore
            if (expiryData.toDate && typeof expiryData.toDate === 'function') {
                currentExpiry = expiryData.toDate();
            }
            // Manejar Número (milisegundos)
            else if (typeof expiryData === 'number') {
                currentExpiry = new Date(expiryData);
            }
            // Manejar String (fecha ISO)
            else if (typeof expiryData === 'string') {
                currentExpiry = new Date(expiryData);
            } else {
                console.warn(`Formato de premiumExpiry inesperado para ${userId}. Iniciando desde ahora.`);
                currentExpiry = now; // Fallback: empezar desde ahora si el formato es raro
            }


            if (currentExpiry > now) {
                // Si la suscripción actual está activa, añade días al final de la fecha existente
                newExpiryDate = new Date(currentExpiry.getTime() + days * 24 * 60 * 60 * 1000);
            } else {
                // Si la suscripción expiró, empieza desde hoy
                newExpiryDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
            }
        } else {
            // --- Lógica de Nueva Suscripción ---
            // Si es la primera vez o no tiene fecha, empieza desde hoy
            newExpiryDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        }

        // --- Actualiza AMBOS campos en Firebase ---
        // Usamos set con merge:true para crear/actualizar sin borrar otros campos
        await userDocRef.set({
            isPro: true,
            premiumExpiry: newExpiryDate // Guardamos como objeto Date (Admin SDK lo convierte a Timestamp)
        }, { merge: true });

        console.log(`✅ Premium activado/extendido para ${userId} hasta ${newExpiryDate.toISOString()}`);
        res.status(200).json({ success: true, message: `Premium activado por ${days} días.` });

    } catch (error) {
        console.error(`❌ Error al activar Premium para ${userId} via monedas:`, error);
        res.status(500).json({ success: false, error: 'Error interno del servidor al actualizar el estado del usuario.' });
    }
});
// =======================================================================
// === FIN DE LA RUTA CORREGIDA ===
// =======================================================================


// =======================================================================
// === RUTAS PAYPAL (Usan Firestore para estado PRO y Expiry) ===
// =======================================================================
app.post('/create-paypal-payment', (req, res) => {
    const plan = req.body.plan; // 'monthly' o 'annual'
    const amount = (plan === 'annual') ? '19.99' : '1.99';
    const userId = req.body.userId; // ID de Firebase Auth
    if (!userId) return res.status(400).json({ error: "userId es requerido." });

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
            "invoice_number": `${userId}|${plan}` // Guarda userId y plan aquí, separados por |
        }]
    };

    paypal.payment.create(create_payment_json, (error, payment) => {
        if (error) {
            console.error("Error PayPal create:", error.response ? error.response.details : error);
            res.status(500).json({ error: "Error creando pago PayPal." });
        } else {
            const approvalUrl = payment.links.find(link => link.rel === 'approval_url');
            if (approvalUrl) {
                res.json({ approval_url: approvalUrl.href });
            } else {
                res.status(500).json({ error: "URL de aprobación no encontrada." });
            }
        }
    });
});

app.get('/paypal/success', (req, res) => {
    const payerId = req.query.PayerID;
    const paymentId = req.query.paymentId;
    if (!payerId || !paymentId) return res.send('<html><body><h1>❌ ERROR: Faltan parámetros PayerID o paymentId.</h1></body></html>');

    paypal.payment.execute(paymentId, { "payer_id": payerId }, async (error, payment) => {
        if (error) {
            console.error("Error PayPal execute:", error.response ? error.response.details : error);
            return res.send('<html><body><h1>❌ ERROR: El pago no pudo ser procesado.</h1></body></html>');
        }

        if (payment.state === 'approved' || payment.state === 'completed') {
            const invoice_number = payment.transactions?.[0]?.invoice_number; // Recupera userId|plan
            if (invoice_number) {
                 const [userId, plan] = invoice_number.split('|'); // Separa userId y plan

                 if(userId && plan) {
                     try {
                         const userDocRef = db.collection('users').doc(userId);
                         const docSnap = await userDocRef.get();
                         const daysToAdd = (plan === 'annual') ? 365 : 30;
                         let newExpiryDate;
                         const now = new Date();

                         if (docSnap.exists && docSnap.data().premiumExpiry) {
                             let currentExpiry;
                             const expiryData = docSnap.data().premiumExpiry;
                             if (expiryData.toDate) currentExpiry = expiryData.toDate();
                             else if (typeof expiryData === 'number') currentExpiry = new Date(expiryData);
                             else if (typeof expiryData === 'string') currentExpiry = new Date(expiryData);
                             else currentExpiry = now;

                             if (currentExpiry > now) {
                                 newExpiryDate = new Date(currentExpiry.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
                             } else {
                                 newExpiryDate = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
                             }
                         } else {
                             newExpiryDate = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
                         }

                         // FIREBASE: Actualiza el estado PRO y la fecha de expiración
                         await userDocRef.set({
                             isPro: true,
                             premiumExpiry: newExpiryDate
                         }, { merge: true });

                         res.send(`<html><body><h1>✅ ¡Pago Exitoso! Cuenta Premium (${plan}) Activada hasta ${newExpiryDate.toLocaleDateString()}.</h1><p>Vuelve a la aplicación.</p></body></html>`);

                     } catch (dbError) {
                         console.error("Error Firestore update:", dbError);
                         res.send('<html><body><h1>⚠️ Advertencia: Pago recibido, pero la cuenta no se activó automáticamente. Contacta soporte.</h1></body></html>');
                     }
                 } else {
                     console.error("Error: userId o plan no encontrado en invoice_number de PayPal:", invoice_number);
                     res.send('<html><body><h1>✅ ¡Pago Exitoso! Pero hubo un error al obtener tu ID o plan. Contacta a soporte para activar tu Premium.</h1></body></html>');
                 }
            } else {
                 console.error("Error: invoice_number no encontrado en la transacción de PayPal.");
                 res.send('<html><body><h1>✅ ¡Pago Exitoso! Pero hubo un error al obtener tu ID de usuario. Contacta a soporte para activar tu Premium.</h1></body></html>');
            }
        } else {
            res.send(`<html><body><h1>❌ ERROR: El pago no fue aprobado (Estado: ${payment.state}).</h1></body></html>`);
        }
    });
});

app.get('/paypal/cancel', (req, res) => {
    res.send('<html><body><h1>Pago con PayPal cancelado.</h1></body></html>');
});

// Ruta simulada para Binance
app.post('/create-binance-payment', (req, res) => {
    res.json({ message: 'Pago con Binance simulado.' });
});

// =======================================================================
// === NOTIFICACIONES PUSH (Firebase Messaging) ===
// =======================================================================
async function sendPushNotification(tmdbId, mediaType, contentTitle) {
    try {
        // Obtener tokens FCM desde Firestore (colección 'users')
        const tokensSnapshot = await db.collection('users').select('fcmToken').get();
        const registrationTokens = tokensSnapshot.docs
            .map(doc => doc.data().fcmToken)
            .filter(token => token); // Filtrar tokens vacíos o nulos

        if (registrationTokens.length === 0) {
            console.log("No se encontraron tokens FCM.");
            return { success: true, message: "No hay tokens registrados." };
        }

        const message = {
            notification: {
                title: `🎉 ¡Nuevo Contenido Agregado!`,
                // image: "https://imgur.com/a/JbH6p1J", // REMOVED - Check FCM docs for image support
                body: `¡Ya puedes ver ${contentTitle} en Sala Cine!`,
            },
            data: { // Datos adicionales para manejar la acción en la app
                tmdbId: tmdbId.toString(),
                mediaType: mediaType,
                action: 'open_content' // Acción personalizada
            },
            tokens: registrationTokens // Array de tokens a los que enviar
        };

        // Enviar el mensaje a múltiples dispositivos
        const response = await messaging.sendEachForMulticast(message);
        console.log('Notificación FCM enviada:', response.successCount, 'éxitos,', response.failureCount, 'fallos.');

        // Opcional: Manejar tokens inválidos/desactualizados si hay fallos
        if (response.failureCount > 0) {
            const failedTokens = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    failedTokens.push(registrationTokens[idx]);
                    // Podrías eliminar estos tokens de tu base de datos aquí
                    console.error('Error enviando a token:', registrationTokens[idx], resp.error);
                }
            });
            // Lógica para eliminar failedTokens de Firestore...
        }

        return { success: true, response: response };

    } catch (error) {
        console.error("Error al enviar notificación FCM:", error);
        return { success: false, error: error.message };
    }
}

// --- Endpoint para Disparar Notificaciones Push ---
app.post('/api/notify', async (req, res) => {
    const { tmdbId, mediaType, title } = req.body;
    if (!tmdbId || !mediaType || !title) {
        return res.status(400).json({ error: "Faltan tmdbId, mediaType o title." });
    }
    try {
        const result = await sendPushNotification(tmdbId, mediaType, title);
        if (result.success) {
            res.status(200).json({ message: 'Notificaciones programadas.', details: result.response });
        } else {
            res.status(500).json({ error: 'Error enviando notificaciones.', details: result.error });
        }
    } catch (error) {
        console.error("Error en /api/notify:", error);
        res.status(500).json({ error: "Error interno." });
    }
});

// =======================================================================
// === LÓGICA DEL BOT DE TELEGRAM (Movida a bot.js) ===
// =======================================================================

// +++ TODA LA LÓGICA DEL BOT FUE MOVIDA A bot.js +++

// +++ NUEVA LÍNEA: INICIALIZAMOS EL BOT PASANDO LAS DEPENDENCIAS +++
initializeBot(
    bot,                // La instancia de TelegramBot
    db,                 // La conexión a Firestore (admin.firestore())
    mongoDb,            // La conexión a MongoDB (mongoDb)
    adminState,         // El objeto de estado (adminState)
    ADMIN_CHAT_ID,      // El ID del chat de admin
    TMDB_API_KEY,       // La clave de TMDB
    RENDER_BACKEND_URL, // La URL del backend
    axios,              // La instancia de axios
    extractGodStreamCode // La función de ayuda
);

// =======================================================================
// === FIN: LÓGICA DEL BOT ===
// =======================================================================


// =======================================================================
// === RUTAS ADICIONALES (App Update, App Status, Assetlinks) ===
// =======================================================================
app.get('/api/app-update', (req, res) => {
 const updateInfo = {
  "latest_version_code": 4, // Actualiza esto con tu versionCode más reciente
  "update_url": "https://google-play.onrender.com", // Tu URL de descarga/tienda
  "force_update": true, // Poner en true para obligar la actualización
  "update_message": "¡Nueva versión (1.4) disponible! Incluye TV en vivo y mejoras. Actualiza ahora."
 };
 res.status(200).json(updateInfo);
});

// ESTA RUTA ES DEL SISTEMA ANTIGUO (MODO REVISIÓN), YA NO LA USAREMOS
// PERO LA DEJAMOS POR SI ACASO. AHORA SE USA /api/streaming-status
app.get('/api/app-status', (req, res) => {
    const status = {
        isAppApproved: true, // Ya no tiene efecto en la lógica nueva
        safeContentIds: [11104, 539, 4555, 27205, 33045]
    };
    res.json(status);
});

app.get('/.well-known/assetlinks.json', (req, res) => {
    res.sendFile('assetlinks.json', { root: __dirname });
});

// =======================================================================
// === INICIO DEL SERVIDOR ===
// =======================================================================
app.listen(PORT, () => {
    console.log(`Servidor de backend Sala Cine iniciado en puerto ${PORT}`);
    // Asegúrate de reconectar a Mongo si la conexión se pierde (lógica más avanzada)
    client.on('close', () => {
        console.warn('Conexión a MongoDB cerrada. Intentando reconectar...');
        setTimeout(connectToMongo, 5000); // Reintenta conectar después de 5 segundos
    });
});

// --- Manejo de errores no capturados ---
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Considera cerrar el proceso de forma controlada si es necesario
  // process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Considera cerrar el proceso de forma controlada si es necesario
  // process.exit(1);
});
