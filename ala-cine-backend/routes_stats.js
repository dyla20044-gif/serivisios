module.exports = function(app, ctx) {
    const { mongoDb, caches, REVENUE_SETTINGS } = ctx;
    const { pendingViewsCache } = caches;

    const getDb = () => {
        if (typeof ctx.getMongoDb === 'function') {
            return ctx.getMongoDb();
        }
        return mongoDb || ctx.db;
    };

    const formatYMD = (dateObj) => {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const getCycleDates = () => {
        const ecuadorTimeStr = new Date().toLocaleString("en-US", { timeZone: "America/Guayaquil" });
        const nowEcuador = new Date(ecuadorTimeStr);
        const anioActual = nowEcuador.getFullYear();
        const mesActual = nowEcuador.getMonth();
        const diaActual = nowEcuador.getDate();

        let inicioCicloActual, finCicloActual;
        if (diaActual >= 21) {
            inicioCicloActual = new Date(anioActual, mesActual, 21);
            finCicloActual = new Date(anioActual, mesActual + 1, 20);
        } else {
            inicioCicloActual = new Date(anioActual, mesActual - 1, 21);
            finCicloActual = new Date(anioActual, mesActual, 20);
        }

        return {
            strInicioCiclo: formatYMD(inicioCicloActual),
            strFinCiclo: formatYMD(finCicloActual)
        };
    };

    app.post('/api/track-view/:tmdbId', (req, res) => {
        const tmdbId = req.params.tmdbId;
        if (!tmdbId) return res.status(400).send({ error: "Falta ID" });
        const currentViews = pendingViewsCache.get(tmdbId) || 0;
        pendingViewsCache.set(tmdbId, currentViews + 1);
        res.status(200).send({ success: true, cached: true });
    });

    app.get('/api/uploader-stats/:uploaderId', async (req, res) => {
        try {
            const uploaderId = parseInt(req.params.uploaderId);
            if (isNaN(uploaderId)) return res.status(400).json({ error: "ID inválido" });
            
            const db = getDb();
            if (!db) return res.status(500).json({ error: "DB no conectada" });

            const now = new Date();
            const dayId = formatYMD(now);
            
            const ayer = new Date(now);
            ayer.setDate(ayer.getDate() - 1);
            const yesterdayId = formatYMD(ayer);

            const todayStats = await db.collection('uploader_daily_stats').findOne({ uploaderId: uploaderId, dayId: dayId });
            const todayEarned = todayStats?.today_earned || 0;

            const yesterdayStats = await db.collection('uploader_daily_stats').findOne({ uploaderId: uploaderId, dayId: yesterdayId });
            const yesterdayEarned = yesterdayStats?.today_earned || 0.01;

            const { strInicioCiclo, strFinCiclo } = getCycleDates();

            const docsActuales = await db.collection('uploader_daily_stats')
                .find({
                    uploaderId: uploaderId,
                    dayId: { $gte: strInicioCiclo, $lte: strFinCiclo }
                })
                .project({ today_earned: 1 })
                .toArray();
            const monthEarned = docsActuales.reduce((sum, doc) => sum + (doc.today_earned || 0), 0);

            const historicalStats = await db.collection('uploader_revenue').aggregate([
                { $match: { uploaderId: uploaderId } },
                { $group: {
                    _id: null,
                    totalEarned: { $sum: "$earned" },
                    totalMovies: { $sum: { $cond: [{ $eq: ["$mediaType", "movie"] }, 1, 0] } },
                    totalEpisodes: { $sum: { $cond: [{ $eq: ["$mediaType", "tv"] }, 1, 0] } },
                    bonusTotal: { $sum: { $cond: [{ $eq: ["$mediaType", "bonus"] }, "$earned", 0] } }
                }}
            ]).toArray();

            const hist = historicalStats[0] || { totalEarned: 0, totalMovies: 0, totalEpisodes: 0, bonusTotal: 0 };

            const recentActivity = await db.collection('uploader_revenue')
                .find({ uploaderId: uploaderId })
                .sort({ timestamp: -1 })
                .limit(10)
                .toArray();

            const topRequests = await db.collection('movie_requests')
                .find({ status: { $ne: 'subido' } })
                .sort({ votes: -1 })
                .limit(5)
                .toArray();

            const payoutHistory = await db.collection('payment_history')
                .find({ uploaderId: String(uploaderId) })
                .sort({ date: -1 })
                .limit(10)
                .toArray();

            let dynamicRate = (REVENUE_SETTINGS && REVENUE_SETTINGS.payout_per_view) ? REVENUE_SETTINGS.payout_per_view : 0.005; 
            let limitStatus = 'normal';

            if (monthEarned >= 50) {
                dynamicRate = dynamicRate * 0.5;
                limitStatus = 'warning';
            }
            if (monthEarned >= 62) {
                dynamicRate = 0;
                limitStatus = 'stopped';
            }

            res.json({
                success: true,
                finances: {
                    todayEarned: todayEarned,
                    yesterdayEarned: yesterdayEarned,
                    monthEarned: monthEarned,
                    totalGeneradoGlobal: hist.totalEarned,
                    bonos: hist.bonusTotal, 
                    moviesSubidas: hist.totalMovies,
                    episodiosSubidos: hist.totalEpisodes,
                    currentPayoutRate: dynamicRate,
                    limitStatus: limitStatus 
                },
                recentActivity: recentActivity.map(act => ({
                    type: act.mediaType || act.contentType,
                    title: act.title,
                    earned: act.earned,
                    date: act.timestamp
                })),
                topRequests: topRequests.map(req => ({ title: req.title || req.name, votes: req.votes })),
                payoutHistory: payoutHistory
            });

        } catch (error) {
            res.status(500).json({ error: "Error interno" });
        }
    });

    app.get('/api/ceo/dashboard-stats', async (req, res) => {
        try {
            const db = getDb();
            const { strInicioCiclo, strFinCiclo } = getCycleDates();

            let dbWorkers = [];
            if (db) {
                dbWorkers = await db.collection('hr_workers').find({}).toArray();
            }

            const admin2Id = process.env.ADMIN_CHAT_ID_2 || 'ADMIN_02';
            const admin2Name = process.env.ADMIN_2_NAME || 'Nadia (Admin 2)';

            const workersList = [
                {
                    id: String(process.env.ADMIN_CHAT_ID || 'ADMIN_ROOT'),
                    nombre: 'Levin Dylan (CEO)',
                    rol: 'Fundador / CEO',
                    origen: '.env (Root)',
                    vistasHoy: 12500,
                    generado: 421.50,
                    peliculas: 154,
                    series: 45,
                    trend: 'up'
                },
                {
                    id: String(admin2Id),
                    nombre: admin2Name,
                    rol: 'Co-Fundadora / Admin 2',
                    origen: '.env (Admin 2)',
                    vistasHoy: 8400,
                    generado: 210.50,
                    peliculas: 82,
                    series: 20,
                    trend: 'up'
                }
            ];

            if (db) {
                for (const w of dbWorkers) {
                    const uId = parseInt(w.telegramId) || w.telegramId;
                    const stats = await db.collection('uploader_daily_stats')
                        .find({ uploaderId: uId, dayId: { $gte: strInicioCiclo, $lte: strFinCiclo } })
                        .toArray();
                    const totalCycleEarned = stats.reduce((acc, curr) => acc + (curr.today_earned || 0), 0);
                    const isPaid = w.lastPaidCycle === `${strInicioCiclo}_${strFinCiclo}`;

                    workersList.push({
                        id: String(w.telegramId || w._id),
                        nombre: w.nombre || 'Trabajador',
                        rol: w.rol || 'Uploader',
                        origen: 'MongoDB',
                        vistasHoy: w.vistasHoy || 0,
                        generado: isPaid ? 0.00 : (totalCycleEarned || w.generado || 0),
                        peliculas: w.peliculas || 0,
                        series: w.series || 0,
                        trend: w.trend || 'up'
                    });
                }
            }

            let payoutHistory = [];
            if (db) {
                payoutHistory = await db.collection('payment_history').find({}).sort({ date: -1 }).limit(25).toArray();
            }

            let topMovies = [];
            if (db) {
                topMovies = await db.collection('uploader_revenue')
                    .find({})
                    .sort({ timestamp: -1 })
                    .limit(5)
                    .toArray();
            }

            const totalRevenue = workersList.reduce((acc, item) => acc + item.generado, 0);

            res.json({
                success: true,
                serverStats: {
                    usersLive: 45,
                    totalRequests: 18420,
                    revenueToday: totalRevenue,
                    ecpm: 0.005,
                    chartData: [420, 480, 410, 500, 460, 520, totalRevenue]
                },
                workers: workersList,
                payoutHistory: payoutHistory,
                topMovies: topMovies.map(m => ({ title: m.title || 'Inyección Película', uploader: m.uploaderName || 'Sistema', date: m.timestamp }))
            });

        } catch (error) {
            res.status(500).json({ error: "Error al obtener estadísticas del servidor" });
        }
    });

    app.post('/api/ceo/pay-worker', async (req, res) => {
        try {
            const { uploaderId, workerName, amount } = req.body;
            if (!uploaderId || amount === undefined) {
                return res.status(400).json({ error: "Datos de liquidación incompletos" });
            }

            const db = getDb();
            if (!db) return res.status(500).json({ error: "Base de datos no disponible" });

            const { strInicioCiclo, strFinCiclo } = getCycleDates();
            const currentCycleKey = `${strInicioCiclo}_${strFinCiclo}`;

            const receipt = {
                uploaderId: String(uploaderId),
                workerName: workerName || 'Trabajador',
                amount: parseFloat(amount),
                date: new Date(),
                cycle: currentCycleKey,
                status: 'Completado'
            };

            await db.collection('payment_history').insertOne(receipt);

            await db.collection('hr_workers').updateOne(
                { telegramId: String(uploaderId) },
                { $set: { lastPaidCycle: currentCycleKey, generado: 0.00 } }
            );

            const numericId = parseInt(uploaderId);
            const searchId = isNaN(numericId) ? String(uploaderId) : numericId;

            await db.collection('uploader_daily_stats').updateMany(
                { uploaderId: searchId, dayId: { $gte: strInicioCiclo, $lte: strFinCiclo } },
                { $set: { today_earned: 0 } }
            );

            res.json({ success: true, message: "Saldo liberado con éxito y registrado en historial", receipt });
        } catch (error) {
            res.status(500).json({ error: "Error al procesar la liquidación" });
        }
    });

    app.post('/api/ceo/workers', async (req, res) => {
        try {
            const { nombre, telegramId, rol } = req.body;
            if (!nombre || !telegramId) {
                return res.status(400).json({ error: "Nombre e ID de Telegram obligatorios" });
            }

            const db = getDb();
            if (!db) return res.status(500).json({ error: "DB no disponible" });

            const newWorker = {
                nombre,
                telegramId: String(telegramId),
                rol: rol || 'uploader',
                createdAt: new Date(),
                vistasHoy: 0,
                generado: 0.00,
                peliculas: 0,
                series: 0,
                trend: 'neutral'
            };

            await db.collection('hr_workers').updateOne(
                { telegramId: String(telegramId) },
                { $set: newWorker },
                { upsert: true }
            );

            res.json({ success: true, message: "Trabajador inyectado en MongoDB" });
        } catch (error) {
            res.status(500).json({ error: "Error al registrar trabajador" });
        }
    });

    app.delete('/api/ceo/workers/:id', async (req, res) => {
        try {
            const workerId = req.params.id;
            const db = getDb();
            if (!db) return res.status(500).json({ error: "DB no disponible" });

            await db.collection('hr_workers').deleteOne({
                $or: [{ telegramId: String(workerId) }, { _id: workerId }]
            });

            res.json({ success: true, message: "Trabajador desvinculado de MongoDB" });
        } catch (error) {
            res.status(500).json({ error: "Error al desvincular trabajador" });
        }
    });
};
