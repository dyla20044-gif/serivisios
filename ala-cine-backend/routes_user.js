module.exports = function(app, ctx) {
    const { db, getMongoDb, admin, bot, ADMIN_CHAT_IDS, ADMIN_CHAT_ID_2 } = ctx;
    const { COLL_REVENUE, COLL_DAILY_STATS, REVENUE_SETTINGS } = ctx;
    const { userCache, countsCache, historyCache } = ctx.caches;
    const { verifyIdToken, verifyInternalAdmin } = ctx.middlewares;

    // --- COIN BUFFER (Aislado aquí) ---
    let coinWriteBuffer = {};

    async function flushCoinBuffer() {
        const uids = Object.keys(coinWriteBuffer);
        if (uids.length === 0) return;

        console.log(`[Coin Buffer] Iniciando escritura en lote para ${uids.length} usuarios...`);
        const batch = db.batch();
        const uidsToFlush = uids.slice(0, 490);

        uidsToFlush.forEach(uid => {
            const amount = coinWriteBuffer[uid];
            if (amount !== 0) {
                const userRef = db.collection('users').doc(uid);
                batch.update(userRef, { coins: admin.firestore.FieldValue.increment(amount) });
            }
        });

        try {
            await batch.commit();
            console.log(`[Coin Buffer] ✅ Escritura en lote exitosa. Buffer limpiado.`);
            uidsToFlush.forEach(uid => { delete coinWriteBuffer[uid]; });
        } catch (error) {
            console.error("❌ [Coin Buffer] Error crítico al escribir en Firestore:", error);
        }
    }

    setInterval(flushCoinBuffer, 300000);

    // --- MIDDLEWARE LOCAL DE CACHÉ ---
    function countsCacheMiddleware(req, res, next) {
        if (!req.uid) return next();
        const uid = req.uid;
        const route = req.path;
        const cacheKey = `${uid}:${route}`;
        try {
            const cachedData = countsCache.get(cacheKey);
            if (cachedData) return res.status(200).json(cachedData);
        } catch (err) {
            console.error("Error al leer del caché de usuario:", err);
        }
        req.cacheKey = cacheKey;
        next();
    }

    // --- RUTAS DE USUARIO ---
    app.get('/api/user/me', verifyIdToken, async (req, res) => {
        const { uid, email } = req;
        const usernameFromQuery = req.query.username;
        const cachedUser = userCache.get(uid);
        
        if (cachedUser) {
            if (coinWriteBuffer[uid]) cachedUser.coins = Math.max(cachedUser.coins, cachedUser.coins); 
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

                const dbCoins = userData.coins || 0;
                const bufferedCoins = coinWriteBuffer[uid] || 0;
                const totalCoins = dbCoins + bufferedCoins;

                const responseData = {
                    uid, email, username: userData.username || email.split('@')[0],
                    flair: userData.flair || "👋", coins: totalCoins, isPro: isPro, renewalDate: renewalDate
                };
                userCache.set(uid, responseData);
                return res.status(200).json(responseData);
            } else {
                const initialData = {
                    uid, email, username: usernameFromQuery || email.split('@')[0],
                    flair: "👋 ¡Nuevo en Sala Cine!", isPro: false, createdAt: now, coins: 0,
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
        if (!username || username.length < 3) return res.status(400).json({ error: 'Nombre de usuario inválido.' });
        try {
            await db.collection('users').doc(uid).update({ username: username, flair: flair || "" });
            userCache.del(uid);
            res.status(200).json({ message: 'Perfil actualizado con éxito.' });
        } catch (error) {
            console.error("Error en /api/user/profile:", error);
            res.status(500).json({ error: 'Error al actualizar el perfil.' });
        }
    });

    app.get('/api/user/coins', verifyIdToken, countsCacheMiddleware, async (req, res) => {
        const { uid, cacheKey } = req;
        const cachedUser = userCache.get(uid);
        if (cachedUser) return res.status(200).json({ coins: cachedUser.coins });

        try {
            const docSnap = await db.collection('users').doc(uid).get();
            const dbCoins = docSnap.exists ? (docSnap.data().coins || 0) : 0;
            const buffered = coinWriteBuffer[uid] || 0;
            const responseData = { coins: dbCoins + buffered };
            countsCache.set(cacheKey, responseData);
            res.status(200).json(responseData);
        } catch (error) {
            console.error("Error al obtener el balance de coins:", error);
            res.status(500).json({ error: 'Error al obtener el balance.' });
        }
    });

    app.post('/api/user/coins', verifyIdToken, async (req, res) => {
        const { uid } = req;
        const { amount } = req.body;
        if (typeof amount !== 'number' || amount === 0) return res.status(400).json({ error: 'Cantidad inválida.' });
        
        if (amount > 0) {
            coinWriteBuffer[uid] = (coinWriteBuffer[uid] || 0) + amount;
            const cachedUser = userCache.get(uid);
            let newDisplayBalance = 0;
            if (cachedUser) {
                cachedUser.coins += amount;
                userCache.set(uid, cachedUser); 
                newDisplayBalance = cachedUser.coins;
            } else { newDisplayBalance = amount; }
            countsCache.del(`${uid}:/api/user/coins`);
            return res.status(200).json({ message: 'Balance actualizado (Buffer).', newBalance: newDisplayBalance });
        }

        const userDocRef = db.collection('users').doc(uid);
        try {
            const newBalance = await db.runTransaction(async (transaction) => {
                const doc = await transaction.get(userDocRef);
                let currentCoins = doc.exists ? (doc.data().coins || 0) : 0;
                const buffered = coinWriteBuffer[uid] || 0;
                const totalReal = currentCoins + buffered;
                const finalBalance = totalReal + amount; 

                if (finalBalance < 0) throw new Error("Saldo insuficiente");
                if (!doc.exists) transaction.set(userDocRef, { coins: finalBalance }, { merge: true });
                else transaction.update(userDocRef, { coins: finalBalance });
                
                delete coinWriteBuffer[uid];
                return finalBalance;
            });

            const cachedUser = userCache.get(uid);
            if (cachedUser) { cachedUser.coins = newBalance; userCache.set(uid, cachedUser); }
            countsCache.del(`${uid}:/api/user/coins`);
            countsCache.del(`${uid}:/api/user/me`);
            res.status(200).json({ message: 'Balance actualizado.', newBalance });
        } catch (error) {
            if (error.message === "Saldo insuficiente") return res.status(400).json({ error: 'Saldo insuficiente para realizar el gasto.' });
            console.error("Error en /api/user/coins (POST):", error);
            res.status(500).json({ error: 'Error en la transacción de monedas.' });
        }
    });

    app.get('/api/user/history', verifyIdToken, async (req, res) => {
        const { uid } = req;
        const cacheKey = `history-${uid}`;
        const cachedHistory = historyCache.get(cacheKey);
        if (cachedHistory) return res.status(200).json(cachedHistory);

        try {
            const snapshot = await db.collection('history').where('userId', '==', uid).orderBy('timestamp', 'desc').limit(10).get();
            const historyItems = snapshot.docs.map(doc => ({
                tmdbId: doc.data().tmdbId, title: doc.data().title, poster_path: doc.data().poster_path,
                backdrop_path: doc.data().backdrop_path, type: doc.data().type, timestamp: doc.data().timestamp.toDate().toISOString()
            }));
            historyCache.set(cacheKey, historyItems);
            res.status(200).json(historyItems);
        } catch (error) { res.status(500).json({ error: 'Error al obtener el historial.' }); }
    });

    app.post('/api/user/history', verifyIdToken, async (req, res) => {
        const { uid } = req;
        let { tmdbId, title, poster_path, backdrop_path, type } = req.body;
        if (!tmdbId || !type) return res.status(400).json({ error: 'tmdbId y type requeridos.' });
        
        const idAsString = String(tmdbId).trim();
        const idAsNumber = Number(idAsString);
        const possibleIds = [idAsString];
        if (!isNaN(idAsNumber)) possibleIds.push(idAsNumber);
        
        const mongoDb = getMongoDb();
        if (!backdrop_path && mongoDb) {
            try {
                let mediaDoc = type === 'movie' ? await mongoDb.collection('media_catalog').findOne({ tmdbId: idAsString }) : await mongoDb.collection('series_catalog').findOne({ tmdbId: idAsString });
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

            const safeData = { userId: uid, tmdbId: idAsString, title: title || "Título desconocido", poster_path: poster_path || null, backdrop_path: backdrop_path || null, type, timestamp: now };

            if (existingDocs.empty) await historyRef.add(safeData);
            else {
                if (existingDocs.size > 1) {
                    const docs = existingDocs.docs;
                    await historyRef.doc(docs[0].id).update(safeData);
                    for (let i = 1; i < docs.length; i++) await historyRef.doc(docs[i].id).delete();
                } else {
                    await historyRef.doc(existingDocs.docs[0].id).update(safeData); 
                }
            }
            historyCache.del(`history-${uid}`);
            res.status(200).json({ message: 'Historial actualizado y reparado.' });
        } catch (error) { res.status(500).json({ error: 'Error al actualizar el historial.' }); }
    });

    app.post('/api/user/progress', verifyIdToken, async (req, res) => {
        const { uid } = req;
        const { seriesId, season, episode } = req.body;
        if (!seriesId || !season || !episode) return res.status(400).json({ error: 'Datos requeridos.' });
        try {
            await db.collection('watchProgress').doc(`${uid}_${seriesId}`).set({ userId: uid, seriesId, lastWatched: { season, episode }, timestamp: admin.firestore.FieldValue.serverTimestamp() });
            res.status(200).json({ message: 'Progreso guardado.' });
        } catch (error) { res.status(500).json({ error: 'Error al guardar el progreso.' }); }
    });

    app.get('/api/user/progress', verifyIdToken, async (req, res) => {
        const { uid } = req;
        const { seriesId } = req.query;
        if (!seriesId) return res.status(400).json({ error: 'seriesId requerido.' });
        try {
            const docSnap = await db.collection('watchProgress').doc(`${uid}_${seriesId}`).get();
            if (docSnap.exists) return res.status(200).json({ lastWatched: docSnap.data().lastWatched });
            res.status(200).json({ lastWatched: null });
        } catch (error) { res.status(500).json({ error: 'Error al obtener el progreso.' }); }
    });

    app.post('/api/user/favorites', verifyIdToken, async (req, res) => {
        const { uid } = req;
        const { tmdbId, title, poster_path, type } = req.body;
        if (!tmdbId || !type) return res.status(400).json({ error: 'Faltan datos.' });
        try {
            const favoritesRef = db.collection('favorites');
            const q = favoritesRef.where('userId', '==', uid).where('tmdbId', '==', tmdbId);
            const querySnapshot = await q.limit(1).get();
            if (!querySnapshot.empty) return res.status(200).json({ message: 'Este contenido ya está en Mi lista.' });
            await favoritesRef.add({ userId: uid, tmdbId, title, poster_path, type });
            res.status(201).json({ message: 'Añadido a Mi lista.' });
        } catch (error) { res.status(500).json({ error: 'Error al añadir a favoritos.' }); }
    });

    app.get('/api/user/favorites', verifyIdToken, async (req, res) => {
        try {
            const snapshot = await db.collection('favorites').where('userId', '==', req.uid).orderBy('title', 'asc').get();
            const favorites = snapshot.docs.map(doc => ({ tmdbId: doc.data().tmdbId, title: doc.data().title, poster_path: doc.data().poster_path, type: doc.data().type }));
            res.status(200).json(favorites);
        } catch (error) { res.status(500).json({ error: 'Error al cargar favoritos.' }); }
    });

    app.get('/api/user/likes/check', verifyIdToken, async (req, res) => {
        if (!req.query.tmdbId) return res.status(400).json({ error: 'tmdbId requerido.' });
        try {
            const snapshot = await db.collection('movieLikes').where('userId', '==', req.uid).where('tmdbId', '==', req.query.tmdbId.toString()).limit(1).get();
            res.status(200).json({ hasLiked: !snapshot.empty });
        } catch (error) { res.status(500).json({ error: 'Error al verificar el like.' }); }
    });

    app.post('/api/user/likes', verifyIdToken, async (req, res) => {
        if (!req.body.tmdbId) return res.status(400).json({ error: 'tmdbId requerido.' });
        try {
            const likesRef = db.collection('movieLikes');
            const existingDocs = await likesRef.where('userId', '==', req.uid).where('tmdbId', '==', req.body.tmdbId.toString()).limit(1).get();
            if (existingDocs.empty) {
                await likesRef.add({ userId: req.uid, tmdbId: req.body.tmdbId.toString(), timestamp: admin.firestore.FieldValue.serverTimestamp() });
                return res.status(201).json({ message: 'Like registrado.' });
            } else { return res.status(200).json({ message: 'Like ya existe (no se registró duplicado).' }); }
        } catch (error) { res.status(500).json({ error: 'Error al registrar el like.' }); }
    });

    app.post('/api/rewards/redeem/premium', verifyIdToken, async (req, res) => {
        const { uid } = req;
        const days = parseInt(req.body.daysToAdd, 10); 
        if (isNaN(days) || days <= 0) return res.status(400).json({ success: false, error: 'daysToAdd debe ser un número positivo.' }); 
        try {
            const userDocRef = db.collection('users').doc(uid); 
            const newExpiryDate = await db.runTransaction(async (transaction) => {
                const docSnap = await transaction.get(userDocRef);
                let currentExpiry; const now = new Date();
                if (docSnap.exists && docSnap.data().premiumExpiry) {
                     const expiryData = docSnap.data().premiumExpiry;
                     if (expiryData.toDate && typeof expiryData.toDate === 'function') { currentExpiry = expiryData.toDate(); }
                     else if (typeof expiryData === 'number') { currentExpiry = new Date(expiryData); }
                     else if (typeof expiryData === 'string') { currentExpiry = new Date(expiryData); }
                     else { currentExpiry = now; }
                    return currentExpiry > now ? new Date(currentExpiry.getTime() + days * 24 * 60 * 60 * 1000) : new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
                } else { return new Date(now.getTime() + days * 24 * 60 * 60 * 1000); }
            });
            await userDocRef.set({ isPro: true, premiumExpiry: newExpiryDate }, { merge: true });
            userCache.del(uid);
            res.status(200).json({ success: true, message: `Premium activado por ${days} días.`, expiryDate: newExpiryDate.toISOString() });
        } catch (error) { res.status(500).json({ success: false, error: 'Error interno al activar Premium.' }); }
    });

    app.post('/api/payments/request-manual', async (req, res) => {
        const { userId, username, planName, price } = req.body;
        if (!userId || !planName) return res.status(400).json({ error: 'Faltan datos.' });
        let days = 30; 
        if (planName.includes('3 Meses')) days = 90;
        else if (planName.includes('Anual') || planName.includes('12 Meses')) days = 365;

        const message = `⚠️ *SOLICITUD DE ACTIVACIÓN PREMIUM* ⚠️\n\n👤 *Usuario:* ${username || 'Sin nombre'}\n🆔 *ID:* \`${userId}\`\n📅 *Plan:* ${planName}\n💰 *Precio:* ${price}`;
        try {
            for (const adminId of ADMIN_CHAT_IDS) {
                try {
                    await bot.sendMessage(adminId, message, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '✅ Activar Ahora', callback_data: `act_man_${userId}_${days}` }], [{ text: '❌ Ignorar', callback_data: 'ignore_payment_request' }]] } });
                } catch (err) { console.error(`Error enviando a admin ${adminId}:`, err); }
            }
            res.status(200).json({ success: true, message: 'Solicitud enviada a los administradores.' });
        } catch (error) { res.status(500).json({ error: 'Error al notificar a los administradores.' }); }
    });

    app.post('/api/payments/google-sync', verifyIdToken, async (req, res) => {
        const { uid } = req;
        const { purchaseToken, orderId, productId } = req.body;
        if (!uid) return res.status(401).json({ error: 'Usuario no autenticado.' });
        if (!orderId || !productId) return res.status(400).json({ error: 'Datos de compra incompletos.' });

        let daysToAdd = 30; 
        if (productId === 'salacine_premium_yearly' || productId.toLowerCase().includes('year') || productId.toLowerCase().includes('anual')) daysToAdd = 365;

        try {
            const userRef = db.collection('users').doc(uid);
            const newExpiry = await db.runTransaction(async (transaction) => {
                const userDoc = await transaction.get(userRef);
                const now = new Date();
                let currentExpiry = now;

                if (userDoc.exists && userDoc.data().premiumExpiry) {
                    const expiryData = userDoc.data().premiumExpiry;
                    let existingDate;
                    if (expiryData.toDate && typeof expiryData.toDate === 'function') { existingDate = expiryData.toDate(); }
                    else if (typeof expiryData === 'number') { existingDate = new Date(expiryData); }
                    else if (typeof expiryData === 'string') { existingDate = new Date(expiryData); }
                    if (existingDate && existingDate > now) currentExpiry = existingDate;
                }

                const nextExpiry = new Date(currentExpiry);
                nextExpiry.setDate(nextExpiry.getDate() + daysToAdd);

                transaction.set(userRef, { isPro: true, premiumExpiry: nextExpiry, lastOrderId: orderId, lastPlatform: 'google_play', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
                const paymentLogRef = db.collection('payment_logs').doc(orderId);
                transaction.set(paymentLogRef, { uid, orderId, productId, purchaseToken: purchaseToken || null, daysAdded: daysToAdd, timestamp: admin.firestore.FieldValue.serverTimestamp(), platform: 'google_play' });
                return nextExpiry;
            });

            if (userCache) userCache.del(uid);
            res.status(200).json({ success: true, message: 'Suscripción activada', newExpiryDate: newExpiry.toISOString() });
        } catch (error) { res.status(500).json({ error: 'Error interno procesando el pago.' }); }
    });

    app.post('/api/rewards/request-diamond', verifyIdToken, async (req, res) => {
        const { uid, email } = req;
        const { gameId, diamonds, costInCoins } = req.body;
        if (!gameId || !diamonds || !costInCoins) return res.status(400).json({ error: 'Faltan datos.' });
        const userEmail = email || 'No especificado (UID: ' + uid + ')';
        const message = `💎 *¡Solicitud de Diamantes!* 💎\n\n*Usuario:* ${userEmail}\n*ID de Jugador:* \`${gameId}\`\n*Producto:* ${diamonds} Diamantes\n*Costo:* ${costInCoins} 🪙`;
        try {
            for (const adminId of ADMIN_CHAT_IDS) {
                try {
                    await bot.sendPhoto(adminId, "https://i.ibb.co/L6TqT2V/ff-100.png", { caption: message, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '✅ Marcar como Recargado', callback_data: `diamond_completed_${gameId}` }]] } });
                } catch (err) { console.error(`Error enviando admin ${adminId}:`, err); }
            }
            res.status(200).json({ message: 'Solicitud enviada a los administradores.' });
        } catch (error) { res.status(500).json({ error: 'Error al notificar.' }); }
    });

    app.get('/api/admin/uploader-stats', verifyIdToken, verifyInternalAdmin, async (req, res) => {
        const targetUploaderId = parseInt(req.query.uploaderId) || parseInt(req.uid) || ADMIN_CHAT_ID_2;
        const mongoDb = getMongoDb();
        if (!mongoDb || isNaN(targetUploaderId)) return res.status(503).json({ error: "Servicio de estadísticas no disponible o ID inválido." });

        const now = new Date();
        const dayId = now.toISOString().split('T')[0];
        const monthId = dayId.substring(0, 7);

        try {
            const historicalStats = await mongoDb.collection(COLL_REVENUE).aggregate([
                { $match: { uploaderId: targetUploaderId } },
                { $group: { _id: null, totalEarned: { $sum: "$earned" }, totalMovies: { $sum: { $cond: [{ $eq: ["$mediaType", "movie"] }, 1, 0] } }, totalEpisodes: { $sum: { $cond: [{ $eq: ["$mediaType", "tv"] }, 1, 0] } }, totalEstrenos: { $sum: { $cond: [{ $eq: ["$contentType", "estreno"] }, 1, 0] } }, totalCatalogos: { $sum: { $cond: [{ $eq: ["$contentType", "catalogo"] }, 1, 0] } } } }
            ]).toArray();

            const hist = historicalStats[0] || { totalEarned: 0, totalMovies: 0, totalEpisodes: 0, totalEstrenos: 0, totalCatalogos: 0 };
            const todayStats = await mongoDb.collection(COLL_DAILY_STATS).findOne({ uploaderId: targetUploaderId, dayId });
            const monthlyDocs = await mongoDb.collection(COLL_DAILY_STATS).find({ uploaderId: targetUploaderId, monthId }).toArray();
            const monthEarned = monthlyDocs.reduce((sum, doc) => sum + (doc.today_earned || 0), 0);
            const monthCount = monthlyDocs.reduce((sum, doc) => sum + (doc.today_content_count || 0), 0);
            
            res.status(200).json({
                uploaderId: targetUploaderId, currency: "USD",
                limits: { daily: REVENUE_SETTINGS.limit_daily, monthly: REVENUE_SETTINGS.limit_monthly },
                today: { date: dayId, earned: todayStats?.today_earned || 0, contentCount: todayStats?.today_content_count || 0, potentialRaw: todayStats?.today_raw_potential || 0, limitReached: (todayStats?.today_earned || 0) >= REVENUE_SETTINGS.limit_daily },
                month: { monthId, earned: monthEarned, contentCount: monthCount, limitReached: monthEarned >= REVENUE_SETTINGS.limit_monthly },
                historical: { totalEarned: hist.totalEarned, totalContent: hist.totalMovies + hist.totalEpisodes, estrenosMovies: hist.totalEstrenos, catalogoMovies: hist.totalCatalogos }
            });
        } catch (error) { res.status(500).json({ error: "Error interno al generar estadísticas." }); }
    });
};
