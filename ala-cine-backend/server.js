bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_CHAT_ID) return;

    if (data === 'add_movie') {
        adminState[chatId] = { step: 'search_movie' };
        bot.sendMessage(chatId, 'Por favor, escribe el nombre de la película que quieres agregar.');
    } else if (data === 'add_series') {
        adminState[chatId] = { step: 'search_series' };
        bot.sendMessage(chatId, 'Por favor, escribe el nombre de la serie que quieres agregar.');
    } else if (data.startsWith('add_pro_select_')) {
        const [_, mediaType, tmdbId] = data.split('_');
        const mediaData = adminState[chatId].results.find(m => m.id === parseInt(tmdbId, 10));
        adminState[chatId] = { selectedMedia: mediaData, mediaType: mediaType };
        if (mediaType === 'movie') {
            adminState[chatId].step = 'awaiting_pro_link_movie';
            bot.sendMessage(chatId, `Seleccionaste "${mediaData.title}". Envía el reproductor PRO. Si no hay, escribe "no".`);
        } else {
            adminState[chatId].step = 'add_pro_link_series';
            adminState[chatId].season = 1;
            adminState[chatId].episode = 1;
            bot.sendMessage(chatId, `Seleccionaste "${mediaData.name}". Envía el reproductor PRO para el episodio 1 de la temporada 1. Si no hay, escribe "no".`);
        }
    } else if (data.startsWith('enable_free_')) {
        const [_, tmdbId, mediaType] = data.split('_');
        const mediaData = adminState[chatId].results.find(m => m.id === parseInt(tmdbId, 10));
        adminState[chatId] = { selectedMedia: mediaData, mediaType: mediaType, proEmbedCode: mediaData.proEmbedCode };
        adminState[chatId].step = 'awaiting_free_link_movie';
        bot.sendMessage(chatId, `Habilitando la versión GRATIS para "${mediaData.title}". Por favor, envía el reproductor GRATIS.`);
    } else if (data.startsWith('enable_pro_')) {
        const [_, tmdbId, mediaType] = data.split('_');
        const mediaData = adminState[chatId].results.find(m => m.id === parseInt(tmdbId, 10));
        adminState[chatId] = { selectedMedia: mediaData, mediaType: mediaType, freeEmbedCode: mediaData.freeEmbedCode };
        adminState[chatId].step = 'awaiting_pro_link_movie';
        bot.sendMessage(chatId, `Habilitando la versión PRO para "${mediaData.title}". Por favor, envía el reproductor PRO.`);
    } else if (data.startsWith('manage_series_')) {
        const tmdbId = data.replace('manage_series_', '');
        const seriesData = adminState[chatId].results.find(m => m.id === parseInt(tmdbId, 10));
        adminState[chatId] = { selectedSeries: seriesData, step: 'manage_series_options' };
        
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Añadir episodio', callback_data: `add_episode_series_${tmdbId}` }],
                    [{ text: 'Habilitar otra versión', callback_data: `enable_version_series_${tmdbId}` }],
                    [{ text: 'Volver al menú principal', callback_data: 'start' }]
                ]
            }
        };
        bot.sendMessage(chatId, `¿Qué quieres hacer con "${seriesData.name}"?`, options);
    } else if (data.startsWith('add_episode_series_')) {
        const tmdbId = data.replace('add_episode_series_', '');
        const seriesData = adminState[chatId].results.find(m => m.id === parseInt(tmdbId, 10));
        adminState[chatId] = { step: 'add_pro_link_series', selectedSeries: seriesData, season: 1, episode: 1 };
        bot.sendMessage(chatId, `Seleccionaste "${seriesData.name}". Envía el reproductor PRO para el episodio 1 de la temporada 1. Si no hay, escribe "no".`);
    } else if (data === 'add_next_episode') {
        const { selectedSeries, season, episode } = adminState[chatId];
        const nextEpisode = episode + 1;
        adminState[chatId].step = 'add_pro_link_series';
        adminState[chatId].episode = nextEpisode;
        bot.sendMessage(chatId, `Genial. Ahora, envía el reproductor PRO para el episodio ${nextEpisode} de la temporada ${season}. Si no hay, escribe "no".`);
    } else if (data === 'publish_free_only' || data === 'publish_pro_only' || data === 'publish_both') {
        const { selectedMovie, freeEmbedCode, proEmbedCode } = adminState[chatId];
        let isPremium;
        let finalFreeEmbedCode = freeEmbedCode;
        let finalProEmbedCode = proEmbedCode;

        if (data === 'publish_pro_only') {
            isPremium = true;
            finalFreeEmbedCode = null;
        } else if (data === 'publish_free_only') {
            isPremium = false;
            finalProEmbedCode = null;
        } else {
            isPremium = null;
        }

        try {
            const body = {
                tmdbId: selectedMovie.id,
                title: selectedMovie.title,
                poster_path: selectedMovie.poster_path,
                freeEmbedCode: finalFreeEmbedCode,
                proEmbedCode: finalProEmbedCode,
            };
            
            if (isPremium !== null) {
                body.isPremium = isPremium;
            }
            
            await axios.post(`${RENDER_BACKEND_URL}/add-movie`, body);
            bot.sendMessage(chatId, `¡La película "${selectedMovie.title}" ha sido publicada con éxito!`);
        } catch (error) {
            console.error("Error al publicar la película:", error);
            bot.sendMessage(chatId, 'Hubo un error al publicar la película.');
        } finally {
            adminState[chatId] = { step: 'menu' };
        }
    } else if (data === 'manage_movies') {
        adminState[chatId] = { step: 'search_manage' };
        bot.sendMessage(chatId, 'Por favor, escribe el nombre de la película o serie que quieres gestionar.');
    } else if (data.startsWith('delete_select_')) {
        const [_, tmdbId, mediaType] = data.split('_');
        bot.sendMessage(chatId, `La lógica para eliminar el contenido ${tmdbId} (${mediaType}) está lista para ser implementada.`);
    } else if (data === 'delete_movie') {
        adminState[chatId] = { step: 'search_delete' };
        bot.sendMessage(chatId, 'Por favor, escribe el nombre de la película o serie que quieres eliminar.');
    } else if (data === 'no_action') {
        bot.sendMessage(chatId, 'No se requiere ninguna acción para este contenido.');
    }
});
