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
const RECENT_CACHE_KEY = 'recent_content_main'; 
const historyCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
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
const BUILD_ID_UNDER_REVIEW = 11; 

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
        return res.status(401).json({ error: 'Autorización requerida. Bearer token no proporcionado.' });
    }
    const idToken = authHeader.split(' ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.uid = decodedToken.uid;
        req.email = decodedToken.email;
        next();
    } catch (error) {
        console.error("Error al verificar Firebase ID Token:", error.code, error.message);
        return res.status(403).json({ error: 'Token de autenticación inválido o expirado.', code: error.code });
    }
}

function countsCacheMiddleware(req, res, next) {
    const uid = req.uid;
    const route = req.path;
    const cacheKey = `${uid}:${route}`;
    try {
        const cachedData = countsCache.get(cacheKey);
        if (cachedData) {
            console.log(`[Cache HIT] Sirviendo datos de usuario desde caché para: ${cacheKey}`);
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

    console.log(`[Recent Cache MISS] Generando lista unificada (Películas + Series)...`);

    try {
        const moviesPromise = mongoDb.collection('media_catalog')
            .find({})
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
    const { uid, email, cacheKey, query } = req;
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
            // No existe, creamos uno nuevo
            await historyRef.add(safeData);
        } else {
            if (existingDocs.size > 1) {
                console.log(`[History] Reparando duplicados para usuario ${uid} item ${idAsString}`);
                const docs = existingDocs.docs;
                // Actualizamos el primero
                await historyRef.doc(docs[0].id).update(safeData);
                // Borramos el resto
                for (let i = 1; i < docs.length; i++) {
                    await historyRef.doc(docs[i].id).delete();
                }
            } else {
                // Solo hay uno, actualizamos normal
                const docId = existingDocs.docs[0].id;
                await historyRef.doc(docId).update(safeData); // Actualizará tmdbId a string limpio si era número
            }
        }

        // Invalidación de caché
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
    console.log("=============================================");
    console.log("INICIO DEPURACIÓN: /api/rewards/redeem/premium");
    const { uid } = req;
    const { daysToAdd } = req.body; 
    console.log(`Datos recibidos: UserID=${uid}, DaysToAdd=${daysToAdd}`);
    if (!daysToAdd) { 
        console.log("Error: Faltan datos en la solicitud (daysToAdd).");
        console.log("FIN DEPURACIÓN");
        console.log("=============================================");
        return res.status(400).json({ success: false, error: 'daysToAdd es requerido.' }); 
    }
    const days = parseInt(daysToAdd, 10); 
    if (isNaN(days) || days <= 0) { 
        console.log(`Error: 'daysToAdd' no es un número válido (${daysToAdd}).`);
        console.log("FIN DEPURACIÓN");
        console.log("=============================================");
        return res.status(400).json({ success: false, error: 'daysToAdd debe ser un número positivo.' }); 
    }
    try {
        console.log(`Referencia de documento: db.collection('users').doc('${uid}')`);
        const userDocRef = db.collection('users').doc(uid); 
        console.log("Intentando leer documento (get)...");
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
        console.log(`Nueva fecha de expiración calculada: ${newExpiryDate.toISOString()}`);
        await userDocRef.set({ isPro: true, premiumExpiry: newExpiryDate }, { merge: true });
        countsCache.del(`${uid}:/api/user/me`);
        console.log("✅ ESCRITURA EXITOSA en Firestore.");
        console.log("FIN DEPURACIÓN");
        console.log("=============================================");
        res.status(200).json({ success: true, message: `Premium activado por ${days} días.`, expiryDate: newExpiryDate.toISOString() });
    } catch (error) { 
        console.error(`❌ ERROR FATAL en /api/rewards/redeem/premium:`, error);
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

// --- RUTA MODIFICADA: AUTOMATIZACIÓN DE PEDIDOS ---
app.post('/request-movie', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });
    
    const { title, poster_path, tmdbId, priority, userId } = req.body; 
    
    const cleanId = String(tmdbId).trim();
    const posterUrl = poster_path ? `https://image.tmdb.org/t/p/w500${poster_path}` : 'https://placehold.co/500x750?text=No+Poster';

    try {
        const requestsCollection = mongoDb.collection('movie_requests');
        const now = new Date();
        
        let priorityScore = 1;
        if (priority === 'fast') priorityScore = 2;
        if (priority === 'immediate' || priority === 'premium') priorityScore = 3;

        await requestsCollection.updateOne(
            { tmdbId: cleanId },
            {
                $set: { 
                    title: title,
                    poster_path: poster_path,
                    lastRequestedAt: now, 
                    latestPriority: priority 
                },
                $max: { priorityScore: priorityScore }, 
                $inc: { requestCount: 1 }, 
                $addToSet: { requestUserIds: userId || 'anon' } 
            },
            { upsert: true }
        );

        if (priority === 'immediate' || priority === 'premium') {
            const priorityText = priority === 'premium' ? '👑 PREMIUM' : '🚀 Inmediato';
            const message = `🔔 *Solicitud URGENTE:* ${title}\n` +
                            `*Prioridad:* ${priorityText}\n` +
                            `Esta película requiere atención rápida.`;
            
            await bot.sendPhoto(ADMIN_CHAT_ID, posterUrl, {
                caption: message, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '✅ Agregar ahora', callback_data: `solicitud_${cleanId}` }]] }
            });
        } 

        res.status(200).json({ message: 'Solicitud procesada y guardada.' });

    } catch (error) {
        console.error("Error al procesar la solicitud en BD:", error);
        res.status(500).json({ error: 'Error interno al guardar solicitud.' });
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
                isAvailable = Object.values(docSeries.seasons).some(season => season && season.episodes && Object.values(season.episodes).some(ep => (ep.freeEmbedCode && ep.freeEmbedCode !== '') || (ep.proEmbedCode && ep.proEmbedCode !== '')));
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
        const { tmdbId, title, poster_path, freeEmbedCode, proEmbedCode, isPremium, overview } = req.body;
        if (!tmdbId) return res.status(400).json({ error: 'tmdbId requerido.' });
        
        const cleanTmdbId = String(tmdbId).trim();

        const updateQuery = { $set: { title, poster_path, overview, freeEmbedCode, proEmbedCode, isPremium }, $setOnInsert: { tmdbId: cleanTmdbId, views: 0, likes: 0, addedAt: new Date() } };
        
        await mongoDb.collection('media_catalog').updateOne({ tmdbId: cleanTmdbId }, updateQuery, { upsert: true });
        
        embedCache.del(`embed-${cleanTmdbId}-movie-1-pro`);
        embedCache.del(`embed-${cleanTmdbId}-movie-1-free`);
        countsCache.del(`counts-data-${cleanTmdbId}`);
        
        recentCache.del(RECENT_CACHE_KEY);
        console.log(`[Cache] Lista de recientes invalidada por subida de película: ${title}`);

        res.status(200).json({ message: 'Película agregada y publicada.' });

    } catch (error) { console.error("Error add-movie:", error); res.status(500).json({ error: 'Error interno.' }); }
});

app.post('/add-series-episode', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    try {
        const { tmdbId, title, poster_path, overview, seasonNumber, episodeNumber, freeEmbedCode, proEmbedCode, isPremium } = req.body;
        if (!tmdbId || !seasonNumber || !episodeNumber) return res.status(400).json({ error: 'tmdbId, seasonNumber y episodeNumber requeridos.' });
        
        const cleanTmdbId = String(tmdbId).trim();

        const episodePath = `seasons.${seasonNumber}.episodes.${episodeNumber}`;
        const updateData = {
            $set: {
                title, poster_path, overview, isPremium,
                [`seasons.${seasonNumber}.name`]: `Temporada ${seasonNumber}`,
                [episodePath + '.freeEmbedCode']: freeEmbedCode,
                [episodePath + '.proEmbedCode']: proEmbedCode,
                 [episodePath + '.addedAt']: new Date()
            },
            $setOnInsert: { tmdbId: cleanTmdbId, views: 0, likes: 0, addedAt: new Date() }
        };
        await mongoDb.collection('series_catalog').updateOne({ tmdbId: cleanTmdbId }, updateData, { upsert: true });
        
        embedCache.del(`embed-${cleanTmdbId}-${seasonNumber}-${episodeNumber}-pro`);
        embedCache.del(`embed-${cleanTmdbId}-${seasonNumber}-${episodeNumber}-free`);
        countsCache.del(`counts-data-${cleanTmdbId}`);

        recentCache.del(RECENT_CACHE_KEY);
        console.log(`[Cache] Lista de recientes invalidada por subida de episodio: S${seasonNumber}E${episodeNumber}`);

        res.status(200).json({ message: `Episodio S${seasonNumber}E${episodeNumber} agregado y publicado.` });

    } catch (error) { console.error("Error add-series-episode:", error); res.status(500).json({ error: 'Error interno.' }); }
});

app.post('/create-paypal-payment', (req, res) => {
    const plan = req.body.plan; const amount = (plan === 'annual') ? '19.99' : '1.99'; const userId = req.body.userId; if (!userId) return res.status(400).json({ error: "userId es requerido." });
    const create_payment_json = { 
        "intent": "sale", "payer": { "payment_method": "paypal" },
        "redirect_urls": { "return_url": `${RENDER_BACKEND_URL}/paypal/success?userId=${userId}&plan=${plan}`, "cancel_url": `${RENDER_BACKEND_URL}/paypal/cancel?userId=${userId}&plan=${plan}` },
        "transactions": [{"item_list": { "items": [{ "name": `Plan Premium ${plan}`, "sku": `PLAN-${plan.toUpperCase()}`, "price": amount, "currency": "USD", "quantity": "1" }] }, "amount": { "currency": "USD", "total": amount }, "description": `Suscripción Premium ${plan} Sala Cine` }]
    };
    paypal.payment.create(create_payment_json, (error, payment) => {
        if (error) {
            console.error("Error al crear el pago de PayPal:", error);
            res.status(500).json({ error: 'Error al crear el pago de PayPal.', details: error.response });
        } else {
            for (let i = 0; i < payment.links.length; i++) {
                if (payment.links[i].rel === 'approval_url') {
                    res.json({ approval_url: payment.links[i].href });
                    return;
                }
            }
            res.status(500).json({ error: 'No se encontró URL de aprobación en la respuesta de PayPal.' });
        }
    });
});

app.get('/paypal/success', async (req, res) => {
    const payerId = req.query.PayerID; const paymentId = req.query.paymentId; const userId = req.query.userId; const plan = req.query.plan;
    const amount = (plan === 'annual') ? '19.99' : '1.99';
    if (!payerId || !paymentId || !userId || !plan) {
        return res.status(400).send('Faltan parámetros requeridos.');
    }
    const execute_payment_json = { "payer_id": payerId, "transactions": [{"amount": { "currency": "USD", "total": amount }}] };
    try {
        const payment = await new Promise((resolve, reject) => {
            paypal.payment.execute(paymentId, execute_payment_json, (error, payment) => {
                if (error) return reject(error);
                resolve(payment);
            });
        });
        const daysToAdd = (plan === 'annual') ? 365 : 30;
        const now = new Date();
        const userDocRef = db.collection('users').doc(userId);
        const docSnap = await userDocRef.get();
        let newExpiryDate;
        if (docSnap.exists && docSnap.data().premiumExpiry) {
            let currentExpiry = docSnap.data().premiumExpiry.toDate();
            if (currentExpiry > now) {
                newExpiryDate = new Date(currentExpiry.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
            } else {
                newExpiryDate = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
            }
        } else {
            newExpiryDate = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
        }
        await userDocRef.set({ 
            isPro: true, premiumExpiry: newExpiryDate, lastPayment: paymentId, paymentMethod: 'PayPal'
        }, { merge: true });
        countsCache.del(`${userId}:/api/user/me`);
        bot.sendMessage(ADMIN_CHAT_ID, `💰 *PAGO RECIBIDO (PayPal):* $${amount} USD\n*Usuario:* \`${userId}\`\n*Plan:* ${plan.toUpperCase()}`, { parse_mode: 'Markdown' });
        res.send('<html><body><h1>✅ Pago Exitoso</h1><p>Tu cuenta Premium ha sido activada/extendida. Puedes cerrar esta ventana.</p></body></html>');
    } catch (error) {
        console.error("Error al ejecutar o guardar el pago de PayPal:", error);
        res.status(500).send('<html><body><h1>❌ Error</h1><p>Hubo un error al procesar tu pago. Contacta a soporte con el ID de Pago si lo tienes.</p></body></html>');
    }
});

app.get('/paypal/cancel', (req, res) => {
    res.send('<html><body><h1>❌ Pago Cancelado</h1><p>Has cancelado el pago. Vuelve a la aplicación para intentarlo de nuevo.</p></body></html>');
});

app.post('/create-binance-payment', (req, res) => {
    res.json({ message: 'Pago con Binance simulado.' });
});

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

function generateShortId(length) {
    return crypto.randomBytes(Math.ceil(length / 2))
        .toString('hex') 
        .slice(0, length); 
}

app.post('/api/vivibox/add-link', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    const { m3u8Url } = req.body;
    if (!m3u8Url || !m3u8Url.startsWith('http') || !m3u8Url.endsWith('.m3u8')) {
        return res.status(400).json({ error: "Se requiere un 'm3u8Url' válido." });
    }

    try {
        const collection = mongoDb.collection('vivibox_links'); 
        const shortId = generateShortId(6); 

        await collection.insertOne({
            _id: shortId,
            m3u8Url: m3u8Url,
            createdAt: new Date()
        });

        console.log(`[Vivibox] Enlace guardado con ID: ${shortId}`);
        res.status(201).json({ message: 'Enlace guardado', id: shortId });

    } catch (error) {
        if (error.code === 11000) { 
             console.warn("[Vivibox] Colisión de ID corto, reintentando...");
             return res.status(500).json({ error: "Colisión de ID, por favor reintenta." });
        }
        console.error("Error en /api/vivibox/add-link:", error);
        res.status(500).json({ error: "Error interno al guardar el enlace." });
    }
});

app.get('/api/obtener-enlace', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    const { id } = req.query; 
    if (!id) {
        return res.status(400).json({ error: "Se requiere un 'id'." });
    }

    try {
        const collection = mongoDb.collection('vivibox_links');
        const doc = await collection.findOne({ _id: id });

        if (!doc) {
            console.warn(`[Vivibox] Enlace no encontrado para ID: ${id}`);
            return res.status(404).json({ error: "Enlace no encontrado o expirado." });
        }
        console.log(`[Vivibox] Sirviendo enlace M3U8 para ID: ${id}`);
        res.status(200).json({
            url_real: doc.m3u8Url 
        });

    } catch (error) {
        console.error("Error en /api/obtener-enlace:", error);
        res.status(500).json({ error: "Error interno al buscar el enlace." });
    }
});

app.get('/api/extract-link', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ success: false, error: "Se requiere parámetro 'url'." });
    
    console.log(`[Extractor] Solicitud manual recibida para: ${targetUrl}`);
    try {
        const extracted_link = await llamarAlExtractor(targetUrl);
        res.status(200).json({ success: true, requested_url: targetUrl, extracted_link: extracted_link });
    } catch (error) {
        console.error(`[Extractor] Falla en ruta /api/extract-link: ${error.message}`);
        res.status(500).json({ success: false, error: "Fallo extractor.", details: error.message });
    }
});

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
