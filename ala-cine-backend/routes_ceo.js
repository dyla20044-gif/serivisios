module.exports = function(app, ctx) {
    const { globalPricing, bot, ADMIN_CHAT_IDS } = ctx;
    
    const COLL_DAILY_STATS = ctx.COLL_DAILY_STATS || 'uploader_daily_stats';
    const COLL_REVENUE = ctx.COLL_REVENUE || 'uploader_revenue';
    const COLL_CORP_REVENUE = 'corp_daily_revenue';

    app.get('/api/ceo/master-stats', async (req, res) => {
        const dbInstance = typeof ctx.getMongoDb === 'function' ? ctx.getMongoDb() : ctx.mongoDb;
        if (!dbInstance) return res.status(503).json({ error: "DB no conectada" });
        
        try {
            const now = new Date();
            let currentCycleStart, previousCycleStart;
            
            if (now.getDate() >= 21) {
                currentCycleStart = new Date(now.getFullYear(), now.getMonth(), 21);
            } else {
                currentCycleStart = new Date(now.getFullYear(), now.getMonth() - 1, 21);
            }

            const strCurrentCycle = currentCycleStart.toISOString().split('T')[0];
            const dayId = now.toISOString().split('T')[0];

            const allBanks = await dbInstance.collection('user_banks').find({}).toArray();
            const bankMap = {};
            allBanks.forEach(b => bankMap[b.uid.toString()] = b);

            const pendingStats = await dbInstance.collection(COLL_DAILY_STATS).find({}).toArray();
            
            let nominaTotal = 0;
            let vistasTotalesHoy = 0;
            const workerMap = {};
            
            const CEO_ID = (ADMIN_CHAT_IDS && ADMIN_CHAT_IDS.length > 0) ? ADMIN_CHAT_IDS[0].toString() : "11111111";

            pendingStats.forEach(s => {
                const uid = s.uploaderId.toString();
                
                if (!workerMap[uid]) {
                    workerMap[uid] = { 
                        id: uid, 
                        name: "Uploader " + uid, 
                        deudaPendiente: 0, 
                        earnedToday: 0, 
                        totalUploads: 0,
                        vistasHoy: 0,
                        bank: bankMap[uid] || null
                    };
                }
                
                if (s.dayId >= strCurrentCycle) {
                    const earned = parseFloat(s.today_earned) || 0;
                    workerMap[uid].deudaPendiente += earned; 
                    if (uid !== CEO_ID && uid !== "00000000") nominaTotal += earned;
                }
                
                if (s.dayId === dayId) {
                    workerMap[uid].earnedToday = (s.today_earned || 0);
                    workerMap[uid].totalUploads = (s.today_content_count || 0);
                    workerMap[uid].vistasHoy = (s.total_views || 0);
                    vistasTotalesHoy += (s.total_views || 0);
                }
            });

            const hrWorkers = await dbInstance.collection('hr_workers').find({}).toArray();
            const hrMap = {};
            hrWorkers.forEach(w => hrMap[w.telegramId] = w);

            const trabajadoresArray = Object.values(workerMap).map(w => {
                const hrData = hrMap[w.id];
                if (hrData) {
                    w.name = hrData.name;
                    w.rol = hrData.role;
                } else {
                    w.rol = "Uploader Externo";
                }

                if (w.id === CEO_ID) {
                    w.rol = "Admin CEO";
                    w.name = "CEO (Tú)";
                } else if (w.id === "00000000") {
                    w.rol = "Co-Fundador / CEO Secundario";
                    if (!hrData) w.name = "Nadia";
                }

                w.trend = w.earnedToday > 5 ? 'up' : (w.earnedToday > 1 ? 'neutral' : 'down');
                return w;
            });

            const corpDoc = await dbInstance.collection(COLL_CORP_REVENUE).findOne({ dayId: dayId });
            let ingresosHoyEmpresa = corpDoc ? (corpDoc.today_earned || 0) : 0; 
            let peticionesTotales = corpDoc ? (corpDoc.total_requests || 0) : 0;

            const historicalCorp = await dbInstance.collection(COLL_CORP_REVENUE).aggregate([
                { $group: { _id: null, total: { $sum: "$today_earned" } } }
            ]).toArray();
            let ingresosHistoricos = historicalCorp.length > 0 ? historicalCorp[0].total : 0;

            if (ingresosHistoricos === 0) ingresosHistoricos = ingresosHoyEmpresa;

            let cajaMes = ingresosHoyEmpresa * 30; 

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

    app.post('/api/ceo/pricing', (req, res) => {
        const { mode, customMoviePrice, customTvPrice, limit_daily, limit_monthly } = req.body;
        if (mode) globalPricing.mode = mode;
        if (customMoviePrice !== undefined) globalPricing.customMoviePrice = parseFloat(customMoviePrice);
        if (customTvPrice !== undefined) globalPricing.customTvPrice = parseFloat(customTvPrice);
        if (limit_daily !== undefined) globalPricing.limit_daily = parseFloat(limit_daily);
        if (limit_monthly !== undefined) globalPricing.limit_monthly = parseFloat(limit_monthly);
        
        res.json({ success: true, message: "Políticas aplicadas en caliente.", globalPricing });
    });

    app.post('/api/ceo/fix-balance', async (req, res) => {
        const dbInstance = typeof ctx.getMongoDb === 'function' ? ctx.getMongoDb() : ctx.mongoDb;
        if (!dbInstance) return res.status(503).json({ error: "DB no conectada" });

        const { uid, newBalance } = req.body;
        const uploaderIdInt = parseInt(uid);
        const now = new Date();
        const monthId = now.toISOString().split('T')[0].substring(0, 7);

        let currentCycleStart;
        if (now.getDate() >= 21) {
            currentCycleStart = new Date(now.getFullYear(), now.getMonth(), 21);
        } else {
            currentCycleStart = new Date(now.getFullYear(), now.getMonth() - 1, 21);
        }
        const strCurrentCycle = currentCycleStart.toISOString().split('T')[0];

        try {
            const docs = await dbInstance.collection(COLL_DAILY_STATS)
                .find({ uploaderId: uploaderIdInt, dayId: { $gte: strCurrentCycle } })
                .project({ today_earned: 1 })
                .toArray();
            
            const currentTotal = docs.reduce((sum, doc) => sum + (doc.today_earned || 0), 0);
            
            const diferencia = parseFloat(newBalance) - currentTotal;

            await dbInstance.collection(COLL_DAILY_STATS).updateOne(
                { uploaderId: uploaderIdInt, dayId: strCurrentCycle },
                { 
                    $inc: { today_earned: diferencia },
                    $setOnInsert: { monthId: monthId, today_content_count: 0 }
                },
                { upsert: true }
            );

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: "Error al corregir saldo." });
        }
    });

    app.post('/api/ceo/pay-worker', async (req, res) => {
        const dbInstance = typeof ctx.getMongoDb === 'function' ? ctx.getMongoDb() : ctx.mongoDb;
        if (!dbInstance) return res.status(503).json({ error: "DB no conectada" });

        const { uploaderId, amount, paymentMethod } = req.body;
        const uploaderIdInt = parseInt(uploaderId);
        const now = new Date();

        let currentCycleStart;
        if (now.getDate() >= 21) {
            currentCycleStart = new Date(now.getFullYear(), now.getMonth(), 21);
        } else {
            currentCycleStart = new Date(now.getFullYear(), now.getMonth() - 1, 21);
        }
        const strCurrentCycle = currentCycleStart.toISOString().split('T')[0];

        try {
            const payoutRecord = {
                uploaderId: uploaderIdInt,
                amountPaid: parseFloat(amount),
                paymentMethod: paymentMethod || "Transferencia Bancaria",
                status: "Pagado",
                date: now
            };
            
            await dbInstance.collection('payout_history').insertOne(payoutRecord);
            
            await dbInstance.collection(COLL_DAILY_STATS).updateMany(
                { uploaderId: uploaderIdInt, dayId: { $gte: strCurrentCycle } },
                { $set: { today_earned: 0 } }
            );

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: "Error al procesar el pago." });
        }
    });

    app.post('/api/ceo/notify-bot', async (req, res) => {
        const { message, imageUrl, targetGroup } = req.body;
        try {
            let targets = (targetGroup === 'all_admins') ? ADMIN_CHAT_IDS : [ADMIN_CHAT_IDS[0]];
            for (let chatId of targets) {
                if (imageUrl && imageUrl.trim() !== '') {
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
