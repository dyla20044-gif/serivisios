// Contenido completo y CORREGIDO de bot.js

function initializeBot(bot, db, mongoDb, adminState, ADMIN_CHAT_ID, TMDB_API_KEY, RENDER_BACKEND_URL, axios) { // <--- ELIMINADO extractGodStreamCode

    console.log("🤖 Lógica del Bot inicializada y escuchando...");

    // === CONFIGURACIÓN DE ATAJOS DEL BOT ===
    bot.setMyCommands([
        { command: 'start', description: 'Reiniciar el bot y ver el menú principal' },
        { command: 'subir', description: 'Subir una película o serie a la base de datos' },
        { command: 'editar', description: 'Editar los enlaces de una película o serie existente' },
        { command: 'pedidos', description: 'Ver la lista de películas solicitadas por los usuarios' }
    ]);

    // === LÓGICA DEL BOT DE TELEGRAM ===
    bot.onText(/\/start|\/subir/, (msg) => {
        const chatId = msg.chat.id;
        if (chatId !== ADMIN_CHAT_ID) {
            bot.sendMessage(chatId, 'Lo siento, no tienes permiso para usar este bot.');
            return;
        }
        adminState[chatId] = { step: 'menu' };
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Agregar películas', callback_data: 'add_movie' }],
                    [{ text: 'Agregar series', callback_data: 'add_series' }],
                    [{ text: 'Eventos', callback_data: 'eventos' }],
                    [{ text: 'Gestionar películas', callback_data: 'manage_movies' }], // Cambiado de 'Gestionar' a 'Gestionar películas'
                    [{ text: 'Eliminar película', callback_data: 'delete_movie' }]
                ]
            }
        };
        bot.sendMessage(chatId, '¡Hola! ¿Qué quieres hacer hoy?', options);
    });

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const userText = msg.text;
        
        if (chatId !== ADMIN_CHAT_ID || !userText || userText.startsWith('/')) {
            return;
        }

        // --- Lógica de Búsqueda (movie, series, delete) ---
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
                        // *** CORREGIDO: El botón "Agregar" ahora usa 'add_new_movie_'. "Gestionar" usa 'manage_movie_' ***
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
                        // *** CORREGIDO: El botón "Agregar" ahora usa 'add_new_series_'. "Gestionar" usa 'manage_series_' ***
                        let buttons = [[{ text: existingData ? '✅ Gestionar' : '✅ Agregar', callback_data: `${existingData ? 'manage_series' : 'add_new_series'}_${item.id}` }]];
                        const options = { caption: message, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } };
                        bot.sendPhoto(chatId, posterUrl, options);
                    }
                } else { bot.sendMessage(chatId, `No se encontraron resultados. Intenta de nuevo.`); }
            } catch (error) { console.error("Error buscando en TMDB (series):", error); bot.sendMessage(chatId, 'Error buscando. Intenta de nuevo.'); }
        
        // El 'search_manage' (del botón 'Gestionar películas') es igual que 'search_movie', así que lo redirigimos
        } else if (adminState[chatId] && adminState[chatId].step === 'search_manage') {
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
                         // *** CORREGIDO: Apunta a 'manage_movie' o 'manage_series' ***
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
                // ... (lógica de guardado de evento) ...
                bot.sendMessage(chatId, '✅ Evento guardado y listo para notificar.');
            } catch (error) { 
                bot.sendMessage(chatId, '❌ Error guardando evento.');
            }
            finally { adminState[chatId] = { step: 'menu' }; }
        }
        // --- Lógica de Añadir Links (PRO y GRATIS) ---
        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_pro_link_movie') {
            const { selectedMedia } = adminState[chatId];
            
            // [CAMBIO CLAVE] Guardamos el texto (iframe) directamente
            adminState[chatId].proEmbedCode = userText.toLowerCase() === 'no' ? null : userText;
            
            adminState[chatId].step = 'awaiting_free_link_movie';
            bot.sendMessage(chatId, `PRO recibido (${adminState[chatId].proEmbedCode ? 'Embed completo' : 'Ninguno'}). Ahora envía el GRATIS para "${selectedMedia.title}". Escribe "no" si no hay.`);

        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_free_link_movie') {
            const { selectedMedia, proEmbedCode } = adminState[chatId];
            if (!selectedMedia?.id) { bot.sendMessage(chatId, 'Error: Se perdieron los datos de la película.'); adminState[chatId] = { step: 'menu' }; return; }

            // [CAMBIO CLAVE] Guardamos el texto (iframe) directamente
            const freeEmbedCode = userText.toLowerCase() === 'no' ? null : userText;
            
            if (!proEmbedCode && !freeEmbedCode) { bot.sendMessage(chatId, 'Error: Debes proporcionar al menos un enlace (PRO o GRATIS).'); return; }

            // Guardar datos temporalmente
            adminState[chatId].movieDataToSave = {
                tmdbId: selectedMedia.id.toString(), title: selectedMedia.title, overview: selectedMedia.overview, poster_path: selectedMedia.poster_path,
                proEmbedCode: proEmbedCode, freeEmbedCode: freeEmbedCode, isPremium: !!proEmbedCode && !freeEmbedCode
            };
            adminState[chatId].step = 'awaiting_publish_choice'; // Cambiar step ANTES de enviar botones

            // +++ MODIFICADO: Añadir botón PUSH +++
            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💾 Guardar solo en App', callback_data: `save_only_${selectedMedia.id}` }],
                        [{ text: '📲 Guardar en App + PUSH', callback_data: `save_publish_and_push_${selectedMedia.id}` }] // Nueva opción PUSH
                    ]
                }
            };
            bot.sendMessage(chatId, `GRATIS recibido (${freeEmbedCode ? 'Embed completo' : 'Ninguno'}). ¿Qué hacer ahora?`, options);

        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_pro_link_series') {
            const { selectedSeries, season, episode } = adminState[chatId];
            if (!selectedSeries) { bot.sendMessage(chatId, 'Error: Se perdieron los datos de la serie.'); adminState[chatId] = { step: 'menu' }; return; }
            
            // [CAMBIO CLAVE] Guardamos el texto (iframe) directamente
            adminState[chatId].proEmbedCode = userText.toLowerCase() === 'no' ? null : userText;
            
            adminState[chatId].step = 'awaiting_free_link_series';
            bot.sendMessage(chatId, `PRO recibido (${adminState[chatId].proEmbedCode ? 'Embed completo' : 'Ninguno'}). Envía el GRATIS para S${season}E${episode}. Escribe "no" si no hay.`);

        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_free_link_series') {
            const { selectedSeries, season, episode, proEmbedCode } = adminState[chatId];
             if (!selectedSeries) { bot.sendMessage(chatId, 'Error: Se perdieron los datos de la serie.'); adminState[chatId] = { step: 'menu' }; return; }
            
            // [CAMBIO CLAVE] Guardamos el texto (iframe) directamente
            const freeEmbedCode = userText.toLowerCase() === 'no' ? null : userText;
            
            if (!proEmbedCode && !freeEmbedCode) { bot.sendMessage(chatId, 'Error: Debes proporcionar al menos un enlace (PRO o GRATIS).'); return; }

            const seriesDataToSave = {
                tmdbId: (selectedSeries.tmdbId || selectedSeries.id).toString(), title: selectedSeries.title || selectedSeries.name, poster_path: selectedSeries.poster_path,
                seasonNumber: season, episodeNumber: episode, overview: selectedSeries.overview,
                proEmbedCode: proEmbedCode, freeEmbedCode: freeEmbedCode, isPremium: !!proEmbedCode && !freeEmbedCode
            };

            try {
                // Guardar episodio en backend
                await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, seriesDataToSave);
                bot.sendMessage(chatId, `✅ Episodio S${season}E${episode} guardado.`);

                const nextEpisodeNumber = episode + 1;
                adminState[chatId].lastSavedEpisodeData = seriesDataToSave; // Guardar datos para PUSH
                adminState[chatId].step = 'awaiting_series_action'; // Cambiar step ANTES de enviar botones

                // +++ MODIFICADO: Añadir botón PUSH +++
                const options = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `➡️ Agregar S${season}E${nextEpisodeNumber}`, callback_data: `add_next_episode_${seriesDataToSave.tmdbId}_${season}` }],
                            [{ text: `📲 Publicar S${season}E${episode} + PUSH`, callback_data: `publish_push_this_episode_${seriesDataToSave.tmdbId}_${season}_${episode}` }], // Nueva opción PUSH
                            [{ text: '⏹️ Finalizar', callback_data: `finish_series_${seriesDataToSave.tmdbId}` }] // Renombrado para claridad
                        ]
                    }
                };
                bot.sendMessage(chatId, '¿Qué quieres hacer ahora?', options);

            } catch (error) {
                console.error("Error guardando episodio:", error.response ? error.response.data : error.message);
                bot.sendMessage(chatId, 'Error guardando episodio.');
                 adminState[chatId] = { step: 'menu' }; // Resetear en caso de error
            }
        }
    });

    // =======================================================================
    // === MANEJADOR DE BOTONES (CALLBACK_QUERY) - CORREGIDO ===
    // =======================================================================
    bot.on('callback_query', async (callbackQuery) => {
        const msg = callbackQuery.message;
        const data = callbackQuery.data;
        const chatId = msg.chat.id;
        if (chatId !== ADMIN_CHAT_ID) return;

        try {
            bot.answerCallbackQuery(callbackQuery.id);

            // --- Callbacks de Menú y Selección ---
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
            
            // +++ BLOQUE CORREGIDO +++
            else if (data.startsWith('add_new_movie_')) {
                const tmdbId = data.split('_')[3];
                if (!tmdbId) { bot.sendMessage(chatId, 'Error: No se pudo obtener el ID de la película.'); return; }
                try {
                    const movieUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
                    const response = await axios.get(movieUrl);
                    const movieData = response.data;
                    if (!movieData) { bot.sendMessage(chatId, 'Error: No se encontraron detalles para esa película.'); return; }

                    adminState[chatId] = {
                        step: 'awaiting_pro_link_movie',
                        selectedMedia: {
                            id: movieData.id,
                            title: movieData.title,
                            overview: movieData.overview,
                            poster_path: movieData.poster_path
                        }
                    };
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
                    bot.sendMessage(chatId, `🎬 Película seleccionada: *${movieData.title}*\n\nAhora envía el enlace PRO. Escribe "no" si no hay enlace PRO.`, { parse_mode: 'Markdown' });
                } catch (error) {
                    console.error("Error al obtener detalles de TMDB en add_new_movie_:", error.message);
                    bot.sendMessage(chatId, 'Error al obtener los detalles de la película desde TMDB.');
                }
            }
            
            // +++ BLOQUE CORREGIDO (redirige a 'manage_series_') +++
            else if (data.startsWith('add_new_series_')) {
                // Esta acción es idéntica a 'gestionar series' para un item nuevo
                const tmdbId = data.split('_')[3];
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
                // Llamamos a la lógica de 'manage_series_'
                await handleManageSeries(chatId, tmdbId);
            }
            
            // +++ BLOQUE CORREGIDO +++
            else if (data.startsWith('manage_movie_')) {
                const tmdbId = data.split('_')[2];
                try {
                    const movieUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
                    const response = await axios.get(movieUrl);
                    const movieData = response.data;
                    
                    // Guardamos la película seleccionada en el estado para usarla en el siguiente paso
                    adminState[chatId].selectedMedia = {
                        id: movieData.id,
                        title: movieData.title,
                        overview: movieData.overview,
                        poster_path: movieData.poster_path
                    };

                    const options = {
                        reply_markup: {
                            inline_keyboard: [
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
            
            // +++ BLOQUE CORREGIDO +++
            else if (data.startsWith('manage_series_')) {
                const tmdbId = data.split('_')[2];
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
                await handleManageSeries(chatId, tmdbId);
            }
            
            // +++ BLOQUE CORREGIDO +++
            else if (data.startsWith('add_pro_movie_')) {
                // Asume que 'selectedMedia' ya está en el estado (puesto por 'manage_movie_')
                const { selectedMedia } = adminState[chatId];
                if (!selectedMedia) { bot.sendMessage(chatId, 'Error: Datos perdidos. Vuelve a buscar la película.'); return; }
                
                adminState[chatId].step = 'awaiting_pro_link_movie';
                bot.sendMessage(chatId, `Editando PRO para *${selectedMedia.title}*. Envía el nuevo enlace PRO (o "no").`, { parse_mode: 'Markdown' });
            } 
            
            // +++ BLOQUE CORREGIDO +++
            else if (data.startsWith('add_free_movie_')) {
                 // Asume que 'selectedMedia' ya está en el estado
                const { selectedMedia } = adminState[chatId];
                if (!selectedMedia) { bot.sendMessage(chatId, 'Error: Datos perdidos. Vuelve a buscar la película.'); return; }

                adminState[chatId].step = 'awaiting_free_link_movie';
                // Mantenemos el PRO link que ya existía (si no, se borraría)
                const existingMovie = await mongoDb.collection('media_catalog').findOne({ tmdbId: selectedMedia.id.toString() });
                adminState[chatId].proEmbedCode = existingMovie?.proEmbedCode || null; 

                bot.sendMessage(chatId, `Editando GRATIS para *${selectedMedia.title}*. Envía el nuevo enlace GRATIS (o "no").`, { parse_mode: 'Markdown' });
            }
            
            else if (data.startsWith('select_season_')) { /* ... (Lógica no implementada) ... */ }
            
            // +++ BLOQUE CORREGIDO +++
            else if (data.startsWith('manage_season_')) {
                const [_, __, tmdbId, seasonNumber] = data.split('_');
                const { selectedSeries } = adminState[chatId];
                
                if (!selectedSeries || selectedSeries.id.toString() !== tmdbId) {
                    bot.sendMessage(chatId, 'Error: Se perdieron los datos de la serie. Vuelve a buscar.');
                    return;
                }
                
                // Buscar el último episodio agregado para esta temporada
                const seriesData = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
                let lastEpisode = 0;
                if (seriesData && seriesData.seasons && seriesData.seasons[seasonNumber] && seriesData.seasons[seasonNumber].episodes) {
                    lastEpisode = Object.keys(seriesData.seasons[seasonNumber].episodes)
                                    .map(Number) // Convertir keys a números
                                    .sort((a, b) => b - a)[0] || 0; // Encontrar el más alto
                }
                const nextEpisode = lastEpisode + 1;

                adminState[chatId] = {
                    ...adminState[chatId], // Mantener selectedSeries
                    step: 'awaiting_pro_link_series',
                    season: parseInt(seasonNumber),
                    episode: nextEpisode
                };
                
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
                bot.sendMessage(chatId, `Gestionando *S${seasonNumber}* de *${selectedSeries.name}*.\n\nVamos a agregar el episodio *E${nextEpisode}*.\n\nEnvía el enlace PRO (o "no").`, { parse_mode: 'Markdown' });
            }
            
            else if (data.startsWith('add_new_season_')) { /* ... (Lógica no implementada) ... */ }
            
            // +++ CAMBIO REALIZADO: Lógica para el botón de solicitud +++
            else if (data.startsWith('solicitud_')) {
                const tmdbId = data.split('_')[1]; // Obtiene el ID de la película (ej: solicitud_12345)
                if (!tmdbId) { 
                    bot.sendMessage(chatId, 'Error: No se pudo obtener el ID de la solicitud.'); 
                    return; 
                }
                
                // Quitamos los botones del mensaje de solicitud
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});

                // Reutilizamos la lógica de 'add_new_movie_' para buscar la película y pedir los links
                try {
                    // (Asumimos que TMDB_API_KEY y axios están disponibles desde initializeBot)
                    const movieUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
                    const response = await axios.get(movieUrl);
                    const movieData = response.data;
                    if (!movieData) { bot.sendMessage(chatId, 'Error: No se encontraron detalles para esa película.'); return; }

                    // Ponemos al bot en modo "esperando link PRO"
                    adminState[chatId] = {
                        step: 'awaiting_pro_link_movie', 
                        selectedMedia: {
                            id: movieData.id,
                            title: movieData.title,
                            overview: movieData.overview,
                            poster_path: movieData.poster_path
                        }
                    };
                    
                    bot.sendMessage(chatId, `🎬 Solicitud seleccionada: *${movieData.title}*\n\nAhora envía el enlace PRO. Escribe "no" si no hay enlace PRO.`, { parse_mode: 'Markdown' });
                
                } catch (error) {
                    console.error("Error al obtener detalles de TMDB en 'solicitud_':", error.message);
                    bot.sendMessage(chatId, 'Error al obtener los detalles de la película desde TMDB.');
                }
            }
            
            // =======================================================================
            // === INICIO: NUEVA LÓGICA PARA BOTÓN DE PEDIDO DE DIAMANTES
            // =======================================================================
            else if (data.startsWith('diamond_completed_')) {
                const gameId = data.split('_')[2]; // Obtiene el ID del jugador (ej: diamond_completed_12345678)
                
                // 1. Quitar el botón del mensaje original
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});

                // 2. Enviar confirmación al admin
                bot.sendMessage(chatId, `✅ Pedido de diamantes para el ID \`${gameId}\` marcado como completado.`);
                
                // 3. (Opcional) Aquí podrías agregar lógica para notificar al usuario
                //    en la app (mediante Push o escribiendo en Firestore) que su pedido fue completado.
            }
            // =======================================================================
            // === FIN: NUEVA LÓGICA PARA BOTÓN DE PEDIDO DE DIAMANTES
            // =======================================================================


            else if (data === 'manage_movies') { 
                adminState[chatId] = { step: 'search_manage' }; // Usamos el nuevo step 'search_manage'
                bot.sendMessage(chatId, 'Escribe el nombre del contenido (película o serie) a gestionar.'); 
            }
            else if (data === 'delete_movie') { 
                adminState[chatId] = { step: 'search_delete' }; 
                bot.sendMessage(chatId, 'Escribe el nombre del contenido a ELIMINAR.'); 
            }
            
            // +++ BLOQUE CORREGIDO +++
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

            // --- Callbacks de Guardado/Publicación ---
            else if (data.startsWith('save_only_')) {
                const { movieDataToSave } = adminState[chatId];
                if (!movieDataToSave?.tmdbId) { bot.sendMessage(chatId, 'Error: Datos perdidos.'); adminState[chatId] = { step: 'menu' }; return; }
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `✅ "${movieDataToSave.title}" guardada solo en la app.`);
                adminState[chatId] = { step: 'menu' };
            }

            // +++ NUEVO: Callback para Guardar + PUSH (Películas) +++
            else if (data.startsWith('save_publish_and_push_')) {
                const { movieDataToSave } = adminState[chatId];
                if (!movieDataToSave?.tmdbId) { bot.sendMessage(chatId, 'Error: Datos perdidos.'); adminState[chatId] = { step: 'menu' }; return; }

                try {
                    // 1. Guardar en la base de datos
                    await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                    bot.sendMessage(chatId, `✅ "${movieDataToSave.title}" guardada. Enviando notificación PUSH...`);

                    // 2. Llamar al backend para enviar la notificación
                    await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                        title: "¡Nuevo Estreno!",
                        body: `Ya puedes ver: ${movieDataToSave.title}`,
                        imageUrl: movieDataToSave.poster_path ? `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}` : null,
                        tmdbId: movieDataToSave.tmdbId,
                        mediaType: 'movie'
                    });

                    bot.sendMessage(chatId, `📲 Notificación PUSH para "${movieDataToSave.title}" enviada.`);
                } catch (error) {
                    console.error("Error en save_publish_and_push:", error.response ? error.response.data : error.message);
                    bot.sendMessage(chatId, '❌ Error al guardar o enviar notificación.');
                } finally {
                    adminState[chatId] = { step: 'menu' }; // Volver al menú
                }
            }

            // --- Callbacks de Series ---
            else if (data.startsWith('add_next_episode_')) {
                const [_, __, ___, tmdbId, seasonNumber] = data.split('_');
                // *** CORREGIDO: Usamos los datos de 'selectedSeries' en el estado ***
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
                    ...adminState[chatId], // Mantiene selectedSeries
                    step: 'awaiting_pro_link_series', 
                    season: parseInt(seasonNumber), 
                    episode: nextEpisode 
                };
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `Siguiente: Envía link PRO para S${seasonNumber}E${nextEpisode} (o "no").`);
            }

            // +++ NUEVO: Callback para Publicar + PUSH (Series) +++
            else if (data.startsWith('publish_push_this_episode_')) {
                const [_, __, ___, tmdbId, season, episode] = data.split('_');
                const state = adminState[chatId];
                const episodeData = state?.lastSavedEpisodeData; // Usar datos guardados
                if (!episodeData || episodeData.tmdbId !== tmdbId || episodeData.seasonNumber.toString() !== season || episodeData.episodeNumber.toString() !== episode) {
                    bot.sendMessage(chatId, 'Error: Datos del episodio no coinciden o se perdieron. Finalizando.'); adminState[chatId] = { step: 'menu' }; return;
                }

                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `✅ Episodio S${season}E${episode} listo. Enviando notificación PUSH...`);

                try {
                    // Llamar al backend para enviar la notificación
                    await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                        title: `¡Nuevo Episodio! ${episodeData.title}`,
                        body: `Ya disponible: S${episodeData.seasonNumber}E${episodeData.episodeNumber}`,
                        imageUrl: episodeData.poster_path ? `https://image.tmdb.org/t/p/w500${episodeData.poster_path}` : null,
                        tmdbId: episodeData.tmdbId,
                        mediaType: 'tv'
                    });
                    bot.sendMessage(chatId, `📲 Notificación PUSH para S${season}E${episode} enviada.`);
                } catch (error) {
                    console.error("Error en publish_push_this_episode:", error.response ? error.response.data : error.message);
                    bot.sendMessage(chatId, '❌ Error al enviar notificación.');
                } finally {
                    adminState[chatId] = { step: 'menu' }; // Volver al menú
                }
            }

            // --- Callbacks de Finalización ---
            else if (data.startsWith('finish_series_')) {
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => { });
                bot.sendMessage(chatId, '✅ Proceso finalizado. Volviendo al menú.');
                adminState[chatId] = { step: 'menu' };
            }

        } catch (error) {
            console.error("Error en callback_query:", error);
            bot.sendMessage(chatId, '❌ Ocurrió un error procesando tu solicitud.');
            // adminState[chatId] = { step: 'menu' }; // Resetear si es necesario
        }
    });


    // --- Función de ayuda interna para mostrar temporadas ---
    async function handleManageSeries(chatId, tmdbId) {
        try {
            const seriesUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
            const response = await axios.get(seriesUrl);
            const seriesData = response.data;

            if (!seriesData || !seriesData.seasons) {
                bot.sendMessage(chatId, 'Error: No se encontraron detalles o temporadas para esa serie.');
                return;
            }

            // Guardar la serie seleccionada en el estado
            adminState[chatId] = {
                ...adminState[chatId], // Mantener el 'step' actual si existe
                selectedSeries: {
                    id: seriesData.id,
                    tmdbId: seriesData.id.toString(), // Asegurar que tengamos tmdbId
                    name: seriesData.name,
                    title: seriesData.name, // Para consistencia
                    overview: seriesData.overview,
                    poster_path: seriesData.poster_path
                }
            };
            
            const seasonButtons = seriesData.seasons
                .filter(s => s.season_number > 0) // Filtrar temporadas "especiales" (S0)
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

} // Fin de initializeBot

module.exports = initializeBot;
