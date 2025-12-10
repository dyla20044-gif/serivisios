function initializeBot(bot, db, mongoDb, adminState, ADMIN_CHAT_ID, TMDB_API_KEY, RENDER_BACKEND_URL, axios, pinnedCache) {

    console.log("🤖 Lógica del Bot (Full Features + Pinned Refresh + Cache Clear) inicializada...");
    
    bot.setMyCommands([
        { command: 'start', description: 'Reiniciar el bot y ver el menú principal' },
        { command: 'subir', description: 'Subir una película o serie a la base de datos' },
        { command: 'editar', description: 'Editar los enlaces de una película o serie existente' },
        { command: 'pedidos', description: 'Ver la lista de películas solicitadas por los usuarios' }
    ]);

    bot.onText(/\/start|\/subir/, (msg) => {
        const chatId = msg.chat.id;
        if (chatId !== ADMIN_CHAT_ID) {
            return; 
        }
        adminState[chatId] = { step: 'menu' };
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'Agregar películas', callback_data: 'add_movie' },
                        { text: 'Agregar series', callback_data: 'add_series' }
                    ],
                    [{ text: '🔔 Ver Pedidos', callback_data: 'view_requests_menu' }],
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

    bot.on('message', async (msg) => {
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

        const chatId = msg.chat.id;
        const userText = msg.text;

        if (!userText) {
            return;
        }

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
                    bot.sendMessage(chatId, 'Para soporte o dudas, puedes contactar al desarrollador en: @TuUsuarioDeTelegram');
                    return; 
                }
            }
        }
        
        if (chatId !== ADMIN_CHAT_ID) {
             if (userText.startsWith('/')) {
                 bot.sendMessage(chatId, 'Lo siento, no tienes permiso para usar este comando.');
             }
            return;
        }

        if (userText.startsWith('/')) {
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
             } catch (error) { console.error("Error buscando para gestion:", error); bot.sendMessage(chatId, 'Error buscando.'); }

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
        
        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_event_image') {
            if (!userText.startsWith('http')) { bot.sendMessage(chatId, '❌ Envía un ENLACE (URL) de imagen válido.'); return; }
            adminState[chatId].imageUrl = userText;
            adminState[chatId].step = 'awaiting_event_description';
            bot.sendMessage(chatId, 'Enlace recibido! Ahora envía la DESCRIPCIÓN.');
        } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_event_description') {
           const { imageUrl } = adminState[chatId];
            const description = userText;
            try {
                bot.sendMessage(chatId, '✅ Evento guardado y listo para notificar.');
            } catch (error) { 
                bot.sendMessage(chatId, '❌ Error guardando evento.');
            }
            finally { adminState[chatId] = { step: 'menu' }; }
        }
        
        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_unified_link_movie') {
            const { selectedMedia } = adminState[chatId];
            if (!selectedMedia?.id) { 
                bot.sendMessage(chatId, 'Error: Se perdieron los datos de la película.'); 
                adminState[chatId] = { step: 'menu' }; 
                return; 
            }
            const linkInput = userText.trim();
            const finalLink = linkInput.toLowerCase() === 'no' ? null : linkInput;

            if (!finalLink) {
                bot.sendMessage(chatId, '❌ Debes enviar al menos un enlace válido. Escribe el enlace.');
                return;
            }
            
            adminState[chatId].movieDataToSave = {
                tmdbId: selectedMedia.id.toString(),
                title: selectedMedia.title,
                overview: selectedMedia.overview,
                poster_path: selectedMedia.poster_path,
                backdrop_path: selectedMedia.backdrop_path, 
                proEmbedCode: finalLink,
                freeEmbedCode: finalLink,
                isPremium: false,
                genres: selectedMedia.genres || [],
                release_date: selectedMedia.release_date,
                popularity: selectedMedia.popularity,
                vote_average: selectedMedia.vote_average,
                origin_country: selectedMedia.origin_country || [],
                isPinned: false
            };

            adminState[chatId].step = 'awaiting_pinned_choice_movie';
            
            bot.sendMessage(chatId, `✅ Enlace recibido.\n\n⭐ **¿Deseas FIJAR esta película en DESTACADOS (Top)?**`, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '⭐ Sí, Destacar (Top)', callback_data: 'set_pinned_movie_true' },
                            { text: '📅 No, Normal', callback_data: 'set_pinned_movie_false' }
                        ]
                    ]
                }
            });
        }

        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_unified_link_series') {
            const { selectedSeries, season, episode, totalEpisodesInSeason } = adminState[chatId]; 
            if (!selectedSeries) { 
                bot.sendMessage(chatId, 'Error: Se perdieron los datos de la serie.'); 
                adminState[chatId] = { step: 'menu' }; 
                return; 
            }

            const linkInput = userText.trim();
            const finalLink = linkInput.toLowerCase() === 'no' ? null : linkInput;

            if (!finalLink) {
                bot.sendMessage(chatId, '❌ Debes enviar un enlace válido.');
                return;
            }

            adminState[chatId].seriesDataToSave = {
                tmdbId: (selectedSeries.tmdbId || selectedSeries.id).toString(),
                title: selectedSeries.title || selectedSeries.name,
                poster_path: selectedSeries.poster_path,
                seasonNumber: season,
                episodeNumber: episode,
                overview: selectedSeries.overview,
                proEmbedCode: finalLink,
                freeEmbedCode: finalLink,
                isPremium: false,
                genres: selectedSeries.genres || [],
                first_air_date: selectedSeries.first_air_date,
                popularity: selectedSeries.popularity,
                vote_average: selectedSeries.vote_average,
                origin_country: selectedSeries.origin_country || [],
                isPinned: false
            };

            adminState[chatId].step = 'awaiting_pinned_choice_series';

            bot.sendMessage(chatId, `✅ Enlace recibido para S${season}E${episode}.\n\n⭐ **¿Deseas FIJAR esta serie en DESTACADOS (Top)?**`, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '⭐ Sí, Destacar', callback_data: 'set_pinned_series_true' },
                            { text: '📅 No, Normal', callback_data: 'set_pinned_series_false' }
                        ]
                    ]
                }
            });
        }
        
        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_edit_movie_link') {
            const { tmdbId, isPro } = adminState[chatId];
            const linkInput = userText.trim();
            if (!linkInput) { bot.sendMessage(chatId, '❌ Enlace inválido.'); return; }

            const movieDataToUpdate = {
                tmdbId: tmdbId,
                proEmbedCode: linkInput,
                freeEmbedCode: linkInput, 
                isPremium: false 
            };

            try {
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToUpdate);
                bot.sendMessage(chatId, `✅ Enlace actualizado correctamente para ID ${tmdbId}.`);
            } catch (error) {
                bot.sendMessage(chatId, `❌ Error al actualizar.`);
            }
            adminState[chatId] = { step: 'menu' };
        }
    });

    
    bot.on('callback_query', async (callbackQuery) => {
        const msg = callbackQuery.message;
        const data = callbackQuery.data;
        const chatId = msg.chat.id;

        try {
            
            if (data === 'public_help') {
                bot.answerCallbackQuery(callbackQuery.id);
                const helpMessage = `👋 ¡Hola! Soy un Bot de Auto-Aceptación de Solicitudes.
                    
**Función Principal:**
Me encargo de aceptar automáticamente a los usuarios que quieran unirse a tu canal o grupo privado.`;
                bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
                return;
            }
            
            if (data === 'public_contact') {
                bot.answerCallbackQuery(callbackQuery.id);
                bot.sendMessage(chatId, 'Para soporte o dudas, puedes contactar al desarrollador en: @TuUsuarioDeTelegram');
                return;
            }
            
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
                bot.sendMessage(chatId, 'Escribe el nombre del serie a agregar.'); 
            }
            else if (data === 'eventos') { 
                adminState[chatId] = { step: 'awaiting_event_image' }; 
                bot.sendMessage(chatId, 'Envía el ENLACE (URL) de la imagen para el evento.'); 
            }
            
            else if (data === 'view_requests_menu') {
                const options = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🚀 Ultra Rápido (1-2h)', callback_data: 'req_filter_ultra' }],
                            [{ text: '⚡ Rápido (12h)', callback_data: 'req_filter_fast' }],
                            [{ text: '📅 Regular (Semana)', callback_data: 'req_filter_regular' }],
                            [{ text: '⬅️ Volver', callback_data: 'back_to_menu' }]
                        ]
                    }
                };
                bot.sendMessage(chatId, '📂 *Filtrar Pedidos por Prioridad:*', { parse_mode: 'Markdown', ...options });
            }
            else if (data.startsWith('req_filter_')) {
                const filterType = data.split('_')[2]; 
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
                        .sort({ votes: -1 }) 
                        .limit(10)
                        .toArray();

                    if (requests.length === 0) {
                        bot.sendMessage(chatId, `✅ No hay pedidos pendientes en la categoría: ${filterType}`);
                    } else {
                        bot.sendMessage(chatId, `📋 *${titleMsg}:*`, { parse_mode: 'Markdown' });
                        for (const req of requests) {
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

            else if (data.startsWith('add_new_movie_') || data.startsWith('solicitud_')) {
                let tmdbId = '';
                if (data.startsWith('add_new_movie_')) {
                    tmdbId = data.split('_')[3];
                } else if (data.startsWith('solicitud_')) {
                    tmdbId = data.split('_')[1];
                    try {
                        await mongoDb.collection('movie_requests').deleteMany({ tmdbId: tmdbId.toString() });
                    } catch (e) { console.warn("No se pudo eliminar de solicitudes."); }
                }

                try {
                    const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=credits,keywords,release_dates,external_ids,videos`;
                    const response = await axios.get(tmdbUrl);
                    const movieData = response.data;
                    
                    const genreIds = movieData.genres ? movieData.genres.map(g => g.name) : [];
                    
                    const countries = movieData.production_countries ? movieData.production_countries.map(c => c.iso_3166_1) : [];

                    adminState[chatId] = {
                        step: 'awaiting_unified_link_movie',
                        selectedMedia: {
                            id: movieData.id,
                            title: movieData.title,
                            overview: movieData.overview,
                            poster_path: movieData.poster_path,
                            backdrop_path: movieData.backdrop_path,
                            genres: genreIds,
                            release_date: movieData.release_date,
                            popularity: movieData.popularity,
                            vote_average: movieData.vote_average,
                            origin_country: countries
                        }
                    };
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
                    bot.sendMessage(chatId, `🎬 Película: *${movieData.title}*\n🏷️ Géneros: ${genreIds.length}\n🌍 Países: ${countries.join(', ')}\n\n🔗 Envía el **ENLACE (Link)** del video.`, { parse_mode: 'Markdown' });
                } catch (error) {
                    console.error("Error al obtener detalles de TMDB:", error.message);
                    bot.sendMessage(chatId, 'Error al obtener los detalles de TMDB.');
                }
            }
            
            else if (data.startsWith('set_pinned_movie_')) {
                const isPinned = data === 'set_pinned_movie_true';
                if (!adminState[chatId].movieDataToSave) {
                    bot.sendMessage(chatId, 'Error de estado.');
                    return;
                }
                adminState[chatId].movieDataToSave.isPinned = isPinned;
                adminState[chatId].step = 'awaiting_publish_choice';
                const mediaId = adminState[chatId].movieDataToSave.tmdbId;

                bot.editMessageText(`✅ Enlace y estado 'Destacados' guardados. **¿Cómo deseas publicar?**`, {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '💾 Solo Guardar (No Publicar)', callback_data: `save_only_${mediaId}` }],
                            [{ text: '📲 App + PUSH', callback_data: `publish_push_app_${mediaId}` }],
                            [{ text: '🚀 Canal + PUSH', callback_data: `publish_push_channel_${mediaId}` }],
                            [{ text: '📢 Solo Canal', callback_data: `publish_channel_no_push_${mediaId}` }]
                        ]
                    }
                });
            }

            else if (data.startsWith('set_pinned_series_')) {
                const isPinned = data === 'set_pinned_series_true';
                if (!adminState[chatId].seriesDataToSave) {
                    bot.sendMessage(chatId, 'Error de estado.');
                    return;
                }
                adminState[chatId].seriesDataToSave.isPinned = isPinned;
                adminState[chatId].step = 'awaiting_publish_choice_series';

                const { tmdbId, seasonNumber, episodeNumber } = adminState[chatId].seriesDataToSave;

                bot.editMessageText(`✅ Enlace y estado 'Destacados' guardados para S${seasonNumber}E${episodeNumber}. **¿Cómo deseas publicar?**`, {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '💾 Solo Guardar (No Publicar)', callback_data: `save_only_series_${tmdbId}_${seasonNumber}_${episodeNumber}` }],
                            [{ text: '📲 App + PUSH', callback_data: `publish_push_this_episode_${tmdbId}_${seasonNumber}_${episodeNumber}` }],
                            [{ text: '🚀 Canal + PUSH', callback_data: `publish_push_channel_this_episode_${tmdbId}_${seasonNumber}_${episodeNumber}` }],
                            [{ text: '📢 Solo Canal', callback_data: `publish_channel_no_push_this_episode_${tmdbId}_${seasonNumber}_${episodeNumber}` }],
                            [{ text: '⬅️ Volver', callback_data: `manage_season_${tmdbId}_${seasonNumber}` }]
                        ]
                    }
                });
            }

            else if (data === 'manage_movies') {
                adminState[chatId] = { step: 'search_manage' };
                bot.sendMessage(chatId, 'Escribe el nombre de la película o serie que deseas **gestionar (editar enlaces/eliminar)**.');
            }
            else if (data === 'delete_movie') {
                adminState[chatId] = { step: 'search_delete' };
                bot.sendMessage(chatId, 'Escribe el nombre del contenido que deseas **eliminar definitivamente**.');
            }
            
            else if (data.startsWith('manage_movie_')) {
                const tmdbId = data.split('_')[2];
                try {
                    const existingMovie = await mongoDb.collection('media_catalog').findOne({ tmdbId: tmdbId.toString() });
                    if (!existingMovie) {
                        bot.sendMessage(chatId, '⚠️ Esta película no está en el catálogo para ser gestionada.');
                        return;
                    }

                    const pinnedStatus = existingMovie.isPinned ? '⭐ Destacado (Top)' : '📅 Normal';
                    const actionButton = existingMovie.isPinned 
                        ? { text: '❌ Quitar de Destacados', callback_data: `pin_action_unpin_movie_${tmdbId}` }
                        : { text: '⭐ Fijar en Destacados', callback_data: `pin_action_pin_movie_${tmdbId}` };

                    const linkType = existingMovie.isPremium ? 'PRO' : 'FREE';

                    bot.editMessageText(`🎬 **GESTIONAR PELÍCULA**\n\n*${existingMovie.title}*\n\n**ID:** \`${tmdbId}\`\n**Link Actual (${linkType}):** ${existingMovie.proEmbedCode ? '✅ Ingresado' : '❌ Faltante'}\n**Estado Pinned:** ${pinnedStatus}`, {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '✏️ Editar Enlace', callback_data: `edit_movie_link_${tmdbId}` },
                                    actionButton
                                ],
                                [{ text: '🔄 Refrescar a Top 1 (Pinned)', callback_data: `pin_action_refresh_movie_${tmdbId}` }],
                                [{ text: '🗑️ Eliminar Definitivamente', callback_data: `delete_confirm_${tmdbId}_movie` }]
                            ]
                        }
                    });
                } catch (error) {
                    console.error("Error al gestionar película:", error);
                    bot.sendMessage(chatId, '❌ Error al cargar datos para gestionar.');
                }
            }

            else if (data.startsWith('edit_movie_link_')) {
                const tmdbId = data.split('_')[3];
                adminState[chatId] = { step: 'awaiting_edit_movie_link', tmdbId: tmdbId, isPro: false };
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `Enviando nuevo enlace para ID: *${tmdbId}*.`, { parse_mode: 'Markdown' });
            }

            else if (data.startsWith('delete_confirm_')) {
                const parts = data.split('_');
                const tmdbId = parts[2];
                const mediaType = parts[3];
                
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

            else if (data.startsWith('save_only_')) {
                const { movieDataToSave } = adminState[chatId];
                if (!movieDataToSave?.tmdbId) {
                    bot.sendMessage(chatId, 'Error: Datos perdidos.');
                    adminState[chatId] = { step: 'menu' };
                    return;
                }
                
                try {
                    const postData = movieDataToSave;
                    
                    if (movieDataToSave.isPinned) {
                        postData.addedAt = new Date();
                        pinnedCache.del('pinned_content');
                    }
                    
                    await axios.post(`${RENDER_BACKEND_URL}/add-movie`, postData);
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
                    bot.sendMessage(chatId, `✅ Película *${movieDataToSave.title}* guardada en el catálogo.`);
                } catch (error) {
                    console.error("Error guardando película:", error.message);
                    bot.sendMessage(chatId, '❌ Error guardando en servidor.');
                }
                adminState[chatId] = { step: 'menu' };
            }

            else if (data.startsWith('publish_push_app_')) {
                const mediaId = data.split('_')[3];
                const { movieDataToSave } = adminState[chatId];
                
                if (!movieDataToSave || movieDataToSave.tmdbId !== mediaId) {
                    bot.sendMessage(chatId, 'Error: Datos perdidos. Intenta de nuevo.');
                    adminState[chatId] = { step: 'menu' };
                    return;
                }

                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `✅ Película ${movieDataToSave.title}. Iniciando publicación App + PUSH...`);
                
                try {
                    await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                    
                    if (movieDataToSave.isPinned) {
                        pinnedCache.del('pinned_content');
                    }

                    await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                        title: `¡Nueva Película! ${movieDataToSave.title}`,
                        body: movieDataToSave.overview || '¡Ya disponible para ver en la App!',
                        imageUrl: movieDataToSave.poster_path ? `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}` : null,
                        tmdbId: movieDataToSave.tmdbId,
                        mediaType: 'movie'
                    });
                    
                    bot.sendMessage(chatId, '✅ Publicación completada (App + PUSH).');
                } catch (error) {
                    console.error("Error en publicacion PUSH/App:", error.message);
                    bot.sendMessage(chatId, '❌ Error en la publicación PUSH/App.');
                }
                adminState[chatId] = { step: 'menu' };
            }
            
            else if (data.startsWith('publish_push_channel_')) {
                const mediaId = data.split('_')[3];
                const { movieDataToSave } = adminState[chatId];
                
                if (!movieDataToSave || movieDataToSave.tmdbId !== mediaId) {
                    bot.sendMessage(chatId, 'Error: Datos perdidos. Intenta de nuevo.');
                    adminState[chatId] = { step: 'menu' };
                    return;
                }

                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `✅ Película ${movieDataToSave.title}. Iniciando doble publicación (Canales + PUSH)...`);
                
                try {
                    await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                    
                    if (movieDataToSave.isPinned) {
                        pinnedCache.del('pinned_content');
                    }
                    
                    await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                        title: `¡Nueva Película! ${movieDataToSave.title}`,
                        body: movieDataToSave.overview || '¡Ya disponible para ver en la App!',
                        imageUrl: movieDataToSave.poster_path ? `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}` : null,
                        tmdbId: movieDataToSave.tmdbId,
                        mediaType: 'movie'
                    });
                    
                    const DEEPLINK_URL = `${RENDER_BACKEND_URL}/app/details/${movieDataToSave.tmdbId}`;
                    const CHANNEL_SMALL = process.env.TELEGRAM_CHANNEL_A_ID;
                    const CHANNEL_BIG_ID = process.env.TELEGRAM_CHANNEL_B_ID;
                    
                    if (CHANNEL_SMALL) {
                        const messageToSmall = `🎬 *¡PELÍCULA COMPLETA DISPONIBLE!* 🎬\n\n` +
                            `**${movieDataToSave.title}**\n\n` +
                            `${movieDataToSave.overview || 'Sin sinopsis.'}\n\n` +
                            `_Toca el botón para ver en la App:_`;
                            
                        const sentMsgSmall = await bot.sendPhoto(CHANNEL_SMALL, movieDataToSave.poster_path ? `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}` : 'https://placehold.co/500x750?text=SALA+CINE', { 
                            caption: messageToSmall, 
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '▶️ Ver Ahora en la App', url: DEEPLINK_URL }]
                                ]
                            }
                        });
                        
                        const channelUsername = CHANNEL_SMALL.replace('@', '');
                        const linkToPost = `https://t.me/${channelUsername}/${sentMsgSmall.message_id}`;
                        
                        if (CHANNEL_BIG_ID) {
                            const releaseYear = movieDataToSave.release_date ? `(${movieDataToSave.release_date.substring(0, 4)})` : '';
                            const overviewTeaser = movieDataToSave.overview ? movieDataToSave.overview.length > 250 ? movieDataToSave.overview.substring(0, 250) + '...' : movieDataToSave.overview : 'Una historia increíble te espera...';
                            const messageToBig = `🍿 *ESTRENO YA DISPONIBLE* 🍿\n\n` +
                                `🎬 *${movieDataToSave.title}* ${releaseYear}\n\n` +
                                `📝 _${overviewTeaser}_`;
                                
                            await bot.sendPhoto(CHANNEL_BIG_ID, movieDataToSave.poster_path ? `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}` : 'https://placehold.co/500x750?text=SALA+CINE', {
                                caption: messageToBig,
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: '➡️ Ver Post Completo', url: linkToPost }]
                                    ]
                                }
                            });
                        }
                    }

                    bot.sendMessage(chatId, '✅ Publicación completada (Canales + PUSH).');
                } catch (error) {
                    console.error("Error en publicacion de Canales/PUSH:", error.message);
                    bot.sendMessage(chatId, '❌ Error en la publicación de Canales/PUSH.');
                }
                adminState[chatId] = { step: 'menu' };
            }

            else if (data.startsWith('publish_channel_no_push_')) {
                 const mediaId = data.split('_')[4];
                 const { movieDataToSave } = adminState[chatId];
                
                if (!movieDataToSave || movieDataToSave.tmdbId !== mediaId) {
                    bot.sendMessage(chatId, 'Error: Datos perdidos. Intenta de nuevo.');
                    adminState[chatId] = { step: 'menu' };
                    return;
                }

                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `✅ Película ${movieDataToSave.title}. Iniciando publicación en CANAL (Silencioso)...`);
                
                try {
                    await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                    
                    if (movieDataToSave.isPinned) {
                        pinnedCache.del('pinned_content');
                    }
                    
                    const DEEPLINK_URL = `${RENDER_BACKEND_URL}/app/details/${movieDataToSave.tmdbId}`;
                    const CHANNEL_SMALL = process.env.TELEGRAM_CHANNEL_A_ID;
                    const CHANNEL_BIG_ID = process.env.TELEGRAM_CHANNEL_B_ID;
                    
                    if (CHANNEL_SMALL) {
                        const messageToSmall = `🎬 *¡PELÍCULA COMPLETA DISPONIBLE!* 🎬\n\n` +
                            `**${movieDataToSave.title}**\n\n` +
                            `${movieDataToSave.overview || 'Sin sinopsis.'}\n\n` +
                            `_Toca el botón para ver en la App:_`;
                            
                        const sentMsgSmall = await bot.sendPhoto(CHANNEL_SMALL, movieDataToSave.poster_path ? `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}` : 'https://placehold.co/500x750?text=SALA+CINE', { 
                            caption: messageToSmall, 
                            parse_mode: 'Markdown',
                            disable_notification: true,
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '▶️ Ver Ahora en la App', url: DEEPLINK_URL }]
                                ]
                            }
                        });
                        
                        const channelUsername = CHANNEL_SMALL.replace('@', '');
                        const linkToPost = `https://t.me/${channelUsername}/${sentMsgSmall.message_id}`;
                        
                        if (CHANNEL_BIG_ID) {
                            const releaseYear = movieDataToSave.release_date ? `(${movieDataToSave.release_date.substring(0, 4)})` : '';
                            const overviewTeaser = movieDataToSave.overview ? movieDataToSave.overview.length > 250 ? movieDataToSave.overview.substring(0, 250) + '...' : movieDataToSave.overview : 'Una historia increíble te espera...';
                            const messageToBig = `🍿 *ESTRENO YA DISPONIBLE* 🍿\n\n` +
                                `🎬 *${movieDataToSave.title}* ${releaseYear}\n\n` +
                                `📝 _${overviewTeaser}_`;
                                
                            await bot.sendPhoto(CHANNEL_BIG_ID, movieDataToSave.poster_path ? `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}` : 'https://placehold.co/500x750?text=SALA+CINE', {
                                caption: messageToBig,
                                parse_mode: 'Markdown',
                                disable_notification: true,
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: '➡️ Ver Post Completo', url: linkToPost }]
                                    ]
                                }
                            });
                        }
                    }

                    bot.sendMessage(chatId, '✅ Publicación completada (Solo Canales, Silencioso).');
                } catch (error) {
                    console.error("Error en publicacion de Canales (No PUSH):", error.message);
                    bot.sendMessage(chatId, '❌ Error en la publicación de Canales (No PUSH).');
                }
                adminState[chatId] = { step: 'menu' };
            }

            else if (data.startsWith('add_new_series_')) {
                const tmdbId = data.split('_')[3];
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                
                try {
                    const tmdbUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=credits,keywords,external_ids,videos`;
                    const response = await axios.get(tmdbUrl);
                    const seriesData = response.data;
                    
                    const genreIds = seriesData.genres ? seriesData.genres.map(g => g.name) : [];
                    const originCountries = seriesData.origin_country || [];

                    adminState[chatId].selectedSeries = {
                        tmdbId: tmdbId,
                        title: seriesData.name,
                        overview: seriesData.overview,
                        poster_path: seriesData.poster_path,
                        genres: genreIds,
                        first_air_date: seriesData.first_air_date,
                        popularity: seriesData.popularity,
                        vote_average: seriesData.vote_average,
                        origin_country: originCountries
                    };
                    
                    const seasonButtons = seriesData.seasons
                        .filter(s => s.season_number > 0)
                        .map(season => {
                            return [{ 
                                text: `S${season.season_number} - ${season.name} (${season.episode_count} eps)`, 
                                callback_data: `add_series_season_${tmdbId}_${season.season_number}` 
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
                    bot.sendMessage(chatId, `📺 Serie: *${seriesData.name}*\n🌍 Países: ${originCountries.join(', ')}\n\nSelecciona la temporada a subir:`, { ...options, parse_mode: 'Markdown' });

                } catch (error) {
                    console.error("Error al obtener detalles de TMDB en add_new_series_:", error.message);
                    bot.sendMessage(chatId, 'Error al obtener los detalles de la serie desde TMDB.');
                }
            }

            else if (data.startsWith('add_series_season_')) {
                const [_, __, ___, tmdbId, seasonNumber] = data.split('_');
                
                try {
                    const seriesData = adminState[chatId]?.selectedSeries;
                    if (!seriesData || seriesData.tmdbId !== tmdbId) {
                         bot.sendMessage(chatId, 'Error: Datos de serie perdidos. Intenta de nuevo.');
                         return;
                    }

                    const lastSaved = await mongoDb.collection('series_catalog')
                        .findOne({ tmdbId: tmdbId.toString(), seasonNumber: parseInt(seasonNumber) }, 
                            { sort: { episodeNumber: -1 }, projection: { episodeNumber: 1 } });

                    const nextEpisode = (lastSaved ? lastSaved.episodeNumber : 0) + 1;
                    
                    adminState[chatId] = { 
                        ...adminState[chatId], 
                        step: 'awaiting_unified_link_series', 
                        season: parseInt(seasonNumber), 
                        episode: nextEpisode 
                    };
                    
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                    bot.sendMessage(chatId, `Siguiente: Envía **ENLACE** para S${seasonNumber}E${nextEpisode}.`);
                    
                } catch (error) {
                    console.error("Error al buscar último episodio:", error);
                    bot.sendMessage(chatId, 'Error al buscar el último episodio subido.');
                }
            }

            else if (data.startsWith('manage_series_')) {
                const tmdbId = data.split('_')[2];
                handleManageSeries(chatId, msg, tmdbId, bot, mongoDb, TMDB_API_KEY, adminState);
            }
            
            else if (data.startsWith('manage_season_')) {
                 const [_, __, tmdbId, seasonNumber] = data.split('_');
                 
                 try {
                     const existingEpisodes = await mongoDb.collection('series_catalog')
                         .find({ tmdbId: tmdbId.toString(), seasonNumber: parseInt(seasonNumber) })
                         .sort({ episodeNumber: 1 })
                         .toArray();
                         
                     const seasonUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}&language=es-ES`;
                     const response = await axios.get(seasonUrl);
                     const seasonData = response.data;
                     const totalEpisodesInSeason = seasonData.episodes.length;

                     const episodeButtons = existingEpisodes.map(ep => {
                         const linkType = ep.isPremium ? 'PRO' : 'FREE';
                         return [{ 
                             text: `✅ S${seasonNumber}E${ep.episodeNumber} (${linkType})`, 
                             callback_data: `manage_episode_${tmdbId}_${seasonNumber}_${ep.episodeNumber}`
                         }];
                     });
                     
                     const lastSavedEpNum = existingEpisodes.length > 0 ? existingEpisodes[existingEpisodes.length - 1].episodeNumber : 0;
                     const nextEpisodeNum = lastSavedEpNum + 1;
                     
                     let nextEpButton;
                     if (nextEpisodeNum <= totalEpisodesInSeason) {
                         nextEpButton = { 
                             text: `➕ Subir S${seasonNumber}E${nextEpisodeNum}`, 
                             callback_data: `add_next_episode_${tmdbId}_${seasonNumber}` 
                         };
                     } else {
                         nextEpButton = { 
                             text: `✅ Temporada Completa`, 
                             callback_data: `manage_series_${tmdbId}`
                         };
                     }
                     
                     const buttons = [
                         ...episodeButtons,
                         [{ text: '⬅️ Volver a Temporadas', callback_data: `manage_series_${tmdbId}` }],
                         [nextEpButton]
                     ];
                     
                     bot.editMessageText(`📺 **GESTIONAR SERIE**\n\n**Temporada ${seasonNumber}** (${existingEpisodes.length} / ${totalEpisodesInSeason} subidos)\n\n_Selecciona un episodio subido para editar, o sube el siguiente:_\n\n`, {
                         chat_id: chatId,
                         message_id: msg.message_id,
                         parse_mode: 'Markdown',
                         reply_markup: {
                             inline_keyboard: buttons
                         }
                     });

                 } catch (error) {
                     console.error("Error al gestionar temporada:", error);
                     bot.sendMessage(chatId, '❌ Error al cargar episodios de la temporada.');
                 }
            }

            else if (data.startsWith('manage_episode_')) {
                 const [_, __, tmdbId, season, episode] = data.split('_');
                 
                 try {
                     const episodeData = await mongoDb.collection('series_catalog').findOne({ 
                         tmdbId: tmdbId.toString(), 
                         seasonNumber: parseInt(season), 
                         episodeNumber: parseInt(episode)
                     });
                     
                     if (!episodeData) {
                         bot.sendMessage(chatId, `Episodio S${season}E${episode} no encontrado.`);
                         return;
                     }
                     
                     const pinnedStatus = episodeData.isPinned ? '⭐ Destacado (Top)' : '📅 Normal';
                     const actionButton = episodeData.isPinned 
                        ? { text: '❌ Quitar de Destacados', callback_data: `pin_action_unpin_tv_${tmdbId}_${season}_${episode}` }
                        : { text: '⭐ Fijar en Destacados', callback_data: `pin_action_pin_tv_${tmdbId}_${season}_${episode}` };
                     
                     const buttons = [
                         [{ text: '✏️ Editar Enlace', callback_data: `edit_episode_${tmdbId}_${season}_${episode}` }],
                         [actionButton, { text: '🔄 Refrescar a Top 1 (Pinned)', callback_data: `pin_action_refresh_tv_${tmdbId}_${season}_${episode}` }],
                         [{ text: '🗑️ Eliminar Episodio', callback_data: `delete_episode_${tmdbId}_${season}_${episode}` }],
                         [{ text: '⬅️ Volver a Temporada', callback_data: `manage_season_${tmdbId}_${season}` }]
                     ];
                     
                     bot.editMessageText(`📺 **GESTIONAR EPISODIO**\n\n*${episodeData.title}*\nS${season}E${episode}\n\n**Estado Pinned:** ${pinnedStatus}\n\n`, {
                         chat_id: chatId,
                         message_id: msg.message_id,
                         parse_mode: 'Markdown',
                         reply_markup: {
                             inline_keyboard: buttons
                         }
                     });

                 } catch (error) {
                     console.error("Error al gestionar episodio:", error);
                     bot.sendMessage(chatId, '❌ Error al cargar datos del episodio.');
                 }
            }

            else if (data.startsWith('edit_episode_')) {
                 const [_, __, tmdbId, season, episode] = data.split('_');
                 adminState[chatId] = { 
                     ...adminState[chatId], 
                     step: 'awaiting_unified_link_series', 
                     season: parseInt(season), 
                     episode: parseInt(episode) 
                 };
                 bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                 bot.sendMessage(chatId, `Enviando nuevo enlace para S${season}E${episode}.`);
            }
            
            else if (data.startsWith('add_next_episode_')) {
                const [_, __, tmdbId, seasonNumber] = data.split('_');
                
                const seriesData = adminState[chatId]?.selectedSeries;
                if (!seriesData || seriesData.tmdbId !== tmdbId) {
                     await handleManageSeries(chatId, msg, tmdbId, bot, mongoDb, TMDB_API_KEY, adminState);
                     const state = adminState[chatId];
                     adminState[chatId] = { ...state, season: parseInt(seasonNumber) };
                }

                try {
                    const lastSaved = await mongoDb.collection('series_catalog')
                        .findOne({ tmdbId: tmdbId.toString(), seasonNumber: parseInt(seasonNumber) }, 
                            { sort: { episodeNumber: -1 }, projection: { episodeNumber: 1 } });
                            
                    const nextEpisode = (lastSaved ? lastSaved.episodeNumber : 0) + 1;
                    adminState[chatId] = { 
                        ...adminState[chatId], 
                        step: 'awaiting_unified_link_series', 
                        season: parseInt(seasonNumber), 
                        episode: nextEpisode 
                    };
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                    bot.sendMessage(chatId, `Siguiente: Envía **ENLACE** para S${seasonNumber}E${nextEpisode}.`);
                    
                } catch (error) {
                    console.error("Error al buscar último episodio:", error);
                    bot.sendMessage(chatId, 'Error al buscar el último episodio subido.');
                }
            }
            
            else if (data.startsWith('delete_episode_')) {
                const [_, __, tmdbId, season, episode] = data.split('_');
                try {
                    await axios.post(`${RENDER_BACKEND_URL}/delete-series-episode`, { tmdbId, seasonNumber: parseInt(season), episodeNumber: parseInt(episode) });
                    bot.sendMessage(chatId, `🗑️ Episodio S${season}E${episode} eliminado. Puedes volver a subirlo.`);
                } catch (e) {
                    bot.sendMessage(chatId, '❌ Error eliminando episodio.');
                }
            }

            else if (data.startsWith('pin_action_')) { 
                const parts = data.split('_');
                const action = parts[2]; 
                const type = parts[3]; 
                const tmdbId = parts[4]; 
                
                try {
                    const collection = (type === 'tv' || type === 'series') ? mongoDb.collection('series_catalog') : mongoDb.collection('media_catalog');
                    let updateDoc = {};
                    let replyText = "";
                    
                    if (action === 'pin') { 
                        updateDoc = { $set: { isPinned: true, addedAt: new Date() } };
                        replyText = "✅ Película fijada y movida al PRIMER lugar (Top 1).";
                    } else if (action === 'unpin') { 
                        updateDoc = { $set: { isPinned: false } };
                        replyText = "✅ Película quitada de destacados.";
                    } else if (action === 'refresh') { 
                        updateDoc = { $set: { isPinned: true, addedAt: new Date() } };
                        replyText = "🔄 Refrescada: Ahora está en el PRIMER lugar (Top 1).";
                    }
                    
                    await collection.updateOne({ tmdbId: tmdbId.toString() }, updateDoc);
                    
                    if (action === 'pin' || action === 'refresh') {
                         pinnedCache.del('pinned_content');
                    }
                    
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
                    bot.sendMessage(chatId, replyText);
                } catch (error) {
                    console.error("Error en acción Pinned:", error);
                    bot.sendMessage(chatId, '❌ Error al actualizar el estado de "Destacado".');
                }
            }
            
            else if (data.startsWith('save_only_series_')) {
                const parts = data.split('_');
                const tmdbId = parts[3];
                const season = parts[4];
                const episode = parts[5];
                const state = adminState[chatId];
                const episodeData = state?.seriesDataToSave;

                if (!episodeData || episodeData.tmdbId !== tmdbId || episodeData.seasonNumber.toString() !== season || episodeData.episodeNumber.toString() !== episode) {
                    bot.sendMessage(chatId, 'Error: Datos perdidos. Intenta de nuevo.');
                    adminState[chatId] = { step: 'menu' };
                    return;
                }
                
                try {
                    const postData = episodeData;
                    
                    if (episodeData.isPinned) {
                        postData.addedAt = new Date();
                        pinnedCache.del('pinned_content');
                    }

                    await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, postData);
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });

                    adminState[chatId].lastSavedEpisodeData = episodeData;
                    
                    const lastSaved = await mongoDb.collection('series_catalog')
                        .findOne({ tmdbId: tmdbId.toString(), seasonNumber: parseInt(season) }, 
                            { sort: { episodeNumber: -1 }, projection: { episodeNumber: 1 } });
                            
                    const nextEpisode = (lastSaved ? lastSaved.episodeNumber : 0) + 1;
                    const nextSeason = parseInt(season) + 1;
                    
                    const rowCorrections = [
                        { text: '✏️ Editar Enlace', callback_data: `edit_episode_${tmdbId}_${season}_${episode}` },
                        { text: '⬅️ Volver a Temporada', callback_data: `manage_season_${tmdbId}_${season}` }
                    ];
                    
                    let rowNext = [];
                    if (nextEpisode === state.totalEpisodesInSeason + 1) {
                         rowNext.push({ text: `➡️ Siguiente: S${nextSeason}`, callback_data: `manage_season_${tmdbId}_${nextSeason}` });
                    } else {
                        rowNext.push({ text: `➡️ Siguiente: S${season}E${nextEpisode}`, callback_data: `add_next_episode_${tmdbId}_${season}` });
                    }

                    const rowPublish = [
                        { text: `📲 App + PUSH`, callback_data: `publish_push_this_episode_${tmdbId}_${season}_${episode}` },
                        { text: `🚀 Canal + PUSH`, callback_data: `publish_push_channel_this_episode_${tmdbId}_${season}_${episode}` }
                    ];
                    
                    const rowFinal = [
                        { text: `📢 Solo Canal`, callback_data: `publish_channel_no_push_this_episode_${tmdbId}_${season}_${episode}` },
                        { text: '⏹️ Finalizar Todo', callback_data: `finish_series_${tmdbId}` }
                    ];

                    bot.sendMessage(chatId, `✅ *S${season}E${episode} Guardado.*`, { 
                        parse_mode: 'Markdown', 
                        reply_markup: { 
                            inline_keyboard: [
                                rowCorrections,
                                rowNext,
                                rowPublish,
                                rowFinal
                            ]
                        }
                    });

                } catch (error) {
                    console.error("Error guardando episodio:", error.message);
                    bot.sendMessage(chatId, '❌ Error guardando en servidor.');
                    adminState[chatId] = { step: 'menu' };
                }
            }
            
            else if (data.startsWith('publish_push_this_episode_')) {
                const parts = data.split('_');
                const tmdbId = parts[5];
                const season = parts[6];
                const episode = parts[7];
                const state = adminState[chatId];
                const episodeData = state?.seriesDataToSave || state?.lastSavedEpisodeData;

                if (!episodeData || episodeData.tmdbId !== tmdbId || episodeData.seasonNumber.toString() !== season || episodeData.episodeNumber.toString() !== episode) {
                    bot.sendMessage(chatId, 'Error: Datos perdidos. Intenta de nuevo.');
                    adminState[chatId] = { step: 'menu' };
                    return;
                }
                
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `✅ Episodio S${season}E${episode} listo. Iniciando publicación App + PUSH...`);
                
                try {
                    
                    const postData = episodeData;
                    
                    if (episodeData.isPinned) {
                        postData.addedAt = new Date();
                        pinnedCache.del('pinned_content');
                    }

                    await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, postData);

                    await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                        title: `¡Nuevo Episodio! ${episodeData.title}`,
                        body: `Ya disponible: S${episodeData.seasonNumber}E${episodeData.episodeNumber}`,
                        imageUrl: episodeData.poster_path ? `https://image.tmdb.org/t/p/w500${episodeData.poster_path}` : null,
                        tmdbId: episodeData.tmdbId,
                        mediaType: 'tv'
                    });
                    
                    bot.sendMessage(chatId, '✅ Publicación completada (App + PUSH).');
                } catch (error) {
                    console.error("Error en publicacion PUSH/App (Series):", error.message);
                    bot.sendMessage(chatId, '❌ Error en la publicación PUSH/App.');
                }
                adminState[chatId] = { step: 'menu' };
            }

            else if (data.startsWith('publish_push_channel_this_episode_')) {
                const parts = data.split('_');
                const tmdbId = parts[5];
                const season = parts[6];
                const episode = parts[7];
                const state = adminState[chatId];
                const episodeData = state?.seriesDataToSave || state?.lastSavedEpisodeData;
                
                if (!episodeData || episodeData.tmdbId !== tmdbId || episodeData.seasonNumber.toString() !== season || episodeData.episodeNumber.toString() !== episode) {
                    bot.sendMessage(chatId, 'Error: Datos perdidos. Intenta de nuevo desde el episodio anterior.');
                    adminState[chatId] = { step: 'menu' };
                    return;
                }
                
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `✅ Episodio S${season}E${episode} listo. Iniciando doble publicación...`);
                
                try {
                    const postData = episodeData;
                    
                    if (episodeData.isPinned) {
                        postData.addedAt = new Date();
                        pinnedCache.del('pinned_content');
                    }
                    
                    await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, postData);

                    await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                        title: `¡Nuevo Episodio! ${episodeData.title}`,
                        body: `Ya disponible: S${episodeData.seasonNumber}E${episodeData.episodeNumber}`,
                        imageUrl: episodeData.poster_path ? `https://image.tmdb.org/t/p/w500${episodeData.poster_path}` : null,
                        tmdbId: episodeData.tmdbId,
                        mediaType: 'tv'
                    });
                    
                    const DEEPLINK_URL = `${RENDER_BACKEND_URL}/app/details/${episodeData.tmdbId}`;
                    const CHANNEL_SMALL = process.env.TELEGRAM_CHANNEL_A_ID;
                    const CHANNEL_BIG_ID = process.env.TELEGRAM_CHANNEL_B_ID;
                    
                    if (CHANNEL_SMALL) {
                        const messageToSmall = `📺 *¡NUEVO EPISODIO EN SALA CINE!* 📺\n\n` +
                            `**${episodeData.title}**\n` +
                            `Temporada ${episodeData.seasonNumber} - Episodio ${episodeData.episodeNumber} ya disponible.\n\n` +
                            `_Entra para verlo ahora:_`;
                            
                        const sentMsgSmall = await bot.sendPhoto(CHANNEL_SMALL, episodeData.poster_path ? `https://image.tmdb.org/t/p/w500${episodeData.poster_path}` : 'https://placehold.co/500x750?text=SALA+CINE', { 
                            caption: messageToSmall, 
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '▶️ Ver Ahora en la App', url: DEEPLINK_URL }]
                                ]
                            }
                        });
                        
                        const channelUsername = CHANNEL_SMALL.replace('@', '');
                        const linkToPost = `https://t.me/${channelUsername}/${sentMsgSmall.message_id}`;
                        
                        if (CHANNEL_BIG_ID) {
                            const releaseYear = episodeData.first_air_date ? `(${episodeData.first_air_date.substring(0, 4)})` : '';
                            const messageToBig = `🍿 *EPISODIO ESTRENO* 🍿\n\n` +
                                `📺 *${episodeData.title}* ${releaseYear}\nS${episodeData.seasonNumber}E${episodeData.episodeNumber} ya en la App.\n\n` +
                                `_¡No te lo pierdas!_`;
                                
                            await bot.sendPhoto(CHANNEL_BIG_ID, episodeData.poster_path ? `https://image.tmdb.org/t/p/w500${episodeData.poster_path}` : 'https://placehold.co/500x750?text=SALA+CINE', {
                                caption: messageToBig,
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: '➡️ Ver Episodio', url: linkToPost }]
                                    ]
                                }
                            });
                        }
                    }
                    
                    bot.sendMessage(chatId, '✅ Publicación completada (Canales + PUSH).');
                } catch (error) {
                    console.error("Error en publicacion de Canales/PUSH (Series):", error.message);
                    bot.sendMessage(chatId, '❌ Error en la publicación de Canales/PUSH.');
                }
                adminState[chatId] = { step: 'menu' };
            }

            else if (data.startsWith('publish_channel_no_push_this_episode_')) {
                const parts = data.split('_');
                const tmdbId = parts[6];
                const season = parts[7];
                const episode = parts[8];
                const state = adminState[chatId];
                const episodeData = state?.seriesDataToSave || state?.lastSavedEpisodeData;
                
                if (!episodeData || episodeData.tmdbId !== tmdbId || episodeData.seasonNumber.toString() !== season || episodeData.episodeNumber.toString() !== episode) {
                    bot.sendMessage(chatId, 'Error: Datos perdidos. Intenta de nuevo.');
                    adminState[chatId] = { step: 'menu' };
                    return;
                }

                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `✅ Episodio S${season}E${episode}. Publicando en CANAL (Silencioso)...`);
                
                try {
                    const postData = episodeData;
                    
                    if (episodeData.isPinned) {
                        postData.addedAt = new Date();
                        pinnedCache.del('pinned_content');
                    }
                    
                    await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, postData);
                    
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
                            disable_notification: true,
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '▶️ Ver Ahora en la App', url: DEEPLINK_URL }]
                                ]
                            }
                        });
                    }
                    
                    bot.sendMessage(chatId, '✅ Publicación completada (Solo Canal, Silencioso).');
                } catch (error) {
                    console.error("Error en publicacion de Canal (Series):", error.message);
                    bot.sendMessage(chatId, '❌ Error en la publicación de Canal.');
                }
                adminState[chatId] = { step: 'menu' };
            }
            
            else if (data.startsWith('finish_series_')) {
                 bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                 bot.sendMessage(chatId, '✅ Proceso de subida de serie finalizado.');
                 adminState[chatId] = { step: 'menu' };
            }
            
            else if (data === 'back_to_menu') {
                const options = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: 'Agregar películas', callback_data: 'add_movie' },
                                { text: 'Agregar series', callback_data: 'add_series' }
                            ],
                            [{ text: '🔔 Ver Pedidos', callback_data: 'view_requests_menu' }],
                            [
                                { text: 'Eventos', callback_data: 'eventos' },
                                { text: 'Gestionar películas', callback_data: 'manage_movies' }
                            ], 
                            [{ text: 'Eliminar película', callback_data: 'delete_movie' }]
                        ]
                    }
                };
                bot.editMessageText('¡Hola! ¿Qué quieres hacer hoy?', { chat_id: chatId, message_id: msg.message_id, ...options });
            }

        } catch (error) {
            console.error("Error en callback query:", error);
            bot.sendMessage(chatId, '❌ Ha ocurrido un error inesperado. Intenta de nuevo.');
        }
    });

    bot.on('my_chat_member', async (memberUpdate) => {
        const { chat, new_chat_member } = memberUpdate;
        
        if (new_chat_member.status === 'administrator' && new_chat_member.user.id === bot.options.id) {
            const adminUserId = ADMIN_CHAT_ID;
            if (chat.id === adminUserId) return;
            
            try {
                await bot.sendMessage(adminUserId, `🤖 **Aviso de Integración**\n\nEl bot ha sido añadido/ascendido a administrador en el chat: **${chat.title}** (\`${chat.id}\`).\n\n**¡Configuración completada!** El bot comenzará a aprobar solicitudes de ingreso automáticamente.`, { parse_mode: 'Markdown', 
                    reply_markup: { 
                        inline_keyboard: [
                            [{ text: '❓ ¿Qué permisos necesita?', callback_data: 'public_help' }],
                            [{ text: '📞 Contactar Soporte', callback_data: 'public_contact' }]
                        ]
                    }
                }).catch(e => { console.warn(`[Auto-Aceptar] No se pudo enviar DM al admin ${adminUserId}.`); });
            } catch (error) {
                console.error("Error en 'my_chat_member':", error.message);
            }
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
            console.log(`[Auto-Aceptar] ✅ Solicitud aprobada para: ${userFirstName} (${userId})`);

            const welcomeMessage = `🎉 ¡Hola *${userFirstName}*!
            
Bienvenido(a) a **${chatTitle}**.
Disfruta del contenido.`;

            await bot.sendMessage(userId, welcomeMessage, { parse_mode: 'Markdown' })
                .then(() => console.log(`[Auto-Aceptar] ✅ DM de bienvenida enviado a ${userFirstName}.`))
                .catch(e => console.warn(`[Auto-Aceptar] No se pudo enviar DM de bienvenida a ${userFirstName}:`, e.message));

        } catch (error) {
            console.error(`[Auto-Aceptar] ❌ Error al aprobar o enviar DM a ${userId} en ${chatId}:`, error.message);
        }
    });
    
    
    async function handleManageSeries(chatId, msg, tmdbId, bot, mongoDb, TMDB_API_KEY, adminState) {
        try {
            const tmdbUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=credits,keywords,external_ids,videos`;
            const response = await axios.get(tmdbUrl);
            const seriesData = response.data;
            
            const genreIds = seriesData.genres ? seriesData.genres.map(g => g.name) : [];
            const originCountries = seriesData.origin_country || [];

            adminState[chatId] = {
                ...adminState[chatId],
                step: 'manage_series_menu',
                selectedSeries: {
                    tmdbId: tmdbId,
                    title: seriesData.name,
                    overview: seriesData.overview,
                    poster_path: seriesData.poster_path,
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

} 

module.exports = initializeBot;
