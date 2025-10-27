function initializeBot(bot, db, mongoDb, adminState, ADMIN_CHAT_ID, TMDB_API_KEY, RENDER_BACKEND_URL, axios, extractGodStreamCode) {

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
        // ... (sin cambios aquí) ...
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
                    [{ text: 'Gestionar películas', callback_data: 'manage_movies' }],
                    [{ text: 'Eliminar película', callback_data: 'delete_movie' }]
                ]
            }
        };
        bot.sendMessage(chatId, '¡Hola! ¿Qué quieres hacer hoy?', options);
    });

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const userText = msg.text;
        // ... (Validación inicial sin cambios) ...
        if (chatId !== ADMIN_CHAT_ID || !userText || userText.startsWith('/')) {
            return;
        }

        // --- Lógica de Búsqueda (movie, series, delete) sin cambios ---
        if (adminState[chatId] && adminState[chatId].step === 'search_movie') {
           // ... (sin cambios) ...
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
            // ... (sin cambios) ...
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
        } else if (adminState[chatId] && adminState[chatId].step === 'search_delete') {
            // ... (sin cambios) ...
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
        // --- Lógica de Eventos sin cambios ---
        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_event_image') {
           // ... (sin cambios) ...
            if (!userText.startsWith('http')) { bot.sendMessage(chatId, '❌ Envía un ENLACE (URL) de imagen válido.'); return; }
            adminState[chatId].imageUrl = userText;
            adminState[chatId].step = 'awaiting_event_description';
            bot.sendMessage(chatId, 'Enlace recibido! Ahora envía la DESCRIPCIÓN.');
        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_event_description') {
           // ... (sin cambios) ...
           const { imageUrl } = adminState[chatId];
            const description = userText;
            try {
                await db.collection('userNotifications').add({ /* ... */ });
                bot.sendMessage(chatId, '✅ Evento guardado y listo para notificar.');
            } catch (error) { /* ... */ }
            finally { adminState[chatId] = { step: 'menu' }; }
        }
        // --- Lógica de Añadir Links (PRO y GRATIS) ---
        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_pro_link_movie') {
            // ... (sin cambios: guarda proEmbedCode, cambia step a awaiting_free_link_movie) ...
            const { selectedMedia } = adminState[chatId];
            adminState[chatId].proEmbedCode = userText.toLowerCase() === 'no' ? null : extractGodStreamCode(userText);
            adminState[chatId].step = 'awaiting_free_link_movie';
            bot.sendMessage(chatId, `PRO recibido (${adminState[chatId].proEmbedCode ? 'Link/Código' : 'Ninguno'}). Ahora envía el GRATIS para "${selectedMedia.title}". Escribe "no" si no hay.`);

        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_free_link_movie') {
            const { selectedMedia, proEmbedCode } = adminState[chatId];
            // ... (Validación de ID y al menos un link sin cambios) ...
            if (!selectedMedia?.id) { /* ... */ return; }
            const freeEmbedCode = userText.toLowerCase() === 'no' ? null : extractGodStreamCode(userText);
            if (!proEmbedCode && !freeEmbedCode) { /* ... */ return; }

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
                        // [{ text: '🚀 Guardar y Publicar (Canal)', callback_data: `save_and_publish_${selectedMedia.id}` }], // Puedes mantenerlo si quieres
                        [{ text: '📲 Guardar en App + PUSH', callback_data: `save_publish_and_push_${selectedMedia.id}` }] // Nueva opción PUSH
                    ]
                }
            };
            bot.sendMessage(chatId, `GRATIS recibido (${freeEmbedCode ? 'Link/Código' : 'Ninguno'}). ¿Qué hacer ahora?`, options);

        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_pro_link_series') {
            // ... (sin cambios: guarda proEmbedCode, cambia step a awaiting_free_link_series) ...
            const { selectedSeries, season, episode } = adminState[chatId];
            if (!selectedSeries) { /* ... */ return; }
            adminState[chatId].proEmbedCode = userText.toLowerCase() === 'no' ? null : extractGodStreamCode(userText);
            adminState[chatId].step = 'awaiting_free_link_series';
            bot.sendMessage(chatId, `PRO recibido (${adminState[chatId].proEmbedCode ? 'Link/Código' : 'Ninguno'}). Envía el GRATIS para S${season}E${episode}. Escribe "no" si no hay.`);

        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_free_link_series') {
            const { selectedSeries, season, episode, proEmbedCode } = adminState[chatId];
            // ... (Validación de ID y al menos un link sin cambios) ...
             if (!selectedSeries) { /* ... */ return; }
            const freeEmbedCode = userText.toLowerCase() === 'no' ? null : extractGodStreamCode(userText);
            if (!proEmbedCode && !freeEmbedCode) { /* ... */ return; }

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
                            // [{ text: `🚀 Publicar S${season}E${episode} (Canal)`, callback_data: `publish_this_episode_${seriesDataToSave.tmdbId}_${season}_${episode}` }], // Puedes mantenerlo
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

    bot.on('callback_query', async (callbackQuery) => {
        const msg = callbackQuery.message;
        const data = callbackQuery.data;
        const chatId = msg.chat.id;
        if (chatId !== ADMIN_CHAT_ID) return;

        try {
            bot.answerCallbackQuery(callbackQuery.id);

            // --- Callbacks de Menú y Selección (sin cambios) ---
            if (data === 'add_movie') { /* ... */ adminState[chatId] = { step: 'search_movie' }; bot.sendMessage(chatId, 'Escribe el nombre de la película a agregar.'); }
            else if (data === 'add_series') { /* ... */ adminState[chatId] = { step: 'search_series' }; bot.sendMessage(chatId, 'Escribe el nombre de la serie a agregar.'); }
            else if (data === 'eventos') { /* ... */ adminState[chatId] = { step: 'awaiting_event_image' }; bot.sendMessage(chatId, 'Envía el ENLACE (URL) de la imagen para el evento.'); }
            else if (data.startsWith('add_new_movie_')) { /* ... */ }
            else if (data.startsWith('add_new_series_')) { /* ... */ }
            else if (data.startsWith('manage_movie_')) { /* ... */ }
            else if (data.startsWith('manage_series_')) { /* ... */ }
            else if (data.startsWith('add_pro_movie_') || data.startsWith('add_free_movie_')) { /* ... */ }
            else if (data.startsWith('select_season_')) { /* ... */ }
            else if (data.startsWith('manage_season_')) { /* ... */ }
            else if (data.startsWith('add_new_season_')) { /* ... */ }
            else if (data.startsWith('solicitud_')) { /* ... */ }
            else if (data === 'manage_movies') { /* ... */ adminState[chatId] = { step: 'search_manage' }; bot.sendMessage(chatId, 'Escribe el nombre del contenido a gestionar.'); }
            else if (data === 'delete_movie') { /* ... */ adminState[chatId] = { step: 'search_delete' }; bot.sendMessage(chatId, 'Escribe el nombre del contenido a ELIMINAR.'); }
            else if (data.startsWith('delete_confirm_')) { /* ... */ }

            // --- Callbacks de Guardado/Publicación ---
            else if (data.startsWith('save_only_')) {
                const { movieDataToSave } = adminState[chatId];
                if (!movieDataToSave?.tmdbId) { /* ... error ... */ return; }
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `✅ "${movieDataToSave.title}" guardada solo en la app.`);
                adminState[chatId] = { step: 'menu' };
            }
            // Callback 'save_and_publish_' (Publicar en Canal - si lo mantienes)
            // else if (data.startsWith('save_and_publish_')) { ... }

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
                        title: "¡Nuevo Estreno!", // O usa movieDataToSave.title si prefieres
                        body: `Ya puedes ver: ${movieDataToSave.title}`,
                        // Construir URL completa del poster
                        imageUrl: movieDataToSave.poster_path ? `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}` : null,
                        tmdbId: movieDataToSave.tmdbId,
                        mediaType: 'movie' // Especificar tipo
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
                // ... (sin cambios: prepara para el siguiente episodio) ...
                const [_, __, ___, tmdbId, seasonNumber] = data.split('_');
                const seriesData = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
                if (!seriesData) { bot.sendMessage(chatId, 'Error: Serie no encontrada.'); return; }
                let lastEpisode = seriesData.seasons?.[seasonNumber]?.episodes ? Object.keys(seriesData.seasons[seasonNumber].episodes).length : 0;
                const nextEpisode = lastEpisode + 1;
                adminState[chatId] = { step: 'awaiting_pro_link_series', selectedSeries: seriesData, season: parseInt(seasonNumber), episode: nextEpisode };
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `Siguiente: Envía link PRO para S${seasonNumber}E${nextEpisode} (o "no").`);
            }
            // Callback 'publish_this_episode_' (Publicar en Canal - si lo mantienes)
            // else if (data.startsWith('publish_this_episode_')) { ... }

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
                        title: `¡Nuevo Episodio! ${episodeData.title}`, // Título más específico
                        body: `Ya disponible: S${episodeData.seasonNumber}E${episodeData.episodeNumber}`,
                        imageUrl: episodeData.poster_path ? `https://image.tmdb.org/t/p/w500${episodeData.poster_path}` : null, // Poster de la serie
                        tmdbId: episodeData.tmdbId,
                        mediaType: 'tv' // Especificar tipo
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
            else if (data.startsWith('finish_series_')) { // Renombrado
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => { });
                bot.sendMessage(chatId, '✅ Proceso finalizado. Volviendo al menú.');
                adminState[chatId] = { step: 'menu' };
            }
            // Callback 'finish_no_push' (ELIMINADO - Ya no es necesario)

            // --- Callback 'send_push_' (ELIMINADO - Reemplazado por los nuevos callbacks) ---
            // else if (data.startsWith('send_push_')) { ... }

        } catch (error) {
            console.error("Error en callback_query:", error);
            bot.sendMessage(chatId, '❌ Ocurrió un error procesando tu solicitud.');
            // adminState[chatId] = { step: 'menu' }; // Resetear si es necesario
        }
    });

} // Fin de initializeBot

module.exports = initializeBot;
