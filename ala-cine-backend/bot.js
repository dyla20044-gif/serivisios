const fs = require('fs');
const path = require('path');
const initializePublicAds = require('./publicAds');

// Importamos nuestros nuevos submódulos
const initHelpers = require('./bot_helpers');
const initMessages = require('./bot_messages');
const initCallbacks = require('./bot_callbacks');

function initializeBot(bot, db, mongoDb, adminState, ADMIN_CHAT_IDS, TMDB_API_KEY, RENDER_BACKEND_URL, axios, pinnedCache, sendNotificationToTopic, userCache) {
    // 1. Inicializar Publicidad
    initializePublicAds(bot, mongoDb, ADMIN_CHAT_IDS[0]);

    // 2. Configurar Comandos del Menú de Telegram
    bot.setMyCommands([
        { command: 'start', description: 'Reiniciar el bot y ver el menú principal' },
        { command: 'subir', description: 'Subir una película o serie a la base de datos' },
        { command: 'editar', description: 'Editar los enlaces de una película o serie existente' },
        { command: 'pedidos', description: 'Ver la lista de películas solicitadas por los usuarios' },
        { command: 'subirexclusivo', description: 'Subir contenido a la bóveda privada/exclusiva' }
    ]);

    // 3. Empaquetar todas las variables globales en un "Contexto" (botCtx)
    // Esto evita que tengamos que pasar 20 variables una por una a los otros archivos.
    const botCtx = {
        bot, db, mongoDb, adminState, ADMIN_CHAT_IDS, 
        TMDB_API_KEY, RENDER_BACKEND_URL, axios, 
        pinnedCache, sendNotificationToTopic, userCache,
        fs, path
    };

    // 4. Inicializar los submódulos divididos
    const helpers = initHelpers(botCtx);
    initMessages(botCtx, helpers);
    initCallbacks(botCtx, helpers);

    // =========================================================
    // EVENTOS PASIVOS: AUTO-ACEPTACIÓN DE USUARIOS
    // (Estos se quedan aquí porque no requieren interacción directa del admin)
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
}

module.exports = initializeBot;
