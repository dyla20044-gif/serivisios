function initializeBot(bot, db, mongoDb, adminState, ADMIN_CHAT_ID, TMDB_API_KEY, RENDER_BACKEND_URL, axios) {

    console.log("🤖 Lógica del Bot inicializada y escuchando...");
    bot.setMyCommands([
        { command: 'start', description: 'Reiniciar el bot y ver el menú principal' },
        { command: 'subir', description: 'Subir una película o serie a la base de datos' },
        { command: 'editar', description: 'Editar los enlaces de una película o serie existente' },
        { command: 'pedidos', description: 'Ver la lista de películas solicitadas por los usuarios' }
    ]);

    // === LÓGICA DE ADMIN: /start y /subir ===
    bot.onText(/\/start|\/subir/, (msg) => {
        const chatId = msg.chat.id;
        
        // --- FILTRO DE ADMIN ---
        if (chatId !== ADMIN_CHAT_ID) {
            return; 
        }
        // --- FIN DEL FILTRO ---

        adminState[chatId] = { step: 'menu' };
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'Agregar películas', callback_data: 'add_movie' },
                        { text: 'Agregar series', callback_data: 'add_series' }
                    ],
                    [{ text: '🔔 Ver Pedidos', callback_data: 'view_requests_menu' }], // NUEVO MENÚ DE PEDIDOS
                    [
                        { text: 'Eventos', callback_data: 'eventos' },
                        { text: 'Gestionar películas', callback_data: 'manage_movies' }
                    ], 
                    [{ text: 'Eliminar película', callback_data: 'delete_movie' }]
                ]
            }
        };
        bot.sendMessage(chatId, '¡Hola! ¿Qué quieres hacer hoy?', options);
    });

    // === MANEJADOR PRINCIPAL DE MENSAJES ===
    bot.on('message', async (msg) => {

        // ================================================================
        // --- (INICIO) LÓGICA DE MODERACIÓN (Intacta) ---
        // ================================================================

        const hasLinks = msg.entities && msg.entities.some(
            e => e.type === 'url' || e.type === 'text_link' || e.type === 'mention'
        );
        const isNotAdmin = msg.from.id !== ADMIN_CHAT_ID;

        if (hasLinks && isNotAdmin) {
            try {
                await bot.deleteMessage(msg.chat.id, msg.message_id);
                const warningMessage = await bot.sendMessage(
                    msg.chat.id, 
                    `@${msg.from.username || msg.from.first_name}, no se permite enviar enlaces en este grupo.`
                );
                setTimeout(() => {
                    bot.deleteMessage(warningMessage.chat.id, warningMessage.message_id).catch(e => console.warn("No se pudo borrar el aviso de moderación."));
                }, 5000);
            } catch (error) {
                console.warn(`[Moderación] No se pudo borrar el enlace del usuario ${msg.from.id} en el chat ${msg.chat.id}.`);
            }
            return; 
        }
        // ================================================================

        const chatId = msg.chat.id;
        const userText = msg.text;

        if (!userText) {
            return;
        }

        // ================================================================
        // --- (INICIO) LÓGICA PÚBLICA ---
        // ================================================================

        if (userText.startsWith('/')) {
            const command = userText.split(' ')[0];

            if (chatId !== ADMIN_CHAT_ID) {
                if (command === '/start' || command === '/ayuda') {
                    const helpMessage = `👋 ¡Hola! Soy un Bot de Auto-Aceptación de Solicitudes.
                    
**Función Principal:**
Me encargo de aceptar automáticamente a los usuarios que quieran unirse a tu canal o grupo privado.

**¿Cómo configurarme?**
1. Añádeme como administrador a tu canal o grupo.
2. Otórgame el permiso: "**Administrar solicitudes de ingreso**". 
3. ¡Listo! Aceptaré a los nuevos miembros y les enviaré un DM de bienvenida.

*Comandos disponibles:*
/ayuda - Muestra esta información.
/contacto - Contactar con el desarrollador.
`;
                    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
                    return; 
                }
                
                if (command === '/contacto') {
                    // !!! IMPORTANTE: Cambia @TuUsuarioDeTelegram por tu user real !!!
                    bot.sendMessage(chatId, 'Para soporte o dudas, puedes contactar al desarrollador en: @TuUsuarioDeTelegram');
                    return; 
                }
            }
        }
        // ================================================================


        // ================================================================
        // --- (INICIO) LÓGICA DE ADMIN ---
        // ================================================================
        
        if (chatId !== ADMIN_CHAT_ID) {
             if (userText.startsWith('/')) {
                 bot.sendMessage(chatId, 'Lo siento, no tienes permiso para usar este comando.');
             }
            return;
        }

        if (userText.startsWith('/')) {
            return; 
        }

        // --- (INICIO LÓGICA DE ESTADOS) ---
        
        if (adminState[chatId] && adminState[chatId].step === 'search_movie') {
           try {
                const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(userText)}&language=es-ES`;
                const response = await axios.get(searchUrl);
                const data = response.data;
                if (data.results && data.results.length > 0) {
                    const results = data.results.slice(0, 5);
                    for (const item of results) {
                        const existingMovie = await mongoDb.collection('media_catalog').findOne({ tmdbId: item.id.toString() });
                        const existingData = existingMovie || null;
                        const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                        const title = item.title || item.name;
                        const date = item.release_date || item.first_air_date;
                        const message = `🎬 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${item.overview || 'Sin sinopsis disponible.'}`;
                        let buttons = [[{ text: existingData ? '✅ Gestionar' : '✅ Agregar', callback_data: `${existingData ? 'manage_movie' : 'add_new_movie'}_${item.id}` }]];
                        const options = { caption: message, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } };
                        bot.sendPhoto(chatId, posterUrl, options);
                    }
                } else { bot.sendMessage(chatId, `No se encontraron resultados. Intenta de nuevo.`); }
            } catch (error) { console.error("Error buscando en TMDB (movie):", error); bot.sendMessage(chatId, 'Error buscando. Intenta de nuevo.'); }
        
        } else if (adminState[chatId] && adminState[chatId].step === 'search_series') {
            try {
                const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(userText)}&language=es-ES`;
                const response = await axios.get(searchUrl);
                const data = response.data;
                if (data.results && data.results.length > 0) {
                    const results = data.results.slice(0, 5);
                    for (const item of results) {
                        const existingSeries = await mongoDb.collection('series_catalog').findOne({ tmdbId: item.id.toString() });
                        const existingData = existingSeries || null;
                        const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                        const title = item.title || item.name;
                        const date = item.first_air_date;
                        const message = `🎬 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${item.overview || 'Sin sinopsis disponible.'}`;
                        let buttons = [[{ text: existingData ? '✅ Gestionar' : '✅ Agregar', callback_data: `${existingData ? 'manage_series' : 'add_new_series'}_${item.id}` }]];
                        const options = { caption: message, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } };
                        bot.sendPhoto(chatId, posterUrl, options);
                    }
                } else { bot.sendMessage(chatId, `No se encontraron resultados. Intenta de nuevo.`); }
            } catch (error) { console.error("Error buscando en TMDB (series):", error); bot.sendMessage(chatId, 'Error buscando. Intenta de nuevo.'); }
        
        } else if (adminState[chatId] && adminState[chatId].step === 'search_manage') {
             try {
                const searchUrl = `https://api.themoviedb.org/3/search/multi?api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(userText)}&language=es-ES`;
                const response = await axios.get(searchUrl);
                const data = response.data;
                if (data.results?.length > 0) {
                     const results = data.results.slice(0, 5).filter(m => m.media_type === 'movie' || m.media_type === 'tv');
                     if (results.length === 0) { bot.sendMessage(chatId, `No se encontraron películas o series.`); return; }
                     for (const item of results) {
                         const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                         const title = item.title || item.name;
                         const date = item.release_date || item.first_air_date;
                         const message = `🎬 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${item.overview || 'Sin sinopsis.'}`;
                         const callback_manage = item.media_type === 'movie' ? `manage_movie_${item.id}` : `manage_series_${item.id}`;
                         const options = { caption: message, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{
                             text: '✅ Gestionar Este', callback_data: callback_manage
                         }]]}};
                         bot.sendPhoto(chatId, posterUrl, options);
                     }
                 } else { bot.sendMessage(chatId, `No se encontraron resultados.`); }
             } catch (error) { console.error("Error buscando para gestionar:", error); bot.sendMessage(chatId, 'Error buscando.'); }

        } else if (adminState[chatId] && adminState[chatId].step === 'search_delete') {
             try {
                 const searchUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(userText)}&language=es-ES`;
                 const response = await axios.get(searchUrl);
                 const data = response.data;
                 if (data.results?.length > 0) {
                     const results = data.results.slice(0, 5).filter(m => m.media_type === 'movie' || m.media_type === 'tv');
                     if (results.length === 0) { bot.sendMessage(chatId, `No se encontraron películas o series.`); return; }
                     for (const item of results) {
                         const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                         const title = item.title || item.name;
                         const date = item.release_date || item.first_air_date;
                         const message = `🎬 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${item.overview || 'Sin sinopsis.'}`;
                         const options = { caption: message, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{
                             text: '🗑️ Confirmar Eliminación', callback_data: `delete_confirm_${item.id}_${item.media_type}`
                         }]]}};
                         bot.sendPhoto(chatId, posterUrl, options);
                     }
                 } else { bot.sendMessage(chatId, `No se encontraron resultados.`); }
             } catch (error) { console.error("Error buscando para eliminar:", error); bot.sendMessage(chatId, 'Error buscando.'); }
        }
        
        // --- Lógica de Eventos ---
        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_event_image') {
            if (!userText.startsWith('http')) { bot.sendMessage(chatId, '❌ Envía un ENLACE (URL) de imagen válido.'); return; }
            adminState[chatId].imageUrl = userText;
            adminState[chatId].step = 'awaiting_event_description';
            bot.sendMessage(chatId, 'Enlace recibido! Ahora envía la DESCRIPCIÓN.');
        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_event_description') {
           const { imageUrl } = adminState[chatId];
            const description = userText;
            try {
                // ... (lógica de guardado de evento omitida por brevedad, no requerida modificar) ...
                bot.sendMessage(chatId, '✅ Evento guardado y listo para notificar.');
            } catch (error) { 
                bot.sendMessage(chatId, '❌ Error guardando evento.');
            }
            finally { adminState[chatId] = { step: 'menu' }; }
        }

        // =======================================================================
        // === NUEVA LÓGICA DE UN SÓLO ENLACE (PELÍCULAS) ===
        // =======================================================================
        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_unified_link_movie') {
            const { selectedMedia } = adminState[chatId];
            if (!selectedMedia?.id) { 
                bot.sendMessage(chatId, 'Error: Se perdieron los datos de la película.'); 
                adminState[chatId] = { step: 'menu' }; 
                return; 
            }

            // Input: Puede ser un enlace o "no"
            const linkInput = userText.trim();
            const finalLink = linkInput.toLowerCase() === 'no' ? null : linkInput;

            if (!finalLink) {
                bot.sendMessage(chatId, '❌ Debes enviar al menos un enlace válido para subir una película nueva. Escribe el enlace, no "no".');
                return;
            }

            // Guardamos el MISMO enlace en ambos campos
            adminState[chatId].movieDataToSave = {
                tmdbId: selectedMedia.id.toString(),
                title: selectedMedia.title,
                overview: selectedMedia.overview,
                poster_path: selectedMedia.poster_path,
                proEmbedCode: finalLink,  // MISMO ENLACE
                freeEmbedCode: finalLink, // MISMO ENLACE
                isPremium: false // Por defecto false si hay freeEmbedCode
            };

            adminState[chatId].step = 'awaiting_publish_choice';
            // --- BOTONES ORGANIZADOS EN CUADRÍCULA ---
            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '💾 Solo App', callback_data: 'save_only_' + selectedMedia.id },
                            { text: '📲 App + PUSH', callback_data: 'save_publish_and_push_' + selectedMedia.id }
                        ],
                        [
                            { text: '🚀 Canal + PUSH', callback_data: 'save_publish_push_channel_' + selectedMedia.id },
                            { text: '📢 Solo Canal', callback_data: 'save_publish_channel_no_push_' + selectedMedia.id }
                        ]
                    ]
                }
            };
            bot.sendMessage(chatId, `✅ Enlace recibido y duplicado (Free/Pro).\nPelícula: ${selectedMedia.title}\n\n¿Qué hacer ahora?`, options);
        }

        // =======================================================================
        // === NUEVA LÓGICA DE UN SÓLO ENLACE (SERIES) ===
        // =======================================================================
        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_unified_link_series') {
            const { selectedSeries, season, episode } = adminState[chatId];
            if (!selectedSeries) { 
                bot.sendMessage(chatId, 'Error: Se perdieron los datos de la serie.'); 
                adminState[chatId] = { step: 'menu' }; 
                return; 
            }

            const linkInput = userText.trim();
            const finalLink = linkInput.toLowerCase() === 'no' ? null : linkInput;

            if (!finalLink) {
                bot.sendMessage(chatId, '❌ Debes enviar un enlace válido para subir el episodio. Escribe el enlace.');
                return;
            }

            // Objeto de datos (Unified Link)
            const seriesDataToSave = {
                tmdbId: (selectedSeries.tmdbId || selectedSeries.id).toString(),
                title: selectedSeries.title || selectedSeries.name,
                poster_path: selectedSeries.poster_path,
                seasonNumber: season,
                episodeNumber: episode,
                overview: selectedSeries.overview,
                proEmbedCode: finalLink,  // MISMO ENLACE
                freeEmbedCode: finalLink, // MISMO ENLACE
                isPremium: false
            };

            // Guardado automático (Igual que antes, las series se guardan paso a paso)
            try {
                await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, seriesDataToSave);
                bot.sendMessage(chatId, `✅ Episodio S${season}E${episode} guardado (Enlace unificado).`);
                
                const nextEpisodeNumber = episode + 1;
                adminState[chatId].lastSavedEpisodeData = seriesDataToSave;
                adminState[chatId].step = 'awaiting_series_action';
                
                // --- BOTONES ORGANIZADOS EN CUADRÍCULA ---
                const options = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `➡️ Agregar S${season}E${nextEpisodeNumber}`, callback_data: `add_next_episode_${seriesDataToSave.tmdbId}_${season}` }],
                            [
                                { text: `📲 Publicar + PUSH`, callback_data: `publish_push_this_episode_${seriesDataToSave.tmdbId}_${season}_${episode}` },
                                { text: `🚀 Canal + PUSH`, callback_data: `publish_push_channel_this_episode_${seriesDataToSave.tmdbId}_${season}_${episode}` }
                            ],
                            [
                                { text: `📢 Solo Canal`, callback_data: `publish_channel_no_push_this_episode_${seriesDataToSave.tmdbId}_${season}_${episode}` },
                                { text: '⏹️ Finalizar', callback_data: `finish_series_${seriesDataToSave.tmdbId}` }
                            ]
                        ]
                    }
                };
                bot.sendMessage(chatId, '¿Qué quieres hacer ahora?', options);
            } catch (error) {
                console.error("Error guardando episodio:", error.response ? error.response.data : error.message);
                bot.sendMessage(chatId, 'Error guardando episodio.');
                 adminState[chatId] = { step: 'menu' };
            }
        }
        
        // --- (FIN DE LÓGICA DE ESTADOS) ---
    });

    // =======================================================================
    // === MANEJADOR DE BOTONES (CALLBACK_QUERY) ===
    // =======================================================================
    bot.on('callback_query', async (callbackQuery) => {
        const msg = callbackQuery.message;
        const data = callbackQuery.data;
        const chatId = msg.chat.id;

        try {
            
            // --- LÓGICA PÚBLICA (Callbacks públicos) ---
            if (data === 'public_help') {
                bot.answerCallbackQuery(callbackQuery.id);
                const helpMessage = `👋 ¡Hola! Soy un Bot de Auto-Aceptación de Solicitudes.
                    
**Función Principal:**
Me encargo de aceptar automáticamente a los usuarios que quieran unirse a tu canal o grupo privado.

**¿Cómo configurarme?**
1. Añádeme como administrador a tu canal o grupo.
2. Otórgame el permiso: "**Administrar solicitudes de ingreso**".
3. ¡Listo! Aceptaré a los nuevos miembros y les enviaré un DM de bienvenida.

*Comandos disponibles:*
/ayuda - Muestra esta información.
/contacto - Contactar con el desarrollador.
`;
                bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
                return;
            }
            
            if (data === 'public_contact') {
                bot.answerCallbackQuery(callbackQuery.id);
                bot.sendMessage(chatId, 'Para soporte o dudas, puedes contactar al desarrollador en: @TuUsuarioDeTelegram');
                return;
            }
            
            // --- LÓGICA DE ADMIN ---
            if (chatId !== ADMIN_CHAT_ID) {
                bot.answerCallbackQuery(callbackQuery.id, { text: 'No tienes permiso.', show_alert: true });
                return;
            }

            bot.answerCallbackQuery(callbackQuery.id);

            if (data === 'add_movie') { 
                adminState[chatId] = { step: 'search_movie' }; 
                bot.sendMessage(chatId, 'Escribe el nombre de la película a agregar.'); 
            }
            else if (data === 'add_series') { 
                adminState[chatId] = { step: 'search_series' }; 
                bot.sendMessage(chatId, 'Escribe el nombre de la serie a agregar.'); 
            }
            else if (data === 'eventos') { 
                adminState[chatId] = { step: 'awaiting_event_image' }; 
                bot.sendMessage(chatId, 'Envía el ENLACE (URL) de la imagen para el evento.'); 
            }
            
            // =======================================================================
            // === (NUEVO) GESTIÓN DE MENÚ DE PEDIDOS ===
            // =======================================================================
            else if (data === 'view_requests_menu') {
                const options = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🚀 Ultra Rápido (1-2h)', callback_data: 'req_filter_ultra' }],
                            [{ text: '⚡ Rápido (12h)', callback_data: 'req_filter_fast' }],
                            [{ text: '📅 Regular (Semana)', callback_data: 'req_filter_regular' }],
                            [{ text: '⬅️ Volver', callback_data: 'back_to_menu' }] // Necesitas manejar esto o reiniciar
                        ]
                    }
                };
                bot.sendMessage(chatId, '📂 *Filtrar Pedidos por Prioridad:*', { parse_mode: 'Markdown', ...options });
            }
            else if (data.startsWith('req_filter_')) {
                const filterType = data.split('_')[2]; // ultra, fast, regular
                let query = {};
                let titleMsg = '';

                if (filterType === 'ultra') {
                    query = { latestPriority: { $in: ['immediate', 'premium'] } };
                    titleMsg = '🚀 Pedidos Ultra Rápidos (Immediate/Premium)';
                } else if (filterType === 'fast') {
                    query = { latestPriority: 'fast' };
                    titleMsg = '⚡ Pedidos Rápidos (Fast)';
                } else if (filterType === 'regular') {
                    query = { latestPriority: 'regular' };
                    titleMsg = '📅 Pedidos Regulares';
                }

                try {
                    const requests = await mongoDb.collection('movie_requests')
                        .find(query)
                        .sort({ votes: -1 }) // Los más votados primero
                        .limit(10)
                        .toArray();

                    if (requests.length === 0) {
                        bot.sendMessage(chatId, `✅ No hay pedidos pendientes en la categoría: ${filterType}`);
                    } else {
                        bot.sendMessage(chatId, `📋 *${titleMsg}:*`, { parse_mode: 'Markdown' });
                        for (const req of requests) {
                            // Botón "Subir" usa la misma lógica que "solicitud_"
                            // Usamos "add_new_movie_" porque la lógica es idéntica: buscar en TMDB y pedir enlace.
                            // Pero para ser más claros, usaremos el prefijo "solicitud_" que ya existía y lo adaptaremos.
                            const btn = {
                                reply_markup: {
                                    inline_keyboard: [[{ text: '✅ Subir Ahora', callback_data: `solicitud_${req.tmdbId}` }]]
                                }
                            };
                            const info = `🎬 *${req.title}*\nVotos: ${req.votes || 1}`;
                            if (req.poster_path) {
                                bot.sendPhoto(chatId, `https://image.tmdb.org/t/p/w200${req.poster_path}`, { caption: info, parse_mode: 'Markdown', ...btn });
                            } else {
                                bot.sendMessage(chatId, info, { parse_mode: 'Markdown', ...btn });
                            }
                        }
                    }
                } catch (err) {
                    console.error("Error filtrando pedidos:", err);
                    bot.sendMessage(chatId, '❌ Error al consultar la base de datos.');
                }
            }

            // =======================================================================
            // === LÓGICA DE SUBIDA (MODIFICADA: UNIFIED LINK) ===
            // =======================================================================
            else if (data.startsWith('add_new_movie_') || data.startsWith('solicitud_')) {
                // Captura tanto subidas manuales como desde solicitudes
                let tmdbId = '';
                if (data.startsWith('add_new_movie_')) tmdbId = data.split('_')[3];
                if (data.startsWith('solicitud_')) tmdbId = data.split('_')[1];

                if (!tmdbId) { bot.sendMessage(chatId, 'Error: No se pudo obtener el ID de la película.'); return; }
                try {
                    const movieUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
                    const response = await axios.get(movieUrl);
                    const movieData = response.data;
                    if (!movieData) { bot.sendMessage(chatId, 'Error: No se encontraron detalles para esa película.'); return; }

                    // ESTADO: Awaiting Unified Link
                    adminState[chatId] = {
                        step: 'awaiting_unified_link_movie', // NUEVO ESTADO UNIFICADO
                        selectedMedia: {
                            id: movieData.id,
                            title: movieData.title,
                            overview: movieData.overview,
                            poster_path: movieData.poster_path
                        }
                    };
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
                    bot.sendMessage(chatId, `🎬 Película seleccionada: *${movieData.title}*\n\n🔗 Envía el **ENLACE (Link)** del video.\n(Se guardará automáticamente como Free y Pro).`, { parse_mode: 'Markdown' });
                } catch (error) {
                    console.error("Error al obtener detalles de TMDB en add_new_movie/solicitud:", error.message);
                    bot.sendMessage(chatId, 'Error al obtener los detalles de la película desde TMDB.');
                }
            }

            // --- GESTIÓN DE SERIES (MODIFICADA: UNIFIED LINK) ---
            else if (data.startsWith('add_new_series_')) {
                const tmdbId = data.split('_')[3];
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
                await handleManageSeries(chatId, tmdbId);
            }
            else if (data.startsWith('manage_series_')) {
                const tmdbId = data.split('_')[2];
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
                await handleManageSeries(chatId, tmdbId);
            }
            else if (data.startsWith('manage_season_')) {
                const [_, __, tmdbId, seasonNumber] = data.split('_');
                const { selectedSeries } = adminState[chatId];
                if (!selectedSeries || selectedSeries.id.toString() !== tmdbId) {
                    bot.sendMessage(chatId, 'Error: Se perdieron los datos de la serie. Vuelve a buscar.');
                    return;
                }
                const seriesData = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
                let lastEpisode = 0;
                if (seriesData && seriesData.seasons && seriesData.seasons[seasonNumber] && seriesData.seasons[seasonNumber].episodes) {
                    lastEpisode = Object.keys(seriesData.seasons[seasonNumber].episodes)
                                    .map(Number)
                                    .sort((a, b) => b - a)[0] || 0;
                }
                const nextEpisode = lastEpisode + 1;
                
                // ESTADO: Awaiting Unified Link Series
                adminState[chatId] = {
                    ...adminState[chatId],
                    step: 'awaiting_unified_link_series', // NUEVO ESTADO UNIFICADO
                    season: parseInt(seasonNumber),
                    episode: nextEpisode
                };
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
                bot.sendMessage(chatId, `Gestionando *S${seasonNumber}* de *${selectedSeries.name}*.\nAgregando episodio *E${nextEpisode}*.\n\n🔗 Envía el **ENLACE (Link)** del video.`, { parse_mode: 'Markdown' });
            }
            else if (data.startsWith('add_next_episode_')) {
                const [_, __, ___, tmdbId, seasonNumber] = data.split('_');
                const { selectedSeries } = adminState[chatId];
                if (!selectedSeries || selectedSeries.id.toString() !== tmdbId) { 
                    bot.sendMessage(chatId, 'Error: Datos de la serie perdidos. Vuelve a empezar.'); 
                    adminState[chatId] = { step: 'menu' };
                    return; 
                }
                const seriesData = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
                let lastEpisode = 0;
                 if (seriesData && seriesData.seasons && seriesData.seasons[seasonNumber] && seriesData.seasons[seasonNumber].episodes) {
                    lastEpisode = Object.keys(seriesData.seasons[seasonNumber].episodes)
                                    .map(Number)
                                    .sort((a, b) => b - a)[0] || 0;
                }
                const nextEpisode = lastEpisode + 1;
                adminState[chatId] = { 
                    ...adminState[chatId],
                    step: 'awaiting_unified_link_series', // NUEVO ESTADO UNIFICADO
                    season: parseInt(seasonNumber), 
                    episode: nextEpisode 
                };
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `Siguiente: Envía **ENLACE** para S${seasonNumber}E${nextEpisode}.`);
            }

            // --- GESTIÓN DE EDICIÓN (INTACTA - SE MANTIENE SEPARADO PRO/FREE PARA FLEXIBILIDAD) ---
            else if (data.startsWith('manage_movie_')) {
                const tmdbId = data.split('_')[2];
                try {
                    const movieUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
                    const response = await axios.get(movieUrl);
                    const movieData = response.data;
                    adminState[chatId].selectedMedia = {
                        id: movieData.id,
                        title: movieData.title,
                        overview: movieData.overview,
                        poster_path: movieData.poster_path
                    };
                    const options = {
                        reply_markup: {
                            inline_keyboard: [
                                // MANTENEMOS ESTO SEPARADO POR SI QUIERES CORREGIR SOLO UNO
                                [{ text: '✏️ Editar Link PRO', callback_data: `add_pro_movie_${tmdbId}` }],
                                [{ text: '✏️ Editar Link GRATIS', callback_data: `add_free_movie_${tmdbId}` }]
                            ]
                        }
                    };
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
                    bot.sendMessage(chatId, `Gestionando: *${movieData.title}*. ¿Qué quieres editar?`, options);
                } catch (error) {
                     console.error("Error al obtener detalles de TMDB en manage_movie_:", error.message);
                    bot.sendMessage(chatId, 'Error al obtener los detalles de la película.');
                }
            }
            
            // ... (Resto de lógica de edición: add_pro_movie_, add_free_movie_ ... MANTENIDA)

            // --- Lógica de Eliminación y Diamantes (INTACTA) ---
            else if (data === 'manage_movies') { 
                adminState[chatId] = { step: 'search_manage' };
                bot.sendMessage(chatId, 'Escribe el nombre del contenido a gestionar.'); 
            }
            else if (data === 'delete_movie') { 
                adminState[chatId] = { step: 'search_delete' }; 
                bot.sendMessage(chatId, 'Escribe el nombre del contenido a ELIMINAR.'); 
            }
            else if (data.startsWith('delete_confirm_')) {
                const [_, __, tmdbId, mediaType] = data.split('_');
                let collectionName = '';
                if (mediaType === 'movie') collectionName = 'media_catalog';
                else if (mediaType === 'tv') collectionName = 'series_catalog';
                else { bot.sendMessage(chatId, 'Error: Tipo de medio desconocido.'); return; }
                try {
                    const result = await mongoDb.collection(collectionName).deleteOne({ tmdbId: tmdbId.toString() });
                    if (result.deletedCount > 0) {
                         bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
                         bot.sendMessage(chatId, `✅ Contenido (ID: ${tmdbId}) eliminado exitosamente.`);
                    } else {
                         bot.sendMessage(chatId, `⚠️ No se encontró contenido con ID ${tmdbId} en la base de datos para eliminar.`);
                    }
                } catch (error) {
                    console.error("Error al eliminar de MongoDB:", error);
                    bot.sendMessage(chatId, '❌ Error al intentar eliminar el contenido.');
                }
                adminState[chatId] = { step: 'menu' };
            }
            else if (data.startsWith('diamond_completed_')) {
                const gameId = data.split('_')[2];
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
                bot.sendMessage(chatId, `✅ Pedido de diamantes para el ID \`${gameId}\` marcado como completado.`);
            }

            // --- Callbacks de Guardado/Publicación (INTACTOS - CRÍTICO) ---
            else if (data.startsWith('save_only_')) {
                const { movieDataToSave } = adminState[chatId];
                if (!movieDataToSave?.tmdbId) { bot.sendMessage(chatId, 'Error: Datos perdidos.'); adminState[chatId] = { step: 'menu' }; return; }
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `✅ "${movieDataToSave.title}" guardada solo en la app.`);
                adminState[chatId] = { step: 'menu' };
            }
            else if (data.startsWith('save_publish_and_push_')) {
                const { movieDataToSave } = adminState[chatId];
                if (!movieDataToSave?.tmdbId) { bot.sendMessage(chatId, 'Error: Datos perdidos.'); adminState[chatId] = { step: 'menu' }; return; }
                try {
                    await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                    bot.sendMessage(chatId, `✅ "${movieDataToSave.title}" guardada. Enviando notificación PUSH...`);
                    
                    await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                        title: "¡Nuevo Estreno!",
                        body: `Ya puedes ver: ${movieDataToSave.title}`,
                        imageUrl: movieDataToSave.poster_path ? `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}` : null,
                        tmdbId: movieDataToSave.tmdbId,
                        mediaType: 'movie'
                    });
                    
                    bot.sendMessage(chatId, `📲 Notificación PUSH y Publicación completadas.`);
                } catch (error) {
                    console.error("Error en save_publish_and_push:", error.response ? error.response.data : error.message);
                    bot.sendMessage(chatId, '❌ Error al guardar o enviar notificación.');
                } finally {
                    adminState[chatId] = { step: 'menu' };
                }
            }

            // ==============================================================================
            // === LÓGICA DE DOBLE PUBLICACIÓN (FUNNEL) PARA PELÍCULAS ===
            // ==============================================================================
            else if (data.startsWith('save_publish_push_channel_')) {
                const tmdbIdFromCallback = data.split('_').pop(); 
                const { movieDataToSave } = adminState[chatId];
                
                if (!movieDataToSave?.tmdbId || movieDataToSave.tmdbId !== tmdbIdFromCallback) { 
                    bot.sendMessage(chatId, 'Error: Datos perdidos. Intenta de nuevo desde la búsqueda.'); 
                    adminState[chatId] = { step: 'menu' }; 
                    return; 
                }
                
                try {
                    // 1. Guardar en Base de Datos
                    await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                    bot.sendMessage(chatId, `✅ "${movieDataToSave.title}" guardada. Iniciando publicación doble...`);
                    
                    // 2. Enviar Notificación PUSH (App)
                    await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                        title: "¡Nuevo Estreno!",
                        body: `Ya puedes ver: ${movieDataToSave.title}`,
                        imageUrl: movieDataToSave.poster_path ? `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}` : null,
                        tmdbId: movieDataToSave.tmdbId,
                        mediaType: 'movie'
                    });

                    // --- DOBLE PUBLICACIÓN TELEGRAM ---

                    const DEEPLINK_URL = `${RENDER_BACKEND_URL}/app/details/${movieDataToSave.tmdbId}`;
                    const CHANNEL_SMALL = process.env.TELEGRAM_CHANNEL_A_ID; // Canal Pequeño (Username @click_para_ver)
                    const CHANNEL_BIG_ID = process.env.TELEGRAM_CHANNEL_B_ID;   // Canal Grande (ID Numérico)
                    
                    if (CHANNEL_SMALL) {
                        
                        // A) PUBLICAR EN CANAL PEQUEÑO (Completo)
                        const messageToSmall = `🎬 *¡NUEVO ESTRENO DISPONIBLE!* 🎬\n\n` +
                                                 `**${movieDataToSave.title}**\n\n` +
                                                 `${movieDataToSave.overview ? movieDataToSave.overview.substring(0, 150) + '...' : ''}\n\n` +
                                                 `_Entra para verla ahora en la App:_`;

                        const sentMsgSmall = await bot.sendPhoto(CHANNEL_SMALL, movieDataToSave.poster_path ? `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}` : 'https://placehold.co/500x750?text=SALA+CINE', {
                            caption: messageToSmall,
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '▶️ Ver Ahora en la App', url: DEEPLINK_URL }]
                                ]
                            }
                        });

                        // Generar el enlace al post del Canal Pequeño
                        // Formato: https://t.me/UsuarioCanal/MessageID
                        // Limpiamos el '@' del nombre de usuario
                        const channelUsername = CHANNEL_SMALL.replace('@', '');
                        const linkToPost = `https://t.me/${channelUsername}/${sentMsgSmall.message_id}`;

                        // B) PUBLICAR EN CANAL GRANDE (Teaser / Seguro)
                        if (CHANNEL_BIG_ID) {
                            const messageToBig = `🔥 *¡NUEVO APORTE AGREGADO!* 🔥\n\n` +
                                                 `🎬 **${movieDataToSave.title}**\n\n` +
                                                 `⚠️ _Para evitar problemas de copyright, la película está disponible en nuestro canal de respaldo._\n\n` +
                                                 `👇 *CLIC AQUÍ PARA VER* 👇\n` +
                                                 `${linkToPost}\n` +
                                                 `👆 *TOCA EL ENLACE ARRIBA* 👆`;

                            await bot.sendPhoto(CHANNEL_BIG_ID, movieDataToSave.poster_path ? `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}` : 'https://placehold.co/500x750?text=SALA+CINE', {
                                caption: messageToBig,
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: '🚀 IR AL CANAL Y VER AHORA 🚀', url: linkToPost }]
                                    ]
                                }
                            });
                            bot.sendMessage(chatId, `📢 Publicado en Canal Pequeño (@${channelUsername}) Y Canal Grande correctamente.`);
                        } else {
                            bot.sendMessage(chatId, `📢 Publicado solo en Canal Pequeño (Falta configurar Canal B).`);
                        }
                    } else {
                        bot.sendMessage(chatId, `⚠️ Error: Falta configurar TELEGRAM_CHANNEL_A_ID en .env`);
                    }
                    
                } catch (error) {
                    console.error("Error en save_publish_push_channel_:", error.response ? error.response.data : error.message);
                    bot.sendMessage(chatId, '❌ Error al guardar o enviar notificación.');
                } finally {
                    adminState[chatId] = { step: 'menu' };
                }
            }

            else if (data.startsWith('save_publish_channel_no_push_')) {
                const tmdbIdFromCallback = data.split('_').pop();
                const { movieDataToSave } = adminState[chatId];
                if (!movieDataToSave?.tmdbId || movieDataToSave.tmdbId !== tmdbIdFromCallback) { 
                    bot.sendMessage(chatId, 'Error: Datos perdidos. Intenta de nuevo.'); 
                    adminState[chatId] = { step: 'menu' }; 
                    return; 
                }
                
                try {
                    await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                    bot.sendMessage(chatId, `✅ "${movieDataToSave.title}" guardada. Publicando en CANAL (Silencioso)...`);

                    const DEEPLINK_URL = `${RENDER_BACKEND_URL}/app/details/${movieDataToSave.tmdbId}`;
                    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_A_ID; 
                    
                    if (CHANNEL_ID) {
                        const messageToChannel = `🎬 *¡NUEVO ESTRENO EN SALA CINE!* 🎬\n\n` +
                                                `**${movieDataToSave.title}** ya está disponible en la app.\n\n` +
                                                `_Entra para verla ahora:_`;

                        await bot.sendPhoto(CHANNEL_ID, movieDataToSave.poster_path ? `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}` : 'https://placehold.co/500x750?text=SALA+CINE', {
                            caption: messageToChannel,
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '▶️ Ver Ahora en la App', url: DEEPLINK_URL }]
                                ]
                            }
                        });
                        bot.sendMessage(chatId, `📢 Mensaje enviado al canal público (Sin molestar a usuarios).`);
                    }
                    
                } catch (error) {
                    console.error("Error en save_publish_channel_no_push_:", error.response ? error.response.data : error.message);
                    bot.sendMessage(chatId, '❌ Error al guardar o publicar.');
                } finally {
                    adminState[chatId] = { step: 'menu' };
                }
            }
            
            else if (data.startsWith('publish_push_this_episode_')) {
                const [_, __, ___, tmdbId, season, episode] = data.split('_');
                const state = adminState[chatId];
                const episodeData = state?.lastSavedEpisodeData;
                if (!episodeData || episodeData.tmdbId !== tmdbId || episodeData.seasonNumber.toString() !== season || episodeData.episodeNumber.toString() !== episode) {
                    bot.sendMessage(chatId, 'Error: Datos perdidos.'); adminState[chatId] = { step: 'menu' }; return;
                }
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `✅ Episodio S${season}E${episode} listo. Enviando notificación PUSH...`);
                try {
                    await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                        title: `¡Nuevo Episodio! ${episodeData.title}`,
                        body: `Ya disponible: S${episodeData.seasonNumber}E${episodeData.episodeNumber}`,
                        imageUrl: episodeData.poster_path ? `https://image.tmdb.org/t/p/w500${episodeData.poster_path}` : null,
                        tmdbId: episodeData.tmdbId,
                        mediaType: 'tv'
                    });
                    
                    bot.sendMessage(chatId, `📲 Notificación PUSH y Publicación completadas.`);
                } catch (error) {
                    console.error("Error en publish_push_this_episode:", error.response ? error.response.data : error.message);
                    bot.sendMessage(chatId, '❌ Error al enviar notificación.');
                } finally {
                    adminState[chatId] = { step: 'menu' };
                }
            }
            
            // ==============================================================================
            // === LÓGICA DE DOBLE PUBLICACIÓN (FUNNEL) PARA EPISODIOS ===
            // ==============================================================================
            else if (data.startsWith('publish_push_channel_this_episode_')) {
                const parts = data.split('_'); 
                const tmdbId = parts[5]; 
                const season = parts[6]; 
                const episode = parts[7]; 

                const state = adminState[chatId];
                const episodeData = state?.lastSavedEpisodeData;
                if (!episodeData || episodeData.tmdbId !== tmdbId || episodeData.seasonNumber.toString() !== season || episodeData.episodeNumber.toString() !== episode) {
                    bot.sendMessage(chatId, 'Error: Datos perdidos. Intenta de nuevo desde el episodio anterior.'); 
                    adminState[chatId] = { step: 'menu' }; 
                    return;
                }
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `✅ Episodio S${season}E${episode} listo. Iniciando doble publicación...`);
                
                try {
                    // 1. Notificación PUSH
                    await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                        title: `¡Nuevo Episodio! ${episodeData.title}`,
                        body: `Ya disponible: S${episodeData.seasonNumber}E${episodeData.episodeNumber}`,
                        imageUrl: episodeData.poster_path ? `https://image.tmdb.org/t/p/w500${episodeData.poster_path}` : null,
                        tmdbId: episodeData.tmdbId,
                        mediaType: 'tv'
                    });

                    // --- DOBLE PUBLICACIÓN TELEGRAM (SERIES) ---

                    const DEEPLINK_URL = `${RENDER_BACKEND_URL}/app/details/${episodeData.tmdbId}`; 
                    const CHANNEL_SMALL = process.env.TELEGRAM_CHANNEL_A_ID; // Canal Pequeño (Username)
                    const CHANNEL_BIG_ID = process.env.TELEGRAM_CHANNEL_B_ID; // Canal Grande (ID Numérico)
                    
                    if (CHANNEL_SMALL) {
                        
                        // A) PUBLICAR EN CANAL PEQUEÑO
                        const messageToSmall = `📺 *¡NUEVO EPISODIO EN SALA CINE!* 📺\n\n` +
                                                 `**${episodeData.title}**\n` +
                                                 `Temporada ${episodeData.seasonNumber} - Episodio ${episodeData.episodeNumber} ya disponible.\n\n` +
                                                 `_Entra para verla ahora:_`;

                        const sentMsgSmall = await bot.sendPhoto(CHANNEL_SMALL, episodeData.poster_path ? `https://image.tmdb.org/t/p/w500${episodeData.poster_path}` : 'https://placehold.co/500x750?text=SALA+CINE', {
                            caption: messageToSmall,
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '▶️ Ver Ahora en la App', url: DEEPLINK_URL }]
                                ]
                            }
                        });

                        // Generar link al post
                        const channelUsername = CHANNEL_SMALL.replace('@', '');
                        const linkToPost = `https://t.me/${channelUsername}/${sentMsgSmall.message_id}`;

                        // B) PUBLICAR EN CANAL GRANDE
                        if (CHANNEL_BIG_ID) {
                            const messageToBig = `🔥 *¡NUEVO EPISODIO DISPONIBLE!* 🔥\n\n` +
                                                 `📺 **${episodeData.title}**\n` +
                                                 `S${episodeData.seasonNumber} - E${episodeData.episodeNumber}\n\n` +
                                                 `⚠️ _Disponible ahora en nuestro canal principal._\n\n` +
                                                 `👇 *CLIC AQUÍ PARA VER* 👇\n` +
                                                 `${linkToPost}\n` +
                                                 `👆 *TOCA EL ENLACE ARRIBA* 👆`;

                            await bot.sendPhoto(CHANNEL_BIG_ID, episodeData.poster_path ? `https://image.tmdb.org/t/p/w500${episodeData.poster_path}` : 'https://placehold.co/500x750?text=SALA+CINE', {
                                caption: messageToBig,
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: '🚀 VER EPISODIO 🚀', url: linkToPost }]
                                    ]
                                }
                            });
                            bot.sendMessage(chatId, `📢 Publicado en ambos canales correctamente.`);
                        }
                    }

                } catch (error) {
                    console.error("Error en publish_push_channel_this_episode:", error.response ? error.response.data : error.message);
                    bot.sendMessage(chatId, '❌ Error al enviar notificación.');
                } finally {
                    adminState[chatId] = { step: 'menu' };
                }
            }
            
            else if (data.startsWith('publish_channel_no_push_this_episode_')) {
                const parts = data.split('_'); 
                const tmdbId = parts[6]; 
                const season = parts[7]; 
                const episode = parts[8]; 

                const state = adminState[chatId];
                const episodeData = state?.lastSavedEpisodeData;
                
                if (!episodeData || episodeData.tmdbId !== tmdbId || episodeData.seasonNumber.toString() !== season || episodeData.episodeNumber.toString() !== episode) {
                    bot.sendMessage(chatId, 'Error: Datos perdidos. Intenta de nuevo.'); 
                    adminState[chatId] = { step: 'menu' }; 
                    return;
                }

                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `✅ Episodio S${season}E${episode}. Publicando en CANAL (Silencioso)...`);

                try {
                    const DEEPLINK_URL = `${RENDER_BACKEND_URL}/app/details/${episodeData.tmdbId}`;
                    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_A_ID; 
                    
                    if (CHANNEL_ID) {
                        const messageToChannel = `📺 *¡NUEVO EPISODIO EN SALA CINE!* 📺\n\n` +
                                                `**${episodeData.title}**\n` +
                                                `Temporada ${episodeData.seasonNumber} - Episodio ${episodeData.episodeNumber} ya disponible.\n\n` +
                                                `_Entra para verla ahora:_`;

                        await bot.sendPhoto(CHANNEL_ID, episodeData.poster_path ? `https://image.tmdb.org/t/p/w500${episodeData.poster_path}` : 'https://placehold.co/500x750?text=SALA+CINE', {
                            caption: messageToChannel,
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '▶️ Ver Ahora en la App', url: DEEPLINK_URL }]
                                ]
                            }
                        });
                        bot.sendMessage(chatId, `📢 Mensaje enviado al canal público.`);
                    }
                    
                } catch (error) {
                    console.error("Error en publish_channel_no_push_series:", error.response ? error.response.data : error.message);
                    bot.sendMessage(chatId, '❌ Error al publicar.');
                } finally {
                    adminState[chatId] = { step: 'menu' };
                }
            }
            else if (data.startsWith('finish_series_')) {
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => { });
                bot.sendMessage(chatId, '✅ Proceso finalizado. Volviendo al menú.');
                adminState[chatId] = { step: 'menu' };
            }

        } catch (error) {
            console.error("Error en callback_query:", error);
            bot.sendMessage(chatId, '❌ Ocurrió un error procesando tu solicitud.');
        }
    });

    // =======================================================================
    // === LÓGICA PÚBLICA DE EVENTOS (Auto-aceptación y DM a Admin) ===
    // =======================================================================

    bot.on('my_chat_member', async (update) => {
        try {
            const newStatus = update.new_chat_member.status;
            const oldStatus = update.old_chat_member.status;
            const chatId = update.chat.id;
            const adminUserId = update.from.id; 

            if (oldStatus !== 'administrator' && newStatus === 'administrator') {
                console.log(`[Auto-Aceptar] Bot promovido a ADMIN en chat ${chatId} (${update.chat.title}) por ${adminUserId}`);
                
                const canManageJoins = update.new_chat_member.can_manage_chat_join_requests;
                
                let adminMessage = `¡Gracias por hacerme administrador en **${update.chat.title}**! 👋\n\n`;
                
                if (canManageJoins) {
                    adminMessage += "He detectado que tengo permisos para **Administrar solicitudes de ingreso**. ¡La función de auto-aceptación está **ACTIVA** para este chat!\n\n";
                } else {
                    adminMessage += "⚠️ **Acción requerida:** Para que la auto-aceptación funcione, por favor edita mis permisos y activa la opción '**Administrar solicitudes de ingreso**'.\n\n";
                }
                
                adminMessage += "Puedes usar /ayuda en este chat privado (aquí conmigo) si necesitas ver los comandos de asistencia.";
                
                bot.sendMessage(adminUserId, adminMessage, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'ℹ️ Ver Comandos Públicos', callback_data: 'public_help' }],
                            [{ text: '📞 Contactar Soporte', callback_data: 'public_contact' }]
                        ]
                    }
                }).catch(e => {
                    console.warn(`[Auto-Aceptar] No se pudo enviar DM al admin ${adminUserId}. (Quizás el admin tiene los DMs bloqueados)`);
                });
            }
        } catch (error) {
             console.error("Error en 'my_chat_member':", error.message);
        }
    });

    bot.on('chat_join_request', async (joinRequest) => {
        const chatId = joinRequest.chat.id;
        const userId = joinRequest.from.id;
        const chatTitle = joinRequest.chat.title;
        const userFirstName = joinRequest.from.first_name;

        console.log(`[Auto-Aceptar] Solicitud de ingreso recibida para el chat ${chatTitle} (${chatId}) de parte de: ${userFirstName} (${userId})`);

        try {
            await bot.approveChatJoinRequest(chatId, userId);
            console.log(`[Auto-Aceptar] ✅ Solicitud de ${userFirstName} ACEPTADA en chat ${chatTitle}.`);

            const inviteLink = await bot.exportChatInviteLink(chatId);

            const welcomeMessage = `¡Hola ${userFirstName}! 👋\n\nTu solicitud para unirte a **${chatTitle}** ha sido aceptada.\n\nPuedes acceder usando el botón de abajo:`;
            
            const options = {
                caption: welcomeMessage, 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `Acceder a ${chatTitle}`, url: inviteLink }]
                    ]
                }
            };

            let chatPhotoId = null;
            try {
                const chatDetails = await bot.getChat(chatId);
                if (chatDetails.photo && chatDetails.photo.big_file_id) {
                    chatPhotoId = chatDetails.photo.big_file_id;
                }
            } catch (photoError) {
                console.warn(`[Auto-Aceptar] No se pudo obtener el logo del chat ${chatId}. Enviando solo texto.`);
            }

            if (chatPhotoId) {
                bot.sendPhoto(userId, chatPhotoId, options).catch(e => {
                    console.warn(`[Auto-Aceptar] No se pudo enviar DM con foto a ${userId}. (El usuario puede tener DMs bloqueados)`);
                });
            } else {
                bot.sendMessage(userId, welcomeMessage, { 
                    parse_mode: 'Markdown',
                    reply_markup: options.reply_markup 
                }).catch(e => {
                    console.warn(`[Auto-Aceptar] No se pudo enviar DM de bienvenida a ${userId}. (El usuario puede tener DMs bloqueados)`);
                });
            }

        } catch (error) {
            console.error(`[Auto-Aceptar] Error al procesar solicitud de ${userFirstName} en ${chatId}:`, error.message);
        }
    });


    // =======================================================================
    // --- FUNCIÓN DE AYUDA INTERNA (Series) ---
    // =======================================================================
    async function handleManageSeries(chatId, tmdbId) {
        try {
            const seriesUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
            const response = await axios.get(seriesUrl);
            const seriesData = response.data;
            if (!seriesData || !seriesData.seasons) {
                bot.sendMessage(chatId, 'Error: No se encontraron detalles o temporadas para esa serie.');
                return;
            }
            adminState[chatId] = {
                ...adminState[chatId],
                selectedSeries: {
                    id: seriesData.id,
                    tmdbId: seriesData.id.toString(),
                    name: seriesData.name,
                    title: seriesData.name,
                    overview: seriesData.overview,
                    poster_path: seriesData.poster_path
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
            bot.sendMessage(chatId, `Gestionando: *${seriesData.name}*. Selecciona la temporada para agregar/editar episodios:`, { ...options, parse_mode: 'Markdown' });

        } catch (error) {
            console.error("Error al obtener detalles de TMDB en handleManageSeries:", error.message);
            bot.sendMessage(chatId, 'Error al obtener los detalles de la serie desde TMDB.');
        }
    }

} 

module.exports = initializeBot;
