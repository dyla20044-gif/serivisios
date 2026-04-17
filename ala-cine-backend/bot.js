const fs = require('fs');
const path = require('path');
const initializePublicAds = require('./publicAds');

function initializeBot(bot, db, mongoDb, adminState, ADMIN_CHAT_IDS, TMDB_API_KEY, RENDER_BACKEND_URL, axios, pinnedCache, sendNotificationToTopic, userCache) {
    // Pasamos el administrador principal a los anuncios para no romper ese módulo
    initializePublicAds(bot, mongoDb, ADMIN_CHAT_IDS[0]);

    bot.setMyCommands([
        { command: 'start', description: 'Reiniciar el bot y ver el menú principal' },
        { command: 'subir', description: 'Subir una película o serie a la base de datos' },
        { command: 'editar', description: 'Editar los enlaces de una película o serie existente' },
        { command: 'pedidos', description: 'Ver la lista de películas solicitadas por los usuarios' }
    ]);

    // Función auxiliar para generar el menú principal
    function getMainMenuKeyboard(chatId) {
        const inline_keyboard = [
            [
                { text: '🎬 Agregar películas', callback_data: 'add_movie' },
                { text: '📺 Agregar series', callback_data: 'add_series' }
            ],
            [{ text: '📁 Subida Manual (Propio)', callback_data: 'add_manual_movie' }],
            [{ text: '🔔 Ver Pedidos', callback_data: 'view_requests_menu' }],
            [{ text: '💰 Mis Ganancias', callback_data: 'view_earnings' }]
        ];

        // Lógica Super-Admin
        if (chatId === ADMIN_CHAT_IDS[0]) {
            if (ADMIN_CHAT_IDS.length > 1) {
                inline_keyboard.push([{ text: '📊 Ver Ganancias Admin 2', callback_data: 'view_admin2_earnings' }]);
            }
            // NUEVO BOTÓN: Gestionar Saldo (Bonos)
            inline_keyboard.push([{ text: '💰 Gestionar Saldo (Bonos)', callback_data: 'manage_bonus_menu' }]);
        }

        inline_keyboard.push(
            [{ text: '📡 Gestionar Comunicados (App)', callback_data: 'cms_announcement_menu' }],
            [{ text: '📢 Enviar Notificación Global', callback_data: 'send_global_msg' }],
            [{ text: '🗑️ Eliminar película/serie', callback_data: 'delete_movie' }]
        );
        
        return inline_keyboard;
    }

    bot.onText(/\/start|\/subir/, (msg) => {
        const chatId = msg.chat.id;
        if (!ADMIN_CHAT_IDS.includes(chatId)) {
            return;
        }
        adminState[chatId] = { step: 'menu' };
        
        const inline_keyboard = getMainMenuKeyboard(chatId);
        const options = { reply_markup: { inline_keyboard } };
        bot.sendMessage(chatId, `¡Hola ${msg.from.first_name || 'Admin'}! ¿Qué quieres hacer hoy?`, options);
    });

    // Función auxiliar para renderizar el panel de ganancias
    async function showEarningsPanel(targetUploaderId, uploaderName, requestChatId) {
        bot.sendMessage(requestChatId, '⏳ Calculando estadísticas financieras...');
                
        const now = new Date();
        const dayId = now.toISOString().split('T')[0];
        const monthId = dayId.substring(0, 7);

        try {
            const historicalStats = await mongoDb.collection('uploader_revenue').aggregate([
                { $match: { uploaderId: targetUploaderId } },
                { $group: {
                    _id: null,
                    totalEarned: { $sum: "$earned" },
                    totalMovies: { $sum: { $cond: [{ $eq: ["$mediaType", "movie"] }, 1, 0] } },
                    totalEpisodes: { $sum: { $cond: [{ $eq: ["$mediaType", "tv"] }, 1, 0] } },
                    bonusTotal: { $sum: { $cond: [{ $eq: ["$mediaType", "bonus"] }, "$earned", 0] } }
                }}
            ]).toArray();

            const hist = historicalStats[0] || { totalEarned: 0, totalMovies: 0, totalEpisodes: 0, bonusTotal: 0 };

            const todayStats = await mongoDb.collection('uploader_daily_stats').findOne({ uploaderId: targetUploaderId, dayId });
            const todayEarned = todayStats?.today_earned || 0;

            const monthlyDocs = await mongoDb.collection('uploader_daily_stats')
                .find({ uploaderId: targetUploaderId, monthId })
                .toArray();
            const monthEarned = monthlyDocs.reduce((sum, doc) => sum + (doc.today_earned || 0), 0);

            const msgEarnings = `📊 *REPORTE FINANCIERO UPLOADER* 📊\n` +
                                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                                `👤 *Usuario:* \`${uploaderName}\`\n` +
                                `🆔 *ID:* \`${targetUploaderId}\`\n\n` +
                                `💰 *INGRESOS ACTUALES*\n` +
                                `├ 💵 *Hoy:* $${todayEarned.toFixed(2)} USD\n` +
                                `└ 📅 *Este Mes:* $${monthEarned.toFixed(2)} USD\n\n` +
                                `📈 *ESTADÍSTICAS HISTÓRICAS*\n` +
                                `├ 🏆 *Total Generado:* $${hist.totalEarned.toFixed(2)} USD\n` +
                                `├ 🎁 *Bonos Recibidos:* $${(hist.bonusTotal || 0).toFixed(2)} USD\n` +
                                `├ 🎬 *Películas Subidas:* ${hist.totalMovies}\n` +
                                `└ 📺 *Episodios Subidos:* ${hist.totalEpisodes}\n\n` +
                                `🚀 *LÍMITES DE CUENTA*\n` +
                                `├ ⏱️ *Diario:* $10.00 USD\n` +
                                `└ 🗓️ *Mensual:* $200.00 USD\n` +
                                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                                `💳 *INFORMACIÓN DE PAGOS:*\n` +
                                `Las fechas de corte son del *21 al 25* de cada mes.\n` +
                                `👉 Solicita tu retiro con: @Dylan_1m_oficial`;

            const bannerUrl = 'https://i.ibb.co/Nd24c62C/Gemini-Generated-Image-49psui49psui49ps-Photoroom.png'; 

            bot.sendPhoto(requestChatId, bannerUrl, { 
                caption: msgEarnings, 
                parse_mode: 'Markdown' 
            }).catch(e => {
                bot.sendMessage(requestChatId, msgEarnings, { parse_mode: 'Markdown' });
            });

        } catch (error) {
            console.error("Error al consultar ganancias desde bot.js:", error);
            bot.sendMessage(requestChatId, '❌ Ocurrió un error al consultar la base de datos de ganancias.');
        }
    }

    // Función auxiliar para enviar el Resumen Final Elegante (MODIFICADA PARA CARGA CONTINUA)
    async function sendFinalSummary(chatId, title, isMovie = true, promptMsgId = null) {
        try {
            const now = new Date();
            const dayId = now.toISOString().split('T')[0];
            const todayStats = await mongoDb.collection('uploader_daily_stats').findOne({ uploaderId: chatId, dayId });
            const todayEarned = todayStats?.today_earned || 0;

            const icon = isMovie ? '🎬' : '📺';
            const typeText = isMovie ? 'Película' : 'Episodio';

            const summaryText = `✅ **¡SUBIDA EXITOSA!** ✅\n` +
                                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                                `${icon} *${typeText}:* ${title}\n` +
                                `✨ *Estado:* ¡Ya está disponible en la app!\n` +
                                `💰 *Ganancia registrada:* (Actualizada por servidor)\n` +
                                `💵 *Saldo Total de Hoy:* $${todayEarned.toFixed(2)} USD\n` +
                                `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                `¿Qué deseas subir ahora?`;

            const continuousKeyboard = isMovie ? [
                [{ text: '🎬 Subir otra Película', callback_data: 'add_movie' }],
                [{ text: '📺 Subir una Serie', callback_data: 'add_series' }]
            ] : [
                [{ text: '📺 Subir otra Serie', callback_data: 'add_series' }],
                [{ text: '🎬 Subir una Película', callback_data: 'add_movie' }]
            ];

            const options = {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: continuousKeyboard
                }
            };

            if (promptMsgId) {
                await bot.editMessageText(summaryText, { chat_id: chatId, message_id: promptMsgId, ...options }).catch(async () => {
                    await bot.sendMessage(chatId, summaryText, options);
                });
            } else {
                await bot.sendMessage(chatId, summaryText, options);
            }
        } catch (err) {
            console.error("Error al enviar resumen final:", err);
            const fallbackKeyboard = isMovie ? [
                [{ text: '🎬 Subir otra Película', callback_data: 'add_movie' }],
                [{ text: '📺 Subir una Serie', callback_data: 'add_series' }]
            ] : [
                [{ text: '📺 Subir otra Serie', callback_data: 'add_series' }],
                [{ text: '🎬 Subir una Película', callback_data: 'add_movie' }]
            ];
            bot.sendMessage(chatId, `✅ **¡SUBIDA EXITOSA!**\n\n${title} ya está disponible en la app.\n\n¿Qué deseas subir ahora?`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: fallbackKeyboard } });
        }
    }

    bot.on('message', async (msg) => {
        const hasLinks = msg.entities && msg.entities.some(
            e => e.type === 'url' || e.type === 'text_link' || e.type === 'mention'
        );
        const isNotAdmin = !ADMIN_CHAT_IDS.includes(msg.from.id);

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

            if (!ADMIN_CHAT_IDS.includes(chatId)) {
                if (command === '/start' || command === '/ayuda') {
                    const helpMessage = `👋 ¡Hola! Bienvenido al bot oficial.\n\n🤖 **Gestión de Accesos:**\nSi enviaste una solicitud para unirte a nuestros canales privados, este bot te aceptará automáticamente en breve.\n\n📢 **Servicio de Publicidad:**\nSi eres creador de contenido o tienes un negocio, puedes pautar con nosotros y llegar a más de 300,000 personas en nuestra red de canales.`;
                    
                    bot.sendMessage(chatId, helpMessage, { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '📢 Panel de Publicidad', callback_data: 'ads_open_dashboard' }],
                                [{ text: '📞 Contactar Soporte', callback_data: 'public_contact' }]
                            ]
                        }
                    });
                    return;
                }

                if (command === '/contacto') {
                    bot.sendMessage(chatId, 'Para soporte o dudas, puedes contactar al desarrollador en: @TuUsuarioDeTelegram');
                    return;
                }
            }
        }

        if (!ADMIN_CHAT_IDS.includes(chatId)) {
            if (userText.startsWith('/')) {
                bot.sendMessage(chatId, 'Lo siento, no tienes permiso para usar este comando.');
            }
            return;
        }

        if (userText.startsWith('/')) {
            return;
        }

        // --- MANEJO DE BONOS (Super Admin) ---
        if (adminState[chatId] && adminState[chatId].step === 'awaiting_bonus_user_id') {
            const targetId = parseInt(userText.trim());
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            
            if (isNaN(targetId)) {
                if (adminState[chatId].promptMessageId) {
                    bot.editMessageText('❌ ID inválido. Debe ser un número numérico.\n\nEscribe de nuevo el ID del editor:', { chat_id: chatId, message_id: adminState[chatId].promptMessageId });
                } else {
                    bot.sendMessage(chatId, '❌ ID inválido. Debe ser un número.');
                }
                return;
            }
            adminState[chatId].bonusTargetId = targetId;
            adminState[chatId].step = 'awaiting_bonus_amount';
            
            if (adminState[chatId].promptMessageId) {
                bot.editMessageText(`✅ ID Guardado: \`${targetId}\`\n\n💵 Ahora escribe la **CANTIDAD** a sumar (Ejemplo: 5.50):`, { chat_id: chatId, message_id: adminState[chatId].promptMessageId, parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, `✅ ID Guardado: ${targetId}\n\n💵 Ahora escribe la **CANTIDAD** a sumar (ej. 5.50):`);
            }
            return;
        }
        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_bonus_amount') {
            const amountText = userText.trim().replace(',', '.');
            const amount = parseFloat(amountText);
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});

            if (isNaN(amount) || amount <= 0) {
                if (adminState[chatId].promptMessageId) {
                    bot.editMessageText('❌ Cantidad inválida. Intenta de nuevo.\n\nEscribe la CANTIDAD a sumar:', { chat_id: chatId, message_id: adminState[chatId].promptMessageId });
                }
                return;
            }
            const targetId = adminState[chatId].bonusTargetId;

            try {
                // Actualizar totalRevenue y currentBalance como solicitado + loguear como 'bonus'
                await mongoDb.collection('uploader_revenue').updateOne(
                    { uploaderId: targetId },
                    { $inc: { totalRevenue: amount, currentBalance: amount } },
                    { upsert: true }
                );

                await mongoDb.collection('uploader_revenue').insertOne({
                    uploaderId: targetId,
                    mediaType: 'bonus',
                    earned: amount,
                    createdAt: new Date()
                });

                const successMsg = `🎉 ✅ Bono de **$${amount.toFixed(2)} USD** añadido correctamente al usuario \`${targetId}\`.`;
                
                if (adminState[chatId].promptMessageId) {
                    bot.editMessageText(successMsg, { chat_id: chatId, message_id: adminState[chatId].promptMessageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🏠 Menú Principal', callback_data: 'back_to_menu' }]] } });
                } else {
                    bot.sendMessage(chatId, successMsg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🏠 Menú Principal', callback_data: 'back_to_menu' }]] } });
                }

                // Notificar al usuario editor
                bot.sendMessage(targetId, `🎉 **¡Felicidades!** Has recibido un bono manual de administrador por **$${amount.toFixed(2)} USD** que ha sido sumado a tu saldo. ¡Buen trabajo!`, { parse_mode: 'Markdown' }).catch(e => console.log('No se pudo notificar al usuario del bono.'));

            } catch (err) {
                console.error("Error añadiendo bono:", err);
                bot.sendMessage(chatId, '❌ Ocurrió un error al añadir el bono.');
            } finally {
                adminState[chatId] = { step: 'menu' };
            }
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
                
                adminState[chatId].step = 'cms_await_visibility';

                bot.sendMessage(chatId, '✅ URL de Acción Guardada.\n\n⚠️ **¿Este anuncio es Importante (Ignorar Caché)?**\nSi eliges "Sí", se forzará a la App a mostrarlo como nuevo, ignorando su caché interna.', {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Sí, mostrar siempre', callback_data: 'cms_vis_true' }],
                            [{ text: 'No, anuncio normal', callback_data: 'cms_vis_false' }]
                        ]
                    }
                });
            }
        }

        else if (adminState[chatId] && adminState[chatId].step === 'manual_await_title') {
            adminState[chatId].manualData.title = userText;
            adminState[chatId].step = 'manual_await_overview';
            bot.sendMessage(chatId, '✅ Título Guardado.\n\n📝 Ahora escribe la **SINOPSIS** (Descripción):');
        }
        else if (adminState[chatId] && adminState[chatId].step === 'manual_await_overview') {
            adminState[chatId].manualData.overview = userText;
            adminState[chatId].step = 'manual_await_poster';
            bot.sendMessage(chatId, '✅ Sinopsis Guardada.\n\n🖼️ Envía la **URL de la imagen PORTADA** (Poster Vertical):');
        }
        else if (adminState[chatId] && adminState[chatId].step === 'manual_await_poster') {
            if (!userText.startsWith('http')) {
                bot.sendMessage(chatId, '❌ Por favor envía una URL válida (empieza con http).');
                return;
            }
            adminState[chatId].manualData.poster_path = userText;
            adminState[chatId].step = 'manual_await_backdrop';
            bot.sendMessage(chatId, '✅ Portada Guardada.\n\n🖼️ Envía la **URL de la imagen BANNER** (Backdrop Horizontal):');
        }
        else if (adminState[chatId] && adminState[chatId].step === 'manual_await_backdrop') {
            if (!userText.startsWith('http')) {
                bot.sendMessage(chatId, '❌ Por favor envía una URL válida (empieza con http).');
                return;
            }
            adminState[chatId].manualData.backdrop_path = userText;
            adminState[chatId].step = 'manual_await_video_link';
            bot.sendMessage(chatId, '✅ Banner Guardado.\n\n🔗 Envía el **ENLACE (URL)** del video:');
        }
        else if (adminState[chatId] && adminState[chatId].step === 'manual_await_video_link') {
            if (!userText.startsWith('http')) {
                bot.sendMessage(chatId, '❌ Por favor envía una URL válida (empieza con http).');
                return;
            }
            const videoUrl = userText;
            const generatedId = "manual_" + Date.now();
            const today = new Date().toISOString().split('T')[0];

            adminState[chatId].movieDataToSave = {
                tmdbId: generatedId,
                title: adminState[chatId].manualData.title,
                overview: adminState[chatId].manualData.overview,
                poster_path: adminState[chatId].manualData.poster_path,
                backdrop_path: adminState[chatId].manualData.backdrop_path,
                proEmbedCode: videoUrl,
                freeEmbedCode: videoUrl,
                links: [videoUrl],
                isPremium: false,
                genres: [], 
                release_date: today,
                popularity: 100,
                vote_average: 10,
                origin_country: ["LOCAL"],
                isPinned: false,
                uploaderId: chatId 
            };

            adminState[chatId].step = 'awaiting_pinned_choice_movie';

            bot.sendMessage(chatId, `✅ Enlace guardado correctamente.\n\n⭐ **¿Deseas FIJAR este contenido en DESTACADOS (Top)?**`, {
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

        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_global_msg_title') {
            const titleInput = userText;
            adminState[chatId].tempGlobalTitle = titleInput;
            adminState[chatId].step = 'awaiting_global_msg_body';
            
            bot.sendMessage(chatId, `✅ Título: *${titleInput}*\n\n📝 Ahora escribe el **MENSAJE (Cuerpo)** de la notificación:`, { parse_mode: 'Markdown' });
        }

        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_global_msg_body') {
            const messageBody = userText;
            const titleToSend = adminState[chatId].tempGlobalTitle || "Aviso Importante";

            bot.sendMessage(chatId, '🚀 Enviando notificación a TODOS los usuarios...');

            try {
                const result = await sendNotificationToTopic(
                    titleToSend,
                    messageBody,
                    null,
                    '0',
                    'general',
                    'new_content'
                );

                if (result.success) {
                    bot.sendMessage(chatId, `✅ **Notificación enviada con éxito.**\n\n📢 Título: ${titleToSend}\n📝 Msj: ${messageBody}`, { parse_mode: 'Markdown' });
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
                let queryText = userText.trim();
                let yearFilter = "";
                
                const yearMatch = queryText.match(/(.+?)\s+(\d{4})$/);
                
                if (yearMatch) {
                    queryText = yearMatch[1]; 
                    yearFilter = `&year=${yearMatch[2]}`; 
                    bot.sendMessage(chatId, `🔍 Buscando: "${queryText}" del año ${yearMatch[2]}...`);
                }

                const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(queryText)}&language=es-ES${yearFilter}`;
                
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

                        let overview = item.overview || 'Sin sinopsis disponible.';
                        if (overview.length > 800) {
                            overview = overview.substring(0, 800) + '...';
                        }

                        const message = `🎬 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${overview}`;
                        let buttons = [[{ text: existingData ? '✅ Gestionar' : '✅ Agregar', callback_data: `${existingData ? 'manage_movie' : 'add_new_movie'}_${item.id}` }]];
                        const options = { caption: message, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } };
                        bot.sendPhoto(chatId, posterUrl, options);
                    }
                } else { bot.sendMessage(chatId, `No se encontraron resultados para "${queryText}" ${yearFilter ? 'en ese año' : ''}.`); }
            } catch (error) { console.error("Error buscando en TMDB (movie):", error); bot.sendMessage(chatId, 'Error buscando. Intenta de nuevo.'); }

        } 
        else if (adminState[chatId] && adminState[chatId].step === 'search_series') {
            try {
                let queryText = userText.trim();
                let yearFilter = "";

                const yearMatch = queryText.match(/(.+?)\s+(\d{4})$/);

                if (yearMatch) {
                    queryText = yearMatch[1];
                    yearFilter = `&first_air_date_year=${yearMatch[2]}`;
                    bot.sendMessage(chatId, `🔍 Buscando serie: "${queryText}" del año ${yearMatch[2]}...`);
                }

                const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(queryText)}&language=es-ES${yearFilter}`;
                
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

                        let overview = item.overview || 'Sin sinopsis disponible.';
                        if (overview.length > 800) {
                            overview = overview.substring(0, 800) + '...';
                        }

                        const message = `🎬 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${overview}`;
                        let buttons = [[{ text: existingData ? '✅ Gestionar' : '✅ Agregar', callback_data: `${existingData ? 'manage_series' : 'add_new_series'}_${item.id}` }]];
                        const options = { caption: message, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } };
                        bot.sendPhoto(chatId, posterUrl, options);
                    }
                } else { bot.sendMessage(chatId, `No se encontraron resultados para "${queryText}" ${yearFilter ? 'en ese año' : ''}.`); }
            } catch (error) { console.error("Error buscando en TMDB (series):", error); bot.sendMessage(chatId, 'Error buscando. Intenta de nuevo.'); }

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

                        let overview = item.overview || 'Sin sinopsis.';
                        if (overview.length > 800) {
                            overview = overview.substring(0, 800) + '...';
                        }

                        const message = `🎬 *${title}* (${date ? date.substring(0, 4) : 'N/A'})\n\n${overview}`;
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

        // --- OPTIMIZACIÓN DE INTERFAZ (Bloque Único) ---
        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_unified_link_movie') {
            const { selectedMedia } = adminState[chatId];
            if (!selectedMedia?.id) {
                bot.sendMessage(chatId, 'Error: Se perdieron los datos de la película.');
                adminState[chatId] = { step: 'menu' };
                return;
            }
            
            const linkInput = userText.trim();
            bot.deleteMessage(chatId, msg.message_id).catch(() => {}); // Borrar el link enviado por el usuario para no hacer spam

            const finalLink = linkInput.toLowerCase() === 'no' ? null : linkInput;

            if (!finalLink) {
                if (adminState[chatId].promptMessageId) {
                    bot.editMessageText('❌ Debes enviar al menos un enlace válido. Escribe el enlace.', { chat_id: chatId, message_id: adminState[chatId].promptMessageId });
                } else {
                    bot.sendMessage(chatId, '❌ Debes enviar al menos un enlace válido. Escribe el enlace.');
                }
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
                isPinned: false,
                uploaderId: chatId 
            };

            adminState[chatId].step = 'awaiting_pinned_choice_movie';

            const pinnedOptions = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '⭐ Sí, Destacar (Top)', callback_data: 'set_pinned_movie_true' },
                            { text: '📅 No, Normal', callback_data: 'set_pinned_movie_false' }
                        ]
                    ]
                }
            };

            if (adminState[chatId].promptMessageId) {
                bot.editMessageText(`✅ Enlace recibido correctamente.\n\n⭐ **¿Deseas FIJAR esta película en DESTACADOS (Top)?**`, {
                    chat_id: chatId,
                    message_id: adminState[chatId].promptMessageId,
                    ...pinnedOptions
                }).catch(() => {
                    bot.sendMessage(chatId, `✅ Enlace recibido.\n\n⭐ **¿Deseas FIJAR esta película en DESTACADOS (Top)?**`, pinnedOptions);
                });
            } else {
                bot.sendMessage(chatId, `✅ Enlace recibido.\n\n⭐ **¿Deseas FIJAR esta película en DESTACADOS (Top)?**`, pinnedOptions);
            }
        }

        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_unified_link_series') {
            const { selectedSeries, season, episode, totalEpisodesInSeason } = adminState[chatId];
            if (!selectedSeries) {
                bot.sendMessage(chatId, 'Error: Se perdieron los datos de la serie.');
                adminState[chatId] = { step: 'menu' };
                return;
            }

            const linkInput = userText.trim();
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});

            const finalLink = linkInput.toLowerCase() === 'no' ? null : linkInput;

            if (!finalLink) {
                if (adminState[chatId].promptMessageId) {
                    bot.editMessageText('❌ Debes enviar un enlace válido.', { chat_id: chatId, message_id: adminState[chatId].promptMessageId });
                }
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
                isPinned: false,
                uploaderId: chatId 
            };

            adminState[chatId].step = 'awaiting_pinned_choice_series';

            const pinnedOptions = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '⭐ Sí, Destacar', callback_data: 'set_pinned_series_true' },
                            { text: '📅 No, Normal', callback_data: 'set_pinned_series_false' }
                        ]
                    ]
                }
            };

            if (adminState[chatId].promptMessageId) {
                bot.editMessageText(`✅ Enlace recibido para S${season}E${episode}.\n\n⭐ **¿Deseas FIJAR esta serie en DESTACADOS (Top)?**`, {
                    chat_id: chatId,
                    message_id: adminState[chatId].promptMessageId,
                    ...pinnedOptions
                }).catch(() => {
                    bot.sendMessage(chatId, `✅ Enlace recibido para S${season}E${episode}.\n\n⭐ **¿Deseas FIJAR esta serie en DESTACADOS (Top)?**`, pinnedOptions);
                });
            } else {
                bot.sendMessage(chatId, `✅ Enlace recibido para S${season}E${episode}.\n\n⭐ **¿Deseas FIJAR esta serie en DESTACADOS (Top)?**`, pinnedOptions);
            }
        }

        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_edit_movie_link') {
            const { tmdbId, isPro } = adminState[chatId];
            const linkInput = userText.trim();
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});

            if (!linkInput) { 
                if (adminState[chatId].promptMessageId) bot.editMessageText('❌ Enlace inválido.', {chat_id: chatId, message_id: adminState[chatId].promptMessageId});
                return; 
            }

            const movieDataToUpdate = {
                tmdbId: tmdbId,
                proEmbedCode: linkInput,
                freeEmbedCode: linkInput,
                isPremium: false
            };

            try {
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToUpdate);
                if (adminState[chatId].promptMessageId) {
                    bot.editMessageText(`✅ Enlace actualizado correctamente para ID ${tmdbId}.`, { chat_id: chatId, message_id: adminState[chatId].promptMessageId });
                } else {
                    bot.sendMessage(chatId, `✅ Enlace actualizado correctamente para ID ${tmdbId}.`);
                }
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

            if (data && data.startsWith('ads_')) return;

            if (!ADMIN_CHAT_IDS.includes(chatId)) {
                bot.answerCallbackQuery(callbackQuery.id, { text: 'No tienes permiso.', show_alert: true });
                return;
            }

            bot.answerCallbackQuery(callbackQuery.id);

            // --- VOLVER AL MENÚ PRINCIPAL ---
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

            // --- GESTIÓN DE BONOS MANUALES ---
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

            // --- LÓGICA DE GANANCIAS ---
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
                    
                    // Borramos el markup anterior
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

            // --- FLUJOS DE GUARDADO Y PUBLICACIÓN CON RESUMEN ---
            else if (data.startsWith('save_only_')) {
                bot.editMessageText('⏳ Guardando datos en el servidor...', { chat_id: chatId, message_id: msg.message_id }).catch(()=>{});
                const { movieDataToSave } = adminState[chatId];
                if (!movieDataToSave?.tmdbId) { bot.sendMessage(chatId, 'Error: Datos perdidos.'); adminState[chatId] = { step: 'menu' }; return; }
                await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
                await sendFinalSummary(chatId, movieDataToSave.title, true, msg.message_id);
                // El adminState se dejará tal cual. Al pulsar "add_movie" o "add_series" en el summary, se sobrescribirá de todas formas.
            }

            else if (data.startsWith('save_silent_hidden_')) {
                bot.editMessageText('⏳ Guardando en modo silencioso...', { chat_id: chatId, message_id: msg.message_id }).catch(()=>{});
                const { movieDataToSave } = adminState[chatId];
                if (!movieDataToSave?.tmdbId) { bot.sendMessage(chatId, 'Error: Datos perdidos.'); adminState[chatId] = { step: 'menu' }; return; }
                movieDataToSave.hideFromRecent = true;
                try {
                    await axios.post(`${RENDER_BACKEND_URL}/add-movie`, movieDataToSave);
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
            
            // MODIFICADO PARA LA CARGA CONTINUA AL FINALIZAR UNA SERIE
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
                // Lo devolvemos al menú por defecto para que no quede en el aire si deciden no pulsar nada.
                adminState[chatId] = { step: 'menu' };
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
