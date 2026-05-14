const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const axios = require('axios'); 
const dotenv = require('dotenv');
const url = require('url');
const { MongoClient, ServerApiVersion } = require('mongodb');
const initializeBot = require('./bot.js');
const crypto = require('crypto');
const cron = require('node-cron');
const NodeCache = require('node-cache');
const fs = require('fs'); 
const path = require('path'); 
const initZyroEngine = require('./zyroEngine.js');

// --- CACHÉS ---
const embedCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
const countsCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const tmdbCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
const recentCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 }); 
const historyCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const localDetailsCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 }); 
const pinnedCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const PINNED_CACHE_KEY = 'pinned_content_top';
const kdramaCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const KDRAMA_CACHE_KEY = 'kdrama_content_list';
const catalogCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const CATALOG_CACHE_KEY = 'full_catalog_list'; 
const RECENT_CACHE_KEY = 'recent_content_main'; 
const userCache = new NodeCache({ stdTTL: 21600, checkperiod: 1200 });
const zyroCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const requestsCache = new NodeCache({ stdTTL: 604800, checkperiod: 3600 }); 
const REQUESTS_CACHE_KEY = 'all_movie_requests';

const app = express();
dotenv.config();
const PORT = process.env.PORT || 3000;

// --- FIREBASE INIT ---
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SDK);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("✅ Firebase Admin SDK inicializado correctamente.");
} catch (error) {
    console.error("❌ ERROR FATAL: No se pudo parsear FIREBASE_ADMIN_SDK. Verifica la variable de entorno.", error);
}
const db = admin.firestore();
const messaging = admin.messaging();

const token = process.env.TELEGRAM_BOT_TOKEN;
const RENDER_BACKEND_URL = process.env.RENDER_EXTERNAL_URL || 'https://serivisios.onrender.com';
const bot = new TelegramBot(token);

const ADMIN_CHAT_ID_PRIMARY = parseInt(process.env.ADMIN_CHAT_ID, 10);
const ADMIN_CHAT_ID_2 = process.env.ADMIN_CHAT_ID_2 ? parseInt(process.env.ADMIN_CHAT_ID_2, 10) : null;
const ADMIN_CHAT_IDS = [ADMIN_CHAT_ID_PRIMARY];
if (ADMIN_CHAT_ID_2 && !isNaN(ADMIN_CHAT_ID_2)) {
    ADMIN_CHAT_IDS.push(ADMIN_CHAT_ID_2);
}

const TMDB_API_KEY = process.env.TMDB_API_KEY;

let GLOBAL_STREAMING_ACTIVE = true;
const BUILD_ID_UNDER_REVIEW = 49; 

// --- MONGODB CONFIG ---
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'sala_cine';

const REVENUE_SETTINGS = {
    estreno_peli: 1.00,
    catalogo_peli: 0.50,
    episodio_serie: 0.25,
    limit_daily: 10.00,
    limit_monthly: 30.00,
    months_to_be_estreno: 6
};

const COLL_REVENUE = 'uploader_revenue';
const COLL_DAILY_STATS = 'uploader_daily_stats';

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
        
        await mongoDb.collection(COLL_REVENUE).createIndex({ uploaderId: 1, timestamp: -1 });
        await mongoDb.collection(COLL_REVENUE).createIndex({ tmdbId: 1, season: 1, episode: 1 });
        await mongoDb.collection(COLL_DAILY_STATS).createIndex({ uploaderId: 1, dayId: 1 }, { unique: true });
        await mongoDb.collection(COLL_DAILY_STATS).createIndex({ uploaderId: 1, monthId: 1 });
        
        console.log("✅ Índices de MongoDB para ganancias verificados.");
        return mongoDb;
    } catch (e) {
        console.error("❌ Error al conectar a MongoDB Atlas:", e);
        process.exit(1);
    }
}
const adminState = {};
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- TRÁFICO Y MIDDLEWARES ---
let trafficCount = 0;
let lastTrafficAlert = 0;
const TRAFFIC_THRESHOLD = 300; 
setInterval(() => { trafficCount = 0; }, 60000);

app.use((req, res, next) => {
    trafficCount++;
    if (trafficCount > TRAFFIC_THRESHOLD && (Date.now() - lastTrafficAlert > 3600000)) {
        lastTrafficAlert = Date.now();
        if (ADMIN_CHAT_ID_2) {
            bot.sendMessage(ADMIN_CHAT_ID_2, '🔥 ¡Tráfico alto detectado ahora! El CPM está subiendo. ¡Es el momento ideal para subir contenido y maximizar ganancias! 🚀');
        }
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-salacine-internal-token');
    if (req.method === 'OPTIONS') { return res.sendStatus(200); }
    next();
});

try {
    require('./bridge.js')(app);
    console.log("✅ Módulo Bridge (Landing Page) cargado correctamente.");
} catch (error) {
    console.warn("⚠️ Advertencia: No se pudo cargar bridge.js:", error.message);
}

// --- MIDDLEWARES COMPARTIDOS ---
async function verifyIdToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(); 
    }
    const idToken = authHeader.split(' ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.uid = decodedToken.uid;
        req.email = decodedToken.email;
        next();
    } catch (error) {
        next();
    }
}

function verifyInternalAdmin(req, res, next) {
    if (req.uid) return next();
    const internalToken = req.headers['x-salacine-internal-token'];
    if (internalToken && internalToken === process.env.INTERNAL_SECURITY_TOKEN) return next();
    return res.status(403).json({ error: "Acceso denegado. Autenticación de administrador requerida." });
}

// --- FUNCIONES COMPARTIDAS ---
async function calculateAndRecordRevenue({ uploaderId, tmdbId, mediaType, title, season = null, episode = null }) {
    const uploaderNum = Number(uploaderId);

    if (!mongoDb || isNaN(uploaderNum) || !ADMIN_CHAT_IDS.includes(uploaderNum)) {
        return { appliedRevenue: 0, status: 'skipped_not_admin' };
    }

    const existingQuery = { tmdbId: tmdbId.toString(), season, episode };
    const existingEntry = await mongoDb.collection(COLL_REVENUE).findOne(existingQuery);
    if (existingEntry) {
        console.log(`[Revenue] Contenido ya pagado previamente: ${title} (${tmdbId})`);
        return { appliedRevenue: 0, status: 'skipped_duplicate' };
    }

    let contentType = 'catalogo';
    let basePrice = 0;
    const now = new Date();
    const dayId = now.toISOString().split('T')[0];
    const monthId = dayId.substring(0, 7);

    try {
        if (mediaType === 'movie') {
            const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-MX`;
            try {
                const resp = await axios.get(tmdbUrl);
                const releaseDateStr = resp.data.release_date;
                if (releaseDateStr) {
                    const releaseDate = new Date(releaseDateStr);
                    const diffMonths = (now.getFullYear() - releaseDate.getFullYear()) * 12 + (now.getMonth() - releaseDate.getMonth());
                    
                    if (diffMonths < REVENUE_SETTINGS.months_to_be_estreno) {
                        contentType = 'estreno';
                        basePrice = REVENUE_SETTINGS.estreno_peli;
                    } else {
                        contentType = 'catalogo';
                        basePrice = REVENUE_SETTINGS.catalogo_peli;
                    }
                } else {
                    basePrice = REVENUE_SETTINGS.catalogo_peli;
                }
            } catch (tmdbErr) {
                console.error(`[Revenue] Error consultando TMDB para ${tmdbId}:`, tmdbErr.message);
                basePrice = REVENUE_SETTINGS.catalogo_peli; 
            }
        } else {
            contentType = 'episodio';
            basePrice = REVENUE_SETTINGS.episodio_serie;
        }

        let dailyStats = await mongoDb.collection(COLL_DAILY_STATS).findOne({ uploaderId: uploaderNum, dayId });
        let currentDaily = dailyStats ? (dailyStats.today_earned || 0) : 0;

        const monthlyDocs = await mongoDb.collection(COLL_DAILY_STATS)
            .find({ uploaderId: uploaderNum, monthId })
            .project({ today_earned: 1 })
            .toArray();
        
        const currentMonthEarned = monthlyDocs.reduce((sum, doc) => sum + (doc.today_earned || 0), 0);

        let finalEarned = 0;
        let limitReached = false;
        let status = '';
        let rateApplied = "100%";

        if (currentMonthEarned >= REVENUE_SETTINGS.limit_monthly) {
            finalEarned = 0;
            limitReached = true;
            status = 'limit_monthly_reached';
        }
        else if (currentDaily >= REVENUE_SETTINGS.limit_daily) {
            finalEarned = 0; 
            limitReached = true;
            status = 'limit_daily_reached';
        } else {
            let currentBase = basePrice;
            if (currentDaily >= 9.00) {
                currentBase = basePrice * 0.25;
                rateApplied = "25%";
            } else if (currentDaily >= 7.00) {
                currentBase = basePrice * 0.50;
                rateApplied = "50%";
            }

            if (currentDaily + currentBase > REVENUE_SETTINGS.limit_daily) {
                finalEarned = REVENUE_SETTINGS.limit_daily - currentDaily;
            } else {
                finalEarned = currentBase;
            }
            status = 'applied';
        }

        if (!dailyStats) {
            await mongoDb.collection(COLL_DAILY_STATS).insertOne({
                uploaderId: uploaderNum,
                dayId,
                monthId,
                today_raw_potential: basePrice,
                today_content_count: 1,
                [`month_${contentType}_count`]: 1,
                today_earned: finalEarned
            });
        } else {
            await mongoDb.collection(COLL_DAILY_STATS).updateOne(
                { _id: dailyStats._id },
                { 
                    $inc: { 
                        today_raw_potential: basePrice,
                        today_content_count: 1,
                        [`month_${contentType}_count`]: 1,
                        today_earned: finalEarned 
                    } 
                }
            );
        }

        const revenueRecord = {
            uploaderId: uploaderNum,
            tmdbId: tmdbId.toString(),
            mediaType,
            title,
            season,
            episode,
            contentType, 
            basePrice,
            earned: finalEarned,
            limitReached,
            timestamp: now,
            dayId,
            monthId
        };

        await mongoDb.collection(COLL_REVENUE).insertOne(revenueRecord);
        console.log(`[Revenue] ${status} for ${title} (Uploader: ${uploaderNum}). Earned: $${finalEarned} (Base: $${basePrice}, Tasa: ${rateApplied}). Today: $${(currentDaily + finalEarned).toFixed(2)}`);
        
        return { appliedRevenue: finalEarned, status };
    } catch (error) {
        console.error("[Revenue] Error crítico calculando ganancia:", error);
        return { appliedRevenue: 0, status: 'error_interno' };
    }
}

async function sendNotificationToTopic(title, body, imageUrl, tmdbId, mediaType, specificTopic) {
    const topic = specificTopic || 'new_content';
    const dataPayload = {
        title: title, 
        body: body, 
        tmdbId: tmdbId ? tmdbId.toString() : '0', 
        mediaType: mediaType || 'general',
        click_action: "FLUTTER_NOTIFICATION_CLICK", 
        ...(imageUrl && { imageUrl: imageUrl })
    };

    const message = {
        topic: topic, 
        data: dataPayload,
        notification: { title: title, body: body, ...(imageUrl && { image: imageUrl }) },
        android: { priority: 'high', notification: { sound: 'default', priority: 'high', channelId: 'high_importance_channel' } }
    };

    try {
        console.log(`🚀 Intentando enviar notificación al topic '${topic}'...`);
        const response = await messaging.send(message);
        console.log('✅ Notificación FCM enviada exitosamente al topic:', response);
        return { success: true, message: `Notificación enviada al topic '${topic}'.`, response: response };
    } catch (error) {
        console.error(`❌ Error al enviar notificación FCM al topic '${topic}':`, error);
        return { success: false, error: error.message };
    }
}

// --- CONFIGURACIÓN DE CONTEXTO GLOBAL PARA INYECTAR EN LAS RUTAS ---
const ctx = {
    db, getMongoDb: () => mongoDb, admin, messaging, bot,
    TMDB_API_KEY, ADMIN_CHAT_IDS, ADMIN_CHAT_ID_2,
    COLL_REVENUE, COLL_DAILY_STATS, REVENUE_SETTINGS,
    caches: {
        embedCache, countsCache, tmdbCache, recentCache,
        historyCache, localDetailsCache, pinnedCache,
        kdramaCache, catalogCache, userCache, requestsCache, zyroCache
    },
    cacheKeys: { PINNED_CACHE_KEY, KDRAMA_CACHE_KEY, CATALOG_CACHE_KEY, RECENT_CACHE_KEY, REQUESTS_CACHE_KEY },
    middlewares: { verifyIdToken, verifyInternalAdmin },
    utils: { calculateAndRecordRevenue, sendNotificationToTopic, axios }
};

// 👇 AQUÍ ESTÁ LA LÍNEA QUE CONECTA EL CACHÉ GLOBAL CON EL BOT 👇
global.ctx = ctx;

// --- CARGA DE ARCHIVOS DE RUTAS EXTERNAS ---
require('./routes_user.js')(app, ctx);
require('./routes_content.js')(app, ctx);
require('./routes_live.js')(app, ctx)
// --- RUTAS GLOBALES Y MISC ---
app.get('/', (req, res) => { res.send('¡El bot y el servidor de Sala Cine están activos!'); });

if (process.env.NODE_ENV === 'production' && token) {
    app.post(`/bot${token}`, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });
} else if (!token && process.env.NODE_ENV === 'production'){
    console.warn("⚠️  Webhook de Telegram no configurado porque TELEGRAM_BOT_TOKEN no está definido.");
}

app.get('/app/details/:tmdbId', (req, res) => {
    const tmdbId = req.params.tmdbId;
    const APP_SCHEME_URL = `salacine://details?id=${tmdbId}`;
    const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=com.salacine.app`;
    const htmlResponse = `
        <!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=${APP_SCHEME_URL}">
        <title>Abriendo Sala Cine...</title><script>window.onload = function() { setTimeout(function() { window.location.replace('${PLAY_STORE_URL}'); }, 500); };</script>
        </head><body>Redirigiendo a Sala Cine...</body></html>
    `;
    res.send(htmlResponse);
});

app.get('/api/streaming-status', (req, res) => {
    const clientBuildId = parseInt(req.query.build_id) || 0;
    const clientVersion = parseInt(req.query.version) || 0;
    const receivedId = clientBuildId || clientVersion;
    console.log(`[Status Check] ID Recibido: ${receivedId} | ID en Revisión: ${BUILD_ID_UNDER_REVIEW}`);
    if (receivedId === BUILD_ID_UNDER_REVIEW) {
        console.log("⚠️ [Review Mode] Detectada versión en revisión. Ocultando streaming.");
        return res.status(200).json({ isStreamingActive: false }); 
    }
    console.log(`[Status Check] Usuario normal. Devolviendo estado global: ${GLOBAL_STREAMING_ACTIVE}`);
    res.status(200).json({ isStreamingActive: GLOBAL_STREAMING_ACTIVE });
});

app.get('/api/announcement', (req, res) => {
    const filePath = path.join(__dirname, 'globalAnnouncement.json');
    if (!fs.existsSync(filePath)) { return res.status(204).send(); }
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        if (!data) return res.status(204).send();
        const json = JSON.parse(data);
        if (json.siempreVisible === true) json.id = Date.now().toString();
        return res.status(200).json(json);
    } catch (error) {
        console.error("Error leyendo anuncio global:", error);
        return res.status(204).send();
    }
});

app.get('/api/app-update', (req, res) => {
    const updateInfo = { "latest_version_code": 12, "update_url": "https://play.google.com/store/apps/details?id=com.salacine.app&pcampaignid=web_share", "force_update": false, "update_message": "¡Nueva versión (1.5.2) de Sala Cine disponible! Incluye mejoras de rendimiento. Actualiza ahora." };
    res.status(200).json(updateInfo);
});

app.get('/api/app-status', (req, res) => {
    res.json({ isAppApproved: true, safeContentIds: [11104, 539, 4555, 27205, 33045] });
});

app.get('/.well-known/assetlinks.json', (req, res) => { res.sendFile('assetlinks.json', { root: __dirname }); });

// --- CRON JOBS Y ARRANQUE ---
cron.schedule('0 18 * * *', () => {
    if (ADMIN_CHAT_ID_2) {
        bot.sendMessage(ADMIN_CHAT_ID_2, '🔥 ¡Empieza la hora pico! El CPM está subiendo. ¡Es el momento ideal para subir contenido y maximizar ganancias! 🚀💰');
    }
}, { scheduled: true, timezone: "America/Guayaquil" });

async function startServer() {
    await connectToMongo();
    initializeBot(
        bot, db, mongoDb, adminState, ADMIN_CHAT_IDS, 
        TMDB_API_KEY, RENDER_BACKEND_URL, axios, pinnedCache, 
        sendNotificationToTopic, userCache 
    );
    initZyroEngine(app, () => mongoDb, zyroCache, TMDB_API_KEY);

    app.listen(PORT, () => {
        console.log(`🚀 Servidor de backend Sala Cine iniciado en puerto ${PORT}`);
        client.on('close', () => {
            console.warn('Conexión a MongoDB cerrada. Intentando reconectar...');
            setTimeout(connectToMongo, 5000);
        });
    });
}

startServer();

process.on('uncaughtException', (error) => { console.error('Uncaught Exception:', error); });
process.on('unhandledRejection', (reason, promise) => { console.error('Unhandled Rejection at:', promise, 'reason:', reason); });
