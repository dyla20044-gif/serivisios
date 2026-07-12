module.exports = function(botCtx) {
    const { bot, mongoDb, adminState, ADMIN_CHAT_IDS, COMMUNITY_GROUP_ID, TMDB_API_KEY, axios, RENDER_BACKEND_URL } = botCtx;
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
        const webAppUrl = `${RENDER_BACKEND_URL || 'https://serivisios.onrender.com'}/admin/pedidos`;

        const inline_keyboard = [
            [
                { text: '🎬 + Peli', callback_data: 'add_movie' },
                { text: '📺 + Serie', callback_data: 'add_series' },
                { text: '📁 + Manual', callback_data: 'add_manual_movie' }
            ],
            [
                { text: '🌟 Abrir Pedidos', web_app: { url: webAppUrl } },
                { text: '💰 Mis Ganancias', callback_data: 'view_earnings' }
            ]
        ];

        // 🟢 MODIFICACIÓN CRÍTICA: Ocultamos el botón corporativo dentro de este bloque
        // Solo el Admin 1 verá estos botones.
        if (chatId === ADMIN_CHAT_IDS[0]) {
            const adminRow = [];
            if (ADMIN_CHAT_IDS.length > 1) {
                adminRow.push({ text: '📊 Ganancias Ad 2', callback_data: 'view_admin2_earnings' });
            }
            adminRow.push({ text: '🎁 Bonos', callback_data: 'manage_bonus_menu' });
            inline_keyboard.push(adminRow);
            
            inline_keyboard.push([{ text: '📡 Gestionar Hub Especial', callback_data: 'manage_special_hub' }]);
            
            // 👉 El botón se movió aquí, exclusivo para Admin 1
            inline_keyboard.push([
                { text: '💬 Mensajería Corporativa', callback_data: 'corp_chat_start' }
            ]);
        }

        inline_keyboard.push([
            { text: '📢 Alerta Global', callback_data: 'send_global_msg' },
            { text: '📰 Comunicados App', callback_data: 'cms_announcement_menu' }
        ]);

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

            const workerPhotos = {
                [ADMIN_CHAT_IDS[1]]: 'https://iili.io/CTsdfdN.jpg' 
            };
            const bannerUrl = workerPhotos[targetUploaderId] || 'https://i.ibb.co/Nd24c62C/Gemini-Generated-Image-49psui49psui49ps-Photoroom.png';

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
    async function runAutoPoster(channelId) {
        try {
            let trendingTmdbIds = [];
            try {
                const trendingUrl = `https://api.themoviedb.org/3/trending/movie/day?api_key=${TMDB_API_KEY}&language=es-ES`;
                const trendRes = await axios.get(trendingUrl);
                if (trendRes.data && trendRes.data.results) {
                    trendingTmdbIds = trendRes.data.results.slice(0, 10).map(m => m.id.toString());
                }
            } catch (e) { 
                console.warn("[Auto-Poster] Error obteniendo tendencias TMDB:", e.message); 
            }
            const recentPosts = await mongoDb.collection('autopost_history').find().sort({ timestamp: -1 }).limit(80).toArray();
            const recentIds = recentPosts.map(p => p.tmdbId);
            const linkRegex = /\.(mp4|mkv|avi|m3u8)/i;
            
            const pipeline = [
                { $match: { tmdbId: { $nin: recentIds } } },
                { $match: { 
                    $or: [
                        { freeEmbedCode: { $regex: linkRegex } },
                        { proEmbedCode: { $regex: linkRegex } },
                        { links: { $elemMatch: { $regex: linkRegex } } }
                    ]
                }},
                { $addFields: { is2026: { $cond: [{ $regexMatch: { input: "$release_date", regex: /^2026/ } }, 1, 0] } } },
    
                { $sort: { is2026: -1, release_date: -1 } },
                { $limit: 20 } 
            ];

            const candidates = await mongoDb.collection('media_catalog').aggregate(pipeline).toArray();

            if (candidates.length === 0) {
                console.log("[Auto-Poster] No hay películas candidatas nuevas. Esperando próximo ciclo.");
                return;
            }
            const selectedMovie = candidates[Math.floor(Math.random() * Math.min(candidates.length, 5))];

            const isTrending = trendingTmdbIds.includes(selectedMovie.tmdbId);
            const posterUrl = selectedMovie.poster_path ? (selectedMovie.poster_path.startsWith('http') ? selectedMovie.poster_path : `https://image.tmdb.org/t/p/w500${selectedMovie.poster_path}`) : 'https://placehold.co/500x750?text=SALA+CINE';
    
            let overview = selectedMovie.overview || "Una increíble historia te espera...";
            if (overview.length > 160) {
                overview = overview.substring(0, 157) + "...";
            }

            const releaseYear = selectedMovie.release_date ? selectedMovie.release_date.substring(0, 4) : "";
            const rawAppLink = "https://play.google.com/store/apps/details?id=com.salacine.app";

            let messageText = "";
            if (isTrending) {
                messageText = `🔥 **¡MOMENTO DE TENDENCIA!** 🔥\n\n` +
                              `Esta película está siendo muy popular en este momento, ¡vayan a verla antes de que se la cuenten!\n\n` +
                              `🎬 *${selectedMovie.title}* ${releaseYear ? `(${releaseYear})` : ''}\n\n` +
                              `📝 _${overview}_\n\n` +
                              `👇👇👇 **DESCÁRGALA Y MÍRALA AQUÍ:** 👇👇👇\n` +
                              `${rawAppLink}`;
            } else {
                messageText = `🎬 *${selectedMovie.title}* ${releaseYear ? `(${releaseYear})` : ''}\n\n` +
                              `📝 _${overview}_\n\n` +
                              `👇👇👇 **MIRA LA PELÍCULA AQUÍ:** 👇👇👇\n` +
                              `${rawAppLink}`;
            }
            const sentMsg = await bot.sendPhoto(channelId, posterUrl, {
                caption: messageText,
                parse_mode: 'Markdown'
            });
            await mongoDb.collection('active_posts').insertOne({
                messageId: sentMsg.message_id,
                chatId: channelId,
                timestamp: Date.now(),
                tmdbId: selectedMovie.tmdbId
            });
            await mongoDb.collection('autopost_history').insertOne({
                tmdbId: selectedMovie.tmdbId,
                timestamp: Date.now()
            });

            console.log(`[Auto-Poster] Publicada: ${selectedMovie.title} en el canal ${channelId}`);

        } catch (error) {
            console.error("[Auto-Poster] Error en runAutoPoster:", error.message);
        }
    }
    async function cleanupOldAutoPosts() {
        try {
            const fourHoursAgo = Date.now() - (4 * 60 * 60 * 1000);
            const oldPosts = await mongoDb.collection('active_posts').find({ timestamp: { $lt: fourHoursAgo } }).toArray();
            
            for (const post of oldPosts) {
                try {
                    await bot.deleteMessage(post.chatId, post.messageId);
                    console.log(`[Auto-Cleaner] Post ${post.messageId} eliminado exitosamente del canal ${post.chatId}`);
                } catch (e) {
                    console.warn(`[Auto-Cleaner] No se pudo borrar el mensaje ${post.messageId} en ${post.chatId} (quizás ya fue borrado manualmente).`);
                }
                await mongoDb.collection('active_posts').deleteOne({ _id: post._id });
            }
        } catch (error) {
            console.error("[Auto-Cleaner] Error general limpiando mensajes:", error.message);
        }
    }

    return {
        clearLiveCache,
        clearAllCaches,
        getMainMenuKeyboard,
        showEarningsPanel,
        sendFinalSummary,
        handleManageSeries,
        runAutoPoster,         
        cleanupOldAutoPosts    
    };
};
