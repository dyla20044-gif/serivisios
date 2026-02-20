// publicAds.js
const fs = require('fs');

function initializePublicAds(bot, mongoDb, ADMIN_CHAT_ID) {
    const adState = {};
    const getAdChannels = () => {
        const channels = [];
        for (let i = 1; i <= 20; i++) {
            const chan = process.env[`AD_CHANNEL_${i}`];
            if (chan) channels.push(chan);
        }
        return channels;
    };
    bot.onText(/\/publicidad/, async (msg) => {
        const chatId = msg.chat.id;
        if (chatId === ADMIN_CHAT_ID) return; 

        const user = await mongoDb.collection('ad_users').findOne({ userId: chatId });
        
        let statusText = "❌ Sin Plan Activo";
        let planType = "Ninguno";
        
        if (user && user.expiryDate > Date.now()) {
            statusText = `✅ Activo (Vence: ${new Date(user.expiryDate).toLocaleString()})`;
            planType = user.planName;
        }

        const dashboardMsg = `📊 *PANEL DE ANUNCIANTES PRO*\n\n` +
            `👤 *Usuario:* ${msg.from.first_name}\n` +
            `📈 *Estado:* ${statusText}\n` +
            `💎 *Plan Actual:* ${planType}\n\n` +
            `Llega a más de 300,000 personas reales en nuestra red de canales.`;

        bot.sendMessage(chatId, dashboardMsg, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🛒 Ver Planes y Precios', callback_data: 'ads_view_plans' }],
                    [{ text: '🚀 Enviar Mi Publicidad', callback_data: 'ads_create_post' }],
                    [{ text: '📞 Hablar con el Propietario', callback_data: 'ads_contact_owner' }]
                ]
            }
        });
    });

    // 3. MANEJO DE BOTONES (CALLBACKS)
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const data = query.data;
        const msgId = query.message.message_id;

        // --- MENÚ DE PLANES ---
        if (data === 'ads_view_plans') {
            // ---> MODIFICA AQUÍ TUS PRECIOS Y TEXTOS <---
            const textPlanes = `🔥 *SELECCIONA TU PAQUETE PUBLICITARIO*\n\n` +
                `*1️⃣ Plan Básico (1 Canal Pequeño)*\n` +
                `⏱ Duración: 30 Horas\n` +
                `💵 Precio: $20 USD\n\n` +
                `*2️⃣ Plan Élite (1 Canal +100k)*\n` +
                `⏱ Duración: 30 Horas\n` +
                `💵 Precio: $35 USD\n\n` +
                `*3️⃣ 👑 COMBO VIP (TODOS LOS CANALES)*\n` +
                `⏱ Duración: 40 Horas\n` +
                `💵 Precio: $80 USD (¡Ahorras un 40%!)\n\n` +
                `Elige el plan que deseas pagar:`;

            bot.editMessageText(textPlanes, {
                chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🛒 Comprar Plan Básico ($20)', callback_data: 'ads_pay_basico' }],
                        [{ text: '🛒 Comprar Plan Élite ($35)', callback_data: 'ads_pay_elite' }],
                        [{ text: '👑 Comprar COMBO VIP ($80)', callback_data: 'ads_pay_combo' }],
                        [{ text: '⬅️ Volver', callback_data: 'ads_back_main' }]
                    ]
                }
            });
        }

        // --- MÉTODOS DE PAGO ---
        else if (data.startsWith('ads_pay_')) {
            const planSeleccionado = data.replace('ads_pay_', '');
            adState[chatId] = { step: 'awaiting_receipt', plan: planSeleccionado };

            // ---> MODIFICA AQUÍ TUS DATOS DE PAGO <---
            const textPago = `💳 *MÉTODOS DE PAGO DISPONIBLES*\n\n` +
                `🟡 *BINANCE PAY (Recomendado)*\n` +
                `Pay ID: \`123456789\`\n` +
                `Correo: \`tuemail@binance.com\`\n\n` +
                `🔵 *PAYPAL*\n` +
                `Enlace: \`paypal.me/TuUsuario\`\n\n` +
                `🏦 *TRANSFERENCIA LOCAL (Ecuador)*\n` +
                `Banco Pichincha - Solicita los datos contactando al dueño.\n\n` +
                `⚠️ *INSTRUCCIONES:*\n` +
                `Realiza el pago y **envíame por aquí mismo la FOTO (captura) del comprobante**.`;

            bot.editMessageText(textPago, {
                chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'ads_back_main' }]] }
            });
        }

        // --- CONTACTAR AL DUEÑO ---
        else if (data === 'ads_contact_owner') {
            bot.answerCallbackQuery(query.id, { text: "Notificando al administrador..." });
            bot.sendMessage(chatId, "✅ Le he enviado un aviso al propietario. Te contactará pronto.");

            // Le envía el aviso al Admin con un botón directo al chat del usuario
            const userLink = query.from.username ? `https://t.me/${query.from.username}` : `tg://user?id=${query.from.id}`;
            bot.sendMessage(ADMIN_CHAT_ID, `🔔 *SOLICITUD DE CONTACTO (PUBLICIDAD)*\n\nEl usuario ${query.from.first_name} quiere hablar contigo sobre publicidad.`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '💬 Hablar con el Usuario', url: userLink }]]
                }
            });
        }

        // --- APROBAR O RECHAZAR PAGO (LÓGICA DEL ADMIN) ---
        else if (data.startsWith('admin_ad_')) {
            const action = data.split('_')[2]; // 'approve' o 'reject'
            const userId = data.split('_')[3];
            const plan = data.split('_')[4];

            if (action === 'reject') {
                bot.sendMessage(userId, "❌ *Tu comprobante de pago ha sido rechazado.* Por favor, contacta al administrador.", { parse_mode: 'Markdown' });
                bot.editMessageCaption("❌ *COMPROBANTE RECHAZADO*", { chat_id: ADMIN_CHAT_ID, message_id: msgId, parse_mode: 'Markdown' });
            } 
            else if (action === 'approve') {
                // Calcular horas según el plan
                let hours = 30;
                let planNameStr = "Plan Básico/Élite";
                if (plan === 'combo') { hours = 40; planNameStr = "COMBO VIP (Todos los Canales)"; }

                const expiry = Date.now() + (hours * 60 * 60 * 1000); // Milisegundos
                
                // Guardar en MongoDB
                await mongoDb.collection('ad_users').updateOne(
                    { userId: parseInt(userId) },
                    { $set: { expiryDate: expiry, planName: planNameStr, planCode: plan, allowedHours: hours } },
                    { upsert: true }
                );

                bot.sendMessage(userId, `🎉 *¡PAGO APROBADO!*\n\nTu plan *${planNameStr}* está activo por ${hours} horas.\nYa puedes usar el menú para enviar tu publicidad.`, { parse_mode: 'Markdown' });
                bot.editMessageCaption(`✅ *COMPROBANTE APROBADO*\nPlan: ${planNameStr}\nUsuario ID: ${userId}`, { chat_id: ADMIN_CHAT_ID, message_id: msgId, parse_mode: 'Markdown' });
            }
        }
    });
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        if (adState[chatId] && adState[chatId].step === 'awaiting_receipt') {
            if (!msg.photo && !msg.document) {
                bot.sendMessage(chatId, "⚠️ Por favor, envíame una *FOTO* o captura de pantalla de tu comprobante.", { parse_mode: 'Markdown' });
                return;
            }

            const planSeleccionado = adState[chatId].plan;
            delete adState[chatId]; 

            bot.sendMessage(chatId, "⏳ Comprobante recibido. Está en revisión por el administrador. Te notificaremos pronto.");
            const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;
            const caption = `💰 *NUEVO PAGO RECIBIDO*\n\nUsuario: ${msg.from.first_name} (@${msg.from.username || 'Sin_User'})\nID: ${chatId}\nPlan Solicitado: *${planSeleccionado}*`;

            bot.sendPhoto(ADMIN_CHAT_ID, fileId, {
                caption: caption,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Aprobar', callback_data: `admin_ad_approve_${chatId}_${planSeleccionado}` },
                            { text: '❌ Rechazar', callback_data: `admin_ad_reject_${chatId}_${planSeleccionado}` }
                        ]
                    ]
                }
            });
        }
    });
    setInterval(async () => {
        try {
            const now = Date.now();
            const expiredAds = await mongoDb.collection('active_ads').find({ deleteAt: { $lte: now } }).toArray();

            for (const ad of expiredAds) {
                for (const msgData of ad.publishedMessages) {
                    try {
                        // Borrar el mensaje del canal de Telegram
                        await bot.deleteMessage(msgData.channelId, msgData.messageId);
                    } catch (err) {
                        console.error(`No se pudo borrar msj ${msgData.messageId} en canal ${msgData.channelId}`);
                    }
                }
                // Eliminar registro de MongoDB
                await mongoDb.collection('active_ads').deleteOne({ _id: ad._id });
                // Avisar al usuario
                bot.sendMessage(ad.userId, "⏱ *Tu anuncio ha finalizado y ha sido retirado de los canales.* ¡Gracias por usar nuestro servicio!", { parse_mode: 'Markdown' });
            }
        } catch (error) {
            console.error("Error en el cron job de anuncios:", error);
        }
    }, 30 * 60 * 1000);

}

module.exports = initializePublicAds;
