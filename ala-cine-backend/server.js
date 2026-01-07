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
// Cachés existentes
const embedCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
const countsCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const tmdbCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
const recentCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
const historyCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const localDetailsCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 }); 

// --- NUEVAS CACHÉS OPTIMIZADAS (FASE 1 - CONTENIDO) ---
const pinnedCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const PINNED_CACHE_KEY = 'pinned_content_top';

const kdramaCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const KDRAMA_CACHE_KEY = 'kdrama_content_list';

// Cache de Catálogo (Se usa flushAll para limpiar variantes por género)
const catalogCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const CATALOG_CACHE_KEY = 'full_catalog_list'; // Key por defecto para "todo"

const RECENT_CACHE_KEY = 'recent_content_main'; 

// --- NUEVAS CACHÉS OPTIMIZADAS (FASE 2 - USUARIOS Y MONEDAS) ---
// 1. Caché de Usuarios (RAM) - TTL AUMENTADO A 6 HORAS (21600s) PARA 20K USUARIOS
const userCache = new NodeCache({ stdTTL: 21600, checkperiod: 1200 });

// 2. Buffer de Escritura de Monedas (RAM)
// Almacena { uid: cantidad_acumulada }
let coinWriteBuffer = {};

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

// =========================================================================
// === SISTEMA DE BUFFER DE MONEDAS (OPTIMIZACIÓN DE ESCRITURA) ===
// =========================================================================

async function flushCoinBuffer() {
    const uids = Object.keys(coinWriteBuffer);
    if (uids.length === 0) return;

    console.log(`[Coin Buffer] Iniciando escritura en lote para ${uids.length} usuarios...`);
    
    // Firestore Batch permite max 500 operaciones. Si hay más, habría que dividir.
    const batch = db.batch();
    const uidsToFlush = uids.slice(0, 490); // Margen de seguridad

    uidsToFlush.forEach(uid => {
        const amount = coinWriteBuffer[uid];
        if (amount !== 0) {
            const userRef = db.collection('users').doc(uid);
            // Usamos increment para evitar conflictos de carrera
            batch.update(userRef, { 
                coins: admin.firestore.FieldValue.increment(amount) 
            });
        }
    });

    try {
        await batch.commit();
        console.log(`[Coin Buffer] ✅ Escritura en lote exitosa. Buffer limpiado.`);
        
        // Limpiar del buffer SOLO los que procesamos
        uidsToFlush.forEach(uid => {
            delete coinWriteBuffer[uid];
        });
    } catch (error) {
        console.error("❌ [Coin Buffer] Error crítico al escribir en Firestore:", error);
    }
}

// Ejecutar flush cada 5 minutos (300,000 ms)
setInterval(flushCoinBuffer, 300000);

// =========================================================================

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
    // NOTA: Mantenemos este middleware para compatibilidad, 
    // pero la lógica principal de caché de usuario ahora está en /api/user/me
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

// =========================================================================
// === NUEVOS ENDPOINTS CRÍTICOS (FASE 1) - DESTACADOS, K-DRAMAS, CATALOGO ===
// =========================================================================

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

// =========================================================================
// === REFECTORIZACIÓN: CATÁLOGO HÍBRIDO (LOCAL + TMDB RELLENO) ===
// =========================================================================
app.get('/api/content/catalog', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    const genre = req.query.genre;
    // Generamos Key única por género. Si no hay género, usa la key general.
    const cacheKey = genre ? `catalog_genre_${genre}` : CATALOG_CACHE_KEY;

    const cachedCatalog = catalogCache.get(cacheKey);
    if (cachedCatalog) {
        return res.status(200).json({ items: cachedCatalog, total: cachedCatalog.length });
    }

    try {
        const projection = { tmdbId: 1, title: 1, name: 1, poster_path: 1, media_type: 1, addedAt: 1, origin_country: 1, genres: 1 };
        let combined = [];

        if (!genre) {
            // --- CASO 1: Catálogo General (Sin Filtro) ---
            const movies = await mongoDb.collection('media_catalog').find({}).project(projection).sort({ addedAt: -1 }).limit(500).toArray();
            const series = await mongoDb.collection('series_catalog').find({}).project(projection).sort({ addedAt: -1 }).limit(500).toArray();

            const formattedMovies = movies.map(m => formatLocalItem(m, 'movie'));
            const formattedSeries = series.map(s => formatLocalItem(s, 'tv'));

            combined = [...formattedMovies, ...formattedSeries].sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
        } else {
            // --- CASO 2: Filtrado por Género con Relleno TMDB ---
            const genreId = parseInt(genre);
            const query = { genres: genreId };

            const movies = await mongoDb.collection('media_catalog').find(query).project(projection).sort({ addedAt: -1 }).limit(100).toArray();
            const series = await mongoDb.collection('series_catalog').find(query).project(projection).sort({ addedAt: -1 }).limit(100).toArray();

            const formattedMovies = movies.map(m => formatLocalItem(m, 'movie'));
            const formattedSeries = series.map(s => formatLocalItem(s, 'tv'));

            combined = [...formattedMovies, ...formattedSeries].sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));

            // Lógica de Relleno si hay menos de 18 items
            if (combined.length < 18) {
                const needed = 18 - combined.length;
                console.log(`[Catalog] Género ${genreId}: Faltan ${needed} items. Rellenando con TMDB...`);
                
                try {
                    // Pedimos películas populares de ese género a TMDB
                    const tmdbUrl = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&with_genres=${genreId}&language=es-MX&sort_by=popularity.desc&include_adult=false&page=1`;
                    const resp = await axios.get(tmdbUrl);
                    const tmdbResults = resp.data.results || [];
                    
                    let addedCount = 0;
                    const existingIds = new Set(combined.map(i => String(i.tmdbId)));

                    for (const item of tmdbResults) {
                        if (addedCount >= needed) break;
                        const sId = String(item.id);
                        
                        // Solo agregamos si no lo tenemos ya en local
                        if (!existingIds.has(sId)) {
                            combined.push({
                                id: item.id,
                                tmdbId: sId,
                                title: item.title,
                                name: item.title,
                                poster_path: item.poster_path,
                                backdrop_path: item.backdrop_path,
                                media_type: 'movie',
                                isPinned: false,
                                isLocal: false, // Marcado como NO local para que la UI sepa gestionarlo
                                addedAt: new Date(0) // Fecha antigua para que aparezcan al final
                            });
                            existingIds.add(sId);
                            addedCount++;
                        }
                    }
                } catch (tmdbError) {
                    console.error(`[Catalog] Error rellenando con TMDB: ${tmdbError.message}`);
                    // Si falla TMDB, devolvemos lo que tengamos localmente
                }
            }
        }

        // Guardamos en caché (Key específica del género o general)
        catalogCache.set(cacheKey, combined);
        
        res.status(200).json({ 
            items: combined, 
            total: combined.length 
        });

    } catch (error) {
        console.error("Error en /api/content/catalog:", error);
        res.status(500).json({ error: "Error interno al obtener catálogo." });
    }
});


// =========================================================================
// === RUTA CRÍTICA: /api/content/local (LÓGICA HÍBRIDA REAL) ===
// =========================================================================
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

// =========================================================================
// === OPTIMIZACIÓN: RUTA DE USUARIO (/api/user/me) ===
// =========================================================================
app.get('/api/user/me', verifyIdToken, async (req, res) => {
    const { uid, email } = req;
    const usernameFromQuery = req.query.username;
    
    // 1. Intentar leer de userCache (RAM)
    const cachedUser = userCache.get(uid);
    if (cachedUser) {
        // console.log(`[User Cache HIT] Usuario ${uid} recuperado de RAM.`);
        // Si hay algo en el buffer de monedas, lo aseguramos aquí (aunque ya debería estar sincronizado)
        if (coinWriteBuffer[uid]) {
            // Nota: En teoría ya está actualizado en cache al momento del POST, 
            // pero esto es doble seguridad visual.
            cachedUser.coins = Math.max(cachedUser.coins, cachedUser.coins); 
        }
        return res.status(200).json(cachedUser);
    }

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

            // Calcular monedas reales (DB + Buffer no guardado)
            const dbCoins = userData.coins || 0;
            const bufferedCoins = coinWriteBuffer[uid] || 0;
            const totalCoins = dbCoins + bufferedCoins;

            const responseData = {
                uid,
                email,
                username: userData.username || email.split('@')[0],
                flair: userData.flair || "👋",
                coins: totalCoins, // Entregamos saldo real
                isPro: isPro,
                renewalDate: renewalDate
            };
            
            // Guardar en RAM
            userCache.set(uid, responseData);
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
            
            userCache.set(uid, responseData);
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
        
        // Invalidamos caché para forzar recarga con nuevos datos
        userCache.del(uid);
        
        res.status(200).json({ message: 'Perfil actualizado con éxito.' });
    } catch (error) {
        console.error("Error en /api/user/profile:", error);
        res.status(500).json({ error: 'Error al actualizar el perfil.' });
    }
});

app.get('/api/user/coins', verifyIdToken, countsCacheMiddleware, async (req, res) => {
    const { uid, cacheKey } = req;
    
    // Si tenemos al usuario en RAM Cache, sacamos las monedas de ahí directamente
    const cachedUser = userCache.get(uid);
    if (cachedUser) {
        return res.status(200).json({ coins: cachedUser.coins });
    }

    try {
        const userDocRef = db.collection('users').doc(uid);
        const docSnap = await userDocRef.get();
        // Sumar buffer si existe
        const dbCoins = docSnap.exists ? (docSnap.data().coins || 0) : 0;
        const buffered = coinWriteBuffer[uid] || 0;
        
        const responseData = { coins: dbCoins + buffered };
        
        countsCache.set(cacheKey, responseData);
        res.status(200).json(responseData);
    } catch (error) {
        console.error("Error en /api/user/coins (GET):", error);
        res.status(500).json({ error: 'Error al obtener el balance.' });
    }
});

// =========================================================================
// === OPTIMIZACIÓN: ESCRITURA DE MONEDAS (/api/user/coins) ===
// =========================================================================
app.post('/api/user/coins', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { amount } = req.body;
    if (typeof amount !== 'number' || amount === 0) {
        return res.status(400).json({ error: 'Cantidad inválida.' });
    }

    // CASO 1: GANANCIA (Buffer - No escribe en Firebase inmediatamente)
    if (amount > 0) {
        // 1. Agregar al buffer global
        coinWriteBuffer[uid] = (coinWriteBuffer[uid] || 0) + amount;

        // 2. Actualizar UserCache (RAM) para que la UI responda rápido
        // Si el usuario no está en caché, no pasa nada, se cargará actualizado en el siguiente /me
        const cachedUser = userCache.get(uid);
        let newDisplayBalance = 0;
        
        if (cachedUser) {
            cachedUser.coins += amount;
            userCache.set(uid, cachedUser); // Guardamos actualización
            newDisplayBalance = cachedUser.coins;
        } else {
            // Si no está en caché, no sabemos el total real sin leer DB.
            // Devolvemos 'pending' o 0, el cliente suele refrescar /me
            newDisplayBalance = amount; 
        }

        // Invalidar cachés cortas
        countsCache.del(`${uid}:/api/user/coins`);
        // No invalidamos countsCache de /me porque ya actualizamos userCache arriba

        return res.status(200).json({ 
            message: 'Balance actualizado (Buffer).', 
            newBalance: newDisplayBalance 
        });
    }

    // CASO 2: GASTO (Negativo - Requiere validación estricta en DB)
    const userDocRef = db.collection('users').doc(uid);
    try {
        const newBalance = await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(userDocRef);
            let currentCoins = doc.exists ? (doc.data().coins || 0) : 0;
            
            // IMPORTANTE: Si el usuario tiene monedas en el buffer pendientes de guardar,
            // deberíamos considerarlas para el gasto.
            const buffered = coinWriteBuffer[uid] || 0;
            const totalReal = currentCoins + buffered;

            const finalBalance = totalReal + amount; // amount es negativo

            if (finalBalance < 0) {
                throw new Error("Saldo insuficiente");
            }

            // Si gastamos, guardamos en BD el resultado final y limpiamos el buffer de este usuario
            // para evitar doble contabilidad.
            if (!doc.exists) {
                 transaction.set(userDocRef, { coins: finalBalance }, { merge: true });
            } else {
                 transaction.update(userDocRef, { coins: finalBalance });
            }
            
            // Limpiar buffer porque ya consolidamos todo en la transacción
            delete coinWriteBuffer[uid];

            return finalBalance;
        });

        // Actualizar caché RAM con el nuevo saldo real
        const cachedUser = userCache.get(uid);
        if (cachedUser) {
            cachedUser.coins = newBalance;
            userCache.set(uid, cachedUser);
        }

        countsCache.del(`${uid}:/api/user/coins`);
        countsCache.del(`${uid}:/api/user/me`);
        
        res.status(200).json({ message: 'Balance actualizado.', newBalance });
    } catch (error) {
        if (error.message === "Saldo insuficiente") {
            return res.status(400).json({ error: 'Saldo insuficiente para realizar el gasto.' });
        }
        console.error("Error en /api/user/coins (POST Transaction):", error);
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
        
        // Invalidar caché de usuario para que vea su premium activo
        userCache.del(uid);
        
        res.status(200).json({ success: true, message: `Premium activado por ${days} días.`, expiryDate: newExpiryDate.toISOString() });
    } catch (error) { 
        console.error(`❌ Error al activar Premium:`, error); 
        res.status(500).json({ success: false, error: 'Error interno del servidor al actualizar el estado Premium.' }); 
    }
});

// =========================================================================
// === NUEVA LÓGICA DE PAGOS MANUALES Y NOTIFICACIÓN AL BOT ===
// =========================================================================

app.post('/api/payments/request-manual', async (req, res) => {
    const { userId, username, planName, price } = req.body;
    
    // Validaciones básicas
    if (!userId || !planName) {
        return res.status(400).json({ error: 'Faltan datos (userId, planName).' });
    }

    // Determinar duración según el nombre del plan
    let days = 30; // Default
    if (planName.includes('3 Meses')) {
        days = 90;
    } else if (planName.includes('Anual') || planName.includes('12 Meses')) {
        days = 365;
    }

    const message = `⚠️ *SOLICITUD DE ACTIVACIÓN PREMIUM* ⚠️\n\n` +
                    `👤 *Usuario:* ${username || 'Sin nombre'}\n` +
                    `🆔 *ID:* \`${userId}\`\n` + 
                    `📅 *Plan:* ${planName}\n` +
                    `💰 *Precio:* ${price}`;

    try {
        await bot.sendMessage(ADMIN_CHAT_ID, message, {
            parse_mode: 'Markdown',
            reply_markup: { 
                inline_keyboard: [
                    // Enviamos userId y days en el callback_data
                    [{ text: '✅ Activar Ahora', callback_data: `act_man_${userId}_${days}` }],
                    [{ text: '❌ Ignorar', callback_data: 'ignore_payment_request' }]
                ] 
            }
        });
        res.status(200).json({ success: true, message: 'Solicitud enviada al administrador.' });
    } catch (error) {
        console.error("Error enviando solicitud de pago al bot:", error);
        res.status(500).json({ error: 'Error al notificar al administrador.' });
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

app.post('/request-movie', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    const { title, poster_path, tmdbId, priority } = req.body;
    
    if (!tmdbId || !title) {
        return res.status(400).json({ error: 'tmdbId y title requeridos.' });
    }

    try {
        const requestCollection = mongoDb.collection('movie_requests');
        const cleanId = String(tmdbId).trim();
        
        await requestCollection.updateOne(
            { tmdbId: cleanId },
            {
                $set: { 
                    title: title, 
                    poster_path: poster_path, 
                    latestPriority: priority || 'regular',
                    updatedAt: new Date()
                },
                $inc: { votes: 1 }
            },
            { upsert: true }
        );

        if (priority && priority !== 'regular') {
            const posterUrl = poster_path ? `https://image.tmdb.org/t/p/w500${poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
            
            let priorityText = '';
            switch (priority) {
                case 'fast': priorityText = '⚡ Rápido (~24h)'; break;
                case 'immediate': priorityText = '🚀 Inmediato (~1h)'; break;
                case 'premium': priorityText = '👑 PREMIUM (Prioridad)'; break;
                default: priorityText = '⏳ Regular (1-2 semanas)'; 
            }

            const message = `🔔 *Solicitud PRIORITARIA:* ${title}\n` +
                            `*Nivel:* ${priorityText}\n\n` +
                            `Se ha registrado/actualizado en la base de datos de pedidos.`;
            
            await bot.sendPhoto(ADMIN_CHAT_ID, posterUrl, {
                caption: message, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '✅ Gestionar (Subir ahora)', callback_data: `solicitud_${tmdbId}` }]] }
            });
        }

        res.status(200).json({ message: 'Solicitud guardada correctamente.' });

    } catch (error) {
        console.error("Error al procesar la solicitud /request-movie:", error);
        res.status(500).json({ error: 'Error al procesar solicitud.' });
    }
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
        const movieCollection = mongoDb.collection('media_catalog');
        const seriesCollection = mongoDb.collection('series_catalog');
        let docMovie = null; let docSeries = null; let views = 0; let likes = 0; let isAvailable = false;
        const seriesProjection = { projection: { views: 1, likes: 1, seasons: 1 } };
        docSeries = await seriesCollection.findOne({ tmdbId: id.toString() }, seriesProjection);
        if (docSeries) {
            views = docSeries.views || 0; likes = docSeries.likes || 0;
            if (docSeries.seasons) {
                isAvailable = Object.values(docSeries.seasons).some(season => season && season && season.episodes && Object.values(season.episodes).some(ep => (ep.freeEmbedCode && ep.freeEmbedCode !== '') || (ep.proEmbedCode && ep.proEmbedCode !== '')));
            }
            if (isAvailable) {
                const responseData = { views: views, likes: likes, isAvailable: true };
                countsCache.set(cacheKey, responseData);
                return res.status(200).json(responseData);
            }
        }
        const movieProjection = { projection: { views: 1, likes: 1, freeEmbedCode: 1, proEmbedCode: 1 } };
        docMovie = await movieCollection.findOne({ tmdbId: id.toString() }, movieProjection);
        if (docMovie) {
            if (views === 0) views = docMovie.views || 0; if (likes === 0) likes = docMovie.likes || 0;
            isAvailable = !!(docMovie.freeEmbedCode || docMovie.proEmbedCode);
            const responseData = { views: views, likes: likes, isAvailable: isAvailable };
            countsCache.set(cacheKey, responseData);
            return res.status(200).json(responseData);
        }
        const responseData_NotFound = { views: views, likes: likes, isAvailable: false };
        countsCache.set(cacheKey, responseData_NotFound);
        res.status(200).json(responseData_NotFound);
    } catch (error) {
        console.error(`Error crítico al obtener los datos consolidados en MongoDB:`, error);
        res.status(500).json({ error: "Error interno del servidor al obtener los datos." });
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
            const epData = doc.seasons?.[season]?.episodes?.[episode];
            if (epData) {
                enlaceFinal = (isPro === 'true') ? epData.proEmbedCode : epData.freeEmbedCode;
            }
        }

        if (enlaceFinal) {
            embedCache.set(cacheKey, enlaceFinal);
            return res.json({ embedCode: enlaceFinal });
        }

        console.log(`[Embed Code] No se encontró código para ${id} (isPro: ${isPro})`);
        return res.status(404).json({ error: `No se encontró código de reproductor.` });

    } catch (error) {
        console.error("Error crítico get-embed-code:", error);
        res.status(500).json({ error: "Error interno" });
    }
});

app.get('/api/check-season-availability', async (req, res) => {
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

app.get('/api/get-metrics', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    const { id, field } = req.query;
    if (!id || !field || (field !== 'views' && field !== 'likes')) { return res.status(400).json({ error: "ID y campo ('views' o 'likes') requeridos." }); }
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
    } catch (error) { console.error(`Error get-metrics (${field}):`, error); res.status(500).json({ error: "Error interno." }); }
});

app.post('/api/increment-views', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    const { tmdbId } = req.body; if (!tmdbId) return res.status(400).json({ error: "tmdbId requerido." });
    try {
        const update = { $inc: { views: 1 }, $setOnInsert: { likes: 0 } }; const options = { upsert: true };
        let result = await mongoDb.collection('media_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options);
        if (result.matchedCount === 0 && result.upsertedCount === 0) {
           result = await mongoDb.collection('series_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options);
        }
        countsCache.del(`counts-data-${tmdbId}`);
        countsCache.del(`counts-metrics-${tmdbId}-views`);
        res.status(200).json({ message: 'Vista registrada.' });
    } catch (error) { console.error("Error increment-views:", error); res.status(500).json({ error: "Error interno." }); }
});

app.post('/api/increment-likes', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    const { tmdbId } = req.body; if (!tmdbId) return res.status(400).json({ error: "tmdbId requerido." });
    try {
        const update = { $inc: { likes: 1 }, $setOnInsert: { views: 0 } }; const options = { upsert: true };
        let result = await mongoDb.collection('media_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options);
         if (result.matchedCount === 0 && result.upsertedCount === 0) {
            result = await mongoDb.collection('series_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options);
         }
        countsCache.del(`counts-data-${tmdbId}`);
        countsCache.del(`counts-metrics-${tmdbId}-likes`);
        res.status(200).json({ message: 'Like registrado.' });
    } catch (error) { console.error("Error increment-likes:", error); res.status(500).json({ error: "Error interno." }); }
});

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
        
        embedCache.del(`embed-${cleanTmdbId}-movie-1-pro`);
        embedCache.del(`embed-${cleanTmdbId}-movie-1-free`);
        countsCache.del(`counts-data-${cleanTmdbId}`);
        recentCache.del(RECENT_CACHE_KEY);
        pinnedCache.del(PINNED_CACHE_KEY);
        kdramaCache.del(KDRAMA_CACHE_KEY);
        
        // --- LIMPIEZA TOTAL DE CATÁLOGO PARA ACTUALIZAR TODOS LOS GÉNEROS ---
        catalogCache.flushAll();

        console.log(`[Cache] Cachés (Recent, Pinned, Kdrama, Catalog FLUSH) invalidadas por subida de película: ${title}`);

        res.status(200).json({ message: 'Película agregada y publicada.' });
        
    } catch (error) { console.error("Error add-movie:", error); res.status(500).json({ error: 'Error interno.' }); }
});

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
        
        // --- LIMPIEZA TOTAL DE CATÁLOGO ---
        catalogCache.flushAll();
        
        console.log(`[Cache] Cachés (Recent, Pinned, Kdrama, Catalog FLUSH) invalidadas por subida de episodio: S${seasonNumber}E${episodeNumber}`);

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
        
        // Limpiamos catálogo por si acaso
        catalogCache.flushAll();

        console.log(`[Delete] Episodio S${seasonNumber}E${episodeNumber} eliminado de ${cleanTmdbId}`);

        res.status(200).json({ message: 'Episodio eliminado.' });
    } catch (error) {
        console.error("Error delete-series-episode:", error);
        res.status(500).json({ error: 'Error interno.' });
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

app.get('/api/app-update', (req, res) => {
    const updateInfo = { "latest_version_code": 12, "update_url": "https://play.google.com/store/apps/details?id=com.salacine.app&pcampaignid=web_share", "force_update": false, "update_message": "¡Nueva versión (1.5.2) de Sala Cine disponible! Incluye mejoras de rendimiento. Actualiza ahora." };
    res.status(200).json(updateInfo);
});

app.get('/api/app-status', (req, res) => {
    const status = { isAppApproved: true, safeContentIds: [11104, 539, 4555, 27205, 33045] };
    res.json(status);
});

app.get('/.well-known/assetlinks.json', (req, res) => {
    res.sendFile('assetlinks.json', { root: __dirname });
});

async function sendNotificationToTopic(title, body, imageUrl, tmdbId, mediaType, specificTopic) {
    // Si se pasa specificTopic se usa, sino por defecto 'new_content'
    const topic = specificTopic || 'new_content';
    const dataPayload = {
        title: title, 
        body: body, 
        tmdbId: tmdbId ? tmdbId.toString() : '0', 
        mediaType: mediaType || 'general',
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
        axios,
        pinnedCache,
        sendNotificationToTopic // <--- NUEVA INYECCIÓN PARA USAR EN FASE 2
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
