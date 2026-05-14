module.exports = function(botCtx, helpers) {
    const { bot, mongoDb, adminState, ADMIN_CHAT_IDS, TMDB_API_KEY, RENDER_BACKEND_URL, axios, pinnedCache, fs, path } = botCtx;
    const { clearLiveCache, clearAllCaches, getMainMenuKeyboard, showEarningsPanel, sendFinalSummary, handleManageSeries } = helpers;

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

            if (data && data.startsWith('ads_')) return;

            if (!ADMIN_CHAT_IDS.includes(chatId)) {
                bot.answerCallbackQuery(callbackQuery.id, { text: 'No tienes permiso.', show_alert: true });
                return;
            }

            bot.answerCallbackQuery(callbackQuery.id);

            if (data.startsWith('hub_')) {
                if (chatId !== ADMIN_CHAT_IDS[0]) {
                    bot.answerCallbackQuery(callbackQuery.id, { text: '🔒 Acceso denegado. Solo el Admin Principal.', show_alert: true });
                    return;
                }
                
                if (data === 'hub_activate') {
                    await mongoDb.collection('live_feed_config').updateOne({ _id: 'main_feed' }, { $set: { "config.isActive": true } }, { upsert: true });
                    clearLiveCache();
                    bot.editMessageText('🟢 **Hub Dinámico ACTIVADO**\n\nEl feed en vivo ya es visible en la app.', { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Volver', callback_data: 'manage_special_hub' }]] } }).catch(()=>{});
                    return;
                }
                
                if (data === 'hub_deactivate') {
                    await mongoDb.collection('live_feed_config').updateOne({ _id: 'main_feed' }, { $set: { "config.isActive": false } }, { upsert: true });
                    clearLiveCache();
                    bot.editMessageText('🔴 **Hub Dinámico DESACTIVADO**\n\nLa app volvió a la normalidad.', { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Volver', callback_data: 'manage_special_hub' }]] } }).catch(()=>{});
                    return;
                }

                // NUEVO GESTOR INDIVIDUAL DE TARJETAS SECUNDARIAS
                if (data === 'hub_manage_secondary') {
                    const liveData = await mongoDb.collection('live_feed_config').findOne({ _id: 'main_feed' });
                    if (!liveData || !liveData.secondaryEvents || liveData.secondaryEvents.length === 0) {
                        bot.editMessageText('📭 No hay tarjetas secundarias creadas.', { chat_id: chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [[{ text: '⬅️ Volver', callback_data: 'manage_special_hub' }]] } }).catch(()=>{});
                        return;
                    }
                    let buttons = [];
                    liveData.secondaryEvents.forEach(ev => {
                        buttons.push([{ text: `🗑️ Borrar: ${ev.title}`, callback_data: `hub_del_sec_${ev.id}` }]);
                    });
                    buttons.push([{ text: '🧹 Vaciar TODAS de golpe', callback_data: 'hub_clear_secondary' }]);
                    buttons.push([{ text: '⬅️ Volver', callback_data: 'manage_special_hub' }]);

                    bot.editMessageText('📋 **Gestor de Tarjetas Secundarias**\n\nSelecciona cuál deseas eliminar:', {
                        chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons }
                    }).catch(()=>{});
                    return;
                }

                if (data.startsWith('hub_del_sec_')) {
                    const evId = data.replace('hub_del_sec_', '');
                    await mongoDb.collection('live_feed_config').updateOne(
                        { _id: 'main_feed' },
                        { $pull: { secondaryEvents: { id: evId } } }
                    );
                    clearLiveCache();
                    bot.editMessageText('✅ Tarjeta secundaria eliminada exitosamente.', { chat_id: chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [[{ text: '⬅️ Volver', callback_data: 'hub_manage_secondary' }]] } }).catch(()=>{});
                    return;
                }
                
                if (data === 'hub_clear_secondary') {
                    await mongoDb.collection('live_feed_config').updateOne({ _id: 'main_feed' }, { $set: { secondaryEvents: [] } }, { upsert: true });
                    clearLiveCache();
                    bot.editMessageText('🧹 **Tarjetas Secundarias Vaciadas**\n\nSe limpió el listado secundario exitosamente.', { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⬅️ Volver', callback_data: 'manage_special_hub' }]] } }).catch(()=>{});
                    return;
                }

                if (data === 'hub_config_hero') {
                    adminState[chatId] = { step: 'hub_nav_text', tempHubData: {}, promptMessageId: msg.message_id };
                    bot.editMessageText('✏️ **Configurar Evento Principal**\n\n📝 Primero, ingresa el **texto para el botón del menú inferior** (Ej: En Vivo, VIP, Eventos):', { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown' }).catch(()=>{});
                    return;
                }

                if (data === 'hub_add_secondary') {
                    adminState[chatId] = { step: 'hub_sec_title', tempHubData: {}, promptMessageId: msg.message_id };
                    bot.editMessageText('➕ **Agregar Tarjeta Secundaria**\n\n📝 Ingresa el **título** para la tarjeta secundaria:', { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown' }).catch(()=>{});
                    return;
                }
            }
            
            if (data === 'manage_special_hub') {
                if (chatId !== ADMIN_CHAT_IDS[0]) return;
                bot.editMessageText('📡 **Gestor del Hub Especial (Feed en Vivo)**\n\nSelecciona una opción a continuación:', {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🟢 Activar Hub', callback_data: 'hub_activate' }, { text: '🔴 Desactivar Hub', callback_data: 'hub_deactivate' }],
                            [{ text: '✏️ Configurar Evento Principal (Hero)', callback_data: 'hub_config_hero' }],
                            [{ text: '➕ Agregar Tarjeta Secundaria', callback_data: 'hub_add_secondary' }],
                            [{ text: '📋 Gestionar Secundarias (Editar/Borrar)', callback_data: 'hub_manage_secondary' }],
                            [{ text: '⬅️ Volver', callback_data: 'back_to_menu' }]
                        ]
                    }
                }).catch(()=>{});
                return;
            }

            if (data === 'back_to_menu') {
                adminState[chatId] = { step: 'menu' };
                const inline_keyboard = getMainMenuKeyboard(chatId);
                
                bot.editMessageText(`¡Hola de nuevo! ¿Qué quieres hacer hoy?`, {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    reply_markup: { inline_keyboard }
                }).catch(() => {
                    bot.sendMessage(chatId, `¡Hola de nuevo! ¿Qué quieres hacer hoy?`, { reply_markup: { inline_keyboard } });
                });
                return;
            }

            if (data === 'manage_bonus_menu') {
                adminState[chatId] = { step: 'awaiting_bonus_user_id', promptMessageId: msg.message_id };
                bot.editMessageText('💰 **Gestión de Bonos**\n\nPor favor, escribe el **ID de Telegram** del editor al que deseas enviar un bono:', {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '⬅️ Cancelar y Volver', callback_data: 'back_to_menu' }]] }
                }).catch(e => { bot.sendMessage(chatId, '💰 **Gestión de Bonos**\n\nEscribe el ID del editor:'); });
                return;
            }

            if (data === 'view_earnings') {
                const uploaderName = msg.chat.first_name || msg.chat.username || "Admin";
                await showEarningsPanel(chatId, uploaderName, chatId);
                return;
            }
            
            if (data === 'view_admin2_earnings') {
                if (ADMIN_CHAT_IDS.length > 1) {
                    await showEarningsPanel(ADMIN_CHAT_IDS[1], "Admin Secundario", chatId);
                } else {
                    bot.sendMessage(chatId, "⚠️ No hay un Admin 2 configurado en las variables de entorno.");
                }
                return;
            }

            if (data === 'cms_announcement_menu') {
                const options = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🆕 Crear Nuevo', callback_data: 'cms_create_new' }],
                            [{ text: '🗑️ Borrar Actual', callback_data: 'cms_delete_current' }],
                            [{ text: '👀 Ver JSON Actual', callback_data: 'cms_view_current' }],
                            [{ text: '⬅️ Volver', callback_data: 'back_to_menu' }]
                        ]
                    }
                };
                bot.editMessageText('📡 **Gestor de Comunicados Globales**\n\nAquí puedes crear anuncios multimedia para la App.', { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', ...options }).catch(()=>{});
            }

            else if (data === 'cms_create_new') {
                adminState[chatId] = {
                    step: 'cms_await_media_type',
                    tempAnnouncement: {}
                };
                bot.editMessageText('🛠️ **Creando Nuevo Anuncio**\n\nSelecciona el formato:', {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🎬 Video (MP4/M3U8)', callback_data: 'cms_type_video' }],
                            [{ text: '🖼️ Imagen (JPG/PNG)', callback_data: 'cms_type_image' }],
                            [{ text: '📝 Solo Texto', callback_data: 'cms_type_text' }]
                        ]
                    }
                }).catch(()=>{});
            }

            else if (data === 'cms_type_image' || data === 'cms_type_video' || data === 'cms_type_text') {
                let type = 'text';
                if (data === 'cms_type_image') type = 'image';
                if (data === 'cms_type_video') type = 'video';

                adminState[chatId].tempAnnouncement.mediaType = type;

                if (type === 'text') {
                    adminState[chatId].step = 'cms_await_title';
                    bot.editMessageText('✅ Formato: Solo Texto.\n\n📝 Escribe el **TÍTULO** del anuncio:', { chat_id: chatId, message_id: msg.message_id }).catch(()=>{});
                } else {
                    adminState[chatId].step = 'cms_await_media_url';
                    const tipoMsg = type === 'video' ? 'del VIDEO (mp4, m3u8)' : 'de la IMAGEN';
                    bot.editMessageText(`✅ Formato: ${type.toUpperCase()}.\n\n🔗 Envía la **URL** directa ${tipoMsg}:`, { chat_id: chatId, message_id: msg.message_id }).catch(()=>{});
                }
            }
            
            else if (data === 'cms_vis_true' || data === 'cms_vis_false') {
                const isAlwaysVisible = data === 'cms_vis_true';
                adminState[chatId].tempAnnouncement.siempreVisible = isAlwaysVisible;
                
                const ann = adminState[chatId].tempAnnouncement;
                let mediaDisplay = `🔗 **Media:** [Ver Link](${ann.mediaUrl})`;
                if (ann.mediaType === 'text') mediaDisplay = "📄 **Tipo:** Solo Texto";

                const visibilityText = isAlwaysVisible ? '✅ Sí (Ignora Caché)' : '❌ No (Normal)';

                const summary = `📢 *RESUMEN DEL ANUNCIO*\n\n` +
                    `🎬 **Tipo:** ${ann.mediaType}\n` +
                    `${mediaDisplay}\n` +
                    `📌 **Título:** ${ann.title}\n` +
                    `📝 **Cuerpo:** ${ann.message}\n` +
                    `🔘 **Botón:** ${ann.buttonText}\n` +
                    `🚀 **Acción:** [Ver Link](${ann.actionUrl})\n` +
                    `🔥 **Siempre Visible:** ${visibilityText}`;

                adminState[chatId].step = 'cms_confirm_save';

                bot.editMessageText(summary, {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ PUBLICAR AHORA', callback_data: 'cms_save_confirm' }],
                            [{ text: '❌ Cancelar', callback_data: 'cms_cancel' }]
                        ]
                    }
                }).catch(()=>{});
            }

            else if (data === 'cms_delete_current') {
                const filePath = path.join(__dirname, 'globalAnnouncement.json');
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    bot.sendMessage(chatId, '✅ Comunicado eliminado. La App ya no mostrará nada.');
                } else {
                    bot.sendMessage(chatId, '⚠️ No había comunicado activo.');
                }
            }

            else if (data === 'cms_view_current') {
                const filePath = path.join(__dirname, 'globalAnnouncement.json');
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf8');
                    bot.sendMessage(chatId, `📄 **JSON Actual en Servidor:**\n\`${content}\``, { parse_mode: 'Markdown' });
                } else {
                    bot.sendMessage(chatId, '📭 No hay comunicado activo.');
                }
            }

            else if (data === 'cms_save_confirm') {
                const announcement = adminState[chatId].tempAnnouncement;
                const filePath = path.join(__dirname, 'globalAnnouncement.json');

                try {
                    let jsonToSave = {
                        id: Date.now().toString(),
                        title: announcement.title,
                        message: announcement.message,
                        btnText: announcement.buttonText,
                        actionUrl: announcement.actionUrl,
                        siempreVisible: announcement.siempreVisible || false
                    };

                    if (announcement.mediaType === 'video') {
                        jsonToSave.videoUrl = announcement.mediaUrl;
                    } else if (announcement.mediaType === 'image') {
                        jsonToSave.imageUrl = announcement.mediaUrl;
                    }

                    fs.writeFileSync(filePath, JSON.stringify(jsonToSave, null, 2));

                    bot.editMessageText('✅ **¡Comunicado Publicado Correctamente!**\n\nEl JSON ha sido generado con el formato que el Frontend espera.', { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🏠 Menú', callback_data: 'back_to_menu' }]] } }).catch(()=>{});
                    adminState[chatId] = { step: 'menu' };

                } catch (err) {
                    console.error("CMS Save Error:", err);
                    bot.sendMessage(chatId, '❌ Error al guardar el archivo JSON.');
                }
            }

            else if (data === 'cms_cancel') {
                adminState[chatId] = { step: 'menu' };
                bot.editMessageText('❌ Operación cancelada.', { chat_id: chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [[{ text: '🏠 Menú', callback_data: 'back_to_menu' }]] } }).catch(()=>{});
            }

            else if (data === 'send_global_msg') {
                adminState[chatId] = { step: 'awaiting_global_msg_title' };
                bot.sendMessage(chatId, "📢 **NOTIFICACIÓN GLOBAL**\n\nPrimero, escribe el **TÍTULO** que aparecerá en la notificación:", { parse_mode: 'Markdown' });
            }

            else if (data === 'add_manual_movie') {
                adminState[chatId] = {
                    step: 'manual_await_title',
                    manualData: {}
                };
                bot.sendMessage(chatId, '📁 **Subida Manual (Propio)**\n\n📝 Escribe el **TÍTULO** del contenido:');
            }

            else if (data === 'add_movie') {
                adminState[chatId] = { step: 'search_movie' };
                if (msg.photo) {
                    bot.sendMessage(chatId, '🔍 Escribe el nombre de la película a agregar (Ej: "Avatar 2009").');
                } else {
                    bot.editMessageText('🔍 Escribe el nombre de la película a agregar (Ej: "Avatar 2009").', { chat_id: chatId, message_id: msg.message_id }).catch(() => {
                        bot.sendMessage(chatId, 'Escribe el nombre de la película a agregar (Ej: "Avatar 2009").');
                    });
                }
            }
            else if (data === 'add_series') {
                adminState[chatId] = { step: 'search_series' };
                if (msg.photo) {
                    bot.sendMessage(chatId, '🔍 Escribe el nombre de la serie a agregar (Ej: "Dark 2017").');
                } else {
                    bot.editMessageText('🔍 Escribe el nombre de la serie a agregar (Ej: "Dark 2017").', { chat_id: chatId, message_id: msg.message_id }).catch(() => {
                        bot.sendMessage(chatId, 'Escribe el nombre del serie a agregar (Ej: "Dark 2017").');
                    });
                }
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
                bot.editMessageText('📂 *Filtrar Pedidos por Prioridad:*', { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown', ...options }).catch(()=>{});
            }
            else if (data.startsWith('req_filter_')) {
                const parts = data.split('_');
                const filterType = parts[2];
                const page = parseInt(parts[3]) || 0;
                const PAGE_SIZE = 10;

                let query = {};
                let titleMsg = '';

                if (filterType === 'ultra') {
                    query = { latestPriority: { $in: ['immediate', 'premium'] }, status: { $ne: 'subido' } };
                    titleMsg = '🚀 Pedidos Ultra Rápidos (Immediate/Premium)';
                } else if (filterType === 'fast') {
                    query = { latestPriority: 'fast', status: { $ne: 'subido' } };
                    titleMsg = '⚡ Pedidos Rápidos (Fast)';
                } else if (filterType === 'regular') {
                    query = { latestPriority: 'regular', status: { $ne: 'subido' } };
                    titleMsg = '📅 Pedidos Regulares';
                }

                try {
                    const totalDocs = await mongoDb.collection('movie_requests').countDocuments(query);
                    
                    const requests = await mongoDb.collection('movie_requests')
                        .find(query)
                        .sort({ votes: -1 })
                        .skip(page * PAGE_SIZE)
                        .limit(PAGE_SIZE)
                        .toArray();

                    if (requests.length === 0) {
                        if (page === 0) {
                            bot.sendMessage(chatId, `✅ No hay pedidos pendientes en la categoría: ${filterType}`);
                        } else {
                            bot.sendMessage(chatId, `✅ No hay más pedidos en esta página.`);
                        }
                    } else {
                        bot.sendMessage(chatId, `📋 *${titleMsg} (Pág ${page + 1}):*`, { parse_mode: 'Markdown' });
                        
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

                        const nextIdx = page + 1;
                        const hasMore = (page * PAGE_SIZE) + requests.length < totalDocs;

                        if (hasMore) {
                            const navOptions = {
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: `➡️ Ver más (Pág ${nextIdx + 1})`, callback_data: `req_filter_${filterType}_${nextIdx}` }],
                                        [{ text: '⬅️ Volver al Menú', callback_data: 'view_requests_menu' }]
                                    ]
                                }
                            };
                            bot.sendMessage(chatId, `🔽 Navegación (${filterType})`, navOptions);
                        }
                    }
                } catch (err) {
                    console.error("Error filtrando pedidos:", err);
                    bot.sendMessage(chatId, '❌ Error al consultar la base de datos.');
                }
            }

            else if (data.startsWith('add_new_movie_') || data.startsWith('solicitud_')) {
                let tmdbId = '';
                if (data.startsWith('add_new_movie_')) tmdbId = data.split('_')[3];
                if (data.startsWith('solicitud_')) tmdbId = data.split('_')[1];

                if (!tmdbId) { bot.sendMessage(chatId, 'Error: No se pudo obtener el ID.'); return; }
                try {
                    const movieUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
                    const response = await axios.get(movieUrl);
                    const movieData = response.data;
                    if (!movieData) { bot.sendMessage(chatId, 'Error: No se encontraron detalles.'); return; }

                    const genreIds = movieData.genres ? movieData.genres.map(g => g.id) : [];
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
                    
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => { });
                    
                    const promptMsg = await bot.sendMessage(chatId, `🎬 Película: *${movieData.title}*\n🏷️ Géneros: ${genreIds.length}\n🌍 Países: ${countries.join(', ')}\n\n🔗 Envía el **ENLACE (Link)** del video.`, { parse_mode: 'Markdown' });
                    adminState[chatId].promptMessageId = promptMsg.message_id;

                } catch (error) {
                    console.error("Error al obtener detalles de TMDB:", error.message);
                    bot.sendMessage(chatId, 'Error al obtener los detalles de TMDB.');
                }
            }

            else if (data.startsWith('set_pinned_movie_')) {
                const isPinned = data === 'set_pinned_movie_true';
                if (!adminState[chatId].movieDataToSave) { bot.sendMessage(chatId, 'Error de estado.'); return; }

                adminState[chatId].movieDataToSave.isPinned = isPinned;
                adminState[chatId].step = 'awaiting_publish_choice';

                const mediaId = adminState[chatId].movieDataToSave.tmdbId;

                const options = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '💾 Solo App (Visible)', callback_data: 'save_only_' + mediaId },
                                { text: '🤫 Solo Guardar (Oculto)', callback_data: 'save_silent_hidden_' + mediaId }
                            ],
                            [
                                { text: '🚀 Canal (A+B) + PUSH', callback_data: 'save_publish_push_channel_' + mediaId }
                            ],
                            [
                                { text: '📢 Canal (A+B) - Sin Push', callback_data: 'save_publish_channel_no_push_' + mediaId }
                            ]
                        ]
                    }
                };

                const pinnedStatus = isPinned ? "⭐ DESTACADO (Top)" : "📅 Normal";
                bot.editMessageText(`✅ Estado definido: ${pinnedStatus}.\n¿Cómo deseas publicar la película?`, {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    reply_markup: options.reply_markup
                }).catch(() => {
                    bot.sendMessage(chatId, `✅ Estado definido: ${pinnedStatus}.\n¿Cómo deseas publicar?`, options);
                });
            }

            else if (data.startsWith('set_pinned_series_')) {
                const isPinned = data === 'set_pinned_series_true';
                if (!adminState[chatId].seriesDataToSave) { bot.sendMessage(chatId, 'Error de estado.'); return; }

                adminState[chatId].seriesDataToSave.isPinned = isPinned;
                const seriesData = adminState[chatId].seriesDataToSave;
                const season = adminState[chatId].season;
                const episode = adminState[chatId].episode;
                const totalEpisodesInSeason = adminState[chatId].totalEpisodesInSeason;

                bot.editMessageText(`⏳ Guardando S${season}E${episode} (${isPinned ? '⭐ Destacado' : '📅 Normal'})...`, { chat_id: chatId, message_id: msg.message_id }).catch(()=>{});

                try {
                    await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, seriesData);
                    clearAllCaches(); // FORZAR LIMPIEZA DE CACHÉ
                    
                    const nextEpisode = episode + 1;
                    const isSeasonFinished = totalEpisodesInSeason && episode >= totalEpisodesInSeason;

                    adminState[chatId].lastSavedEpisodeData = seriesData;
                    adminState[chatId].step = 'awaiting_series_action';

                    const rowCorrections = [
                        { text: `✏️ Editar`, callback_data: `edit_episode_${seriesData.tmdbId}_${season}_${episode}` },
                        { text: '🗑️ Borrar', callback_data: `delete_episode_${seriesData.tmdbId}_${season}_${episode}` }
                    ];

                    let rowNext = [];
                    if (isSeasonFinished) {
                        const nextSeason = season + 1;
                        rowNext.push({ text: `🎉 Fin T${season} -> Iniciar T${nextSeason}`, callback_data: `manage_season_${seriesData.tmdbId}_${nextSeason}` });
                    } else {
                        rowNext.push({ text: `➡️ Siguiente: S${season}E${nextEpisode}`, callback_data: `add_next_episode_${seriesData.tmdbId}_${season}` });
                    }

                    const rowPublish = [
                        { text: `📲 App + PUSH`, callback_data: `publish_push_this_episode_${seriesData.tmdbId}_${season}_${episode}` },
                        { text: `🚀 Canal + PUSH`, callback_data: `publish_push_channel_this_episode_${seriesData.tmdbId}_${season}_${episode}` }
                    ];

                    const rowFinal = [
                        { text: `📢 Solo Canal`, callback_data: `publish_channel_no_push_this_episode_${seriesData.tmdbId}_${season}_${episode}` },
                        { text: '⏹️ Finalizar Todo', callback_data: `finish_series_${seriesData.tmdbId}` }
                    ];

                    bot.editMessageText(`✅ *S${season}E${episode} Guardado exitosamente.*\n\n¿Qué acción deseas realizar ahora?`, {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [rowCorrections, rowNext, rowPublish, rowFinal] }
                    }).catch(()=>{});

                } catch (error) {
                    console.error("Error guardando episodio:", error.message);
                    bot.sendMessage(chatId, '❌ Error guardando en servidor.');
                    adminState[chatId] = { step: 'menu' };
                }
            }


            else if (data.startsWith('add_new_series_')) {
                const tmdbId = data.split('_')[3];
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => { });
                await handleManageSeries(chatId, tmdbId);
            }
            else if (data.startsWith('manage_series_')) {
                const tmdbId = data.split('_')[2];
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => { });
                await handleManageSeries(chatId, tmdbId);
            }

            else if (data.startsWith('manage_season_')) {
                const [_, __, tmdbId, seasonNumber] = data.split('_');
                const { selectedSeries } = adminState[chatId] || {};

                if (!selectedSeries || (selectedSeries.id && selectedSeries.id.toString() !== tmdbId && selectedSeries.tmdbId !== tmdbId)) {
                    bot.sendMessage(chatId, '⚠️ Estado perdido. Por favor busca la serie nuevamente.');
                    return;
                }

                let totalEpisodes = 0;
                try {
                    const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}`;
                    const resp = await axios.get(url);
                    if (resp.data && resp.data.episodes) totalEpisodes = resp.data.episodes.length;
                } catch (e) { }

                const seriesData = await mongoDb.collection('series_catalog').findOne({ tmdbId: tmdbId });
                let lastEpisode = 0;
                if (seriesData && seriesData.seasons && seriesData.seasons[seasonNumber] && seriesData.seasons[seasonNumber].episodes) {
                    lastEpisode = Object.keys(seriesData.seasons[seasonNumber].episodes).map(Number).sort((a, b) => b - a)[0] || 0;
                }
                const nextEpisode = lastEpisode + 1;

                adminState[chatId] = {
                    ...adminState[chatId],
                    step: 'awaiting_unified_link_series',
                    season: parseInt(seasonNumber),
                    episode: nextEpisode,
                    totalEpisodesInSeason: totalEpisodes
                };

                const msgPrompt = `Gestionando *S${seasonNumber}* de *${selectedSeries.name}*.\nAgregando episodio *E${nextEpisode}*.\n\n🔗 Envía el **ENLACE** del video.`;
                
                bot.editMessageText(msgPrompt, { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown' }).catch(async () => {
                     const promptMsg = await bot.sendMessage(chatId, msgPrompt, { parse_mode: 'Markdown' });
                     adminState[chatId].promptMessageId = promptMsg.message_id;
                });
                adminState[chatId].promptMessageId = msg.message_id; 
            }

            else if (data.startsWith('add_next_episode_')) {
                const [_, __, ___, tmdbId, seasonNumber] = data.split('_');
                const { selectedSeries, totalEpisodesInSeason } = adminState[chatId];

                if (!selectedSeries || selectedSeries.id.toString() !== tmdbId && selectedSeries.tmdbId !== tmdbId) {
                    bot.sendMessage(chatId, 'Error: Datos de la serie perdidos. Vuelve a empezar.');
                    adminState[chatId] = { step: 'menu' };
                    return;
                }

                const lastSaved = adminState[chatId].lastSavedEpisodeData;
                const nextEpisode = (lastSaved ? lastSaved.episodeNumber : 0) + 1;

                adminState[chatId] = {
                    ...adminState[chatId],
                    step: 'awaiting_unified_link_series',
                    season: parseInt(seasonNumber),
                    episode: nextEpisode
                };

                bot.editMessageText(`Siguiente: Envía **ENLACE** para S${seasonNumber}E${nextEpisode}.`, { chat_id: chatId, message_id: msg.message_id }).catch(()=>{});
                adminState[chatId].promptMessageId = msg.message_id;
            }

            else if (data.startsWith('delete_episode_')) {
                const [_, __, tmdbId, season, episode] = data.split('_');
                try {
                    await axios.post(`${RENDER_BACKEND_URL}/delete-series-episode`, {
                        tmdbId, seasonNumber: parseInt(season), episodeNumber: parseInt(episode)
                    });
                    clearAllCaches(); // FORZAR LIMPIEZA DE CACHÉ
                    bot.sendMessage(chatId, `🗑️ Episodio S${season}E${episode} eliminado. Puedes volver a subirlo.`);
                } catch (e) {
                    bot.sendMessage(chatId, '❌ Error eliminando episodio.');
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
                bot.editMessageText(`✏️ Corrección: Envía el NUEVO enlace para **S${season}E${episode}**:`, { chat_id: chatId, message_id: msg.message_id }).catch(()=>{});
                adminState[chatId].promptMessageId = msg.message_id;
            }

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

                    const localMovie = await mongoDb.collection('media_catalog').findOne({ tmdbId: tmdbId.toString() });
                    const isPinned = localMovie?.isPinned || false;

                    let pinnedButtons = [];
                    if (isPinned) {
                        pinnedButtons = [
                            { text: '🔄 Subir al 1° Lugar', callback_data: `pin_action_refresh_movie_${tmdbId}` },
                            { text: '❌ Quitar de Top', callback_data: `pin_action_unpin_movie_${tmdbId}` }
                        ];
                    } else {
                        pinnedButtons = [
                            { text: '⭐ Fijar en Top', callback_data: `pin_action_pin_movie_${tmdbId}` }
                        ];
                    }

                    const options = {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '✏️ Editar Link', callback_data: `add_pro_movie_${tmdbId}` }],
                                pinnedButtons,
                                [{ text: '🗑️ Eliminar Película', callback_data: `delete_confirm_${tmdbId}_movie` }]
                            ]
                        }
                    };

                    const statusText = isPinned ? "⭐ ES DESTACADO" : "📅 ES NORMAL";
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => { });
                    bot.sendMessage(chatId, `Gestionando: *${movieData.title}*\nEstado: ${statusText}\n\n¿Qué deseas hacer?`, { ...options, parse_mode: 'Markdown' });

                } catch (error) {
                    console.error("Error manage_movie_:", error.message);
                    bot.sendMessage(chatId, 'Error al obtener los detalles.');
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

                    if (pinnedCache) {
                        pinnedCache.del('pinned_content_top');
                        console.log("[Bot] Caché de destacados borrada. El cambio será inmediato.");
                    }
                    clearAllCaches();

                    bot.sendMessage(chatId, replyText);

                } catch (error) {
                    console.error("Error pin_action:", error);
                    bot.sendMessage(chatId, "❌ Error al cambiar el estado.");
                }
            }

            else if (data.startsWith('add_pro_movie_') || data.startsWith('add_free_movie_')) {
                const isPro = data.startsWith('add_pro_movie_');
                const tmdbId = data.split('_')[3];
                adminState[chatId] = {
                    step: 'awaiting_edit_movie_link',
                    tmdbId: tmdbId,
                    isPro: isPro,
                    promptMessageId: msg.message_id
                };
                bot.editMessageText(`✏️ Editando enlace para ID: ${tmdbId}.\n\n🔗 Envía el nuevo enlace ahora:`, { chat_id: chatId, message_id: msg.message_id }).catch(() => {});
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
                        clearAllCaches(); // FORZAR LIMPIEZA DE CACHÉ
                        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => { });
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

            else if (data.startsWith('save_only_')) {
                bot.editMessageText('⏳ Guardando datos en el servidor...', { chat_id: chatId, message_id: msg.message_id }).catch(()=>{});
                const { movieDataToSave } = adminState[chatId];
                if (!movieDataToSave?.tmdbId) { bot.sendMessage(chatId, 'Error: Datos perdidos.'); adminState[chatId] = { step: 'menu' }; return; }
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                clearAllCaches(); // FORZAR LIMPIEZA DE CACHÉ
                await sendFinalSummary(chatId, movieDataToSave.title, true, msg.message_id);
            }

            else if (data.startsWith('save_silent_hidden_')) {
                bot.editMessageText('⏳ Guardando en modo silencioso...', { chat_id: chatId, message_id: msg.message_id }).catch(()=>{});
                const { movieDataToSave } = adminState[chatId];
                if (!movieDataToSave?.tmdbId) { bot.sendMessage(chatId, 'Error: Datos perdidos.'); adminState[chatId] = { step: 'menu' }; return; }
                movieDataToSave.hideFromRecent = true;
                try {
                    await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                    clearAllCaches(); // FORZAR LIMPIEZA DE CACHÉ
                    await sendFinalSummary(chatId, movieDataToSave.title + " (Oculta)", true, msg.message_id);
                } catch (error) {
                    bot.sendMessage(chatId, '❌ Error al guardar.');
                }
            }

            else if (data.startsWith('save_publish_push_channel_')) {
                bot.editMessageText('⏳ Guardando y publicando en canales...', { chat_id: chatId, message_id: msg.message_id }).catch(()=>{});
                const tmdbIdFromCallback = data.split('_').pop();
                const { movieDataToSave } = adminState[chatId];

                if (!movieDataToSave?.tmdbId || movieDataToSave.tmdbId !== tmdbIdFromCallback) {
                    bot.sendMessage(chatId, 'Error: Datos perdidos. Intenta de nuevo desde la búsqueda.');
                    adminState[chatId] = { step: 'menu' };
                    return;
                }

                try {
                    await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                    clearAllCaches(); // FORZAR LIMPIEZA DE CACHÉ

                    await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                        title: "¡Nuevo Estreno!",
                        body: `Ya puedes ver: ${movieDataToSave.title}`,
                        imageUrl: movieDataToSave.poster_path ? (movieDataToSave.poster_path.startsWith('http') ? movieDataToSave.poster_path : `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}`) : null,
                        tmdbId: movieDataToSave.tmdbId,
                        mediaType: 'movie'
                    });

                    const DEEPLINK_URL = `${RENDER_BACKEND_URL}/view/movie/${movieDataToSave.tmdbId}`;
                    const CHANNEL_SMALL = process.env.TELEGRAM_CHANNEL_A_ID;
                    const CHANNEL_BIG_ID = process.env.TELEGRAM_CHANNEL_B_ID;

                    if (CHANNEL_SMALL) {
                        const shortOverview = movieDataToSave.overview 
                            ? (movieDataToSave.overview.length > 280 
                                ? movieDataToSave.overview.substring(0, 280) + '...' 
                                : movieDataToSave.overview)
                            : 'Sin sinopsis disponible.';

                        const messageToSmall = `🎬 *${movieDataToSave.title.toUpperCase()}*\n\n` +
                            `📺 Calidad: Full HD\n` +
                            `🗣 Idioma: Latino\n` +
                            `⭐ Puntuación: ${movieDataToSave.vote_average ? movieDataToSave.vote_average.toFixed(1) : 'N/A'} / 10\n\n` +
                            `📖 *Sinopsis:*\n` +
                            `${shortOverview}\n\n` +
                            `❓ ¿No sabes cómo verla?\n` +
                            `📘 Tutorial paso a paso aquí:\n` +
                            `👉 https://tututorialaqui.com\n\n` +
                            `👇🏻 *MIRA AQUÍ LA PELÍCULA* 👇🏻`;

                        const imageToSend = movieDataToSave.poster_path ? (movieDataToSave.poster_path.startsWith('http') ? movieDataToSave.poster_path : `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}`) : 'https://placehold.co/500x750?text=SALA+CINE';

                        const sentMsgSmall = await bot.sendPhoto(CHANNEL_SMALL, imageToSend, {
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
                            const overviewTeaser = movieDataToSave.overview
                                ? movieDataToSave.overview.length > 250
                                    ? movieDataToSave.overview.substring(0, 250) + '...'
                                    : movieDataToSave.overview
                                : 'Una historia increíble te espera...';

                            const messageToBig = `🍿 *ESTRENO YA DISPONIBLE* 🍿\n\n` +
                                `🎬 *${movieDataToSave.title}* ${releaseYear}\n\n` +
                                `📝 _${overviewTeaser}_\n\n` +
                                `⚠️ _Por temas de copyright, la película completa se encuentra en nuestro canal privado._\n\n` +
                                `👇 *VER PELÍCULA AQUÍ* 👇`;

                            await bot.sendPhoto(CHANNEL_BIG_ID, imageToSend, {
                                caption: messageToBig,
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: '🚀 IR AL CANAL Y VER AHORA 🚀', url: linkToPost }]
                                    ]
                                }
                            });
                        }
                    }
                    await sendFinalSummary(chatId, movieDataToSave.title, true, msg.message_id);

                } catch (error) {
                    console.error("Error en save_publish_push_channel_:", error.response ? error.response.data : error.message);
                    bot.sendMessage(chatId, '❌ Error al guardar o enviar notificación.');
                }
            }

            else if (data.startsWith('save_publish_channel_no_push_')) {
                bot.editMessageText('⏳ Publicando sin Push...', { chat_id: chatId, message_id: msg.message_id }).catch(()=>{});
                const tmdbIdFromCallback = data.split('_').pop();
                const { movieDataToSave } = adminState[chatId];

                if (!movieDataToSave?.tmdbId || movieDataToSave.tmdbId !== tmdbIdFromCallback) {
                    bot.sendMessage(chatId, 'Error: Datos perdidos. Intenta de nuevo.');
                    adminState[chatId] = { step: 'menu' };
                    return;
                }

                try {
                    await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                    clearAllCaches(); // FORZAR LIMPIEZA DE CACHÉ

                    const DEEPLINK_URL = `${RENDER_BACKEND_URL}/view/movie/${movieDataToSave.tmdbId}`;
                    const CHANNEL_SMALL = process.env.TELEGRAM_CHANNEL_A_ID;
                    const CHANNEL_BIG_ID = process.env.TELEGRAM_CHANNEL_B_ID;

                    if (CHANNEL_SMALL) {
                        const shortOverview = movieDataToSave.overview 
                            ? (movieDataToSave.overview.length > 280 
                                ? movieDataToSave.overview.substring(0, 280) + '...' 
                                : movieDataToSave.overview)
                            : 'Sin sinopsis disponible.';

                        const messageToSmall = `🎬 *${movieDataToSave.title.toUpperCase()}*\n\n` +
                            `📺 Calidad: Full HD\n` +
                            `🗣 Idioma: Latino\n` +
                            `⭐ Puntuación: ${movieDataToSave.vote_average ? movieDataToSave.vote_average.toFixed(1) : 'N/A'} / 10\n\n` +
                            `📖 *Sinopsis:*\n` +
                            `${shortOverview}\n\n` +
                            `❓ ¿No sabes cómo verla?\n` +
                            `📘 Tutorial paso a paso aquí:\n` +
                            `👉 https://tututorialaqui.com\n\n` +
                            `👇🏻 *MIRA AQUÍ LA PELÍCULA* 👇🏻`;

                        const imageToSend = movieDataToSave.poster_path ? (movieDataToSave.poster_path.startsWith('http') ? movieDataToSave.poster_path : `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}`) : 'https://placehold.co/500x750?text=SALA+CINE';

                        const sentMsgSmall = await bot.sendPhoto(CHANNEL_SMALL, imageToSend, {
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
                            const overviewTeaser = movieDataToSave.overview
                                ? movieDataToSave.overview.length > 250
                                    ? movieDataToSave.overview.substring(0, 250) + '...'
                                    : movieDataToSave.overview
                                : 'Una historia increíble te espera...';

                            const messageToBig = `🍿 *ESTRENO YA DISPONIBLE* 🍿\n\n` +
                                `🎬 *${movieDataToSave.title}* ${releaseYear}\n\n` +
                                `📝 _${overviewTeaser}_\n\n` +
                                `⚠️ _Por temas de copyright, la película completa se encuentra en nuestro canal privado._\n\n` +
                                `👇 *VER PELÍCULA AQUÍ* 👇`;

                            await bot.sendPhoto(CHANNEL_BIG_ID, imageToSend, {
                                caption: messageToBig,
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: '🚀 IR AL CANAL Y VER AHORA 🚀', url: linkToPost }]
                                    ]
                                }
                            });
                        }
                    }
                    await sendFinalSummary(chatId, movieDataToSave.title, true, msg.message_id);

                } catch (error) {
                    console.error("Error en save_publish_channel_no_push_:", error.response ? error.response.data : error.message);
                    bot.sendMessage(chatId, '❌ Error al guardar o publicar.');
                }
            }

            else if (data.startsWith('publish_push_this_episode_')) {
                bot.editMessageText('⏳ Enviando Push del Episodio...', { chat_id: chatId, message_id: msg.message_id }).catch(()=>{});
                const [_, __, ___, tmdbId, season, episode] = data.split('_');
                const state = adminState[chatId];
                const episodeData = state?.lastSavedEpisodeData;
                if (!episodeData || episodeData.tmdbId !== tmdbId || episodeData.seasonNumber.toString() !== season || episodeData.episodeNumber.toString() !== episode) {
                    bot.sendMessage(chatId, 'Error: Datos perdidos.'); adminState[chatId] = { step: 'menu' }; return;
                }
                
                try {
                    await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                        title: `¡Nuevo Episodio! ${episodeData.title}`,
                        body: `Ya disponible: S${episodeData.seasonNumber}E${episodeData.episodeNumber}`,
                        imageUrl: episodeData.poster_path ? `https://image.tmdb.org/t/p/w500${episodeData.poster_path}` : null,
                        tmdbId: episodeData.tmdbId,
                        mediaType: 'tv'
                    });
                    await sendFinalSummary(chatId, `${episodeData.title} S${season}E${episode}`, false, msg.message_id);
                } catch (error) {
                    console.error("Error en publish_push_this_episode:", error.response ? error.response.data : error.message);
                    bot.sendMessage(chatId, '❌ Error al enviar notificación.');
                }
            }

            else if (data.startsWith('publish_push_channel_this_episode_')) {
                bot.editMessageText('⏳ Publicando Episodio en Canales...', { chat_id: chatId, message_id: msg.message_id }).catch(()=>{});
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
                
                try {
                    await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                        title: `¡Nuevo Episodio! ${episodeData.title}`,
                        body: `Ya disponible: S${episodeData.seasonNumber}E${episodeData.episodeNumber}`,
                        imageUrl: episodeData.poster_path ? `https://image.tmdb.org/t/p/w500${episodeData.poster_path}` : null,
                        tmdbId: episodeData.tmdbId,
                        mediaType: 'tv'
                    });

                    const DEEPLINK_URL = `${RENDER_BACKEND_URL}/view/tv/${episodeData.tmdbId}`;
                    const CHANNEL_SMALL = process.env.TELEGRAM_CHANNEL_A_ID;
                    const CHANNEL_BIG_ID = process.env.TELEGRAM_CHANNEL_B_ID;

                    if (CHANNEL_SMALL) {
                        const shortOverviewSeries = episodeData.overview 
                            ? (episodeData.overview.length > 280 
                                ? episodeData.overview.substring(0, 280) + '...' 
                                : episodeData.overview)
                            : '¡Un nuevo capítulo lleno de emoción te espera!';

                        const messageToSmall = `🎬 *${episodeData.title.toUpperCase()}*\n` +
                            `🔹 Temporada ${episodeData.seasonNumber} - Episodio ${episodeData.episodeNumber}\n\n` +
                            `📺 Calidad: Full HD\n` +
                            `🗣 Idioma: Latino\n` +
                            `⭐ Puntuación: ${episodeData.vote_average ? episodeData.vote_average.toFixed(1) : 'N/A'} / 10\n\n` +
                            `📖 *Sinopsis:*\n` +
                            `${shortOverviewSeries}\n\n` +
                            `❓ ¿No sabes cómo verla?\n` +
                            `📘 Tutorial paso a paso aquí:\n` +
                            `👉 https://tututorialaqui.com\n\n` +
                            `👇🏻 *MIRA AQUÍ LA SERIE* 👇🏻`;

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
                            const overviewTeaser = episodeData.overview
                                ? episodeData.overview.length > 200
                                    ? episodeData.overview.substring(0, 200) + '...'
                                    : episodeData.overview
                                : '¡Un nuevo capítulo lleno de emoción te espera!';

                            const messageToBig = `🍿 *NUEVO EPISODIO DISPONIBLE* 🍿\n\n` +
                                `📺 *${episodeData.title}*\n` +
                                `🔹 Temporada ${episodeData.seasonNumber} - Episodio ${episodeData.episodeNumber}\n\n` +
                                `📝 _${overviewTeaser}_\n\n` +
                                `⚠️ _Disponible ahora en nuestro canal de respaldo privado._\n\n` +
                                `👇 *VER EPISODIO AQUÍ* 👇`;

                            await bot.sendPhoto(CHANNEL_BIG_ID, episodeData.poster_path ? `https://image.tmdb.org/t/p/w500${episodeData.poster_path}` : 'https://placehold.co/500x750?text=SALA+CINE', {
                                caption: messageToBig,
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: '🚀 IR AL CANAL Y VER AHORA 🚀', url: linkToPost }]
                                    ]
                                }
                            });
                        }
                    }
                    await sendFinalSummary(chatId, `${episodeData.title} S${season}E${episode}`, false, msg.message_id);

                } catch (error) {
                    console.error("Error en publish_push_channel_this_episode:", error.response ? error.response.data : error.message);
                    bot.sendMessage(chatId, '❌ Error al enviar notificación.');
                }
            }

            else if (data.startsWith('publish_channel_no_push_this_episode_')) {
                bot.editMessageText('⏳ Publicando Episodio sin Push...', { chat_id: chatId, message_id: msg.message_id }).catch(()=>{});
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

                try {
                    const DEEPLINK_URL = `${RENDER_BACKEND_URL}/view/tv/${episodeData.tmdbId}`;
                    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_A_ID;

                    if (CHANNEL_ID) {
                        const shortOverviewSeries = episodeData.overview 
                            ? (episodeData.overview.length > 280 
                                ? episodeData.overview.substring(0, 280) + '...' 
                                : episodeData.overview)
                            : '¡Un nuevo capítulo lleno de emoción te espera!';
                        
                        const messageToChannel = `🎬 *${episodeData.title.toUpperCase()}*\n` +
                            `🔹 Temporada ${episodeData.seasonNumber} - Episodio ${episodeData.episodeNumber}\n\n` +
                            `📺 Calidad: Full HD\n` +
                            `🗣 Idioma: Latino\n` +
                            `⭐ Puntuación: ${episodeData.vote_average ? episodeData.vote_average.toFixed(1) : 'N/A'} / 10\n\n` +
                            `📖 *Sinopsis:*\n` +
                            `${shortOverviewSeries}\n\n` +
                            `❓ ¿No sabes cómo verla?\n` +
                            `📘 Tutorial paso a paso aquí:\n` +
                            `👉 https://tututorialaqui.com\n\n` +
                            `👇🏻 *MIRA AQUÍ LA SERIE* 👇🏻`;

                        await bot.sendPhoto(CHANNEL_ID, episodeData.poster_path ? `https://image.tmdb.org/t/p/w500${episodeData.poster_path}` : 'https://placehold.co/500x750?text=SALA+CINE', {
                            caption: messageToChannel,
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '▶️ Ver Ahora en la App', url: DEEPLINK_URL }]
                                ]
                            }
                        });
                    }
                    await sendFinalSummary(chatId, `${episodeData.title} S${season}E${episode}`, false, msg.message_id);

                } catch (error) {
                    console.error("Error en publish_channel_no_push_series:", error.response ? error.response.data : error.message);
                    bot.sendMessage(chatId, '❌ Error al publicar.');
                }
            }
            
            else if (data.startsWith('finish_series_')) {
                const state = adminState[chatId];
                const seriesTitle = state?.selectedSeries?.name || state?.lastSavedEpisodeData?.title || 'La serie';
                
                const finalMsg = `✅ **¡Proceso de serie finalizado!**\n\n📺 *${seriesTitle}* ya está disponible en la app.\n\n¿Qué deseas subir ahora?`;
                bot.editMessageText(finalMsg, { 
                    chat_id: chatId, 
                    message_id: msg.message_id, 
                    parse_mode: 'Markdown',
                    reply_markup: { 
                        inline_keyboard: [
                            [{ text: '📺 Subir otra Serie', callback_data: 'add_series' }],
                            [{ text: '🎬 Subir una Película', callback_data: 'add_movie' }]
                        ] 
                    } 
                }).catch(()=>{});
                adminState[chatId] = { step: 'menu' };
            }

        } catch (error) {
            console.error("Error en callback_query:", error);
            bot.sendMessage(chatId, '❌ Ocurrió un error procesando tu solicitud.');
        }
    });
};
