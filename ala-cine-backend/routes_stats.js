module.exports = function(app, ctx) {
    const { mongoDb, caches, REVENUE_SETTINGS } = ctx;
    const { pendingViewsCache } = caches;

    // 1. ENDPOINT PARA LA APP ANDROID (Registra vistas)
    app.post('/api/track-view/:tmdbId', (req, res) => {
        const tmdbId = req.params.tmdbId;
        if (!tmdbId) return res.status(400).send({ error: "Falta ID" });
        
        const currentViews = pendingViewsCache.get(tmdbId) || 0;
        // Restricción removida: Sumamos de 1 en 1 sin filtros
        pendingViewsCache.set(tmdbId, currentViews + 1);
        
        res.status(200).send({ success: true, cached: true });
    });

    // 2. ENDPOINT PARA EL DASHBOARD MÓVIL
    app.get('/api/uploader-stats/:uploaderId', async (req, res) => {
        try {
            const uploaderId = parseInt(req.params.uploaderId);
            if (isNaN(uploaderId)) return res.status(400).json({ error: "ID inválido" });
            
            const db = typeof ctx.getMongoDb === 'function' ? ctx.getMongoDb() : ctx.mongoDb;
            if (!db) return res.status(500).json({ error: "DB no conectada" });

            const now = new Date();
            const dayId = now.toISOString().split('T')[0];
            
            const ayer = new Date(now);
            ayer.setDate(ayer.getDate() - 1);
            const yesterdayId = ayer.toISOString().split('T')[0];

            const todayStats = await db.collection('uploader_daily_stats').findOne({ uploaderId: uploaderId, dayId: dayId });
            const todayEarned = todayStats?.today_earned || 0;

            const yesterdayStats = await db.collection('uploader_daily_stats').findOne({ uploaderId: uploaderId, dayId: yesterdayId });
            const yesterdayEarned = yesterdayStats?.today_earned || 0.01; 

            // --- NUEVA LÓGICA DE CORTES (DEL 21 AL 20) CON ZONA HORARIA ECUADOR ---
            const ecuadorTimeStr = new Date().toLocaleString("en-US", {timeZone: "America/Guayaquil"});
            const nowEcuador = new Date(ecuadorTimeStr);
            
            const anioActual = nowEcuador.getFullYear();
            const mesActual = nowEcuador.getMonth(); // 0 es Enero, 11 es Diciembre
            const diaActual = nowEcuador.getDate();

            let inicioCicloActual, finCicloActual, inicioMesPasado, finMesPasado;

            // Si hoy es 21 o mayor, el ciclo actual va de este mes al 20 del próximo
            if (diaActual >= 21) {
                inicioCicloActual = new Date(anioActual, mesActual, 21);
                finCicloActual = new Date(anioActual, mesActual + 1, 20);
                inicioMesPasado = new Date(anioActual, mesActual - 1, 21);
                finMesPasado = new Date(anioActual, mesActual, 20);
            } else {
                // Si hoy es menor a 21, el ciclo actual empezó el 21 del mes pasado hasta el 20 de este mes
                inicioCicloActual = new Date(anioActual, mesActual - 1, 21);
                finCicloActual = new Date(anioActual, mesActual, 20);
                inicioMesPasado = new Date(anioActual, mesActual - 2, 21);
                finMesPasado = new Date(anioActual, mesActual - 1, 20);
            }

            // Función auxiliar para convertir la fecha a "YYYY-MM-DD"
            const formatYMD = (dateObj) => {
                const y = dateObj.getFullYear();
                const m = String(dateObj.getMonth() + 1).padStart(2, '0');
                const d = String(dateObj.getDate()).padStart(2, '0');
                return `${y}-${m}-${d}`;
            };

            const strInicioCiclo = formatYMD(inicioCicloActual);
            const strFinCiclo = formatYMD(finCicloActual);
            const strInicioPasado = formatYMD(inicioMesPasado);
            const strFinPasado = formatYMD(finMesPasado);

            // Obtener ganancias del ciclo actual (Sin retirar / Retirable)
            const docsActuales = await db.collection('uploader_daily_stats')
                .find({
                    uploaderId: uploaderId,
                    dayId: { $gte: strInicioCiclo, $lte: strFinCiclo }
                })
                .project({ today_earned: 1 })
                .toArray();
            const monthEarned = docsActuales.reduce((sum, doc) => sum + (doc.today_earned || 0), 0);

            // Obtener ganancias del ciclo pasado (Mes Pasado)
            const docsPasados = await db.collection('uploader_daily_stats')
                .find({
                    uploaderId: uploaderId,
                    dayId: { $gte: strInicioPasado, $lte: strFinPasado }
                })
                .project({ today_earned: 1 })
                .toArray();
            const lastMonthEarned = docsPasados.reduce((sum, doc) => sum + (doc.today_earned || 0), 0);
            // ---------------------------------------------------------------------

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

            // Lógica ajustada para proteger el presupuesto y notificar al panel frontal
            let dynamicRate = REVENUE_SETTINGS.payout_per_view || 0.005; 
            let limitStatus = 'normal';

            if (monthEarned >= 50) {
                dynamicRate = dynamicRate * 0.5;   // Advertencia y baja de ganancias al llegar a $50
                limitStatus = 'warning';
            }
            if (monthEarned >= 62) {
                dynamicRate = 0;                   // Corte total exacto a los $62
                limitStatus = 'stopped';
            }

            res.json({
                success: true,
                finances: {
                    todayEarned: todayEarned,
                    yesterdayEarned: yesterdayEarned,
                    monthEarned: monthEarned,
                    lastMonthEarned: lastMonthEarned,
                    totalGeneradoGlobal: hist.totalEarned,
                    bonos: hist.bonusTotal, 
                    moviesSubidas: hist.totalMovies,
                    episodiosSubidos: hist.totalEpisodes,
                    currentPayoutRate: dynamicRate,
                    limitStatus: limitStatus // Enviamos la bandera para mostrar la alerta en el frontend
                },
                recentActivity: recentActivity.map(act => ({
                    type: act.mediaType || act.contentType,
                    title: act.title,
                    earned: act.earned,
                    date: act.timestamp
                })),
                topRequests: topRequests.map(req => ({ title: req.title || req.name, votes: req.votes }))
            });

        } catch (error) {
            console.error("Error en rutas de stats:", error);
            res.status(500).json({ error: "Error interno" });
        }
    });
};
