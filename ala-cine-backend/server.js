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

// --- CACHÉS ---
const embedCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
const countsCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const tmdbCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
const recentCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
const historyCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const localDetailsCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 }); 

// --- NUEVAS CACHÉS OPTIMIZADAS ---
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
const bot = new TelegramBot(token);
const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT_ID, 10);
const TMDB_API_KEY = process.env.TMDB_API_KEY;

let GLOBAL_STREAMING_ACTIVE = true;
const BUILD_ID_UNDER_REVIEW = 13; 

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

// =========================================================================
// === NUEVOS ENDPOINTS CRÍTICOS (DESTACADOS, K-DRAMAS, CATALOGO) ===
// =========================================================================

// 1. Endpoint Destacados (Pinned)
app.get('/api/content/featured', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    const cachedPinned = pinnedCache.get(PINNED_CACHE_KEY);
    if (cachedPinned) {
        return res.status(200).json(cachedPinned);
    }

    try {
        const projection = { tmdbId: 1, title: 1, name: 1, poster_path: 1, backdrop_path: 1, addedAt: 1, isPinned: 1 };
        
        // Buscar en Películas
        const movies = await mongoDb.collection('media_catalog')
            .find({ isPinned: true })
            .project(projection)
            .sort({ addedAt: -1 })
            .limit(10)
            .toArray();

        // Buscar en Series
        const series = await mongoDb.collection('series_catalog')
            .find({ isPinned: true })
            .project(projection)
            .sort({ addedAt: -1 })
            .limit(10)
            .toArray();

        const formattedMovies = movies.map(m => formatLocalItem(m, 'movie'));
        const formattedSeries = series.map(s => formatLocalItem(s, 'tv'));
        
        // Combinar y ordenar
        const combined = [...formattedMovies, ...formattedSeries].sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
        
        pinnedCache.set(PINNED_CACHE_KEY, combined);
        res.status(200).json(combined);

    } catch (error) {
        console.error("Error en /api/content/featured:", error);
        res.status(500).json({ error: "Error interno al obtener destacados." });
    }
});

// 2. Endpoint K-Dramas
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

// 3. Endpoint Catálogo Completo
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
        res.status(200).json({ items: combined, total: combined.length });

    } catch (error) {
        console.error("Error en /api/content/catalog:", error);
        res.status(500).json({ error: "Error interno al obtener catálogo." });
    }
});

// 4. Endpoint Contenido Local
app.get('/api/content/local', verifyIdToken, async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    const { type, genre, category } = req.query; 
    
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

// =========================================================================

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
            let isPro = userData.isPro || false;
            let renewalDate = userData.premiumExpiry ? userData.premiumExpiry.toDate().toISOString() : null;
            if (renewalDate && new Date(renewalDate) < now) {
                isPro = false;
                await userDocRef.update({ isPro: false });
            }
            const responseData = {
                uid,
                email,
                username: userData.username || email.split('@')[0],
                flair: userData.flair || "👋",
                coins: userData.coins || 0,
                isPro: isPro,
                renewalDate: renewalDate
            };
            countsCache.set(cacheKey, responseData);
            return res.status(200).json(responseData);
        } else {
            const initialData = {
                uid,
                email,
                username: usernameFromQuery || email.split('@')[0],
                flair: "👋 ¡Nuevo en Sala Cine!",
                isPro: false,
                createdAt: now,
                coins: 0,
            };
            await userDocRef.set(initialData);
            const responseData = { ...initialData, renewalDate: null };
            countsCache.set(cacheKey, responseData);
            return res.status(200).json(responseData);
        }
    } catch (error) {
        console.error("Error en /api/user/me:", error);
        res.status(500).json({ error: 'Error al cargar los datos del usuario.' });
    }
});

app.put('/api/user/profile', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { username, flair } = req.body;
    if (!username || username.length < 3) {
        return res.status(400).json({ error: 'Nombre de usuario inválido.' });
    }
    try {
        const userDocRef = db.collection('users').doc(uid);
        await userDocRef.update({
            username: username,
            flair: flair || ""
        });
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
    if (typeof amount !== 'number' || amount === 0) {
        return res.status(400).json({ error: 'Cantidad inválida.' });
    }
    const userDocRef = db.collection('users').doc(uid);
    try {
        const newBalance = await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(userDocRef);
            const currentCoins = doc.exists ? (doc.data().coins || 0) : 0;
            const finalBalance = currentCoins + amount;
            if (finalBalance < 0) {
                throw new Error("Saldo insuficiente");
            }
            if (!doc.exists) {
                 transaction.set(userDocRef, { coins: finalBalance }, { merge: true });
            } else {
                 transaction.update(userDocRef, { coins: finalBalance });
            }
            return finalBalance;
        });
        countsCache.del(`${uid}:/api/user/coins`);
        countsCache.del(`${uid}:/api/user/me`);
        res.status(200).json({ message: 'Balance actualizado.', newBalance });
    } catch (error) {
        if (error.message === "Saldo insuficiente") {
            return res.status(400).json({ error: 'Saldo insuficiente para realizar el gasto.' });
        }
        console.error("Error en /api/user/coins (POST):", error);
        res.status(500).json({ error: 'Error en la transacción de monedas.' });
    }
});

app.get('/api/user/history', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const cacheKey = `history-${uid}`;
    const cachedHistory = historyCache.get(cacheKey);
    if (cachedHistory) {
        return res.status(200).json(cachedHistory);
    }

    try {
        const historyRef = db.collection('history');
        const snapshot = await historyRef
            .where('userId', '==', uid)
            .orderBy('timestamp', 'desc')
            .limit(10)
            .get();

        const historyItems = snapshot.docs.map(doc => ({
            tmdbId: doc.data().tmdbId,
            title: doc.data().title,
            poster_path: doc.data().poster_path,
            backdrop_path: doc.data().backdrop_path,
            type: doc.data().type,
            timestamp: doc.data().timestamp.toDate().toISOString()
        }));
        historyCache.set(cacheKey, historyItems);

        res.status(200).json(historyItems);
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
        } catch (err) { console.warn(`[History Fix] Warn: ${err.message}`); }
    }

    try {
        const historyRef = db.collection('history');
        const q = historyRef.where('userId', '==', uid).where('tmdbId', 'in', possibleIds);
        const existingDocs = await q.get(); 
        const now = admin.firestore.FieldValue.serverTimestamp();

        const safeData = {
            userId: uid,
            tmdbId: idAsString,
            title: title || "Título desconocido",
            poster_path: poster_path || null,
            backdrop_path: backdrop_path || null,
            type: type,
            timestamp: now
        };

        if (existingDocs.empty) {
            await historyRef.add(safeData);
        } else {
            if (existingDocs.size > 1) {
                const docs = existingDocs.docs;
                await historyRef.doc(docs[0].id).update(safeData);
                for (let i = 1; i < docs.length; i++) {
                    await historyRef.doc(docs[i].id).delete();
                }
            } else {
                const docId = existingDocs.docs[0].id;
                await historyRef.doc(docId).update(safeData); 
            }
        }
        historyCache.del(`history-${uid}`);
        res.status(200).json({ message: 'Historial actualizado y reparado.' });

    } catch (error) {
        console.error("Error en /api/user/history (POST):", error);
        res.status(500).json({ error: 'Error al actualizar el historial.' });
    }
});

app.post('/api/user/progress', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { seriesId, season, episode } = req.body;
    if (!seriesId || !season || !episode) {
        return res.status(400).json({ error: 'seriesId, season y episode requeridos.' });
    }
    try {
        const progressRef = db.collection('watchProgress').doc(`${uid}_${seriesId}`);
        await progressRef.set({
            userId: uid,
            seriesId: seriesId,
            lastWatched: { season, episode },
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        res.status(200).json({ message: 'Progreso guardado.' });
    } catch (error) {
        console.error("Error en /api/user/progress (POST):", error);
        res.status(500).json({ error: 'Error al guardar el progreso.' });
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
        await favoritesRef.add({
            userId: uid,
            tmdbId: tmdbId,
            title: title,
            poster_path: poster_path,
            type: type
        });
        res.status(201).json({ message: 'Añadido a Mi lista.' });
    } catch (error) {
        console.error("Error en /api/user/favorites (POST):", error);
        res.status(500).json({ error: 'Error al añadir a favoritos.' });
    }
});

app.get('/api/user/favorites', verifyIdToken, async (req, res) => {
    const { uid } = req;
    try {
        const favoritesRef = db.collection('favorites');
        const snapshot = await favoritesRef
            .where('userId', '==', uid)
            .orderBy('title', 'asc')
            .get();
        const favorites = snapshot.docs.map(doc => ({
            tmdbId: doc.data().tmdbId,
            title: doc.data().title,
            poster_path: doc.data().poster_path,
            type: doc.data().type
        }));
        res.status(200).json(favorites);
    } catch (error) {
        console.error("Error en /api/user/favorites (GET):", error);
        res.status(500).json({ error: 'Error al cargar la lista de favoritos.' });
    }
});

app.get('/api/user/likes/check', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { tmdbId } = req.query;
    if (!tmdbId) {
        return res.status(400).json({ error: 'tmdbId requerido.' });
    }
    try {
        const likesRef = db.collection('movieLikes');
        const q = likesRef
            .where('userId', '==', uid)
            .where('tmdbId', '==', tmdbId.toString())
            .limit(1);
        const snapshot = await q.get();
        const hasLiked = !snapshot.empty;
        res.status(200).json({ hasLiked });
    } catch (error) {
        console.error("Error en /api/user/likes/check:", error);
        res.status(500).json({ error: 'Error al verificar el like.' });
    }
});

app.post('/api/user/likes', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { tmdbId } = req.body;
    if (!tmdbId) {
        return res.status(400).json({ error: 'tmdbId requerido.' });
    }
    try {
        const likesRef = db.collection('movieLikes');
        const q = likesRef.where('userId', '==', uid).where('tmdbId', '==', tmdbId.toString()).limit(1);
        const existingDocs = await q.get();
        if (existingDocs.empty) {
            await likesRef.add({
                userId: uid,
                tmdbId: tmdbId.toString(),
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
            return res.status(201).json({ message: 'Like registrado.' });
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
                 if (expiryData.toDate && typeof expiryData.toDate === 'function') { currentExpiry = expiryData.toDate(); }
                 else if (typeof expiryData === 'number') { currentExpiry = new Date(expiryData); }
                 else if (typeof expiryData === 'string') { currentExpiry = new Date(expiryData); }
                 else { currentExpiry = now; }
                if (currentExpiry > now) {
                    return new Date(currentExpiry.getTime() + days * 24 * 60 * 60 * 1000);
                } else {
                    return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
                }
            } else { 
                return new Date(now.getTime() + days * 24 * 60 * 60 * 1000); 
            }
        });
        await userDocRef.set({ isPro: true, premiumExpiry: newExpiryDate }, { merge: true });
        countsCache.del(`${uid}:/api/user/me`);
        res.status(200).json({ success: true, message: `Premium activado por ${days} días.`, expiryDate: newExpiryDate.toISOString() });
    } catch (error) { 
        console.error(`❌ Error al activar Premium:`, error); 
        res.status(500).json({ success: false, error: 'Error interno del servidor al actualizar el estado Premium.' }); 
    }
});

app.post('/api/rewards/request-diamond', verifyIdToken, async (req, res) => {
    const { uid, email } = req;
    const { gameId, diamonds, costInCoins } = req.body;
    if (!gameId || !diamonds || !costInCoins) {
        return res.status(400).json({ error: 'Faltan datos (gameId, diamonds, costInCoins).' });
    }
    const userEmail = email || 'No especificado (UID: ' + uid + ')';
    const message = `💎 *¡Solicitud de Diamantes!* 💎\n\n` +
                    `*Usuario:* ${userEmail}\n` +
                    `*ID de Jugador:* \`${gameId}\`\n` + 
                    `*Producto:* ${diamonds} Diamantes\n` +
                    `*Costo:* ${costInCoins} 🪙`;
    try {
        await bot.sendPhoto(ADMIN_CHAT_ID, "https://i.ibb.co/L6TqT2V/ff-100.png", {
            caption: message, 
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
app.get('/', (req, res) => {
  res.send('¡El bot y el servidor de Sala Cine están activos!');
});

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
        <!DOCTYPE html>
        <html>
            <head>
                <meta http-equiv="refresh" content="0; url=${APP_SCHEME_URL}">
                <title>Abriendo Sala Cine...</title>
                <script>
                    window.onload = function() {
                        setTimeout(function() {
                            window.location.replace('${PLAY_STORE_URL}');
                        }, 500); 
                    };
                </script>
            </head>
            <body>
                Redirigiendo a Sala Cine...
            </body>
        </html>
    `;
    res.send(htmlResponse);
});

// =========================================================================
// === RUTA DE SUBIDA DE PELÍCULAS (RESTAURADA) ===
// =========================================================================
app.post('/add-movie', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    try {
        const { tmdbId, title, poster_path, freeEmbedCode, proEmbedCode, isPremium, overview, hideFromRecent, genres, release_date, popularity, vote_average, isPinned, origin_country } = req.body;
        
        if (!tmdbId) return res.status(400).json({ error: 'tmdbId requerido.' });
        
        const cleanTmdbId = String(tmdbId).trim();

        const updateQuery = { 
            $set: { 
                title, 
                poster_path, 
                overview, 
                freeEmbedCode, 
                proEmbedCode, 
                isPremium,
                hideFromRecent: hideFromRecent === true || hideFromRecent === 'true',
                genres: genres || [],
                release_date: release_date || null,
                popularity: popularity || 0,
                vote_average: vote_average || 0,
                isPinned: isPinned === true || isPinned === 'true',
                origin_country: origin_country || []
            }, 
            $setOnInsert: { tmdbId: cleanTmdbId, views: 0, likes: 0, addedAt: new Date() } 
        };
        
        await mongoDb.collection('media_catalog').updateOne({ tmdbId: cleanTmdbId }, updateQuery, { upsert: true });

        try {
            await mongoDb.collection('movie_requests').deleteOne({ tmdbId: cleanTmdbId });
            console.log(`[Auto-Clean] Pedido eliminado tras subida: ${title} (${cleanTmdbId})`);
        } catch (cleanupError) {
            console.warn(`[Auto-Clean Warning] No se pudo limpiar el pedido: ${cleanupError.message}`);
        }
        
        // INVALIDACIÓN DE CACHÉS
        embedCache.del(`embed-${cleanTmdbId}-movie-1-pro`);
        embedCache.del(`embed-${cleanTmdbId}-movie-1-free`);
        countsCache.del(`counts-data-${cleanTmdbId}`);
        recentCache.del(RECENT_CACHE_KEY);
        pinnedCache.del(PINNED_CACHE_KEY);
        kdramaCache.del(KDRAMA_CACHE_KEY);
        catalogCache.del(CATALOG_CACHE_KEY);

        console.log(`[Cache] Cachés (Recent, Pinned, Kdrama, Catalog) invalidadas por subida de película: ${title}`);

        res.status(200).json({ message: 'Película agregada y publicada.' });
        
    } catch (error) { console.error("Error add-movie:", error); res.status(500).json({ error: 'Error interno.' }); }
});

// =========================================================================
// === RUTA DE SUBIDA DE SERIES (RESTAURADA) ===
// =========================================================================
app.post('/add-series-episode', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    try {
        const { tmdbId, title, poster_path, overview, seasonNumber, episodeNumber, freeEmbedCode, proEmbedCode, isPremium, genres, first_air_date, popularity, vote_average, isPinned, origin_country } = req.body;
        
        if (!tmdbId || !seasonNumber || !episodeNumber) return res.status(400).json({ error: 'tmdbId, seasonNumber y episodeNumber requeridos.' });
        
        const cleanTmdbId = String(tmdbId).trim();

        const episodePath = `seasons.${seasonNumber}.episodes.${episodeNumber}`;
        const updateData = {
            $set: {
                title, poster_path, overview, isPremium,
                genres: genres || [],
                first_air_date: first_air_date || null,
                popularity: popularity || 0,
                vote_average: vote_average || 0,
                isPinned: isPinned === true || isPinned === 'true',
                origin_country: origin_country || [],

                [`seasons.${seasonNumber}.name`]: `Temporada ${seasonNumber}`,
                [episodePath + '.freeEmbedCode']: freeEmbedCode,
                [episodePath + '.proEmbedCode']: proEmbedCode,
                 [episodePath + '.addedAt']: new Date()
            },
            $setOnInsert: { tmdbId: cleanTmdbId, views: 0, likes: 0, addedAt: new Date() }
        };
        await mongoDb.collection('series_catalog').updateOne({ tmdbId: cleanTmdbId }, updateData, { upsert: true });
        
        try {
            await mongoDb.collection('movie_requests').deleteOne({ tmdbId: cleanTmdbId });
            console.log(`[Auto-Clean] Pedido eliminado tras subida episodio: ${title} (${cleanTmdbId})`);
        } catch (cleanupError) {
            console.warn(`[Auto-Clean Warning] No se pudo limpiar el pedido: ${cleanupError.message}`);
        }

        embedCache.del(`embed-${cleanTmdbId}-${seasonNumber}-${episodeNumber}-pro`);
        embedCache.del(`embed-${cleanTmdbId}-${seasonNumber}-${episodeNumber}-free`);
        countsCache.del(`counts-data-${cleanTmdbId}`);
        recentCache.del(RECENT_CACHE_KEY);
        pinnedCache.del(PINNED_CACHE_KEY);
        kdramaCache.del(KDRAMA_CACHE_KEY);
        catalogCache.del(CATALOG_CACHE_KEY);
        
        console.log(`[Cache] Cachés (Recent, Pinned, Kdrama, Catalog) invalidadas por subida de episodio: S${seasonNumber}E${episodeNumber}`);

        res.status(200).json({ message: `Episodio S${seasonNumber}E${episodeNumber} agregado y publicado.` });

    } catch (error) { console.error("Error add-series-episode:", error); res.status(500).json({ error: 'Error interno.' }); }
});

app.post('/delete-series-episode', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    try {
        const { tmdbId, seasonNumber, episodeNumber } = req.body;
        if (!tmdbId || !seasonNumber || !episodeNumber) {
            return res.status(400).json({ error: 'Faltan datos.' });
        }

        const cleanTmdbId = String(tmdbId).trim();
        const episodePath = `seasons.${seasonNumber}.episodes.${episodeNumber}`;

        const updateData = {
            $unset: { [episodePath]: "" }
        };

        await mongoDb.collection('series_catalog').updateOne({ tmdbId: cleanTmdbId }, updateData);

        embedCache.del(`embed-${cleanTmdbId}-${seasonNumber}-${episodeNumber}-pro`);
        embedCache.del(`embed-${cleanTmdbId}-${seasonNumber}-${episodeNumber}-free`);
        console.log(`[Delete] Episodio S${seasonNumber}E${episodeNumber} eliminado de ${cleanTmdbId}`);

        res.status(200).json({ message: 'Episodio eliminado.' });
    } catch (error) {
        console.error("Error delete-series-episode:", error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

// --- RUTA NUEVA: GESTIÓN DE DESTACADOS (PINNED) CON LIMPIEZA TOTAL Y BLINDAJE DE ID ---
app.post('/api/manage-pinned', async (req, res) => {
    const { tmdbId, action, type } = req.body; 
    
    if (!mongoDb || !tmdbId || !action) return res.status(400).json({ error: "Faltan datos" });

    // Definimos la colección correcta
    const collection = (type === 'tv' || type === 'series') ? mongoDb.collection('series_catalog') : mongoDb.collection('media_catalog');
    
    // --- BLINDAJE DE ID: Probamos String y Número por si acaso ---
    const idAsString = tmdbId.toString().trim();
    const idAsNumber = parseInt(tmdbId);

    let updateData = {};
    let message = "";

    try {
        if (action === 'pin') {
            updateData = { $set: { isPinned: true, addedAt: new Date() } };
            message = "Fijado en Destacados (Top 1).";
        } 
        else if (action === 'unpin') {
            updateData = { $set: { isPinned: false } };
            message = "Eliminado de Destacados.";
        } 
        else if (action === 'refresh') {
            updateData = { $set: { isPinned: true, addedAt: new Date() } };
            message = "Posición refrescada (Subido al Top 1).";
        }

        // 1. Intento principal con String ID (lo más común)
        let result = await collection.updateOne({ tmdbId: idAsString }, updateData);
        
        // 2. Fallback: Si no encontró nada, probamos con Number ID
        if (result.matchedCount === 0 && !isNaN(idAsNumber)) {
            console.warn(`[Manage Pinned] ID String (${idAsString}) no encontrado. Probando Number (${idAsNumber})...`);
            result = await collection.updateOne({ tmdbId: idAsNumber }, updateData);
        }

        if (result.matchedCount === 0) {
            console.warn(`[Manage Pinned] ERROR: No se encontró el item ${tmdbId} en la BD.`);
        }

        // --- LIMPIEZA AGRESIVA DE CACHÉ ---
        pinnedCache.del(PINNED_CACHE_KEY); 
        recentCache.del(RECENT_CACHE_KEY); 
        catalogCache.del(CATALOG_CACHE_KEY);
        countsCache.del(`counts-data-${idAsString}`); // Borramos la del string
        countsCache.del(`counts-data-${idAsNumber}`); // Borramos la del number por si acaso

        console.log(`[Pinned] Acción '${action}' realizada en ${tmdbId}. Cachés limpiadas.`);
        res.status(200).json({ success: true, message });

    } catch (error) {
        console.error("Error managing pinned:", error);
        res.status(500).json({ error: "Error interno" });
    }
});

// --- NUEVA RUTA: ELIMINAR CONTENIDO COMPLETAMENTE Y LIMPIAR CACHÉ ---
app.post('/api/delete-content', async (req, res) => {
    const { tmdbId, type } = req.body; 
    if (!mongoDb || !tmdbId || !type) return res.status(400).json({ error: "Faltan datos." });

    const idAsString = tmdbId.toString().trim();
    const idAsNumber = parseInt(tmdbId);
    
    const collectionName = (type === 'tv' || type === 'series') ? 'series_catalog' : 'media_catalog';

    try {
        // Intentar borrar por String ID
        let result = await mongoDb.collection(collectionName).deleteOne({ tmdbId: idAsString });
        
        // Si no borró nada, intentar por Number ID
        if (result.deletedCount === 0 && !isNaN(idAsNumber)) {
             result = await mongoDb.collection(collectionName).deleteOne({ tmdbId: idAsNumber });
        }

        if (result.deletedCount === 0) {
            console.warn(`[Delete] No se encontró el item ${tmdbId} para eliminar, pero se limpiará caché.`);
        }

        // === LIMPIEZA TOTAL DE CACHÉ ===
        pinnedCache.del(PINNED_CACHE_KEY);
        kdramaCache.del(KDRAMA_CACHE_KEY);
        catalogCache.del(CATALOG_CACHE_KEY);
        recentCache.del(RECENT_CACHE_KEY);
        countsCache.del(`counts-data-${idAsString}`);
        
        console.log(`[Delete] Item ${tmdbId} eliminado y cachés purgadas.`);
        res.status(200).json({ success: true, message: "Eliminado y cachés actualizadas." });

    } catch (error) {
        console.error("Error en delete-content:", error);
        res.status(500).json({ error: "Error interno al eliminar." });
    }
});

app.post('/api/notify-new-content', async (req, res) => {
    const { title, body, imageUrl, tmdbId, mediaType } = req.body;
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
    }
});

// === LÓGICA DE NOTIFICACIONES PUSH ===
async function sendNotificationToTopic(title, body, imageUrl, tmdbId, mediaType) {
    const topic = 'new_content';
    const dataPayload = {
        title: title, body: body, tmdbId: tmdbId.toString(), mediaType: mediaType,
        ...(imageUrl && { imageUrl: imageUrl })
    };
    const message = {
        topic: topic, data: dataPayload,
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

    initializeBot(
        bot,
        db, // Firestore
        mongoDb, // MongoDB
        adminState,
        ADMIN_CHAT_ID,
        TMDB_API_KEY,
        RENDER_BACKEND_URL,
        axios
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
