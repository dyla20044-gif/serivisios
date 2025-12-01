function initializeBot(bot, db, mongoDb, adminState, ADMIN_CHAT_ID, TMDB_API_KEY, RENDER_BACKEND_URL, axios) {

    console.log("🤖 Bot de Administración Sala Cine: LISTO");

    // === COMANDOS DEL MENÚ ===
    bot.setMyCommands([
        { command: 'start', description: 'Panel de Administrador' },
        { command: 'pedidos', description: 'Ver solicitudes pendientes' }
    ]);

    // =================================================================
    // 1. MENÚ PRINCIPAL (DISEÑO DE CUADRÍCULA)
    // =================================================================
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        if (chatId !== ADMIN_CHAT_ID) return; // Solo Admin

        adminState[chatId] = { step: 'menu' }; // Reiniciar estado

        const options = {
            reply_markup: {
                inline_keyboard: [
                    // Fila 1
                    [
                        { text: '🎬 Agregar Película', callback_data: 'add_movie' },
                        { text: '📺 Agregar Serie', callback_data: 'add_series' }
                    ],
                    // Fila 2
                    [
                        { text: '📋 VER PEDIDOS', callback_data: 'view_requests_menu' }, // <--- ESTE BOTÓN AHORA SÍ FUNCIONA
                        { text: '🗑️ Eliminar Contenido', callback_data: 'delete_movie' }
                    ],
                    // Fila 3
                    [
                        { text: '📲 VIVIBOX (M3U8)', callback_data: 'vivibox_add_m3u8' },
                        { text: '📄 Gestionar Manual', callback_data: 'manage_movies' }
                    ]
                ]
            }
        };
        bot.sendMessage(chatId, '👋 *Panel de Control - Sala Cine*\nSelecciona una opción:', { parse_mode: 'Markdown', ...options });
    });

    // =================================================================
    // 2. MANEJADOR DE MENSAJES (BÚSQUEDAS Y ENLACES)
    // =================================================================
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const userText = msg.text;

        if (!userText || userText.startsWith('/')) return; // Ignorar comandos aquí
        if (chatId !== ADMIN_CHAT_ID) return; // Ignorar usuarios no admins

        // --- ESTADOS DE FLUJO ---

        // A. BÚSQUEDA DE PELÍCULA
        if (adminState[chatId] && adminState[chatId].step === 'search_movie') {
            searchAndShow(chatId, userText, 'movie');
        } 
        // B. BÚSQUEDA DE SERIE
        else if (adminState[chatId] && adminState[chatId].step === 'search_series') {
            searchAndShow(chatId, userText, 'tv');
        }
        // C. BÚSQUEDA PARA ELIMINAR
        else if (adminState[chatId] && adminState[chatId].step === 'search_delete') {
            searchAndShow(chatId, userText, 'delete');
        }
        // D. BÚSQUEDA PARA GESTIONAR
        else if (adminState[chatId] && adminState[chatId].step === 'search_manage') {
            searchAndShow(chatId, userText, 'manage');
        }
        
        // E. RECIBIR ENLACE UNIFICADO (PELÍCULAS)
        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_unified_link_movie') {
            const { selectedMedia } = adminState[chatId];
            const link = userText.trim();
            const finalLink = link.toLowerCase() === 'no' ? null : link;

            // Guardamos el MISMO enlace para ambos campos
            adminState[chatId].movieDataToSave = {
                tmdbId: selectedMedia.id.toString(),
                title: selectedMedia.title,
                overview: selectedMedia.overview,
                poster_path: selectedMedia.poster_path,
                proEmbedCode: finalLink,
                freeEmbedCode: finalLink, // Duplicamos enlace
                isPremium: false
            };

            adminState[chatId].step = 'awaiting_publish_choice';
            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💾 Guardar solo en App', callback_data: 'save_only_' + selectedMedia.id }],
                        [{ text: '📲 Guardar + Notificar PUSH', callback_data: 'save_publish_and_push_' + selectedMedia.id }],
                        [{ text: '📢 Guardar + PUSH + Canal', callback_data: 'save_publish_push_channel_' + selectedMedia.id }]
                    ]
                }
            };
            bot.sendMessage(chatId, `✅ Enlace recibido para *${selectedMedia.title}*.\n(Se usará para Gratis y Premium)\n\n¿Cómo deseas guardar?`, { parse_mode: 'Markdown', ...options });
        }

        // F. RECIBIR ENLACE UNIFICADO (SERIES)
        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_unified_link_series') {
            const { selectedSeries, season, episode } = adminState[chatId];
            const link = userText.trim();
            const finalLink = link.toLowerCase() === 'no' ? null : link;

            const seriesDataToSave = {
                tmdbId: (selectedSeries.tmdbId || selectedSeries.id).toString(),
                title: selectedSeries.title || selectedSeries.name,
                poster_path: selectedSeries.poster_path,
                seasonNumber: season,
                episodeNumber: episode,
                overview: selectedSeries.overview,
                proEmbedCode: finalLink,
                freeEmbedCode: finalLink, // Duplicamos enlace
                isPremium: false
            };

            // Guardamos directamente
            try {
                await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, seriesDataToSave);
                adminState[chatId].lastSavedEpisodeData = seriesDataToSave;
                adminState[chatId].step = 'awaiting_series_action';
                
                const nextEp = episode + 1;
                const options = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `➡️ Siguiente: S${season}E${nextEp}`, callback_data: `add_next_episode_${seriesDataToSave.tmdbId}_${season}` }],
                            [{ text: `📲 Notificar PUSH`, callback_data: `publish_push_this_episode_${seriesDataToSave.tmdbId}_${season}_${episode}` }],
                            [{ text: `📢 Notificar PUSH + Canal`, callback_data: `publish_push_channel_this_episode_${seriesDataToSave.tmdbId}_${season}_${episode}` }],
                            [{ text: '⏹️ Finalizar Serie', callback_data: `finish_series_${seriesDataToSave.tmdbId}` }]
                        ]
                    }
                };
                bot.sendMessage(chatId, `✅ *S${season}E${episode}* guardado.\n¿Qué sigue?`, { parse_mode: 'Markdown', ...options });
            } catch (error) {
                bot.sendMessage(chatId, '❌ Error al guardar en base de datos.');
            }
        }

        // G. VIVIBOX
        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_vivibox_m3u8') {
             // ... Lógica Vivibox existente ...
             try {
                const response = await axios.post(`${RENDER_BACKEND_URL}/api/vivibox/add-link`, { m3u8Url: userText });
                bot.sendMessage(chatId, `✅ Vivibox ID: \`${response.data.id}\``, { parse_mode: 'Markdown' });
             } catch (e) { bot.sendMessage(chatId, 'Error Vivibox.'); }
             adminState[chatId] = { step: 'menu' };
        }
    });

    // =================================================================
    // 3. MANEJADOR DE BOTONES (CALLBACKS) - AQUÍ ESTABA EL PROBLEMA
    // =================================================================
    bot.on('callback_query', async (callbackQuery) => {
        const msg = callbackQuery.message;
        const data = callbackQuery.data;
        const chatId = msg.chat.id;

        if (chatId !== ADMIN_CHAT_ID) return; // Seguridad

        try {
            bot.answerCallbackQuery(callbackQuery.id);

            // --- A. ACCIONES DEL MENÚ PRINCIPAL ---
            if (data === 'add_movie') {
                adminState[chatId] = { step: 'search_movie' };
                bot.sendMessage(chatId, '🔎 Envía el nombre de la *PELÍCULA*:');
            }
            else if (data === 'add_series') {
                adminState[chatId] = { step: 'search_series' };
                bot.sendMessage(chatId, '🔎 Envía el nombre de la *SERIE*:');
            }
            else if (data === 'delete_movie') {
                adminState[chatId] = { step: 'search_delete' };
                bot.sendMessage(chatId, '🗑️ Envía el nombre del contenido a *ELIMINAR*:');
            }
            else if (data === 'manage_movies') {
                adminState[chatId] = { step: 'search_manage' };
                bot.sendMessage(chatId, '⚙️ Envía el nombre para *GESTIONAR*:');
            }
            else if (data === 'vivibox_add_m3u8') {
                adminState[chatId] = { step: 'awaiting_vivibox_m3u8' };
                bot.sendMessage(chatId, '🔗 Envía el enlace M3U8 o MP4:');
            }

            // --- B. MENÚ DE PEDIDOS (REPARADO) ---
            else if (data === 'view_requests_menu') {
                const options = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔥 Últimas 2 Horas', callback_data: 'req_list_2h' }],
                            [{ text: '📅 Últimas 24 Horas', callback_data: 'req_list_24h' }],
                            [{ text: '🗓️ Esta Semana', callback_data: 'req_list_7d' }],
                            [{ text: '♾️ Histórico Completo', callback_data: 'req_list_all' }],
                            [{ text: '🧹 Borrar Lista', callback_data: 'req_clear_all' }]
                        ]
                    }
                };
                // Editamos el mensaje para mostrar el submenú
                bot.editMessageText('📂 *Sistema de Pedidos*\nSelecciona un filtro de tiempo:', {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: options.reply_markup
                });
            }

            // --- C. LISTAR PEDIDOS (LÓGICA) ---
            else if (data.startsWith('req_list_')) {
                const type = data.split('_')[2];
                let dateFilter = new Date();
                let label = "";

                if (type === '2h') { dateFilter.setHours(dateFilter.getHours() - 2); label = "2 Horas"; }
                else if (type === '24h') { dateFilter.setHours(dateFilter.getHours() - 24); label = "24 Horas"; }
                else if (type === '7d') { dateFilter.setDate(dateFilter.getDate() - 7); label = "Semana"; }
                else { dateFilter = new Date(0); label = "Histórico"; }

                const requestsCollection = mongoDb.collection('movie_requests');
                // Buscamos pedidos
                const requests = await requestsCollection
                    .find({ lastRequestedAt: { $gte: dateFilter } })
                    .sort({ requestCount: -1 }) // Más pedidos primero
                    .limit(10)
                    .toArray();

                if (requests.length === 0) {
                    bot.sendMessage(chatId, `📭 No hay pedidos en: ${label}`);
                    return;
                }

                let text = `📊 *Pedidos (${label})*\n\n`;
                const buttons = [];
                requests.forEach((req, i) => {
                    const icon = req.latestPriority === 'premium' ? '👑' : '👤';
                    text += `${i+1}. ${icon} *${req.title}* - (${req.requestCount} pedidos)\n`;
                    // Botón para agregar directamente
                    buttons.push([{ text: `➕ Subir: ${req.title}`, callback_data: `add_new_movie_${req.tmdbId}` }]);
                });
                buttons.push([{ text: '🔙 Volver', callback_data: 'view_requests_menu' }]);

                bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
            }
            
            else if (data === 'req_clear_all') {
                await mongoDb.collection('movie_requests').deleteMany({});
                bot.sendMessage(chatId, '🧹 Lista de pedidos borrada.');
            }

            // --- D. AGREGAR CONTENIDO (CALLBACKS) ---
            else if (data.startsWith('add_new_movie_')) {
                const tmdbId = data.split('_')[3];
                // Obtenemos info y pedimos enlace
                const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
                const res = await axios.get(url);
                adminState[chatId] = {
                    step: 'awaiting_unified_link_movie', // <--- Flujo unificado
                    selectedMedia: res.data
                };
                bot.sendMessage(chatId, `🎬 *${res.data.title}*\n\n🔗 Envía el enlace (M3U8/MP4).\n(Se usará para Gratis y Pro).`);
            }
            
            else if (data.startsWith('add_new_series_')) {
                 const tmdbId = data.split('_')[3];
                 await handleManageSeries(chatId, tmdbId);
            }

            // --- E. GUARDAR Y PUBLICAR (PELICULAS) ---
            else if (data.startsWith('save_only_')) {
                const { movieDataToSave } = adminState[chatId];
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                bot.sendMessage(chatId, '✅ Guardado en App.');
                adminState[chatId] = { step: 'menu' };
            }
            else if (data.startsWith('save_publish_and_push_')) {
                const { movieDataToSave } = adminState[chatId];
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                await sendPush(movieDataToSave, 'movie');
                bot.sendMessage(chatId, '✅ Guardado + PUSH enviado.');
                adminState[chatId] = { step: 'menu' };
            }
            else if (data.startsWith('save_publish_push_channel_')) {
                const { movieDataToSave } = adminState[chatId];
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                await sendPush(movieDataToSave, 'movie');
                await sendToChannel(movieDataToSave, 'movie');
                bot.sendMessage(chatId, '✅ Guardado + PUSH + Canal.');
                adminState[chatId] = { step: 'menu' };
            }

            // --- F. GESTION DE SERIES (TEMPORADAS Y EPISODIOS) ---
            else if (data.startsWith('manage_season_')) {
                const [_, __, tmdbId, season] = data.split('_');
                const { selectedSeries } = adminState[chatId];
                
                // Calcular siguiente episodio
                const doc = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
                let lastEp = 0;
                if(doc?.seasons?.[season]?.episodes) {
                    lastEp = Math.max(0, ...Object.keys(doc.seasons[season].episodes).map(Number));
                }
                const nextEp = lastEp + 1;

                adminState[chatId] = {
                    ...adminState[chatId],
                    step: 'awaiting_unified_link_series', // <--- Flujo unificado
                    season: parseInt(season),
                    episode: nextEp
                };
                bot.sendMessage(chatId, `📺 *${selectedSeries.name}* (T${season})\nAgregando Episodio *${nextEp}*.\n\n🔗 Envía el enlace:`);
            }
            
            else if (data.startsWith('add_next_episode_')) {
                const [_, __, ___, tmdbId, season] = data.split('_');
                // Lógica igual a manage_season para incrementar
                const doc = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
                let lastEp = 0;
                if(doc?.seasons?.[season]?.episodes) {
                    lastEp = Math.max(0, ...Object.keys(doc.seasons[season].episodes).map(Number));
                }
                const nextEp = lastEp + 1;
                
                adminState[chatId].episode = nextEp; // Actualizamos estado
                adminState[chatId].step = 'awaiting_unified_link_series';
                bot.sendMessage(chatId, `📺 Siguiente: *S${season}E${nextEp}*. Envía enlace:`);
            }

            // --- G. PUBLICAR SERIES ---
            else if (data.startsWith('publish_push_this_episode_')) {
                const epData = adminState[chatId].lastSavedEpisodeData;
                await sendPush(epData, 'tv');
                bot.sendMessage(chatId, '✅ PUSH enviada.');
            }
            else if (data.startsWith('publish_push_channel_this_episode_')) {
                const epData = adminState[chatId].lastSavedEpisodeData;
                await sendPush(epData, 'tv');
                await sendToChannel(epData, 'tv');
                bot.sendMessage(chatId, '✅ PUSH + Canal enviados.');
            }
            else if (data.startsWith('finish_series_')) {
                bot.sendMessage(chatId, '✅ Serie finalizada.');
                adminState[chatId] = { step: 'menu' };
            }

            // --- H. CONFIRMAR ELIMINACIÓN ---
            else if (data.startsWith('delete_confirm_')) {
                const [_, __, id, type] = data.split('_');
                const col = type === 'movie' ? 'media_catalog' : 'series_catalog';
                await mongoDb.collection(col).deleteOne({ tmdbId: id });
                bot.sendMessage(chatId, '🗑️ Eliminado correctamente.');
                adminState[chatId] = { step: 'menu' };
            }

        } catch (error) {
            console.error("Error Callback:", error);
            bot.sendMessage(chatId, '❌ Error en la acción.');
        }
    });

    // =================================================================
    // FUNCIONES AUXILIARES
    // =================================================================

    async function searchAndShow(chatId, query, type) {
        try {
            const endpoint = type === 'delete' || type === 'manage' ? 'multi' : type;
            const url = `https://api.themoviedb.org/3/search/${endpoint}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&language=es-ES`;
            const res = await axios.get(url);
            const results = res.data.results?.slice(0, 5) || [];
            
            if (results.length === 0) {
                bot.sendMessage(chatId, 'No encontrado.');
                return;
            }

            for (const item of results) {
                if (type === 'delete' || type === 'manage') {
                    if (item.media_type !== 'movie' && item.media_type !== 'tv') continue;
                }
                
                const title = item.title || item.name;
                const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                let btnText = '✅ Seleccionar';
                let callback = '';

                if (type === 'movie') callback = `add_new_movie_${item.id}`;
                else if (type === 'tv') callback = `add_new_series_${item.id}`;
                else if (type === 'delete') {
                    btnText = '❌ ELIMINAR';
                    callback = `delete_confirm_${item.id}_${item.media_type}`;
                }
                else if (type === 'manage') {
                     btnText = '⚙️ Gestionar';
                     // Lógica simplificada: redirigir a agregar (editará si existe)
                     callback = item.media_type === 'movie' ? `add_new_movie_${item.id}` : `add_new_series_${item.id}`;
                }

                bot.sendPhoto(chatId, poster, {
                    caption: `*${title}*\n${item.overview?.substring(0, 100)}...`,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: btnText, callback_data: callback }]] }
                });
            }
        } catch (e) { bot.sendMessage(chatId, 'Error buscando.'); }
    }

    async function handleManageSeries(chatId, tmdbId) {
        const url = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
        const res = await axios.get(url);
        adminState[chatId] = {
            ...adminState[chatId],
            selectedSeries: res.data
        };
        const buttons = res.data.seasons
            .filter(s => s.season_number > 0)
            .map(s => [{ text: `📂 Temporada ${s.season_number}`, callback_data: `manage_season_${tmdbId}_${s.season_number}` }]);
        
        bot.sendMessage(chatId, `📺 *${res.data.name}*\nSelecciona temporada:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
    }

    async function sendPush(data, type) {
        try {
            await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                title: "¡Nuevo Contenido!",
                body: `Disponible: ${data.title}`,
                imageUrl: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
                tmdbId: data.tmdbId,
                mediaType: type
            });
        } catch (e) { console.error("Push Error", e.message); }
    }

    async function sendToChannel(data, type) {
        const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_A_ID; 
        if (!CHANNEL_ID) return;
        const link = `${RENDER_BACKEND_URL}/app/details/${data.tmdbId}`;
        await bot.sendPhoto(CHANNEL_ID, `https://image.tmdb.org/t/p/w500${data.poster_path}`, {
            caption: `🎬 *¡ESTRENO!* ${data.title}\n\nVer ahora en Sala Cine.`,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '▶️ Ver Ahora', url: link }]] }
        });
    }

}

module.exports = initializeBot;
