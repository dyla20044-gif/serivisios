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
        if (chatId !== ADMIN_CHAT_ID || !userText || userText.startsWith('/')) { // Añadido chequeo !userText
            return;
        }

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
            } catch (error) {
                console.error("Error buscando en TMDB (movie):", error);
                bot.sendMessage(chatId, 'Error buscando. Intenta de nuevo.');
            }
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
            } catch (error) {
                console.error("Error buscando en TMDB (series):", error);
                bot.sendMessage(chatId, 'Error buscando. Intenta de nuevo.');
            }
        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_event_image') { // <-- CORREGIDO AQUÍ
            if (!userText.startsWith('http')) {
                bot.sendMessage(chatId, '❌ Envía un ENLACE (URL) de imagen válido.'); return;
            }
            adminState[chatId].imageUrl = userText;
            adminState[chatId].step = 'awaiting_event_description';
            bot.sendMessage(chatId, 'Enlace recibido! Ahora envía la DESCRIPCIÓN.');
        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_event_description') {
            const { imageUrl } = adminState[chatId];
            const description = userText;
            try {
                await db.collection('userNotifications').add({
                    title: '🎉 Nuevo Evento', description: description, image: imageUrl,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(), isRead: false, type: 'event', targetScreen: 'profile-screen'
                });
                bot.sendMessage(chatId, '✅ Evento guardado y listo para notificar.');
            } catch (error) {
                console.error("Error guardando evento:", error);
                bot.sendMessage(chatId, '❌ Error guardando. Revisa logs.');
            } finally { adminState[chatId] = { step: 'menu' }; }

        // === LÓGICA DEL BOT ACTUALIZADA ===
        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_pro_link_movie') {
            const { selectedMedia } = adminState[chatId];
            // Usamos la nueva función extractGodStreamCode
            adminState[chatId].proEmbedCode = userText.toLowerCase() === 'no' ? null : extractGodStreamCode(userText);
            adminState[chatId].step = 'awaiting_free_link_movie';
            bot.sendMessage(chatId, `PRO recibido (${adminState[chatId].proEmbedCode ? 'Link/Código' : 'Ninguno'}). Ahora envía el GRATIS para "${selectedMedia.title}". Escribe "no" si no hay.`);

        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_free_link_movie') {
            const { selectedMedia, proEmbedCode } = adminState[chatId];
            if (!selectedMedia?.id) {
                bot.sendMessage(chatId, '❌ ERROR: ID perdido. Reinicia con /subir.');
                adminState[chatId] = { step: 'menu' }; return;
            }
            // Usamos la nueva función extractGodStreamCode
            const freeEmbedCode = userText.toLowerCase() === 'no' ? null : extractGodStreamCode(userText);

            // Validación: Al menos un link debe existir
            if (!proEmbedCode && !freeEmbedCode) {
                bot.sendMessage(chatId, '❌ Debes proporcionar al menos un reproductor (PRO o GRATIS). Reinicia el proceso.');
                adminState[chatId] = { step: 'menu' }; return;
            }

            adminState[chatId].movieDataToSave = {
                tmdbId: selectedMedia.id.toString(), title: selectedMedia.title, overview: selectedMedia.overview, poster_path: selectedMedia.poster_path,
                proEmbedCode: proEmbedCode, freeEmbedCode: freeEmbedCode, isPremium: !!proEmbedCode && !freeEmbedCode
            };
            adminState[chatId].step = 'awaiting_publish_choice';
            const options = { reply_markup: { inline_keyboard: [
                [{ text: '💾 Guardar solo', callback_data: `save_only_${selectedMedia.id}` }],
                [{ text: '🚀 Guardar y Publicar', callback_data: `save_and_publish_${selectedMedia.id}` }]
            ]}};
            bot.sendMessage(chatId, `GRATIS recibido (${freeEmbedCode ? 'Link/Código' : 'Ninguno'}). ¿Qué hacer ahora?`, options);

        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_pro_link_series') {
            const { selectedSeries, season, episode } = adminState[chatId];
            if (!selectedSeries) {
                bot.sendMessage(chatId, 'Error: Estado perdido. Reinicia.'); adminState[chatId] = { step: 'menu' }; return;
            }
            // Usamos la nueva función extractGodStreamCode
            adminState[chatId].proEmbedCode = userText.toLowerCase() === 'no' ? null : extractGodStreamCode(userText);
            adminState[chatId].step = 'awaiting_free_link_series';
            bot.sendMessage(chatId, `PRO recibido (${adminState[chatId].proEmbedCode ? 'Link/Código' : 'Ninguno'}). Envía el GRATIS para S${season}E${episode}. Escribe "no" si no hay.`);

        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_free_link_series') {
            const { selectedSeries, season, episode, proEmbedCode } = adminState[chatId];
            if (!selectedSeries) {
                bot.sendMessage(chatId, 'Error: Estado perdido. Reinicia.'); adminState[chatId] = { step: 'menu' }; return;
            }
            // Usamos la nueva función extractGodStreamCode
            const freeEmbedCode = userText.toLowerCase() === 'no' ? null : extractGodStreamCode(userText);

            // Validación: Al menos un link
            if (!proEmbedCode && !freeEmbedCode) {
                bot.sendMessage(chatId, '❌ Debes dar al menos un reproductor (PRO o GRATIS). Reinicia.');
                adminState[chatId] = { step: 'menu' }; return;
            }

            const seriesDataToSave = {
                tmdbId: (selectedSeries.tmdbId || selectedSeries.id).toString(), title: selectedSeries.title || selectedSeries.name, poster_path: selectedSeries.poster_path,
                seasonNumber: season, episodeNumber: episode, overview: selectedSeries.overview, // Añadido overview
                proEmbedCode: proEmbedCode, freeEmbedCode: freeEmbedCode, isPremium: !!proEmbedCode && !freeEmbedCode
            };

            try {
                await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, seriesDataToSave);
                bot.sendMessage(chatId, `✅ Episodio S${season}E${episode} guardado.`);

                // Opción de publicar y notificar solo si es el primer episodio O si lo decides
                // Aquí simplificamos: siempre preguntamos después de guardar
                const nextEpisodeNumber = episode + 1;
                const options = { reply_markup: { inline_keyboard: [
                    [{ text: `➡️ Agregar S${season}E${nextEpisodeNumber}`, callback_data: `add_next_episode_${seriesDataToSave.tmdbId}_${season}` }],
                    [{ text: `🚀 Publicar S${season}E${episode} y Finalizar`, callback_data: `publish_this_episode_${seriesDataToSave.tmdbId}_${season}_${episode}` }], // Nueva opción
                    [{ text: '⏹️ Finalizar sin publicar', callback_data: `finish_series_${seriesDataToSave.tmdbId}` }]
                ]}};
                bot.sendMessage(chatId, '¿Qué quieres hacer ahora?', options);
                adminState[chatId] = { step: 'awaiting_series_action', lastSavedEpisodeData: seriesDataToSave }; // Guardamos datos del último ep

            } catch (error) {
                console.error("Error guardando episodio:", error.response ? error.response.data : error.message);
                bot.sendMessage(chatId, 'Error guardando episodio.');
            }
        // === FIN DEL CAMBIO ===

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
            } catch (error) {
                console.error("Error buscando para eliminar:", error);
                bot.sendMessage(chatId, 'Error buscando.');
            }
        }
    });

    bot.on('callback_query', async (callbackQuery) => {
        const msg = callbackQuery.message;
        const data = callbackQuery.data;
        const chatId = msg.chat.id;
        if (chatId !== ADMIN_CHAT_ID) return;

        // --- Manejo de Callbacks ---
        try { // Envolver todo en try-catch general
            bot.answerCallbackQuery(callbackQuery.id); // Confirmar recepción

            if (data === 'add_movie') {
                adminState[chatId] = { step: 'search_movie' };
                bot.sendMessage(chatId, 'Escribe el nombre de la película a agregar.');
            } else if (data === 'add_series') {
                adminState[chatId] = { step: 'search_series' };
                bot.sendMessage(chatId, 'Escribe el nombre de la serie a agregar.');
            } else if (data === 'eventos') {
                adminState[chatId] = { step: 'awaiting_event_image' };
                bot.sendMessage(chatId, 'Envía el ENLACE (URL) de la imagen para el evento.');
            } else if (data.startsWith('add_new_movie_')) {
                const tmdbId = data.split('_')[3];
                const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
                const response = await axios.get(tmdbUrl);
                adminState[chatId] = { selectedMedia: response.data, mediaType: 'movie', step: 'awaiting_pro_link_movie' };
                bot.sendMessage(chatId, `"${response.data.title}". Envía link PRO (o "no").`);
            } else if (data.startsWith('add_new_series_')) {
                const tmdbId = data.split('_')[3];
                const tmdbUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
                const response = await axios.get(tmdbUrl);
                const seasons = response.data.seasons?.filter(s => s.season_number > 0); // Excluir temporada 0
                if (seasons?.length > 0) {
                    adminState[chatId] = { selectedSeries: response.data, mediaType: 'series', step: 'awaiting_season_selection' };
                    const buttons = seasons.map(s => [{ text: `${s.name} (S${s.season_number})`, callback_data: `select_season_${tmdbId}_${s.season_number}` }]);
                    bot.sendMessage(chatId, `"${response.data.name}". Selecciona temporada:`, { reply_markup: { inline_keyboard: buttons } });
                } else {
                    bot.sendMessage(chatId, `No se encontraron temporadas válidas.`);
                    adminState[chatId] = { step: 'menu' };
                }
            } else if (data.startsWith('manage_movie_')) {
                const tmdbId = data.split('_')[2];
                const existingData = await mongoDb.collection('media_catalog').findOne({ tmdbId: tmdbId });
                if (!existingData) { bot.sendMessage(chatId, 'Error: No encontrada en MongoDB.'); return; }
                // Lógica para mostrar opciones de gestión (add_pro, add_free)
                let buttons = [];
                if (!existingData.proEmbedCode) buttons.push([{ text: 'Agregar PRO', callback_data: `add_pro_movie_${tmdbId}` }]);
                if (!existingData.freeEmbedCode) buttons.push([{ text: 'Agregar Gratis', callback_data: `add_free_movie_${tmdbId}` }]);
                if(buttons.length === 0) { bot.sendMessage(chatId, `"${existingData.title}" ya tiene ambos links.`); return;}
                bot.sendMessage(chatId, `Gestionando "${existingData.title}". ¿Agregar versión?`, {reply_markup: {inline_keyboard: buttons}});

            } else if (data.startsWith('manage_series_')) {
                const tmdbId = data.split('_')[2];
                const seriesData = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
                if (!seriesData) { bot.sendMessage(chatId, 'Error: No encontrada en MongoDB.'); return; }
                // Lógica para mostrar temporadas a gestionar o añadir nueva
                let buttons = [];
                if (seriesData.seasons) {
                    Object.keys(seriesData.seasons).sort((a,b)=> parseInt(a)-parseInt(b)).forEach(seasonNum => {
                        buttons.push([{ text: `Gestionar S${seasonNum}`, callback_data: `manage_season_${tmdbId}_${seasonNum}` }]);
                    });
                }
                buttons.push([{ text: `➕ Añadir Nueva Temporada`, callback_data: `add_new_season_${tmdbId}` }]);
                bot.sendMessage(chatId, `Gestionando "${seriesData.title || seriesData.name}". Selecciona:`, { reply_markup: { inline_keyboard: buttons } });

            } else if (data.startsWith('add_pro_movie_') || data.startsWith('add_free_movie_')) {
                const isProLink = data.startsWith('add_pro');
                const tmdbId = data.split('_')[3];
                const existingData = await mongoDb.collection('media_catalog').findOne({ tmdbId: tmdbId });
                if (!existingData) { bot.sendMessage(chatId, 'Error: No encontrada.'); return; }
                adminState[chatId] = {
                    selectedMedia: existingData, mediaType: 'movie',
                    proEmbedCode: isProLink ? undefined : existingData.proEmbedCode, // Si añado PRO, espero PRO. Si añado Free, guardo el PRO existente.
                    freeEmbedCode: isProLink ? existingData.freeEmbedCode : undefined, // Viceversa
                    step: isProLink ? 'awaiting_pro_link_movie' : 'awaiting_free_link_movie'
                };
                bot.sendMessage(chatId, `Envía el reproductor ${isProLink ? 'PRO' : 'GRATIS'} para "${existingData.title}".`);

            } else if (data.startsWith('select_season_')) { // <-- CORREGIDO AQUÍ
                const [_, __, tmdbId, seasonNumber] = data.split('_');
                const state = adminState[chatId];
                if (!state || !state.selectedSeries || state.selectedSeries.id.toString() !== tmdbId) {
                    bot.sendMessage(chatId, 'Error: Estado inconsistente. Reinicia.'); adminState[chatId] = { step: 'menu' }; return;
                }
                state.season = parseInt(seasonNumber);
                state.episode = 1; // Empezar por el episodio 1
                state.step = 'awaiting_pro_link_series';
                bot.sendMessage(chatId, `S${seasonNumber} seleccionada. Envía link PRO para E1 (o "no").`);

            } else if (data.startsWith('manage_season_')) {
                const [_, __, tmdbId, seasonNumber] = data.split('_');
                const seriesData = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
                if (!seriesData) { bot.sendMessage(chatId, 'Error: No encontrada.'); return; }
                let lastEpisode = seriesData.seasons?.[seasonNumber]?.episodes ? Object.keys(seriesData.seasons[seasonNumber].episodes).length : 0;
                const nextEpisode = lastEpisode + 1;
                adminState[chatId] = {
                    step: 'awaiting_pro_link_series', selectedSeries: seriesData,
                    season: parseInt(seasonNumber), episode: nextEpisode
                };
                bot.sendMessage(chatId, `Gestionando S${seasonNumber}. Envía link PRO para E${nextEpisode} (o "no").`);

            } else if (data.startsWith('add_new_season_')) {
                // Similar a add_new_series, pero busca temporadas no existentes
                const tmdbId = data.split('_')[3];
                const tmdbUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
                const response = await axios.get(tmdbUrl);
                const existingDoc = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId }, { projection: { seasons: 1 } });
                const existingSeasons = existingDoc?.seasons ? Object.keys(existingDoc.seasons) : [];
                const availableSeasons = response.data.seasons?.filter(s => s.season_number > 0 && !existingSeasons.includes(s.season_number.toString()));

                if (availableSeasons?.length > 0) {
                    adminState[chatId] = { selectedSeries: response.data, mediaType: 'series', step: 'awaiting_season_selection' };
                    const buttons = availableSeasons.map(s => [{ text: `${s.name} (S${s.season_number})`, callback_data: `select_season_${tmdbId}_${s.season_number}` }]);
                    bot.sendMessage(chatId, `"${response.data.name}". ¿Qué temporada NUEVA agregar?`, { reply_markup: { inline_keyboard: buttons } });
                } else { bot.sendMessage(chatId, 'No hay más temporadas nuevas para agregar.'); }

            // =======================================================================
            // === ¡INICIO DE LA CORRECCIÓN DEL BOT! ===
            // =======================================================================
            } else if (data.startsWith('solicitud_')) {
                const tmdbId = data.split('_')[1];
                let mediaData;
                let mediaType;
            
                try {
                    // Intento 1: Buscar como Película
                    const movieUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
                    const movieResponse = await axios.get(movieUrl);
                    mediaData = movieResponse.data;
                    mediaType = 'movie';
                    console.log(`Solicitud ${tmdbId} encontrada como PELÍCULA.`);
                } catch (movieError) {
                    // Si falla (ej. 404), Intento 2: Buscar como Serie
                    console.log(`Solicitud ${tmdbId} no es película, intentando como serie...`);
                    try {
                        const tvUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
                        const tvResponse = await axios.get(tvUrl);
                        mediaData = tvResponse.data;
                        mediaType = 'series'; // Usar 'series' para que coincida con tu lógica
                        console.log(`Solicitud ${tmdbId} encontrada como SERIE.`);
                    } catch (tvError) {
                        console.error("Error al buscar solicitud en TMDB (Movie y TV):", tvError.message);
                        bot.sendMessage(chatId, `❌ Error: No se pudo encontrar el TMDB ID ${tmdbId} ni como película ni como serie.`);
                        return; // Salir si no se encuentra en ninguna
                    }
                }
            
                // Ahora, continúa con la lógica correcta dependiendo del mediaType
                if (mediaType === 'movie') {
                    // --- Flujo de Película (como lo tenías) ---
                    adminState[chatId] = { selectedMedia: mediaData, mediaType: 'movie', step: 'awaiting_pro_link_movie' };
                    bot.sendMessage(chatId, `Atendiendo solicitud (Película): "${mediaData.title}". Envía link PRO (o "no").`);
                } else { 
                    // --- Flujo de Serie (copiado de 'add_new_series_') ---
                    const seasons = mediaData.seasons?.filter(s => s.season_number > 0);
                    if (seasons?.length > 0) {
                        adminState[chatId] = { selectedSeries: mediaData, mediaType: 'series', step: 'awaiting_season_selection' };
                        const buttons = seasons.map(s => [{ text: `${s.name} (S${s.season_number})`, callback_data: `select_season_${tmdbId}_${s.season_number}` }]);
                        bot.sendMessage(chatId, `Atendiendo solicitud (Serie): "${mediaData.name}". Selecciona la temporada a la que quieres agregar episodios:`, { reply_markup: { inline_keyboard: buttons } });
                    } else {
                        bot.sendMessage(chatId, `La serie "${mediaData.name}" no tiene temporadas válidas.`);
                        adminState[chatId] = { step: 'menu' };
                    }
                }
            // =======================================================================
            // === ¡FIN DE LA CORRECCIÓN DEL BOT! ===
            // =======================================================================

            } else if (data === 'manage_movies') {
                adminState[chatId] = { step: 'search_manage' }; // ¿Reutilizar search_movie/series o lógica específica?
                bot.sendMessage(chatId, 'Escribe el nombre del contenido a gestionar.');
            } else if (data === 'delete_movie') {
                adminState[chatId] = { step: 'search_delete' };
                bot.sendMessage(chatId, 'Escribe el nombre del contenido a ELIMINAR.');
            } else if (data.startsWith('delete_confirm_')) {
                const [_, __, tmdbId, mediaType] = data.split('_');
                const collectionName = mediaType === 'movie' ? 'media_catalog' : 'series_catalog';
                const result = await mongoDb.collection(collectionName).deleteOne({ tmdbId: tmdbId });
                if (result.deletedCount > 0) {
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                    bot.sendMessage(chatId, `✅ Contenido TMDB ID ${tmdbId} (${mediaType}) eliminado de MongoDB.`);
                } else {
                    bot.sendMessage(chatId, `⚠️ No se encontró el contenido TMDB ID ${tmdbId} (${mediaType}) para eliminar.`);
                }
                adminState[chatId] = { step: 'menu' };

            } else if (data.startsWith('save_only_')) {
                const { movieDataToSave } = adminState[chatId];
                if (!movieDataToSave?.tmdbId) { bot.sendMessage(chatId, 'Error: Datos perdidos.'); adminState[chatId] = { step: 'menu' }; return; }
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `✅ "${movieDataToSave.title}" guardada.`);
                adminState[chatId] = { step: 'menu' };
            } else if (data.startsWith('save_and_publish_')) {
                const { movieDataToSave } = adminState[chatId];
                if (!movieDataToSave?.tmdbId) { bot.sendMessage(chatId, 'Error: Datos perdidos.'); adminState[chatId] = { step: 'menu' }; return; }
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `✅ "${movieDataToSave.title}" guardada. Publicando...`);
                // await publishMovieToChannels(movieDataToSave); // Descomenta si tienes esta función
                // Preguntar si notificar
                adminState[chatId].title = movieDataToSave.title; // Guardar título para notificación
                bot.sendMessage(chatId, `¿Enviar notificación push a los usuarios sobre "${movieDataToSave.title}"?`, {
                    reply_markup: { inline_keyboard: [[
                        { text: '📲 Sí, notificar', callback_data: `send_push_${movieDataToSave.tmdbId}_movie` },
                        { text: '❌ No notificar', callback_data: `finish_no_push` }
                    ]]}
                });
                // No resetear step aquí, esperar respuesta de notificación

            } else if (data.startsWith('add_next_episode_')) {
                const [_, __, ___, tmdbId, seasonNumber] = data.split('_');
                const seriesData = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
                if (!seriesData) { bot.sendMessage(chatId, 'Error: Serie no encontrada.'); return; }
                let lastEpisode = seriesData.seasons?.[seasonNumber]?.episodes ? Object.keys(seriesData.seasons[seasonNumber].episodes).length : 0;
                const nextEpisode = lastEpisode + 1;
                adminState[chatId] = {
                    step: 'awaiting_pro_link_series', selectedSeries: seriesData,
                    season: parseInt(seasonNumber), episode: nextEpisode
                };
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `Siguiente: Envía link PRO para S${seasonNumber}E${nextEpisode} (o "no").`);

            } else if (data.startsWith('publish_this_episode_')) {
                const [_, __, ___, tmdbId, season, episode] = data.split('_');
                const state = adminState[chatId];
                const episodeData = state?.lastSavedEpisodeData; // Usar los datos guardados
                if (!episodeData || episodeData.tmdbId !== tmdbId || episodeData.seasonNumber.toString() !== season || episodeData.episodeNumber.toString() !== episode) {
                    bot.sendMessage(chatId, 'Error: Datos del episodio no coinciden o se perdieron. Finalizando.');
                    adminState[chatId] = { step: 'menu' }; return;
                }
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `✅ Publicando S${season}E${episode}...`);
                // await publishSeriesEpisodeToChannels(episodeData); // Descomenta si tienes esta función
                adminState[chatId].title = `${episodeData.title} S${season}E${episode}`; // Para notificación
                bot.sendMessage(chatId, `¿Enviar notificación push sobre S${season}E${episode}?`, {
                reply_markup: { inline_keyboard: [[
                    { text: '📲 Sí, notificar', callback_data: `send_push_${tmdbId}_tv` }, // mediaType es 'tv'
                    { text: '❌ No notificar', callback_data: `finish_no_push` }
                ]]}
                });
                // No resetear step, esperar respuesta

            } else if (data.startsWith('finish_series_') || data === 'finish_no_push') {
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(()=>{}); // Ignorar error si el mensaje ya no existe
                bot.sendMessage(chatId, '✅ Proceso finalizado. Volviendo al menú.');
                adminState[chatId] = { step: 'menu' };
            } else if (data.startsWith('send_push_')) {
                const [_, __, tmdbId, mediaType] = data.split('_');
                const state = adminState[chatId];
                const title = state?.title; // Título guardado previamente
                if (!title) { bot.sendMessage(chatId, 'Error: Título perdido.'); adminState[chatId] = { step: 'menu' }; return; }

                await axios.post(`${RENDER_BACKEND_URL}/api/notify`, { tmdbId, mediaType, title });
                bot.editMessageText(`✅ Notificaciones push para *${title}* programadas.`, { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } });
                adminState[chatId] = { step: 'menu' };
            }

        } catch (error) {
            console.error("Error en callback_query:", error);
            bot.sendMessage(chatId, '❌ Ocurrió un error procesando tu solicitud.');
            // Considerar resetear el estado si el error es grave
            // adminState[chatId] = { step: 'menu' };
        }
    });

} // Fin de initializeBot

// Exportamos la función para que server.js pueda importarla
module.exports = initializeBot;
