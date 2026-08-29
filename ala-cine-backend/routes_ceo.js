module.exports = function(app, ctx) {
    const { globalPricing, bot, ADMIN_CHAT_IDS } = ctx;
    
    // CORRECCIÓN VITAL: Extraemos MongoDB usando la función correcta de tu servidor
    const mongoDb = typeof ctx.getMongoDb === 'function' ? ctx.getMongoDb() : ctx.mongoDb;
    
    const COLL_DAILY_STATS = ctx.COLL_DAILY_STATS || 'uploader_daily_stats';
    const COLL_REVENUE = ctx.COLL_REVENUE || 'uploader_revenue';
    const COLL_CORP_REVENUE = 'corp_daily_revenue';

    // 1. MASTER STATS: El cerebro del Dashboard Principal
    app.get('/api/ceo/master-stats', async (req, res) => {
        if (!mongoDb) return res.status(503).json({ error: "DB no conectada" });
        
        try {
            const now = new Date();
            const dayId = now.toISOString().split('T')[0];
            const currentMonthPrefix = dayId.substring(0, 7);

            // A. Histórico de Pagos y Trabajadores (Uploaders)
            const allPayouts = await mongoDb.collection('payout_history').aggregate([
                { $sort: { date: -1 } },
                { $group: { _id: "$uploaderId", lastPayoutDate: { $first: "$date" } } }
            ]).toArray();
            
            const payoutMap = {};
            allPayouts.forEach(p => payoutMap[p._id] = p.lastPayoutDate.toISOString().split('T')[0]);

            const pendingStats = await mongoDb.collection(COLL_DAILY_STATS).find({}).toArray();
            
            let nominaTotal = 0;
            let vistasTotalesHoy = 0;
            const workerMap = {};
            
            // Asignamos automáticamente al dueño/CEO basándonos en tu .env
            const CEO_ID = (ADMIN_CHAT_IDS && ADMIN_CHAT_IDS.length > 0) ? ADMIN_CHAT_IDS[0] : 11111111;

            pendingStats.forEach(s => {
                const uid = s.uploaderId;
                const isCEO = (uid === CEO_ID); 
                
                if (!workerMap[uid]) {
                    workerMap[uid] = { 
                        id: uid, 
                        name: isCEO ? "CEO (Tú)" : "Trabajador ID: " + uid, 
                        earnedMonth: 0, 
                        deudaPendiente: 0, 
                        earnedToday: 0, 
                        totalUploads: 0,
                        vistasHoy: 0
                    };
                }

                const lastPayoutStr = payoutMap[uid] || '2000-01-01';
                
                if (s.dayId >= lastPayoutStr) {
                    const earned = s.today_earned || 0;
                    if (s.dayId.startsWith(currentMonthPrefix)) {
                        workerMap[uid].earnedMonth += earned; 
                    } else {
                        workerMap[uid].deudaPendiente += earned; 
                    }
                    if (!isCEO) nominaTotal += earned;
                }
                
                if (s.dayId === dayId) {
                    workerMap[uid].earnedToday = (s.today_earned || 0);
                    workerMap[uid].totalUploads = (s.today_content_count || 0);
                    workerMap[uid].vistasHoy = (s.total_views || 0);
                    vistasTotalesHoy += (s.total_views || 0);
                }
            });

            // Obtener nombres reales del departamento de RRHH
            const hrWorkers = await mongoDb.collection('hr_workers').find({}).toArray();
            const hrMap = {};
            hrWorkers.forEach(w => hrMap[w.telegramId] = w);

            const trabajadoresArray = Object.values(workerMap).map(w => {
                const hrData = hrMap[w.id.toString()];
                if (hrData) {
                    w.name = hrData.name;
                    w.rol = hrData.role;
                } else {
                    w.rol = w.name.includes("CEO") ? "Admin CEO" : "Uploader Externo";
                }
                w.trend = w.earnedToday > 5 ? 'up' : (w.earnedToday > 1 ? 'neutral' : 'down');
                return w;
            });

            // B. Ingresos Corporativos Reales (El dinero que gana la empresa independiente)
            const corpDoc = await mongoDb.collection(COLL_CORP_REVENUE).findOne({ dayId: dayId });
            let ingresosHoyEmpresa = corpDoc ? (corpDoc.today_earned || 0) : 0; 
            let peticionesTotales = corpDoc ? (corpDoc.total_requests || 0) : 0;

            // C. Cálculo del Total Histórico de la Empresa
            const historicalCorp = await mongoDb.collection(COLL_CORP_REVENUE).aggregate([
                { $group: { _id: null, total: { $sum: "$today_earned" } } }
            ]).toArray();
            let ingresosHistoricos = historicalCorp.length > 0 ? historicalCorp[0].total : 0;

            // Si es el primer día de la empresa, igualamos el histórico a los ingresos de hoy
            if (ingresosHistoricos === 0) ingresosHistoricos = ingresosHoyEmpresa;

            // Proyección de la caja a 30 días basada en el rendimiento de hoy
            let cajaMes = ingresosHoyEmpresa * 30; 

            // D. Datos para alimentar el Gráfico en tiempo real (Limpio y real)
            const chartData = [0, 0, 0, 0, 0, 0, ingresosHoyEmpresa]; 
            const chartLabels = ['D-6', 'D-5', 'D-4', 'D-3', 'D-2', 'Ayer', 'Hoy'];

            res.json({
                ingresosHoy: ingresosHoyEmpresa, 
                cajaMes: cajaMes,
                ingresosHistoricos: ingresosHistoricos,
                vistasHoy: vistasTotalesHoy, 
                peticionesTotales: peticionesTotales,
                nominaTotal,
                trabajadores: trabajadoresArray,
                chartLabels,
                chartData
            });
            
        } catch (error) {
            res.status(500).json({ error: "Error obteniendo estadísticas maestras" });
        }
    });

    // 2. POLÍTICAS FINANCIERAS: Cambiar precios y modos en tiempo real sin apagar el servidor
    app.post('/api/ceo/pricing', (req, res) => {
        const { mode, customMoviePrice, customTvPrice, limit_daily, limit_monthly } = req.body;
        if (mode) globalPricing.mode = mode;
        if (customMoviePrice !== undefined) globalPricing.customMoviePrice = parseFloat(customMoviePrice);
        if (customTvPrice !== undefined) globalPricing.customTvPrice = parseFloat(customTvPrice);
        if (limit_daily !== undefined) globalPricing.limit_daily = parseFloat(limit_daily);
        if (limit_monthly !== undefined) globalPricing.limit_monthly = parseFloat(limit_monthly);
        
        res.json({ success: true, message: "Políticas aplicadas en caliente.", globalPricing });
    });

    // 3. PAGOS Y NÓMINA: Registrar la liquidación de un trabajador
    app.post('/api/ceo/pay-worker', async (req, res) => {
        const { uploaderId, amount, paymentMethod } = req.body;
        if (!mongoDb) return res.status(503).json({ error: "DB no conectada" });

        try {
            const payoutRecord = {
                uploaderId: parseInt(uploaderId),
                amountPaid: parseFloat(amount),
                paymentMethod: paymentMethod || "Liquidación Panel CEO",
                status: "Pagado",
                date: new Date()
            };
            await mongoDb.collection('payout_history').insertOne(payoutRecord);
            res.json({ success: true, message: "Liquidación registrada y ciclo reiniciado exitosamente." });
        } catch (error) {
            res.status(500).json({ error: "Error al procesar el pago." });
        }
    });

    // 4. NOTIFICACIONES PUSH & BOT DE TELEGRAM
    app.post('/api/ceo/notify-bot', async (req, res) => {
        const { message, imageUrl, targetGroup } = req.body;
        try {
            let targets = (targetGroup === 'all_admins') ? ADMIN_CHAT_IDS : [ADMIN_CHAT_IDS[0]];
            for (let chatId of targets) {
                if (imageUrl) {
                    await bot.sendPhoto(chatId, imageUrl, { caption: message, parse_mode: 'Markdown' }).catch(()=>{});
                } else {
                    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' }).catch(()=>{});
                }
            }
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};
