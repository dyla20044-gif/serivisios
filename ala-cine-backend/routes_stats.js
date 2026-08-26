module.exports = function(app, ctx) {
    const { mongoDb, caches, REVENUE_SETTINGS } = ctx;
    const { pendingViewsCache } = caches;

    const getDb = () => (typeof ctx.getMongoDb === 'function') ? ctx.getMongoDb() : (mongoDb || ctx.db);
    const formatYMD = (dateObj) => `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;

    const getCycleDates = () => {
        const nowEcuador = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Guayaquil" }));
        const anioActual = nowEcuador.getFullYear();
        const mesActual = nowEcuador.getMonth();
        const diaActual = nowEcuador.getDate();

        let inicioCicloActual, finCicloActual;
        // El ciclo corre del 21 al 20 del siguiente mes
        if (diaActual >= 21) {
            inicioCicloActual = new Date(anioActual, mesActual, 21);
            finCicloActual = new Date(anioActual, mesActual + 1, 20);
        } else {
            inicioCicloActual = new Date(anioActual, mesActual - 1, 21);
            finCicloActual = new Date(anioActual, mesActual, 20);
        }
        return { strInicioCiclo: formatYMD(inicioCicloActual), strFinCiclo: formatYMD(finCicloActual) };
    };

    app.get('/api/uploader-stats/:uploaderId', async (req, res) => {
        try {
            const uploaderId = parseInt(req.params.uploaderId);
            const db = getDb();
            if (!db || isNaN(uploaderId)) return res.status(500).json({ error: "Error de DB o ID" });

            const { strInicioCiclo, strFinCiclo } = getCycleDates();
            const docsActuales = await db.collection('uploader_daily_stats')
                .find({ uploaderId, dayId: { $gte: strInicioCiclo, $lte: strFinCiclo } })
                .toArray();
                
            const monthEarned = docsActuales.reduce((sum, doc) => sum + (doc.today_earned || 0), 0);

            let dynamicRate = REVENUE_SETTINGS.payout_per_view || 0.005; 
            let limitStatus = 'normal';

            // Curva de dificultad reflejada en la UI del usuario
            if (monthEarned >= 100) { dynamicRate *= 0.70; limitStatus = 'warning'; }
            if (monthEarned >= 130) { dynamicRate *= 0.40; limitStatus = 'hard'; }
            if (monthEarned >= 150) { dynamicRate *= 0.15; limitStatus = 'extreme'; }
            if (monthEarned >= 160) { dynamicRate = 0; limitStatus = 'stopped'; }

            res.json({ success: true, finances: { monthEarned, currentPayoutRate: dynamicRate, limitStatus } });
        } catch (error) { res.status(500).json({ error: "Error interno" }); }
    });

    app.get('/api/ceo/dashboard-stats', async (req, res) => {
        try {
            const db = getDb();
            const { strInicioCiclo, strFinCiclo } = getCycleDates();
            const dbWorkers = db ? await db.collection('hr_workers').find({}).toArray() : [];
            const workersList = [];

            // Lectura dinámica y real desde MongoDB sin datos genéricos
            for (const w of dbWorkers) {
                const uId = parseInt(w.telegramId) || w.telegramId;
                
                // Generado en el ciclo actual
                const statsActual = await db.collection('uploader_daily_stats')
                    .find({ uploaderId: uId, dayId: { $gte: strInicioCiclo, $lte: strFinCiclo } })
                    .toArray();
                const totalCycleEarned = statsActual.reduce((acc, curr) => acc + (curr.today_earned || 0), 0);
                
                // Validación de bloqueo por falta de pago del ciclo
                const isPaid = w.lastPaidCycle === `${strInicioCiclo}_${strFinCiclo}`;

                workersList.push({
                    id: String(w.telegramId || w._id),
                    nombre: w.nombre || 'Trabajador',
                    rol: w.rol || 'Uploader',
                    generado: totalCycleEarned,
                    pagado: isPaid, // Si está pagado, se le permite seguir generando en el próximo ciclo
                    peliculas: w.peliculas || 0,
                    series: w.series || 0
                });
            }

            const totalRevenue = workersList.reduce((acc, item) => acc + item.generado, 0);

            res.json({ success: true, serverStats: { revenueToday: totalRevenue }, workers: workersList });
        } catch (error) { res.status(500).json({ error: "Error estadístico" }); }
    });

    app.post('/api/ceo/pay-worker', async (req, res) => {
        try {
            const { uploaderId, workerName, amount } = req.body;
            const db = getDb();
            const { strInicioCiclo, strFinCiclo } = getCycleDates();
            const currentCycleKey = `${strInicioCiclo}_${strFinCiclo}`;

            await db.collection('payment_history').insertOne({
                uploaderId: String(uploaderId), workerName, amount: parseFloat(amount), date: new Date(), cycle: currentCycleKey
            });

            // Registrar el ciclo como pagado para reiniciar la generación de ingresos
            await db.collection('hr_workers').updateOne(
                { telegramId: String(uploaderId) }, { $set: { lastPaidCycle: currentCycleKey } }
            );

            res.json({ success: true, message: "Liquidación completada. Ciclo reiniciado." });
        } catch (error) { res.status(500).json({ error: "Error en liquidación" }); }
    });
};
