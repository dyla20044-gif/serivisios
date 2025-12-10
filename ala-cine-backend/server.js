const express = require('express');
// [INICIO DE CAMBIOS - LÍNEA 2]
// AGREGADO: Necesarios para leer el archivo HTML y manejar rutas
const fs = require('fs');
const path = require('path');
// [FIN DE CAMBIOS]
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
const nodemailer = require('nodemailer'); // <-- Ya existía
const extractWithYtDlp = require('./m3u8Extractor'); // <-- Ya existía
const BINANCE_PAY = require('@binance/pay').default; // <-- Ya existía
const moment = require('moment'); // <-- Ya existía
const formatLocalItem = (item, type) => {
    return {
        tmdbId: item.tmdbId,
        title: item.title || item.name,
        poster_path: item.poster_path,
        backdrop_path: item.backdrop_path,
        media_type: type,
        addedAt: item.addedAt
    };
}; // Función para formatear items locales


// --- CACHÉS ---
// Cachés existentes
const embedCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
const countsCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const tmdbCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
const recentCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });
const historyCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const localDetailsCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 }); 

// --- NUEVAS CACHÉS OPTIMIZADAS (FASE 1) ---
// Caché para Destacados (Pinned) - TTL 1 hora
const pinnedCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const PINNED_CACHE_KEY = 'pinned_content_top';

// Caché para K-Dramas (Automático) - TTL 1 hora
const kdramaCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const KDRAMA_CACHE_KEY = 'kdrama_content_list';

// Caché para Catálogo Completo - TTL 1 hora (Para evitar lecturas masivas a Mongo)
const catalogCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const CATALOG_CACHE_KEY = 'full_catalog_list';

const RECENT_CACHE_KEY = 'recent_content_main'; 


// Load environment variables
dotenv.config();

// --- VARIABLES DE ENTORNO ---
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const RENDER_BACKEND_URL = process.env.RENDER_EXTERNAL_URL || 'https://serivisios.onrender.com'; // Corregido el nombre de la variable
const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT_ID);
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const BUILD_ID_UNDER_REVIEW = 15; 
let GLOBAL_STREAMING_ACTIVE = true;


// MongoDB
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'sala_cine';
let client;
let mongoDb;

// Firebase Admin
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

// PayPal
paypal.configure({
    'mode': process.env.PAYPAL_MODE || 'sandbox', //sandbox or live
    'client_id': process.env.PAYPAL_CLIENT_ID,
    'client_secret': process.env.PAYPAL_CLIENT_SECRET
});

// Binance Pay
let binancePay;
try {
    binancePay = new BINANCE_PAY({
        apiKey: process.env.BINANCE_API_KEY,
        secretKey: process.env.BINANCE_SECRET_KEY,
        baseUrl: process.env.BINANCE_BASE_URL // Ejemplo: 'https://bpay.binanceapi.com'
    });
    console.log("✅ Binance Pay inicializado.");
} catch (e) {
    console.error("❌ Error al inicializar Binance Pay. Verifique las variables de entorno.");
    binancePay = null; // Deshabilita la funcionalidad si la inicialización falla
}


// Nodemailer (Email)
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// --- TELEGRAM BOT ---
// Usamos polling para Render, o webhook si se configura
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const adminState = {}; // Para el estado de los administradores

// --- EXPRESS APP ---
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { return res.sendStatus(200); }
    next();
});

// Conexión a MongoDB
async function connectToMongo() {
    if (client && client.s.topology && client.s.topology.isConnected()) { // Mejor verificación de conexión
        console.log("MongoDB ya estaba conectado.");
        return;
    }

    try {
        client = new MongoClient(MONGO_URI, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            }
        });
        await client.connect();
        mongoDb = client.db(MONGO_DB_NAME);
        console.log("✅ Conexión a MongoDB exitosa.");

        // Inicializar el índice de texto para búsqueda avanzada si no existe
        const catalogCollection = mongoDb.collection('media_catalog');
        const indexes = await catalogCollection.indexes();
        const textIndexExists = indexes.some(index => index.key && index.key.title === 'text');

        if (!textIndexExists) {
            console.log("⚙️ Creando índice de texto para 'media_catalog'...");
            await catalogCollection.createIndex({ title: "text", genres: "text", overview: "text" }, { name: "textIndex" });
            console.log("✅ Índice de texto creado exitosamente.");
        }

    } catch (error) {
        console.error("❌ Error al conectar a MongoDB:", error);
        // Si falla, intentamos reconectar en el startServer
        mongoDb = null;
    }
}

// =========================================================================
// === MIDDLEWARES Y FUNCIONES UTILITARIAS ===
// =========================================================================

// Verifica token de Firebase (o permite anónimo)
async function verifyIdToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // Permitimos acceso sin token a ciertos endpoints de contenido
        return next(); 
    }
    const idToken = authHeader.split(' ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.uid = decodedToken.uid;
        req.email = decodedToken.email;
        next();
    } catch (error) {
        // console.error("Error al verificar Firebase ID Token:", error.code);
        // Si el token falla, seguimos como usuario anónimo (req.uid undefined)
        next();
    }
}

// Middleware de caché para datos de usuario
function countsCacheMiddleware(req, res, next) {
    if (!req.uid) return next(); // No cachear si no hay usuario
    const uid = req.uid;
    const route = req.path;
    const cacheKey = `${uid}:${route}`;
    try {
        const cachedData = countsCache.get(cacheKey);
        if (cachedData) {
            // console.log(`[Cache HIT] Sirviendo datos de usuario desde caché para: ${cacheKey}`);
            return res.status(200).json(cachedData);
        }
    } catch (err) {
        console.error("Error al leer del caché de usuario:", err);
    }
    req.cacheKey = cacheKey;
    next();
}

/**
 * Normaliza el título para URLs o IDs. (Función existente)
 * @param {string} title
 * @returns {string} Título normalizado.
 */
function normalizeTitle(title) {
    return title.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
        .trim()
        .replace(/\s+/g, '-'); // Replace spaces with hyphens
}

/**
 * Obtiene el enlace de video directo (m3u8/mp4) usando el extractor. (Función existente)
 * @param {string} url - URL de la página con el embed
 * @returns {Promise<string|null>} - El enlace directo o null
 */
async function getDirectVideoLink(url) {
    if (!url) return null;
    
    // 1. Intentar usar la caché de embed
    const cachedLink = embedCache.get(url);
    if (cachedLink) {
        console.log(`[Cache] Enlace directo de ${url} encontrado en caché.`);
        return cachedLink;
    }

    try {
        console.log(`[Extractor] Intentando extraer enlace directo de: ${url}`);
        const directLink = await extractWithYtDlp(url);
        
        if (directLink) {
            embedCache.set(url, directLink); // Cachear por 24 horas
            return directLink;
        }
        return null;
    } catch (error) {
        console.error(`[Extractor] Error al extraer el enlace para ${url}: ${error.message}`);
        return null;
    }
}

/**
 * Encuentra un enlace de descarga en Google Drive para un ID de película/serie. (Función existente)
 * @param {string} tmdbId - ID de TMDB.
 * @param {string} linkType - 'link_hd' o 'link_sd'
 * @returns {Promise<string|null>}
 */
async function getDriveLinkById(tmdbId, linkType) {
    if (!mongoDb) return null;
    try {
        const item = await mongoDb.collection('media_catalog').findOne(
            { tmdbId: tmdbId.toString() },
            { projection: { [linkType]: 1 } }
        );
        return item ? item[linkType] : null;
    } catch (error) {
        console.error(`Error al buscar enlace ${linkType} para ${tmdbId}:`, error);
        return null;
    }
}

/**
 * Encuentra un enlace de descarga para un episodio de serie. (Función existente)
 * @param {string} tmdbId - ID de TMDB.
 * @param {number} season - Número de temporada.
 * @param {number} episode - Número de episodio.
 * @param {string} linkType - 'link_hd' o 'link_sd'
 * @returns {Promise<string|null>}
 */
async function getEpisodeLink(tmdbId, season, episode, linkType) {
    if (!mongoDb) return null;
    try {
        const query = {
            tmdbId: tmdbId.toString(),
            'seasons.season_number': season
        };
        const projection = {
            'seasons.$': 1
        };
        const seriesData = await mongoDb.collection('series_catalog').findOne(query, { projection: projection });

        if (seriesData && seriesData.seasons && seriesData.seasons.length > 0) {
            const currentSeason = seriesData.seasons[0];
            const episodeData = currentSeason.episodes.find(ep => ep.episode_number === episode);
            return episodeData ? episodeData[linkType] : null;
        }
        return null;
    } catch (error) {
        console.error(`Error al buscar enlace de episodio S${season}E${episode} para ${tmdbId}:`, error);
        return null;
    }
}


/**
 * Enviar notificación push a un topic (ej. topic_estreno) (Función existente)
 * @param {string} topic - El topic al que enviar (ej. 'estrenos')
 * @param {object} dataPayload - Los datos de la notificación
 */
async function sendFCMNotification(topic, dataPayload) {
    const message = {
        topic: topic,
        data: dataPayload,
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


// =========================================================================
// === RUTAS DEL SERVIDOR WEB ===
// =========================================================================

// Ruta base
app.get('/', (req, res) => {
    res.send('¡El bot y el servidor de Sala Cine están activos!');
});

// Ruta para verificar el estado de streaming (existente)
app.get('/api/status', (req, res) => {
    const clientBuildId = parseInt(req.query.build_id) || 0;
    const clientVersion = parseInt(req.query.version) || 0;
    const receivedId = clientBuildId || clientVersion;
    console.log(`[Status Check] ID Recibido: ${receivedId} | ID en Revisión: ${BUILD_ID_UNDER_REVIEW}`);
    
    // Si el ID del cliente es el que está en revisión, oculta el streaming.
    if (receivedId === BUILD_ID_UNDER_REVIEW) {
        console.log("⚠️ [Review Mode] Detectada versión en revisión. Ocultando streaming.");
        return res.status(200).json({ isStreamingActive: false });
    }

    console.log(`[Status Check] Usuario normal. Devolviendo estado global: ${GLOBAL_STREAMING_ACTIVE}`);
    res.status(200).json({ isStreamingActive: GLOBAL_STREAMING_ACTIVE });
});


// -------------------------------------------------------------------------
// RUTAS DE GOOGLE DRIVE (embed, descarga)
// -------------------------------------------------------------------------

// Ruta para el link directo (m3u8) de un embed de Google Drive (existente)
app.get('/api/embed-link', async (req, res) => {
    const driveUrl = req.query.url;
    if (!driveUrl) {
        return res.status(400).json({ error: 'Falta el parámetro url.' });
    }

    try {
        const directLink = await getDirectVideoLink(driveUrl);
        if (directLink) {
            return res.json({ link: directLink });
        } else {
            return res.status(500).json({ error: 'No se pudo obtener el enlace directo (Extractor falló).' });
        }
    } catch (error) {
        console.error("Error en /api/embed-link:", error);
        return res.status(500).json({ error: 'Error interno del servidor al procesar el enlace.' });
    }
});

// Ruta de descarga de película/serie (HD/SD) (existente)
app.get('/api/download', async (req, res) => {
    const { id, type, quality } = req.query; // id=tmdbId, type=movie/series, quality=hd/sd
    if (!id || !type || !quality) {
        return res.status(400).json({ error: 'Faltan parámetros (id, type, quality).' });
    }

    const linkType = `link_${quality}`;
    let downloadUrl = null;

    try {
        if (type === 'movie') {
            downloadUrl = await getDriveLinkById(id, linkType);
        } else if (type === 'episode') {
            const { s, e } = req.query; // s=season, e=episode
            if (!s || !e) return res.status(400).json({ error: 'Faltan parámetros de temporada/episodio.' });
            downloadUrl = await getEpisodeLink(id, parseInt(s), parseInt(e), linkType);
        }

        if (downloadUrl) {
            res.json({ link: downloadUrl });
        } else {
            res.status(404).json({ error: 'Enlace de descarga no encontrado.' });
        }
    } catch (error) {
        console.error("Error en /api/download:", error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});


// Ruta para obtener el código embed manual (existente)
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

    console.log(`[Cache MISS] Buscando embed manual en DB para: ${cacheKey}`);
    try {
        let embedCodeField = isPro === 'true' ? 'proEmbedCode' : 'freeEmbedCode';
        let doc = null;

        if (season) { // Es una serie
            const seriesData = await mongoDb.collection('series_catalog').findOne(
                { tmdbId: id.toString(), 'seasons.season_number': parseInt(season) },
                { projection: { 'seasons.$': 1 } }
            );

            if (seriesData && seriesData.seasons && seriesData.seasons.length > 0) {
                const currentSeason = seriesData.seasons[0];
                const episodeData = currentSeason.episodes.find(ep => ep.episode_number === parseInt(episode));
                doc = episodeData;
            }
        } else { // Es una película
            doc = await mongoDb.collection('media_catalog').findOne(
                { tmdbId: id.toString() },
                { projection: { [embedCodeField]: 1 } }
            );
        }

        if (doc && doc[embedCodeField]) {
            embedCache.set(cacheKey, doc[embedCodeField]);
            return res.json({ embedCode: doc[embedCodeField] });
        } else {
            return res.status(404).json({ error: 'Código embed no encontrado o no disponible.' });
        }

    } catch (error) {
        console.error("Error al obtener código embed:", error);
        res.status(500).json({ error: 'Error interno del servidor al obtener el embed.' });
    }
});


// -------------------------------------------------------------------------
// RUTAS DE PAGOS (PayPal, Binance)
// -------------------------------------------------------------------------

// --- PAYPAL ---

app.post('/api/create-payment', async (req, res) => {
    const { amount, planId, userId } = req.body;
    if (!amount || !planId || !userId) {
        return res.status(400).json({ error: 'Faltan parámetros.' });
    }

    // Usar el ID de usuario como dato de paso
    const customData = JSON.stringify({ planId: planId, userId: userId });

    const create_payment_json = {
        "intent": "sale",
        "payer": {
            "payment_method": "paypal"
        },
        "redirect_urls": {
            "return_url": `${RENDER_BACKEND_URL}/api/paypal/success?planId=${planId}&userId=${userId}`,
            "cancel_url": `${RENDER_BACKEND_URL}/api/paypal/cancel`
        },
        "transactions": [{
            "item_list": {
                "items": [{
                    "name": `Suscripción ${planId}`,
                    "sku": planId,
                    "price": amount,
                    "currency": "USD",
                    "quantity": "1"
                }]
            },
            "amount": {
                "currency": "USD",
                "total": amount
            },
            "description": `Pago de suscripción Sala Cine (${planId})`,
            "custom": customData // Usamos el campo custom
        }]
    };

    paypal.payment.create(create_payment_json, function (error, payment) {
        if (error) {
            console.error("Error creando pago de PayPal:", error.response);
            return res.status(500).json({ error: 'Error al iniciar el pago con PayPal.', details: error.response });
        } else {
            for(let i = 0; i < payment.links.length; i++){
                if(payment.links[i].rel === 'approval_url'){
                    return res.json({ success: true, approvalUrl: payment.links[i].href });
                }
            }
            return res.status(500).json({ error: 'No se encontró la URL de aprobación de PayPal.' });
        }
    });
});

app.get('/api/paypal/success', async (req, res) => {
    const payerId = req.query.PayerID;
    const paymentId = req.query.paymentId;
    const planId = req.query.planId;
    const userId = req.query.userId;
    // const amount = req.query.total; // Ya no se necesita si se usa payment.transactions[0].amount

    if (!payerId || !paymentId || !planId || !userId) {
        return res.status(400).send("Pago fallido: Faltan datos.");
    }

    // 1. Obtener detalles del pago para verificar el monto
    paypal.payment.get(paymentId, async (error, payment) => {
        if (error) {
            console.error("Error al obtener detalles de pago:", error);
            return res.status(500).send("Error al verificar el pago.");
        }

        // 2. Ejecutar el pago
        const execute_payment_json = {
            "payer_id": payerId,
            "transactions": [{
                "amount": payment.transactions[0].amount
            }]
        };

        paypal.payment.execute(paymentId, execute_payment_json, async function (error, execution) {
            if (error) {
                console.error("Error ejecutando pago de PayPal:", error.response);
                return res.status(500).send("Error al finalizar el pago.");
            }

            if (execution.state === 'approved') {
                console.log(`✅ Pago de PayPal APROBADO. Plan: ${planId}, User: ${userId}`);
                
                try {
                    // 3. Actualizar la suscripción en Firestore (db)
                    const planRef = db.collection('planes').doc(planId);
                    const planSnap = await planRef.get();
                    if (!planSnap.exists) {
                        return res.send(`Pago exitoso, pero el plan ${planId} no existe.`);
                    }
                    const planData = planSnap.data();
                    const durationDays = planData.durationDays || 30; // Usar 30 por defecto

                    const userRef = db.collection('users').doc(userId);
                    const userSnap = await userRef.get();
                    let newExpiryDate;

                    if (userSnap.exists && userSnap.data().suscripcion && userSnap.data().suscripcion.expiryDate) {
                        // Si ya tiene suscripción, añadir días a la fecha de expiración
                        const currentExpiry = userSnap.data().suscripcion.expiryDate.toDate();
                        // Importante: Usar moment para añadir los días correctamente
                        newExpiryDate = admin.firestore.Timestamp.fromDate(
                            moment(currentExpiry).add(durationDays, 'days').toDate()
                        );
                    } else {
                        // Si es nuevo o expiró, empezar desde ahora
                        newExpiryDate = admin.firestore.Timestamp.fromDate(
                            moment().add(durationDays, 'days').toDate()
                        );
                    }

                    await userRef.set({
                        suscripcion: {
                            planId: planId,
                            expiryDate: newExpiryDate,
                            status: 'active',
                            lastPayment: admin.firestore.Timestamp.now(),
                            paymentMethod: 'PayPal',
                            paymentId: paymentId
                        }
                    }, { merge: true });

                    // 4. Enviar notificación al admin
                    const mailOptions = {
                        from: process.env.EMAIL_USER,
                        to: ADMIN_EMAIL, // Usar la variable de entorno
                        subject: '✅ NUEVO PAGO RECIBIDO (PayPal)',
                        text: `El usuario ${userId} ha pagado ${execution.transactions[0].amount.total} USD por el plan ${planId}. Nueva expiración: ${newExpiryDate.toDate().toISOString()}.`
                    };
                    await transporter.sendMail(mailOptions);
                    
                    // 5. Redireccionar o mostrar mensaje al usuario
                    res.send(`
                        <!DOCTYPE html>
                        <html>
                        <head><title>Pago Aprobado</title></head>
                        <body style="text-align:center; padding:50px;">
                            <h1>✅ Pago Aprobado</h1>
                            <p>Tu suscripción ha sido activada. ¡Gracias!</p>
                            <p>Plan: ${planId}</p>
                            <p>Expira: ${moment(newExpiryDate.toDate()).format('YYYY-MM-DD HH:mm')}</p>
                            <p>Puedes cerrar esta ventana.</p>
                        </body>
                        </html>
                    `);

                } catch (dbError) {
                    console.error("Error al actualizar DB después de PayPal:", dbError);
                    res.status(500).send("Pago aprobado, pero hubo un error al actualizar tu cuenta. Contacta soporte.");
                }

            } else {
                res.status(400).send("Pago fallido o no aprobado.");
            }
        });
    });
});

app.get('/api/paypal/cancel', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Pago Cancelado</title></head>
        <body style="text-align:center; padding:50px;">
            <h1>❌ Pago Cancelado</h1>
            <p>Has cancelado el proceso de pago. Puedes volver a intentarlo.</p>
            <p>Puedes cerrar esta ventana.</p>
        </body>
        </html>
    `);
});


// --- BINANCE PAY ---

app.post('/api/binance/create-order', async (req, res) => {
    if (!binancePay) {
        return res.status(503).json({ success: false, error: 'Binance Pay no está inicializado.' });
    }

    const { amount, planId, userId } = req.body;
    if (!amount || !planId || !userId) {
        return res.status(400).json({ success: false, error: 'Faltan parámetros: amount, planId, userId.' });
    }

    // Generar un ID de orden único y fácil de rastrear
    const merchantTradeNo = `SC-${Date.now()}-${userId.substring(0, 8)}`;
    const totalAmount = amount.toString();

    const orderData = {
        env: { terminalType: 'APP' }, // Esto puede ser WEB, APP, o H5
        merchantTradeNo: merchantTradeNo,
        orderAmount: totalAmount,
        currency: 'USDT', // Usar USDT para estabilidad, si no se especifica otra cosa
        goodsDetails: {
            goodsType: '01', // Virtual Goods
            goodsCategory: 'AA001', // General
            referenceGoodsId: planId,
            goodsName: `Suscripción Sala Cine (${planId})`,
            goodsDetail: `Activación de plan ${planId} para usuario ${userId}`
        },
        // Webhook URL para recibir la notificación de pago
        notifyUrl: `${RENDER_BACKEND_URL}/api/binance/notify`, 
        // URL a la que el usuario es redirigido tras el pago (opcional)
        returnUrl: `${RENDER_BACKEND_URL}/api/binance/return?userId=${userId}&planId=${planId}&tradeNo=${merchantTradeNo}`
    };

    try {
        const response = await binancePay.api.order.createOrder(orderData);
        if (response.status === 'SUCCESS') {
            return res.json({
                success: true,
                data: {
                    prepayId: response.data.prepayId,
                    qrCode: response.data.qrcodeLink, // Link para QR/Web pago
                    deepLink: response.data.deeplink, // Enlace para abrir la app de Binance
                    merchantTradeNo: merchantTradeNo
                }
            });
        } else {
            console.error("Error creando orden Binance:", response);
            return res.status(500).json({ success: false, error: 'Error al crear la orden de Binance.', details: response.errorMessage });
        }
    } catch (error) {
        console.error("Error en /api/binance/create-order:", error);
        return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});


// Ruta de retorno para el usuario (Informativa, el estado real se obtiene por NOTIFY)
app.get('/api/binance/return', (req, res) => {
    const { userId, planId, tradeNo } = req.query;
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Estado de Pago</title></head>
        <body style="text-align:center; padding:50px;">
            <h1>🕒 Verificando Pago...</h1>
            <p>Tu orden de pago (${tradeNo}) ha sido enviada a Binance. La activación de la suscripción se realizará automáticamente al recibir la confirmación de pago.</p>
            <p>Plan: ${planId}</p>
            <p>ID de Usuario: ${userId}</p>
            <p>Espera unos segundos y revisa tu aplicación o contáctanos si no se activa.</p>
            <p>Puedes cerrar esta ventana.</p>
        </body>
        </html>
    `);
});

// Webhook de Notificación de Binance (El más importante para la activación)
app.post('/api/binance/notify', async (req, res) => {
    if (!binancePay) {
        // Responder con éxito incluso si no está inicializado para no reintentar el webhook
        return res.json({ returnCode: 'SUCCESS', returnMessage: 'Ignorado (Binance Pay no activo)' });
    }

    const signature = req.headers['binancepay-signature'];
    const timestamp = req.headers['binancepay-timestamp'];
    const nonce = req.headers['binancepay-nonce'];
    const payload = JSON.stringify(req.body);

    // 1. Verificar la firma (SEGURIDAD CRÍTICA)
    if (!binancePay.utils.verifySignature({ timestamp, nonce, payload, signature })) {
        console.warn("❌ Webhook Binance: Firma Inválida.");
        return res.status(401).json({ returnCode: 'FAIL', returnMessage: 'Signature verification failed' });
    }
    
    // 2. Procesar el estado de la orden
    const { bizStatus, merchantTradeNo } = req.body.data;
    
    // Aquí puedes buscar la orden por merchantTradeNo si necesitas datos extra

    if (bizStatus === 'PAY_SUCCESS') {
        console.log(`✅ Webhook Binance: Pago APROBADO para la orden ${merchantTradeNo}.`);

        // Extraer userId y planId del merchantTradeNo si se codificó, o buscarlos
        const parts = merchantTradeNo.split('-');
        const userId = parts.length > 2 ? parts[parts.length - 1] : null; 
        
        // ** NOTA CRÍTICA: La lógica de Binance aquí requiere buscar el plan real y la duración. 
        // Se asume la duración del plan por defecto para no romper el flujo.
        const DUMMY_PLAN_ID = 'PRO_30_DAYS'; // <- DEBE SER DINÁMICO
        const DUMMY_DURATION = 30; // <- DEBE SER DINÁMICO

        if (userId) {
            try {
                // 3. Obtener el plan de la DB y Duración REAL
                const planRef = db.collection('planes').doc(DUMMY_PLAN_ID); 
                const planSnap = await planRef.get();
                const durationDays = planSnap.exists ? planSnap.data().durationDays : DUMMY_DURATION;

                const userRef = db.collection('users').doc(userId);
                const userSnap = await userRef.get();
                let newExpiryDate;

                if (userSnap.exists && userSnap.data().suscripcion && userSnap.data().suscripcion.expiryDate) {
                    const currentExpiry = userSnap.data().suscripcion.expiryDate.toDate();
                    newExpiryDate = admin.firestore.Timestamp.fromDate(
                        moment(currentExpiry).add(durationDays, 'days').toDate()
                    );
                } else {
                    newExpiryDate = admin.firestore.Timestamp.fromDate(
                        moment().add(durationDays, 'days').toDate()
                    );
                }
                
                await userRef.set({
                    suscripcion: {
                        planId: DUMMY_PLAN_ID,
                        expiryDate: newExpiryDate,
                        status: 'active',
                        lastPayment: admin.firestore.Timestamp.now(),
                        paymentMethod: 'Binance Pay',
                        paymentId: merchantTradeNo
                    }
                }, { merge: true });

                console.log(`Suscripción activada para ${userId}.`);

                // Notificar al admin (Opcional)
                const mailOptions = {
                    from: process.env.EMAIL_USER,
                    to: ADMIN_EMAIL,
                    subject: '✅ NUEVO PAGO RECIBIDO (Binance Pay)',
                    text: `El usuario ${userId} ha pagado (Binance Pay). Orden: ${merchantTradeNo}.`
                };
                await transporter.sendMail(mailOptions);

            } catch (dbError) {
                console.error("Error al actualizar DB después de Binance Notify:", dbError);
            }
        }
    } else if (bizStatus === 'PAY_CLOSED') {
        console.log(`❌ Webhook Binance: Orden ${merchantTradeNo} CANCELADA/CERRADA.`);
    }
    
    // 4. Responder a Binance con el formato requerido
    return res.json({
        returnCode: 'SUCCESS',
        returnMessage: 'Received'
    });
});


// -------------------------------------------------------------------------
// RUTAS DE FIREBASE PUSH NOTIFICATIONS
// -------------------------------------------------------------------------

// Endpoint para que la app se suscriba o desuscriba (existente)
app.post('/api/fcm/subscribe', async (req, res) => {
    const { token, topic, subscribe } = req.body; // subscribe es boolean
    if (!token || !topic || (typeof subscribe !== 'boolean')) {
        return res.status(400).json({ success: false, error: 'Faltan token, topic o subscribe.' });
    }

    try {
        if (subscribe) {
            await messaging.subscribeToTopic(token, topic);
            console.log(`Token suscrito a topic '${topic}'`);
            return res.json({ success: true, message: `Suscrito a ${topic}` });
        } else {
            await messaging.unsubscribeFromTopic(token, topic);
            console.log(`Token desuscrito de topic '${topic}'`);
            return res.json({ success: true, message: `Desuscrito de ${topic}` });
        }
    } catch (error) {
        console.error(`Error en FCM subscribe/unsubscribe:`, error);
        return res.status(500).json({ success: false, error: error.message });
    }
});


// Endpoint de prueba para mandar una notificación al topic 'test' (existente)
app.post('/api/fcm/test-send', async (req, res) => {
    const { title, body, tmdbId } = req.body;
    if (!title || !body || !tmdbId) {
        return res.status(400).json({ success: false, error: 'Faltan title, body o tmdbId.' });
    }

    const dataPayload = {
        title: title,
        body: body,
        type: 'movie', // O 'series'
        tmdbId: tmdbId.toString()
    };
    
    const result = await sendFCMNotification('test', dataPayload);
    res.json(result);
});


// -------------------------------------------------------------------------
// RUTAS DE CONTENIDO (Catálogos, Recientes, Tendencias, etc.)
// -------------------------------------------------------------------------

// Ruta para obtener detalles de TMDB (existente)
app.get('/api/tmdb/details/:tmdbId', async (req, res) => {
    const tmdbId = req.params.tmdbId;
    const type = req.query.type || 'movie'; // 'movie' o 'tv'

    const cacheKey = `tmdb_detail_${type}_${tmdbId}`;
    const cachedData = tmdbCache.get(cacheKey);

    if (cachedData) {
        return res.json(cachedData);
    }

    try {
        const url = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-MX`;
        const response = await axios.get(url);

        tmdbCache.set(cacheKey, response.data);
        res.json(response.data);

    } catch (error) {
        console.error(`Error al obtener detalles de TMDB (${type}):`, error.message);
        res.status(error.response ? error.response.status : 500).json({ error: 'Error al obtener detalles de TMDB.' });
    }
});

// Ruta para obtener Recientes (existente)
app.get('/api/content/recent', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    const cachedRecent = recentCache.get(RECENT_CACHE_KEY);
    if (cachedRecent) {
        return res.status(200).json(cachedRecent);
    } 

    try {
        const projection = { tmdbId: 1, title: 1, name: 1, poster_path: 1, backdrop_path: 1, addedAt: 1 };
        
        const moviesPromise = mongoDb.collection('media_catalog')
            .find({ hideFromRecent: { $ne: true } })
            .project(projection)
            .sort({ addedAt: -1 })
            .limit(20)
            .toArray();

        const seriesPromise = mongoDb.collection('series_catalog')
            .find({})
            .project({ tmdbId: 1, name: 1, poster_path: 1, backdrop_path: 1, addedAt: 1, title: { $literal: null } }) // series usan 'name'
            .sort({ addedAt: -1 })
            .limit(20)
            .toArray();

        const [movies, series] = await Promise.all([moviesPromise, seriesPromise]);
        
        const formattedMovies = movies.map(m => formatLocalItem(m, 'movie'));
        const formattedSeries = series.map(s => formatLocalItem(s, 'tv'));
        
        // Combina, ordena por fecha de adición y limita a 20
        const combined = [...formattedMovies, ...formattedSeries]
            .sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0))
            .slice(0, 20);
        
        recentCache.set(RECENT_CACHE_KEY, combined);
        res.status(200).json(combined);

    } catch (error) {
        console.error("Error en /api/content/recent:", error);
        res.status(500).json({ error: "Error interno al obtener contenido reciente." });
    }
});


// 1. Endpoint Destacados (Pinned) (existente)
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

// 2. Endpoint K-Dramas (Automático por origin_country: 'KR') (existente)
app.get('/api/content/kdramas', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    const cachedKdramas = kdramaCache.get(KDRAMA_CACHE_KEY);
    if (cachedKdramas) {
        return res.status(200).json(cachedKdramas);
    }

    try {
        const projection = { tmdbId: 1, title: 1, name: 1, poster_path: 1, backdrop_path: 1, addedAt: 1, origin_country: 1 };
        
        // Query para buscar 'KR' en el array origin_country
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


// 3. Endpoint Catálogo Completo (existente)
app.get('/api/content/catalog', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    // Intentar leer de caché
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

        // Guardamos en caché SOLO el array puro
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

// 4. Ruta Lógica Híbrida/Filtro (existente)
app.get('/api/content/local', verifyIdToken, async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    const { type, genre, category, source } = req.query; 
    
    try {
        // 1. Configurar Colección y Proyección
        const collection = (type === 'tv') ? mongoDb.collection('series_catalog') : mongoDb.collection('media_catalog');
        const projection = { tmdbId: 1, title: 1, name: 1, poster_path: 1, backdrop_path: 1, addedAt: 1, genres: 1 };

        // ---------------------------------------------------------
        // A. LÓGICA DE CRUCE (POPULARES / TENDENCIAS)
        // ---------------------------------------------------------
        if (category === 'populares' || category === 'tendencias' || category === 'series_populares') {
            let tmdbEndpoint = '';
            if (category === 'populares') tmdbEndpoint = 'movie/popular';
            else if (category === 'series_populares') tmdbEndpoint = 'tv/popular';
            else tmdbEndpoint = 'trending/all/day';

            // 1. Pedir lista REAL a TMDB
            let tmdbList = tmdbCache.get(`smart_cross_${category}`);
            if (!tmdbList) {
                try {
                    const resp = await axios.get(`https://api.themoviedb.org/3/${tmdbEndpoint}?api_key=${TMDB_API_KEY}&language=es-MX`);
                    tmdbList = resp.data.results || [];
                    tmdbCache.set(`smart_cross_${category}`, tmdbList, 3600); // Cache 1 hora
                } catch (e) {
                    return res.status(200).json([]); // Fallback vacío
                }
            }

            // 2. Extraer IDs y buscar coincidencias locales
            const targetIds = tmdbList.map(item => item.id.toString());
            let localMatches = [];

            if (category === 'tendencias') {
                // Tendencias mezcla series y pelis
                const movies = await mongoDb.collection('media_catalog').find({ tmdbId: { $in: targetIds } }).project(projection).toArray();
                const series = await mongoDb.collection('series_catalog').find({ tmdbId: { $in: targetIds } }).project(projection).toArray();
                const fMovies = movies.map(m => formatLocalItem(m, 'movie'));
                const fSeries = series.map(s => formatLocalItem(s, 'tv'));
                localMatches = [...fMovies, ...fSeries];
            } else {
                // Populares (solo pelis o solo series)
                localMatches = await collection.find({ tmdbId: { $in: targetIds } }).project(projection).toArray();
                localMatches = localMatches.map(m => formatLocalItem(m, type));
            }

            // 3. Ordenar las coincidencias según el orden de TMDB
            const orderedList = tmdbList.map(tmdbItem => {
                const match = localMatches.find(localItem => localItem.tmdbId === tmdbItem.id.toString());
                return match;
            }).filter(item => item); // Eliminar nulls

            return res.status(200).json(orderedList.slice(0, 20)); // Limitar a los 20 más relevantes


        // ---------------------------------------------------------
        // B. LÓGICA DE FILTRADO POR GÉNERO
        // ---------------------------------------------------------
        } else if (genre) {
            const genreId = parseInt(genre);
            let finalList = [];
            const LIMIT = 50;

            // 1. Buscar en catálogo local (items que tienen el genreId guardado)
            const queryLocal = { genres: genreId };
            const localResults = await collection.find(queryLocal).project(projection).sort({ addedAt: -1 }).limit(LIMIT).toArray();
            
            finalList = localResults.map(i => formatLocalItem(i, type));

            if (finalList.length < LIMIT) {
                // 2. Si no llenamos el cupo, buscamos en TMDB para rellenar
                let tmdbGenreList = tmdbCache.get(`genre_${type}_${genreId}`);
                if (!tmdbGenreList) {
                    try {
                        const tmdbGenreUrl = `https://api.themoviedb.org/3/discover/${type}?api_key=${TMDB_API_KEY}&language=es-MX&sort_by=popularity.desc&with_genres=${genreId}`;
                        const resp = await axios.get(tmdbGenreUrl);
                        tmdbGenreList = resp.data.results || [];
                        tmdbCache.set(`genre_${type}_${genreId}`, tmdbGenreList, 86400); // Cache 24 horas
                    } catch (e) {
                        // Fallback: solo resultados locales
                        return res.status(200).json(finalList);
                    }
                }

                // 3. Filtrar los resultados de TMDB para obtener solo los que están en la DB (para evitar "huecos")
                const tmdbIds = tmdbGenreList.map(item => item.id.toString());
                
                const queryCross = { tmdbId: { $in: tmdbIds } };
                const localCandidates = await collection.find(queryCross).project(projection).toArray();

                // 4. Combinar (asegurando que no haya duplicados del paso 1)
                for (const candidate of localCandidates) {
                    if (finalList.length >= LIMIT) break;
                    if (!finalList.find(i => i.tmdbId === candidate.tmdbId)) {
                        finalList.push(formatLocalItem(candidate, type));
                    }
                }
            }
            
            return res.status(200).json(finalList.slice(0, LIMIT));


        // ---------------------------------------------------------
        // C. FALLBACK: MOSTRAR SOLO LO MÁS RECIENTE
        // ---------------------------------------------------------
        } else {
            const fallbackResults = await collection.find({})
                .project(projection)
                .sort({ addedAt: -1 })
                .limit(20)
                .toArray();
                
            return res.status(200).json(fallbackResults.map(i => formatLocalItem(i, type)));
        }

    } catch (error) {
        console.error("Error en /api/content/local:", error);
        res.status(500).json({ error: "Error interno al obtener contenido." });
    }
});


// -------------------------------------------------------------------------
// RUTAS DE USUARIO (Historial, Likes, Perfil, Recompensas)
// -------------------------------------------------------------------------

// Ruta para actualizar el perfil del usuario (existente)
app.post('/api/user/profile', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { username, flair } = req.body;

    if (!uid) { return res.status(401).json({ error: 'No autorizado.' }); }

    if (!username || username.length < 3) {
        return res.status(400).json({ error: 'Nombre de usuario inválido.' });
    }

    try {
        const userDocRef = db.collection('users').doc(uid);
        await userDocRef.update({ username: username, flair: flair || "" });
        countsCache.del(`${uid}:/api/user/me`); // Invalida caché de perfil
        res.status(200).json({ message: 'Perfil actualizado con éxito.' });
    } catch (error) {
        console.error("Error en /api/user/profile:", error);
        res.status(500).json({ error: 'Error al actualizar el perfil.' });
    }
});

// Ruta para obtener coins/datos de usuario (existente)
app.get('/api/user/me', verifyIdToken, countsCacheMiddleware, async (req, res) => {
    const { uid, cacheKey } = req;
    if (!uid) { return res.status(401).json({ error: 'No autorizado.' }); }

    try {
        const userDocRef = db.collection('users').doc(uid);
        const doc = await userDocRef.get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }
        
        const userData = doc.data();
        
        // Formatear datos de suscripción para la respuesta
        let suscripcion = userData.suscripcion || { status: 'inactive' };
        if (suscripcion.expiryDate) {
            suscripcion.expiryDate = suscripcion.expiryDate.toDate().toISOString();
        }

        const responseData = {
            coins: userData.coins || 0,
            username: userData.username || 'Usuario Anónimo',
            flair: userData.flair || '',
            suscripcion: suscripcion,
            uid: uid
        };

        countsCache.set(cacheKey, responseData);
        res.status(200).json(responseData);

    } catch (error) {
        console.error("Error en /api/user/me:", error);
        res.status(500).json({ error: 'Error al obtener datos de usuario.' });
    }
});


// Ruta para obtener Historial (existente)
app.get('/api/user/history', verifyIdToken, async (req, res) => {
    const { uid } = req;
    if (!uid) { return res.status(401).json({ error: 'No autorizado.' }); }

    const cacheKey = `history_get_${uid}`;
    try {
        const cachedData = historyCache.get(cacheKey);
        if (cachedData) {
            return res.status(200).json(cachedData);
        }
    } catch (err) {
        console.error("Error al leer del caché de historial:", err);
    } 

    try {
        const historyRef = db.collection('users').doc(uid).collection('history');
        const snapshot = await historyRef.orderBy('watchedAt', 'desc').limit(50).get();
        
        const history = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                tmdbId: data.tmdbId,
                title: data.title,
                poster_path: data.poster_path,
                backdrop_path: data.backdrop_path,
                type: data.type,
                watchedAt: data.watchedAt ? data.watchedAt.toDate().toISOString() : null
            };
        });

        historyCache.set(cacheKey, history);
        res.status(200).json(history);
    } catch (error) {
        console.error("Error en /api/user/history (GET):", error);
        res.status(500).json({ error: 'Error al obtener el historial.' });
    }
});

// Ruta para registrar Historial (existente)
app.post('/api/user/history', verifyIdToken, async (req, res) => {
    const { uid } = req;
    let { tmdbId, title, poster_path, backdrop_path, type } = req.body;
    if (!tmdbId || !type) { return res.status(400).json({ error: 'tmdbId y type requeridos.' }); }
    if (!uid) { return res.status(401).json({ error: 'No autorizado.' }); }

    const rawId = String(tmdbId).trim();
    const idAsString = rawId;

    // Lógica para intentar rellenar backdrop si falta (existente)
    if (!backdrop_path && mongoDb) { 
        try {
            let mediaDoc = null;
            if (type === 'movie') { 
                mediaDoc = await mongoDb.collection('media_catalog').findOne({ tmdbId: idAsString }, { projection: { backdrop_path: 1 } }); 
            } else if (type === 'series' || type === 'tv') { 
                mediaDoc = await mongoDb.collection('series_catalog').findOne({ tmdbId: idAsString }, { projection: { backdrop_path: 1 } }); 
            }
            if (mediaDoc && mediaDoc.backdrop_path) {
                backdrop_path = mediaDoc.backdrop_path;
            }
        } catch (e) {
            console.warn("Fallo al buscar backdrop para historial:", e.message);
        }
    }

    try {
        const historyRef = db.collection('users').doc(uid).collection('history').doc(idAsString);
        await historyRef.set({
            tmdbId: idAsString,
            title: title || 'Contenido Desconocido',
            poster_path: poster_path || null,
            backdrop_path: backdrop_path || null,
            type: type,
            watchedAt: admin.firestore.Timestamp.now()
        }, { merge: true });

        // Invalida la caché del historial para refrescar
        historyCache.del(`history_get_${uid}`);

        res.status(200).json({ message: 'Historial actualizado con éxito.' });

    } catch (error) {
        console.error("Error en /api/user/history (POST):", error);
        res.status(500).json({ error: 'Error al registrar el historial.' });
    }
});


// Ruta para registrar/obtener Likes (existente)
app.post('/api/user/likes', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { tmdbId, type } = req.body;
    if (!tmdbId || !type) { return res.status(400).json({ error: 'tmdbId y type requeridos.' }); }
    if (!uid) { return res.status(401).json({ error: 'No autorizado.' }); }

    const idAsString = String(tmdbId).trim();
    const likeDocId = `${type}_${idAsString}`;

    try {
        const likesRef = db.collection('users').doc(uid).collection('likes').doc(likeDocId);
        const docSnap = await likesRef.get();

        if (!docSnap.exists) {
            // 1. Registrar el like en Firestore
            await likesRef.set({
                tmdbId: idAsString,
                type: type,
                likedAt: admin.firestore.Timestamp.now()
            });

            // 2. Incrementar la métrica de likes en MongoDB (existente)
            if (mongoDb) {
                const collection = (type === 'movie') ? mongoDb.collection('media_catalog') : mongoDb.collection('series_catalog');
                await collection.updateOne(
                    { tmdbId: idAsString },
                    { $inc: { likes: 1 } },
                    { upsert: true } // Upsert por si el doc no existe aún
                );
                countsCache.del(`counts-metrics-${idAsString}-likes`); // Invalida la caché de métrica
            }

            res.status(200).json({ message: 'Like registrado con éxito.' });
        } else {
            return res.status(200).json({ message: 'Like ya existe (no se registró duplicado).' });
        }
    } catch (error) {
        console.error("Error en /api/user/likes:", error);
        res.status(500).json({ error: 'Error al registrar el like.' });
    }
});


// Ruta para redimir recompensas (existente)
app.post('/api/rewards/redeem/premium', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { daysToAdd } = req.body;
    if (!uid) { return res.status(401).json({ success: false, error: 'No autorizado.' }); }
    if (!daysToAdd) { return res.status(400).json({ success: false, error: 'daysToAdd es requerido.' }); }

    const days = parseInt(daysToAdd, 10);
    if (isNaN(days) || days <= 0) { return res.status(400).json({ success: false, error: 'daysToAdd debe ser un número positivo.' }); }

    const userRef = db.collection('users').doc(uid);
    try {
        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists) {
                throw new Error("Usuario no encontrado.");
            }
            
            const userData = userDoc.data();
            const currentCoins = userData.coins || 0;
            const COST_PER_DAY = 50; // Ejemplo: 50 coins por día
            const totalCost = days * COST_PER_DAY;

            if (currentCoins < totalCost) {
                throw new Error(`Fondos insuficientes. Necesitas ${totalCost} monedas.`);
            }

            // Descontar monedas
            transaction.update(userRef, { coins: currentCoins - totalCost });

            // Calcular nueva fecha de expiración
            const currentSub = userData.suscripcion || {};
            let newExpiryDate;

            if (currentSub.expiryDate && currentSub.expiryDate.toDate() > new Date()) {
                const currentExpiry = currentSub.expiryDate.toDate();
                newExpiryDate = admin.firestore.Timestamp.fromDate(
                    moment(currentExpiry).add(days, 'days').toDate()
                );
            } else {
                newExpiryDate = admin.firestore.Timestamp.fromDate(
                    moment().add(days, 'days').toDate()
                );
            }
            
            // Actualizar suscripción
            transaction.set(userRef, {
                suscripcion: {
                    planId: `REWARD_${days}_DAYS`,
                    expiryDate: newExpiryDate,
                    status: 'active',
                    lastPayment: admin.firestore.Timestamp.now(),
                    paymentMethod: 'Reward',
                    paymentId: `REWARD-${Date.now()}`
                }
            }, { merge: true });

            countsCache.del(`${uid}:/api/user/me`); // Invalida caché de perfil
            return { newExpiryDate: newExpiryDate.toDate().toISOString() };
        });

        res.status(200).json({ success: true, message: `Suscripción Premium activada por ${days} días.` });

    } catch (error) {
        console.error("Error en /api/rewards/redeem/premium:", error);
        res.status(400).json({ success: false, error: error.message || 'Error al redimir la recompensa.' });
    }
});


// Ruta para notificar solicitud de diamantes (existente)
app.post('/api/rewards/notify-diamonds', verifyIdToken, async (req, res) => {
    const { uid } = req;
    const { gameId, amount, gameName } = req.body;
    if (!uid || !gameId || !amount || !gameName) { return res.status(400).json({ error: 'Faltan parámetros.' }); }
    if (!ADMIN_CHAT_ID) { return res.status(500).json({ error: 'ADMIN_CHAT_ID no configurado.' }); }

    try {
        const userDoc = await db.collection('users').doc(uid).get();
        const username = userDoc.exists ? (userDoc.data().username || uid) : uid;

        const message = `🚨 *NUEVA SOLICITUD DE DIAMANTES* 💎\n\n` +
                        `👤 *Usuario:* ${username} (UID: \`${uid}\`)\n` +
                        `🎮 *Juego:* ${gameName}\n` +
                        `💰 *Monto:* ${amount} diamantes\n` +
                        `🆔 *ID de Juego:* \`${gameId}\``;

        // Enviar notificación al chat del administrador (existente)
        await bot.sendMessage(ADMIN_CHAT_ID, message, {
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


// -------------------------------------------------------------------------
// RUTAS DE ADMINISTRACIÓN (Subida por Bot)
// -------------------------------------------------------------------------

// Ruta para subir/actualizar Película (existente)
app.post('/api/admin/upload-movie', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    try {
        // Obtenemos todos los campos que envía el bot
        const { 
            tmdbId, title, poster_path, backdrop_path,
            link_sd, link_hd, freeEmbedCode, proEmbedCode, 
            isPremium, overview, hideFromRecent, 
            genres, release_date, popularity, vote_average, 
            isPinned, origin_country 
        } = req.body;

        if (!tmdbId) return res.status(400).json({ error: 'tmdbId requerido.' });
        const cleanTmdbId = String(tmdbId).trim();

        // 1. Preparar el objeto de actualización/inserción
        const updateQuery = { 
            $set: { 
                title, poster_path, backdrop_path, overview, 
                link_sd, link_hd, 
                freeEmbedCode, proEmbedCode, 
                isPremium: isPremium === true || isPremium === 'true', // Convertir a booleano
                hideFromRecent: hideFromRecent === true || hideFromRecent === 'true', // Convertir a booleano
                // Guardar metadatos nuevos
                genres: genres || [], 
                release_date: release_date || null, 
                popularity: popularity || 0, 
                vote_average: vote_average || 0,
                isPinned: isPinned === true || isPinned === 'true', // NUEVO: Destacado
                origin_country: origin_country || [], // NUEVO: País
                updatedAt: new Date()
            }, 
            $setOnInsert: { 
                tmdbId: cleanTmdbId, 
                addedAt: new Date(),
                views: 0, 
                likes: 0
            } 
        };

        // 2. Ejecutar la operación de upsert (Update/Insert)
        await mongoDb.collection('media_catalog').updateOne(
            { tmdbId: cleanTmdbId }, 
            updateQuery, 
            { upsert: true }
        );

        // 3. Limpieza y Notificación de Cachés
        try {
            await mongoDb.collection('movie_requests').deleteOne({ tmdbId: cleanTmdbId });
            console.log(`[Auto-Clean] Pedido eliminado tras subida película: ${title} (${cleanTmdbId})`);
        } catch (cleanupError) {
            console.warn(`[Auto-Clean Warning] No se pudo limpiar el pedido: ${cleanupError.message}`);
        }
        
        embedCache.del(`embed-${cleanTmdbId}-movie-1-pro`);
        embedCache.del(`embed-${cleanTmdbId}-movie-1-free`);
        countsCache.del(`counts-data-${cleanTmdbId}`); 
        recentCache.del(RECENT_CACHE_KEY);
        pinnedCache.del(PINNED_CACHE_KEY); // Limpiar caché de destacados
        kdramaCache.del(KDRAMA_CACHE_KEY); // Limpiar caché de k-dramas
        catalogCache.del(CATALOG_CACHE_KEY); // Limpiar caché de catálogo

        res.status(200).json({ success: true, message: `Película ${title} (${cleanTmdbId}) subida/actualizada con éxito.` });

    } catch (error) {
        console.error("Error al subir película:", error);
        res.status(500).json({ error: 'Error interno del servidor al procesar la subida.' });
    }
});

// Ruta para subir/actualizar Serie o Episodio (existente)
app.post('/api/admin/upload-series', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });

    try {
        // Obtenemos los campos principales de la serie
        const { 
            tmdbId, name, poster_path, backdrop_path,
            overview, genres, first_air_date, popularity, vote_average,
            isPinned, origin_country, // Metadatos de la serie
            // Datos del episodio o temporada (si se envían)
            seasonNumber, episodeNumber, 
            link_sd, link_hd, freeEmbedCode, proEmbedCode, 
            isPremium, title // Título del episodio
        } = req.body;

        if (!tmdbId) return res.status(400).json({ error: 'tmdbId requerido.' });
        const cleanTmdbId = String(tmdbId).trim();

        const seriesCollection = mongoDb.collection('series_catalog');

        // 1. Lógica de Subida de Serie (Metadata Principal)
        const seriesUpdateQuery = {
            $set: {
                name, poster_path, backdrop_path, overview, 
                genres: genres || [],
                first_air_date: first_air_date || null,
                popularity: popularity || 0, 
                vote_average: vote_average || 0,
                isPinned: isPinned === true || isPinned === 'true', 
                origin_country: origin_country || [],
                updatedAt: new Date()
            },
            $setOnInsert: {
                tmdbId: cleanTmdbId,
                addedAt: new Date(),
                views: 0,
                likes: 0,
                seasons: [] // Inicializar temporadas
            }
        };

        // Ejecutar upsert para la Serie (Crea si no existe, actualiza metadata si existe)
        await seriesCollection.updateOne(
            { tmdbId: cleanTmdbId }, 
            seriesUpdateQuery, 
            { upsert: true }
        );

        let episodeMessage = `Serie ${name} (${cleanTmdbId}) actualizada con éxito.`;

        // 2. Lógica de Subida de Episodio (si se proporcionan season/episode)
        if (seasonNumber !== undefined && episodeNumber !== undefined) {
            const seasonNum = parseInt(seasonNumber);
            const episodeNum = parseInt(episodeNumber);

            if (isNaN(seasonNum) || isNaN(episodeNum)) {
                return res.status(400).json({ error: 'seasonNumber y episodeNumber deben ser números válidos.' });
            }

            // Sub-documento del episodio
            const episodeUpdateData = {
                title: title || `Episodio ${episodeNum}`,
                episode_number: episodeNum,
                link_sd, link_hd,
                freeEmbedCode, proEmbedCode,
                isPremium: isPremium === true || isPremium === 'true',
                updatedAt: new Date()
            };

            // a) Intentar actualizar el episodio existente
            const updateResult = await seriesCollection.updateOne(
                { 
                    tmdbId: cleanTmdbId, 
                    'seasons.season_number': seasonNum,
                    'seasons.episodes.episode_number': episodeNum
                },
                { 
                    $set: { 
                        'seasons.$[s].episodes.$[e]': episodeUpdateData 
                    } 
                },
                {
                    arrayFilters: [ 
                        { 's.season_number': seasonNum }, 
                        { 'e.episode_number': episodeNum }
                    ]
                }
            );

            // b) Si no se actualizó (el episodio o la temporada no existen), lo agregamos.
            if (updateResult.modifiedCount === 0) {
                
                // Intentar agregar el episodio a una temporada existente
                const addEpisodeResult = await seriesCollection.updateOne(
                    { tmdbId: cleanTmdbId, 'seasons.season_number': seasonNum },
                    { 
                        $push: { 
                            'seasons.$.episodes': episodeUpdateData 
                        } 
                    }
                );

                // c) Si ni el episodio ni la temporada existen, crea la temporada y el episodio
                if (addEpisodeResult.modifiedCount === 0) {
                    await seriesCollection.updateOne(
                        { tmdbId: cleanTmdbId },
                        { 
                            $push: {
                                seasons: {
                                    season_number: seasonNum,
                                    name: `Temporada ${seasonNum}`,
                                    episodes: [episodeUpdateData]
                                }
                            }
                        }
                    );
                }
            }

            episodeMessage = `Episodio S${seasonNum}E${episodeNum} de ${name} (${cleanTmdbId}) subido/actualizado con éxito.`;

            // Limpieza de cachés específicas del episodio
            embedCache.del(`embed-${cleanTmdbId}-${seasonNum}-${episodeNum}-pro`);
            embedCache.del(`embed-${cleanTmdbId}-${seasonNum}-${episodeNum}-free`);

        }
        
        // Limpieza de cachés generales de la serie/catálogo
        countsCache.del(`counts-data-${cleanTmdbId}`); 
        recentCache.del(RECENT_CACHE_KEY);
        pinnedCache.del(PINNED_CACHE_KEY); 
        kdramaCache.del(KDRAMA_CACHE_KEY); 
        catalogCache.del(CATALOG_CACHE_KEY); 

        // 3. Limpiar la petición
        try {
            await mongoDb.collection('series_requests').deleteOne({ tmdbId: cleanTmdbId });
            console.log(`[Auto-Clean] Pedido eliminado tras subida episodio: ${name} (${cleanTmdbId})`);
        } catch (cleanupError) {
            console.warn(`[Auto-Clean Warning] No se pudo limpiar el pedido: ${cleanupError.message}`);
        }


        res.status(200).json({ success: true, message: episodeMessage });

    } catch (error) {
        console.error("Error al subir serie/episodio:", error);
        res.status(500).json({ error: 'Error interno del servidor al procesar la subida.' });
    }
});


// -------------------------------------------------------------------------
// RUTAS DE LA APP (Deep Links / Assets)
// -------------------------------------------------------------------------

// Ruta para Android App Links (IMPORTANTE: Debe estar en /.well-known/) (existente)
app.get('/.well-known/assetlinks.json', (req, res) => {
    // Sirve tu archivo assetlinks.json
    const filePath = path.join(__dirname, 'assetlinks.json');
    fs.readFile(filePath, (err, data) => {
        if (err) {
            console.error("Error leyendo assetlinks.json:", err);
            return res.status(500).send("Error interno.");
        }
        res.setHeader('Content-Type', 'application/json');
        res.send(data);
    });
});


// =========================================================================
// === RUTA CRÍTICA: /app/details/:tmdbId (REEMPLAZADA) - LÍNEA ~970 ===
// =========================================================================
// ** NOTA: ESTE BLOQUE HA SIDO COMPLETAMENTE REEMPLAZADO CON LA LÓGICA DE LANDING.HTML **
app.get('/app/details/:tmdbId', async (req, res) => {
    const tmdbId = req.params.tmdbId;
    
    // URL FIJA DE TU VIDEO TUTORIAL. ¡DEBES REEMPLAZAR ESTO CON TU ENLACE REAL!
    const VIDEO_TUTORIAL_URL = "URL_DE_TU_VIDEO_TUTORIAL.mp4"; 

    // Valores por defecto (por si falla TMDB)
    let titulo = "Sala Cine";
    let backdrop = ""; 

    try {
        // 1. Intentamos obtener datos de TMDB (Probamos primero como PELÍCULA)
        const urlMovie = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-MX`;
        
        try {
            const response = await axios.get(urlMovie);
            titulo = response.data.title;
            backdrop = response.data.backdrop_path || response.data.poster_path;
        } catch (errorMovie) {
            // 2. Si falla (404), intentamos como SERIE
            try {
                const urlTV = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-MX`;
                const responseTV = await axios.get(urlTV);
                titulo = responseTV.data.name; // En series es 'name', no 'title'
                backdrop = responseTV.data.backdrop_path || responseTV.data.poster_path;
            } catch (errorTV) {
                console.log(`[Landing] No se encontraron datos en TMDB para ID: ${tmdbId}`);
            }
        }

        // 3. Leemos tu archivo landing.html
        // Usamos path.join(__dirname, 'landing.html') para encontrar el archivo en la misma carpeta que server.js
        const filePath = path.join(__dirname, 'landing.html');
        
        fs.readFile(filePath, 'utf8', (err, htmlData) => {
            if (err) {
                console.error("Error leyendo landing.html:", err);
                // Si landing.html no existe, puedes caer a una página genérica o error 500
                return res.status(500).send("Error cargando la página. Asegúrate de que 'landing.html' exista.");
            }

            // 4. Reemplazamos los textos "Reemplazar..." por los datos reales
            let finalHtml = htmlData
                .replace(/ReemplazarID/g, tmdbId)
                .replace(/ReemplazarTitulo/g, titulo)
                .replace(/ReemplazarBackdrop/g, backdrop || "")
                .replace(/AQUI_PONES_TU_ENLACE_DEL_VIDEO.mp4/g, VIDEO_TUTORIAL_URL);


            // 5. Enviamos la página lista al usuario
            res.send(finalHtml);
        });

    } catch (error) {
        console.error("Error crítico en landing page:", error);
        res.status(500).send("Error del servidor.");
    }
});


// =========================================================================
// === MANTENIMIENTO Y CIERRE (Existente) ===
// =========================================================================

// Tareas cron para refrescar caché (ejecución diaria)
cron.schedule('0 0 * * *', () => {
    console.log('Cron: Limpiando cachés diarias...');
    embedCache.flushAll();
    recentCache.flushAll();
    tmdbCache.flushAll();
}, {
    timezone: "America/Guayaquil" // O la zona horaria que uses
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
        axios,
        pinnedCache // Pasamos la caché para que el bot pueda limpiarla
    );
    
    // Aquí es donde el bot se configuraría si no estuviera en polling
    if (process.env.NODE_ENV === 'production' && BOT_TOKEN) {
        app.post(`/bot${BOT_TOKEN}`, (req, res) => {
            bot.processUpdate(req.body);
            res.sendStatus(200);
        });
    }

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
