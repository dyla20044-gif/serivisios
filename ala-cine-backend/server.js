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
} catch (error) {}

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
const BUILD_ID_UNDER_REVIEW = 26; 

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'sala_cine';

let globalPricing = {
    mode: 'normal',
    customMoviePrice: 0.50,
    customTvPrice: 0.25,
    payout_per_view: 0.005,
    limit_daily: 25.00,
    limit_monthly: 150.00,
    corp_revenue_per_view: 0.045
};

const COLL_REVENUE = 'uploader_revenue';
const COLL_DAILY_STATS = 'uploader_daily_stats';
const COLL_CORP_REVENUE = 'corp_daily_revenue';

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
        await mongoDb.collection(COLL_CORP_REVENUE).createIndex({ dayId: 1 }, { unique: true });
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
let companyAccumulatedTraffic = 0;
let lastTrafficAlert = 0;

let spmActive = false;
let currentMovieBoost = 0;
let currentTvBoost = 0;
let spmCooldown = 6 * 60 * 60 * 1000;

setInterval(async () => {
    if (trafficCount > 20) {
        spmActive = true;
        let scaling = Math.min((trafficCount - 20) / 80, 1);
        currentMovieBoost = parseFloat((0.20 * scaling).toFixed(3));
        currentTvBoost = parseFloat((0.05 * scaling).toFixed(3));

        if (trafficCount > 50 && (Date.now() - lastTrafficAlert > spmCooldown)) {
            lastTrafficAlert = Date.now();
            try {
                if (mongoDb) {
                    const topRequests = await mongoDb.collection('movie_requests')
                        .find({ status: { $ne: 'subido' } }).sort({ votes: -1 }).limit(3).toArray();
                    const moviesStr = topRequests.map(r => r.title || r.name).join(', ');

                    if (ADMIN_CHAT_ID_PRIMARY) {
                        bot.sendMessage(ADMIN_CHAT_ID_PRIMARY, `🔥 *¡ALTA DEMANDA EN LA APP!* 🔥\n\nEl SPM en películas ha subido +$${currentMovieBoost} extra. ¡Aprovechen para subir!\n\n🍿 *La gente está buscando:*\n${moviesStr}`, { parse_mode: 'Markdown' });
                    }
                }
            } catch(e) {}
        }
    } else {
        spmActive = false;
        currentMovieBoost = 0;
        currentTvBoost = 0;
    }
    trafficCount = 0;
}, 60000);

app.use((req, res, next) => {
    trafficCount++;
    companyAccumulatedTraffic++;
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-salacine-internal-token');
    if (req.method === 'OPTIONS') { return res.sendStatus(200); }
    next();
});

try {
    require('./bridge.js')(app);
} catch (error) {}

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

        if (globalPricing.mode === 'feriado') {
            basePrice = 0;
        } else {
            if (mediaType === 'movie') {
                contentType = 'estreno';
                basePrice = (esSubidaPar ? globalPricing.customMoviePrice : (globalPricing.customMoviePrice * 0.6)) + currentMovieBoost;
            } else {
                contentType = 'episodio';
                basePrice = (esSubidaPar ? globalPricing.customTvPrice : (globalPricing.customTvPrice * 0.6)) + currentTvBoost;
            }
            if (globalPricing.mode === 'boost') basePrice += 0.10;
        }

        const monthlyDocs = await mongoDb.collection(COLL_DAILY_STATS)
            .find({ uploaderId: uploaderNum, dayId: { $gte: strLastPayoutDate } })
            .project({ today_earned: 1 })
            .toArray();
        
        const currentCycleEarned = monthlyDocs.reduce((sum, doc) => sum + (doc.today_earned || 0), 0);

        let finalEarned = 0;
        let limitReached = false;
        let status = 'applied';

        let potentialEarned = basePrice;
        
        if (currentDaily >= 15.00) {
            potentialEarned = basePrice * 0.2;
        }

        if (currentDaily >= globalPricing.limit_daily || currentCycleEarned >= globalPricing.limit_monthly) {
            potentialEarned = 0;
            limitReached = true;
            status = 'limit_monthly_reached';
        }

        if (currentDaily + potentialEarned > globalPricing.limit_daily) {
            finalEarned = globalPricing.limit_daily - currentDaily;
        } else if (currentCycleEarned + potentialEarned > globalPricing.limit_monthly) {
            finalEarned = globalPricing.limit_monthly - currentCycleEarned;
        } else {
            finalEarned = parseFloat(potentialEarned.toFixed(3));
        }

        if (finalEarned < 0) finalEarned = 0;

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
    COLL_REVENUE, COLL_DAILY_STATS, globalPricing,
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
require('./routes_ceo.js')(app, ctx); 

app.get('/', (req, res) => { res.send('Activo'); });

app.use('/dashboard', express.static(__dirname));

if (process.env.NODE_ENV === 'production' && token) {
    app.post(`/bot${token}`, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });
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

app.get('/api/spm-status', async (req, res) => {
    try {
        let requests = [];
        if (mongoDb) {
            requests = await mongoDb.collection('movie_requests')
                .find({ status: { $ne: 'subido' } }).sort({ votes: -1 }).limit(5).toArray();
        }
        res.json({
            active: spmActive,
            movieBoost: currentMovieBoost,
            tvBoost: currentTvBoost,
            topRequests: requests.map(r => ({ title: r.title || r.name, votes: r.votes }))
        });
    } catch(e) {
        res.json({ active: false, movieBoost: 0, tvBoost: 0, topRequests: [] });
    }
});

app.post('/api/bank-info', async (req, res) => {
    const { uid, banco, cuenta, titular } = req.body;
    if (!mongoDb) return res.status(500).json({ error: "DB no conectada" });
    try {
        await mongoDb.collection('user_banks').updateOne(
            { uid: uid },
            { $set: { banco, cuenta, titular, updatedAt: new Date() } },
            { upsert: true }
        );
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: "Error" });
    }
});

app.get('/api/bank-info/:uid', async (req, res) => {
    if (!mongoDb) return res.status(500).json({ error: "DB no conectada" });
    try {
        const bank = await mongoDb.collection('user_banks').findOne({ uid: req.params.uid });
        if (bank) res.json({ success: true, bank });
        else res.json({ success: false });
    } catch(e) {
        res.status(500).json({ error: "Error" });
    }
});

cron.schedule('*/5 * * * *', async () => {
    const keys = pendingViewsCache.keys();
    
    if (!mongoDb) return;

    const bulkOps = [];
    const bulkRevenueOps = []; 
    const bulkCorpOps = []; 
    
    const now = new Date();
    const dayId = now.toISOString().split('T')[0];
    const monthId = dayId.substring(0, 7);

    let totalViewsProcessed = 0;

    for (const tmdbId of keys) {
        const viewsCount = pendingViewsCache.get(tmdbId);
        if (viewsCount > 0) {
            totalViewsProcessed += viewsCount;
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
                let dynamicRate = globalPricing.payout_per_view;

                if (globalPricing.mode === 'feriado') dynamicRate = 0;
                if (globalPricing.mode === 'boost') dynamicRate = dynamicRate * 1.5;

                if (currentDaily >= 15.00) {
                    dynamicRate = dynamicRate * 0.2;
                }

                if (currentCycleEarned < globalPricing.limit_monthly && currentDaily < globalPricing.limit_daily) {
                    let earned = parseFloat((viewsCount * dynamicRate).toFixed(3));
                    if (currentDaily + earned > globalPricing.limit_daily) {
                        earned = globalPricing.limit_daily - currentDaily;
                    }
                    if (currentCycleEarned + earned > globalPricing.limit_monthly) {
                        finalEarned = parseFloat((globalPricing.limit_monthly - currentCycleEarned).toFixed(3));
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

    let trafficToProcess = companyAccumulatedTraffic;
    companyAccumulatedTraffic = 0; 

    let revenueFromViews = totalViewsProcessed * globalPricing.corp_revenue_per_view;
    let revenueFromRequests = trafficToProcess * 0.015; 

    let totalCorpEarned = revenueFromViews + revenueFromRequests;

    if (totalCorpEarned > 0 || totalViewsProcessed > 0 || trafficToProcess > 0) {
        bulkCorpOps.push({
            updateOne: {
                filter: { dayId: dayId },
                update: {
                    $inc: { 
                        today_earned: totalCorpEarned, 
                        total_views: totalViewsProcessed,
                        total_requests: trafficToProcess 
                    },
                    $setOnInsert: { monthId: monthId }
                },
                upsert: true
            }
        });
    }

    try {
        if (bulkOps.length > 0) await mongoDb.collection(COLL_DAILY_STATS).bulkWrite(bulkOps);
        if (bulkRevenueOps.length > 0) await mongoDb.collection(COLL_REVENUE).bulkWrite(bulkRevenueOps);
        if (bulkCorpOps.length > 0) await mongoDb.collection(COLL_CORP_REVENUE).bulkWrite(bulkCorpOps);
        pendingViewsCache.flushAll(); 
    } catch (e) {}
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
