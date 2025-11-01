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
// ¡NUEVO! Caché para contadores y datos de usuario (5 minutos TTL - 300 segundos)
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

let GLOBAL_STREAMING_ACTIVE = false;

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

// === ESTADO DEL BOT ===
const adminState = {};

// === MIDDLEWARE ===
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE'); // Añadidos PUT, DELETE
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { return res.sendStatus(200); }
    next();
});

// =======================================================================
// === NUEVOS MIDDLEWARE DE AUTENTICACIÓN Y CACHÉ ===
// =======================================================================

/**
 * Middleware para verificar el ID Token de Firebase y adjuntar el UID.
 */
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
        // Esto captura tokens expirados o inválidos.
        console.error("Error al verificar Firebase ID Token:", error.code, error.message);
        return res.status(403).json({ error: 'Token de autenticación inválido o expirado.', code: error.code });
    }
}

/**
 * Middleware para usar el caché en rutas GET de usuario.
 */
function countsCacheMiddleware(req, res, next) {
    const uid = req.uid; // Asumimos que verifyIdToken ya pasó
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

    // Adjuntamos la clave de caché para que la ruta la use al guardar la respuesta
    req.cacheKey = cacheKey;
    console.log(`[Cache MISS] Buscando datos de usuario en Firestore para: ${cacheKey}`);
    next();
}

// =======================================================================
// === RUTAS CENTRALIZADAS DE USUARIO (FIRESTORE) ===
// =======================================================================

/**
 * [1] GET /api/user/me: Obtener datos de perfil, estado Pro, y monedas.
 * [2] PUT /api/user/profile: Actualizar username y flair.
 */
app.get('/api/user/me', verifyIdToken, countsCacheMiddleware, async (req, res) => {
    const { uid, email, cacheKey, query } = req;
    const usernameFromQuery = req.query.username; // Usado solo en el primer registro
    
    try {
        const userDocRef = db.collection('users').doc(uid);
        const docSnap = await userDocRef.get();
        const now = new Date();
        let userData;
        
        if (docSnap.exists) {
            userData = docSnap.data();
            
            // Lógica para recalcular isPro si la fecha de expiración pasó
            let isPro = userData.isPro || false;
            let renewalDate = userData.premiumExpiry ? userData.premiumExpiry.toDate().toISOString() : null;
            
            if (renewalDate && new Date(renewalDate) < now) {
                isPro = false;
                // Si expiró, forzar la actualización en DB (opcional, se puede dejar que el backend lo maneje)
                await userDocRef.update({ isPro: false });
            }
            
            // Devolver datos completos
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
            // [CASO DE REGISTRO] Si el documento no existe, crearlo.
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
            
            // Devolver los datos recién creados
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
        
        // ¡IMPORTANTE! Invalidar caché del perfil completo
        countsCache.del(`${uid}:/api/user/me`);
        
        res.status(200).json({ message: 'Perfil actualizado con éxito.' });
    } catch (error) {
        console.error("Error en /api/user/profile:", error);
        res.status(500).json({ error: 'Error al actualizar el perfil.' });
    }
});

/**
 * [3] GET /api/user/coins: Obtener balance de monedas.
 * [4] POST /api/user/coins: Sumar/restar monedas.
 */
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
    const { amount } = req.body; // Puede ser positivo (ganar) o negativo (gastar)

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
            
            // Si el documento no existe, crear uno con el balance inicial
            if (!doc.exists) {
                 transaction.set(userDocRef, { coins: finalBalance }, { merge: true });
            } else {
                 transaction.update(userDocRef, { coins: finalBalance });
            }
            
            return finalBalance;
        });

        // ¡IMPORTANTE! Invalidar caché de monedas
        countsCache.del(`${uid}:/api/user/coins`);
        countsCache.del(`${uid}:/api/user/me`); // También invalida el perfil completo

        res.status(200).json({ message: 'Balance actualizado.', newBalance });
    } catch (error) {
        if (error.message === "Saldo insuficiente") {
            return res.status(400).json({ error: 'Saldo insuficiente para realizar el gasto.' });
        }
        console.error("Error en /api/user/coins (POST):", error);
        res.status(500).json({ error: 'Error en la transacción de monedas.' });
    }
});

/**
 * [5] GET /api/user/history: Obtener historial (Continuar Viendo).
 * [6] POST /api/user/history: Añadir/actualizar historial.
 */
app.get('/api/user/history', verifyIdToken, async (req, res) => {
    const { uid } = req;
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
            timestamp: doc.data().timestamp.toDate().toISOString() // Convertir a ISO string
        }));

        res.status(200).json(historyItems);
    } catch (error) {
        console.error("Error en /api/user/history (GET):", error);
        res.status(500).json({ error: 'Error al obtener el historial.' });
    }
});

app.post('/api/user/history', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { tmdbId, title, poster_path, backdrop_path, type } = req.body;

    if (!tmdbId || !type) {
        return res.status(400).json({ error: 'tmdbId y type requeridos.' });
    }

    try {
        const historyRef = db.collection('history');
        const q = historyRef.where('userId', '==', uid).where('tmdbId', '==', tmdbId);
        const existingDocs = await q.limit(1).get();
        const now = admin.firestore.FieldValue.serverTimestamp();

        if (existingDocs.empty) {
            await historyRef.add({
                userId: uid,
                tmdbId: tmdbId,
                title: title,
                poster_path: poster_path,
                backdrop_path: backdrop_path,
                type: type,
                timestamp: now
            });
        } else {
            const docId = existingDocs.docs[0].id;
            await historyRef.doc(docId).update({
                timestamp: now,
                // Asegurar que los datos básicos se actualicen
                title: title,
                poster_path: poster_path,
                backdrop_path: backdrop_path,
                type: type 
            });
        }

        res.status(200).json({ message: 'Historial actualizado.' });
    } catch (error) {
        console.error("Error en /api/user/history (POST):", error);
        res.status(500).json({ error: 'Error al actualizar el historial.' });
    }
});

/**
 * [7] POST /api/user/progress: Guardar progreso de serie.
 * [8] GET /api/user/progress: Obtener progreso de serie.
 */
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


/**
 * [9] POST /api/user/favorites: Añadir a favoritos (o notificar si ya existe).
 * [10] GET /api/user/favorites: Obtener lista de favoritos.
 * [11] GET /api/user/likes/check: Verificar si el usuario ya dio like a un item.
 */
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
            .orderBy('title', 'asc') // Ordenar alfabéticamente
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


/**
 * [12] POST /api/user/likes: Registrar un nuevo like.
 * Esta ruta es un complemento de /api/increment-likes (MongoDB) y registra el like en Firestore.
 */
app.post('/api/user/likes', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { tmdbId } = req.body;

    if (!tmdbId) {
        return res.status(400).json({ error: 'tmdbId requerido.' });
    }

    try {
        const likesRef = db.collection('movieLikes');
        // Verificación doble para evitar añadir duplicados, aunque el frontend ya lo hace.
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


// =======================================================================
// === RUTAS DE RECOMPENSAS (REDEEM) ===
// =======================================================================

/**
 * [13] POST /api/rewards/redeem/premium: Activar Premium (llamado desde payments.js y rewards.js)
 * La lógica de la fecha ya estaba correcta, solo quitamos el 'userId' del body,
 * ya que se obtiene del token.
 */
app.post('/api/rewards/redeem/premium', verifyIdToken, async (req, res) => {
    
    // --- DEBUG INICIO ---
    console.log("=============================================");
    console.log("INICIO DEPURACIÓN: /api/rewards/redeem/premium");
    
    const { uid } = req; // Obtenemos el UID del token
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
    // --- DEBUG FIN ---

    try {
        // --- DEBUG INICIO ---
        console.log(`Referencia de documento: db.collection('users').doc('${uid}')`);
        const userDocRef = db.collection('users').doc(uid); 
        
        console.log("Intentando leer documento (get)...");
        // Usamos una transacción para asegurarnos de que la lectura sea atómica, aunque es solo para fecha
        const newExpiryDate = await db.runTransaction(async (transaction) => {
            const docSnap = await transaction.get(userDocRef);
            let currentExpiry; 
            const now = new Date();
            
            if (docSnap.exists && docSnap.data().premiumExpiry) {
                 const expiryData = docSnap.data().premiumExpiry;
                 if (expiryData.toDate && typeof expiryData.toDate === 'function') { currentExpiry = expiryData.toDate(); }
                 else if (typeof expiryData === 'number') { currentExpiry = new Date(expiryData); }
                 else if (typeof expiryData === 'string') { currentExpiry = new Date(expiryData); }
                 else { currentExpiry = now; } // Fallback si el formato es desconocido
                
                if (currentExpiry > now) {
                    return new Date(currentExpiry.getTime() + days * 24 * 60 * 60 * 1000);
                } else {
                    return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
                }
            } else { 
                // Documento no existe o no tiene fecha de expiración
                return new Date(now.getTime() + days * 24 * 60 * 60 * 1000); 
            }
        });
        
        console.log(`Nueva fecha de expiración calculada: ${newExpiryDate.toISOString()}`);
        // --- DEBUG FIN ---

        // Actualización final fuera de la transacción (porque solo se actualiza una vez)
        await userDocRef.set({ isPro: true, premiumExpiry: newExpiryDate }, { merge: true });
        
        // ¡IMPORTANTE! Invalidar caché del perfil completo (para que el frontend lo sepa)
        countsCache.del(`${uid}:/api/user/me`);

        // --- DEBUG INICIO ---
        console.log("✅ ESCRITURA EXITOSA en Firestore.");
        console.log("FIN DEPURACIÓN");
        console.log("=============================================");
        // --- DEBUG FIN ---
        
        // Devolvemos la fecha de expiración para que el frontend la use en activatePremiumUI
        res.status(200).json({ success: true, message: `Premium activado por ${days} días.`, expiryDate: newExpiryDate.toISOString() });

    } catch (error) { 
        // --- DEBUG INICIO ---
        console.error(`❌ ERROR FATAL en /api/rewards/redeem/premium:`, error);
        // --- DEBUG FIN ---
        
        console.error(`❌ Error al activar Premium:`, error); 
        res.status(500).json({ success: false, error: 'Error interno del servidor al actualizar el estado Premium.' }); 
    }
});


/**
 * [14] POST /api/rewards/request-diamond: Activar Premium (llamado desde payments.js y rewards.js)
 * La lógica de esta ruta ya estaba en el archivo original, pero la he modificado para:
 * 1. Utilizar el UID y Email del token (no del body) para mayor seguridad.
 * 2. Usar la nueva función sendNotificationToTopic (que ya implementamos).
 */
app.post('/api/rewards/request-diamond', verifyIdToken, async (req, res) => {
    // 1. Extraer los datos del cuerpo de la solicitud (enviados desde rewards.js)
    const { uid, email } = req; // Obtenemos el UID y Email del token
    const { gameId, diamonds, costInCoins } = req.body;

    if (!gameId || !diamonds || !costInCoins) {
        return res.status(400).json({ error: 'Faltan datos (gameId, diamonds, costInCoins).' });
    }

    // 2. Formatear el mensaje para el bot
    const userEmail = email || 'No especificado (UID: ' + uid + ')';
    const message = `💎 *¡Solicitud de Diamantes!* 💎\n\n` +
                    `*Usuario:* ${userEmail}\n` +
                    `*ID de Jugador:* \`${gameId}\`\n` + 
                    `*Producto:* ${diamonds} Diamantes\n` +
                    `*Costo:* ${costInCoins} 🪙`;

    try {
        // 3. Enviar la notificación al admin con un botón de "Completado"
        await bot.sendPhoto(ADMIN_CHAT_ID, "https://i.ibb.co/L6TqT2V/ff-100.png", {
            caption: message, 
            parse_mode: 'Markdown',
            reply_markup: { 
                inline_keyboard: [
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
// === FIN: RUTAS CENTRALIZADAS DE USUARIO Y RECOMPENSAS ===
// =======================================================================


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
    console.warn("⚠️  Webhook de Telegram no configurado porque TELEGRAM_BOT_TOKEN no está definido.");
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
// === RUTA /api/redeem-premium-time (ELIMINADA DE AQUÍ, MOVÓ AL BLOQUE DE REWARDS) ===
// =======================================================================
/* app.post('/api/redeem-premium-time', async (req, res) => {
    // ... CÓDIGO ANTIGUO ELIMINADO/MOVÓ
});
*/

// --- Rutas PayPal (sin cambios) ---
app.post('/create-paypal-payment', (req, res) => {
    // ... (sin cambios)
    const plan = req.body.plan; const amount = (plan === 'annual') ? '19.99' : '1.99'; const userId = req.body.userId; if (!userId) return res.status(400).json({ error: "userId es requerido." });
    const create_payment_json = { 
        "intent": "sale",
        "payer": { "payment_method": "paypal" },
        "redirect_urls": {
            "return_url": `${RENDER_BACKEND_URL}/paypal/success?userId=${userId}&plan=${plan}`,
            "cancel_url": `${RENDER_BACKEND_URL}/paypal/cancel?userId=${userId}&plan=${plan}`
        },
        "transactions": [{
            "item_list": { "items": [{ "name": `Plan Premium ${plan}`, "sku": `PLAN-${plan.toUpperCase()}`, "price": amount, "currency": "USD", "quantity": "1" }] },
            "amount": { "currency": "USD", "total": amount },
            "description": `Suscripción Premium ${plan} Sala Cine`
        }]
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
    const payerId = req.query.PayerID;
    const paymentId = req.query.paymentId;
    const userId = req.query.userId;
    const plan = req.query.plan;
    const amount = (plan === 'annual') ? '19.99' : '1.99';

    if (!payerId || !paymentId || !userId || !plan) {
        return res.status(400).send('Faltan parámetros requeridos.');
    }

    const execute_payment_json = {
        "payer_id": payerId,
        "transactions": [{
            "amount": { "currency": "USD", "total": amount }
        }]
    };

    try {
        const payment = await new Promise((resolve, reject) => {
            paypal.payment.execute(paymentId, execute_payment_json, (error, payment) => {
                if (error) return reject(error);
                resolve(payment);
            });
        });

        // 1. Calcular días a añadir (30 o 365)
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

        // 2. Actualizar Firestore
        await userDocRef.set({ 
            isPro: true, 
            premiumExpiry: newExpiryDate,
            lastPayment: paymentId,
            paymentMethod: 'PayPal'
        }, { merge: true });

        // 3. Invalidar caché del perfil (para que la app lo sepa inmediatamente)
        countsCache.del(`${userId}:/api/user/me`);

        // 4. Notificar al admin (opcional)
        bot.sendMessage(ADMIN_CHAT_ID, `💰 *PAGO RECIBIDO (PayPal):* $${amount} USD\n*Usuario:* \`${userId}\`\n*Plan:* ${plan.toUpperCase()}`, { parse_mode: 'Markdown' });

        res.send('<html><body><h1>✅ Pago Exitoso</h1><p>Tu cuenta Premium ha sido activada/extendida. Puedes cerrar esta ventana.</p></body></html>');
    } catch (error) {
        console.error("Error al ejecutar o guardar el pago de PayPal:", error);
        res.status(500).send('<html><body><h1>❌ Error</h1><p>Hubo un error al procesar tu pago. Contacta a soporte con el ID de Pago si lo tienes.</p></body></html>');
    }
});

app.get('/paypal/cancel', (req, res) => {
    // ... (sin cambios)
    res.send('<html><body><h1>❌ Pago Cancelado</h1><p>Has cancelado el pago. Vuelve a la aplicación para intentarlo de nuevo.</p></body></html>');
});

// --- Ruta Binance (sin cambios) ---
app.post('/create-binance-payment', (req, res) => {
    // ... (sin cambios)
    res.json({ message: 'Pago con Binance simulado.' });
});

// =======================================================================
// === LÓGICA DE NOTIFICACIONES PUSH (MODIFICADA) ===
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
    }
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
        TMDB_API_KEY,
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
