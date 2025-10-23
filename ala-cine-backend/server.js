const express = require('express');
const bodyParser = require('body-parser');
const paypal = require('paypal-rest-sdk');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const axios = require('axios');
const dotenv = require('dotenv');
const url = require('url');
const { MongoClient, ServerApiVersion } = require('mongodb'); // CONEXIÓN MONGO
const godstreamService = require('./GoodStreamServers.js'); // <<< [CAMBIO 1] IMPORTAMOS TU NUEVO ARCHIVO

const app = express();

dotenv.config();

const PORT = process.env.PORT || 3000;

// === CONFIGURACIONES ===
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SDK);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore(); // USADO PARA USUARIOS/PAGOS/SOLICITUDES/NOTIFICACIONES
const messaging = admin.messaging();

paypal.configure({
    'mode': 'sandbox', // Cambiar a 'live' en producción
    'client_id': process.env.PAYPAL_CLIENT_ID,
    'client_secret': process.env.PAYPAL_CLIENT_SECRET
});

const token = process.env.TELEGRAM_BOT_TOKEN;
const GODSTREAM_API_KEY = process.env.GODSTREAM_API_KEY;

const RENDER_BACKEND_URL = 'https://serivisios.onrender.com'; // Asegúrate que esta sea tu URL correcta
const bot = new TelegramBot(token);
const webhookUrl = `${RENDER_BACKEND_URL}/bot${token}`;
bot.setWebHook(webhookUrl);

const ADMIN_CHAT_ID = parseInt(process.env.ADMIN_CHAT_ID, 10);
const TMDB_API_KEY = process.env.TMDB_API_KEY;

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
    } catch (e) {
        console.error("❌ Error al conectar a MongoDB Atlas:", e);
        process.exit(1);
    }
}

connectToMongo();

// === [CAMBIO 2] FUNCIÓN DE AYUDA MEJORADA PARA EXTRAER CÓDIGO ===
function extractGodStreamCode(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }

    // Caso 1: El admin pegó la URL completa
    if (text.includes('goodstream.one/embed-')) {
        try {
            // Usamos new URL() para parsear de forma segura
            const parsedUrl = new URL(text);
            const pathname = parsedUrl.pathname; // -> /embed-gurkbeec2awc.html
            const parts = pathname.split('-');   // -> ['/embed', 'gurkbeec2awc.html']
            if (parts.length > 1) {
                return parts[parts.length - 1].replace('.html', ''); // -> 'gurkbeec2awc'
            }
        } catch (e) {
            console.error("Error al parsear URL de GodStream:", e.message);
            return text; // Devolver original si falla el parseo
        }
    }
    
    // Caso 2: El admin pegó solo el código (o es un iframe/otra URL)
    // Si NO es un iframe y NO es una http URL, asumimos que es un código de GodStream
    if (!text.startsWith('<') && !text.startsWith('http')) {
         return text; // Asume que es un file_code (ej: 'gurkbeec2awc')
    }

    // Caso 3: Es un iframe u otra URL (Dood, Voe, etc.)
    return text;
}
// === FIN CONFIGURACIÓN DE MONGODB ===


// === CONFIGURACIÓN DE ATJOS DEL BOT ===
bot.setMyCommands([
    { command: 'start', description: 'Reiniciar el bot y ver el menú principal' },
    { command: 'subir', description: 'Subir una película o serie a la base de datos' },
    { command: 'editar', description: 'Editar los enlaces de una película o serie existente' },
    { command: 'pedidos', description: 'Ver la lista de películas solicitadas por los usuarios' }
]);

const adminState = {};

// === MIDDLEWARE ===
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Configuración básica de CORS
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Permite cualquier origen
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); // Métodos permitidos
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Cabeceras permitidas

    // Manejar preflight requests (OPTIONS)
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// === RUTAS DEL SERVIDOR WEB ===
app.get('/', (req, res) => {
  res.send('¡El bot y el servidor de Sala Cine están activos!');
});

// Ruta para procesar actualizaciones del bot
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// -------------------------------------------------------------------------
// === RUTA CRÍTICA: MANEJO DE APP LINK Y REDIRECCIÓN DE FALLO ===
// -------------------------------------------------------------------------

app.get('/app/details/:tmdbId', (req, res) => {
    const tmdbId = req.params.tmdbId;

    // Prioridad 1: Intentar redirigir a la URL de descarga personalizada si está definida
    if (process.env.APP_DOWNLOAD_URL) {
        console.log(`App Nativa no instalada o enlace no manejado. Redirigiendo a la Tienda Personalizada: ${process.env.APP_DOWNLOAD_URL}`);
        return res.redirect(302, process.env.APP_DOWNLOAD_URL);
    }

    // Prioridad 2: Fallback a la Telegram Mini App si la URL de descarga no está definida
    if (process.env.TELEGRAM_MINIAPP_URL) {
        const tmaLink = process.env.TELEGRAM_MINIAPP_URL + '?startapp=' + tmdbId;
        console.log('APP_DOWNLOAD_URL no definida. Redirigiendo al fallback de la TMA.');
        return res.redirect(302, tmaLink);
    }

    // Si ninguna URL está definida, devolver un error
    console.error('Ni APP_DOWNLOAD_URL ni TELEGRAM_MINIAPP_URL están definidas en las variables de entorno.');
    res.status(404).send('No se encontró la aplicación de destino ni un enlace de descarga o fallback.');
});

// -----------------------------------------------------------
// === RUTA PARA RECIBIR SOLICITUDES DESDE LA APP ===
// -----------------------------------------------------------
app.post('/request-movie', async (req, res) => {
    const { title, poster_path, tmdbId, priority } = req.body; // Se añade 'priority'
    const posterUrl = poster_path ? `https://image.tmdb.org/t/p/w500${poster_path}` : 'https://placehold.co/500x750?text=No+Poster';

    // Construir mensaje más detallado
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
        // Enviar notificación al admin por Telegram
        await bot.sendPhoto(ADMIN_CHAT_ID, posterUrl, {
            caption: message,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{
                    text: '✅ Agregar ahora',
                    callback_data: `solicitud_${tmdbId}` // Callback para iniciar el flujo de adición
                }]]
            }
        });

        // Opcional: Guardar la solicitud en Firestore (si quieres mantener un historial)
        // await db.collection('userRequests').add({ // Cambiado a 'userRequests' para claridad
        //     tmdbId: tmdbId,
        //     title: title,
        //     userId: req.body.userId, // Asegúrate que la app envíe userId si guardas
        //     priority: priority,
        //     status: 'pending',
        //     requestedAt: admin.firestore.FieldValue.serverTimestamp()
        // });

        res.status(200).json({ message: 'Solicitud enviada al administrador.' });
    } catch (error) {
        console.error("Error al procesar la solicitud:", error);
        res.status(500).json({ error: 'Error al enviar la notificación o guardar la solicitud.' });
    }
});


// =======================================================================
// === RUTA OPTIMIZADA PARA OBTENER DATOS DE PELÍCULA/SERIE (MongoDB) ===
// =======================================================================
app.get('/api/get-movie-data', async (req, res) => {
    if (!mongoDb) {
        return res.status(503).json({ error: "Base de datos no disponible." });
    }
    const { id } = req.query;
    if (!id) {
        return res.status(400).json({ error: "El ID del contenido es requerido." });
    }
    try {
        const movieCollection = mongoDb.collection('media_catalog');
        const seriesCollection = mongoDb.collection('series_catalog');
        const movieProjection = { projection: { views: 1, likes: 1, freeEmbedCode: 1, proEmbedCode: 1 } };
        const seriesProjection = { projection: { views: 1, likes: 1, seasons: 1 } };

        let isMovie = true;
        let doc = await movieCollection.findOne({ tmdbId: id.toString() }, movieProjection);
        if (!doc) {
            isMovie = false;
            doc = await seriesCollection.findOne({ tmdbId: id.toString() }, seriesProjection);
        }

        if (doc) {
            let isAvailable = false;
            if (isMovie) {
                isAvailable = !!(doc.freeEmbedCode || doc.proEmbedCode);
            } else {
                if (doc.seasons) {
                    isAvailable = Object.values(doc.seasons).some(season =>
                        season && season.episodes && Object.values(season.episodes).some(ep =>
                            (ep.freeEmbedCode && ep.freeEmbedCode !== '') ||
                            (ep.proEmbedCode && ep.proEmbedCode !== '')
                        )
                    );
                }
            }
            res.status(200).json({
                views: doc.views || 0,
                likes: doc.likes || 0,
                isAvailable: isAvailable
            });
        } else {
            res.status(200).json({ views: 0, likes: 0, isAvailable: false });
        }
    } catch (error) {
        console.error(`Error crítico al obtener los datos consolidados en MongoDB:`, error);
        res.status(500).json({ error: "Error interno del servidor al obtener los datos." });
    }
});

// =======================================================================
// === [CAMBIO 3] RUTA PARA OBTENER CÓDIGO EMBED (CON LÓGICA PRO/FREE Y FALLBACK) ===
// =======================================================================
app.get('/api/get-embed-code', async (req, res) => {
  if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });
  
  const { id, season, episode, isPro } = req.query; // isPro viene como 'true' o 'false' (string)
  if (!id) return res.status(400).json({ error: "ID no proporcionado" });

  try {
    const mediaType = season && episode ? 'series' : 'movies';
    const collectionName = (mediaType === 'movies') ? 'media_catalog' : 'series_catalog';
    const doc = await mongoDb.collection(collectionName).findOne({ tmdbId: id });

    if (!doc) return res.status(404).json({ error: `${mediaType} no encontrada.` });

    // 1. Obtener el código/iframe de la base de datos
    let embedCode;
    if (mediaType === 'movies') {
        embedCode = isPro === 'true' ? doc.proEmbedCode : doc.freeEmbedCode;
    } else {
        const episodeData = doc.seasons?.[season]?.episodes?.[episode];
        embedCode = isPro === 'true' ? episodeData?.proEmbedCode : episodeData?.freeEmbedCode;
    }

    if (!embedCode) {
        return res.status(404).json({ error: `No se encontró código de reproductor.` });
    }

    // 2. Comprobar si es un código de GodStream
    // (Asumimos que es GodStream si NO es un iframe y NO es una URL completa)
    const isGodStreamCode = !embedCode.startsWith('<') && !embedCode.startsWith('http');

    // 3. Aplicar la lógica de PRO vs GRATIS
    if (isGodStreamCode) {
        const fileCode = embedCode; // ej: 'gurkbeec2awc'

        if (isPro === 'true') {
            // --- Lógica PREMIUM ---
            // Llama al servicio, que ya maneja el fallback
            // Usamos la función importada de GoodStreamServers.js
            const streamUrl = await godstreamService.getGodStreamLink(fileCode, GODSTREAM_API_KEY);
            return res.json({ embedCode: streamUrl }); // Devuelve MP4 o Embed (fallback)

        } else {
            // --- Lógica GRATIS ---
            // Devuelve solo el reproductor embed, sin llamar a la API
            const freeEmbedUrl = `https://goodstream.one/embed-${fileCode}.html`;
            return res.json({ embedCode: freeEmbedUrl });
        }
        
    } else {
        // --- Lógica para otros reproductores (IFRAMEs, etc.) ---
        // Si no es GodStream (ej: un <iframe>), devuélvelo tal cual
        return res.json({ embedCode });
    }

  } catch (error) {
    console.error("Error crítico get-embed-code:", error);
    res.status(500).json({ error: "Error interno" });
  }
});


// =======================================================================
// === RUTA PARA VERIFICAR DISPONIBILIDAD DE TEMPORADA (MongoDB) ===
// =======================================================================
app.get('/api/check-season-availability', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "Base de datos no disponible." });
    const { id, season } = req.query;
    if (!id || !season) return res.status(400).json({ error: "ID y temporada son requeridos." });

    try {
        const seriesCollection = mongoDb.collection('series_catalog');
        const episodesField = `seasons.${season}.episodes`;
        const doc = await seriesCollection.findOne(
            { tmdbId: id.toString() },
            { projection: { [episodesField]: 1 } }
        );

        if (!doc?.seasons?.[season]?.episodes) {
            return res.status(200).json({ exists: false, availableEpisodes: {} });
        }

        const episodesData = doc.seasons[season].episodes;
        const availabilityMap = {};
        for (const episodeNum in episodesData) {
            const ep = episodesData[episodeNum];
            availabilityMap[episodeNum] = !!(ep.proEmbedCode || ep.freeEmbedCode);
        }
        res.status(200).json({ exists: true, availableEpisodes: availabilityMap });
    } catch (error) {
        console.error("Error check-season-availability:", error);
        res.status(500).json({ error: "Error interno." });
    }
});


// =======================================================================
// === RUTAS DE MÉTRICAS (Vistas y Likes - MongoDB) ===
// =======================================================================
// --- Obtener Métrica ---
app.get('/api/get-metrics', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    const { id, field } = req.query;
    if (!id || !field || (field !== 'views' && field !== 'likes')) {
        return res.status(400).json({ error: "ID y campo ('views' o 'likes') requeridos." });
    }
    try {
        let doc = await mongoDb.collection('media_catalog').findOne({ tmdbId: id.toString() }, { projection: { [field]: 1 } });
        if (!doc) doc = await mongoDb.collection('series_catalog').findOne({ tmdbId: id.toString() }, { projection: { [field]: 1 } });
        res.status(200).json({ count: doc?.[field] || 0 });
    } catch (error) {
        console.error(`Error get-metrics (${field}):`, error);
        res.status(500).json({ error: "Error interno." });
    }
});

// --- Incrementar Vistas ---
app.post('/api/increment-views', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    const { tmdbId } = req.body;
    if (!tmdbId) return res.status(400).json({ error: "tmdbId requerido." });
    try {
        const update = { $inc: { views: 1 }, $setOnInsert: { likes: 0 } };
        const options = { upsert: true };
        let result = await mongoDb.collection('media_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options);
        if (result.matchedCount === 0 && result.upsertedCount === 0) { // Si no era película y no se insertó
            await mongoDb.collection('series_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options);
        }
        res.status(200).json({ message: 'Vista registrada.' });
    } catch (error) {
        console.error("Error increment-views:", error);
        res.status(500).json({ error: "Error interno." });
    }
});

// --- Incrementar Likes ---
app.post('/api/increment-likes', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    const { tmdbId } = req.body;
    if (!tmdbId) return res.status(400).json({ error: "tmdbId requerido." });
    try {
        const update = { $inc: { likes: 1 }, $setOnInsert: { views: 0 } };
        const options = { upsert: true };
        let result = await mongoDb.collection('media_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options);
        if (result.matchedCount === 0 && result.upsertedCount === 0) {
            await mongoDb.collection('series_catalog').updateOne({ tmdbId: tmdbId.toString() }, update, options);
        }
        res.status(200).json({ message: 'Like registrado.' });
    } catch (error) {
        console.error("Error increment-likes:", error);
        res.status(500).json({ error: "Error interno." });
    }
});

// =======================================================================
// === RUTAS PARA AGREGAR/ACTUALIZAR CONTENIDO (MongoDB) ===
// =======================================================================
// --- Agregar/Actualizar Película ---
app.post('/add-movie', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    try {
        const { tmdbId, title, poster_path, freeEmbedCode, proEmbedCode, isPremium, overview } = req.body;
        if (!tmdbId) return res.status(400).json({ error: 'tmdbId requerido.' });
        const updateQuery = {
            $set: { title, poster_path, overview, freeEmbedCode, proEmbedCode, isPremium },
            $setOnInsert: { tmdbId: tmdbId.toString(), views: 0, likes: 0 }
        };
        await mongoDb.collection('media_catalog').updateOne({ tmdbId: tmdbId.toString() }, updateQuery, { upsert: true });
        res.status(200).json({ message: 'Película agregada/actualizada.' });
    } catch (error) {
        console.error("Error add-movie:", error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

// --- Agregar/Actualizar Episodio de Serie ---
app.post('/add-series-episode', async (req, res) => {
    if (!mongoDb) return res.status(503).json({ error: "BD no disponible." });
    try {
        const { tmdbId, title, poster_path, overview, seasonNumber, episodeNumber, freeEmbedCode, proEmbedCode, isPremium } = req.body;
        if (!tmdbId || !seasonNumber || !episodeNumber) return res.status(400).json({ error: 'tmdbId, seasonNumber y episodeNumber requeridos.' });

        const episodePath = `seasons.${seasonNumber}.episodes.${episodeNumber}`;
        const updateData = {
            $set: { title, poster_path, overview, isPremium,
                    [`seasons.${seasonNumber}.name`]: `Temporada ${seasonNumber}`, // Asegura que exista el objeto season
                    [episodePath + '.freeEmbedCode']: freeEmbedCode,
                    [episodePath + '.proEmbedCode']: proEmbedCode },
            $setOnInsert: { tmdbId: tmdbId.toString(), views: 0, likes: 0 }
        };
        await mongoDb.collection('series_catalog').updateOne({ tmdbId: tmdbId.toString() }, updateData, { upsert: true });
        res.status(200).json({ message: `Episodio S${seasonNumber}E${episodeNumber} agregado/actualizado.` });
    } catch (error) {
        console.error("Error add-series-episode:", error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

// =======================================================================
// === ¡NUEVA RUTA PARA ACTIVAR PREMIUM CON MONEDAS! ===
// =======================================================================
app.post('/api/redeem-premium-time', async (req, res) => {
    const { userId, daysToAdd } = req.body;

    // Validación básica
    if (!userId || !daysToAdd) {
        return res.status(400).json({ success: false, error: 'userId y daysToAdd son requeridos.' });
    }

    const days = parseInt(daysToAdd, 10);
    if (isNaN(days) || days <= 0) {
        return res.status(400).json({ success: false, error: 'daysToAdd debe ser un número positivo.' });
    }

    try {
        // Referencia al documento del usuario en Firestore (donde está 'isPro')
        // Usamos 'db' que es tu instancia global de admin.firestore()
        const userDocRef = db.collection('users').doc(userId);

        // Actualizar el estado a Premium
        // Usamos set con merge:true para crear el documento si no existe,
        // o para actualizar solo el campo 'isPro' si ya existe sin borrar otros campos.
        await userDocRef.set({
            isPro: true
            // Opcional: Podrías calcular y guardar una fecha de expiración si lo necesitas más adelante
            // premiumExpiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000))
        }, { merge: true });

        console.log(`✅ Usuario ${userId} actualizado a Premium por ${days} días via monedas.`);
        // Respondemos con éxito a la app
        res.status(200).json({ success: true, message: `Premium activado por ${days} días.` });

    } catch (error) {
        console.error(`❌ Error al activar Premium para ${userId} via monedas:`, error);
        // Respondemos con error a la app
        res.status(500).json({ success: false, error: 'Error interno del servidor al actualizar el estado del usuario.' });
    }
});
// =======================================================================
// === FIN DE LA NUEVA RUTA ===
// =======================================================================


// =======================================================================
// === RUTAS PAYPAL (Usan Firestore para estado PRO) ===
// =======================================================================
app.post('/create-paypal-payment', (req, res) => {
    const plan = req.body.plan;
    const amount = (plan === 'annual') ? '19.99' : '1.99';
    const userId = req.body.userId; // ID de Firebase Auth
    if (!userId) return res.status(400).json({ error: "userId es requerido." });

    const create_payment_json = {
        "intent": "sale",
        "payer": { "payment_method": "paypal" },
        "redirect_urls": {
            "return_url": `${RENDER_BACKEND_URL}/paypal/success`,
            "cancel_url": `${RENDER_BACKEND_URL}/paypal/cancel`
        },
        "transactions": [{
            "amount": { "currency": "USD", "total": amount },
            "description": `Suscripción al plan ${plan} de Sala Cine`,
            "invoice_number": userId // Guarda userId aquí
        }]
    };

    paypal.payment.create(create_payment_json, (error, payment) => {
        if (error) {
            console.error("Error PayPal create:", error.response);
            res.status(500).json({ error: "Error creando pago PayPal." });
        } else {
            const approvalUrl = payment.links.find(link => link.rel === 'approval_url');
            if (approvalUrl) {
                res.json({ approval_url: approvalUrl.href });
            } else {
                res.status(500).json({ error: "URL de aprobación no encontrada." });
            }
        }
    });
});

app.get('/paypal/success', (req, res) => {
    const payerId = req.query.PayerID;
    const paymentId = req.query.paymentId;
    if (!payerId || !paymentId) return res.send('<html><body><h1>❌ ERROR: Faltan parámetros PayerID o paymentId.</h1></body></html>');

    paypal.payment.execute(paymentId, { "payer_id": payerId }, async (error, payment) => {
        if (error) {
            console.error("Error PayPal execute:", error.response);
            return res.send('<html><body><h1>❌ ERROR: El pago no pudo ser procesado.</h1></body></html>');
        }

        if (payment.state === 'approved' || payment.state === 'completed') {
            const userId = payment.transactions?.[0]?.invoice_number; // Recupera userId
            if (userId) {
                try {
                    // FIREBASE: Actualiza el estado PRO
                    const userDocRef = db.collection('users').doc(userId);
                    await userDocRef.set({ isPro: true }, { merge: true });
                    res.send('<html><body><h1>✅ ¡Pago Exitoso! Cuenta Premium Activada.</h1><p>Vuelve a la aplicación.</p></body></html>');
                } catch (dbError) {
                    console.error("Error Firestore update:", dbError);
                    res.send('<html><body><h1>⚠️ Advertencia: Pago recibido, pero la cuenta no se activó automáticamente. Contacta soporte.</h1></body></html>');
                }
            } else {
                 console.error("Error: userId no encontrado en la transacción de PayPal.");
                 res.send('<html><body><h1>✅ ¡Pago Exitoso! Pero hubo un error al obtener tu ID. Contacta a soporte para activar tu Premium.</h1></body></html>');
            }
        } else {
            res.send(`<html><body><h1>❌ ERROR: El pago no fue aprobado (Estado: ${payment.state}).</h1></body></html>`);
        }
    });
});

app.get('/paypal/cancel', (req, res) => {
    res.send('<html><body><h1>Pago con PayPal cancelado.</h1></body></html>');
});

// Ruta simulada para Binance
app.post('/create-binance-payment', (req, res) => {
    res.json({ message: 'Pago con Binance simulado.' });
});

// =======================================================================
// === NOTIFICACIONES PUSH (Firebase Messaging) ===
// =======================================================================
async function sendPushNotification(tmdbId, mediaType, contentTitle) {
    try {
        // Obtener tokens FCM desde Firestore (colección 'users')
        const tokensSnapshot = await db.collection('users').select('fcmToken').get();
        const registrationTokens = tokensSnapshot.docs
            .map(doc => doc.data().fcmToken)
            .filter(token => token); // Filtrar tokens vacíos o nulos

        if (registrationTokens.length === 0) {
            console.log("No se encontraron tokens FCM.");
            return { success: true, message: "No hay tokens registrados." };
        }

        const message = {
            notification: {
                title: `🎉 ¡Nuevo Contenido Agregado!`,
                body: `¡Ya puedes ver ${contentTitle} en Sala Cine!`,
            },
            data: { // Datos adicionales para manejar la acción en la app
                tmdbId: tmdbId.toString(),
                mediaType: mediaType,
                action: 'open_content' // Acción personalizada
            },
            tokens: registrationTokens // Array de tokens a los que enviar
        };

        // Enviar el mensaje a múltiples dispositivos
        const response = await messaging.sendEachForMulticast(message);
        console.log('Notificación FCM enviada:', response.successCount, 'éxitos,', response.failureCount, 'fallos.');
        
        // Opcional: Manejar tokens inválidos/desactualizados si hay fallos
        if (response.failureCount > 0) {
            const failedTokens = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    failedTokens.push(registrationTokens[idx]);
                    // Podrías eliminar estos tokens de tu base de datos aquí
                    console.error('Error enviando a token:', registrationTokens[idx], resp.error);
                }
            });
            // Lógica para eliminar failedTokens de Firestore...
        }

        return { success: true, response: response };

    } catch (error) {
        console.error("Error al enviar notificación FCM:", error);
        return { success: false, error: error.message };
    }
}

// --- Endpoint para Disparar Notificaciones Push ---
app.post('/api/notify', async (req, res) => {
    const { tmdbId, mediaType, title } = req.body;
    if (!tmdbId || !mediaType || !title) {
        return res.status(400).json({ error: "Faltan tmdbId, mediaType o title." });
    }
    try {
        const result = await sendPushNotification(tmdbId, mediaType, title);
        if (result.success) {
            res.status(200).json({ message: 'Notificaciones programadas.', details: result.response });
        } else {
            res.status(500).json({ error: 'Error enviando notificaciones.', details: result.error });
        }
    } catch (error) {
        console.error("Error en /api/notify:", error);
        res.status(500).json({ error: "Error interno." });
    }
});

// =======================================================================
// === LÓGICA DEL BOT DE TELEGRAM (Adaptada para MongoDB) ===
// =======================================================================
// === LÓGICA DEL BOT DE TELEGRAM ===
bot.onText(/\/start|\/subir/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_CHAT_ID) {
        bot.sendMessage(chatId, 'Lo siento, no tienes permiso para usar este bot.');
        return;
    }
    adminState[chatId] = { step: 'menu' };
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Agregar películas', callback_data: 'add_movie' }],
                [{ text: 'Agregar series', callback_data: 'add_series' }],
                [{ text: 'Eventos', callback_data: 'eventos' }], 
                [{ text: 'Gestionar películas', callback_data: 'manage_movies' }],
                [{ text: 'Eliminar película', callback_data: 'delete_movie' }]
            ]
        }
    };
    bot.sendMessage(chatId, '¡Hola! ¿Qué quieres hacer hoy?', options);
});


bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userText = msg.text;
    if (chatId !== ADMIN_CHAT_ID || !userText || userText.startsWith('/')) { // Añadido chequeo !userText
        return;
    }

    if (adminState[chatId] && adminState[chatId].step === 'search_movie') {
        try {
            const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(userText)}&language=es-ES`;
            const response = await axios.get(searchUrl);
            const data = response.data;
            if (data.results && data.results.length > 0) {
                const results = data.results.slice(0, 5);
                
                for (const item of results) {
                    const existingMovie = await mongoDb.collection('media_catalog').findOne({ tmdbId: item.id.toString() });
                    const existingData = existingMovie || null;

                    const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                    const title = item.title || item.name;
                    const date = item.release_date || item.first_air_date;
                    const message = `🎬 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${item.overview || 'Sin sinopsis disponible.'}`;
                    
                    let buttons = [[{ text: existingData ? '✅ Gestionar' : '✅ Agregar', callback_data: `${existingData ? 'manage_movie' : 'add_new_movie'}_${item.id}` }]];

                    const options = { caption: message, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } };
                    bot.sendPhoto(chatId, posterUrl, options);
                }
            } else { bot.sendMessage(chatId, `No se encontraron resultados. Intenta de nuevo.`); }
        } catch (error) {
            console.error("Error buscando en TMDB (movie):", error);
            bot.sendMessage(chatId, 'Error buscando. Intenta de nuevo.');
        }
    } else if (adminState[chatId] && adminState[chatId].step === 'search_series') {
        try {
            const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(userText)}&language=es-ES`;
            const response = await axios.get(searchUrl);
            const data = response.data;
            if (data.results && data.results.length > 0) {
                const results = data.results.slice(0, 5);
                
                for (const item of results) {
                    const existingSeries = await mongoDb.collection('series_catalog').findOne({ tmdbId: item.id.toString() });
                    const existingData = existingSeries || null;

                    const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                    const title = item.title || item.name;
                    const date = item.first_air_date;
                    const message = `🎬 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${item.overview || 'Sin sinopsis disponible.'}`;
                    
                    let buttons = [[{ text: existingData ? '✅ Gestionar' : '✅ Agregar', callback_data: `${existingData ? 'manage_series' : 'add_new_series'}_${item.id}` }]];

                    const options = { caption: message, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } };
                    bot.sendPhoto(chatId, posterUrl, options);
                }
            } else { bot.sendMessage(chatId, `No se encontraron resultados. Intenta de nuevo.`); }
        } catch (error) {
            console.error("Error buscando en TMDB (series):", error);
            bot.sendMessage(chatId, 'Error buscando. Intenta de nuevo.');
        }
    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_event_image') {
        if (!userText.startsWith('http')) {
            bot.sendMessage(chatId, '❌ Envía un ENLACE (URL) de imagen válido.'); return;
        }
        adminState[chatId].imageUrl = userText;
        adminState[chatId].step = 'awaiting_event_description';
        bot.sendMessage(chatId, 'Enlace recibido! Ahora envía la DESCRIPCIÓN.');
    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_event_description') {
        const { imageUrl } = adminState[chatId];
        const description = userText;
        try {
            await db.collection('userNotifications').add({
                title: '🎉 Nuevo Evento', description: description, image: imageUrl,
                timestamp: admin.firestore.FieldValue.serverTimestamp(), isRead: false, type: 'event', targetScreen: 'profile-screen'
            });
            bot.sendMessage(chatId, '✅ Evento guardado y listo para notificar.');
        } catch (error) {
            console.error("Error guardando evento:", error);
            bot.sendMessage(chatId, '❌ Error guardando. Revisa logs.');
        } finally { adminState[chatId] = { step: 'menu' }; }
    
    // === [CAMBIO 4] LÓGICA DEL BOT ACTUALIZADA ===
    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_pro_link_movie') {
        const { selectedMedia } = adminState[chatId];
        // Usamos la nueva función extractGodStreamCode
        adminState[chatId].proEmbedCode = userText.toLowerCase() === 'no' ? null : extractGodStreamCode(userText);
        adminState[chatId].step = 'awaiting_free_link_movie';
        bot.sendMessage(chatId, `PRO recibido (${adminState[chatId].proEmbedCode ? 'Link/Código' : 'Ninguno'}). Ahora envía el GRATIS para "${selectedMedia.title}". Escribe "no" si no hay.`);
    
    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_free_link_movie') {
        const { selectedMedia, proEmbedCode } = adminState[chatId];
        if (!selectedMedia?.id) {
            bot.sendMessage(chatId, '❌ ERROR: ID perdido. Reinicia con /subir.');
            adminState[chatId] = { step: 'menu' }; return;
        }
        // Usamos la nueva función extractGodStreamCode
        const freeEmbedCode = userText.toLowerCase() === 'no' ? null : extractGodStreamCode(userText);

        // Validación: Al menos un link debe existir
        if (!proEmbedCode && !freeEmbedCode) {
            bot.sendMessage(chatId, '❌ Debes proporcionar al menos un reproductor (PRO o GRATIS). Reinicia el proceso.');
            adminState[chatId] = { step: 'menu' }; return;
        }

        adminState[chatId].movieDataToSave = {
            tmdbId: selectedMedia.id.toString(), title: selectedMedia.title, overview: selectedMedia.overview, poster_path: selectedMedia.poster_path,
            proEmbedCode: proEmbedCode, freeEmbedCode: freeEmbedCode, isPremium: !!proEmbedCode && !freeEmbedCode
        };
        adminState[chatId].step = 'awaiting_publish_choice';
        const options = { reply_markup: { inline_keyboard: [
            [{ text: '💾 Guardar solo', callback_data: `save_only_${selectedMedia.id}` }],
            [{ text: '🚀 Guardar y Publicar', callback_data: `save_and_publish_${selectedMedia.id}` }]
        ]}};
        bot.sendMessage(chatId, `GRATIS recibido (${freeEmbedCode ? 'Link/Código' : 'Ninguno'}). ¿Qué hacer ahora?`, options);
    
    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_pro_link_series') {
        const { selectedSeries, season, episode } = adminState[chatId];
        if (!selectedSeries) {
            bot.sendMessage(chatId, 'Error: Estado perdido. Reinicia.'); adminState[chatId] = { step: 'menu' }; return;
        }
        // Usamos la nueva función extractGodStreamCode
        adminState[chatId].proEmbedCode = userText.toLowerCase() === 'no' ? null : extractGodStreamCode(userText);
        adminState[chatId].step = 'awaiting_free_link_series';
        bot.sendMessage(chatId, `PRO recibido (${adminState[chatId].proEmbedCode ? 'Link/Código' : 'Ninguno'}). Envía el GRATIS para S${season}E${episode}. Escribe "no" si no hay.`);
    
    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_free_link_series') {
        const { selectedSeries, season, episode, proEmbedCode } = adminState[chatId];
        if (!selectedSeries) {
            bot.sendMessage(chatId, 'Error: Estado perdido. Reinicia.'); adminState[chatId] = { step: 'menu' }; return;
        }
        // Usamos la nueva función extractGodStreamCode
        const freeEmbedCode = userText.toLowerCase() === 'no' ? null : extractGodStreamCode(userText);

        // Validación: Al menos un link
        if (!proEmbedCode && !freeEmbedCode) {
            bot.sendMessage(chatId, '❌ Debes dar al menos un reproductor (PRO o GRATIS). Reinicia.');
            adminState[chatId] = { step: 'menu' }; return;
        }

        const seriesDataToSave = {
            tmdbId: (selectedSeries.tmdbId || selectedSeries.id).toString(), title: selectedSeries.title || selectedSeries.name, poster_path: selectedSeries.poster_path,
            seasonNumber: season, episodeNumber: episode, overview: selectedSeries.overview, // Añadido overview
            proEmbedCode: proEmbedCode, freeEmbedCode: freeEmbedCode, isPremium: !!proEmbedCode && !freeEmbedCode
        };

        try {
            await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, seriesDataToSave);
            bot.sendMessage(chatId, `✅ Episodio S${season}E${episode} guardado.`);

            // Opción de publicar y notificar solo si es el primer episodio O si lo decides
            // Aquí simplificamos: siempre preguntamos después de guardar
            const nextEpisodeNumber = episode + 1;
            const options = { reply_markup: { inline_keyboard: [
                [{ text: `➡️ Agregar S${season}E${nextEpisodeNumber}`, callback_data: `add_next_episode_${seriesDataToSave.tmdbId}_${season}` }],
                [{ text: `🚀 Publicar S${season}E${episode} y Finalizar`, callback_data: `publish_this_episode_${seriesDataToSave.tmdbId}_${season}_${episode}` }], // Nueva opción
                [{ text: '⏹️ Finalizar sin publicar', callback_data: `finish_series_${seriesDataToSave.tmdbId}` }]
            ]}};
            bot.sendMessage(chatId, '¿Qué quieres hacer ahora?', options);
            adminState[chatId] = { step: 'awaiting_series_action', lastSavedEpisodeData: seriesDataToSave }; // Guardamos datos del último ep

        } catch (error) {
            console.error("Error guardando episodio:", error);
            bot.sendMessage(chatId, 'Error guardando episodio.');
        }
    // === FIN DEL CAMBIO 4 ===
    
    } else if (adminState[chatId] && adminState[chatId].step === 'search_delete') {
          try {
            const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(userText)}&language=es-ES`;
            const response = await axios.get(searchUrl);
            const data = response.data;
            if (data.results?.length > 0) {
                const results = data.results.slice(0, 5).filter(m => m.media_type === 'movie' || m.media_type === 'tv');
                if (results.length === 0) { bot.sendMessage(chatId, `No se encontraron películas o series.`); return; }
                
                for (const item of results) {
                    const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                    const title = item.title || item.name;
                    const date = item.release_date || item.first_air_date;
                    const message = `🎬 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${item.overview || 'Sin sinopsis.'}`;
                    const options = { caption: message, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{
                        text: '🗑️ Confirmar Eliminación', callback_data: `delete_confirm_${item.id}_${item.media_type}`
                    }]]}};
                    bot.sendPhoto(chatId, posterUrl, options);
                }
            } else { bot.sendMessage(chatId, `No se encontraron resultados.`); }
        } catch (error) {
            console.error("Error buscando para eliminar:", error);
            bot.sendMessage(chatId, 'Error buscando.');
        }
    }
});

bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_CHAT_ID) return;

    // --- Manejo de Callbacks ---
    try { // Envolver todo en try-catch general
        bot.answerCallbackQuery(callbackQuery.id); // Confirmar recepción

        if (data === 'add_movie') {
            adminState[chatId] = { step: 'search_movie' };
            bot.sendMessage(chatId, 'Escribe el nombre de la película a agregar.');
        } else if (data === 'add_series') {
            adminState[chatId] = { step: 'search_series' };
            bot.sendMessage(chatId, 'Escribe el nombre de la serie a agregar.');
        } else if (data === 'eventos') {
            adminState[chatId] = { step: 'awaiting_event_image' };
            bot.sendMessage(chatId, 'Envía el ENLACE (URL) de la imagen para el evento.');
        } else if (data.startsWith('add_new_movie_')) {
            const tmdbId = data.split('_')[3];
            const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
            const response = await axios.get(tmdbUrl);
            adminState[chatId] = { selectedMedia: response.data, mediaType: 'movie', step: 'awaiting_pro_link_movie' };
            bot.sendMessage(chatId, `"${response.data.title}". Envía link PRO (o "no").`);
        } else if (data.startsWith('add_new_series_')) {
            const tmdbId = data.split('_')[3];
            const tmdbUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
            const response = await axios.get(tmdbUrl);
            const seasons = response.data.seasons?.filter(s => s.season_number > 0); // Excluir temporada 0
            if (seasons?.length > 0) {
                adminState[chatId] = { selectedSeries: response.data, mediaType: 'series', step: 'awaiting_season_selection' };
                const buttons = seasons.map(s => [{ text: `${s.name} (S${s.season_number})`, callback_data: `select_season_${tmdbId}_${s.season_number}` }]);
                bot.sendMessage(chatId, `"${response.data.name}". Selecciona temporada:`, { reply_markup: { inline_keyboard: buttons } });
            } else {
                bot.sendMessage(chatId, `No se encontraron temporadas válidas.`);
                adminState[chatId] = { step: 'menu' };
            }
        } else if (data.startsWith('manage_movie_')) {
            const tmdbId = data.split('_')[2];
            const existingData = await mongoDb.collection('media_catalog').findOne({ tmdbId: tmdbId });
            if (!existingData) { bot.sendMessage(chatId, 'Error: No encontrada en MongoDB.'); return; }
            // Lógica para mostrar opciones de gestión (add_pro, add_free) - Similar a como estaba
            let buttons = [];
            if (!existingData.proEmbedCode) buttons.push([{ text: 'Agregar PRO', callback_data: `add_pro_movie_${tmdbId}` }]);
            if (!existingData.freeEmbedCode) buttons.push([{ text: 'Agregar Gratis', callback_data: `add_free_movie_${tmdbId}` }]);
            if(buttons.length === 0) { bot.sendMessage(chatId, `"${existingData.title}" ya tiene ambos links.`); return;}
            bot.sendMessage(chatId, `Gestionando "${existingData.title}". ¿Agregar versión?`, {reply_markup: {inline_keyboard: buttons}});

        } else if (data.startsWith('manage_series_')) {
            const tmdbId = data.split('_')[2];
            const seriesData = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
            if (!seriesData) { bot.sendMessage(chatId, 'Error: No encontrada en MongoDB.'); return; }
            // Lógica para mostrar temporadas a gestionar o añadir nueva
            let buttons = [];
            if (seriesData.seasons) {
                Object.keys(seriesData.seasons).sort((a,b)=> parseInt(a)-parseInt(b)).forEach(seasonNum => {
                    buttons.push([{ text: `Gestionar S${seasonNum}`, callback_data: `manage_season_${tmdbId}_${seasonNum}` }]);
                });
            }
            buttons.push([{ text: `➕ Añadir Nueva Temporada`, callback_data: `add_new_season_${tmdbId}` }]);
            bot.sendMessage(chatId, `Gestionando "${seriesData.title || seriesData.name}". Selecciona:`, { reply_markup: { inline_keyboard: buttons } });

        } else if (data.startsWith('add_pro_movie_') || data.startsWith('add_free_movie_')) {
            const isProLink = data.startsWith('add_pro');
            const tmdbId = data.split('_')[3];
            const existingData = await mongoDb.collection('media_catalog').findOne({ tmdbId: tmdbId });
            if (!existingData) { bot.sendMessage(chatId, 'Error: No encontrada.'); return; }
            adminState[chatId] = {
                selectedMedia: existingData, mediaType: 'movie',
                proEmbedCode: isProLink ? undefined : existingData.proEmbedCode, // Si añado PRO, espero PRO. Si añado Free, guardo el PRO existente.
                freeEmbedCode: isProLink ? existingData.freeEmbedCode : undefined, // Viceversa
                step: isProLink ? 'awaiting_pro_link_movie' : 'awaiting_free_link_movie'
            };
            bot.sendMessage(chatId, `Envía el reproductor ${isProLink ? 'PRO' : 'GRATIS'} para "${existingData.title}".`);

        // --- INICIO DE LA REPARACIÓN DEL ERROR DE SINTAXIS ---
        } else if (data.startsWith('select_season_')) {
            const [_, __, tmdbId, seasonNumber] = data.split('_');
            const state = adminState[chatId]; // <<<<<<<< ESTA LÍNEA FUE REPARADA
            if (!state || !state.selectedSeries || state.selectedSeries.id.toString() !== tmdbId) {
                bot.sendMessage(chatId, 'Error: Estado inconsistente. Reinicia.'); adminState[chatId] = { step: 'menu' }; return;
            }
            state.season = parseInt(seasonNumber);
            state.episode = 1; // Empezar por el episodio 1
            state.step = 'awaiting_pro_link_series';
            bot.sendMessage(chatId, `S${seasonNumber} seleccionada. Envía link PRO para E1 (o "no").`);

        } else if (data.startsWith('manage_season_')) {
            const [_, __, tmdbId, seasonNumber] = data.split('_');
            const seriesData = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
            if (!seriesData) { bot.sendMessage(chatId, 'Error: No encontrada.'); return; }
            let lastEpisode = seriesData.seasons?.[seasonNumber]?.episodes ? Object.keys(seriesData.seasons[seasonNumber].episodes).length : 0;
            const nextEpisode = lastEpisode + 1;
            adminState[chatId] = {
                step: 'awaiting_pro_link_series', selectedSeries: seriesData,
                season: parseInt(seasonNumber), episode: nextEpisode
            };
            bot.sendMessage(chatId, `Gestionando S${seasonNumber}. Envía link PRO para E${nextEpisode} (o "no").`);

        } else if (data.startsWith('add_new_season_')) {
            // Similar a add_new_series, pero busca temporadas no existentes
            const tmdbId = data.split('_')[3];
            const tmdbUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
            const response = await axios.get(tmdbUrl);
            const existingDoc = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId }, { projection: { seasons: 1 } });
            const existingSeasons = existingDoc?.seasons ? Object.keys(existingDoc.seasons) : [];
            const availableSeasons = response.data.seasons?.filter(s => s.season_number > 0 && !existingSeasons.includes(s.season_number.toString()));

            if (availableSeasons?.length > 0) {
                adminState[chatId] = { selectedSeries: response.data, mediaType: 'series', step: 'awaiting_season_selection' };
                const buttons = availableSeasons.map(s => [{ text: `${s.name} (S${s.season_number})`, callback_data: `select_season_${tmdbId}_${s.season_number}` }]);
                bot.sendMessage(chatId, `"${response.data.name}". ¿Qué temporada NUEVA agregar?`, { reply_markup: { inline_keyboard: buttons } });
            } else { bot.sendMessage(chatId, 'No hay más temporadas nuevas para agregar.'); }

        } else if (data.startsWith('solicitud_')) {
            const tmdbId = data.split('_')[1];
            const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
            const response = await axios.get(tmdbUrl);
            adminState[chatId] = { selectedMedia: response.data, mediaType: 'movie', step: 'awaiting_pro_link_movie' };
            bot.sendMessage(chatId, `Atendiendo solicitud: "${response.data.title}". Envía link PRO (o "no").`);
            // Opcional: Eliminar solicitud de Firestore
            // const reqSnap = await db.collection('userRequests').where('tmdbId', '==', tmdbId).limit(1).get();
            // if (!reqSnap.empty) await reqSnap.docs[0].ref.update({ status: 'processing' });

        } else if (data === 'manage_movies') {
            adminState[chatId] = { step: 'search_manage' }; // Reutiliza search_movie/series? O necesita lógica específica?
            bot.sendMessage(chatId, 'Escribe el nombre del contenido a gestionar.');
        } else if (data === 'delete_movie') {
            adminState[chatId] = { step: 'search_delete' };
            bot.sendMessage(chatId, 'Escribe el nombre del contenido a ELIMINAR.');
        } else if (data.startsWith('delete_confirm_')) {
            const [_, __, tmdbId, mediaType] = data.split('_');
            const collectionName = mediaType === 'movie' ? 'media_catalog' : 'series_catalog';
            const result = await mongoDb.collection(collectionName).deleteOne({ tmdbId: tmdbId });
            if (result.deletedCount > 0) {
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `✅ Contenido TMDB ID ${tmdbId} (${mediaType}) eliminado de MongoDB.`);
            } else {
                bot.sendMessage(chatId, `⚠️ No se encontró el contenido TMDB ID ${tmdbId} (${mediaType}) para eliminar.`);
            }
            adminState[chatId] = { step: 'menu' };

        } else if (data.startsWith('save_only_')) {
            const { movieDataToSave } = adminState[chatId];
            if (!movieDataToSave?.tmdbId) { bot.sendMessage(chatId, 'Error: Datos perdidos.'); adminState[chatId] = { step: 'menu' }; return; }
            await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
            bot.sendMessage(chatId, `✅ "${movieDataToSave.title}" guardada.`);
            adminState[chatId] = { step: 'menu' };
        } else if (data.startsWith('save_and_publish_')) {
            const { movieDataToSave } = adminState[chatId];
            if (!movieDataToSave?.tmdbId) { bot.sendMessage(chatId, 'Error: Datos perdidos.'); adminState[chatId] = { step: 'menu' }; return; }
            await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
            bot.sendMessage(chatId, `✅ "${movieDataToSave.title}" guardada. Publicando...`);
            // await publishMovieToChannels(movieDataToSave); // Descomenta si tienes esta función
            // Preguntar si notificar
            adminState[chatId].title = movieDataToSave.title; // Guardar título para notificación
            bot.sendMessage(chatId, `¿Enviar notificación push a los usuarios sobre "${movieDataToSave.title}"?`, {
                reply_markup: { inline_keyboard: [[
                    { text: '📲 Sí, notificar', callback_data: `send_push_${movieDataToSave.tmdbId}_movie` },
                    { text: '❌ No notificar', callback_data: `finish_no_push` }
                ]]}
            });
            // No resetear step aquí, esperar respuesta de notificación

        } else if (data.startsWith('add_next_episode_')) {
            const [_, __, ___, tmdbId, seasonNumber] = data.split('_');
            const seriesData = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
            if (!seriesData) { bot.sendMessage(chatId, 'Error: Serie no encontrada.'); return; }
            let lastEpisode = seriesData.seasons?.[seasonNumber]?.episodes ? Object.keys(seriesData.seasons[seasonNumber].episodes).length : 0;
            const nextEpisode = lastEpisode + 1;
            adminState[chatId] = {
                step: 'awaiting_pro_link_series', selectedSeries: seriesData,
                season: parseInt(seasonNumber), episode: nextEpisode
            };
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
            bot.sendMessage(chatId, `Siguiente: Envía link PRO para S${seasonNumber}E${nextEpisode} (o "no").`);

        } else if (data.startsWith('publish_this_episode_')) {
            const [_, __, ___, tmdbId, season, episode] = data.split('_');
            const state = adminState[chatId];
            const episodeData = state?.lastSavedEpisodeData; // Usar los datos guardados
            if (!episodeData || episodeData.tmdbId !== tmdbId || episodeData.seasonNumber.toString() !== season || episodeData.episodeNumber.toString() !== episode) {
                bot.sendMessage(chatId, 'Error: Datos del episodio no coinciden o se perdieron. Finalizando.');
                adminState[chatId] = { step: 'menu' }; return;
            }
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
            bot.sendMessage(chatId, `✅ Publicando S${season}E${episode}...`);
            // await publishSeriesEpisodeToChannels(episodeData); // Descomenta si tienes esta función
            adminState[chatId].title = `${episodeData.title} S${season}E${episode}`; // Para notificación
            bot.sendMessage(chatId, `¿Enviar notificación push sobre S${season}E${episode}?`, {
              reply_markup: { inline_keyboard: [[
                    { text: '📲 Sí, notificar', callback_data: `send_push_${tmdbId}_tv` }, // mediaType es 'tv'
                    { text: '❌ No notificar', callback_data: `finish_no_push` }
                ]]}
            });
            // No resetear step, esperar respuesta

        } else if (data.startsWith('finish_series_') || data === 'finish_no_push') {
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(()=>{}); // Ignorar error si el mensaje ya no existe
            bot.sendMessage(chatId, '✅ Proceso finalizado. Volviendo al menú.');
            adminState[chatId] = { step: 'menu' };
        } else if (data.startsWith('send_push_')) {
            const [_, __, tmdbId, mediaType] = data.split('_');
            const state = adminState[chatId];
            const title = state?.title; // Título guardado previamente
            if (!title) { bot.sendMessage(chatId, 'Error: Título perdido.'); adminState[chatId] = { step: 'menu' }; return; }

            await axios.post(`${RENDER_BACKEND_URL}/api/notify`, { tmdbId, mediaType, title });
            bot.editMessageText(`✅ Notificaciones push para *${title}* programadas.`, { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } });
            adminState[chatId] = { step: 'menu' };
        }

    } catch (error) {
        console.error("Error en callback_query:", error);
        bot.sendMessage(chatId, '❌ Ocurrió un error procesando tu solicitud.');
        // Considerar resetear el estado si el error es grave
        // adminState[chatId] = { step: 'menu' };
    }
});
// =======================================================================
// === FIN: LÓGICA DEL BOT ===
// =======================================================================


// =======================================================================
// === RUTAS ADICIONALES (App Update, App Status, Assetlinks) ===
// =======================================================================
app.get('/api/app-update', (req, res) => {
 const updateInfo = {
  "latest_version_code": 4, // Actualiza esto con tu versionCode más reciente
  "update_url": "https://google-play.onrender.com", // Tu URL de descarga/tienda
  "force_update": true, // Poner en true para obligar la actualización
  "update_message": "¡Nueva versión (1.4) disponible! Incluye TV en vivo y mejoras. Actualiza ahora."
 };
 res.status(200).json(updateInfo);
});

app.get('/api/app-status', (req, res) => {
    const status = {
        isAppApproved: falce, // Cambia a true DESPUÉS de la aprobación de Google
        safeContentIds: [11104, 539, 4555, 27205, 33045] // IDs seguros
    };
    res.json(status);
});

app.get('/.well-known/assetlinks.json', (req, res) => {
    res.sendFile('assetlinks.json', { root: __dirname });
});

// =======================================================================
// === INICIO DEL SERVIDOR ===
// =======================================================================
app.listen(PORT, () => {
    console.log(`Servidor de backend Sala Cine iniciado en puerto ${PORT}`);
    // Asegúrate de reconectar a Mongo si la conexión se pierde (lógica más avanzada)
    client.on('close', () => {
        console.warn('Conexión a MongoDB cerrada. Intentando reconectar...');
        setTimeout(connectToMongo, 5000); // Reintenta conectar después de 5 segundos
    });
});

// --- Manejo de errores no capturados ---
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Considera cerrar el proceso de forma controlada si es necesario
  // process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Considera cerrar el proceso de forma controlada si es necesario
  // process.exit(1);
});
