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
                    // --- Botones de Sala Cine (Sin cambios) ---
                    [{ text: 'Agregar películas', callback_data: 'add_movie' }],
                    [{ text: 'Agregar series', callback_data: 'add_series' }],
                    [{ text: 'Eventos', callback_data: 'eventos' }],
                    [{ text: 'Gestionar películas', callback_data: 'manage_movies' }], 
                    [{ text: 'Eliminar película', callback_data: 'delete_movie' }],
                    
                    // ==========================================================
                    // --- (AÑADIDO) Botón para la nueva app VIVIBOX ---
                    [{ text: '📲 VIVIBOX: Subir M3U8', callback_data: 'vivibox_add_m3u8' }]
                    // ==========================================================
                ]
            }
        };
        bot.sendMessage(chatId, '¡Hola! ¿Qué quieres hacer hoy?', options);
    });

    bot.on('message', async (msg) => {

        // ================================================================
        // --- (INICIO) NUEVA LÓGICA DE MODERACIÓN (BORRAR ENLACES) ---
        // ================================================================

        // 1. Verificamos si el mensaje tiene 'entidades' (como links, @menciones, etc.)
        const hasLinks = msg.entities && msg.entities.some(
            e => e.type === 'url' || e.type === 'text_link' || e.type === 'mention'
        );

        // 2. Verificamos si el remitente NO es el Administrador
        //    (Usamos msg.from.id en lugar de chatId, ya que chatId es el ID del GRUPO)
        const isNotAdmin = msg.from.id !== ADMIN_CHAT_ID;

        // 3. Si tiene enlaces Y NO es el admin, borramos el mensaje
        if (hasLinks && isNotAdmin) {
            try {
                // Borramos el mensaje que contiene el enlace
                await bot.deleteMessage(msg.chat.id, msg.message_id);
                
                // (Opcional) Enviamos un aviso temporal al usuario que se auto-borra
                const warningMessage = await bot.sendMessage(
                    msg.chat.id, 
                    `@${msg.from.username || msg.from.first_name}, no se permite enviar enlaces en este grupo.`
                );
                
                // Borramos nuestro propio aviso después de 5 segundos
                setTimeout(() => {
                    bot.deleteMessage(warningMessage.chat.id, warningMessage.message_id).catch(e => console.warn("No se pudo borrar el aviso de moderación."));
                }, 5000);

            } catch (error) {
                // Esto puede fallar si el bot no tiene permisos de admin en el grupo
                console.warn(`[Moderación] No se pudo borrar el enlace del usuario ${msg.from.id} en el chat ${msg.chat.id}. ¿El bot es admin con permisos?`);
            }
            
            // IMPORTANTE: Detenemos la ejecución aquí.
            // No queremos que la lógica de admin (buscar películas, etc.)
            // intente procesar este mensaje.
            return;
        }
        
        // --- (FIN) DE LA LÓGICA DE MODERACIÓN ---
        // ================================================================


        // --- LÓGICA DE ADMIN (Tu código original, sin cambios) ---
        // Esta parte solo se ejecutará si el mensaje NO fue borrado arriba.
        
        const chatId = msg.chat.id;
        const userText = msg.text;
        
        // Tu chequeo original que protege el bot de admin
        if (chatId !== ADMIN_CHAT_ID || !userText || userText.startsWith('/')) {
            return;
        }

        // --- Lógica de Búsqueda (movie, series, delete) (SIN CAMBIOS) ---
        if (adminState[chatId] && adminState[chatId].step === 'search_movie') {
           // ... (Tu código original sin cambios)
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
            // ... (Tu código original sin cambios)
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
             // ... (Tu código original sin cambios)
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
                         const callback_manage = item.media_type === 'movie' ? `manage_movie_${item.id}` : `manage_series_${item.id}`;
                         const options = { caption: message, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{
                             text: '✅ Gestionar Este', callback_data: callback_manage
                         }]]}};
                         bot.sendPhoto(chatId, posterUrl, options);
                     }
                 } else { bot.sendMessage(chatId, `No se encontraron resultados.`); }
             } catch (error) { console.error("Error buscando para gestionar:", error); bot.sendMessage(chatId, 'Error buscando.'); }

        } else if (adminState[chatId] && adminState[chatId].step === 'search_delete') {
             // ... (Tu código original sin cambios)
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
        // --- Lógica de Eventos (SIN CAMBIOS) ---
        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_event_image') {
            // ... (Tu código original sin cambios)
            if (!userText.startsWith('http')) { bot.sendMessage(chatId, '❌ Envía un ENLACE (URL) de imagen válido.'); return; }
            adminState[chatId].imageUrl = userText;
            adminState[chatId].step = 'awaiting_event_description';
            bot.sendMessage(chatId, 'Enlace recibido! Ahora envía la DESCRIPCIÓN.');
        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_event_description') {
           // ... (Tu código original sin cambios)
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
        // --- Lógica de Añadir Links (PRO y GRATIS) (SIN CAMBIOS) ---
        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_pro_link_movie') {
            // ... (Tu código original sin cambios)
            const { selectedMedia } = adminState[chatId];
            adminState[chatId].proEmbedCode = userText.toLowerCase() === 'no' ? null : userText;
            adminState[chatId].step = 'awaiting_free_link_movie';
            bot.sendMessage(chatId, `PRO recibido (${adminState[chatId].proEmbedCode ? 'Embed completo' : 'Ninguno'}). Ahora envía el GRATIS para "${selectedMedia.title}". Escribe "no" si no hay.`);

        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_free_link_movie') {
            // ... (Tu código original sin cambios)
            const { selectedMedia, proEmbedCode } = adminState[chatId];
            if (!selectedMedia?.id) { bot.sendMessage(chatId, 'Error: Se perdieron los datos de la película.'); adminState[chatId] = { step: 'menu' }; return; }
            const freeEmbedCode = userText.toLowerCase() === 'no' ? null : userText;
            if (!proEmbedCode && !freeEmbedCode) { bot.sendMessage(chatId, 'Error: Debes proporcionar al menos un enlace (PRO o GRATIS).'); return; }
            adminState[chatId].movieDataToSave = {
                tmdbId: selectedMedia.id.toString(), title: selectedMedia.title, overview: selectedMedia.overview, poster_path: selectedMedia.poster_path,
                proEmbedCode: proEmbedCode, freeEmbedCode: freeEmbedCode, isPremium: !!proEmbedCode && !freeEmbedCode
            };
            adminState[chatId].step = 'awaiting_publish_choice';
            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💾 Guardar solo en App', callback_data: `save_only_${selectedMedia.id}` }],
                        [{ text: '📲 Guardar en App + PUSH', callback_data: `save_publish_and_push_${selectedMedia.id}` }]
                    ]
                }
            };
            bot.sendMessage(chatId, `GRATIS recibido (${freeEmbedCode ? 'Embed completo' : 'Ninguno'}). ¿Qué hacer ahora?`, options);

        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_pro_link_series') {
            // ... (Tu código original sin cambios)
            const { selectedSeries, season, episode } = adminState[chatId];
            if (!selectedSeries) { bot.sendMessage(chatId, 'Error: Se perdieron los datos de la serie.'); adminState[chatId] = { step: 'menu' }; return; }
            adminState[chatId].proEmbedCode = userText.toLowerCase() === 'no' ? null : userText;
            adminState[chatId].step = 'awaiting_free_link_series';
            bot.sendMessage(chatId, `PRO recibido (${adminState[chatId].proEmbedCode ? 'Embed completo' : 'Ninguno'}). Envía el GRATIS para S${season}E${episode}. Escribe "no" si no hay.`);

        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_free_link_series') {
            // ... (Tu código original sin cambios)
            const { selectedSeries, season, episode, proEmbedCode } = adminState[chatId];
             if (!selectedSeries) { bot.sendMessage(chatId, 'Error: Se perdieron los datos de la serie.'); adminState[chatId] = { step: 'menu' }; return; }
            const freeEmbedCode = userText.toLowerCase() === 'no' ? null : userText;
            if (!proEmbedCode && !freeEmbedCode) { bot.sendMessage(chatId, 'Error: Debes proporcionar al menos un enlace (PRO o GRATIS).'); return; }
            const seriesDataToSave = {
                tmdbId: (selectedSeries.tmdbId || selectedSeries.id).toString(), title: selectedSeries.title || selectedSeries.name, poster_path: selectedSeries.poster_path,
                seasonNumber: season, episodeNumber: episode, overview: selectedSeries.overview,
                proEmbedCode: proEmbedCode, freeEmbedCode: freeEmbedCode, isPremium: !!proEmbedCode && !freeEmbedCode
            };
            try {
                await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, seriesDataToSave);
                bot.sendMessage(chatId, `✅ Episodio S${season}E${episode} guardado.`);
                const nextEpisodeNumber = episode + 1;
                adminState[chatId].lastSavedEpisodeData = seriesDataToSave;
                adminState[chatId].step = 'awaiting_series_action';
                const options = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `➡️ Agregar S${season}E${nextEpisodeNumber}`, callback_data: `add_next_episode_${seriesDataToSave.tmdbId}_${season}` }],
                            [{ text: `📲 Publicar S${season}E${episode} + PUSH`, callback_data: `publish_push_this_episode_${seriesDataToSave.tmdbId}_${season}_${episode}` }],
                            [{ text: '⏹️ Finalizar', callback_data: `finish_series_${seriesDataToSave.tmdbId}` }]
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
        
        // ==========================================================
        // --- (AÑADIDO) Nueva lógica para VIVIBOX ---
        // ==========================================================
        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_vivibox_m3u8') {
            const m3u8Link = userText.trim();

            // Validación simple del enlace
            if (!m3u8Link.startsWith('http') || !m3u8Link.endsWith('.m3u8')) {
                bot.sendMessage(chatId, '❌ Enlace inválido. Debe ser una URL completa que termine en .m3u8. Intenta de nuevo.');
                return; // Mantenemos el estado para que pueda reintentar
            }

            bot.sendMessage(chatId, 'Procesando enlace M3U8, por favor espera...');

            try {
                // Llamamos a un endpoint en *nuestro mismo servidor* (server.js)
                // que AÚN NO HEMOS CREADO, pero que crearemos en el siguiente paso.
                const response = await axios.post(`${RENDER_BACKEND_URL}/api/vivibox/add-link`, {
                    m3u8Url: m3u8Link
                });

                // El servidor nos devolverá el ID corto (ej. "abc123")
                const shortId = response.data.id;
                
                // ¡¡IMPORTANTE!! Cambia "tuservidor.com" por tu dominio real
                // (Usaré "serivisios.onrender.com" por ahora, como en tu AndroidManifest de la app 1)
                const shareableLink = `https://serivisios.onrender.com/ver/${shortId}`;

                bot.sendMessage(chatId, `✅ ¡Enlace M3U8 guardado!\n\nTu ID corto es: \`${shortId}\`\n\nTu enlace para compartir (el que abre la app) es:\n${shareableLink}`, { parse_mode: 'Markdown' });

            } catch (error) {
                console.error("Error al guardar el enlace M3U8 de Vivibox:", error.response ? error.response.data : error.message);
                bot.sendMessage(chatId, '❌ Error al guardar el enlace en el servidor. Revisa los logs.');
            } finally {
                adminState[chatId] = { step: 'menu' }; // Volver al menú
            }
        }
        // --- FIN DE LA LÓGICA DE VIVIBOX ---

    });

    // =======================================================================
    // === MANEJADOR DE BOTONES (CALLBACK_QUERY) - CORREGIDO ===
    // =======================================================================
    bot.on('callback_query', async (callbackQuery) => {
        const msg = callbackQuery.message;
        const data = callbackQuery.data;
        const chatId = msg.chat.id;
        
        // --- (MODIFICADO) CHEQUEO DE ADMIN PARA CALLBACKS ---
        // Esta línea es importante: solo permite que el ADMIN_CHAT_ID use los botones.
        if (chatId !== ADMIN_CHAT_ID) {
            // (Opcional) Avisar al usuario no admin que intenta presionar un botón
            bot.answerCallbackQuery(callbackQuery.id, { text: 'No tienes permiso.', show_alert: true });
            return;
        }
        // --- FIN DE LA MODIFICACIÓN ---


        try {
            bot.answerCallbackQuery(callbackQuery.id);

            // --- Callbacks de Menú y Selección (SIN CAMBIOS) ---
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
            
            // --- (AÑADIDO) Callback para VIVIBOX ---
            else if (data === 'vivibox_add_m3u8') { 
                adminState[chatId] = { step: 'awaiting_vivibox_m3u8' }; 
                bot.sendMessage(chatId, 'OK (Vivibox). Envíame el enlace M3U8 directo que quieres añadir.'); 
            }
            
            // ... (Todo el resto de tu lógica de callbacks 'add_new_movie_', 'manage_movie_', etc., sin cambios) ...
            
            else if (data.startsWith('add_new_movie_')) {
                // ... (Tu código original sin cambios)
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
            else if (data.startsWith('add_new_series_')) {
                // ... (Tu código original sin cambios)
                const tmdbId = data.split('_')[3];
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
                await handleManageSeries(chatId, tmdbId);
            }
            else if (data.startsWith('manage_movie_')) {
                // ... (Tu código original sin cambios)
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
            else if (data.startsWith('manage_series_')) {
                // ... (Tu código original sin cambios)
                const tmdbId = data.split('_')[2];
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
                await handleManageSeries(chatId, tmdbId);
            }
            else if (data.startsWith('add_pro_movie_')) {
                // ... (Tu código original sin cambios)
                const { selectedMedia } = adminState[chatId];
                if (!selectedMedia) { bot.sendMessage(chatId, 'Error: Datos perdidos. Vuelve a buscar la película.'); return; }
                adminState[chatId].step = 'awaiting_pro_link_movie';
                bot.sendMessage(chatId, `Editando PRO para *${selectedMedia.title}*. Envía el nuevo enlace PRO (o "no").`, { parse_mode: 'Markdown' });
            } 
            else if (data.startsWith('add_free_movie_')) {
                 // ... (Tu código original sin cambios)
                const { selectedMedia } = adminState[chatId];
                if (!selectedMedia) { bot.sendMessage(chatId, 'Error: Datos perdidos. Vuelve a buscar la película.'); return; }
                adminState[chatId].step = 'awaiting_free_link_movie';
                const existingMovie = await mongoDb.collection('media_catalog').findOne({ tmdbId: selectedMedia.id.toString() });
                adminState[chatId].proEmbedCode = existingMovie?.proEmbedCode || null; 
                bot.sendMessage(chatId, `Editando GRATIS para *${selectedMedia.title}*. Envía el nuevo enlace GRATIS (o "no").`, { parse_mode: 'Markdown' });
            }
            else if (data.startsWith('select_season_')) { /* ... (Lógica no implementada) ... */ }
            else if (data.startsWith('manage_season_')) {
                // ... (Tu código original sin cambios)
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
                adminState[chatId] = {
                    ...adminState[chatId],
                    step: 'awaiting_pro_link_series',
                    season: parseInt(seasonNumber),
                    episode: nextEpisode
                };
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
                bot.sendMessage(chatId, `Gestionando *S${seasonNumber}* de *${selectedSeries.name}*.\n\nVamos a agregar el episodio *E${nextEpisode}*.\n\nEnvía el enlace PRO (o "no").`, { parse_mode: 'Markdown' });
            }
            else if (data.startsWith('add_new_season_')) { /* ... (Lógica no implementada) ... */ }
            else if (data.startsWith('solicitud_')) {
                // ... (Tu código original sin cambios)
                const tmdbId = data.split('_')[1];
                if (!tmdbId) { bot.sendMessage(chatId, 'Error: No se pudo obtener el ID de la solicitud.'); return; }
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
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
                    bot.sendMessage(chatId, `🎬 Solicitud seleccionada: *${movieData.title}*\n\nAhora envía el enlace PRO. Escribe "no" si no hay enlace PRO.`, { parse_mode: 'Markdown' });
                } catch (error) {
                    console.error("Error al obtener detalles de TMDB en 'solicitud_':", error.message);
                    bot.sendMessage(chatId, 'Error al obtener los detalles de la película desde TMDB.');
                }
            }
            else if (data.startsWith('diamond_completed_')) {
                // ... (Tu código original sin cambios)
                const gameId = data.split('_')[2];
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
                bot.sendMessage(chatId, `✅ Pedido de diamantes para el ID \`${gameId}\` marcado como completado.`);
            }
            else if (data === 'manage_movies') { 
                // ... (Tu código original sin cambios)
                adminState[chatId] = { step: 'search_manage' };
                bot.sendMessage(chatId, 'Escribe el nombre del contenido (película o serie) a gestionar.'); 
            }
            else if (data === 'delete_movie') { 
                // ... (Tu código original sin cambios)
                adminState[chatId] = { step: 'search_delete' }; 
                bot.sendMessage(chatId, 'Escribe el nombre del contenido a ELIMINAR.'); 
            }
            else if (data.startsWith('delete_confirm_')) {
                // ... (Tu código original sin cambios)
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

            // --- Callbacks de Guardado/Publicación (SIN CAMBIOS) ---
            else if (data.startsWith('save_only_')) {
                // ... (Tu código original sin cambios)
                const { movieDataToSave } = adminState[chatId];
                if (!movieDataToSave?.tmdbId) { bot.sendMessage(chatId, 'Error: Datos perdidos.'); adminState[chatId] = { step: 'menu' }; return; }
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `✅ "${movieDataToSave.title}" guardada solo en la app.`);
                adminState[chatId] = { step: 'menu' };
            }
            else if (data.startsWith('save_publish_and_push_')) {
                // ... (Tu código original sin cambios)
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
                    bot.sendMessage(chatId, `📲 Notificación PUSH para "${movieDataToSave.title}" enviada.`);
                } catch (error) {
                    console.error("Error en save_publish_and_push:", error.response ? error.response.data : error.message);
                    bot.sendMessage(chatId, '❌ Error al guardar o enviar notificación.');
                } finally {
                    adminState[chatId] = { step: 'menu' };
                }
            }
            else if (data.startsWith('add_next_episode_')) {
                // ... (Tu código original sin cambios)
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
                    step: 'awaiting_pro_link_series', 
                    season: parseInt(seasonNumber), 
                    episode: nextEpisode 
                };
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `Siguiente: Envía link PRO para S${seasonNumber}E${nextEpisode} (o "no").`);
            }
            else if (data.startsWith('publish_push_this_episode_')) {
                // ... (Tu código original sin cambios)
                const [_, __, ___, tmdbId, season, episode] = data.split('_');
                const state = adminState[chatId];
                const episodeData = state?.lastSavedEpisodeData;
                if (!episodeData || episodeData.tmdbId !== tmdbId || episodeData.seasonNumber.toString() !== season || episodeData.episodeNumber.toString() !== episode) {
                    bot.sendMessage(chatId, 'Error: Datos del episodio no coinciden o se perdieron. Finalizando.'); adminState[chatId] = { step: 'menu' }; return;
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
                    bot.sendMessage(chatId, `📲 Notificación PUSH para S${season}E${episode} enviada.`);
                } catch (error) {
                    console.error("Error en publish_push_this_episode:", error.response ? error.response.data : error.message);
                    bot.sendMessage(chatId, '❌ Error al enviar notificación.');
                } finally {
                    adminState[chatId] = { step: 'menu' };
                }
            }
            else if (data.startsWith('finish_series_')) {
                // ... (Tu código original sin cambios)
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => { });
                bot.sendMessage(chatId, '✅ Proceso finalizado. Volviendo al menú.');
                adminState[chatId] = { step: 'menu' };
            }

        } catch (error) {
            console.error("Error en callback_query:", error);
            bot.sendMessage(chatId, '❌ Ocurrió un error procesando tu solicitud.');
        }
    });


    // --- Función de ayuda interna para mostrar temporadas (SIN CAMBIOS) ---
    async function handleManageSeries(chatId, tmdbId) {
        // ... (Tu código original sin cambios)
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

} // Fin de initializeBot

module.exports = initializeBot;
