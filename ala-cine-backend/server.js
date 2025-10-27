const express = require('express');
const bodyParser = require('body-parser');
const paypal = require('paypal-rest-sdk');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const axios = require('axios');
const dotenv = require('dotenv');
const url = require('url');
const { MongoClient, ServerApiVersion } = require('mongodb');
const godstreamService = require('./GoodStreamServers.js');
const initializeBot = require('./bot.js');

const app = express();
dotenv.config();

const PORT = process.env.PORT || 3000;

// === CONFIGURACIONES ===
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SDK);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
const messaging = admin.messaging();

paypal.configure({
    'mode': process.env.PAYPAL_MODE || 'sandbox',
    'client_id': process.env.PAYPAL_CLIENT_ID,
    'client_secret': process.env.PAYPAL_CLIENT_SECRET
});

const token = process.env.TELEGRAM_BOT_TOKEN;
const GODSTREAM_API_KEY = process.env.GODSTREAM_API_KEY;
const RENDER_BACKEND_URL = process.env.RENDER_EXTERNAL_URL || 'https://serivisios.onrender.com';
const bot = new TelegramBot(token); // Creamos la instancia de bot aquí
const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT_ID, 10);
const TMDB_API_KEY = process.env.TMDB_API_KEY;

let GLOBAL_STREAMING_ACTIVE = true;

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

let mongoDb; // Declaramos mongoDb aquí

async function connectToMongo() {
    try {
        await client.connect();
        mongoDb = client.db(MONGO_DB_NAME); // Asignamos la conexión a la variable
        console.log(`✅ Conexión a MongoDB Atlas [${MONGO_DB_NAME}] exitosa!`);
        // +++ NUEVO: Devolvemos la instancia para asegurar que esté lista +++
        return mongoDb;
    } catch (e) {
        console.error("❌ Error al conectar a MongoDB Atlas:", e);
        process.exit(1);
    }
}

// === FUNCIÓN DE AYUDA MEJORADA PARA EXTRAER CÓDIGO ===
function extractGodStreamCode(text) {
    if (!text || typeof text !== 'string') { return text; }
    if (text.includes('goodstream.one/embed-')) {
        try {
            const parsedUrl = new URL(text);
            const pathname = parsedUrl.pathname;
            const parts = pathname.split('-');
            if (parts.length > 1) {
                return parts[parts.length - 1].replace('.html', '');
            }
        } catch (e) {
            console.error("Error al parsear URL de GodStream:", e.message);
            return text;
        }
    }
    if (!text.startsWith('<') && !text.startsWith('http')) { return text; }
    return text;
}

// === ESTADO DEL BOT ===
const adminState = {};

// === MIDDLEWARE ===
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { return res.sendStatus(200); }
    next();
});

// === RUTAS DEL SERVIDOR WEB (Sin cambios) ===
app.get('/', (req, res) => {
  res.send('¡El bot y el servidor de Sala Cine están activos!');
});

if (process.env.NODE_ENV === 'production') {
    app.post(`/bot${token}`, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });
}

app.get('/app/details/:tmdbId', (req, res) => {
    const tmdbId = req.params.tmdbId;
    if (process.env.APP_DOWNLOAD_URL) {
        console.log(`App Nativa no instalada o enlace no manejado. Redirigiendo a la Tienda Personalizada: ${process.env.APP_DOWNLOAD_URL}`);
        return res.redirect(302, process.env.APP_DOWNLOAD_URL);
    }
    if (process.env.TELEGRAM_MINIAPP_URL) {
        const tmaLink = process.env.TELEGRAM_MINIAPP_URL + '?startapp=' + tmdbId;
        console.log('APP_DOWNLOAD_URL no definida. Redirigiendo al fallback de la TMA.');
        return res.redirect(302, tmaLink);
    }
    console.error('Ni APP_DOWNLOAD_URL ni TELEGRAM_MINIAPP_URL están definidas en las variables de entorno.');
    res.status(404).send('No se encontró la aplicación de destino ni un enlace de descarga o fallback.');
});

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
        await bot.sendPhoto(ADMIN_CHAT_ID, posterUrl, {
            caption: message, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '✅ Agregar ahora', callback_data: `solicitud_${tmdbId}` }]] }
        });
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

app.get('/api/get-movie-data', async (req, res) => {
    // ... (sin cambios en esta ruta, ya estaba corregida)
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "El ID del contenido es requerido." });
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
            if (isAvailable) { return res.status(200).json({ views: views, likes: likes, isAvailable: true }); }
        }
        const movieProjection = { projection: { views: 1, likes: 1, freeEmbedCode: 1, proEmbedCode: 1 } };
        docMovie = await movieCollection.findOne({ tmdbId: id.toString() }, movieProjection);
        if (docMovie) {
            if (views === 0) views = docMovie.views || 0; if (likes === 0) likes = docMovie.likes || 0;
            isAvailable = !!(docMovie.freeEmbedCode || docMovie.proEmbedCode);
            return res.status(200).json({ views: views, likes: likes, isAvailable: isAvailable });
        }
        res.status(200).json({ views: views, likes: likes, isAvailable: false });
    } catch (error) {
        console.error(`Error crítico al obtener los datos consolidados en MongoDB:`, error);
        res.status(500).json({ error: "Error interno del servidor al obtener los datos." });
    }
});

app.get('/api/get-embed-code', async (req, res) => {
    // ... (sin cambios en esta ruta)
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });
    const { id, season, episode, isPro } = req.query;
    if (!id) return res.status(400).json({ error: "ID no proporcionado" });
    try {
        const mediaType = season && episode ? 'series' : 'movies';
        const collectionName = (mediaType === 'movies') ? 'media_catalog' : 'series_catalog';
        const doc = await mongoDb.collection(collectionName).findOne({ tmdbId: id });
        if (!doc) return res.status(404).json({ error: `${mediaType} no encontrada.` });
        let embedCode;
        if (mediaType === 'movies') { embedCode = isPro === 'true' ? doc.proEmbedCode : doc.freeEmbedCode; }
        else { const episodeData = doc.seasons?.[season]?.episodes?.[episode]; embedCode = isPro === 'true' ? episodeData?.proEmbedCode : episodeData?.freeEmbedCode; }
        if (!embedCode) return res.status(404).json({ error: `No se encontró código de reproductor.` });
        const isGodStreamCode = !embedCode.startsWith('<') && !embedCode.startsWith('http');
        if (isGodStreamCode) {
            const fileCode = embedCode;
            if (isPro === 'true') {
                const streamUrl = await godstreamService.getGodStreamLink(fileCode, GODSTREAM_API_KEY);
                return res.json({ embedCode: streamUrl });
            } else {
                const freeEmbedUrl = `https://goodstream.one/embed-${fileCode}.html`;
                return res.json({ embedCode: freeEmbedUrl });
            }
        } else { return res.json({ embedCode }); }
    } catch (error) { console.error("Error crítico get-embed-code:", error); res.status(500).json({ error: "Error interno" }); }
});

app.get('/api/check-season-availability', async (req, res) => {
    // ... (sin cambios en esta ruta)
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
    // ... (sin cambios en esta ruta)
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    const { id, field } = req.query;
    if (!id || !field || (field !== 'views' && field !== 'likes')) { return res.status(400).json({ error: "ID y campo ('views' o 'likes') requeridos." }); }
    try {
        let doc = await mongoDb.collection('media_catalog').findOne({ tmdbId: id.toString() }, { projection: { [field]: 1 } });
        if (!doc) doc = await mongoDb.collection('series_catalog').findOne({ tmdbId: id.toString() }, { projection: { [field]: 1 } });
        res.status(200).json({ count: doc?.[field] || 0 });
    } catch (error) { console.error(`Error get-metrics (${field}):`, error); res.status(500).json({ error: "Error interno." }); }
});

app.post('/api/increment-views', async (req, res) => {
    // ... (sin cambios en esta ruta)
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    const { tmdbId } = req.body; if (!tmdbId) return res.status(400).json({ error: "tmdbId requerido." });
    try {
        const update = { $inc: { views: 1 }, $setOnInsert: { likes: 0 } }; const options = { upsert: true };
        let result = await mongoDb.collection('media_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options);
        if (result.matchedCount === 0 && result.upsertedCount === 0) { await mongoDb.collection('series_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options); }
        res.status(200).json({ message: 'Vista registrada.' });
    } catch (error) { console.error("Error increment-views:", error); res.status(500).json({ error: "Error interno." }); }
});

app.post('/api/increment-likes', async (req, res) => {
    // ... (sin cambios en esta ruta)
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    const { tmdbId } = req.body; if (!tmdbId) return res.status(400).json({ error: "tmdbId requerido." });
    try {
        const update = { $inc: { likes: 1 }, $setOnInsert: { views: 0 } }; const options = { upsert: true };
        let result = await mongoDb.collection('media_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options);
        if (result.matchedCount === 0 && result.upsertedCount === 0) { await mongoDb.collection('series_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options); }
        res.status(200).json({ message: 'Like registrado.' });
    } catch (error) { console.error("Error increment-likes:", error); res.status(500).json({ error: "Error interno." }); }
});

app.post('/add-movie', async (req, res) => {
    // ... (sin cambios en esta ruta)
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    try {
        const { tmdbId, title, poster_path, freeEmbedCode, proEmbedCode, isPremium, overview } = req.body;
        if (!tmdbId) return res.status(400).json({ error: 'tmdbId requerido.' });
        const updateQuery = { $set: { title, poster_path, overview, freeEmbedCode, proEmbedCode, isPremium }, $setOnInsert: { tmdbId: tmdbId.toString(), views: 0, likes: 0 } };
        await mongoDb.collection('media_catalog').updateOne({ tmdbId: tmdbId.toString() }, updateQuery, { upsert: true });
        res.status(200).json({ message: 'Película agregada/actualizada.' });
    } catch (error) { console.error("Error add-movie:", error); res.status(500).json({ error: 'Error interno.' }); }
});

app.post('/add-series-episode', async (req, res) => {
    // ... (sin cambios en esta ruta)
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    try {
        const { tmdbId, title, poster_path, overview, seasonNumber, episodeNumber, freeEmbedCode, proEmbedCode, isPremium } = req.body;
        if (!tmdbId || !seasonNumber || !episodeNumber) return res.status(400).json({ error: 'tmdbId, seasonNumber y episodeNumber requeridos.' });
        const episodePath = `seasons.${seasonNumber}.episodes.${episodeNumber}`;
        const updateData = { $set: { title, poster_path, overview, isPremium, [`seasons.${seasonNumber}.name`]: `Temporada ${seasonNumber}`, [episodePath + '.freeEmbedCode']: freeEmbedCode, [episodePath + '.proEmbedCode']: proEmbedCode }, $setOnInsert: { tmdbId: tmdbId.toString(), views: 0, likes: 0 } };
        await mongoDb.collection('series_catalog').updateOne({ tmdbId: tmdbId.toString() }, updateData, { upsert: true });
        res.status(200).json({ message: `Episodio S${seasonNumber}E${episodeNumber} agregado/actualizado.` });
    } catch (error) { console.error("Error add-series-episode:", error); res.status(500).json({ error: 'Error interno.' }); }
});

app.post('/api/redeem-premium-time', async (req, res) => {
    // ... (sin cambios en esta ruta)
    const { userId, daysToAdd } = req.body; if (!userId || !daysToAdd) { return res.status(400).json({ success: false, error: 'userId y daysToAdd son requeridos.' }); }
    const days = parseInt(daysToAdd, 10); if (isNaN(days) || days <= 0) { return res.status(400).json({ success: false, error: 'daysToAdd debe ser un número positivo.' }); }
    try {
        const userDocRef = db.collection('users').doc(userId); const docSnap = await userDocRef.get(); let newExpiryDate; const now = new Date();
        if (docSnap.exists && docSnap.data().premiumExpiry) {
            let currentExpiry; const expiryData = docSnap.data().premiumExpiry;
            if (expiryData.toDate && typeof expiryData.toDate === 'function') { currentExpiry = expiryData.toDate(); }
            else if (typeof expiryData === 'number') { currentExpiry = new Date(expiryData); }
            else if (typeof expiryData === 'string') { currentExpiry = new Date(expiryData); }
            else { console.warn(`Formato de premiumExpiry inesperado para ${userId}. Iniciando desde ahora.`); currentExpiry = now; }
            if (currentExpiry > now) { newExpiryDate = new Date(currentExpiry.getTime() + days * 24 * 60 * 60 * 1000); }
            else { newExpiryDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000); }
        } else { newExpiryDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000); }
        await userDocRef.set({ isPro: true, premiumExpiry: newExpiryDate }, { merge: true });
        console.log(`✅ Premium activado/extendido para ${userId} hasta ${newExpiryDate.toISOString()}`);
        res.status(200).json({ success: true, message: `Premium activado por ${days} días.` });
    } catch (error) { console.error(`❌ Error al activar Premium para ${userId} via monedas:`, error); res.status(500).json({ success: false, error: 'Error interno del servidor al actualizar el estado del usuario.' }); }
});

app.post('/create-paypal-payment', (req, res) => {
    // ... (sin cambios en esta ruta)
    const plan = req.body.plan; const amount = (plan === 'annual') ? '19.99' : '1.99'; const userId = req.body.userId; if (!userId) return res.status(400).json({ error: "userId es requerido." });
    const create_payment_json = { "intent": "sale", "payer": { "payment_method": "paypal" }, "redirect_urls": { "return_url": `${RENDER_BACKEND_URL}/paypal/success`, "cancel_url": `${RENDER_BACKEND_URL}/paypal/cancel` }, "transactions": [{ "amount": { "currency": "USD", "total": amount }, "description": `Suscripción al plan ${plan} de Sala Cine`, "invoice_number": `${userId}|${plan}` }] };
    paypal.payment.create(create_payment_json, (error, payment) => {
        if (error) { console.error("Error PayPal create:", error.response ? error.response.details : error); res.status(500).json({ error: "Error creando pago PayPal." }); }
        else { const approvalUrl = payment.links.find(link => link.rel === 'approval_url'); if (approvalUrl) { res.json({ approval_url: approvalUrl.href }); } else { res.status(500).json({ error: "URL de aprobación no encontrada." }); } }
    });
});

app.get('/paypal/success', (req, res) => {
    // ... (sin cambios en esta ruta)
    const payerId = req.query.PayerID; const paymentId = req.query.paymentId; if (!payerId || !paymentId) return res.send('<html><body><h1>❌ ERROR: Faltan parámetros PayerID o paymentId.</h1></body></html>');
    paypal.payment.execute(paymentId, { "payer_id": payerId }, async (error, payment) => {
        if (error) { console.error("Error PayPal execute:", error.response ? error.response.details : error); return res.send('<html><body><h1>❌ ERROR: El pago no pudo ser procesado.</h1></body></html>'); }
        if (payment.state === 'approved' || payment.state === 'completed') {
            const invoice_number = payment.transactions?.[0]?.invoice_number; if (invoice_number) { const [userId, plan] = invoice_number.split('|'); if(userId && plan) { try { const userDocRef = db.collection('users').doc(userId); const docSnap = await userDocRef.get(); const daysToAdd = (plan === 'annual') ? 365 : 30; let newExpiryDate; const now = new Date(); if (docSnap.exists && docSnap.data().premiumExpiry) { let currentExpiry; const expiryData = docSnap.data().premiumExpiry; if (expiryData.toDate) currentExpiry = expiryData.toDate(); else if (typeof expiryData === 'number') currentExpiry = new Date(expiryData); else if (typeof expiryData === 'string') currentExpiry = new Date(expiryData); else currentExpiry = now; if (currentExpiry > now) { newExpiryDate = new Date(currentExpiry.getTime() + daysToAdd * 24 * 60 * 60 * 1000); } else { newExpiryDate = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000); } } else { newExpiryDate = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000); } await userDocRef.set({ isPro: true, premiumExpiry: newExpiryDate }, { merge: true }); res.send(`<html><body><h1>✅ ¡Pago Exitoso! Cuenta Premium (${plan}) Activada hasta ${newExpiryDate.toLocaleDateString()}.</h1><p>Vuelve a la aplicación.</p></body></html>`); } catch (dbError) { console.error("Error Firestore update:", dbError); res.send('<html><body><h1>⚠️ Advertencia: Pago recibido, pero la cuenta no se activó automáticamente. Contacta soporte.</h1></body></html>'); } } else { console.error("Error: userId o plan no encontrado en invoice_number de PayPal:", invoice_number); res.send('<html><body><h1>✅ ¡Pago Exitoso! Pero hubo un error al obtener tu ID o plan. Contacta a soporte para activar tu Premium.</h1></body></html>'); } } else { console.error("Error: invoice_number no encontrado en la transacción de PayPal."); res.send('<html><body><h1>✅ ¡Pago Exitoso! Pero hubo un error al obtener tu ID de usuario. Contacta a soporte para activar tu Premium.</h1></body></html>'); } } else { res.send(`<html><body><h1>❌ ERROR: El pago no fue aprobado (Estado: ${payment.state}).</h1></body></html>`); }
    });
});

app.get('/paypal/cancel', (req, res) => {
    // ... (sin cambios en esta ruta)
    res.send('<html><body><h1>Pago con PayPal cancelado.</h1></body></html>');
});

app.post('/create-binance-payment', (req, res) => {
    // ... (sin cambios en esta ruta)
    res.json({ message: 'Pago con Binance simulado.' });
});

async function sendPushNotification(tmdbId, mediaType, contentTitle) {
    // ... (sin cambios en esta función)
    try {
        const tokensSnapshot = await db.collection('users').select('fcmToken').get();
        const registrationTokens = tokensSnapshot.docs.map(doc => doc.data().fcmToken).filter(token => token);
        if (registrationTokens.length === 0) { console.log("No se encontraron tokens FCM."); return { success: true, message: "No hay tokens registrados." }; }
        const message = { notification: { title: `🎉 ¡Nuevo Contenido Agregado!`, body: `¡Ya puedes ver ${contentTitle} en Sala Cine!`, }, data: { tmdbId: tmdbId.toString(), mediaType: mediaType, action: 'open_content' }, tokens: registrationTokens };
        const response = await messaging.sendEachForMulticast(message);
        console.log('Notificación FCM enviada:', response.successCount, 'éxitos,', response.failureCount, 'fallos.');
        if (response.failureCount > 0) { const failedTokens = []; response.responses.forEach((resp, idx) => { if (!resp.success) { failedTokens.push(registrationTokens[idx]); console.error('Error enviando a token:', registrationTokens[idx], resp.error); } }); /* Lógica para eliminar failedTokens */ }
        return { success: true, response: response };
    } catch (error) { console.error("Error al enviar notificación FCM:", error); return { success: false, error: error.message }; }
}

app.post('/api/notify', async (req, res) => {
    // ... (sin cambios en esta ruta)
    const { tmdbId, mediaType, title } = req.body; if (!tmdbId || !mediaType || !title) { return res.status(400).json({ error: "Faltan tmdbId, mediaType o title." }); }
    try {
        const result = await sendPushNotification(tmdbId, mediaType, title);
        if (result.success) { res.status(200).json({ message: 'Notificaciones programadas.', details: result.response }); }
        else { res.status(500).json({ error: 'Error enviando notificaciones.', details: result.error }); }
    } catch (error) { console.error("Error en /api/notify:", error); res.status(500).json({ error: "Error interno." }); }
});

app.get('/api/app-update', (req, res) => {
    // ... (sin cambios en esta ruta)
    const updateInfo = { "latest_version_code": 4, "update_url": "https://google-play.onrender.com", "force_update": true, "update_message": "¡Nueva versión (1.4) disponible! Incluye TV en vivo y mejoras. Actualiza ahora." };
    res.status(200).json(updateInfo);
});

app.get('/api/app-status', (req, res) => {
    // ... (sin cambios en esta ruta)
    const status = { isAppApproved: true, safeContentIds: [11104, 539, 4555, 27205, 33045] };
    res.json(status);
});

app.get('/.well-known/assetlinks.json', (req, res) => {
    // ... (sin cambios en esta ruta)
    res.sendFile('assetlinks.json', { root: __dirname });
});

// =======================================================================
// === INICIO DEL SERVIDOR ===
// =======================================================================

// +++ NUEVO: Función async para iniciar todo +++
async function startServer() {
    // 1. Conectar a MongoDB y ESPERAR a que esté listo
    await connectToMongo();

    // 2. AHORA que mongoDb está definido, inicializar el bot
    initializeBot(
        bot,
        db, // Firestore sigue siendo de admin.firestore()
        mongoDb, // Pasamos la conexión MongoDB ya lista
        adminState,
        ADMIN_CHAT_ID,
        TMDB_API_KEY,
        RENDER_BACKEND_URL,
        axios,
        extractGodStreamCode
    );

    // 3. Iniciar el servidor Express
    app.listen(PORT, () => {
        console.log(`🚀 Servidor de backend Sala Cine iniciado en puerto ${PORT}`);
        // Manejo de reconexión (sin cambios)
        client.on('close', () => {
            console.warn('Conexión a MongoDB cerrada. Intentando reconectar...');
            setTimeout(connectToMongo, 5000);
        });
    });
}

// +++ NUEVO: Llamamos a la función async para empezar +++
startServer();

// --- Manejo de errores no capturados (Sin cambios) ---
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
