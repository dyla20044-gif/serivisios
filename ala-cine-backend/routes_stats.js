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
            const monthId = dayId.substring(0, 7);
            
            const ayer = new Date(now);
            ayer.setDate(ayer.getDate() - 1);
            const yesterdayId = ayer.toISOString().split('T')[0];

            const todayStats = await db.collection('uploader_daily_stats').findOne({ uploaderId: uploaderId, dayId: dayId });
            const todayEarned = todayStats?.today_earned || 0;

            const yesterdayStats = await db.collection('uploader_daily_stats').findOne({ uploaderId: uploaderId, dayId: yesterdayId });
            const yesterdayEarned = yesterdayStats?.today_earned || 0.01; 

            const monthlyDocs = await db.collection('uploader_daily_stats')
                .find({ uploaderId: uploaderId, monthId: monthId })
                .project({ today_earned: 1 })
                .toArray();
            const monthEarned = monthlyDocs.reduce((sum, doc) => sum + (doc.today_earned || 0), 0);

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

            // Ajustado al nuevo límite de 200
            let dynamicRate = REVENUE_SETTINGS.payout_per_view || 0.005; 
            if (monthEarned > 100) dynamicRate = dynamicRate * 0.5;  
            if (monthEarned > 180) dynamicRate = dynamicRate * 0.2;   
            if (monthEarned >= 200) dynamicRate = 0;                  

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
                    currentPayoutRate: dynamicRate
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
