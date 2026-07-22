module.exports = function(app, ctx) {
    const { mongoDb, caches, REVENUE_SETTINGS } = ctx;
    const { pendingViewsCache } = caches;

    // 1. ENDPOINT PARA ANDROID (Registra vistas sin saturar MongoDB)
    app.post('/api/track-view/:tmdbId', (req, res) => {
        const tmdbId = req.params.tmdbId;
        if (!tmdbId) return res.status(400).send({ error: "Falta ID" });
        
        // Lo guardamos en RAM temporalmente
        const currentViews = pendingViewsCache.get(tmdbId) || 0;
        pendingViewsCache.set(tmdbId, currentViews + 1);
        
        res.status(200).send({ success: true, cached: true });
    });

    // 2. ENDPOINT PARA EL PANEL HTML (Manda las finanzas reales)
    app.get('/api/uploader-stats/:uploaderId', async (req, res) => {
        try {
            const uploaderId = parseInt(req.params.uploaderId);
            if (isNaN(uploaderId)) return res.status(400).json({ error: "ID de usuario inválido" });

            const db = ctx.getMongoDb();
            if (!db) return res.status(500).json({ error: "Base de datos no conectada" });

            const now = new Date();
            const dayId = now.toISOString().split('T')[0];
            const monthId = dayId.substring(0, 7);

            // A) Estadísticas de hoy
            const todayStats = await db.collection('uploader_daily_stats').findOne({ uploaderId: uploaderId, dayId: dayId });
            const todayEarned = todayStats?.today_earned || 0;

            // B) Estadísticas de todo el ciclo actual (Mes)
            const monthlyDocs = await db.collection('uploader_daily_stats')
                .find({ uploaderId: uploaderId, monthId: monthId })
                .project({ today_earned: 1 })
                .toArray();
            const monthEarned = monthlyDocs.reduce((sum, doc) => sum + (doc.today_earned || 0), 0);

            // C) Estadísticas Históricas y Conteos Totales
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

            // D) Lógica de "Decadencia" para acercarse suavemente al límite de $500
            // Entre más dinero hace en el mes, menos paga cada vista para no pasarse
            let dynamicRate = REVENUE_SETTINGS.payout_per_view; // Empieza normal (0.005)
            if (monthEarned > 300) dynamicRate = REVENUE_SETTINGS.payout_per_view * 0.5; // Si pasa $300, baja a la mitad (0.0025)
            if (monthEarned > 450) dynamicRate = REVENUE_SETTINGS.payout_per_view * 0.2; // Si roza los $450, paga súper bajito (0.001)

            res.json({
                success: true,
                finances: {
                    todayEarned: todayEarned,
                    monthEarned: monthEarned,
                    totalGeneradoGlobal: hist.totalEarned + todayEarned,
                    bonos: hist.bonusTotal,
                    moviesSubidas: hist.totalMovies,
                    episodiosSubidos: hist.totalEpisodes,
                    currentPayoutRate: dynamicRate
                }
            });

        } catch (error) {
            console.error("Error al despachar finanzas al HTML:", error);
            res.status(500).json({ error: "Error en el cálculo financiero" });
        }
    });
};
