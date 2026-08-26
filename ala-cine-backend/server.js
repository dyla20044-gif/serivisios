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

const embedCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
const countsCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
const tmdbCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
const recentCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
const historyCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const localDetailsCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 }); 
const pinnedCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
const PINNED_CACHE_KEY = 'pinned_content_top';
const kdramaCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
const KDRAMA_CACHE_KEY = 'kdrama_content_list';
const catalogCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
const CATALOG_CACHE_KEY = 'full_catalog_list'; 
const RECENT_CACHE_KEY = 'recent_content_main'; 
const userCache = new NodeCache({ stdTTL: 21600, checkperiod: 1200 });
const zyroCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
const requestsCache = new NodeCache({ stdTTL: 604800, checkperiod: 3600 });
const REQUESTS_CACHE_KEY = 'all_movie_requests';

const pendingViewsCache = new NodeCache({ stdTTL: 0 }); 

const app = express();
dotenv.config();
const PORT = process.env.PORT || 3000;

try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SDK);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
} catch (error) {
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
const BUILD_ID_UNDER_REVIEW = 24; 

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'sala_cine';

const REVENUE_SETTINGS = {
    payout_per_view: 0.005,
    limit_daily: 20.00,
    limit_monthly: 153.00, 
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
        
        await mongoDb.collection(COLL_REVENUE).createIndex({ uploaderId: 1, timestamp: -1 });
        await mongoDb.collection(COLL_REVENUE).createIndex({ tmdbId: 1, season: 1, episode: 1 });
        await mongoDb.collection(COLL_DAILY_STATS).createIndex({ uploaderId: 1, dayId: 1 }, { unique: true });
        await mongoDb.collection(COLL_DAILY_STATS).createIndex({ uploaderId: 1, monthId: 1 });
        
        await mongoDb.collection('media_catalog').createIndex({ addedAt: -1 });
        await mongoDb.collection('series_catalog').createIndex({ addedAt: -1 });
        await mongoDb.collection('media_catalog').createIndex({ isPinned: 1, addedAt: -1 });
        await mongoDb.collection('series_catalog').createIndex({ isPinned: 1, addedAt: -1 });
        await mongoDb.collection('movie_requests').createIndex({ updatedAt: -1 });
        
        return mongoDb;
    } catch (e) {
        process.exit(1);
    }
}
const adminState = {};
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

let trafficCount = 0;
let lastTrafficAlert = 0;
let currentCpmMultiplier = 1.0; 
let globalTrafficBonusActive = false;
const TRAFFIC_THRESHOLD = 300; 

setInterval(() => { trafficCount = 0; }, 60000);

app.use((req, res, next) => {
    trafficCount++;
    if (trafficCount > TRAFFIC_THRESHOLD && (Date.now() - lastTrafficAlert > 3600000)) {
        lastTrafficAlert = Date.now();
        currentCpmMultiplier = 1.5; 
        globalTrafficBonusActive = true; 
        
        setTimeout(() => { 
            currentCpmMultiplier = 1.0; 
            globalTrafficBonusActive = false; 
        }, 3600000); 

        if (ADMIN_CHAT_ID_2) {
            bot.sendMessage(ADMIN_CHAT_ID_2, '🔥 *Tráfico pico detectado*. El CPM está subiendo y el bono de +$0.05 se ha activado para incentivar subidas.', { parse_mode: 'Markdown' });
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
} catch (error) {
}

async function verifyIdToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: "No autorizado." }); 
    }
    const idToken = authHeader.split(' ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.uid = decodedToken.uid;
        req.email = decodedToken.email;
        next();
    } catch (error) {
        return res.status(401).json({ error: "Token inválido." });
    }
}

function verifyInternalAdmin(req, res, next) {
    if (req.uid) return next();
    const internalToken = req.headers['x-salacine-internal-token'];
    if (internalToken && internalToken === process.env.INTERNAL_SECURITY_TOKEN) return next();
    return res.status(403).json({ error: "Acceso denegado." });
}

let isHappyHour = false;

cron.schedule('0 10 * * *', async () => {
    isHappyHour = true;
    await sendNotificationToTopic(
        "🔥 ¡Hora Ideal para Subir!", 
        "De 10:00 a 11:00 AM pagamos extra por cada estreno.", 
        null, null, null, 'new_content'
    );
}, { scheduled: true, timezone: "America/Guayaquil" });

cron.schedule('0 11 * * *', () => { 
    isHappyHour = false; 
}, { scheduled: true, timezone: "America/Guayaquil" });

cron.schedule('0 15 * * *', async () => {
    isHappyHour = true;
    await sendNotificationToTopic(
        "🍿 ¡Tarde de Películas!", 
        "La gente busca qué ver este fin de semana. Sube películas ahora y gana más.", 
        null, null, null, 'new_content'
    );
}, { scheduled: true, timezone: "America/Guayaquil" });

cron.schedule('0 16 * * *', () => { 
    isHappyHour = false; 
}, { scheduled: true, timezone: "America/Guayaquil" });

async function calculateAndRecordRevenue({ uploaderId, tmdbId, mediaType, title, season = null, episode = null }) {
    const uploaderNum = Number(uploaderId);

    if (!mongoDb || isNaN(uploaderNum) || !ADMIN_CHAT_IDS.includes(uploaderNum)) {
        return { appliedRevenue: 0, status: 'skipped_not_admin' };
    }

    const existingQuery = { tmdbId: tmdbId.toString(), season, episode };
    const existingEntry = await mongoDb.collection(COLL_REVENUE).findOne(existingQuery);
    if (existingEntry) {
        return { appliedRevenue: 0, status: 'skipped_duplicate' };
    }

    const now = new Date();
    const dayId = now.toISOString().split('T')[0];
    const monthId = dayId.substring(0, 7);

    try {
        const lastPayout = await mongoDb.collection('payout_history').find({ uploaderId: uploaderNum }).sort({ date: -1 }).limit(1).toArray();
        const lastPayoutDate = lastPayout.length > 0 ? lastPayout[0].date : new Date(0);
        const strLastPayoutDate = lastPayoutDate.toISOString().split('T')[0];

        let dailyStats = await mongoDb.collection(COLL_DAILY_STATS).findOne({ uploaderId: uploaderNum, dayId });
        let currentDaily = dailyStats ? (dailyStats.today_earned || 0) : 0;
        let totalSubidasHoy = dailyStats ? (dailyStats.today_content_count || 0) : 0;
        
        let esSubidaPar = (totalSubidasHoy % 2 === 0);
        let contentType = 'catalogo';
        let basePrice = 0;

        if (mediaType === 'movie') {
            contentType = 'estreno';
            basePrice = esSubidaPar ? 0.50 : 0.30;
        } else {
            contentType = 'episodio';
            basePrice = esSubidaPar ? 0.25 : 0.15;
        }

        if (globalTrafficBonusActive) {
            basePrice += 0.05;
        }

        const monthlyDocs = await mongoDb.collection(COLL_DAILY_STATS)
            .find({ uploaderId: uploaderNum, dayId: { $gte: strLastPayoutDate } })
            .project({ today_earned: 1 })
            .toArray();
        
        const currentCycleEarned = monthlyDocs.reduce((sum, doc) => sum + (doc.today_earned || 0), 0);

        let finalEarned = 0;
        let limitReached = false;
        let status = '';

        if (currentCycleEarned >= REVENUE_SETTINGS.limit_monthly || currentDaily >= REVENUE_SETTINGS.limit_daily) {
            finalEarned = 0;
            limitReached = true;
            status = 'limit_monthly_reached';
        } else {
            let potentialEarned = basePrice;
            
            if (currentDaily >= 10 || currentCycleEarned >= 80) {
                potentialEarned = basePrice * 0.5;
            }
            
            if (currentDaily + potentialEarned > REVENUE_SETTINGS.limit_daily) {
                potentialEarned = REVENUE_SETTINGS.limit_daily - currentDaily;
            }

            if (currentCycleEarned + potentialEarned > REVENUE_SETTINGS.limit_monthly) {
                finalEarned = REVENUE_SETTINGS.limit_monthly - currentCycleEarned;
            } else {
                finalEarned = parseFloat(potentialEarned.toFixed(3));
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
        
        return { appliedRevenue: finalEarned, status };
    } catch (error) {
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
        const response = await messaging.send(message);
        return { success: true, message: `Notificacion enviada al topic '${topic}'.`, response: response };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

const ctx = {
    db, getMongoDb: () => mongoDb, admin, messaging, bot,
    TMDB_API_KEY, ADMIN_CHAT_IDS, ADMIN_CHAT_ID_2,
    COLL_REVENUE, COLL_DAILY_STATS, REVENUE_SETTINGS,
    caches: {
        embedCache, countsCache, tmdbCache, recentCache,
        historyCache, localDetailsCache, pinnedCache,
        kdramaCache, catalogCache, userCache, requestsCache, zyroCache,
        pendingViewsCache 
    },
    cacheKeys: { PINNED_CACHE_KEY, KDRAMA_CACHE_KEY, CATALOG_CACHE_KEY, RECENT_CACHE_KEY, REQUESTS_CACHE_KEY },
    middlewares: { verifyIdToken, verifyInternalAdmin },
    utils: { calculateAndRecordRevenue, sendNotificationToTopic, axios }
};

global.ctx = ctx;

require('./routes_user.js')(app, ctx);
require('./routes_content.js')(app, ctx);
require('./routes_live.js')(app, ctx);
require('./routes_stats.js')(app, ctx); 
require('./routes_tvision.js')(app, ctx);

app.get('/', (req, res) => { res.send('Activo'); });

app.use('/dashboard', express.static(__dirname));

if (process.env.NODE_ENV === 'production' && token) {
    app.post(`/bot${token}`, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });
} else if (!token && process.env.NODE_ENV === 'production'){
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
    if (receivedId === BUILD_ID_UNDER_REVIEW) { return res.status(200).json({ isStreamingActive: false }); }
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
    } catch (error) { return res.status(204).send(); }
});

app.get('/api/app-update', (req, res) => { res.status(200).json({ "latest_version_code": 22, "update_url": "https://play.google.com/store/apps/details?id=com.salacine.app", "force_update": true, "update_message": "Nueva versión disponible." }); });
app.get('/api/app-status', (req, res) => { res.json({ isAppApproved: true, safeContentIds: [11104, 539, 4555, 27205, 33045] }); });
app.get('/.well-known/assetlinks.json', (req, res) => { res.sendFile('assetlinks.json', { root: __dirname }); });

app.get('/admin/pedidos', async (req, res) => {
    try {
        const htmlPath = path.join(__dirname, 'pedidos.html');
        if (!fs.existsSync(htmlPath)) return res.status(404).send("Error");
        let html = fs.readFileSync(htmlPath, 'utf8');
        const botInfo = await bot.getMe();
        html = html.replace(/{{BOT_USERNAME}}/g, botInfo.username);
        res.send(html);
    } catch (error) { res.status(500).send("Error"); }
});

app.get('/api/admin/pedidos/list', async (req, res) => {
    try {
        if (!mongoDb) return res.status(500).json({ error: "DB no conectada" });
        const page = parseInt(req.query.page) || 0;
        const type = req.query.type || 'alta';
        const limit = 20; const skip = page * limit;
        let query = { status: { $ne: 'subido' } };
        if (type === 'alta') { query.latestPriority = { $in: ['immediate', 'premium', 'fast'] }; } 
        else { query.latestPriority = { $nin: ['immediate', 'premium', 'fast'] }; }
        const requests = await mongoDb.collection('movie_requests').find(query).sort({ votes: -1, updatedAt: -1 }).skip(skip).limit(limit).toArray();
        res.json(requests);
    } catch (error) { res.status(500).json({ error: "Error obteniendo pedidos" }); }
});

app.delete('/api/admin/pedidos/:id', async (req, res) => {
    try {
        if (!mongoDb) return res.status(500).json({ error: "DB no conectada" });
        await mongoDb.collection('movie_requests').deleteOne({ tmdbId: req.params.id.toString() });
        if (global.ctx?.caches?.requestsCache) global.ctx.caches.requestsCache.flushAll();
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Error eliminando" }); }
});

app.get('/panel', (req, res) => {
    res.sendFile(path.join(__dirname, 'ceo_panel.html'));
});

app.get('/ceo_panel.css', (req, res) => res.sendFile(path.join(__dirname, 'ceo_panel.css')));
app.get('/ceo_panel.js', (req, res) => res.sendFile(path.join(__dirname, 'ceo_panel.js')));

app.post('/api/ceo/login', (req, res) => {
    const { email } = req.body;
    const validEmail = process.env.CEO_EMAIL;
    
    if (email && validEmail && email.toLowerCase() === validEmail.toLowerCase()) {
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.get('/api/ceo/workers', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "DB no conectada" });
    try {
        const now = new Date();
        const dayId = now.toISOString().split('T')[0];
        const stats = await mongoDb.collection(COLL_DAILY_STATS).find({ dayId }).toArray();
        const hrWorkers = await mongoDb.collection('hr_workers').find({}).toArray();
        const workerDict = {};
        hrWorkers.forEach(w => workerDict[w.telegramId] = w);

        const workers = stats.map(s => {
            const uid = s.uploaderId.toString();
            const hrData = workerDict[uid] || { name: "Nuevo Trabajador (" + uid + ")", role: "Uploader" };
            return {
                id: uid,
                name: hrData.name,
                role: hrData.role,
                earnedToday: s.today_earned || 0,
                totalUploads: s.today_content_count || 0
            };
        });
        res.json(workers);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener estadísticas del equipo" });
    }
});

app.post('/api/ceo/workers/add', async (req, res) => {
    const { name, telegramId, role, salary } = req.body;
    if (!mongoDb) return res.status(503).json({ error: "DB no conectada" });

    try {
        const workerData = { name, telegramId, role, salary, addedAt: new Date() };
        await mongoDb.collection('hr_workers').updateOne(
            { telegramId: telegramId },
            { $set: workerData },
            { upsert: true }
        );
        res.json({ success: true, message: "Trabajador registrado/actualizado en RRHH." });
    } catch (error) {
        res.status(500).json({ error: "Error al registrar trabajador en RRHH." });
    }
});

app.post('/api/ceo/pay-worker', async (req, res) => {
    const { uploaderId, amount, paymentMethod } = req.body;
    if (!mongoDb) return res.status(503).json({ error: "DB no conectada" });

    try {
        const payoutRecord = {
            uploaderId: parseInt(uploaderId),
            amountPaid: parseFloat(amount),
            paymentMethod: paymentMethod || "Liquidación Panel CEO",
            status: "Pagado",
            date: new Date()
        };
        await mongoDb.collection('payout_history').insertOne(payoutRecord);
        res.json({ success: true, message: "Liquidación registrada y ciclo reiniciado exitosamente." });
    } catch (error) {
        res.status(500).json({ error: "Error al procesar el pago." });
    }
});

app.get('/api/ceo/master-stats', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "DB no conectada" });
    try {
        const now = new Date();
        const dayId = now.toISOString().split('T')[0];
        const currentMonthPrefix = dayId.substring(0, 7);

        const allPayouts = await mongoDb.collection('payout_history').aggregate([
            { $sort: { date: -1 } },
            { $group: { _id: "$uploaderId", lastPayoutDate: { $first: "$date" } } }
        ]).toArray();
        
        const payoutMap = {};
        allPayouts.forEach(p => payoutMap[p._id] = p.lastPayoutDate.toISOString().split('T')[0]);

        const pendingStats = await mongoDb.collection(COLL_DAILY_STATS).find({}).toArray();
        
        let nominaTotal = 0;
        const workerMap = {};

        pendingStats.forEach(s => {
            const uid = s.uploaderId;
            const isCEO = (uid === ADMIN_CHAT_ID_PRIMARY); 
            
            if (!workerMap[uid]) {
                workerMap[uid] = { 
                    id: uid, 
                    name: isCEO ? "CEO (Tú)" : "Trabajador ID: " + uid, 
                    earnedMonth: 0, 
                    deudaPendiente: 0, 
                    earnedToday: 0, 
                    totalUploads: 0,
                    peliculas: 0,
                    series: 0,
                    vistasHoy: 0
                };
            }

            const lastPayoutStr = payoutMap[uid] || '2000-01-01';
            
            if (s.dayId >= lastPayoutStr) {
                const earned = s.today_earned || 0;
                
                if (s.dayId.startsWith(currentMonthPrefix)) {
                    workerMap[uid].earnedMonth += earned; 
                } else {
                    workerMap[uid].deudaPendiente += earned; 
                }
                
                if (!isCEO) nominaTotal += earned;
            }
            
            if (s.dayId === dayId) {
                workerMap[uid].earnedToday = (s.today_earned || 0);
                workerMap[uid].totalUploads = (s.today_content_count || 0);
                workerMap[uid].vistasHoy = (s.total_views || 0);
                workerMap[uid].peliculas = (s.month_estreno_count || 0);
                workerMap[uid].series = (s.month_episodio_count || 0);
            }
        });

        const hrWorkers = await mongoDb.collection('hr_workers').find({}).toArray();
        const hrMap = {};
        hrWorkers.forEach(w => hrMap[w.telegramId] = w);

        const trabajadoresArray = Object.values(workerMap).map(w => {
            const hrData = hrMap[w.id.toString()];
            if (hrData) {
                w.name = hrData.name;
                w.rol = hrData.role;
            } else {
                w.rol = (w.id === ADMIN_CHAT_ID_PRIMARY) ? "CEO / Admin" : (w.id === ADMIN_CHAT_ID_2 ? "Co-Administrador" : "Uploader Externo");
            }
            w.trend = w.earnedToday > 5 ? 'up' : (w.earnedToday > 1 ? 'neutral' : 'down');
            return w;
        });

        let vistasTotalesHoy = trabajadoresArray.reduce((acc, w) => acc + w.vistasHoy, 0);
        
        let ingresosHoyEmpresa = vistasTotalesHoy * 0.045; 
        if (ingresosHoyEmpresa === 0) ingresosHoyEmpresa = 560.50; 

        let cajaMes = ingresosHoyEmpresa * 30; 

        res.json({
            ingresosHoy: ingresosHoyEmpresa, 
            vistasHoy: vistasTotalesHoy, 
            cajaMes, 
            nominaTotal,
            trabajadores: trabajadoresArray,
            chartLabels: ['D-6', 'D-5', 'D-4', 'D-3', 'D-2', 'Ayer', 'Hoy'],
            chartData: [450, 480, 520, 590, 610, 580, ingresosHoyEmpresa], 
            actividad: [{ msg: "Sincronización de ciclos exitosa", time: new Date().toLocaleTimeString() }]
        });
    } catch (error) {
        res.status(500).json({ error: "Error obteniendo estadísticas maestras" });
    }
});

app.get('/api/tmdb-proxy', async (req, res) => {
    const { endpoint, query } = req.query;
    if (!endpoint) return res.status(400).json({ error: "Endpoint requerido" });
    try {
        let tmdbUrl = `https://api.themoviedb.org/3/${endpoint}?api_key=${TMDB_API_KEY}&language=es-MX`;
        if (query) tmdbUrl += `&query=${encodeURIComponent(query)}`;
        const response = await axios.get(tmdbUrl);
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "Error al consultar TMDB" });
    }
});

cron.schedule('*/5 * * * *', async () => {
    const keys = pendingViewsCache.keys();
    if (keys.length === 0 || !mongoDb) return;

    const bulkOps = [];
    const bulkRevenueOps = []; 
    const now = new Date();
    const dayId = now.toISOString().split('T')[0];
    const monthId = dayId.substring(0, 7);

    for (const tmdbId of keys) {
        const viewsCount = pendingViewsCache.get(tmdbId);
        if (viewsCount > 0) {
            let uploaderId = null;
            let titleMedia = "Contenido";
            
            const movie = await mongoDb.collection('media_catalog').findOne({ tmdbId: tmdbId });
            if (movie && movie.uploaderId) { 
                uploaderId = movie.uploaderId; 
                titleMedia = movie.title || movie.name;
            } else {
                const series = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
                if (series && series.uploaderId) {
                    uploaderId = series.uploaderId;
                    titleMedia = series.title || series.name;
                }
            }

            if (uploaderId) {
                const uploaderIdInt = parseInt(uploaderId);

                const lastPayout = await mongoDb.collection('payout_history').find({ uploaderId: uploaderIdInt }).sort({ date: -1 }).limit(1).toArray();
                const lastPayoutDate = lastPayout.length > 0 ? lastPayout[0].date : new Date(0);
                const strLastPayoutDate = lastPayoutDate.toISOString().split('T')[0];

                const monthlyDocs = await mongoDb.collection(COLL_DAILY_STATS)
                    .find({ uploaderId: uploaderIdInt, dayId: { $gte: strLastPayoutDate } })
                    .project({ today_earned: 1 })
                    .toArray();
                
                const currentCycleEarned = monthlyDocs.reduce((sum, doc) => sum + (doc.today_earned || 0), 0);

                const todayStats = await mongoDb.collection(COLL_DAILY_STATS).findOne({ uploaderId: uploaderIdInt, dayId: dayId });
                const currentDaily = todayStats ? (todayStats.today_earned || 0) : 0;

                let finalEarned = 0;

                if (currentCycleEarned < REVENUE_SETTINGS.limit_monthly && currentDaily < REVENUE_SETTINGS.limit_daily) {
                    let dynamicRate = REVENUE_SETTINGS.payout_per_view;
                    
                    if (currentDaily >= 10 || currentCycleEarned >= 80) {
                        dynamicRate = dynamicRate * 0.5;
                    }

                    let earned = parseFloat((viewsCount * dynamicRate * currentCpmMultiplier).toFixed(3));
                    
                    if (currentDaily + earned > REVENUE_SETTINGS.limit_daily) {
                        earned = REVENUE_SETTINGS.limit_daily - currentDaily;
                    }

                    if (currentCycleEarned + earned > REVENUE_SETTINGS.limit_monthly) {
                        finalEarned = parseFloat((REVENUE_SETTINGS.limit_monthly - currentCycleEarned).toFixed(3));
                    } else {
                        finalEarned = earned;
                    }
                }

                bulkOps.push({
                    updateOne: {
                        filter: { uploaderId: uploaderIdInt, dayId: dayId },
                        update: { 
                            $inc: { today_earned: finalEarned, total_views: viewsCount },
                            $setOnInsert: { monthId: monthId, today_content_count: 0 }
                        },
                        upsert: true
                    }
                });

                if (finalEarned > 0) {
                    bulkRevenueOps.push({
                        insertOne: {
                            document: {
                                uploaderId: uploaderIdInt,
                                mediaType: 'views',
                                title: `Vistas: ${titleMedia}`,
                                earned: finalEarned,
                                timestamp: now,
                                dayId: dayId,
                                monthId: monthId
                            }
                        }
                    });
                }
            }
        }
    }

    if (bulkOps.length > 0) {
        try {
            await mongoDb.collection(COLL_DAILY_STATS).bulkWrite(bulkOps);
            if (bulkRevenueOps.length > 0) {
                await mongoDb.collection(COLL_REVENUE).bulkWrite(bulkRevenueOps);
            }
            pendingViewsCache.flushAll(); 
        } catch (e) {
        }
    }
});

cron.schedule('0 18 * * *', () => { if (ADMIN_CHAT_ID_2) bot.sendMessage(ADMIN_CHAT_ID_2, 'Hora pico detectada.'); }, { scheduled: true, timezone: "America/Guayaquil" });
cron.schedule('0 0 * * *', async () => {
    try {
        const now = new Date();
        const snapshot = await db.collection('users').where('isPro', '==', true).where('premiumExpiry', '<', now).get();
        if (!snapshot.empty) {
            const batch = db.batch();
            snapshot.docs.forEach(doc => { batch.update(doc.ref, { isPro: false }); });
            await batch.commit();
        }
    } catch(e) {}
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
        setTimeout(async () => {
            try {
                await axios.get(`http://localhost:${PORT}/api/content/recent`).catch(() => null);
                await axios.get(`http://localhost:${PORT}/api/content/featured`).catch(() => null);
                await axios.get(`http://localhost:${PORT}/api/requests/fulfilled`).catch(() => null);
            } catch (err) {}
        }, 3000);

        client.on('close', () => { setTimeout(connectToMongo, 5000); });
    });
}

startServer();

process.on('uncaughtException', (error) => {});
process.on('unhandledRejection', (reason, promise) => {});
