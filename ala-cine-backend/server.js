const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const axios = require('axios'); 
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cron = require('node-cron');
const NodeCache = require('node-cache');
const path = require('path'); 
const fs = require('fs');

// Archivos internos
const initializeBot = require('./bot.js');
const initZyroEngine = require('./zyroEngine.js');
const userRoutes = require('./routes/userRoutes');
const contentRoutes = require('./routes/contentRoutes');

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// Inicializar Firebase
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SDK);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log("✅ Firebase Admin SDK inicializado correctamente.");
} catch (error) { console.error("❌ ERROR FATAL: Firebase SDK.", error); }

const db = admin.firestore();
const messaging = admin.messaging();
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

const ADMIN_CHAT_ID_PRIMARY = parseInt(process.env.ADMIN_CHAT_ID, 10);
const ADMIN_CHAT_ID_2 = process.env.ADMIN_CHAT_ID_2 ? parseInt(process.env.ADMIN_CHAT_ID_2, 10) : null;
const ADMIN_CHAT_IDS = ADMIN_CHAT_ID_2 ? [ADMIN_CHAT_ID_PRIMARY, ADMIN_CHAT_ID_2] : [ADMIN_CHAT_ID_PRIMARY];

// Cachés globales
const caches = {
    embedCache: new NodeCache({ stdTTL: 86400, checkperiod: 600 }),
    countsCache: new NodeCache({ stdTTL: 900, checkperiod: 120 }),
    tmdbCache: new NodeCache({ stdTTL: 86400, checkperiod: 3600 }),
    recentCache: new NodeCache({ stdTTL: 3600, checkperiod: 600 }),
    historyCache: new NodeCache({ stdTTL: 900, checkperiod: 120 }),
    localDetailsCache: new NodeCache({ stdTTL: 86400, checkperiod: 3600 }),
    pinnedCache: new NodeCache({ stdTTL: 3600, checkperiod: 600 }),
    kdramaCache: new NodeCache({ stdTTL: 3600, checkperiod: 600 }),
    catalogCache: new NodeCache({ stdTTL: 3600, checkperiod: 600 }),
    requestsCache: new NodeCache({ stdTTL: 604800, checkperiod: 3600 }),
    userCache: new NodeCache({ stdTTL: 21600, checkperiod: 1200 }),
    zyroCache: new NodeCache({ stdTTL: 3600, checkperiod: 600 })
};

// MongoDB
const client = new MongoClient(process.env.MONGO_URI, { serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true } });
let mongoDb;

async function connectToMongo() {
    try {
        await client.connect();
        mongoDb = client.db(process.env.MONGO_DB_NAME || 'sala_cine');
        console.log(`✅ Conexión a MongoDB Atlas exitosa!`);
    } catch (e) { console.error("❌ Error MongoDB:", e); process.exit(1); }
}

// Config y utilidades
const config = {
    TMDB_API_KEY: process.env.TMDB_API_KEY,
    ADMIN_CHAT_IDS,
    ADMIN_CHAT_ID_PRIMARY,
    REVENUE_SETTINGS: { estreno_peli: 1.00, catalogo_peli: 0.50, episodio_serie: 0.25, limit_daily: 10.00, limit_monthly: 30.00, months_to_be_estreno: 6 }
};

let trafficCount = 0; let lastTrafficAlert = 0;
app.use(bodyParser.json()); app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
    trafficCount++;
    if (trafficCount > 300 && (Date.now() - lastTrafficAlert > 3600000) && ADMIN_CHAT_ID_2) {
        lastTrafficAlert = Date.now();
        bot.sendMessage(ADMIN_CHAT_ID_2, '🔥 ¡Tráfico alto detectado! El CPM está subiendo. ¡Sube contenido! 🚀');
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-salacine-internal-token');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

try { require('./bridge.js')(app); console.log("✅ Módulo Bridge cargado."); } catch(e) {}

// Middlewares compartidos
const middlewares = {
    verifyIdToken: async (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return next();
        try {
            const decoded = await admin.auth().verifyIdToken(authHeader.split(' ')[1]);
            req.uid = decoded.uid; req.email = decoded.email; next();
        } catch (e) { next(); }
    },
    verifyInternalAdmin: (req, res, next) => {
        if (req.uid || (req.headers['x-salacine-internal-token'] === process.env.INTERNAL_SECURITY_TOKEN)) return next();
        return res.status(403).json({ error: "Acceso denegado." });
    },
    countsCacheMiddleware: (req, res, next) => {
        if (!req.uid) return next();
        const cacheKey = `${req.uid}:${req.path}`;
        const cached = caches.countsCache.get(cacheKey);
        if (cached) return res.status(200).json(cached);
        req.cacheKey = cacheKey; next();
    }
};

async function sendNotificationToTopic(title, body, imageUrl, tmdbId, mediaType, specificTopic) {
    const topic = specificTopic || 'new_content';
    const message = { topic, data: { title, body, tmdbId: String(tmdbId||0), mediaType: mediaType||'general', click_action: "FLUTTER_NOTIFICATION_CLICK", ...(imageUrl && { imageUrl }) }, notification: { title, body, ...(imageUrl && { image: imageUrl }) } };
    try {
        const response = await messaging.send(message); return { success: true, message: 'OK', response };
    } catch (e) { return { success: false, error: e.message }; }
}

// ==========================================
// MONTAR ROUTERS (Aquí unimos los archivos)
// ==========================================
const deps = { app, db, admin, bot, caches, middlewares, config, getMongoDb: () => mongoDb, axios };

app.use(userRoutes(deps));
app.use(contentRoutes(deps));

// Rutas de sistema (Notificaciones, Status, etc)
let GLOBAL_STREAMING_ACTIVE = true;
const BUILD_ID_UNDER_REVIEW = 19; 

app.get('/api/streaming-status', (req, res) => {
    const clientBuildId = parseInt(req.query.build_id) || parseInt(req.query.version) || 0;
    res.status(200).json({ isStreamingActive: clientBuildId === BUILD_ID_UNDER_REVIEW ? false : GLOBAL_STREAMING_ACTIVE });
});

app.post('/api/notify-new-content', async (req, res) => {
    const { title, body, imageUrl, tmdbId, mediaType } = req.body;
    const result = await sendNotificationToTopic(title, body, imageUrl, tmdbId, mediaType);
    res.status(result.success ? 200 : 500).json(result);
});

app.get('/api/announcement', (req, res) => {
    try {
        const data = fs.readFileSync(path.join(__dirname, 'globalAnnouncement.json'), 'utf8');
        if (!data) return res.status(204).send();
        const json = JSON.parse(data);
        if (json.siempreVisible) json.id = Date.now().toString();
        return res.status(200).json(json);
    } catch (e) { return res.status(204).send(); }
});

app.get('/app/details/:tmdbId', (req, res) => res.send(`<script>setTimeout(()=>window.location.replace('https://play.google.com/store/apps/details?id=com.salacine.app'), 500);</script>`));
app.get('/', (req, res) => res.send('¡Sala Cine Activo!'));
app.get('/api/app-update', (req, res) => res.status(200).json({ "latest_version_code": 12, "update_url": "https://play.google.com/store/apps/details?id=com.salacine.app", "force_update": false }));
app.get('/api/app-status', (req, res) => res.json({ isAppApproved: true, safeContentIds: [11104, 539, 4555, 27205, 33045] }));

if (process.env.NODE_ENV === 'production' && process.env.TELEGRAM_BOT_TOKEN) {
    app.post(`/bot${process.env.TELEGRAM_BOT_TOKEN}`, (req, res) => { bot.processUpdate(req.body); res.sendStatus(200); });
}

cron.schedule('0 18 * * *', () => {
    if (ADMIN_CHAT_ID_2) bot.sendMessage(ADMIN_CHAT_ID_2, '🔥 ¡Empieza la hora pico! El CPM está subiendo. 🚀💰');
}, { scheduled: true, timezone: "America/Guayaquil" });

async function startServer() {
    await connectToMongo();
    initializeBot(bot, db, mongoDb, {}, ADMIN_CHAT_IDS, config.TMDB_API_KEY, process.env.RENDER_EXTERNAL_URL || 'https://serivisios.onrender.com', axios, caches.pinnedCache, sendNotificationToTopic, caches.userCache);
    initZyroEngine(app, () => mongoDb, caches.zyroCache, config.TMDB_API_KEY);
    
    app.listen(PORT, () => {
        console.log(`🚀 Servidor Sala Cine iniciado en puerto ${PORT}`);
        client.on('close', () => setTimeout(connectToMongo, 5000));
    });
}

startServer();
process.on('uncaughtException', e => console.error(e));
process.on('unhandledRejection', e => console.error(e));
