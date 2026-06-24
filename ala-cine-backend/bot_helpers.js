module.exports = function(botCtx) {
    const { bot, mongoDb, adminState, ADMIN_CHAT_IDS, COMMUNITY_GROUP_ID, TMDB_API_KEY, axios, RENDER_BACKEND_URL } = botCtx;

    // =========================================================
    // COLA DE SUBIDAS (BATCH UPLOADS)
    // =========================================================
    let uploadQueue = [];
    
    if (COMMUNITY_GROUP_ID) {
        setInterval(() => {
            if (uploadQueue.length > 0) {
                let mensaje = "🚀 **¡NUEVO CONTENIDO AÑADIDO!** 🚀\n\nAcabamos de subir todo esto a la bóveda de Sala Cine:\n\n";
                
                uploadQueue.forEach(item => {
                    const icon = item.isMovie ? '🎬' : '📺';
                    mensaje += `${icon} *${item.title}*\n`;
                });
                
                mensaje += `\n👇🏻 **MIRA TODO AQUÍ** 👇🏻`;
                
                const smartLink = `${RENDER_BACKEND_URL}/app/details/0`; 

                bot.sendMessage(COMMUNITY_GROUP_ID, mensaje, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[{ text: '▶️ Abrir Sala Cine', url: smartLink }]]
                    }
                }).catch(e => console.error("Error enviando resumen de cola masiva:", e.message));

                uploadQueue = []; 
            }
        }, 900000); 
    }

    const clearLiveCache = () => {
        try {
            if (typeof global !== 'undefined' && global.ctx && global.ctx.caches && global.ctx.caches.liveCache) {
                global.ctx.caches.liveCache.del('current_live_feed');
                console.log("[Bot] liveCache limpiado (vía global.ctx).");
            } else if (typeof ctx !== 'undefined' && ctx.caches && ctx.caches.liveCache) {
                ctx.caches.liveCache.del('current_live_feed');
                console.log("[Bot] liveCache limpiado (vía ctx local).");
            }
        } catch (e) {
            console.warn("[Bot] Excepción intentando limpiar liveCache:", e.message);
        }
    };

    const clearAllCaches = () => {
        try {
            if (typeof global !== 'undefined' && global.ctx && global.ctx.caches) {
                if(global.ctx.caches.requestsCache) global.ctx.caches.requestsCache.flushAll();
                if(global.ctx.caches.recentCache) global.ctx.caches.recentCache.flushAll();
                if(global.ctx.caches.catalogCache) global.ctx.caches.catalogCache.flushAll();
                if(global.ctx.caches.countsCache) global.ctx.caches.countsCache.flushAll();
                console.log("[Bot] Cachés generales limpiados exitosamente.");
            } else if (typeof ctx !== 'undefined' && ctx.caches) {
                if(ctx.caches.requestsCache) ctx.caches.requestsCache.flushAll();
                if(ctx.caches.recentCache) ctx.caches.recentCache.flushAll();
                if(ctx.caches.catalogCache) ctx.caches.catalogCache.flushAll();
                if(ctx.caches.countsCache) ctx.caches.countsCache.flushAll();
                console.log("[Bot] Cachés locales limpiados exitosamente.");
            }
        } catch (e) {
            console.warn("[Bot] Excepción intentando limpiar cachés:", e.message);
        }
    };

    function getMainMenuKeyboard(chatId) {
        // Enlace de la Web App apuntando a tu servidor Render
        const webAppUrl = `${RENDER_BACKEND_URL || 'https://serivisios.onrender.com'}/admin/pedidos`;

        const inline_keyboard = [
            // Fila 1: Subidas de Contenido (Grilla de 3)
            [
                { text: '🎬 + Peli', callback_data: 'add_movie' },
                { text: '📺 + Serie', callback_data: 'add_series' },
                { text: '📁 + Manual', callback_data: 'add_manual_movie' }
            ],
            // Fila 2: Web App de Pedidos y Ganancias (Grilla de 2)
            [
                { text: '🌟 Abrir Pedidos', web_app: { url: webAppUrl } },
                { text: '💰 Mis Ganancias', callback_data: 'view_earnings' }
            ]
        ];

        // Opciones exclusivas del Admin Principal
        if (chatId === ADMIN_CHAT_IDS[0]) {
            const adminRow = [];
            if (ADMIN_CHAT_IDS.length > 1) {
                adminRow.push({ text: '📊 Ganancias Ad 2', callback_data: 'view_admin2_earnings' });
            }
            adminRow.push({ text: '🎁 Bonos', callback_data: 'manage_bonus_menu' });
            inline_keyboard.push(adminRow);
            
            inline_keyboard.push([{ text: '📡 Gestionar Hub Especial', callback_data: 'manage_special_hub' }]);
        }

        // Fila de Notificaciones y Comunicados (Grilla de 2)
        inline_keyboard.push([
            { text: '📢 Alerta Global', callback_data: 'send_global_msg' },
            { text: '📰 Comunicados App', callback_data: 'cms_announcement_menu' }
        ]);

        // NUEVO: Fila de Mensajería Corporativa / Chat Interno
        inline_keyboard.push([
            { text: '💬 Mensajería Corporativa', callback_data: 'corp_chat_start' }
        ]);

        // Fila de Eliminar (Única para evitar accidentes)
        inline_keyboard.push([
            { text: '🗑️ Eliminar Película/Serie', callback_data: 'delete_movie' }
        ]);
        
        return inline_keyboard;
    }

    async function showEarningsPanel(targetUploaderId, uploaderName, requestChatId) {
        bot.sendMessage(requestChatId, '⏳ Calculando estadísticas financieras...');
                
        const now = new Date();
        const dayId = now.toISOString().split('T')[0];
        const monthId = dayId.substring(0, 7);

        try {
            const historicalStats = await mongoDb.collection('uploader_revenue').aggregate([
                { $match: { uploaderId: targetUploaderId } },
                { $group: {
                    _id: null,
                    totalEarned: { $sum: "$earned" },
                    totalMovies: { $sum: { $cond: [{ $eq: ["$mediaType", "movie"] }, 1, 0] } },
                    totalEpisodes: { $sum: { $cond: [{ $eq: ["$mediaType", "tv"] }, 1, 0] } },
                    bonusTotal: { $sum: { $cond: [{ $eq: ["$mediaType", "bonus"] }, "$earned", 0] } }
                }}
            ]).toArray();

            const hist = historicalStats[0] || { totalEarned: 0, totalMovies: 0, totalEpisodes: 0, bonusTotal: 0 };

            const todayStats = await mongoDb.collection('uploader_daily_stats').findOne({ uploaderId: targetUploaderId, dayId });
            const todayEarned = todayStats?.today_earned || 0;

            const monthlyDocs = await mongoDb.collection('uploader_daily_stats')
                .find({ uploaderId: targetUploaderId, monthId })
                .toArray();
            const monthEarned = monthlyDocs.reduce((sum, doc) => sum + (doc.today_earned || 0), 0);

            // NUEVO: Consultar historial de pagos (Últimos 3)
            const paymentHistory = await mongoDb.collection('payment_history')
                .find({ uploaderId: targetUploaderId })
                .sort({ date: -1 })
                .limit(3)
                .toArray();

            let historyText = "\n🧾 *ÚLTIMOS PAGOS:*\n";
            if (paymentHistory.length > 0) {
                historyText += paymentHistory.map(p => `├ 📅 ${p.dateStr}: $${p.amount.toFixed(2)}`).join('\n') + `\n`;
            } else {
                historyText += `├ No hay pagos registrados aún.\n`;
            }

            const msgEarnings = `📊 *REPORTE FINANCIERO UPLOADER* 📊\n` +
                                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                                `👤 *Usuario:* \`${uploaderName}\`\n` +
                                `🆔 *ID:* \`${targetUploaderId}\`\n\n` +
                                `💰 *INGRESOS ACTUALES*\n` +
                                `├ 💵 *Hoy:* $${todayEarned.toFixed(2)} USD\n` +
                                `└ 📅 *Este Ciclo:* $${monthEarned.toFixed(2)} USD\n\n` +
                                `📈 *ESTADÍSTICAS HISTÓRICAS*\n` +
                                `├ 🏆 *Total Generado:* $${hist.totalEarned.toFixed(2)} USD\n` +
                                `├ 🎁 *Bonos Recibidos:* $${(hist.bonusTotal || 0).toFixed(2)} USD\n` +
                                `├ 🎬 *Películas Subidas:* ${hist.totalMovies}\n` +
                                `└ 📺 *Episodios Subidos:* ${hist.totalEpisodes}\n` +
                                historyText + `\n` +
                                `🚀 *LÍMITES DE CUENTA*\n` +
                                `├ ⏱️ *Diario:* $40.00 USD\n` +
                                `└ 🗓️ *Mensual:* $500.00 USD\n` +
                                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                                `💳 *INFORMACIÓN DE PAGOS:*\n` +
                                `Las fechas de corte son del *21 al 25* de cada mes.\n` +
                                `👉 Solicita tu retiro con: @Dylan_1m_oficial`;

            // NUEVO: Configurar foto de perfil personalizada
            const workerPhotos = {
                [ADMIN_CHAT_IDS[1]]: 'https://iili.io/CTsdfdN.jpg' // REEMPLAZAR CON LA URL REAL DE LA FOTO
            };
            const bannerUrl = workerPhotos[targetUploaderId] || 'https://i.ibb.co/Nd24c62C/Gemini-Generated-Image-49psui49psui49ps-Photoroom.png';

            // NUEVO: Botón de Pagar (Solo visible para ti si estás viendo las stats del otro admin)
            let options = { parse_mode: 'Markdown' };
            if (requestChatId === ADMIN_CHAT_IDS[0] && targetUploaderId !== ADMIN_CHAT_IDS[0]) {
                options.reply_markup = {
                    inline_keyboard: [
                        [{ text: '💸 Pagar y Reiniciar Ciclo', callback_data: `pay_uploader_${targetUploaderId}_${monthEarned}` }]
                    ]
                };
            }

            bot.sendPhoto(requestChatId, bannerUrl, { 
                caption: msgEarnings, 
                ...options 
            }).catch(e => {
                bot.sendMessage(requestChatId, msgEarnings, options);
            });

        } catch (error) {
            console.error("Error al consultar ganancias desde helpers:", error);
            bot.sendMessage(requestChatId, '❌ Ocurrió un error al consultar la base de datos de ganancias.');
        }
    }

    async function sendFinalSummary(chatId, title, isMovie = true, promptMsgId = null) {
        try {
            if (COMMUNITY_GROUP_ID) {
                uploadQueue.push({ title, isMovie });
            }

            const now = new Date();
            const dayId = now.toISOString().split('T')[0];
            const todayStats = await mongoDb.collection('uploader_daily_stats').findOne({ uploaderId: chatId, dayId });
            const todayEarned = todayStats?.today_earned || 0;

            const icon = isMovie ? '🎬' : '📺';
            const typeText = isMovie ? 'Película' : 'Episodio';

            const summaryText = `✅ **¡SUBIDA EXITOSA!** ✅\n` +
                                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                                `${icon} *${typeText}:* ${title}\n` +
                                `✨ *Estado:* ¡Ya está disponible en la app!\n` +
                                `💰 *Ganancia registrada:* (Actualizada por servidor)\n` +
                                `💵 *Saldo Total de Hoy:* $${todayEarned.toFixed(2)} USD\n` +
                                `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                `¿Qué deseas subir ahora?`;

            const continuousKeyboard = isMovie ? [
                [{ text: '🎬 Subir otra Película', callback_data: 'add_movie' }],
                [{ text: '📺 Subir una Serie', callback_data: 'add_series' }]
            ] : [
                [{ text: '📺 Subir otra Serie', callback_data: 'add_series' }],
                [{ text: '🎬 Subir una Película', callback_data: 'add_movie' }]
            ];

            const options = {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: continuousKeyboard
                }
            };

            if (promptMsgId) {
                await bot.editMessageText(summaryText, { chat_id: chatId, message_id: promptMsgId, ...options }).catch(async () => {
                    await bot.sendMessage(chatId, summaryText, options);
                });
            } else {
                await bot.sendMessage(chatId, summaryText, options);
            }
        } catch (err) {
            console.error("Error al enviar resumen final:", err);
            const fallbackKeyboard = isMovie ? [
                [{ text: '🎬 Subir otra Película', callback_data: 'add_movie' }],
                [{ text: '📺 Subir una Serie', callback_data: 'add_series' }]
            ] : [
                [{ text: '📺 Subir otra Serie', callback_data: 'add_series' }],
                [{ text: '🎬 Subir una Película', callback_data: 'add_movie' }]
            ];
            bot.sendMessage(chatId, `✅ **¡SUBIDA EXITOSA!**\n\n${title} ya está disponible en la app.\n\n¿Qué deseas subir ahora?`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: fallbackKeyboard } });
        }
    }

    async function handleManageSeries(chatId, tmdbId) {
        try {
            const seriesUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
            const response = await axios.get(seriesUrl);
            const seriesData = response.data;
            if (!seriesData || !seriesData.seasons) {
                bot.sendMessage(chatId, 'Error: No se encontraron detalles o temporadas para esa serie.');
                return;
            }

            const genreIds = seriesData.genres ? seriesData.genres.map(g => g.id) : [];
            const originCountries = seriesData.origin_country || [];

            adminState[chatId] = {
                ...adminState[chatId],
                selectedSeries: {
                    id: seriesData.id,
                    tmdbId: seriesData.id.toString(),
                    name: seriesData.name,
                    title: seriesData.name,
                    overview: seriesData.overview,
                    poster_path: seriesData.poster_path,
                    backdrop_path: seriesData.backdrop_path,
                    genres: genreIds,
                    first_air_date: seriesData.first_air_date,
                    popularity: seriesData.popularity,
                    vote_average: seriesData.vote_average,
                    origin_country: originCountries
                }
            };
            const seasonButtons = seriesData.seasons
                .filter(s => s.season_number > 0)
                .map(season => {
                    return [{
                        text: `S${season.season_number} - ${season.name} (${season.episode_count} eps)`,
                        callback_data: `manage_season_${tmdbId}_${season.season_number}`
                    }];
                });
            if (seasonButtons.length === 0) {
                bot.sendMessage(chatId, `La serie *${seriesData.name}* no parece tener temporadas (aparte de S0).`, { parse_mode: 'Markdown' });
                return;
            }
            const options = {
                reply_markup: {
                    inline_keyboard: seasonButtons
                }
            };
            bot.sendMessage(chatId, `Gestionando: *${seriesData.name}*\n🌍 Países: ${originCountries.join(', ')}\n\nSelecciona la temporada:`, { ...options, parse_mode: 'Markdown' });

        } catch (error) {
            console.error("Error al obtener detalles de TMDB en handleManageSeries:", error.message);
            bot.sendMessage(chatId, 'Error al obtener los detalles de la serie desde TMDB.');
        }
    }

    return {
        clearLiveCache,
        clearAllCaches,
        getMainMenuKeyboard,
        showEarningsPanel,
        sendFinalSummary,
        handleManageSeries
    };
};
