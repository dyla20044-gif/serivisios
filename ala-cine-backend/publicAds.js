const fs = require('fs');

function initializePublicAds(bot, mongoDb, ADMIN_CHAT_ID) {
    const OWNER_USERNAME = 'TuUsuarioDeTelegram'; 
    const CANALES = {
        pequenos: [
            { id: process.env.CH_PEQ_1, link: 'https://t.me/+enlacePrivadoPeq1', name: 'Canal Random (60k)' }
        ],
        grandes: [
            { id: process.env.CH_GRA_1, link: 'https://t.me/+enlacePrivadoGra1', name: 'Canal Cine (120k)' },
            { id: process.env.CH_GRA_2, link: 'https://t.me/+enlacePrivadoGra2', name: 'Canal Series (100k)' }
        ]
    };
    const PLANES = {
        basico: { nombre: "Plan Básico (1 Canal Pequeño)", precio: "$20 USD", horas: 30, tipo: "pequenos" },
        elite: { nombre: "Plan Élite (1 Canal Grande)", precio: "$35 USD", horas: 30, tipo: "grandes" },
        combo: { nombre: "👑 COMBO VIP (Todos los Canales)", precio: "$80 USD", horas: 40, tipo: "todos" }
    };

    // 4. Métodos de Pago
    // ✏️ Modifica los correos, IDs y enlaces de Binance/PayPal
    const METODOS_PAGO = `💳 *MÉTODOS DE PAGO DISPONIBLES*\n\n` +
        `🟡 *BINANCE PAY*\n` +
        `Pay ID: \`123456789\`\n` +
        `Correo: \`tuemail@binance.com\`\n\n` +
        `🔵 *PAYPAL*\n` +
        `Enlace: \`paypal.me/TuUsuario\`\n\n` +
        `🏦 *BANCO PICHINCHA*\n` +
        `Por seguridad, solicita el número de cuenta directamente al dueño.\n\n` +
        `⚠️ *INSTRUCCIONES:*\n` +
        `Realiza el pago y **envíame por aquí mismo la FOTO/CAPTURA del comprobante**.`;

    // =====================================================================
    // FIN DE LA CONFIGURACIÓN MANUAL
    // =====================================================================

    const adState = {};

    // --- COMANDO PRINCIPAL: /publicidad ---
    bot.onText(/\/publicidad/, async (msg) => {
        const chatId = msg.chat.id;
        if (chatId === ADMIN_CHAT_ID) return; 

        const user = await mongoDb.collection('ad_users').findOne({ userId: chatId });
        
        let statusText = "❌ Sin Plan Activo";
        let planType = "Ninguno";
        
        if (user && user.postsDisponibles > 0) {
            statusText = `✅ Tienes ${user.postsDisponibles} publicación(es) disponible(s)`;
            planType = PLANES[user.planCode]?.nombre || "Desconocido";
        } else if (user && user.postsDisponibles === 0) {
            statusText = `⚠️ Agotaste tus publicaciones. Compra un nuevo plan.`;
        }

        const dashboardMsg = `📊 *PANEL DE ANUNCIANTES PRO*\n\n` +
            `👤 *Usuario:* ${msg.from.first_name}\n` +
            `📈 *Estado:* ${statusText}\n` +
            `💎 *Plan Actual:* ${planType}\n\n` +
            `Llega a más de 300,000 personas reales en nuestra red.`;

        bot.sendMessage(chatId, dashboardMsg, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🛒 Ver Planes y Precios', callback_data: 'ads_view_plans' }],
                    [{ text: '🚀 Enviar Mi Publicidad', callback_data: 'ads_create_post' }],
                    [{ text: '📞 Contactar al Propietario', callback_data: 'ads_contact_owner' }]
                ]
            }
        });
    });

    // --- MANEJO DE BOTONES (CALLBACKS) ---
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const data = query.data;
        const msgId = query.message.message_id;

        if (data === 'ads_view_plans') {
            const textPlanes = `🔥 *SELECCIONA TU PAQUETE PUBLICITARIO*\n\n` +
                `*1️⃣ ${PLANES.basico.nombre}*\n` +
                `⏱ Duración: ${PLANES.basico.horas} Horas\n` +
                `💵 Precio: ${PLANES.basico.precio}\n\n` +
                `*2️⃣ ${PLANES.elite.nombre}*\n` +
                `⏱ Duración: ${PLANES.elite.horas} Horas\n` +
                `💵 Precio: ${PLANES.elite.precio}\n\n` +
                `*3️⃣ ${PLANES.combo.nombre}*\n` +
                `⏱ Duración: ${PLANES.combo.horas} Horas\n` +
                `💵 Precio: ${PLANES.combo.precio} (¡Ahorras un 40%!)\n\n` +
                `Elige el plan que deseas pagar:`;

            bot.editMessageText(textPlanes, {
                chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🛒 Comprar Básico (${PLANES.basico.precio})`, callback_data: 'ads_pay_basico' }],
                        [{ text: `🛒 Comprar Élite (${PLANES.elite.precio})`, callback_data: 'ads_pay_elite' }],
                        [{ text: `👑 Comprar VIP (${PLANES.combo.precio})`, callback_data: 'ads_pay_combo' }],
                        [{ text: '⬅️ Volver', callback_data: 'ads_back_main' }]
                    ]
                }
            });
        }

        else if (data === 'ads_back_main') {
            delete adState[chatId];
            bot.deleteMessage(chatId, msgId).catch(()=>{});
            bot.sendMessage(chatId, "Volviendo al menú principal... Escribe /publicidad cuando desees.");
        }

        else if (data.startsWith('ads_pay_')) {
            const planSeleccionado = data.replace('ads_pay_', '');
            adState[chatId] = { step: 'awaiting_receipt', plan: planSeleccionado };

            bot.editMessageText(METODOS_PAGO, {
                chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'ads_back_main' }]] }
            });
        }

        else if (data === 'ads_contact_owner') {
            bot.answerCallbackQuery(query.id, { text: "Notificando al administrador..." });
            bot.sendMessage(chatId, `✅ Le he enviado un aviso al propietario. Si urge, escríbele a @${OWNER_USERNAME}.`);

            const userLink = query.from.username ? `https://t.me/${query.from.username}` : `tg://user?id=${query.from.id}`;
            bot.sendMessage(ADMIN_CHAT_ID, `🔔 *SOLICITUD DE CONTACTO (PUBLICIDAD)*\n\nEl usuario ${query.from.first_name} quiere hablar contigo.`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '💬 Hablar con el Usuario', url: userLink }]] }
            });
        }

        // === ADMIN: APROBAR O RECHAZAR PAGO ===
        else if (data.startsWith('admin_ad_')) {
            const parts = data.split('_');
            const action = parts[2]; 
            const userId = parseInt(parts[3]);
            const planCode = parts[4];
            
            if (action === 'reject') {
                bot.sendMessage(userId, "❌ *Tu comprobante ha sido rechazado.* Contacta al administrador.", { parse_mode: 'Markdown' });
                bot.editMessageCaption("❌ *PAGO RECHAZADO*", { chat_id: ADMIN_CHAT_ID, message_id: msgId, parse_mode: 'Markdown' });
            } 
            else if (action === 'approve') {
                await mongoDb.collection('ad_users').updateOne(
                    { userId: userId },
                    { $set: { planCode: planCode, postsDisponibles: 1, lastUpdate: Date.now() } },
                    { upsert: true }
                );

                bot.sendMessage(userId, `🎉 *¡PAGO APROBADO!*\n\nTu plan *${PLANES[planCode].nombre}* está activo.\nTienes 1 publicación disponible.\nPresiona /publicidad y elige "🚀 Enviar Mi Publicidad".`, { parse_mode: 'Markdown' });
                bot.editMessageCaption(`✅ *PAGO APROBADO*\nPlan: ${PLANES[planCode].nombre}\nUsuario ID: ${userId}`, { chat_id: ADMIN_CHAT_ID, message_id: msgId, parse_mode: 'Markdown' });
            }
        }

        // === USUARIO: INICIAR CREACIÓN DEL POST ===
        else if (data === 'ads_create_post') {
            const user = await mongoDb.collection('ad_users').findOne({ userId: chatId });
            if (!user || user.postsDisponibles <= 0) {
                bot.answerCallbackQuery(query.id, { text: "⚠️ No tienes un plan activo o ya usaste tu publicación. Compra uno nuevo.", show_alert: true });
                return;
            }

            adState[chatId] = { step: 'awaiting_ad_content', planCode: user.planCode };
            bot.sendMessage(chatId, "📝 *¡Excelente!*\n\nEnvíame el contenido exacto de tu anuncio.\nPuedes enviar una foto con texto, un video, o solo texto.\n\n_Lo que envíes ahora será publicado tal cual en los canales._", { parse_mode: 'Markdown' });
            bot.answerCallbackQuery(query.id);
        }

        // === USUARIO: CONFIRMAR Y PUBLICAR ===
        else if (data === 'ads_publish_confirm') {
            const state = adState[chatId];
            if (!state || !state.msgIdToCopy) return;

            bot.editMessageText("🚀 Publicando anuncio en los canales, por favor espera...", { chat_id: chatId, message_id: msgId });

            const planInfo = PLANES[state.planCode];
            let targetChannels = [];
            
            if (planInfo.tipo === 'pequenos') targetChannels = CANALES.pequenos;
            else if (planInfo.tipo === 'grandes') targetChannels = [CANALES.grandes[0]]; 
            else if (planInfo.tipo === 'todos') targetChannels = [...CANALES.pequenos, ...CANALES.grandes];

            let publishedMessages = [];
            let linkText = "🔗 *Puedes ver tu anuncio aquí:*\n";
            let publishSuccess = false;

            for (const channel of targetChannels) {
                if (!channel.id) continue; // Salta si no hay ID configurado
                try {
                    const result = await bot.copyMessage(channel.id, chatId, state.msgIdToCopy);
                    publishedMessages.push({ channelId: channel.id, messageId: result.message_id });
                    linkText += `👉 [Ver en ${channel.name}](${channel.link})\n`;
                    publishSuccess = true;
                } catch (err) {
                    console.error(`Error copiando a canal ${channel.name} (${channel.id}):`, err.message);
                }
            }

            if (publishSuccess) {
                const deleteAt = Date.now() + (planInfo.horas * 60 * 60 * 1000);
                await mongoDb.collection('active_ads').insertOne({
                    userId: chatId,
                    planCode: state.planCode,
                    deleteAt: deleteAt,
                    publishedMessages: publishedMessages
                });

                await mongoDb.collection('ad_users').updateOne(
                    { userId: chatId },
                    { $inc: { postsDisponibles: -1 } }
                );

                bot.sendMessage(chatId, `✅ *¡PUBLICACIÓN EXITOSA!*\n\nTu anuncio estará visible durante ${planInfo.horas} horas y luego se eliminará automáticamente.\n\n${linkText}`, { parse_mode: 'Markdown', disable_web_page_preview: true });
            } else {
                bot.sendMessage(chatId, `❌ Hubo un error al publicar. Verifica que el bot sea administrador en los canales y avisa al dueño.`);
            }

            delete adState[chatId]; 
        }
    });

    // --- ESCUCHAR FOTOS Y MENSAJES (RECEPCIÓN) ---
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const state = adState[chatId];

        if (!state) return;

        // 1. Recibiendo el comprobante de pago
        if (state.step === 'awaiting_receipt') {
            if (!msg.photo && !msg.document) {
                bot.sendMessage(chatId, "⚠️ Debes enviar una *FOTO* o archivo de tu comprobante.", { parse_mode: 'Markdown' });
                return;
            }

            const planCode = state.plan;
            delete adState[chatId]; 

            bot.sendMessage(chatId, "⏳ Comprobante enviado al administrador. Se revisará en breve.");

            const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;
            const caption = `💰 *NUEVO PAGO RECIBIDO*\n\nUsuario: ${msg.from.first_name} (@${msg.from.username || 'Sin_User'})\nID: ${chatId}\nPlan: *${PLANES[planCode].nombre}*`;

            bot.sendPhoto(ADMIN_CHAT_ID, fileId, {
                caption: caption,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Aprobar', callback_data: `admin_ad_approve_${chatId}_${planCode}` },
                            { text: '❌ Rechazar', callback_data: `admin_ad_reject_${chatId}_${planCode}` }
                        ]
                    ]
                }
            });
        }

        // 2. Recibiendo el anuncio para publicar
        else if (state.step === 'awaiting_ad_content') {
            if (msg.text && msg.text.startsWith('/')) return; // Evitar que comandos rompan el flujo

            adState[chatId].msgIdToCopy = msg.message_id;
            adState[chatId].step = 'confirm_publish';

            bot.sendMessage(chatId, "👀 **Revisa arriba.**\n¿Ese es el anuncio final que deseas publicar en los canales?", {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ SÍ, PUBLICAR AHORA', callback_data: 'ads_publish_confirm' }],
                        [{ text: '🔄 No, volver a enviar', callback_data: 'ads_create_post' }],
                        [{ text: '❌ Cancelar', callback_data: 'ads_back_main' }]
                    ]
                },
                reply_to_message_id: msg.message_id 
            });
        }
    });

    // =====================================================================
    // ⚙️ CRON JOB: BORRADO AUTOMÁTICO DE ANUNCIOS (CADA 30 MINUTOS)
    // =====================================================================
    setInterval(async () => {
        try {
            const now = Date.now();
            const expiredAds = await mongoDb.collection('active_ads').find({ deleteAt: { $lte: now } }).toArray();

            for (const ad of expiredAds) {
                for (const msgData of ad.publishedMessages) {
                    try {
                        await bot.deleteMessage(msgData.channelId, msgData.messageId);
                    } catch (err) {
                        console.error(`Fallo al borrar mensaje caducado ${msgData.messageId}:`, err.message);
                    }
                }
                await mongoDb.collection('active_ads').deleteOne({ _id: ad._id });
                bot.sendMessage(ad.userId, "⏱ *Tu anuncio ha completado su tiempo contratado y ha sido retirado automáticamente.* ¡Gracias por preferirnos!", { parse_mode: 'Markdown' }).catch(()=>{});
            }
        } catch (error) {
            console.error("Error en Cron Job de anuncios:", error);
        }
    }, 30 * 60 * 1000); 
}

module.exports = initializePublicAds;
