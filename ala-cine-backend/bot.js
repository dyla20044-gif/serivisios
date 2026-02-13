const fs = require('fs');
const path = require('path');

function initializeBot(bot, db, mongoDb, adminState, ADMIN_CHAT_ID, TMDB_API_KEY, RENDER_BACKEND_URL, axios, pinnedCache, sendNotificationToTopic, userCache) {

    // --- HELPER FUNCTIONS FOR CLEAN CHAT ---
    
    // Función para registrar mensajes que deben ser borrados luego
    const trackMsg = (chatId, msgId) => {
        if (!adminState[chatId]) adminState[chatId] = {};
        if (!adminState[chatId].messageStack) adminState[chatId].messageStack = [];
        adminState[chatId].messageStack.push(msgId);
    };

    // Función para limpiar la pantalla (borrar mensajes anteriores del flujo)
    const clearChat = async (chatId) => {
        if (!adminState[chatId] || !adminState[chatId].messageStack) return;
        const stack = adminState[chatId].messageStack;
        
        for (const msgId of stack) {
            try {
                await bot.deleteMessage(chatId, msgId);
            } catch (e) {
                // Ignorar errores si el mensaje ya fue borrado o es muy viejo
            }
        }
        adminState[chatId].messageStack = [];
    };

    // Wrapper para enviar mensajes y rastrearlos automáticamente
    const sendTrackedMessage = async (chatId, text, options = {}) => {
        const msg = await bot.sendMessage(chatId, text, options);
        trackMsg(chatId, msg.message_id);
        return msg;
    };
    
    // Wrapper para enviar fotos y rastrearlas
    const sendTrackedPhoto = async (chatId, photo, options = {}) => {
        const msg = await bot.sendPhoto(chatId, photo, options);
        trackMsg(chatId, msg.message_id);
        return msg;
    };

    // --- COMANDOS ---

    bot.setMyCommands([
        { command: 'start', description: 'Reiniciar y limpiar menú' },
        { command: 'subir', description: 'Subir contenido' },
        { command: 'pedidos', description: 'Ver lista de solicitudes' }
    ]);

    // Función para mostrar el menú principal limpio
    const showMainMenu = async (chatId) => {
        await clearChat(chatId); // Limpia todo lo anterior
        
        adminState[chatId] = { step: 'menu', messageStack: [] }; // Reinicia estado

        const options = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🎬 Agregar Películas', callback_data: 'add_movie' },
                        { text: '📺 Agregar Series', callback_data: 'add_series' }
                    ],
                    [{ text: '🔔 Ver Pedidos (Usuarios)', callback_data: 'view_requests_menu' }],
                    [
                        { text: '📡 Comunicados App', callback_data: 'cms_announcement_menu' },
                        { text: '📢 Notificación Global', callback_data: 'send_global_msg' }
                    ],
                    [
                        { text: '🔧 Gestionar/Editar', callback_data: 'manage_movies' },
                        { text: '🗑️ Eliminar Contenido', callback_data: 'delete_movie' }
                    ]
                ]
            }
        };
        await sendTrackedMessage(chatId, '👋 **Panel de Administración**\nSelecciona una acción:', { parse_mode: 'Markdown', ...options });
    };

    bot.onText(/\/start|\/subir/, async (msg) => {
        const chatId = msg.chat.id;
        if (chatId !== ADMIN_CHAT_ID) return;
        
        // Borramos el mensaje del comando del usuario para mantener limpieza
        try { await bot.deleteMessage(chatId, msg.message_id); } catch(e){}
        
        await showMainMenu(chatId);
    });

    bot.onText(/\/pedidos/, async (msg) => {
        const chatId = msg.chat.id;
        if (chatId !== ADMIN_CHAT_ID) return;
        try { await bot.deleteMessage(chatId, msg.message_id); } catch(e){}
        // Simulamos clic en el botón de pedidos
        const callbackMock = { message: { chat: { id: chatId } }, data: 'view_requests_menu' };
        bot.emit('callback_query', callbackMock);
    });

    // --- MANEJO DE MENSAJES DE TEXTO (INPUTS) ---

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const userText = msg.text;

        // 1. Control de Enlaces para NO Admins (Anti-Spam básico)
        const hasLinks = msg.entities && msg.entities.some(e => ['url', 'text_link', 'mention'].includes(e.type));
        if (hasLinks && msg.from.id !== ADMIN_CHAT_ID) {
            try {
                await bot.deleteMessage(chatId, msg.message_id);
                const warn = await bot.sendMessage(chatId, `🚫 No enlaces, @${msg.from.username || 'usuario'}.`);
                setTimeout(() => bot.deleteMessage(chatId, warn.message_id).catch(() => {}), 5000);
            } catch (e) {}
            return;
        }

        // Si no es admin y envía comandos, ayuda pública
        if (chatId !== ADMIN_CHAT_ID) {
            if (userText && userText.startsWith('/')) {
                if (userText.startsWith('/start') || userText.startsWith('/ayuda')) {
                    const helpMsg = `👋 ¡Hola! Soy el Bot de Administración.\n\nSi eres usuario, por favor espera a ser aceptado o contacta a soporte.`;
                    bot.sendMessage(chatId, helpMsg);
                }
            }
            return;
        }

        if (!userText || userText.startsWith('/')) return; // Ignorar comandos aquí

        // RASTREAR EL MENSAJE DEL USUARIO (Para borrarlo luego si es un input de flujo)
        if (adminState[chatId] && adminState[chatId].step !== 'menu') {
            trackMsg(chatId, msg.message_id);
        }

        const currentState = adminState[chatId] ? adminState[chatId].step : 'menu';

        // --- LÓGICA DE CMS (COMUNICADOS) ---
        if (currentState.startsWith('cms_')) {
            if (currentState === 'cms_await_media_url') {
                if (!userText.startsWith('http')) {
                    sendTrackedMessage(chatId, '❌ URL inválida. Intenta de nuevo.');
                    return;
                }
                adminState[chatId].tempAnnouncement.mediaUrl = userText;
                adminState[chatId].step = 'cms_await_title';
                sendTrackedMessage(chatId, '✅ URL Guardada.\n📝 Escribe el **TÍTULO**:');
            }
            else if (currentState === 'cms_await_title') {
                adminState[chatId].tempAnnouncement.title = userText;
                adminState[chatId].step = 'cms_await_body';
                sendTrackedMessage(chatId, '✅ Título Guardado.\n📝 Escribe el **MENSAJE (Cuerpo)**:');
            }
            else if (currentState === 'cms_await_body') {
                adminState[chatId].tempAnnouncement.message = userText;
                adminState[chatId].step = 'cms_await_btn_text';
                sendTrackedMessage(chatId, '✅ Cuerpo Guardado.\n🔘 Texto del **BOTÓN**:');
            }
            else if (currentState === 'cms_await_btn_text') {
                adminState[chatId].tempAnnouncement.buttonText = userText;
                adminState[chatId].step = 'cms_await_action_url';
                sendTrackedMessage(chatId, '✅ Botón Guardado.\n🔗 **URL DE ACCIÓN** (Destino):');
            }
            else if (currentState === 'cms_await_action_url') {
                adminState[chatId].tempAnnouncement.actionUrl = userText;
                const ann = adminState[chatId].tempAnnouncement;
                
                await clearChat(chatId); // Limpiar inputs anteriores para mostrar resumen limpio

                const summary = `📢 *VISTA PREVIA*\n\n📌 **${ann.title}**\n${ann.message}\n\n🔘 ${ann.buttonText}\n🔗 ${ann.actionUrl}`;
                
                sendTrackedMessage(chatId, summary, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ PUBLICAR', callback_data: 'cms_save_confirm' }],
                            [{ text: '❌ Cancelar', callback_data: 'cms_cancel' }]
                        ]
                    }
                });
            }
        }

        // --- LÓGICA NOTIFICACIÓN GLOBAL ---
        else if (currentState === 'awaiting_global_msg_title') {
            adminState[chatId].tempGlobalTitle = userText;
            adminState[chatId].step = 'awaiting_global_msg_body';
            sendTrackedMessage(chatId, `✅ Título: *${userText}*\n\n📝 Ahora escribe el **MENSAJE**:`, { parse_mode: 'Markdown' });
        }
        else if (currentState === 'awaiting_global_msg_body') {
            const body = userText;
            const title = adminState[chatId].tempGlobalTitle || "Aviso";
            
            await clearChat(chatId); // Limpiar chat
            await sendTrackedMessage(chatId, '🚀 Enviando notificación...');

            try {
                await sendNotificationToTopic(title, body, null, '0', 'general', 'new_content');
                await sendTrackedMessage(chatId, `✅ **Enviado con éxito.**\nTítulo: ${title}`);
            } catch (e) {
                await sendTrackedMessage(chatId, '❌ Error al enviar.');
            }
            setTimeout(() => showMainMenu(chatId), 3000); // Volver al menú tras 3 seg
        }

        // --- BÚSQUEDA INTELIGENTE (PELÍCULAS Y SERIES) ---
        else if (currentState === 'search_movie' || currentState === 'search_series' || currentState === 'search_manage' || currentState === 'search_delete') {
            
            // 1. Detectar Año (Ej: "Matrix 1999")
            const yearRegex = /(.+?)\s+(\d{4})$/;
            const match = userText.match(yearRegex);
            
            let queryText = userText;
            let yearParam = '';
            
            if (match) {
                queryText = match[1]; // "Matrix"
                const year = match[2]; // "1999"
                if (currentState === 'search_movie') yearParam = `&primary_release_year=${year}`;
                if (currentState === 'search_series') yearParam = `&first_air_date_year=${year}`;
            }

            const type = (currentState === 'search_series') ? 'tv' : 
                         (currentState === 'search_movie') ? 'movie' : 'multi';
            
            const url = `https://api.themoviedb.org/3/search/${type}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(queryText)}&language=es-ES${yearParam}`;

            try {
                const res = await axios.get(url);
                const data = res.data;

                // Limpiamos resultados anteriores si el usuario busca de nuevo sin salir
                await clearChat(chatId);
                trackMsg(chatId, msg.message_id); // Rastrear el input actual de nuevo porque clearChat lo borró

                if (data.results && data.results.length > 0) {
                    const results = data.results.slice(0, 5).filter(i => i.media_type !== 'person');
                    
                    if (results.length === 0) {
                        sendTrackedMessage(chatId, '❌ No se encontraron resultados válidos.');
                        return;
                    }

                    sendTrackedMessage(chatId, `🔍 Resultados para: *${queryText}* ${yearParam ? '(Año ' + match[2] + ')' : ''}`, { parse_mode: 'Markdown' });

                    for (const item of results) {
                        const isMovie = item.media_type === 'movie' || currentState === 'search_movie';
                        const title = item.title || item.name;
                        const date = item.release_date || item.first_air_date;
                        const yearStr = date ? date.substring(0, 4) : 'N/A';
                        const overview = item.overview ? (item.overview.substring(0, 100) + '...') : 'Sin sinopsis.';
                        
                        // Determinar Callback según estado
                        let callback = '';
                        if (currentState === 'search_delete') callback = `delete_confirm_${item.id}_${isMovie ? 'movie' : 'tv'}`;
                        else if (currentState === 'search_manage') callback = isMovie ? `manage_movie_${item.id}` : `manage_series_${item.id}`;
                        else callback = isMovie ? `add_new_movie_${item.id}` : `add_new_series_${item.id}`;

                        const btnText = currentState === 'search_delete' ? '🗑️ ELIMINAR' : '✅ SELECCIONAR';

                        const caption = `🎬 *${title}* (${yearStr})\n📝 ${overview}`;
                        const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://placehold.co/500x750?text=No+Img';

                        await sendTrackedPhoto(chatId, poster, {
                            caption: caption,
                            parse_mode: 'Markdown',
                            reply_markup: { inline_keyboard: [[{ text: btnText, callback_data: callback }]] }
                        });
                    }
                    // Botón para cancelar búsqueda
                    sendTrackedMessage(chatId, '¿No es lo que buscas?', {
                        reply_markup: { inline_keyboard: [[{ text: '⬅️ Volver al Menú', callback_data: 'back_to_menu' }]] }
                    });

                } else {
                    sendTrackedMessage(chatId, '⚠️ No se encontraron resultados. Intenta con otro nombre.');
                }
            } catch (e) {
                console.error(e);
                sendTrackedMessage(chatId, '❌ Error de conexión con TMDB.');
            }
        }

        // --- UNIFIED LINKS (PELÍCULAS) ---
        else if (currentState === 'awaiting_unified_link_movie') {
            const link = userText.trim();
            if (!link || (!link.startsWith('http') && link.toLowerCase() !== 'no')) {
                sendTrackedMessage(chatId, '❌ Enlace inválido. Envía una URL o escribe "no".');
                return;
            }

            adminState[chatId].movieDataToSave.proEmbedCode = (link.toLowerCase() === 'no') ? null : link;
            adminState[chatId].movieDataToSave.freeEmbedCode = adminState[chatId].movieDataToSave.proEmbedCode;
            
            // Avanzar paso
            adminState[chatId].step = 'awaiting_pinned_choice_movie';
            
            await clearChat(chatId); // Limpiar inputs para mostrar la pregunta limpia
            
            const movieTitle = adminState[chatId].movieDataToSave.title;
            sendTrackedMessage(chatId, `✅ Enlace recibido para: *${movieTitle}*\n\n⭐ **¿Deseas FIJAR esta película en DESTACADOS (Top)?**`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '⭐ Sí, Destacar', callback_data: 'set_pinned_movie_true' },
                            { text: '📅 No, Normal', callback_data: 'set_pinned_movie_false' }
                        ]
                    ]
                }
            });
        }

        // --- UNIFIED LINKS (SERIES) ---
        else if (currentState === 'awaiting_unified_link_series') {
            const link = userText.trim();
            if (!link || (!link.startsWith('http') && link.toLowerCase() !== 'no')) {
                sendTrackedMessage(chatId, '❌ Enlace inválido.');
                return;
            }

            const { selectedSeries, season, episode } = adminState[chatId];
            
            adminState[chatId].seriesDataToSave = {
                tmdbId: (selectedSeries.tmdbId || selectedSeries.id).toString(),
                title: selectedSeries.title || selectedSeries.name,
                poster_path: selectedSeries.poster_path,
                seasonNumber: season,
                episodeNumber: episode,
                overview: selectedSeries.overview,
                proEmbedCode: (link.toLowerCase() === 'no') ? null : link,
                freeEmbedCode: (link.toLowerCase() === 'no') ? null : link,
                isPremium: false,
                genres: selectedSeries.genres || [],
                first_air_date: selectedSeries.first_air_date,
                popularity: selectedSeries.popularity,
                vote_average: selectedSeries.vote_average,
                origin_country: selectedSeries.origin_country || [],
                isPinned: false
            };

            adminState[chatId].step = 'awaiting_pinned_choice_series';
            await clearChat(chatId);

            sendTrackedMessage(chatId, `✅ Enlace para **S${season}E${episode}** recibido.\n\n⭐ **¿Deseas FIJAR esta serie en DESTACADOS?**`, {
                parse_mode: 'Markdown',
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

        // --- EDICIÓN DE ENLACES ---
        else if (currentState === 'awaiting_edit_movie_link') {
            const { tmdbId } = adminState[chatId];
            try {
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, {
                    tmdbId: tmdbId,
                    proEmbedCode: userText.trim(),
                    freeEmbedCode: userText.trim(),
                    isPremium: false
                });
                await clearChat(chatId);
                await sendTrackedMessage(chatId, `✅ Enlace actualizado correctamente.`);
                setTimeout(() => showMainMenu(chatId), 2000);
            } catch (error) {
                sendTrackedMessage(chatId, `❌ Error al actualizar.`);
            }
        }
    });

    // --- MANEJO DE CALLBACKS (BOTONES) ---

    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const data = query.data;
        const msgId = query.message.message_id;

        // Responder al callback para quitar el relojito
        bot.answerCallbackQuery(query.id);

        if (chatId !== ADMIN_CHAT_ID && !data.startsWith('public_')) {
             return; // Ignorar usuarios no admins (salvo ayuda pública)
        }

        // --- NAVEGACIÓN GENERAL ---
        if (data === 'back_to_menu') {
            await showMainMenu(chatId);
            return;
        }

        // --- MENÚ PRINCIPAL ---
        if (data === 'add_movie') {
            await clearChat(chatId);
            adminState[chatId].step = 'search_movie';
            sendTrackedMessage(chatId, '🎬 **Buscar Película**\n\nEnvía el nombre (puedes añadir el año, ej: "Batman 2022"):', { parse_mode: 'Markdown' });
        }
        else if (data === 'add_series') {
            await clearChat(chatId);
            adminState[chatId].step = 'search_series';
            sendTrackedMessage(chatId, '📺 **Buscar Serie**\n\nEnvía el nombre (ej: "Loki"):', { parse_mode: 'Markdown' });
        }
        else if (data === 'manage_movies') {
            await clearChat(chatId);
            adminState[chatId].step = 'search_manage';
            sendTrackedMessage(chatId, '🔧 **Gestionar Contenido**\n\nBusca la película o serie a editar:', { parse_mode: 'Markdown' });
        }
        else if (data === 'delete_movie') {
            await clearChat(chatId);
            adminState[chatId].step = 'search_delete';
            sendTrackedMessage(chatId, '🗑️ **Eliminar Contenido**\n\nBusca lo que quieras borrar:', { parse_mode: 'Markdown' });
        }

        // --- CMS (COMUNICADOS) ---
        else if (data === 'cms_announcement_menu') {
            await clearChat(chatId);
            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🆕 Crear Nuevo', callback_data: 'cms_create_new' }],
                        [{ text: '🗑️ Borrar Actual', callback_data: 'cms_delete_current' }],
                        [{ text: '⬅️ Volver', callback_data: 'back_to_menu' }]
                    ]
                }
            };
            sendTrackedMessage(chatId, '📡 **Gestor de Comunicados**', options);
        }
        else if (data === 'cms_create_new') {
            adminState[chatId] = { step: 'cms_await_media_type', tempAnnouncement: {} };
            sendTrackedMessage(chatId, 'Selecciona formato:', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎬 Video', callback_data: 'cms_type_video' }, { text: '🖼️ Imagen', callback_data: 'cms_type_image' }],
                        [{ text: '📝 Texto', callback_data: 'cms_type_text' }]
                    ]
                }
            });
        }
        else if (data.startsWith('cms_type_')) {
            const type = data.replace('cms_type_', '');
            adminState[chatId].tempAnnouncement.mediaType = type;
            if (type === 'text') {
                adminState[chatId].step = 'cms_await_title';
                sendTrackedMessage(chatId, '📝 Escribe el **TÍTULO**:');
            } else {
                adminState[chatId].step = 'cms_await_media_url';
                sendTrackedMessage(chatId, `🔗 Envía la URL del ${type.toUpperCase()}:`);
            }
        }
        else if (data === 'cms_save_confirm') {
            const ann = adminState[chatId].tempAnnouncement;
            const filePath = path.join(__dirname, 'globalAnnouncement.json');
            try {
                let jsonToSave = {
                    id: Date.now().toString(),
                    title: ann.title,
                    message: ann.message,
                    btnText: ann.buttonText,
                    actionUrl: ann.actionUrl
                };
                if (ann.mediaType === 'video') jsonToSave.videoUrl = ann.mediaUrl;
                if (ann.mediaType === 'image') jsonToSave.imageUrl = ann.mediaUrl;

                fs.writeFileSync(filePath, JSON.stringify(jsonToSave, null, 2));
                await clearChat(chatId);
                await sendTrackedMessage(chatId, '✅ Comunicado Publicado.');
                setTimeout(() => showMainMenu(chatId), 2000);
            } catch (e) {
                sendTrackedMessage(chatId, '❌ Error al guardar.');
            }
        }
        else if (data === 'cms_delete_current') {
            const filePath = path.join(__dirname, 'globalAnnouncement.json');
            if(fs.existsSync(filePath)) fs.unlinkSync(filePath);
            sendTrackedMessage(chatId, '✅ Comunicado borrado.');
        }

        // --- GLOBAL NOTIFICATION ---
        else if (data === 'send_global_msg') {
            await clearChat(chatId);
            adminState[chatId].step = 'awaiting_global_msg_title';
            sendTrackedMessage(chatId, '📢 **Notificación Global**\n\nEscribe el **TÍTULO**:');
        }

        // --- SELECCIÓN DE PELÍCULA/SERIE (DESDE BÚSQUEDA) ---
        else if (data.startsWith('add_new_movie_') || data.startsWith('solicitud_')) {
            const tmdbId = data.split('_').pop();
            await clearChat(chatId); // Limpiar resultados de búsqueda

            try {
                const res = await axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`);
                const movie = res.data;

                adminState[chatId].selectedMedia = movie;
                adminState[chatId].step = 'awaiting_unified_link_movie';
                adminState[chatId].movieDataToSave = {
                    tmdbId: movie.id.toString(),
                    title: movie.title,
                    overview: movie.overview,
                    poster_path: movie.poster_path,
                    backdrop_path: movie.backdrop_path,
                    genres: movie.genres ? movie.genres.map(g => g.id) : [],
                    release_date: movie.release_date,
                    popularity: movie.popularity,
                    vote_average: movie.vote_average,
                    origin_country: movie.production_countries ? movie.production_countries.map(c => c.iso_3166_1) : []
                };

                const info = `🎬 **${movie.title}**\n\n🔗 Envía el **ENLACE DIRECTO** (mp4/m3u8) o escribe "no" si aún no lo tienes.`;
                sendTrackedMessage(chatId, info, { parse_mode: 'Markdown' });

            } catch (e) {
                sendTrackedMessage(chatId, '❌ Error obteniendo datos de TMDB.');
            }
        }

        // --- OPCIONES DE GUARDADO (PELÍCULA) ---
        else if (data.startsWith('set_pinned_movie_')) {
            const isPinned = data.includes('true');
            adminState[chatId].movieDataToSave.isPinned = isPinned;
            
            await clearChat(chatId);
            const mediaId = adminState[chatId].movieDataToSave.tmdbId;
            
            sendTrackedMessage(chatId, `✅ Estado: ${isPinned ? '⭐ DESTACADO' : '📅 Normal'}.\n\n🚀 **¿Cómo deseas publicar?**`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💾 Guardar (Solo App)', callback_data: 'save_only_' + mediaId }],
                        [{ text: '🚀 Canal + PUSH + App', callback_data: 'save_publish_push_channel_' + mediaId }],
                        [{ text: '📢 Canal + App (Sin Push)', callback_data: 'save_publish_channel_no_push_' + mediaId }]
                    ]
                }
            });
        }

        // --- ACCIONES DE GUARDADO FINAL (PELÍCULAS) ---
        else if (data.startsWith('save_')) {
            // Lógica unificada de guardado
            const type = data; 
            const movieData = adminState[chatId].movieDataToSave;
            
            if(!movieData) {
                sendTrackedMessage(chatId, '❌ Error: Datos perdidos.');
                return;
            }

            await clearChat(chatId);
            const statusMsg = await sendTrackedMessage(chatId, '⏳ Procesando...');

            try {
                // 1. Guardar en BD
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieData);

                // 2. Notificaciones (Si aplica)
                if (type.includes('push')) {
                    await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                        title: "¡Nuevo Estreno!",
                        body: `Ya disponible: ${movieData.title}`,
                        imageUrl: movieData.poster_path ? `https://image.tmdb.org/t/p/w500${movieData.poster_path}` : null,
                        tmdbId: movieData.tmdbId,
                        mediaType: 'movie'
                    });
                }

                // 3. Canal (Si aplica)
                if (type.includes('channel')) {
                    const DEEPLINK = `${RENDER_BACKEND_URL}/view/movie/${movieData.tmdbId}`;
                    const caption = `🎬 *${movieData.title}*\n\n${movieData.overview ? movieData.overview.slice(0, 200) : ''}...\n\n👇 *VER AHORA* 👇`;
                    
                    if (process.env.TELEGRAM_CHANNEL_A_ID) {
                        await bot.sendPhoto(process.env.TELEGRAM_CHANNEL_A_ID, 
                            movieData.poster_path ? `https://image.tmdb.org/t/p/w500${movieData.poster_path}` : 'https://placehold.co/500x750', 
                            { caption: caption, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '▶️ Ver en App', url: DEEPLINK }]] } }
                        );
                    }
                }

                await bot.deleteMessage(chatId, statusMsg.message_id).catch(()=>{});
                await sendTrackedMessage(chatId, '✅ **¡Proceso Completado con Éxito!**');
                setTimeout(() => showMainMenu(chatId), 2500);

            } catch (e) {
                console.error(e);
                sendTrackedMessage(chatId, '❌ Hubo un error al guardar/publicar.');
            }
        }

        // --- MANEJO DE SERIES (INICIO) ---
        else if (data.startsWith('add_new_series_') || data.startsWith('manage_series_')) {
            const tmdbId = data.split('_').pop();
            await clearChat(chatId);
            
            try {
                const res = await axios.get(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`);
                const series = res.data;
                adminState[chatId].selectedSeries = series;

                const seasons = series.seasons.filter(s => s.season_number > 0);
                const buttons = seasons.map(s => [{ text: `📂 Temp ${s.season_number} (${s.episode_count} caps)`, callback_data: `manage_season_${tmdbId}_${s.season_number}` }]);

                sendTrackedMessage(chatId, `📺 **${series.name}**\nSelecciona la temporada a gestionar:`, {
                    reply_markup: { inline_keyboard: [...buttons, [{text: '⬅️ Cancelar', callback_data: 'back_to_menu'}]] }
                });
            } catch (e) {
                sendTrackedMessage(chatId, '❌ Error con TMDB.');
            }
        }

        else if (data.startsWith('manage_season_')) {
            const [_, __, tmdbId, seasonNum] = data.split('_');
            // Lógica para determinar el siguiente episodio automáticamente
            // Nota: Aquí simplificamos. En producción podrías consultar la BD para ver cuál fue el último subido.
            const nextEp = 1; // Por defecto empezamos en 1, o podrías implementar lógica para buscar el último en tu BD.
            
            adminState[chatId].season = parseInt(seasonNum);
            adminState[chatId].episode = nextEp;
            adminState[chatId].step = 'awaiting_unified_link_series';

            await clearChat(chatId);
            sendTrackedMessage(chatId, `📂 **${adminState[chatId].selectedSeries.name}**\nTemporada ${seasonNum} - Episodio ${nextEp}\n\n🔗 Envía el **ENLACE** del video:`);
        }

        // --- GUARDADO DE SERIES ---
        else if (data.startsWith('set_pinned_series_')) {
            const isPinned = data.includes('true');
            adminState[chatId].seriesDataToSave.isPinned = isPinned;
            
            // Guardamos directamente el episodio en BD y luego preguntamos qué hacer
            const sData = adminState[chatId].seriesDataToSave;
            
            await clearChat(chatId);
            const savingMsg = await sendTrackedMessage(chatId, '⏳ Guardando episodio...');
            
            try {
                await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, sData);
                await bot.deleteMessage(chatId, savingMsg.message_id).catch(()=>{});

                // Guardar referencia para botones siguientes
                adminState[chatId].lastSavedEpisodeData = sData;

                const controls = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📲 Notificar App', callback_data: `publish_push_this_episode` },
                                { text: '📢 Notificar Canal', callback_data: `publish_channel_this_episode` }
                            ],
                            [{ text: `➡️ Siguiente: E${sData.episodeNumber + 1}`, callback_data: `add_next_episode` }],
                            [{ text: '⏹️ Finalizar', callback_data: 'back_to_menu' }]
                        ]
                    }
                };

                sendTrackedMessage(chatId, `✅ **S${sData.seasonNumber}E${sData.episodeNumber} Guardado.**\n¿Qué quieres hacer ahora?`, controls);

            } catch (e) {
                sendTrackedMessage(chatId, '❌ Error al guardar episodio.');
            }
        }

        else if (data === 'add_next_episode') {
            const last = adminState[chatId].lastSavedEpisodeData;
            adminState[chatId].episode = last.episodeNumber + 1;
            adminState[chatId].step = 'awaiting_unified_link_series';
            
            await clearChat(chatId);
            sendTrackedMessage(chatId, `🎬 **Siguiente Episodio**\n\nS${last.seasonNumber}E${last.episodeNumber + 1}\n🔗 Envía el enlace:`);
        }

        else if (data === 'publish_push_this_episode') {
            const ep = adminState[chatId].lastSavedEpisodeData;
            axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                title: `Nuevo Episodio: ${ep.title}`,
                body: `Disponible S${ep.seasonNumber}E${ep.episodeNumber}`,
                tmdbId: ep.tmdbId,
                mediaType: 'tv'
            });
            bot.answerCallbackQuery(query.id, { text: 'Notificación enviada' });
        }
        
        // --- SISTEMA DE PEDIDOS (REQ_FILTER) ---
        else if (data === 'view_requests_menu') {
            await clearChat(chatId);
            sendTrackedMessage(chatId, '📂 **Filtrar Pedidos:**', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 Ultra (Immediate)', callback_data: 'req_filter_ultra' }],
                        [{ text: '⚡ Rápido (Fast)', callback_data: 'req_filter_fast' }],
                        [{ text: '📅 Regular', callback_data: 'req_filter_regular' }],
                        [{ text: '⬅️ Volver', callback_data: 'back_to_menu' }]
                    ]
                }
            });
        }
        else if (data.startsWith('req_filter_')) {
            const filter = data.split('_')[2];
            const page = parseInt(data.split('_')[3]) || 0;
            const PAGE_SIZE = 5; // Menos items por página para no saturar
            
            let dbQuery = { latestPriority: 'regular' };
            if (filter === 'ultra') dbQuery = { latestPriority: { $in: ['immediate', 'premium'] } };
            if (filter === 'fast') dbQuery = { latestPriority: 'fast' };

            try {
                const reqs = await mongoDb.collection('movie_requests')
                    .find(dbQuery).sort({ votes: -1 }).skip(page * PAGE_SIZE).limit(PAGE_SIZE).toArray();

                await clearChat(chatId);
                
                if (reqs.length === 0) {
                    sendTrackedMessage(chatId, '✅ No hay pedidos en esta categoría.');
                    setTimeout(() => showMainMenu(chatId), 2000);
                    return;
                }

                sendTrackedMessage(chatId, `📋 **Pedidos: ${filter.toUpperCase()}** (Pág ${page+1})`, { parse_mode: 'Markdown' });

                for (const r of reqs) {
                    const poster = r.poster_path ? `https://image.tmdb.org/t/p/w200${r.poster_path}` : 'https://placehold.co/200x300';
                    const caption = `🎬 *${r.title}*\nVotes: ${r.votes || 1}`;
                    await sendTrackedPhoto(chatId, poster, {
                        caption: caption, parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [[{ text: '✅ Subir', callback_data: `solicitud_${r.tmdbId}` }]] }
                    });
                }
                
                // Botones de navegación
                const nav = [];
                if (reqs.length === PAGE_SIZE) nav.push({ text: '➡️ Siguiente', callback_data: `req_filter_${filter}_${page+1}` });
                nav.push({ text: '⬅️ Menú', callback_data: 'back_to_menu' });
                
                sendTrackedMessage(chatId, 'Navegación:', { reply_markup: { inline_keyboard: [nav] } });

            } catch (e) {
                sendTrackedMessage(chatId, '❌ Error BD.');
            }
        }

        // --- ELIMINACIÓN ---
        else if (data.startsWith('delete_confirm_')) {
            const [_, __, id, type] = data.split('_');
            const col = type === 'movie' ? 'media_catalog' : 'series_catalog';
            await mongoDb.collection(col).deleteOne({ tmdbId: id });
            await clearChat(chatId);
            sendTrackedMessage(chatId, '✅ Contenido eliminado.');
            setTimeout(() => showMainMenu(chatId), 2000);
        }

        // --- AYUDA PÚBLICA (CALLBACKS PÚBLICOS) ---
        else if (data === 'public_help') {
            bot.sendMessage(chatId, 'ℹ️ Este bot gestiona el acceso al canal privado.');
        }
        else if (data === 'public_contact') {
            bot.sendMessage(chatId, '📞 Contacta a @TuUsuarioAdmin');
        }
    });

    // --- MANEJO DE AUTO-ACEPTACIÓN (JOIN REQUESTS) ---
    bot.on('chat_join_request', async (req) => {
        try {
            await bot.approveChatJoinRequest(req.chat.id, req.from.id);
            const invite = await bot.exportChatInviteLink(req.chat.id);
            bot.sendMessage(req.from.id, `¡Hola ${req.from.first_name}! He aceptado tu solicitud.\n\nÚnete aquí: ${invite}`);
        } catch (e) {
            console.error("Error auto-aceptando:", e.message);
        }
    });

    console.log("Bot inicializado con sistema Clean-Chat y Search v2.");
}

module.exports = initializeBot;
