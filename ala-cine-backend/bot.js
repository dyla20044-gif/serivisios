const fs = require('fs');
const path = require('path');
const initializePublicAds = require('./publicAds');

const initHelpers = require('./bot_helpers');
const initMessages = require('./bot_messages');
const initCallbacks = require('./bot_callbacks');

function initializeBot(bot, db, mongoDb, adminState, ADMIN_CHAT_IDS, TMDB_API_KEY, RENDER_BACKEND_URL, axios, pinnedCache, sendNotificationToTopic, userCache) {
    
    const COMMUNITY_GROUP_ID = process.env.COMMUNITY_GROUP_ID;

    // 1. Inicializar Publicidad
    initializePublicAds(bot, mongoDb, ADMIN_CHAT_IDS[0]);

    // 2. Configurar Comandos del Menú de Telegram
    bot.setMyCommands([
        { command: 'start', description: 'Reiniciar el bot y ver el menú principal' },
        { command: 'subir', description: 'Subir una película o serie a la base de datos' },
        { command: 'editar', description: 'Editar los enlaces de una película o serie existente' },
        { command: 'pedidos', description: 'Abrir Gestor de Pedidos de Usuarios' },
        { command: 'subirexclusivo', description: 'Subir contenido a la bóveda privada/exclusiva' }
    ]);

    // 3. Empaquetar todas las variables globales en un "Contexto" (botCtx)
    const botCtx = {
        bot, db, mongoDb, adminState, ADMIN_CHAT_IDS, COMMUNITY_GROUP_ID,
        TMDB_API_KEY, RENDER_BACKEND_URL, axios, 
        pinnedCache, sendNotificationToTopic, userCache,
        fs, path
    };

    // 4. Inicializar los submódulos divididos
    const helpers = initHelpers(botCtx);
    const { runAutoPoster, cleanupOldAutoPosts } = helpers; // Extraemos las funciones del Auto-Poster

    initMessages(botCtx, helpers);
    initCallbacks(botCtx, helpers);

    // =========================================================
    // NUEVO: SISTEMA DE AUTO-POSTING EN MÚLTIPLES CANALES
    // =========================================================
    
    // Leemos los IDs de los canales separados por comas desde las variables de entorno
    const autoPostChannelsRaw = process.env.AUTOPOST_CHANNELS || "";
    const autopostChannels = autoPostChannelsRaw.split(',').map(id => id.trim()).filter(id => id !== "");

    if (autopostChannels.length > 0) {
        let currentChannelIndex = 0;

        // 1. Cron Job de Publicación (Se ejecuta cada 5 minutos = 300,000 ms)
        setInterval(async () => {
            const channelId = autopostChannels[currentChannelIndex];
            console.log(`[Auto-Poster] Iniciando ciclo para el canal: ${channelId}`);
            
            await runAutoPoster(channelId);

            // Rotación Round-Robin: Avanzamos al siguiente canal, si llegamos al final, volvemos a cero.
            currentChannelIndex++;
            if (currentChannelIndex >= autopostChannels.length) {
                currentChannelIndex = 0;
            }
        }, 300000); 

        // 2. Cron Job de Limpieza (Se ejecuta cada 1 minuto = 60,000 ms para revisar mensajes viejos)
        setInterval(async () => {
            await cleanupOldAutoPosts();
        }, 60000); 

        console.log(`[Auto-Poster] Sistema iniciado correctamente. Canales configurados: ${autopostChannels.length}`);
    } else {
        console.log(`[Auto-Poster] Apagado. No se encontraron canales en la variable AUTOPOST_CHANNELS.`);
    }

    // =========================================================
    // EVENTOS PASIVOS: AUTO-ACEPTACIÓN DE USUARIOS
    // =========================================================

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

    if (COMMUNITY_GROUP_ID) {
        setInterval(() => {
            const mensajesAutomáticos = [
                "🍿 **¿Sin saber qué ver hoy?**\nRecuerda que en Sala Cine subimos estrenos y clásicos todos los días. ¡Abre la app y descubre tu próxima película favorita!",
                "🚀 **¡Siempre actualizados!**\nNo te pierdas los últimos estrenos. Si aún no tienes nuestra app o necesitas actualizarla, descárgala gratis y disfruta sin límites.",
                "🔴 **¡Tenemos contenido en VIVO!**\n¿Ya revisaste nuestra sección de TV en vivo en la app? Deportes, eventos especiales y más. ¡Entra a revisarlo!",
                "💡 **¿Buscas una película en específico?**\nRecuerda que puedes pedírmela por aquí escribiendo algo como: *'busco la película Batman'* o pedirla directo en la sección de pedidos de la app."
            ];
            
            const msjAleatorio = mensajesAutomáticos[Math.floor(Math.random() * mensajesAutomáticos.length)];
            
            const smartLink = `${RENDER_BACKEND_URL}/app/details/0`; 

            bot.sendMessage(COMMUNITY_GROUP_ID, msjAleatorio, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '📱 Abrir App / Descargar', url: smartLink }]]
                }
            }).catch(e => console.error("Error enviando mensaje automático de 6h:", e.message));
        }, 21600000); 
    }
}

module.exports = initializeBot;
