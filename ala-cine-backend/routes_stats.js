module.exports = function(app, ctx) {
    const { mongoDb, caches, REVENUE_SETTINGS } = ctx;
    const { pendingViewsCache } = caches;

    // 1. ENDPOINT PARA LA APP ANDROID (Registra vistas)
    app.post('/api/track-view/:tmdbId', (req, res) => {
        const tmdbId = req.params.tmdbId;
        if (!tmdbId) return res.status(400).send({ error: "Falta ID" });
        const currentViews = pendingViewsCache.get(tmdbId) || 0;
        pendingViewsCache.set(tmdbId, currentViews + 1);
        res.status(200).send({ success: true, cached: true });
    });

    // 2. ENDPOINT PARA EL DASHBOARD MÓVIL (Conecta todas las funciones visuales)
    app.get('/api/uploader-stats/:uploaderId', async (req, res) => {
        try {
            const uploaderId = parseInt(req.params.uploaderId);
            if (isNaN(uploaderId)) return res.status(400).json({ error: "ID inválido" });
            const db = ctx.getMongoDb();
            if (!db) return res.status(500).json({ error: "DB no conectada" });

            const now = new Date();
            const dayId = now.toISOString().split('T')[0];
            const monthId = dayId.substring(0, 7);

            // Estadísticas de hoy y del mes
            const todayStats = await db.collection('uploader_daily_stats').findOne({ uploaderId: uploaderId, dayId: dayId });
            const todayEarned = todayStats?.today_earned || 0;

            const monthlyDocs = await db.collection('uploader_daily_stats').find({ uploaderId: uploaderId, monthId: monthId }).project({ today_earned: 1 }).toArray();
            const monthEarned = monthlyDocs.reduce((sum, doc) => sum + (doc.today_earned || 0), 0);

            // Histórico global
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

            // OBTENER LAS PELÍCULAS MÁS PEDIDAS PARA EL BOTÓN "GANAR MÁS"
            const topRequests = await db.collection('movie_requests')
                .find({ status: { $ne: 'subido' } })
                .sort({ votes: -1 })
                .limit(5)
                .toArray();

            // REGLA DE NEGOCIO: Reducción dinámica si se acerca a $140 mensuales
            let dynamicRate = REVENUE_SETTINGS.payout_per_view || 0.005; 
            if (monthEarned > 100) dynamicRate = dynamicRate * 0.5;   // Baja a la mitad al pasar $100
            if (monthEarned > 130) dynamicRate = dynamicRate * 0.2;   // Baja drásticamente al llegar a $130
            if (monthEarned >= 140) dynamicRate = 0;                  // Tope máximo.

            res.json({
                success: true,
                finances: {
                    todayEarned: todayEarned,
                    monthEarned: monthEarned,
                    totalGeneradoGlobal: hist.totalEarned,
                    bonos: hist.bonusTotal,
                    moviesSubidas: hist.totalMovies,
                    episodiosSubidos: hist.totalEpisodes,
                    currentPayoutRate: dynamicRate
                },
                topRequests: topRequests.map(req => ({ title: req.title || req.name, votes: req.votes }))
            });

        } catch (error) {
            console.error("Error en rutas de stats:", error);
            res.status(500).json({ error: "Error interno" });
        }
    });
};
