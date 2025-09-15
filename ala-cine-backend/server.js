bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userText = msg.text;
    if (chatId !== ADMIN_CHAT_ID || userText.startsWith('/')) {
        return;
    }

    if (adminState[chatId] && (adminState[chatId].step === 'search' || adminState[chatId].step === 'search_edit')) {
        const mediaType = adminState[chatId].mediaType || 'movie';
        try {
            const searchUrl = `https://api.themoviedb.org/3/search/${mediaType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(userText)}&language=es-ES`;
            const response = await axios.get(searchUrl);
            const data = response.data;
            if (data.results && data.results.length > 0) {
                const results = data.results.slice(0, 5);
                adminState[chatId].results = data.results;
                adminState[chatId].step = adminState[chatId].step === 'search' ? 'select' : 'select_edit';
                for (const item of results) {
                    const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
                    const title = item.title || item.name;
                    const date = item.release_date || item.first_air_date;
                    const message = `🎬 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${item.overview || 'Sin sinopsis disponible.'}`;
                    const options = {
                        caption: message,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[{
                                text: adminState[chatId].step === 'select' ? '✅ Agregar' : '✏️ Editar',
                                callback_data: `${adminState[chatId].step}_${item.id}_${mediaType}`
                            }]]
                        }
                    };
                    bot.sendPhoto(chatId, posterUrl, options);
                }
            } else {
                bot.sendMessage(chatId, `No se encontraron resultados para tu búsqueda. Intenta de nuevo.`);
                adminState[chatId].step = 'search';
            }
        } catch (error) {
            console.error("Error al buscar en TMDB:", error);
            bot.sendMessage(chatId, 'Hubo un error al buscar el contenido. Intenta de nuevo.');
        }
    } else if (adminState[chatId] && adminState[chatId].step === 'awaiting_video_link') {
        const rawLinks = userText.split(/\s+/).filter(link => link.length > 0);
        const selectedId = adminState[chatId].selectedId;
        const mediaType = adminState[chatId].mediaType;
        const isPremium = adminState[chatId].isPremium;
        
        // Vuelve a buscar la información de la película para evitar errores
        let itemData = null;
        try {
            const response = await axios.get(`https://api.themoviedb.org/3/${mediaType}/${selectedId}?api_key=${TMDB_API_KEY}&language=es-ES`);
            itemData = response.data;
        } catch (error) {
            console.error("Error al buscar en TMDB para agregar:", error);
            bot.sendMessage(chatId, "No se pudo encontrar la información de la película. Intenta de nuevo.");
            adminState[chatId] = { step: 'menu' };
            return;
        }
        
        if (!itemData) {
            bot.sendMessage(chatId, "No se encontró la información del contenido seleccionado. Intenta de nuevo.");
            adminState[chatId] = { step: 'menu' };
            return;
        }

        const mirrors = rawLinks.map(link => ({ url: link, quality: 'normal' }));

        try {
            const endpoint = mediaType === 'movie' ? '/add-movie' : '/add-series-episode';
            const body = mediaType === 'movie' ? {
                tmdbId: itemData.id,
                title: itemData.title,
                poster_path: itemData.poster_path,
                mirrors,
                isPremium
            } : {
                // Aquí podrías agregar lógica para series, si es necesario
                tmdbId: itemData.id,
                title: itemData.name,
                poster_path: itemData.poster_path,
                mirrors,
                isPremium,
                seasonNumber: 1, // Ejemplo, necesitas definir cómo obtendrías esto
                episodeNumber: 1 // Ejemplo, necesitas definir cómo obtendrías esto
            };

            const response = await axios.post(`${process.env.RENDER_BACKEND_URL}${endpoint}`, body);

            if (response.status === 200) {
                bot.sendMessage(chatId, `¡El contenido "${itemData.title || itemData.name}" fue agregado exitosamente con ${mirrors.length} mirrors!`);
            } else {
                bot.sendMessage(chatId, `Hubo un error al agregar el contenido: ${response.data.error}`);
            }
        } catch (error) {
            console.error("Error al comunicarse con el backend:", error);
            bot.sendMessage(chatId, "No se pudo conectar con el servidor para agregar el contenido.");
        } finally {
            adminState[chatId] = { step: 'menu' };
        }
    }
});
