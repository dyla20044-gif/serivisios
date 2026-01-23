const fs = require('fs');
const path = require('path');

// =============================================================================
// HELPER FUNCTIONS FOR TEXT FORMATTING & DELAYS
// =============================================================================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const truncateText = (text, maxLength = 200) => {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
};

// Generador de Post para Canal Privado (A) - Diseño "Sexy"
const generatePrivateCaption = (data, mediaType, deepLinkUrl) => {
    const title = data.title || data.name;
    // Intentar obtener año
    let year = '';
    if (data.release_date) year = `(${data.release_date.substring(0, 4)})`;
    else if (data.first_air_date) year = `(${data.first_air_date.substring(0, 4)})`;

    const synopsis = truncateText(data.overview, 250); // Cortar a ~3 líneas
    
    // Datos cosméticos hardcodeados como solicitado
    const quality = "1080p / 4K 💎"; 
    const lang = "Español Latino 🇲🇽 / Dual 🇺🇸";

    let caption = `🎬 *${title}* ${year}\n\n`;
    caption += `🔸 *Calidad:* ${quality}\n`;
    caption += `🔸 *Audio:* ${lang}\n\n`;
    caption += `📝 *Sinopsis:*\n_${synopsis}_\n\n`;
    
    // Enlace Visible (Texto plano, sin botón)
    caption += `👇 *VER PELÍCULA AQUÍ* 👇\n`;
    caption += `${deepLinkUrl}\n\n`;
    
    // Tutorial
    caption += `💡 *¿No sabes cómo ver? Mira este tutorial:*\n`;
    caption += `https://t.me/peliculascinedyala_1m/9`;

    return caption;
};

// Generador de Post para Canales Públicos (B-K) - Diseño Anti-Strike + Publicidad
const generatePublicCaption = (data, mediaType) => {
    const title = data.title || data.name;
    let year = '';
    if (data.release_date) year = `(${data.release_date.substring(0, 4)})`;
    else if (data.first_air_date) year = `(${data.first_air_date.substring(0, 4)})`;

    const synopsis = truncateText(data.overview, 150);

    let caption = `🍿 *ESTRENO YA DISPONIBLE* 🍿\n\n`;
    caption += `🎬 *${title}* ${year}\n\n`;
    caption += `📝 _${synopsis}_\n\n`;
    caption += `⚠️ _Por temas de copyright, la película completa se encuentra en nuestro canal privado._\n\n`;
    
    // Publicidad y Contacto
    caption += `📢 *Espacio Publicitario:*\n`;
    caption += `Contrata aquí: @sala_cine_premiun\n`;
    caption += `Info: https://t.me/Dylan_1m_oficial\n\n`;
    caption += `👇 *VER PELÍCULA AQUÍ* 👇`;

    return caption;
};

// =============================================================================
// MAIN BOT INITIALIZATION
// =============================================================================

function initializeBot(bot, db, mongoDb, adminState, ADMIN_CHAT_ID, TMDB_API_KEY, RENDER_BACKEND_URL, axios, pinnedCache, sendNotificationToTopic, userCache) {

    // Lista de claves de entorno para canales públicos (B hasta K)
    // El Canal A es el privado/principal
    const PUBLIC_CHANNEL_KEYS = [
        'TELEGRAM_CHANNEL_B_ID', 'TELEGRAM_CHANNEL_C_ID', 'TELEGRAM_CHANNEL_D_ID',
        'TELEGRAM_CHANNEL_E_ID', 'TELEGRAM_CHANNEL_F_ID', 'TELEGRAM_CHANNEL_G_ID',
        'TELEGRAM_CHANNEL_H_ID', 'TELEGRAM_CHANNEL_I_ID', 'TELEGRAM_CHANNEL_J_ID',
        'TELEGRAM_CHANNEL_K_ID'
    ];

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
                    [{ text: '📡 Gestionar Comunicados (App)', callback_data: 'cms_announcement_menu' }],
                    [{ text: '📢 Enviar Notificación Global', callback_data: 'send_global_msg' }],
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
                    bot.deleteMessage(warningMessage.chat.id, warningMessage.message_id).catch(e => { });
                }, 5000);
            } catch (error) {
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

        if (adminState[chatId] && adminState[chatId].step && adminState[chatId].step.startsWith('cms_')) {
            const step = adminState[chatId].step;

            if (step === 'cms_await_media_url') {
                if (!userText.startsWith('http')) {
                    bot.sendMessage(chatId, '❌ Por favor envía una URL válida (empieza con http).');
                    return;
                }
                adminState[chatId].tempAnnouncement.mediaUrl = userText;
                adminState[chatId].step = 'cms_await_title';
                bot.sendMessage(chatId, '✅ URL Guardada.\n\n📝 Ahora escribe el **TÍTULO** del anuncio:');
            }
            else if (step === 'cms_await_title') {
                adminState[chatId].tempAnnouncement.title = userText;
                adminState[chatId].step = 'cms_await_body';
                bot.sendMessage(chatId, '✅ Título Guardado.\n\n📝 Ahora escribe el **MENSAJE (Cuerpo)** del anuncio:');
            }
            else if (step === 'cms_await_body') {
                adminState[chatId].tempAnnouncement.message = userText;
                adminState[chatId].step = 'cms_await_btn_text';
                bot.sendMessage(chatId, '✅ Cuerpo Guardado.\n\n🔘 Escribe el texto del **BOTÓN** (Ej: "Ver ahora", "Más info"):');
            }
            else if (step === 'cms_await_btn_text') {
                adminState[chatId].tempAnnouncement.buttonText = userText;
                adminState[chatId].step = 'cms_await_action_url';
                bot.sendMessage(chatId, '✅ Botón Guardado.\n\n🔗 Finalmente, envía la **URL DE ACCIÓN** (A donde lleva el botón):');
            }
            else if (step === 'cms_await_action_url') {
                if (!userText.startsWith('http')) {
                    bot.sendMessage(chatId, '❌ Envía una URL válida.');
                    return;
                }
                adminState[chatId].tempAnnouncement.actionUrl = userText;

                const ann = adminState[chatId].tempAnnouncement;
                let mediaDisplay = `🔗 **Media:** [Ver Link](${ann.mediaUrl})`;
                if (ann.mediaType === 'text') mediaDisplay = "📄 **Tipo:** Solo Texto";

                const summary = `📢 *RESUMEN DEL ANUNCIO*\n\n` +
                    `🎬 **Tipo:** ${ann.mediaType}\n` +
                    `${mediaDisplay}\n` +
                    `📌 **Título:** ${ann.title}\n` +
                    `📝 **Cuerpo:** ${ann.message}\n` +
                    `🔘 **Botón:** ${ann.buttonText}\n` +
                    `🚀 **Acción:** [Ver Link](${ann.actionUrl})`;

                adminState[chatId].step = 'cms_confirm_save';

                bot.sendMessage(chatId, summary, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ PUBLICAR AHORA', callback_data: 'cms_save_confirm' }],
                            [{ text: '❌ Cancelar', callback_data: 'cms_cancel' }]
                        ]
                    }
                });
            }
        }

        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_global_msg_text') {
            const messageBody = userText;

            bot.sendMessage(chatId, '🚀 Enviando notificación a TODOS los usuarios...');

            try {
                const result = await sendNotificationToTopic(
                    "📢 Aviso Importante",
                    messageBody,
                    null,
                    '0',
                    'general',
                    'all'
                );

                if (result.success) {
                    bot.sendMessage(chatId, '✅ Notificación global enviada con éxito.');
                } else {
                    bot.sendMessage(chatId, `⚠️ Error al enviar: ${result.error}`);
                }
            } catch (e) {
                console.error("Error enviando global msg:", e);
                bot.sendMessage(chatId, '❌ Error crítico al enviar la notificación.');
            } finally {
                adminState[chatId] = { step: 'menu' };
            }
        }

        else if (adminState[chatId] && adminState[chatId].step === 'search_movie') {
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
                        const options = {
                            caption: message, parse_mode: 'Markdown', reply_markup: {
                                inline_keyboard: [[{
                                    text: '✅ Gestionar Este', callback_data: callback_manage
                                }]]
                            }
                        };
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
                        const options = {
                            caption: message, parse_mode: 'Markdown', reply_markup: {
                                inline_keyboard: [[{
                                    text: '🗑️ Confirmar Eliminación', callback_data: `delete_confirm_${item.id}_${item.media_type}`
                                }]]
                            }
                        };
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

    // =========================================================================
    // CALLBACK QUERY HANDLING
    // =========================================================================

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

            // -----------------------------------------------------------------
            // CMS ANNOUNCEMENTS
            // -----------------------------------------------------------------
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
                bot.sendMessage(chatId, '📡 **Gestor de Comunicados Globales**\n\nAquí puedes crear anuncios multimedia para la App.', { parse_mode: 'Markdown', ...options });
            }

            else if (data === 'cms_create_new') {
                adminState[chatId] = {
                    step: 'cms_await_media_type',
                    tempAnnouncement: {}
                };
                bot.sendMessage(chatId, '🛠️ **Creando Nuevo Anuncio**\n\nSelecciona el formato:', {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🎬 Video (MP4/M3U8)', callback_data: 'cms_type_video' }],
                            [{ text: '🖼️ Imagen (JPG/PNG)', callback_data: 'cms_type_image' }],
                            [{ text: '📝 Solo Texto', callback_data: 'cms_type_text' }]
                        ]
                    }
                });
            }

            else if (data === 'cms_type_image' || data === 'cms_type_video' || data === 'cms_type_text') {
                let type = 'text';
                if (data === 'cms_type_image') type = 'image';
                if (data === 'cms_type_video') type = 'video';

                adminState[chatId].tempAnnouncement.mediaType = type;

                if (type === 'text') {
                    adminState[chatId].step = 'cms_await_title';
                    bot.sendMessage(chatId, '✅ Formato: Solo Texto.\n\n📝 Escribe el **TÍTULO** del anuncio:');
                } else {
                    adminState[chatId].step = 'cms_await_media_url';
                    const tipoMsg = type === 'video' ? 'del VIDEO (mp4, m3u8)' : 'de la IMAGEN';
                    bot.sendMessage(chatId, `✅ Formato: ${type.toUpperCase()}.\n\n🔗 Envía la **URL** directa ${tipoMsg}:`);
                }
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
                        actionUrl: announcement.actionUrl
                    };

                    if (announcement.mediaType === 'video') {
                        jsonToSave.videoUrl = announcement.mediaUrl;
                    } else if (announcement.mediaType === 'image') {
                        jsonToSave.imageUrl = announcement.mediaUrl;
                    }

                    fs.writeFileSync(filePath, JSON.stringify(jsonToSave, null, 2));

                    bot.sendMessage(chatId, '✅ **¡Comunicado Publicado Correctamente!**\n\nEl JSON ha sido generado con el formato que el Frontend espera.');
                    adminState[chatId] = { step: 'menu' };

                } catch (err) {
                    console.error("CMS Save Error:", err);
                    bot.sendMessage(chatId, '❌ Error al guardar el archivo JSON.');
                }
            }

            else if (data === 'cms_cancel') {
                adminState[chatId] = { step: 'menu' };
                bot.sendMessage(chatId, '❌ Operación cancelada.');
            }

            // -----------------------------------------------------------------
            // PREMIUM / MANUAL ACTIVATION
            // -----------------------------------------------------------------
            else if (data.startsWith('act_man_')) {
                const parts = data.split('_');
                const userId = parts[2];
                const daysToAdd = parseInt(parts[3], 10);

                bot.sendMessage(chatId, `⏳ Procesando activación para ID ${userId} por ${daysToAdd} días...`);

                try {
                    const userRef = db.collection('users').doc(userId);

                    await db.runTransaction(async (transaction) => {
                        const doc = await transaction.get(userRef);
                        const now = new Date();
                        let newExpiry;

                        if (doc.exists && doc.data().premiumExpiry) {
                            const currentExpiry = doc.data().premiumExpiry.toDate();
                            if (currentExpiry > now) {
                                newExpiry = new Date(currentExpiry.getTime() + (daysToAdd * 24 * 60 * 60 * 1000));
                            } else {
                                newExpiry = new Date(now.getTime() + (daysToAdd * 24 * 60 * 60 * 1000));
                            }
                        } else {
                            newExpiry = new Date(now.getTime() + (daysToAdd * 24 * 60 * 60 * 1000));
                        }

                        transaction.set(userRef, {
                            isPro: true,
                            premiumExpiry: newExpiry
                        }, { merge: true });
                    });

                    if (userCache) {
                        userCache.del(userId);
                        console.log(`[Bot] ✅ Caché de usuario ${userId} purgada tras activación manual.`);
                    }

                    bot.editMessageText(`✅ PREMIUM ACTIVADO\n👤 Usuario: ${userId}\n📅 Días: ${daysToAdd}\n⚡ Caché limpiada (Acceso inmediato)`, {
                        chat_id: chatId,
                        message_id: msg.message_id
                    });

                } catch (error) {
                    console.error("Error activando premium manual:", error);
                    bot.sendMessage(chatId, "❌ Error al actualizar la base de datos.");
                }
            }

            else if (data === 'ignore_payment_request') {
                try {
                    await bot.deleteMessage(chatId, msg.message_id);
                } catch (e) {
                    bot.sendMessage(chatId, "Solicitud descartada.");
                }
            }

            else if (data === 'send_global_msg') {
                adminState[chatId] = { step: 'awaiting_global_msg_text' };
                bot.sendMessage(chatId, "📝 Escribe el mensaje que deseas enviar a TODOS los usuarios (Notificación Push):");
            }

            else if (data === 'add_movie') {
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
                const parts = data.split('_');
                const filterType = parts[2];
                const page = parseInt(parts[3]) || 0;
                const PAGE_SIZE = 10;

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
                    bot.sendMessage(chatId, `🎬 Película: *${movieData.title}*\n🏷️ Géneros: ${genreIds.length}\n🌍 Países: ${countries.join(', ')}\n\n🔗 Envía el **ENLACE (Link)** del video.`, { parse_mode: 'Markdown' });
                } catch (error) {
                    console.error("Error al obtener detalles de TMDB:", error.message);
                    bot.sendMessage(chatId, 'Error al obtener los detalles de TMDB.');
                }
            }

            // =================================================================
            // NUEVO SISTEMA DE GUARDADO Y PUBLICACIÓN (PELÍCULAS)
            // =================================================================
            else if (data.startsWith('set_pinned_movie_')) {
                const isPinned = data === 'set_pinned_movie_true';
                if (!adminState[chatId].movieDataToSave) { bot.sendMessage(chatId, 'Error de estado.'); return; }

                adminState[chatId].movieDataToSave.isPinned = isPinned;
                const movieData = adminState[chatId].movieDataToSave;

                // 1. Guardar primero en MongoDB/Render para asegurar que existe
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                const savingMsg = await bot.sendMessage(chatId, `⏳ Guardando "${movieData.title}" en la App...`);

                try {
                    await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieData);
                    
                    // Actualizar mensaje y mostrar PANEL DE DIFUSIÓN
                    const pinnedStatus = isPinned ? "⭐ DESTACADO" : "📅 Normal";
                    
                    // Construir botones dinámicos para el Panel
                    let broadcastButtons = [
                        [{ text: '🚀 PUBLICAR EN TODOS (Cascada)', callback_data: `bdcast_all_movie_${movieData.tmdbId}` }],
                        [{ text: '📢 Publicar Solo en Canal Privado (A)', callback_data: `bdcast_only_a_movie_${movieData.tmdbId}` }]
                    ];

                    // Botones individuales para canales públicos (B-K) si están configurados
                    let publicButtons = [];
                    PUBLIC_CHANNEL_KEYS.forEach((key) => {
                        const channelId = process.env[key];
                        if (channelId) {
                            const label = key.replace('TELEGRAM_CHANNEL_', '').replace('_ID', ''); // "B", "C", etc.
                            publicButtons.push({ text: `Canal ${label}`, callback_data: `bdcast_single_${label}_movie_${movieData.tmdbId}` });
                        }
                    });

                    // Agrupar botones públicos en filas de 3
                    if (publicButtons.length > 0) {
                        while (publicButtons.length > 0) {
                            broadcastButtons.push(publicButtons.splice(0, 3));
                        }
                    }

                    broadcastButtons.push([{ text: '🏁 Finalizar (Solo Guardar)', callback_data: 'back_to_menu' }]);

                    bot.editMessageText(`✅ **GUARDADO EXITOSO**\nEstado: ${pinnedStatus}\n\n📡 **PANEL DE DIFUSIÓN**\n¿Dónde quieres publicar este contenido?`, {
                        chat_id: chatId,
                        message_id: savingMsg.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: broadcastButtons
                        }
                    });

                } catch (error) {
                    console.error("Error guardando movie:", error);
                    bot.sendMessage(chatId, "❌ Error al guardar en la base de datos.");
                    adminState[chatId] = { step: 'menu' };
                }
            }

            // =================================================================
            // NUEVO SISTEMA DE GUARDADO Y PUBLICACIÓN (SERIES)
            // =================================================================
            else if (data.startsWith('set_pinned_series_')) {
                const isPinned = data === 'set_pinned_series_true';
                if (!adminState[chatId].seriesDataToSave) { bot.sendMessage(chatId, 'Error de estado.'); return; }

                adminState[chatId].seriesDataToSave.isPinned = isPinned;
                const seriesData = adminState[chatId].seriesDataToSave;
                const season = adminState[chatId].season;
                const episode = adminState[chatId].episode;
                const totalEpisodesInSeason = adminState[chatId].totalEpisodesInSeason;

                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                const savingMsg = await bot.sendMessage(chatId, `⏳ Guardando S${season}E${episode} en la App...`);

                try {
                    await axios.post(`${RENDER_BACKEND_URL}/add-series-episode`, seriesData);

                    // Actualizar estado para "Siguiente Episodio"
                    adminState[chatId].lastSavedEpisodeData = seriesData;
                    
                    const isSeasonFinished = totalEpisodesInSeason && episode >= totalEpisodesInSeason;
                    const nextEpisode = episode + 1;

                    // Panel de Difusión para Series
                    let broadcastButtons = [
                        [{ text: '🚀 PUBLICAR EN TODOS (Cascada)', callback_data: `bdcast_all_series_${seriesData.tmdbId}_${season}_${episode}` }],
                        [{ text: '📢 Solo Canal Privado (A)', callback_data: `bdcast_only_a_series_${seriesData.tmdbId}_${season}_${episode}` }]
                    ];

                    let publicButtons = [];
                    PUBLIC_CHANNEL_KEYS.forEach((key) => {
                        const channelId = process.env[key];
                        if (channelId) {
                            const label = key.replace('TELEGRAM_CHANNEL_', '').replace('_ID', '');
                            publicButtons.push({ text: `Canal ${label}`, callback_data: `bdcast_single_${label}_series_${seriesData.tmdbId}_${season}_${episode}` });
                        }
                    });

                    if (publicButtons.length > 0) {
                        while (publicButtons.length > 0) {
                            broadcastButtons.push(publicButtons.splice(0, 3));
                        }
                    }

                    // Navegación de series
                    let navRow = [];
                    if (isSeasonFinished) {
                        const nextSeason = season + 1;
                        navRow.push({ text: `🎉 Fin T${season} -> T${nextSeason}`, callback_data: `manage_season_${seriesData.tmdbId}_${nextSeason}` });
                    } else {
                        navRow.push({ text: `➡️ Siguiente: S${season}E${nextEpisode}`, callback_data: `add_next_episode_${seriesData.tmdbId}_${season}` });
                    }
                    navRow.push({ text: '⏹️ Finalizar', callback_data: `finish_series_${seriesData.tmdbId}` });

                    broadcastButtons.push(navRow);

                    bot.editMessageText(`✅ **S${season}E${episode} GUARDADO**\n\n📡 **PANEL DE DIFUSIÓN**`, {
                        chat_id: chatId,
                        message_id: savingMsg.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: broadcastButtons
                        }
                    });

                } catch (error) {
                    console.error("Error guardando serie:", error);
                    bot.sendMessage(chatId, '❌ Error guardando en servidor.');
                }
            }

            // =================================================================
            // MANEJO DE DIFUSIÓN (BROADCAST HANDLERS)
            // =================================================================

            // 1. PUBLICAR EN TODOS (Cascada) - Películas
            else if (data.startsWith('bdcast_all_movie_')) {
                const tmdbId = data.split('_')[3];
                const { movieDataToSave } = adminState[chatId];
                
                if (!movieDataToSave || movieDataToSave.tmdbId !== tmdbId) {
                    bot.sendMessage(chatId, "⚠️ Datos perdidos. No se puede publicar.");
                    return;
                }

                bot.editMessageText(`🚀 Iniciando difusión masiva para: *${movieDataToSave.title}*...`, { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown' });

                // Notificación PUSH
                try {
                    await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                        title: "¡Nuevo Estreno!",
                        body: `Ya puedes ver: ${movieDataToSave.title}`,
                        imageUrl: movieDataToSave.poster_path ? `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}` : null,
                        tmdbId: movieDataToSave.tmdbId,
                        mediaType: 'movie'
                    });
                } catch(e) { console.error("Error Push:", e.message); }

                // Paso 1: Publicar en Canal Privado (A) y obtener LINK
                const CHANNEL_A = process.env.TELEGRAM_CHANNEL_A_ID;
                if (!CHANNEL_A) {
                    bot.sendMessage(chatId, "❌ Error: Canal A no configurado en .env");
                    return;
                }

                const deepLinkUrl = `${RENDER_BACKEND_URL}/view/movie/${tmdbId}`;
                const captionA = generatePrivateCaption(movieDataToSave, 'movie', deepLinkUrl);
                const posterUrl = movieDataToSave.poster_path ? `https://image.tmdb.org/t/p/w500${movieDataToSave.poster_path}` : 'https://placehold.co/500x750?text=SALA+CINE';

                let msgA;
                try {
                    msgA = await bot.sendPhoto(CHANNEL_A, posterUrl, { caption: captionA, parse_mode: 'Markdown' });
                } catch (e) {
                    bot.sendMessage(chatId, "❌ Error publicando en Canal A.");
                    return;
                }

                // Generar Link al Post de A (Requisito para botones de canales públicos)
                const channelUsername = CHANNEL_A.replace('@', '').replace('-100', ''); // Ajuste simple, mejor si es username público
                // Si es privado (-100...), el link es https://t.me/c/ID_SIN_-100/MSG_ID
                let linkToPostA = '';
                if (CHANNEL_A.startsWith('-100')) {
                    const cleanId = CHANNEL_A.substring(4);
                    linkToPostA = `https://t.me/c/${cleanId}/${msgA.message_id}`;
                } else {
                    linkToPostA = `https://t.me/${channelUsername}/${msgA.message_id}`;
                }

                // Paso 2: Cascada a Canales Públicos
                const captionPublic = generatePublicCaption(movieDataToSave, 'movie');
                
                for (const key of PUBLIC_CHANNEL_KEYS) {
                    const channelId = process.env[key];
                    if (channelId) {
                        const channelLabel = key.replace('TELEGRAM_CHANNEL_', '').replace('_ID', '');
                        await bot.editMessageText(`🚀 Publicando en Canal ${channelLabel}... (Espere 5s)`, { chat_id: chatId, message_id: msg.message_id });
                        
                        await sleep(5000); // Retraso Anti-Spam

                        try {
                            await bot.sendPhoto(channelId, posterUrl, {
                                caption: captionPublic,
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    inline_keyboard: [[{ text: '🎬 VER PELÍCULA COMPLETA AQUÍ', url: linkToPostA }]]
                                }
                            });
                        } catch (e) {
                            console.error(`Error publicando en ${key}:`, e.message);
                        }
                    }
                }

                bot.editMessageText(`✅ **DIFUSIÓN COMPLETADA**\nSe publicó en Canal A y todos los canales públicos configurados.`, { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown' });
                adminState[chatId] = { step: 'menu' };
            }

            // 2. PUBLICAR EN TODOS (Cascada) - Series
            else if (data.startsWith('bdcast_all_series_')) {
                const parts = data.split('_');
                const tmdbId = parts[3];
                const season = parts[4];
                const episode = parts[5];
                const seriesData = adminState[chatId].lastSavedEpisodeData;

                if (!seriesData) { bot.sendMessage(chatId, "Datos perdidos."); return; }

                bot.editMessageText(`🚀 Iniciando difusión masiva para: *${seriesData.title} S${season}E${episode}*...`, { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown' });

                // Push
                try {
                    await axios.post(`${RENDER_BACKEND_URL}/api/notify-new-content`, {
                        title: `¡Nuevo Episodio! ${seriesData.title}`,
                        body: `Ya disponible: S${seriesData.seasonNumber}E${seriesData.episodeNumber}`,
                        imageUrl: seriesData.poster_path ? `https://image.tmdb.org/t/p/w500${seriesData.poster_path}` : null,
                        tmdbId: seriesData.tmdbId,
                        mediaType: 'tv'
                    });
                } catch(e) {}

                // Canal A
                const CHANNEL_A = process.env.TELEGRAM_CHANNEL_A_ID;
                const deepLinkUrl = `${RENDER_BACKEND_URL}/view/tv/${tmdbId}`;
                const captionA = generatePrivateCaption(seriesData, 'tv', deepLinkUrl);
                const posterUrl = seriesData.poster_path ? `https://image.tmdb.org/t/p/w500${seriesData.poster_path}` : 'https://placehold.co/500x750?text=SALA+CINE';

                let msgA;
                try {
                    msgA = await bot.sendPhoto(CHANNEL_A, posterUrl, { caption: captionA, parse_mode: 'Markdown' });
                } catch (e) {
                    bot.sendMessage(chatId, "❌ Error en Canal A."); return;
                }

                // Link al Post
                let linkToPostA = '';
                if (CHANNEL_A.startsWith('-100')) {
                    const cleanId = CHANNEL_A.substring(4);
                    linkToPostA = `https://t.me/c/${cleanId}/${msgA.message_id}`;
                } else {
                    linkToPostA = `https://t.me/${CHANNEL_A.replace('@','')}/${msgA.message_id}`;
                }

                // Cascada
                const captionPublic = generatePublicCaption(seriesData, 'tv');
                for (const key of PUBLIC_CHANNEL_KEYS) {
                    const channelId = process.env[key];
                    if (channelId) {
                        const channelLabel = key.replace('TELEGRAM_CHANNEL_', '').replace('_ID', '');
                        await bot.editMessageText(`🚀 Publicando en Canal ${channelLabel}... (Espere 5s)`, { chat_id: chatId, message_id: msg.message_id });
                        await sleep(5000);
                        try {
                            await bot.sendPhoto(channelId, posterUrl, {
                                caption: captionPublic,
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    inline_keyboard: [[{ text: '📺 VER EPISODIO COMPLETO AQUÍ', url: linkToPostA }]]
                                }
                            });
                        } catch (e) {}
                    }
                }
                bot.editMessageText(`✅ **DIFUSIÓN COMPLETADA (S${season}E${episode})**`, { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown' });
            }

            // 3. SOLO CANAL A (Manual)
            else if (data.startsWith('bdcast_only_a_')) {
                const type = data.includes('_movie_') ? 'movie' : 'series';
                const CHANNEL_A = process.env.TELEGRAM_CHANNEL_A_ID;
                
                let mediaData;
                let deepLinkUrl;

                if (type === 'movie') {
                    mediaData = adminState[chatId].movieDataToSave;
                    deepLinkUrl = `${RENDER_BACKEND_URL}/view/movie/${mediaData.tmdbId}`;
                } else {
                    mediaData = adminState[chatId].lastSavedEpisodeData;
                    deepLinkUrl = `${RENDER_BACKEND_URL}/view/tv/${mediaData.tmdbId}`;
                }

                const caption = generatePrivateCaption(mediaData, type, deepLinkUrl);
                const posterUrl = mediaData.poster_path ? `https://image.tmdb.org/t/p/w500${mediaData.poster_path}` : 'https://placehold.co/500x750?text=SALA+CINE';

                await bot.sendPhoto(CHANNEL_A, posterUrl, { caption: caption, parse_mode: 'Markdown' });
                bot.sendMessage(chatId, `✅ Publicado en Canal Privado (A).`);
            }

            // 4. CANAL INDIVIDUAL (Manual - Requiere enlace a A, si no existe A, enviamos a App)
            else if (data.startsWith('bdcast_single_')) {
                // Formato: bdcast_single_B_movie_12345
                const parts = data.split('_');
                const channelLabel = parts[2]; // B, C...
                const type = parts[3]; // movie / series
                // const tmdbId = parts[4];

                const key = `TELEGRAM_CHANNEL_${channelLabel}_ID`;
                const channelId = process.env[key];

                if (!channelId) { bot.sendMessage(chatId, "Canal no configurado."); return; }

                let mediaData = type === 'movie' ? adminState[chatId].movieDataToSave : adminState[chatId].lastSavedEpisodeData;
                const captionPublic = generatePublicCaption(mediaData, type);
                const posterUrl = mediaData.poster_path ? `https://image.tmdb.org/t/p/w500${mediaData.poster_path}` : 'https://placehold.co/500x750?text=SALA+CINE';

                // NOTA: Al enviar individualmente a un canal público sin haber pasado por el proceso "Todo",
                // no tenemos el ID del mensaje de A. Por seguridad, mandaremos al DeepLink de la App directamente
                // o advertiremos. Para simplificar, mandaremos a la App Bridge Page.
                const deepLinkUrl = type === 'movie' ? `${RENDER_BACKEND_URL}/view/movie/${mediaData.tmdbId}` : `${RENDER_BACKEND_URL}/view/tv/${mediaData.tmdbId}`;

                await bot.sendPhoto(channelId, posterUrl, {
                    caption: captionPublic,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[{ text: '📺 VER EN LA APP', url: deepLinkUrl }]]
                    }
                });
                bot.sendMessage(chatId, `✅ Publicado en Canal ${channelLabel}.`);
            }


            // =================================================================
            // FIN DE LÓGICA DE PUBLICACIÓN
            // =================================================================

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

                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => { });
                bot.sendMessage(chatId, `Gestionando *S${seasonNumber}* de *${selectedSeries.name}*.\nAgregando episodio *E${nextEpisode}*.\n\n🔗 Envía el **ENLACE** del video.`, { parse_mode: 'Markdown' });
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

                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
                bot.sendMessage(chatId, `Siguiente: Envía **ENLACE** para S${seasonNumber}E${nextEpisode}.`);
            }

            else if (data.startsWith('delete_episode_')) {
                const [_, __, tmdbId, season, episode] = data.split('_');
                try {
                    await axios.post(`${RENDER_BACKEND_URL}/delete-series-episode`, {
                        tmdbId, seasonNumber: parseInt(season), episodeNumber: parseInt(episode)
                    });
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
                bot.sendMessage(chatId, `✏️ Corrección: Envía el NUEVO enlace para **S${season}E${episode}**:`);
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
                    } else {
                        console.log("[Bot] Warning: pinnedCache no está disponible.");
                    }

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
                    isPro: isPro
                };
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => { });
                bot.sendMessage(chatId, `✏️ Editando enlace para ID: ${tmdbId}.\n\n🔗 Envía el nuevo enlace ahora:`);
            }

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
            else if (data.startsWith('finish_series_')) {
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id }).catch(() => { });
                bot.sendMessage(chatId, '✅ Proceso finalizado. Volviendo al menú.');
                adminState[chatId] = { step: 'menu' };
            }
            else if (data === 'back_to_menu') {
                adminState[chatId] = { step: 'menu' };
                bot.sendMessage(chatId, '🔙 Menú Principal.');
            }

        } catch (error) {
            console.error("Error en callback_query:", error);
            bot.sendMessage(chatId, '❌ Ocurrió un error procesando tu solicitud.');
        }
    });

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
                    console.warn(`[Auto-Aceptar] No se pudo enviar DM al admin ${adminUserId}.`);
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
                    console.warn(`[Auto-Aceptar] No se pudo enviar DM con foto a ${userId}.`);
                });
            } else {
                bot.sendMessage(userId, welcomeMessage, {
                    parse_mode: 'Markdown',
                    reply_markup: options.reply_markup
                }).catch(e => {
                    console.warn(`[Auto-Aceptar] No se pudo enviar DM de bienvenida a ${userId}.`);
                });
            }

        } catch (error) {
            console.error(`[Auto-Aceptar] Error al procesar solicitud de ${userFirstName} en ${chatId}:`, error.message);
        }
    });

    async function handleManageSeries(chatId, tmdbId) {
        try {
            const seriesUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
            const response = await axios.get(seriesUrl);
            const seriesData = response.data;
            if (!seriesData || !seriesData.seasons) {
                bot.sendMessage(chatId, 'Error: No se encontraron detalles o temporadas para esa serie.');
                return;
            }

            const genreIds = seriesData.genres ? seriesData.genres.map(g => g.id) : [];
            const originCountries = seriesData.origin_country || [];

            adminState[chatId] = {
                ...adminState[chatId],
                selectedSeries: {
                    id: seriesData.id,
                    tmdbId: seriesData.id.toString(),
                    name: seriesData.name,
                    title: seriesData.name,
                    overview: seriesData.overview,
                    poster_path: seriesData.poster_path,
                    backdrop_path: seriesData.backdrop_path,
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
