const express = require('express');
const bodyParser = require('body-parser');
const paypal = require('paypal-rest-sdk');
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

const embedCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
const countsCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const tmdbCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
const recentCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
const historyCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const localDetailsCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

const pinnedCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const PINNED_CACHE_KEY = 'pinned_content_top';

const kdramaCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const KDRAMA_CACHE_KEY = 'kdrama_content_list';

const catalogCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const CATALOG_CACHE_KEY = 'full_catalog_list';

const RECENT_CACHE_KEY = 'recent_content_main';

const app = express();
dotenv.config();
const PORT = process.env.PORT || 3000;

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

paypal.configure({
    'mode': process.env.PAYPAL_MODE || 'sandbox',
    'client_id': process.env.PAYPAL_CLIENT_ID,
    'client_secret': process.env.PAYPAL_CLIENT_SECRET
});

const token = process.env.TELEGRAM_BOT_TOKEN;
const RENDER_BACKEND_URL = process.env.RENDER_EXTERNAL_URL || 'https://serivisios.onrender.com';

// --- CORRECCIÓN CLAVE 1: Configurar el bot para Webhook ---
const WEBHOOK_PATH = `/bot${token}`;
const WEBHOOK_URL = RENDER_BACKEND_URL + WEBHOOK_PATH;
const bot = new TelegramBot(token, { polling: false });

const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT_ID, 10);
const TMDB_API_KEY = process.env.TMDB_API_KEY;

let GLOBAL_STREAMING_ACTIVE = true;
const BUILD_ID_UNDER_REVIEW = 15;

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
const adminState = {};
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { return res.sendStatus(200); }
    next();
});

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

function countsCacheMiddleware(req, res, next) {
    if (!req.uid) return next();
    const uid = req.uid;
    const route = req.path;
    const cacheKey = `${uid}:${route}`;
    try {
        const cachedData = countsCache.get(cacheKey);
        if (cachedData) {
            return res.status(200).json(cachedData);
        }
    } catch (err) {
        console.error("Error al leer del caché de usuario:", err);
    }
    req.cacheKey = cacheKey;
    next();
}

async function llamarAlExtractor(targetUrl) {
    if (!targetUrl) return null;
    return targetUrl;
}

app.get('/api/content/featured', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    const cachedPinned = pinnedCache.get(PINNED_CACHE_KEY);
    if (cachedPinned) {
        return res.status(200).json(cachedPinned);
    }

    try {
        const projection = { tmdbId: 1, title: 1, name: 1, poster_path: 1, backdrop_path: 1, addedAt: 1, isPinned: 1 };

        const movies = await mongoDb.collection('media_catalog')
            .find({ isPinned: true })
            .project(projection)
            .sort({ addedAt: -1 })
            .limit(10)
            .toArray();

        const series = await mongoDb.collection('series_catalog')
            .find({ isPinned: true })
            .project(projection)
            .sort({ addedAt: -1 })
            .limit(10)
            .toArray();

        const formattedMovies = movies.map(m => formatLocalItem(m, 'movie'));
        const formattedSeries = series.map(s => formatLocalItem(s, 'tv'));

        const combined = [...formattedMovies, ...formattedSeries].sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));

        pinnedCache.set(PINNED_CACHE_KEY, combined);
        res.status(200).json(combined);

    } catch (error) {
        console.error("Error en /api/content/featured:", error);
        res.status(500).json({ error: "Error interno al obtener destacados." });
    }
});

app.get('/api/content/kdramas', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    const cachedKdramas = kdramaCache.get(KDRAMA_CACHE_KEY);
    if (cachedKdramas) {
        return res.status(200).json(cachedKdramas);
    }

    try {
        const projection = { tmdbId: 1, title: 1, name: 1, poster_path: 1, backdrop_path: 1, addedAt: 1, origin_country: 1 };

        const query = { origin_country: "KR" };

        const movies = await mongoDb.collection('media_catalog').find(query).project(projection).sort({ addedAt: -1 }).limit(50).toArray();
        const series = await mongoDb.collection('series_catalog').find(query).project(projection).sort({ addedAt: -1 }).limit(50).toArray();

        const formattedMovies = movies.map(m => formatLocalItem(m, 'movie'));
        const formattedSeries = series.map(s => formatLocalItem(s, 'tv'));

        const combined = [...formattedMovies, ...formattedSeries].sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));

        kdramaCache.set(KDRAMA_CACHE_KEY, combined);
        res.status(200).json(combined);

    } catch (error) {
        console.error("Error en /api/content/kdramas:", error);
        res.status(500).json({ error: "Error interno al obtener K-Dramas." });
    }
});

app.get('/api/content/catalog', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    const cachedCatalog = catalogCache.get(CATALOG_CACHE_KEY);
    if (cachedCatalog) {
        return res.status(200).json({ items: cachedCatalog, total: cachedCatalog.length });
    }

    try {
        const projection = { tmdbId: 1, title: 1, name: 1, poster_path: 1, media_type: 1, addedAt: 1, origin_country: 1, genre_ids: 1 };

        const movies = await mongoDb.collection('media_catalog').find({}).project(projection).sort({ addedAt: -1 }).limit(500).toArray();
        const series = await mongoDb.collection('series_catalog').find({}).project(projection).sort({ addedAt: -1 }).limit(500).toArray();

        const formattedMovies = movies.map(m => formatLocalItem(m, 'movie'));
        const formattedSeries = series.map(s => formatLocalItem(s, 'tv'));

        const combined = [...formattedMovies, ...formattedSeries].sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));

        catalogCache.set(CATALOG_CACHE_KEY, combined);

        res.status(200).json({
            items: combined,
            total: combined.length
        });

    } catch (error) {
        console.error("Error en /api/content/catalog:", error);
        res.status(500).json({ error: "Error interno al obtener catálogo." });
    }
});

app.get('/api/content/local', verifyIdToken, async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    const { type, genre, category, source } = req.query;

    try {
        const collection = (type === 'tv') ? mongoDb.collection('series_catalog') : mongoDb.collection('media_catalog');
        const projection = { tmdbId: 1, title: 1, name: 1, poster_path: 1, backdrop_path: 1, addedAt: 1, genres: 1 };

        if (category === 'populares' || category === 'tendencias' || category === 'series_populares') {
            let tmdbEndpoint = '';
            if (category === 'populares') tmdbEndpoint = 'movie/popular';
            else if (category === 'series_populares') tmdbEndpoint = 'tv/popular';
            else tmdbEndpoint = 'trending/all/day';

            let tmdbList = tmdbCache.get(`smart_cross_${category}`);
            if (!tmdbList) {
                try {
                    const resp = await axios.get(`https://api.themoviedb.org/3/${tmdbEndpoint}?api_key=${TMDB_API_KEY}&language=es-MX`);
                    tmdbList = resp.data.results || [];
                    tmdbCache.set(`smart_cross_${category}`, tmdbList, 3600);
                } catch (e) {
                    return res.status(200).json([]);
                }
            }

            const targetIds = tmdbList.map(item => item.id.toString());
            let localMatches = [];

            if (category === 'tendencias') {
                const movies = await mongoDb.collection('media_catalog').find({ tmdbId: { $in: targetIds } }).project(projection).toArray();
                const series = await mongoDb.collection('series_catalog').find({ tmdbId: { $in: targetIds } }).project(projection).toArray();
                const fMovies = movies.map(m => formatLocalItem(m, 'movie'));
                const fSeries = series.map(s => formatLocalItem(s, 'tv'));
                localMatches = [...fMovies, ...fSeries];
            } else {
                const matches = await collection.find({ tmdbId: { $in: targetIds } }).project(projection).toArray();
                localMatches = matches.map(m => formatLocalItem(m, type === 'tv' ? 'tv' : 'movie'));
            }

            const sortedMatches = [];
            targetIds.forEach(id => {
                const match = localMatches.find(m => m.tmdbId === id);
                if (match) sortedMatches.push(match);
            });

            return res.status(200).json(sortedMatches);
        }

        if (genre) {
            const genreId = parseInt(genre);

            let items = await collection.find({ genres: genreId }).project(projection).sort({ addedAt: -1 }).limit(20).toArray();

            if (items.length < 5) {
                const candidates = await collection.find({}).project(projection).sort({ addedAt: -1 }).limit(50).toArray();

                const verified = [];
                for (const item of candidates) {
                    if (items.find(i => i.tmdbId === item.tmdbId)) continue;

                    let hasGenre = false;
                    if (item.genres && Array.isArray(item.genres) && item.genres.length > 0) {
                        if (item.genres.includes(genreId)) hasGenre = true;
                    }
                    else {
                        const cacheKey = `genre_chk_${type}_${item.tmdbId}`;
                        let cachedGenres = localDetailsCache.get(cacheKey);
                        if (!cachedGenres) {
                            try {
                                const url = `https://api.themoviedb.org/3/${type}/${item.tmdbId}?api_key=${TMDB_API_KEY}`;
                                const resp = await axios.get(url);
                                cachedGenres = resp.data.genres.map(g => g.id);
                                localDetailsCache.set(cacheKey, cachedGenres);
                                await collection.updateOne({ _id: item._id }, { $set: { genres: cachedGenres } });
                            } catch (e) {}
                        }
                        if (cachedGenres && cachedGenres.includes(genreId)) hasGenre = true;
                    }

                    if (hasGenre) verified.push(item);
                    if (verified.length + items.length >= 20) break;
                }
                items = [...items, ...verified];
            }

            const formatted = items.map(i => formatLocalItem(i, type === 'tv' ? 'tv' : 'movie'));
            return res.status(200).json(formatted);
        }

        const allItems = await collection.find({})
            .project(projection)
            .sort({ addedAt: -1 })
            .limit(100)
            .toArray();

        const formattedAll = allItems.map(i => formatLocalItem(i, type === 'tv' ? 'tv' : 'movie'));
        res.status(200).json(formattedAll);

    } catch (error) {
        console.error("Error en /api/content/local:", error);
        res.status(500).json({ error: "Error interno." });
    }
});

function formatLocalItem(item, type) {
    return {
        id: parseInt(item.tmdbId),
        tmdbId: item.tmdbId,
        title: item.title || item.name,
        name: item.name || item.title,
        poster_path: item.poster_path,
        backdrop_path: item.backdrop_path,
        media_type: type,
        isPinned: item.isPinned || false,
        isLocal: true,
        addedAt: item.addedAt
    };
}

app.get('/api/tmdb-proxy', async (req, res) => {
    const endpoint = req.query.endpoint;
    const query = req.query.query;

    if (!endpoint) {
        return res.status(400).json({ error: 'Endpoint is required' });
    }

    const cacheKey = JSON.stringify(req.query);

    const cachedResponse = tmdbCache.get(cacheKey);
    if (cachedResponse) {
        return res.json(cachedResponse);
    }

    try {
        const url = `https://api.themoviedb.org/3/${endpoint}`;
        const params = {
            api_key: TMDB_API_KEY,
            language: 'es-MX',
            include_adult: false
        };

        if (query) params.query = query;
        if (req.query.page) params.page = req.query.page;
        if (req.query.with_genres) params.with_genres = req.query.with_genres;
        if (req.query.with_keywords) params.with_keywords = req.query.with_keywords;
        if (req.query.sort_by) params.sort_by = req.query.sort_by;

        const response = await axios.get(url, { params });
        tmdbCache.set(cacheKey, response.data);
        res.json(response.data);

    } catch (error) {
        console.error(`Error en Proxy TMDB (${endpoint}):`, error.message);
        if (error.response) {
            return res.status(error.response.status).json(error.response.data);
        }
        res.status(500).json({ error: 'Error al conectar con TMDB' });
    }
});

app.get('/api/content/recent', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });
    const cachedRecent = recentCache.get(RECENT_CACHE_KEY);
    if (cachedRecent) {
        return res.status(200).json(cachedRecent);
    }

    try {
        const moviesPromise = mongoDb.collection('media_catalog')
            .find({ hideFromRecent: { $ne: true } })
            .project({ tmdbId: 1, title: 1, poster_path: 1, backdrop_path: 1, addedAt: 1 })
            .sort({ addedAt: -1 })
            .limit(20)
            .toArray();
        const seriesPromise = mongoDb.collection('series_catalog')
            .find({})
            .project({ tmdbId: 1, name: 1, poster_path: 1, backdrop_path: 1, addedAt: 1 })
            .sort({ addedAt: -1 })
            .limit(20)
            .toArray();
        const [movies, series] = await Promise.all([moviesPromise, seriesPromise]);
        const formattedMovies = movies.map(movie => ({
            id: movie.tmdbId,
            tmdbId: movie.tmdbId,
            title: movie.title,
            poster_path: movie.poster_path,
            backdrop_path: movie.backdrop_path,
            media_type: 'movie',
            addedAt: movie.addedAt ? new Date(movie.addedAt) : new Date(0)
        }));

        const formattedSeries = series.map(serie => ({
            id: serie.tmdbId,
            tmdbId: serie.tmdbId,
            title: serie.name,
            poster_path: serie.poster_path,
            backdrop_path: serie.backdrop_path,
            media_type: 'tv',
            addedAt: serie.addedAt ? new Date(serie.addedAt) : new Date(0)
        }));
        const combinedResults = [...formattedMovies, ...formattedSeries];
        combinedResults.sort((a, b) => b.addedAt - a.addedAt);
        const finalResults = combinedResults.slice(0, 20);
        recentCache.set(RECENT_CACHE_KEY, finalResults);

        res.status(200).json(finalResults);

    } catch (error) {
        console.error("Error en /api/content/recent:", error);
        res.status(500).json({ error: "Error interno al obtener contenido reciente." });
    }
});

app.get('/api/user/me', verifyIdToken, countsCacheMiddleware, async (req, res) => {
    const { uid, email, cacheKey } = req;
    const usernameFromQuery = req.query.username;
    try {
        const userDocRef = db.collection('users').doc(uid);
        const docSnap = await userDocRef.get();
        const now = new Date();
        let userData;
        if (docSnap.exists) {
            userData = docSnap.data();
            let isPro = userData;
            const expiresAt = userData.premiumExpiry ? new Date(userData.premiumExpiry.toDate()) : now;
            if (expiresAt > now) {
                isPro = true;
            } else {
                isPro = false;
            }
            const responseData = {
                uid: uid,
                email: email,
                isPro: isPro,
                username: userData.username || email,
                flair: userData.flair || ""
            };
            countsCache.set(cacheKey, responseData);
            return res.status(200).json(responseData);
        } else {
            const initialData = {
                email: email,
                createdAt: now,
                updatedAt: now,
                username: usernameFromQuery || email,
                coins: 0,
                premiumExpiry: now,
                flair: ""
            };
            await userDocRef.set(initialData);
            const responseData = { uid: uid, email: email, isPro: false, username: initialData.username, flair: initialData.flair };
            countsCache.set(cacheKey, responseData);
            return res.status(200).json(responseData);
        }
    } catch (error) {
        console.error("Error en /api/user/me:", error);
        res.status(500).json({ error: 'Error al obtener datos del usuario.' });
    }
});

app.post('/api/user/profile', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { username, flair } = req.body;
    if (!username || username.length < 3) {
        return res.status(400).json({ error: 'Nombre de usuario inválido.' });
    }
    try {
        const userDocRef = db.collection('users').doc(uid);
        await userDocRef.update({ username: username, flair: flair || "" });
        countsCache.del(`${uid}:/api/user/me`);
        res.status(200).json({ message: 'Perfil actualizado con éxito.' });
    } catch (error) {
        console.error("Error en /api/user/profile:", error);
        res.status(500).json({ error: 'Error al actualizar el perfil.' });
    }
});

app.get('/api/user/coins', verifyIdToken, countsCacheMiddleware, async (req, res) => {
    const { uid, cacheKey } = req;
    try {
        const userDocRef = db.collection('users').doc(uid);
        const docSnap = await userDocRef.get();
        const coins = docSnap.exists ? (docSnap.data().coins || 0) : 0;
        const responseData = { coins };
        countsCache.set(cacheKey, responseData);
        res.status(200).json(responseData);
    } catch (error) {
        console.error("Error en /api/user/coins (GET):", error);
        res.status(500).json({ error: 'Error al obtener el balance.' });
    }
});

app.post('/api/user/coins', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { amount } = req.body;
    if (!amount || isNaN(parseInt(amount))) {
        return res.status(400).json({ error: 'Monto inválido.' });
    }
    const amountInt = parseInt(amount, 10);
    try {
        const userDocRef = db.collection('users').doc(uid);
        const newCoins = await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(userDocRef);
            const currentCoins = doc.data()?.coins || 0;
            const newBalance = currentCoins + amountInt;
            if (newBalance < 0) {
                throw new Error("Saldo insuficiente");
            }
            transaction.update(userDocRef, { coins: newBalance });
            return newBalance;
        });
        countsCache.del(`${uid}:/api/user/coins`);
        res.status(200).json({ message: 'Balance actualizado', coins: newCoins });
    } catch (error) {
        console.error("Error en /api/user/coins (POST):", error);
        if (error.message === "Saldo insuficiente") {
            return res.status(400).json({ error: 'Saldo insuficiente.' });
        }
        res.status(500).json({ error: 'Error al actualizar el balance.' });
    }
});

app.get('/api/user/history', verifyIdToken, countsCacheMiddleware, async (req, res) => {
    const { uid, cacheKey } = req;
    try {
        const historyRef = db.collection('history');
        const q = historyRef.where('userId', '==', uid).orderBy('timestamp', 'desc').limit(20);
        const querySnapshot = await q.get();
        const history = querySnapshot.docs.map(doc => doc.data());
        const responseData = { history };
        historyCache.set(cacheKey, responseData);
        res.status(200).json(responseData);
    } catch (error) {
        console.error("Error en /api/user/history (GET):", error);
        res.status(500).json({ error: 'Error al obtener el historial.' });
    }
});

app.post('/api/user/history', verifyIdToken, async (req, res) => {
    const { uid } = req;
    let { tmdbId, title, poster_path, backdrop_path, type } = req.body;
    if (!tmdbId || !type) {
        return res.status(400).json({ error: 'tmdbId y type requeridos.' });
    }
    const rawId = String(tmdbId).trim();
    const idAsString = rawId;
    const idAsNumber = Number(rawId);
    const possibleIds = [idAsString];
    if (!isNaN(idAsNumber)) {
        possibleIds.push(idAsNumber);
    }
    if (!backdrop_path && mongoDb) {
        try {
            let mediaDoc = null;
            if (type === 'movie') {
                mediaDoc = await mongoDb.collection('media_catalog').findOne({ tmdbId: idAsString });
            } else {
                mediaDoc = await mongoDb.collection('series_catalog').findOne({ tmdbId: idAsString });
            }
            if (mediaDoc && mediaDoc.backdrop_path) {
                backdrop_path = mediaDoc.backdrop_path;
                if (!poster_path) poster_path = mediaDoc.poster_path;
            }
        } catch (err) {
            console.warn(`[History Fix] Warn: ${err.message}`);
        }
    }
    try {
        const historyRef = db.collection('history');
        const q = historyRef.where('userId', '==', uid).where('tmdbId', 'in', possibleIds);
        const querySnapshot = await q.limit(1).get();
        if (!querySnapshot.empty) {
            const doc = querySnapshot.docs[0];
            await doc.ref.update({ timestamp: admin.firestore.FieldValue.serverTimestamp() });
        } else {
            await historyRef.add({
                userId: uid,
                tmdbId: idAsString,
                title: title,
                poster_path: poster_path || null,
                backdrop_path: backdrop_path || null,
                type: type,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        historyCache.del(`${uid}:/api/user/history`);
        res.status(200).json({ message: 'Historial actualizado.' });
    } catch (error) {
        console.error("Error en /api/user/history (POST):", error);
        res.status(500).json({ error: 'Error al actualizar el historial.' });
    }
});

app.get('/api/user/progress', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { seriesId } = req.query;
    if (!seriesId) {
        return res.status(400).json({ error: 'seriesId requerido.' });
    }
    try {
        const progressRef = db.collection('watchProgress').doc(`${uid}_${seriesId}`);
        const docSnap = await progressRef.get();
        if (docSnap.exists) {
            const lastWatched = docSnap.data().lastWatched;
            return res.status(200).json({ lastWatched });
        }
        res.status(200).json({ lastWatched: null });
    } catch (error) {
        console.error("Error en /api/user/progress (GET):", error);
        res.status(500).json({ error: 'Error al obtener el progreso.' });
    }
});

app.post('/api/user/favorites', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { tmdbId, title, poster_path, type } = req.body;
    if (!tmdbId || !type) {
        return res.status(400).json({ error: 'tmdbId y type requeridos.' });
    }
    try {
        const favoritesRef = db.collection('favorites');
        const q = favoritesRef.where('userId', '==', uid).where('tmdbId', '==', tmdbId);
        const querySnapshot = await q.limit(1).get();
        if (!querySnapshot.empty) {
            return res.status(200).json({ message: 'Este contenido ya está en Mi lista.' });
        }
        await favoritesRef.add({ userId: uid, tmdbId: tmdbId, title: title, poster_path: poster_path, type: type });
        res.status(200).json({ message: 'Agregado a Mi lista.' });
    } catch (error) {
        console.error("Error en /api/user/favorites (POST):", error);
        res.status(500).json({ error: 'Error al agregar a favoritos.' });
    }
});

app.get('/api/user/favorites', verifyIdToken, async (req, res) => {
    const { uid } = req;
    try {
        const favoritesRef = db.collection('favorites');
        const q = favoritesRef.where('userId', '==', uid);
        const querySnapshot = await q.get();
        const favorites = querySnapshot.docs.map(doc => doc.data());
        res.status(200).json({ favorites });
    } catch (error) {
        console.error("Error en /api/user/favorites (GET):", error);
        res.status(500).json({ error: 'Error al obtener favoritos.' });
    }
});

app.delete('/api/user/favorites', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { tmdbId } = req.query;
    if (!tmdbId) {
        return res.status(400).json({ error: 'tmdbId requerido.' });
    }
    try {
        const favoritesRef = db.collection('favorites');
        const q = favoritesRef.where('userId', '==', uid).where('tmdbId', '==', tmdbId);
        const querySnapshot = await q.limit(1).get();
        if (!querySnapshot.empty) {
            await querySnapshot.docs[0].ref.delete();
            return res.status(200).json({ message: 'Eliminado de Mi lista.' });
        }
        res.status(404).json({ error: 'Contenido no encontrado en Mi lista.' });
    } catch (error) {
        console.error("Error en /api/user/favorites (DELETE):", error);
        res.status(500).json({ error: 'Error al eliminar de favoritos.' });
    }
});

app.post('/api/user/likes', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { tmdbId, type } = req.body;
    if (!tmdbId || !type) {
        return res.status(400).json({ error: 'tmdbId y type requeridos.' });
    }
    try {
        const likesRef = db.collection('likes');
        const q = likesRef.where('userId', '==', uid).where('tmdbId', '==', tmdbId);
        const querySnapshot = await q.limit(1).get();
        if (querySnapshot.empty) {
            await likesRef.add({ userId: uid, tmdbId: tmdbId, type: type, timestamp: admin.firestore.FieldValue.serverTimestamp() });
            res.status(200).json({ message: 'Like registrado.' });
        } else {
            return res.status(200).json({ message: 'Like ya existe (no se registró duplicado).' });
        }
    } catch (error) {
        console.error("Error en /api/user/likes:", error);
        res.status(500).json({ error: 'Error al registrar el like.' });
    }
});

app.post('/api/rewards/redeem/premium', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { daysToAdd } = req.body;
    if (!daysToAdd) {
        return res.status(400).json({ success: false, error: 'daysToAdd es requerido.' });
    }
    const days = parseInt(daysToAdd, 10);
    if (isNaN(days) || days <= 0) {
        return res.status(400).json({ success: false, error: 'daysToAdd debe ser un número positivo.' });
    }
    try {
        const userDocRef = db.collection('users').doc(uid);
        const newExpiryDate = await db.runTransaction(async (transaction) => {
            const docSnap = await transaction.get(userDocRef);
            let currentExpiry;
            const now = new Date();
            if (docSnap.exists && docSnap.data().premiumExpiry) {
                const expiryData = docSnap.data().premiumExpiry;
                if (expiryData.toDate && typeof expiryData.toDate === 'function') {
                    currentExpiry = expiryData.toDate();
                } else if (typeof expiryData === 'number') {
                    currentExpiry = new Date(expiryData);
                } else {
                    currentExpiry = new Date(0);
                }
            } else {
                currentExpiry = new Date(0);
            }
            let baseDate = (currentExpiry > now) ? currentExpiry : now;
            baseDate.setHours(0, 0, 0, 0);
            const newDate = new Date(baseDate);
            newDate.setDate(newDate.getDate() + days);
            transaction.update(userDocRef, { premiumExpiry: newDate });
            return newDate;
        });
        countsCache.del(`${uid}:/api/user/me`);
        res.status(200).json({ success: true, message: `Premium activado por ${days} días. Vence: ${newExpiryDate.toISOString().split('T')[0]}` });
    } catch (error) {
        console.error("Error en /api/rewards/redeem/premium:", error);
        res.status(500).json({ success: false, error: 'Error al activar premium.' });
    }
});

app.post('/api/rewards/redeem/coins', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { amount } = req.body;
    if (!amount || isNaN(parseInt(amount)) || parseInt(amount) <= 0) {
        return res.status(400).json({ success: false, error: 'Monto de monedas inválido.' });
    }
    const amountInt = parseInt(amount, 10);
    try {
        const userDocRef = db.collection('users').doc(uid);
        const newCoins = await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(userDocRef);
            const currentCoins = doc.data()?.coins || 0;
            const newBalance = currentCoins + amountInt;
            transaction.update(userDocRef, { coins: newBalance });
            return newBalance;
        });
        countsCache.del(`${uid}:/api/user/coins`);
        res.status(200).json({ success: true, message: `Has recibido ${amountInt} monedas. Total: ${newCoins}` });
    } catch (error) {
        console.error("Error en /api/rewards/redeem/coins:", error);
        res.status(500).json({ success: false, error: 'Error al dar monedas.' });
    }
});

app.post('/api/payments/paypal/create-payment', verifyIdToken, async (req, res) => {
    const { amount, description, userId } = req.body;
    const returnUrl = RENDER_BACKEND_URL + '/api/payments/paypal/execute-payment';
    const cancelUrl = RENDER_BACKEND_URL + '/api/payments/paypal/cancel-payment';
    const create_payment_json = {
        "intent": "sale",
        "payer": { "payment_method": "paypal" },
        "redirect_urls": { "return_url": returnUrl, "cancel_url": cancelUrl },
        "transactions": [{
            "item_list": { "items": [{ "name": description, "sku": "001", "price": amount, "currency": "USD", "quantity": "1" }] },
            "amount": { "currency": "USD", "total": amount },
            "description": description,
            "custom": JSON.stringify({ userId: userId })
        }]
    };
    paypal.payment.create(create_payment_json, function (error, payment) {
        if (error) {
            console.error("Error al crear pago de PayPal:", error);
            return res.status(500).json({ error: "Error al crear pago." });
        } else {
            for (let i = 0; i < payment.links.length; i++) {
                if (payment.links[i].rel === 'approval_url') {
                    return res.status(200).json({ approvalUrl: payment.links[i].href });
                }
            }
            res.status(500).json({ error: "No se encontró URL de aprobación." });
        }
    });
});

app.get('/api/payments/paypal/execute-payment', verifyIdToken, async (req, res) => {
    const { paymentId, PayerID } = req.query;
    if (!paymentId || !PayerID) {
        return res.redirect(process.env.APP_FRONTEND_URL + '/payment-failed');
    }
    const execute_payment_json = { "payer_id": PayerID, "transactions": [{ "amount": { "currency": "USD", "total": "0.00" } }] };
    paypal.payment.get(paymentId, function (error, payment) {
        if (error) {
            console.error("Error al obtener detalles de pago:", error);
            return res.redirect(process.env.APP_FRONTEND_URL + '/payment-failed');
        }
        const transaction = payment.transactions[0];
        const amount = parseFloat(transaction.amount.total);
        const customData = JSON.parse(transaction.custom);
        const userId = customData.userId;
        const execute_payment_json_final = { "payer_id": PayerID, "transactions": [{ "amount": { "currency": "USD", "total": amount.toFixed(2) } }] };
        paypal.payment.execute(paymentId, execute_payment_json_final, async function (error, payment) {
            if (error) {
                console.error("Error al ejecutar pago:", error);
                return res.redirect(process.env.APP_FRONTEND_URL + '/payment-failed');
            }
            try {
                const paymentLogRef = db.collection('payment_logs').doc(paymentId);
                await paymentLogRef.set({
                    userId: userId,
                    amount: amount,
                    status: 'completed',
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    paymentData: payment
                });

                let daysToAdd = 0;
                let coinsToAdd = 0;
                if (amount >= 10.00) { daysToAdd = 365; coinsToAdd = 5000; }
                else if (amount >= 5.00) { daysToAdd = 90; coinsToAdd = 2000; }
                else if (amount >= 1.00) { daysToAdd = 30; coinsToAdd = 500; }

                if (daysToAdd > 0) {
                    const userDocRef = db.collection('users').doc(userId);
                    await db.runTransaction(async (transaction) => {
                        const docSnap = await transaction.get(userDocRef);
                        let currentExpiry;
                        const now = new Date();
                        if (docSnap.exists && docSnap.data().premiumExpiry) {
                            const expiryData = docSnap.data().premiumExpiry;
                            if (expiryData.toDate && typeof expiryData.toDate === 'function') {
                                currentExpiry = expiryData.toDate();
                            } else if (typeof expiryData === 'number') {
                                currentExpiry = new Date(expiryData);
                            } else {
                                currentExpiry = new Date(0);
                            }
                        } else {
                            currentExpiry = new Date(0);
                        }
                        let baseDate = (currentExpiry > now) ? currentExpiry : now;
                        baseDate.setHours(0, 0, 0, 0);
                        const newDate = new Date(baseDate);
                        newDate.setDate(newDate.getDate() + daysToAdd);
                        transaction.update(userDocRef, { premiumExpiry: newDate, coins: admin.firestore.FieldValue.increment(coinsToAdd) });
                    });
                    countsCache.del(`${userId}:/api/user/me`);
                    countsCache.del(`${userId}:/api/user/coins`);
                }
                return res.redirect(process.env.APP_FRONTEND_URL + '/payment-success');
            } catch (e) {
                console.error("Error al procesar la recompensa:", e);
                return res.redirect(process.env.APP_FRONTEND_URL + '/payment-failed');
            }
        });
    });
});

app.get('/api/payments/paypal/cancel-payment', (req, res) => {
    res.redirect(process.env.APP_FRONTEND_URL + '/payment-cancelled');
});

app.post('/api/admin/send-fcm', async (req, res) => {
    const { topic, title, body, dataPayload } = req.body;
    if (!topic || !title || !body) {
        return res.status(400).json({ success: false, error: 'Topic, title y body son requeridos.' });
    }
    const message = {
        notification: { title: title, body: body },
        data: dataPayload,
        topic: topic,
        android: { priority: 'high' }
    };
    try {
        console.log(`🚀 Intentando enviar notificación al topic '${topic}'... Payload:`, JSON.stringify(dataPayload));
        const response = await messaging.send(message);
        console.log('✅ Notificación FCM enviada exitosamente al topic:', response);
        res.status(200).json({ success: true, message: `Notificación enviada al topic '${topic}'.`, response: response });
    } catch (error) {
        console.error(`❌ Error al enviar notificación FCM al topic '${topic}':`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/diamonds/notify-request', async (req, res) => {
    const { gameId, amount, userId } = req.body;
    if (!gameId || !amount || !userId) {
        return res.status(400).json({ error: 'gameId, amount y userId son requeridos.' });
    }
    try {
        const adminMessage = `💎 SOLICITUD DE DIAMANTES PENDIENTE\n\nID de Juego: *${gameId}*\nCantidad: *${amount}*\nUsuario Firebase ID: \`${userId}\``;
        bot.sendMessage(ADMIN_CHAT_ID, adminMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Marcar como Recargado', callback_data: `diamond_completed_${gameId}` }]
                ]
            }
        });
        res.status(200).json({ message: 'Solicitud de diamantes enviada al administrador.' });
    } catch (error) {
        console.error("Error al procesar la solicitud de diamantes:", error);
        res.status(500).json({ error: 'Error al enviar la notificación de diamantes.' });
    }
});

app.get('/api/app/status', (req, res) => {
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

app.get('/api/get-movie-data', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "El ID del contenido es requerido." });
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
    try {
        let movieDoc = await mongoDb.collection('media_catalog').findOne({ tmdbId: id.toString() }, { projection: { views: 1, likes: 1 } });
        let seriesDoc = await mongoDb.collection('series_catalog').findOne({ tmdbId: id.toString() }, { projection: { views: 1, likes: 1 } });
        const data = movieDoc || seriesDoc;
        const views = data?.views || 0;
        const likes = data?.likes || 0;
        const responseData = { views: views, likes: likes };
        countsCache.set(cacheKey, responseData);
        res.status(200).json(responseData);
    } catch (error) {
        console.error("Error get-movie-data:", error);
        res.status(500).json({ error: "Error interno al obtener datos." });
    }
});

app.get('/api/get-embed-code', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });
    const { id, season, episode, isPro } = req.query;
    if (!id) return res.status(400).json({ error: "ID no proporcionado" });
    const cacheKey = `embed-${id}-${season || 'movie'}-${episode || '1'}-${isPro === 'true' ? 'pro' : 'free'}`;
    try {
        const cachedData = embedCache.get(cacheKey);
        if (cachedData) {
            console.log(`[Cache HIT] Sirviendo embed manual desde caché para: ${cacheKey}`);
            return res.json({ embedCode: cachedData });
        }
    } catch (err) {
        console.error("Error al leer del caché de embeds:", err);
    }
    console.log(`[Cache MISS] Buscando embed en MongoDB para: ${cacheKey}`);
    try {
        const mediaType = season && episode ? 'series' : 'movies';
        const collectionName = (mediaType === 'movies') ? 'media_catalog' : 'series_catalog';
        const doc = await mongoDb.collection(collectionName).findOne({ tmdbId: id.toString() });
        if (!doc) return res.status(404).json({ error: `${mediaType} no encontrada.` });
        let enlaceFinal = null;
        if (mediaType === 'movies') {
            enlaceFinal = (isPro === 'true') ? doc.proEmbedCode : doc.freeEmbedCode;
        } else {
            const seasonKey = `S${season}`;
            const episodeKey = `E${episode}`;
            if (doc.seasons && doc.seasons[seasonKey] && doc.seasons[seasonKey][episodeKey]) {
                const episodeData = doc.seasons[seasonKey][episodeKey];
                enlaceFinal = (isPro === 'true') ? episodeData.proEmbedCode : episodeData.freeEmbedCode;
            }
        }
        if (!enlaceFinal) {
            return res.status(404).json({ error: "Enlace embed no encontrado para este episodio/tipo." });
        }
        const extracted_link = await llamarAlExtractor(enlaceFinal);
        embedCache.set(cacheKey, extracted_link);
        res.json({ embedCode: extracted_link });
    } catch (error) {
        console.error("Error al obtener embed:", error);
        res.status(500).json({ error: "Error interno." });
    }
});

app.get('/api/get-metrics', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });
    const { id, field } = req.query;
    if (!id || !field || (field !== 'views' && field !== 'likes')) {
        return res.status(400).json({ error: "ID y campo ('views' o 'likes') requeridos." });
    }
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
    try {
        let doc = await mongoDb.collection('media_catalog').findOne({ tmdbId: id.toString() }, { projection: { [field]: 1 } });
        if (!doc) doc = await mongoDb.collection('series_catalog').findOne({ tmdbId: id.toString() }, { projection: { [field]: 1 } });
        const responseData = { count: doc?.[field] || 0 };
        countsCache.set(cacheKey, responseData);
        res.status(200).json(responseData);
    } catch (error) {
        console.error(`Error get-metrics (${field}):`, error);
        res.status(500).json({ error: "Error interno." });
    }
});

app.post('/api/increment-views', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    const { tmdbId } = req.body;
    if (!tmdbId) return res.status(400).json({ error: 'tmdbId requerido.' });
    const cleanTmdbId = String(tmdbId).trim();
    try {
        const movieResult = await mongoDb.collection('media_catalog').updateOne({ tmdbId: cleanTmdbId }, { $inc: { views: 1 } });
        const seriesResult = await mongoDb.collection('series_catalog').updateOne({ tmdbId: cleanTmdbId }, { $inc: { views: 1 } });
        if (movieResult.matchedCount === 0 && seriesResult.matchedCount === 0) {
            return res.status(404).json({ error: 'Contenido no encontrado.' });
        }
        countsCache.del(`counts-data-${cleanTmdbId}`);
        countsCache.del(`counts-metrics-${cleanTmdbId}-views`);
        res.status(200).json({ message: 'Vistas incrementadas.' });
    } catch (error) {
        console.error("Error increment-views:", error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

app.post('/api/increment-likes', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    const { tmdbId } = req.body;
    if (!tmdbId) return res.status(400).json({ error: 'tmdbId requerido.' });
    const cleanTmdbId = String(tmdbId).trim();
    try {
        const movieResult = await mongoDb.collection('media_catalog').updateOne({ tmdbId: cleanTmdbId }, { $inc: { likes: 1 } });
        const seriesResult = await mongoDb.collection('series_catalog').updateOne({ tmdbId: cleanTmdbId }, { $inc: { likes: 1 } });
        if (movieResult.matchedCount === 0 && seriesResult.matchedCount === 0) {
            return res.status(404).json({ error: 'Contenido no encontrado.' });
        }
        countsCache.del(`counts-data-${cleanTmdbId}`);
        countsCache.del(`counts-metrics-${cleanTmdbId}-likes`);
        res.status(200).json({ message: 'Likes incrementados.' });
    } catch (error) {
        console.error("Error increment-likes:", error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

app.post('/add-movie', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    try {
        const { tmdbId, title, poster_path, freeEmbedCode, proEmbedCode, isPremium, overview, hideFromRecent, genres, release_date, popularity, vote_average, isPinned, origin_country } = req.body;
        if (!tmdbId) return res.status(400).json({ error: 'tmdbId requerido.' });
        const cleanTmdbId = String(tmdbId).trim();
        const updateQuery = { $set: { title, poster_path, overview, freeEmbedCode, proEmbedCode, isPremium, hideFromRecent: hideFromRecent === true || hideFromRecent === 'true', genres: genres || [], release_date: release_date || null, popularity: popularity || 0, vote_average: vote_average || 0, isPinned: isPinned === true || isPinned === 'true', origin_country: origin_country || [] }, $setOnInsert: { tmdbId: cleanTmdbId, views: 0, likes: 0, addedAt: new Date() } };
        await mongoDb.collection('media_catalog').updateOne({ tmdbId: cleanTmdbId }, updateQuery, { upsert: true });
        try { await mongoDb.collection('movie_requests').deleteOne({ tmdbId: cleanTmdbId }); console.log(`[Auto-Clean] Pedido eliminado tras subida: ${title} (${cleanTmdbId})`); } catch (cleanupError) { console.warn(`[Auto-Clean Warning] No se pudo limpiar el pedido: ${cleanupError.message}`); }
        embedCache.del(`embed-${cleanTmdbId}-movie-1-pro`);
        embedCache.del(`embed-${cleanTmdbId}-movie-1-free`);
        countsCache.del(`counts-data-${cleanTmdbId}`);
        recentCache.del(RECENT_CACHE_KEY);
        pinnedCache.del(PINNED_CACHE_KEY);
        kdramaCache.del(KDRAMA_CACHE_KEY);
        catalogCache.del(CATALOG_CACHE_KEY);
        console.log(`[Cache] Cachés (Recent, Pinned, Kdrama, Catalog) invalidadas por subida de película: ${title}`);
        res.status(200).json({ message: 'Película agregada y publicada.' });
    } catch (error) {
        console.error("Error add-movie:", error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

app.post('/add-series-episode', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    try {
        const { tmdbId, title, poster_path, seasonNumber, episodeNumber, freeEmbedCode, proEmbedCode, isPremium, overview, hideFromRecent, genres, release_date, popularity, vote_average, isPinned, origin_country } = req.body;
        if (!tmdbId || !seasonNumber || !episodeNumber) return res.status(400).json({ error: 'tmdbId, seasonNumber y episodeNumber requeridos.' });
        const cleanTmdbId = String(tmdbId).trim();
        const episodePath = `seasons.S${seasonNumber}.E${episodeNumber}`;
        const updateData = {
            $set: {
                [`${episodePath}.freeEmbedCode`]: freeEmbedCode,
                [`${episodePath}.proEmbedCode`]: proEmbedCode,
                [`${episodePath}.isPremium`]: isPremium,
            },
            $setOnInsert: {
                tmdbId: cleanTmdbId,
                views: 0,
                likes: 0,
                addedAt: new Date(),
                name: title,
                poster_path: poster_path,
                overview: overview,
                hideFromRecent: hideFromRecent === true || hideFromRecent === 'true',
                genres: genres || [],
                release_date: release_date || null,
                popularity: popularity || 0,
                vote_average: vote_average || 0,
                isPinned: isPinned === true || isPinned === 'true',
                origin_country: origin_country || []
            }
        };
        await mongoDb.collection('series_catalog').updateOne({ tmdbId: cleanTmdbId }, updateData, { upsert: true });
        try { await mongoDb.collection('movie_requests').deleteOne({ tmdbId: cleanTmdbId }); console.log(`[Auto-Clean] Pedido eliminado tras subida episodio: ${title} (${cleanTmdbId})`); } catch (cleanupError) { console.warn(`[Auto-Clean Warning] No se pudo limpiar el pedido: ${cleanupError.message}`); }
        embedCache.del(`embed-${cleanTmdbId}-${seasonNumber}-${episodeNumber}-pro`);
        embedCache.del(`embed-${cleanTmdbId}-${seasonNumber}-${episodeNumber}-free`);
        countsCache.del(`counts-data-${cleanTmdbId}`);
        recentCache.del(RECENT_CACHE_KEY);
        pinnedCache.del(PINNED_CACHE_KEY);
        kdramaCache.del(KDRAMA_CACHE_KEY);
        catalogCache.del(CATALOG_CACHE_KEY);
        console.log(`[Cache] Cachés (Recent, Pinned, Kdrama, Catalog) invalidadas por subida de episodio: S${seasonNumber}E${episodeNumber}`);
        res.status(200).json({ message: `Episodio S${seasonNumber}E${episodeNumber} agregado y publicado.` });
    } catch (error) {
        console.error("Error add-series-episode:", error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

app.post('/delete-series-episode', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    try {
        const { tmdbId, seasonNumber, episodeNumber } = req.body;
        if (!tmdbId || !seasonNumber || !episodeNumber) return res.status(400).json({ error: 'tmdbId, seasonNumber y episodeNumber requeridos.' });
        const cleanTmdbId = String(tmdbId).trim();
        const episodePath = `seasons.S${seasonNumber}.E${episodeNumber}`;
        const updateResult = await mongoDb.collection('series_catalog').updateOne(
            { tmdbId: cleanTmdbId },
            { $unset: { [episodePath]: "" } }
        );
        if (updateResult.modifiedCount === 0) {
            return res.status(404).json({ error: 'Episodio no encontrado para eliminar.' });
        }
        embedCache.del(`embed-${cleanTmdbId}-${seasonNumber}-${episodeNumber}-pro`);
        embedCache.del(`embed-${cleanTmdbId}-${seasonNumber}-${episodeNumber}-free`);
        countsCache.del(`counts-data-${cleanTmdbId}`);
        recentCache.del(RECENT_CACHE_KEY);
        pinnedCache.del(PINNED_CACHE_KEY);
        kdramaCache.del(KDRAMA_CACHE_KEY);
        catalogCache.del(CATALOG_CACHE_KEY);
        console.log(`[Cache] Cachés (Recent, Pinned, Kdrama, Catalog) invalidadas por eliminación de episodio: S${seasonNumber}E${episodeNumber}`);
        res.status(200).json({ message: `Episodio S${seasonNumber}E${episodeNumber} eliminado.` });
    } catch (error) {
        console.error("Error delete-series-episode:", error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

app.post('/api/movie-request', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    const { title, tmdbId, userId, username, type } = req.body;
    if (!title || !tmdbId || !userId || !username || !type) {
        return res.status(400).json({ error: 'Faltan campos requeridos.' });
    }
    const cleanTmdbId = String(tmdbId).trim();
    try {
        const existingRequest = await mongoDb.collection('movie_requests').findOne({ tmdbId: cleanTmdbId });
        if (existingRequest) {
            await mongoDb.collection('movie_requests').updateOne({ tmdbId: cleanTmdbId }, { $set: { updatedAt: new Date() }, $inc: { count: 1 } });
            bot.sendMessage(userId, `Ya tenemos una solicitud para *${title}*. ¡Gracias por el interés!`, { parse_mode: 'Markdown' });
            return res.status(200).json({ message: 'Solicitud ya existe, actualizada.' });
        }
        await mongoDb.collection('movie_requests').insertOne({
            title,
            tmdbId: cleanTmdbId,
            userId,
            username,
            type,
            status: 'pending',
            createdAt: new Date(),
            updatedAt: new Date(),
            count: 1
        });
        const requestMessage = `✨ NUEVO PEDIDO (${type.toUpperCase()}) ✨\n\n*${title}* \`(${cleanTmdbId})\`\nSolicitado por: ${username} (\`${userId}\`)`;
        bot.sendMessage(ADMIN_CHAT_ID, requestMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✔️ Marcar como Agregada', callback_data: `request_fulfilled_${cleanTmdbId}` }]
                ]
            }
        });
        bot.sendMessage(userId, `¡Tu solicitud de *${title}* ha sido registrada! Te notificaremos cuando esté disponible.`, { parse_mode: 'Markdown' });
        res.status(200).json({ message: 'Solicitud registrada.' });
    } catch (error) {
        console.error("Error al registrar solicitud:", error);
        bot.sendMessage(userId, 'Ocurrió un error al registrar tu solicitud. Intenta más tarde.', { parse_mode: 'Markdown' });
        res.status(500).json({ error: 'Error interno al registrar solicitud.' });
    }
});

app.post('/api/extract-link', async (req, res) => {
    const { targetUrl } = req.body;
    if (!targetUrl) return res.status(400).json({ success: false, error: "targetUrl es requerido." });
    try {
        const extracted_link = await llamarAlExtractor(targetUrl);
        res.status(200).json({ success: true, requested_url: targetUrl, extracted_link: extracted_link });
    } catch (error) {
        console.error(`[Extractor] Falla en ruta /api/extract-link: ${error.message}`);
        res.status(500).json({ success: false, error: "Fallo extractor.", details: error.message });
    }
});

app.get('/', (req, res) => {
    res.send('¡El bot y el servidor de Sala Cine están activos!');
});

// --- CORRECCIÓN CLAVE 2: Usar el WEBHOOK_PATH para recibir actualizaciones ---
if (process.env.NODE_ENV === 'production' && token) {
    app.post(WEBHOOK_PATH, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });
} else if (!token && process.env.NODE_ENV === 'production') {
    console.warn("⚠️ Webhook de Telegram no configurado porque TELEGRAM_BOT_TOKEN no está definido.");
}

app.get('/app/details/:tmdbId', (req, res) => {
    const tmdbId = req.params.tmdbId;
    const APP_SCHEME_URL = `salacine://details?id=${tmdbId}`;
    const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=com.salacine.app`;
    const htmlResponse = `
 <!DOCTYPE html>
 <html>
 <head>
 <meta http-equiv="refresh" content="0; url=${APP_SCHEME_URL}">
 <title>Abriendo Sala Cine</title>
 </head>
 <body>
 <p>Si la aplicación no se abre, haz clic <a href="${APP_SCHEME_URL}">aquí</a> o descárgala en <a href="${PLAY_STORE_URL}">Play Store</a>.</p>
 </body>
 </html>
 `;
    res.send(htmlResponse);
});

// --- CRON JOBS ---
cron.schedule('0 0 * * *', async () => {
    console.log('✨ Ejecutando tarea de limpieza de caché diaria (Embed/TMDB/LocalDetails)...');
    embedCache.flushAll();
    tmdbCache.flushAll();
    localDetailsCache.flushAll();
    console.log('✅ Cachés limpiadas.');
});

cron.schedule('*/30 * * * *', async () => {
    try {
        console.log('✨ Ejecutando tarea de actualización de contenido reciente y destacado.');
        recentCache.del(RECENT_CACHE_KEY);
        pinnedCache.del(PINNED_CACHE_KEY);
        kdramaCache.del(KDRAMA_CACHE_KEY);
        catalogCache.del(CATALOG_CACHE_KEY);
        console.log('✅ Cachés de Contenido (Recent, Pinned, Kdrama, Catalog) invalidadas para refresco.');
    } catch (e) {
        console.error('❌ Error en cron job de limpieza de caché:', e.message);
    }
});

async function sendDataNotification(topic, title, body, dataPayload) {
    const message = {
        notification: { title: title, body: body },
        data: dataPayload,
        topic: topic,
        android: { priority: 'high' }
    };
    try {
        console.log(`🚀 Intentando enviar notificación al topic '${topic}'... Payload:`, JSON.stringify(dataPayload));
        const response = await messaging.send(message);
        console.log('✅ Notificación FCM enviada exitosamente al topic:', response);
        return { success: true, message: `Notificación enviada al topic '${topic}'.`, response: response };
    } catch (error) {
        console.error(`❌ Error al enviar notificación FCM al topic '${topic}':`, error);
        return { success: false, error: error.message };
    }
}

async function startServer() {
    await connectToMongo();

    // --- CORRECCIÓN CLAVE 3: Llamada obligatoria para registrar el webhook en Telegram ---
    try {
        if (token) {
            await bot.setWebHook(WEBHOOK_URL);
            console.log(`✅ Webhook de Telegram establecido en: ${WEBHOOK_URL}`);
        } else {
            console.warn("⚠️ TELEGRAM_BOT_TOKEN no está definido. No se puede configurar el webhook.");
        }
    } catch (e) {
        console.error("❌ Error al establecer el Webhook:", e.message);
    }

    initializeBot(
        bot,
        db,
        mongoDb,
        adminState,
        ADMIN_CHAT_ID,
        TMDB_API_KEY,
        RENDER_BACKEND_URL,
        axios,
        pinnedCache
    );

    app.listen(PORT, () => {
        console.log(`🚀 Servidor de backend Sala Cine iniciado en puerto ${PORT}`);
        client.on('close', () => {
            console.warn('Conexión a MongoDB cerrada. Intentando reconectar...');
            setTimeout(connectToMongo, 5000);
        });
    });
}

startServer();

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
