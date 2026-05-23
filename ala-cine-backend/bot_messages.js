module.exports = function(botCtx, helpers) {
    const { bot, mongoDb, adminState, ADMIN_CHAT_IDS, COMMUNITY_GROUP_ID, TMDB_API_KEY, RENDER_BACKEND_URL, axios, sendNotificationToTopic } = botCtx;
    const { clearAllCaches, clearLiveCache, getMainMenuKeyboard } = helpers;

    // =========================================================
    // SISTEMA IA: CACHÉ EN RAM Y DICCIONARIO HUMANO AVANZADO
    // =========================================================
    
    const smartBotCache = {
        catalog: [],
        lastUpdate: 0,
        ttl: 15 * 60 * 1000 // 15 minutos
    };

    async function ensureCacheWarmed() {
        if (Date.now() - smartBotCache.lastUpdate < smartBotCache.ttl && smartBotCache.catalog.length > 0) return;
        try {
            console.log("🔥 Calentando Caché RAM del bot para respuestas ultrarrápidas...");
            const movies = await mongoDb.collection('media_catalog').find({}).project({ tmdbId: 1, title: 1 }).toArray();
            const series = await mongoDb.collection('series_catalog').find({}).project({ tmdbId: 1, title: 1, name: 1 }).toArray();
            
            smartBotCache.catalog = [
                ...movies.map(m => ({ id: m.tmdbId, title: m.title, type: 'movie' })),
                ...series.map(s => ({ id: s.tmdbId, title: s.title || s.name, type: 'tv' }))
            ];
            smartBotCache.lastUpdate = Date.now();
            console.log(`✅ Caché bot lista: ${smartBotCache.catalog.length} títulos en RAM.`);
        } catch(e) { console.error("Error calentando caché bot:", e); }
    }

    const dict = {
        greetings: [
            "¡Hola! Claro, déjame revisar la bóveda un segundo... 🔍",
            "A ver, déjame buscar si la tenemos lista para ti... 🍿",
            "¡Buena elección! Dame un momento, la busco en los servidores. 🚀"
        ],
        found: [
            "¡Bingo! La encontré. Aquí la tienes lista para ver. 👇",
            "¡Aquí está! Entra al enlace y prepara el canguil 🍿:",
            "Sí la tenemos disponible en máxima calidad. De una, disfrútala:"
        ],
        notFound: [
            "Puf, busqué por todos lados pero esa todavía no la tenemos subida. 😔 Recuerda que puedes pedirla en la sección 'Pedidos' de la App.",
            "¡Uf! Esa me falta. Pero tranquilo, anótala en la sección de pedidos de Sala Cine y la subimos pronto. ⚡",
            "Todavía no está en la bóveda, pero buenísima sugerencia. ¡Estaré atento para cuando la subamos! 🎬"
        ],
        faqDownload: [
            "¡Hola! Puedes descargar la aplicación de Sala Cine totalmente gratis y ver todo sin cortes. Búscala en la Play Store o entra aquí directo: 👇",
            "Para ver todo nuestro catálogo, necesitas nuestra app oficial. Es súper ligera. Descárgala desde este enlace seguro: 🚀"
        ],
        faqLive: [
            "¡Claro que sí! Tenemos contenido en VIVO 🔴. Partidos, eventos y canales 24/7. Solo abre Sala Cine y ve a la pestaña 'En Vivo'.",
            "Para ver los canales y partidos en vivo, entra a la app y revisa la sección del Feed/En Vivo. ¡Ahí transmitimos lo mejor! 🔥"
        ],
        faqRequests: [
            "¿Quieres pedir una película o serie nueva? ¡Súper fácil! Abre la app Sala Cine, ve a la sección de 'Pedidos' y deja tu voto. Las más votadas se suben súper rápido. 📝",
            "Todo el contenido nuevo se sube basándonos en lo que piden. ¡Entra a la app y déjanos tu solicitud ahí para ponerla en la lista de prioridades! 🚀"
        ],
        smallTalkHello: [
            "¡Hola! ¿Qué tal? ¿Buscando algo bueno para ver hoy? 🍿",
            "¡Buenas! Bienvenido a la comunidad. Si buscas alguna peli, solo dímelo. 🎬",
            "¡Hola, hola! Aquí el asistente de Sala Cine activo y listo. 🤖"
        ],
        smallTalkThanks: [
            "¡De nada! Para eso estamos. ¡Que disfrutes la función! 🍿",
            "¡A ti! Ya sabes, cualquier otra peli que busques, me avisas. 🚀",
            "¡Con gusto! Disfruta del contenido. 🎬"
        ],
        getRandom: (category) => {
            const options = dict[category];
            return options[Math.floor(Math.random() * options.length)];
        }
    };

    // =========================================================
    // COMANDOS DE INICIO
    // =========================================================

    bot.onText(/^\/start$|^\/subir$/, (msg) => {
        const chatId = msg.chat.id;
        if (!ADMIN_CHAT_IDS.includes(msg.from.id)) return;
        
        adminState[chatId] = { step: 'menu' };
        const inline_keyboard = getMainMenuKeyboard(chatId);
        bot.sendMessage(chatId, `¡Hola ${msg.from.first_name || 'Admin'}! ¿Qué quieres hacer hoy?`, { reply_markup: { inline_keyboard } });
    });

    // =========================================================
    // MANEJADOR PRINCIPAL DE MENSAJES
    // =========================================================

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const isAdmin = ADMIN_CHAT_IDS.includes(msg.from.id);
        const isCommunity = COMMUNITY_GROUP_ID && chatId.toString() === COMMUNITY_GROUP_ID.toString();

        // 1. LIMPIEZA AUTOMÁTICA DE MENSAJES DEL SISTEMA (Uniones/Salidas)
        if (msg.new_chat_members || msg.left_chat_member) {
            if (isCommunity) {
                try {
                    await bot.deleteMessage(chatId, msg.message_id);
                } catch (e) { /* Falla silenciosa si no tiene permisos */ }
            }
            return; // Cortamos la ejecución aquí porque estos mensajes no tienen texto
        }

        // 2. ANTI-SPAM DE ENLACES PARA USUARIOS NORMALES
        const hasLinks = msg.entities && msg.entities.some(e => e.type === 'url' || e.type === 'text_link' || e.type === 'mention');
        if (hasLinks && !isAdmin) {
            try {
                await bot.deleteMessage(msg.chat.id, msg.message_id);
                const warningMessage = await bot.sendMessage(msg.chat.id, `@${msg.from.username || msg.from.first_name}, no se permite enviar enlaces en este grupo.`);
                setTimeout(() => bot.deleteMessage(warningMessage.chat.id, warningMessage.message_id).catch(() => {}), 5000);
            } catch (error) {}
            return;
        }

        // Si es una foto, sticker o no hay texto, lo ignoramos
        const userText = msg.text;
        if (!userText) return;

        // =========================================================
        // IA DEL GRUPO (ASISTENTE HUMANO Y MODERADOR)
        // =========================================================
        if (isCommunity && !isAdmin) {
            const textLower = userText.toLowerCase();

            // A. FILTRO ANTI-GROSERÍAS
            const badWords = ['puta', 'mierda', 'pendejo', 'cabron', 'verga', 'imbecil', 'idiota', 'estupido', 'conchetumare', 'hijo de puta', 'malparido'];
            // Verifica si alguna grosería exacta está en el texto
            const hasBadWord = badWords.some(word => new RegExp(`\\b${word}\\b`, 'i').test(textLower));
            
            if (hasBadWord) {
                try {
                    await bot.deleteMessage(chatId, msg.message_id);
                    const warnMsg = await bot.sendMessage(chatId, `⚠️ @${msg.from.username || msg.from.first_name}, por favor mantengamos el respeto en la comunidad. Las groserías están prohibidas.`);
                    setTimeout(() => bot.deleteMessage(chatId, warnMsg.message_id).catch(()=>{}), 8000);
                } catch(e) {}
                return;
            }

            // B. CHARLAS SOCIALES
            if (textLower === 'hola' || textLower === 'buenas' || textLower === 'saludos') {
                return bot.sendMessage(chatId, dict.getRandom('smallTalkHello'), { reply_to_message_id: msg.message_id });
            }
            if (textLower.includes('gracias bot') || textLower.includes('buen bot') || textLower === 'gracias') {
                return bot.sendMessage(chatId, dict.getRandom('smallTalkThanks'), { reply_to_message_id: msg.message_id });
            }

            // C. FAQ: Descargar / App
            if (textLower.match(/(d[oó]nde descargo|pasar la app|como descargo|link de la app|instalar la app|apk|descargar sala cine)/)) {
                return bot.sendMessage(chatId, dict.getRandom('faqDownload'), {
                    reply_to_message_id: msg.message_id,
                    reply_markup: { inline_keyboard: [[{ text: '📱 Descargar Sala Cine', url: `${RENDER_BACKEND_URL}/app/details/0` }]] }
                });
            }

            // D. FAQ: En Vivo
            if (textLower.match(/(en vivo|partido|deportes|tv en vivo|canales|donde veo el partido)/)) {
                return bot.sendMessage(chatId, dict.getRandom('faqLive'), {
                    reply_to_message_id: msg.message_id,
                    reply_markup: { inline_keyboard: [[{ text: '🔴 Abrir App', url: `${RENDER_BACKEND_URL}/app/details/0` }]] }
                });
            }

            // E. FAQ: Pedidos
            if (textLower.match(/(como pido|agregar pelicula|subir pelicula|pueden subir|como solicito|agreguen)/)) {
                return bot.sendMessage(chatId, dict.getRandom('faqRequests'), {
                    reply_to_message_id: msg.message_id,
                    reply_markup: { inline_keyboard: [[{ text: '📝 Ir a Pedidos', url: `${RENDER_BACKEND_URL}/app/details/0` }]] }
                });
            }

            // F. BÚSQUEDA INTELIGENTE AMPLIADA
            // Atrapa: "busco batman", "tienes batman", "quiero ver batman", "pelicula batman", "donde veo batman", "hay batman"
            const searchMatch = textLower.match(/(?:busco|tienes|tienen|quiero ver|ponme|b[uú]scame|pel[ií]cula(?: de)?|serie(?: de)?|donde veo|hay)\s+(.+)/i);
            
            if (searchMatch && searchMatch[1].length > 2) {
                const query = searchMatch[1].replace(/[?¿!¡]/g, '').trim().toLowerCase();
                
                const waitMsg = await bot.sendMessage(chatId, dict.getRandom('greetings'), { reply_to_message_id: msg.message_id });

                await ensureCacheWarmed(); 
                
                const result = smartBotCache.catalog.find(item => item.title.toLowerCase().includes(query));

                if (result) {
                    const successText = dict.getRandom('found') + `\n\n🎬 *${result.title}*`;
                    const deeplink = `${RENDER_BACKEND_URL}/view/${result.type}/${result.id}`;

                    return bot.editMessageText(successText, {
                        chat_id: chatId,
                        message_id: waitMsg.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[{ text: '▶️ Ver Ahora', url: deeplink }]]
                        }
                    });
                } else {
                    return bot.editMessageText(dict.getRandom('notFound'), {
                        chat_id: chatId,
                        message_id: waitMsg.message_id
                    });
                }
            }
            return; // Si no entendió, se queda en silencio.
        }

        // =========================================================
        // RESTRICCIÓN PARA MENSAJES PRIVADOS (DM NORMALES)
        // =========================================================
        if (!isAdmin) {
            if (userText.startsWith('/')) {
                const command = userText.split(' ')[0];
                if (command === '/start' || command === '/ayuda') {
                    const helpMessage = `👋 ¡Hola! Bienvenido al bot oficial.\n\n🤖 **Gestión de Accesos:**\nSi enviaste una solicitud para unirte a nuestros canales privados, este bot te aceptará automáticamente en breve.\n\n📢 **Servicio de Publicidad:**\nSi eres creador de contenido o tienes un negocio, puedes pautar con nosotros.`;
                    bot.sendMessage(chatId, helpMessage, { 
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [[{ text: '📞 Contactar Soporte', callback_data: 'public_contact' }]] }
                    });
                    return;
                }
                bot.sendMessage(chatId, 'Lo siento, no tienes permiso para usar este comando.');
            }
            return;
        }

        // =========================================================
        // LÓGICA DE ADMINISTRADOR ORIGINAL
        // =========================================================

        if (userText.startsWith('/')) {
            const command = userText.split(' ')[0];
            if (command === '/subirexclusivo') {
                adminState[chatId] = { step: 'exc_await_title', excData: {} };
                bot.sendMessage(chatId, '🔒 **Subida de Contenido Exclusivo**\n\n📝 Ingresa el **TÍTULO** del contenido:', { parse_mode: 'Markdown' });
            }
            return;
        }

        if (adminState[chatId] && adminState[chatId].step && adminState[chatId].step.startsWith('exc_')) {
            const step = adminState[chatId].step;

            if (step === 'exc_await_title') {
                adminState[chatId].excData.title = userText;
                adminState[chatId].step = 'exc_await_overview';
                bot.sendMessage(chatId, '✅ Título guardado.\n\n📝 Ahora ingresa la **SINOPSIS** (Descripción):');
            }
            else if (step === 'exc_await_overview') {
                adminState[chatId].excData.overview = userText;
                adminState[chatId].step = 'exc_await_poster';
                bot.sendMessage(chatId, '✅ Sinopsis guardada.\n\n🖼️ Envía la **URL de la imagen PORTADA** (Vertical):');
            }
            else if (step === 'exc_await_poster') {
                if (!userText.startsWith('http')) { bot.sendMessage(chatId, '❌ Envía una URL válida.'); return; }
                adminState[chatId].excData.poster_path = userText;
                adminState[chatId].step = 'exc_await_video';
                bot.sendMessage(chatId, '✅ Portada guardada.\n\n🔗 Envía la **URL del VIDEO** (.mp4, .m3u8, iframe, etc):');
            }
            else if (step === 'exc_await_video') {
                if (!userText.startsWith('http')) { bot.sendMessage(chatId, '❌ Envía una URL válida.'); return; }
                adminState[chatId].excData.video_url = userText;

                bot.sendMessage(chatId, '⏳ Guardando contenido exclusivo en la bóveda...');
                const newItem = {
                    id: "exc_" + Date.now(),
                    title: adminState[chatId].excData.title,
                    overview: adminState[chatId].excData.overview,
                    poster_path: adminState[chatId].excData.poster_path,
                    videoUrl: adminState[chatId].excData.video_url, 
                    addedAt: new Date(),
                    media_type: 'movie'
                };

                try {
                    await mongoDb.collection('exclusive_catalog').insertOne(newItem);
                    clearAllCaches(); 
                    bot.sendMessage(chatId, '✅ **¡Contenido Exclusivo guardado con éxito!**\nYa estará disponible en la pestaña Exclusivos de la App.', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🏠 Menú Principal', callback_data: 'back_to_menu' }]] } });
                } catch(e) {
                    bot.sendMessage(chatId, '❌ Ocurrió un error al guardar en la base de datos.');
                }
                adminState[chatId] = { step: 'menu' };
            }
            return;
        }

        if (adminState[chatId] && adminState[chatId].step && adminState[chatId].step.startsWith('hub_')) {
            if (chatId !== ADMIN_CHAT_IDS[0]) return; 

            const step = adminState[chatId].step;

            if (step === 'hub_nav_text') {
                adminState[chatId].tempHubData.navText = userText;
                adminState[chatId].step = 'hub_hero_title';
                bot.sendMessage(chatId, '✅ Texto del menú guardado.\n\n📝 Ahora ingresa el **TÍTULO** del evento (Ej: SUNSET BEATS LIVE):', { parse_mode: 'Markdown' });
            }
            else if (step === 'hub_hero_title') {
                adminState[chatId].tempHubData.title = userText;
                adminState[chatId].step = 'hub_hero_image';
                bot.sendMessage(chatId, '✅ Título guardado.\n\n🖼️ Ingresa la **URL de la imagen** de portada/banner (16:9):', { parse_mode: 'Markdown' });
            }
            else if (step === 'hub_hero_image') {
                if (!userText.startsWith('http')) { bot.sendMessage(chatId, '❌ Envía una URL válida.'); return; }
                adminState[chatId].tempHubData.image = userText;
                adminState[chatId].step = 'hub_hero_video';
                bot.sendMessage(chatId, '✅ Imagen guardada.\n\n🔗 Ingresa la **URL del video** o transmisión (.m3u8 o .mp4):', { parse_mode: 'Markdown' });
            }
            else if (step === 'hub_hero_video') {
                if (!userText.startsWith('http')) { bot.sendMessage(chatId, '❌ Envía una URL válida.'); return; }
                adminState[chatId].tempHubData.video = userText;
                
                adminState[chatId].step = 'hub_hero_status';
                bot.sendMessage(chatId, '✅ Video guardado.\n\n🏷️ Ingresa la **ETIQUETA** del evento (Ej: EN VIVO, ESTRENO, PRÓXIMAMENTE):', { parse_mode: 'Markdown' });
            }
            else if (step === 'hub_hero_status') {
                const statusLabel = userText.trim().toUpperCase() || 'EN VIVO';
                adminState[chatId].tempHubData.statusLabel = statusLabel;

                bot.sendMessage(chatId, '⏳ Guardando Evento Principal en el servidor...', { parse_mode: 'Markdown' });
                
                const heroData = adminState[chatId].tempHubData;
                const updateObj = {
                    "config.mainTitle": heroData.title,
                    "config.navOverride": { text: heroData.navText, icon: "fa-broadcast-tower" },
                    heroEvent: {
                        title: heroData.title,
                        imageUrl: heroData.image,
                        videoUrl: heroData.video,
                        viewers: 0, 
                        statusLabel: heroData.statusLabel,
                        btnText: "VER AHORA",
                        description: "Contenido exclusivo en vivo."
                    }
                };
                
                try {
                    await mongoDb.collection('live_feed_config').updateOne(
                        { _id: 'main_feed' },
                        { $set: updateObj },
                        { upsert: true }
                    );
                    clearLiveCache();
                    bot.sendMessage(chatId, '✅ **¡Evento Principal configurado con éxito!**', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🏠 Menú Principal', callback_data: 'back_to_menu' }]] } });
                } catch(e) {
                    bot.sendMessage(chatId, '❌ Ocurrió un error al guardar el evento principal.');
                }
                adminState[chatId] = { step: 'menu' };
            }

            else if (step === 'hub_sec_title') {
                adminState[chatId].tempHubData.title = userText;
                adminState[chatId].step = 'hub_sec_image';
                bot.sendMessage(chatId, '✅ Título guardado.\n\n🖼️ Ingresa la **URL de la imagen** para esta tarjeta (16:9):', { parse_mode: 'Markdown' });
            }
            else if (step === 'hub_sec_image') {
                if (!userText.startsWith('http')) { bot.sendMessage(chatId, '❌ Envía una URL válida.'); return; }
                adminState[chatId].tempHubData.image = userText;
                adminState[chatId].step = 'hub_sec_video';
                bot.sendMessage(chatId, '✅ Imagen guardada.\n\n🔗 Ingresa la **URL del video** (.mp4, .m3u8) para esta tarjeta secundaria:', { parse_mode: 'Markdown' });
            }
            else if (step === 'hub_sec_video') {
                if (!userText.startsWith('http')) { bot.sendMessage(chatId, '❌ Envía una URL válida.'); return; }
                adminState[chatId].tempHubData.videoUrl = userText;
                
                bot.sendMessage(chatId, '⏳ Guardando Tarjeta Secundaria...', { parse_mode: 'Markdown' });
                
                const secData = adminState[chatId].tempHubData;
                const newSecEvent = {
                    id: Date.now().toString(),
                    title: secData.title,
                    imageUrl: secData.image,
                    videoUrl: secData.videoUrl, 
                    viewers: 0 
                };
                
                try {
                    await mongoDb.collection('live_feed_config').updateOne(
                        { _id: 'main_feed' },
                        { $push: { secondaryEvents: newSecEvent } },
                        { upsert: true }
                    );
                    clearLiveCache();
                    bot.sendMessage(chatId, '✅ **¡Tarjeta Secundaria agregada con éxito!**', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🏠 Menú Principal', callback_data: 'back_to_menu' }]] } });
                } catch(e) {
                    bot.sendMessage(chatId, '❌ Ocurrió un error al guardar la tarjeta secundaria.');
                }
                adminState[chatId] = { step: 'menu' };
            }
            return;
        }

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

                bot.sendMessage(targetId, `🎉 **¡Felicidades!** Has recibido un bono manual de administrador por **$${amount.toFixed(2)} USD** que ha sido sumado a tu saldo. ¡Buen trabajo!`, { parse_mode: 'Markdown' }).catch(e => console.log('No se pudo notificar al usuario del bono.'));

            } catch (err) {
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
            } catch (error) { bot.sendMessage(chatId, 'Error buscando. Intenta de nuevo.'); }

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
            } catch (error) { bot.sendMessage(chatId, 'Error buscando. Intenta de nuevo.'); }

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
            } catch (error) { bot.sendMessage(chatId, 'Error buscando.'); }
        }

        else if (adminState[chatId] && adminState[chatId].step === 'awaiting_unified_link_movie') {
            const { selectedMedia } = adminState[chatId];
            if (!selectedMedia?.id) {
                bot.sendMessage(chatId, 'Error: Se perdieron los datos de la película.');
                adminState[chatId] = { step: 'menu' };
                return;
            }
            
            const linkInput = userText.trim();
            bot.deleteMessage(chatId, msg.message_id).catch(() => {});

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
                await axios.post(`${RENDER_BACKEND_URL}/update-movie-links`, movieDataToUpdate);
                clearAllCaches();
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
};
