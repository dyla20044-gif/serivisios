function initializeBot(bot, db, mongoDb, adminState, ADMIN_CHAT_ID, TMDB_API_KEY, RENDER_BACKEND_URL, axios) {

    console.log("🤖 Lógica del Bot inicializada y escuchando...");
    bot.setMyCommands([
        { command: 'start', description: 'Reiniciar el bot y ver el menú' },
        { command: 'subir', description: 'Subir contenido' },
        { command: 'pedidos', description: 'Ver solicitudes de usuarios' }
    ]);

    // === LÓGICA DE ADMIN: /start y /subir ===
    bot.onText(/\/start|\/subir/, (msg) => {
        const chatId = msg.chat.id;
        
        // --- FILTRO DE ADMIN ---
        if (chatId !== ADMIN_CHAT_ID) {
            return; 
        }

        adminState[chatId] = { step: 'menu' };
        
        // --- MENÚ PRINCIPAL RE-DISEÑADO (CUADRÍCULA) ---
        const options = {
            reply_markup: {
                inline_keyboard: [
                    // Fila 1: Agregar contenido
                    [
                        { text: '🎬 Agregar Película', callback_data: 'add_movie' },
                        { text: '📺 Agregar Serie', callback_data: 'add_series' }
                    ],
                    // Fila 2: Gestión y Pedidos
                    [
                        { text: '📋 Ver Pedidos', callback_data: 'view_requests_menu' },
                        { text: '🗑️ Eliminar Contenido', callback_data: 'delete_movie' }
                    ],
                    // Fila 3: Herramientas Extra
                    [
                        { text: '📲 VIVIBOX: Subir M3U8', callback_data: 'vivibox_add_m3u8' }
                    ]
                ]
            }
        };
        bot.sendMessage(chatId, '👋 *Panel de Administración Sala Cine*\n\nSelecciona una opción:', { parse_mode: 'Markdown', ...options });
    });

    // === MANEJADOR PRINCIPAL DE MENSAJES ===
    bot.on('message', async (msg) => {

        // --- LÓGICA DE MODERACIÓN (Anti-Enlaces en grupos públicos) ---
        const hasLinks = msg.entities && msg.entities.some(
            e => e.type === 'url' || e.type === 'text_link' || e.type === 'mention'
        );
        const isNotAdmin = msg.from.id !== ADMIN_CHAT_ID;

        if (hasLinks && isNotAdmin) {
            try {
                await bot.deleteMessage(msg.chat.id, msg.message_id);
                const warningMessage = await bot.sendMessage(msg.chat.id, `@${msg.from.username || msg.from.first_name}, no se permite enviar enlaces en este grupo.`);
                setTimeout(() => bot.deleteMessage(warningMessage.chat.id, warningMessage.message_id).catch(() => {}), 5000);
            } catch (e) { /* Ignorar error */ }
            return; 
        }

        const chatId = msg.chat.id;
        const userText = msg.text;

        if (!userText) return;

        // --- LÓGICA PÚBLICA (Comandos para usuarios) ---
        if (userText.startsWith('/')) {
            const command = userText.split(' ')[0];
            if (chatId !== ADMIN_CHAT_ID) {
                if (command === '/start' || command === '/ayuda') {
                    const helpMessage = `👋 ¡Hola! Soy el Asistente de Sala Cine.\n\nSi deseas ingresar al canal, solicita unirte y te aceptaré automáticamente.`;
                    bot.sendMessage(chatId, helpMessage);
                    return; 
                }
                if (command === '/contacto') {
                    bot.sendMessage(chatId, 'Soporte: @TuUsuarioDeTelegram'); // CAMBIAR POR TU USER
                    return; 
                }
            }
        }

        // --- LÓGICA DE ADMIN (Protegida) ---
        if (chatId !== ADMIN_CHAT_ID) {
             if (userText.startsWith('/')) bot.sendMessage(chatId, '⛔ No tienes permiso.');
            return;
        }

        if (userText.startsWith('/')) return; // Los comandos se manejan arriba

        // ================================================================
        // === MÁQUINA DE ESTADOS (FLUJO DE PASOS) ===
        // ================================================================
        
        // 1. BÚSQUEDA DE PELÍCULA
        if (adminState[chatId] && adminState[chatId].step === 'search_movie') {
           try {
                const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(userText)}&language=es-ES`;
                const response = await axios.get(searchUrl);
                const data = response.data;
                if (data.results && data.results.length > 0) {
                    const results = data.results.slice(0, 5);
                    for (const item of results) {
                        const existingMovie = await mongoDb.collection('media_catalog').findOne({ tmdbId: item.id.toString() });
                        const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                        const title = item.title || item.name;
                        const date = item.release_date || item.first_air_date;
                        const message = `🎬 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${item.overview ? item.overview.substring(0, 150) + '...' : 'Sin sinopsis.'}`;
                        // Botón reutilizable: Si existe, "Gestionar", si no "Agregar"
                        let buttons = [[{ text: existingMovie ? '🔄 Editar Existente' : '✅ Agregar Película', callback_data: `add_new_movie_${item.id}` }]];
                        bot.sendPhoto(chatId, posterUrl, { caption: message, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
                    }
                } else { bot.sendMessage(chatId, `No se encontraron resultados.`); }
            } catch (error) { console.error(error); bot.sendMessage(chatId, 'Error buscando en TMDB.'); }
        
        // 2. BÚSQUEDA DE SERIE
        } else if (adminState[chatId] && adminState[chatId].step === 'search_series') {
            try {
                const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(userText)}&language=es-ES`;
                const response = await axios.get(searchUrl);
                const data = response.data;
                if (data.results && data.results.length > 0) {
                    const results = data.results.slice(0, 5);
                    for (const item of results) {
                        const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                        const title = item.title || item.name;
                        const date = item.first_air_date;
                        const message = `📺 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${item.overview ? item.overview.substring(0, 150) + '...' : 'Sin sinopsis.'}`;
                        let buttons = [[{ text: '📂 Seleccionar Serie', callback_data: `add_new_series_${item.id}` }]];
                        bot.sendPhoto(chatId, posterUrl, { caption: message, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
                    }
                } else { bot.sendMessage(chatId, `No se encontraron resultados.`); }
            } catch (error) { console.error(error); bot.sendMessage(chatId, 'Error buscando serie.'); }
        
        // 3. BÚSQUEDA PARA ELIMINAR
        } else if (adminState[chatId] && adminState[chatId].step === 'search_delete') {
             try {
                 const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(userText)}&language=es-ES`;
                 const response = await axios.get(searchUrl);
                 const data = response.data;
                 if (data.results?.length > 0) {
                     const results = data.results.slice(0, 5).filter(m => m.media_type === 'movie' || m.media_type === 'tv');
                     for (const item of results) {
                         const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                         const title = item.title || item.name;
                         const message = `🗑️ *${title}* (${item.media_type === 'movie' ? 'Película' : 'Serie'})`;
                         const options = { caption: message, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{
                             text: '❌ ELIMINAR AHORA', callback_data: `delete_confirm_${item.id}_${item.media_type}`
                         }]]}};
                         bot.sendPhoto(chatId, posterUrl, options);
                     }
                 } else { bot.sendMessage(chatId, `No se encontraron resultados.`); }
             } catch (error) { console.error(error); bot.sendMessage(chatId, 'Error buscando.'); }

        // ============================================================
        // === NUEVO FLUJO UNIFICADO (Películas) ===
        // ============================================================
        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_unified_link_movie') {
            const { selectedMedia } = adminState[chatId];
            
            // Validamos que sea un enlace o "no"
            const link = userText.trim();
            const finalLink = link.toLowerCase() === 'no' ? null : link;

            // Guardamos el MISMO enlace para GRATIS y PRO
            adminState[chatId].movieDataToSave = {
                tmdbId: selectedMedia.id.toString(),
                title: selectedMedia.title,
                overview: selectedMedia.overview,
                poster_path: selectedMedia.poster_path,
                proEmbedCode: finalLink,  // <--- MISMO ENLACE
                freeEmbedCode: finalLink, // <--- MISMO ENLACE
                isPremium: false // Por defecto false si es el mismo enlace
            };

            adminState[chatId].step = 'awaiting_publish_choice';
            
            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💾 Guardar solo en App', callback_data: 'save_only_' + selectedMedia.id }],
                        [{ text: '📲 Guardar + PUSH', callback_data: 'save_publish_and_push_' + selectedMedia.id }],
                        [{ text: '🚀 Guardar + Canal + PUSH', callback_data: 'save_publish_push_channel_' + selectedMedia.id }],
                        [{ text: '📢 Solo Canal (Sin Push)', callback_data: 'save_publish_channel_no_push_' + selectedMedia.id }] 
                    ]
                }
            };
            bot.sendMessage(chatId, `✅ Enlace recibido para *${selectedMedia.title}*.\n(Se usará el mismo para Gratis y Premium)\n\n¿Qué deseas hacer?`, { parse_mode: 'Markdown', ...options });

        // ============================================================
        // === NUEVO FLUJO UNIFICADO (Series) ===
        // ============================================================
        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_unified_link_series') {
            const { selectedSeries, season, episode } = adminState[chatId];
            if (!selectedSeries) { bot.sendMessage(chatId, 'Error: Se perdieron los datos.'); return; }

            const link = userText.trim();
            const finalLink = link.toLowerCase() === 'no' ? null : link;

            // Preparamos datos del episodio
            const seriesDataToSave = {
                tmdbId: (selectedSeries.tmdbId || selectedSeries.id).toString(),
                title: selectedSeries.title || selectedSeries.name,
                poster_path: selectedSeries.poster_path,
                seasonNumber: season,
                episodeNumber: episode,
                overview: selectedSeries.overview,
                proEmbedCode: finalLink,  // <--- MISMO ENLACE
                freeEmbedCode: finalLink, // <--- MISMO ENLACE
                isPremium: false
            };

            // Guardamos inmediatamente en Servidor (para series se guarda paso a paso)
            try {
                await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, seriesDataToSave);
                
                // Guardamos referencia para los botones de publicar
                adminState[chatId].lastSavedEpisodeData = seriesDataToSave;
                adminState[chatId].step = 'awaiting_series_action';
                
                const nextEpisodeNumber = episode + 1;
                const options = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `➡️ Siguiente: S${season}E${nextEpisodeNumber}`, callback_data: `add_next_episode_${seriesDataToSave.tmdbId}_${season}` }],
                            [{ text: `📲 Publicar Episodio + PUSH`, callback_data: `publish_push_this_episode_${seriesDataToSave.tmdbId}_${season}_${episode}` }],
                            [{ text: `📢 Publicar Canal + PUSH`, callback_data: `publish_push_channel_this_episode_${seriesDataToSave.tmdbId}_${season}_${episode}` }],
                            [{ text: `🤫 Solo Canal (Sin Push)`, callback_data: `publish_channel_no_push_this_episode_${seriesDataToSave.tmdbId}_${season}_${episode}` }],
                            [{ text: '⏹️ Finalizar Serie', callback_data: `finish_series_${seriesDataToSave.tmdbId}` }]
                        ]
                    }
                };
                bot.sendMessage(chatId, `✅ *S${season}E${episode}* guardado correctamente.\n¿Qué sigue?`, { parse_mode: 'Markdown', ...options });

            } catch (error) {
                console.error(error);
                bot.sendMessage(chatId, '❌ Error guardando el episodio en el servidor.');
                adminState[chatId] = { step: 'menu' };
            }

        // --- Lógica de VIVIBOX (Intacta) ---
        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_vivibox_m3u8') {
            const m3u8Link = userText.trim();
            if (!m3u8Link.startsWith('http') || (!m3u8Link.includes('.m3u8') && !m3u8Link.includes('.mp4'))) {
                bot.sendMessage(chatId, '❌ Enlace inválido. Debe ser http/https y contener .m3u8 o .mp4'); return; 
            }
            bot.sendMessage(chatId, '⏳ Procesando...');
            try {
                const response = await axios.post(`${RENDER_BACKEND_URL}/api/vivibox/add-link`, { m3u8Url: m3u8Link });
                const shortId = response.data.id;
                const shareableLink = `https://serivisios.onrender.com/ver/${shortId}`;
                bot.sendMessage(chatId, `✅ *VIVIBOX GENERADO*\n\n🆔 ID: \`${shortId}\`\n🔗 Link: ${shareableLink}`, { parse_mode: 'Markdown' });
            } catch (error) { bot.sendMessage(chatId, '❌ Error en Vivibox.'); } 
            finally { adminState[chatId] = { step: 'menu' }; }
        }
    });

    // =======================================================================
    // === MANEJADOR DE BOTONES (CALLBACKS) ===
    // =======================================================================
    bot.on('callback_query', async (callbackQuery) => {
        const msg = callbackQuery.message;
        const data = callbackQuery.data;
        const chatId = msg.chat.id;

        try {
            // --- Callbacks Públicos ---
            if (data === 'public_help' || data === 'public_contact') {
                bot.answerCallbackQuery(callbackQuery.id);
                // Ya manejados en lógica pública o irrelevantes si es admin
                return;
            }

            // --- Verificación Admin ---
            if (chatId !== ADMIN_CHAT_ID) {
                bot.answerCallbackQuery(callbackQuery.id, { text: 'Sin permisos', show_alert: true });
                return;
            }

            bot.answerCallbackQuery(callbackQuery.id);

            // 1. MENÚ PRINCIPAL
            if (data === 'add_movie') { 
                adminState[chatId] = { step: 'search_movie' }; 
                bot.sendMessage(chatId, '🔎 Escribe el nombre de la *PELÍCULA*:'); 
            }
            else if (data === 'add_series') { 
                adminState[chatId] = { step: 'search_series' }; 
                bot.sendMessage(chatId, '🔎 Escribe el nombre de la *SERIE*:'); 
            }
            else if (data === 'delete_movie') { 
                adminState[chatId] = { step: 'search_delete' }; 
                bot.sendMessage(chatId, '🗑️ Escribe el nombre del contenido a *ELIMINAR*:'); 
            }
            else if (data === 'vivibox_add_m3u8') { 
                adminState[chatId] = { step: 'awaiting_vivibox_m3u8' }; 
                bot.sendMessage(chatId, '🔗 Envía el enlace directo (M3U8/MP4) para Vivibox:'); 
            }

            // 2. SISTEMA DE PEDIDOS (NUEVO)
            else if (data === 'view_requests_menu') {
                const options = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔥 Últimas 2 Horas', callback_data: 'req_list_2h' }, { text: '📅 Últimas 24 Horas', callback_data: 'req_list_24h' }],
                            [{ text: '🗓️ Esta Semana', callback_data: 'req_list_7d' }, { text: '♾️ Histórico', callback_data: 'req_list_all' }],
                            [{ text: '🧹 Limpiar Lista (Borrar)', callback_data: 'req_clear_all' }]
                        ]
                    }
                };
                bot.sendMessage(chatId, '📂 *Gestión de Pedidos*\nSelecciona un rango de tiempo para ver qué piden tus usuarios.', { parse_mode: 'Markdown', ...options });
            }
            else if (data.startsWith('req_list_')) {
                const type = data.split('_')[2]; 
                let dateFilter = new Date();
                let timeText = "";

                if (type === '2h') { dateFilter.setHours(dateFilter.getHours() - 2); timeText = "últimas 2 horas"; }
                else if (type === '24h') { dateFilter.setHours(dateFilter.getHours() - 24); timeText = "últimas 24 horas"; }
                else if (type === '7d') { dateFilter.setDate(dateFilter.getDate() - 7); timeText = "última semana"; }
                else { dateFilter = new Date(0); timeText = "histórico completo"; }

                const requestsCollection = mongoDb.collection('movie_requests');
                const requests = await requestsCollection
                    .find({ lastRequestedAt: { $gte: dateFilter } })
                    .sort({ priorityScore: -1, requestCount: -1 }) 
                    .limit(10)
                    .toArray();

                if (requests.length === 0) {
                    bot.sendMessage(chatId, `🤷‍♂️ No hay pedidos nuevos en las ${timeText}.`);
                    return;
                }

                let responseMsg = `📊 *Top Pedidos (${timeText})*\n\n`;
                const inlineButtons = [];

                requests.forEach((req, index) => {
                    const icon = req.priorityScore === 3 ? '🚨' : '👤';
                    responseMsg += `${index + 1}. ${icon} *${req.title}* (📥 ${req.requestCount})\n`;
                    inlineButtons.push([{ text: `➕ Agregar: ${req.title.substring(0, 15)}...`, callback_data: `add_new_movie_${req.tmdbId}` }]);
                });
                
                bot.sendMessage(chatId, responseMsg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineButtons } });
            }
            else if (data === 'req_clear_all') {
                 await mongoDb.collection('movie_requests').deleteMany({});
                 bot.sendMessage(chatId, "🧹 Lista de pedidos vaciada.");
            }

            // 3. AGREGAR PELÍCULA (FLUJO NUEVO)
            else if (data.startsWith('add_new_movie_') || data.startsWith('solicitud_')) {
                const tmdbId = data.startsWith('solicitud_') ? data.split('_')[1] : data.split('_')[3];
                try {
                    const movieUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
                    const response = await axios.get(movieUrl);
                    const movieData = response.data;
                    adminState[chatId] = {
                        step: 'awaiting_unified_link_movie', // <--- PASO UNIFICADO
                        selectedMedia: {
                            id: movieData.id,
                            title: movieData.title,
                            overview: movieData.overview,
                            poster_path: movieData.poster_path
                        }
                    };
                    bot.sendMessage(chatId, `🎬 Película: *${movieData.title}*\n\n🔗 Envía el enlace *M3U8 o MP4*.\n(Se guardará automáticamente para Gratis y Premium).`, { parse_mode: 'Markdown' });
                } catch (error) { bot.sendMessage(chatId, 'Error obteniendo datos TMDB.'); }
            }

            // 4. AGREGAR SERIE (FLUJO NUEVO)
            else if (data.startsWith('add_new_series_')) {
                const tmdbId = data.split('_')[3];
                await handleManageSeries(chatId, tmdbId);
            }
            else if (data.startsWith('manage_season_')) {
                const [_, __, tmdbId, seasonNumber] = data.split('_');
                const { selectedSeries } = adminState[chatId];
                // Calcular siguiente episodio
                const seriesData = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
                let lastEpisode = 0;
                if (seriesData?.seasons?.[seasonNumber]?.episodes) {
                    lastEpisode = Object.keys(seriesData.seasons[seasonNumber].episodes).map(Number).sort((a,b)=>b-a)[0] || 0;
                }
                const nextEpisode = lastEpisode + 1;

                adminState[chatId] = {
                    ...adminState[chatId],
                    step: 'awaiting_unified_link_series', // <--- PASO UNIFICADO
                    season: parseInt(seasonNumber),
                    episode: nextEpisode
                };
                bot.sendMessage(chatId, `📺 *${selectedSeries.name}* - Temp ${seasonNumber}\n\nAgregando Episodio *${nextEpisode}*.\n🔗 Envía el enlace *M3U8 o MP4*:`, { parse_mode: 'Markdown' });
            }
            else if (data.startsWith('add_next_episode_')) {
                const [_, __, ___, tmdbId, seasonNumber] = data.split('_');
                // Lógica similar, incrementar episodio
                const seriesData = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
                let lastEpisode = 0;
                 if (seriesData?.seasons?.[seasonNumber]?.episodes) {
                    lastEpisode = Object.keys(seriesData.seasons[seasonNumber].episodes).map(Number).sort((a,b)=>b-a)[0] || 0;
                }
                const nextEpisode = lastEpisode + 1;
                
                adminState[chatId] = { 
                    ...adminState[chatId],
                    step: 'awaiting_unified_link_series', // <--- PASO UNIFICADO
                    season: parseInt(seasonNumber), 
                    episode: nextEpisode 
                };
                bot.sendMessage(chatId, `📺 Siguiente: *S${seasonNumber}E${nextEpisode}*.\n🔗 Envía el enlace:`);
            }

            // 5. GUARDAR Y PUBLICAR (Callbacks existentes)
            else if (data.startsWith('save_only_')) {
                const { movieDataToSave } = adminState[chatId];
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                bot.sendMessage(chatId, `✅ Guardado en App (Sin notificar).`);
                adminState[chatId] = { step: 'menu' };
            }
            else if (data.startsWith('save_publish_and_push_')) {
                const { movieDataToSave } = adminState[chatId];
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                // Notificación PUSH
                await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                    title: "¡Nuevo Estreno!",
                    body: `Ya puedes ver: ${movieDataToSave.title}`,
                    imageUrl: movieDataToSave.poster_path ? `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}` : null,
                    tmdbId: movieDataToSave.tmdbId,
                    mediaType: 'movie'
                });
                bot.sendMessage(chatId, `✅ Guardado + PUSH enviado.`);
                adminState[chatId] = { step: 'menu' };
            }
            else if (data.startsWith('save_publish_push_channel_')) {
                const { movieDataToSave } = adminState[chatId];
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                
                // PUSH
                await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                    title: "¡Nuevo Estreno!",
                    body: `Ver ahora: ${movieDataToSave.title}`,
                    imageUrl: movieDataToSave.poster_path ? `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}` : null,
                    tmdbId: movieDataToSave.tmdbId,
                    mediaType: 'movie'
                });

                // CANAL
                const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_A_ID; 
                if (CHANNEL_ID) {
                    const DEEPLINK = `${RENDER_BACKEND_URL}/app/details/${movieDataToSave.tmdbId}`;
                    await bot.sendPhoto(CHANNEL_ID, `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}`, {
                        caption: `🎬 *¡ESTRENO!* ${movieDataToSave.title}\n\nYa disponible en la App.`,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [[{ text: '▶️ Ver Ahora', url: DEEPLINK }]] }
                    });
                }
                bot.sendMessage(chatId, `✅ Guardado + PUSH + Canal.`);
                adminState[chatId] = { step: 'menu' };
            }
            else if (data.startsWith('save_publish_channel_no_push_')) {
                const { movieDataToSave } = adminState[chatId];
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                // CANAL SOLO
                const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_A_ID; 
                if (CHANNEL_ID) {
                    const DEEPLINK = `${RENDER_BACKEND_URL}/app/details/${movieDataToSave.tmdbId}`;
                    await bot.sendPhoto(CHANNEL_ID, `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}`, {
                        caption: `🎬 *¡ESTRENO!* ${movieDataToSave.title}\n\nYa disponible en la App.`,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [[{ text: '▶️ Ver Ahora', url: DEEPLINK }]] }
                    });
                }
                bot.sendMessage(chatId, `✅ Guardado + Canal (Silencioso).`);
                adminState[chatId] = { step: 'menu' };
            }

            // 6. PUBLICAR EPISODIOS (Series)
            else if (data.startsWith('publish_push_this_episode_')) {
                const parts = data.split('_'); const tmdbId = parts[4]; const season = parts[5]; const episode = parts[6];
                const epData = adminState[chatId]?.lastSavedEpisodeData;
                if (!epData) { bot.sendMessage(chatId, 'Error de datos.'); return; }
                
                await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                    title: `Nuevo Episodio: ${epData.title}`,
                    body: `S${season}E${episode} disponible.`,
                    imageUrl: epData.poster_path ? `https://image.tmdb.org/t/p/w500${epData.poster_path}` : null,
                    tmdbId: tmdbId, mediaType: 'tv'
                });
                bot.sendMessage(chatId, `✅ PUSH enviada.`);
                adminState[chatId] = { step: 'menu' };
            }
            // ... (Resto de opciones de series siguen la misma lógica de los botones de películas) ...
            else if (data.startsWith('finish_series_')) {
                bot.sendMessage(chatId, '✅ Serie finalizada.');
                adminState[chatId] = { step: 'menu' };
            }

            // 7. ELIMINAR (CONFIRMACIÓN)
            else if (data.startsWith('delete_confirm_')) {
                const [_, __, tmdbId, mediaType] = data.split('_');
                const collectionName = mediaType === 'movie' ? 'media_catalog' : 'series_catalog';
                await mongoDb.collection(collectionName).deleteOne({ tmdbId: tmdbId.toString() });
                bot.sendMessage(chatId, `🗑️ Contenido eliminado.`);
                adminState[chatId] = { step: 'menu' };
            }
            
            // 8. DIAMANTES (PEDIDOS)
            else if (data.startsWith('diamond_completed_')) {
                const gameId = data.split('_')[2];
                bot.editMessageCaption('✅ *RECARGA COMPLETADA*', { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown' });
            }

        } catch (error) {
            console.error("Error callback:", error);
            bot.sendMessage(chatId, '❌ Error procesando solicitud.');
        }
    });

    // === EVENTOS AUTOMÁTICOS (Auto-aceptar y notificar admin) ===
    bot.on('my_chat_member', async (update) => {
        if (update.old_chat_member.status !== 'administrator' && update.new_chat_member.status === 'administrator') {
            bot.sendMessage(update.from.id, `¡Gracias por hacerme admin en **${update.chat.title}**! Activa "Administrar solicitudes" para que acepte usuarios automáticamente.`, { parse_mode: 'Markdown' });
        }
    });

    bot.on('chat_join_request', async (joinRequest) => {
        try {
            await bot.approveChatJoinRequest(joinRequest.chat.id, joinRequest.from.id);
            const inviteLink = await bot.exportChatInviteLink(joinRequest.chat.id);
            bot.sendMessage(joinRequest.from.id, `¡Solicitud aceptada para **${joinRequest.chat.title}**!\n\nEntra aquí:`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: 'Unirme al Canal', url: inviteLink }]] }
            });
        } catch (e) { console.error("Error auto-aceptar:", e.message); }
    });

    // === FUNCIÓN AUXILIAR: GESTIÓN DE SERIES ===
    async function handleManageSeries(chatId, tmdbId) {
        try {
            const seriesUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
            const response = await axios.get(seriesUrl);
            const seriesData = response.data;
            
            adminState[chatId] = {
                ...adminState[chatId],
                selectedSeries: {
                    id: seriesData.id, tmdbId: seriesData.id.toString(),
                    name: seriesData.name, overview: seriesData.overview, poster_path: seriesData.poster_path
                }
            };

            const seasonButtons = seriesData.seasons
                .filter(s => s.season_number > 0)
                .map(season => {
                    return [{ text: `📂 Temp ${season.season_number} (${season.episode_count} eps)`, callback_data: `manage_season_${tmdbId}_${season.season_number}` }];
                });

            bot.sendMessage(chatId, `📺 Serie: *${seriesData.name}*\nSelecciona Temporada:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: seasonButtons } });
        } catch (error) { bot.sendMessage(chatId, 'Error obteniendo serie.'); }
    }

} // Fin initializeBot

module.exports = initializeBot;
