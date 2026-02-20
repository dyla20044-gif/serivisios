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

    // ✏️ AQUÍ PUEDES CAMBIAR LAS IMÁGENES DE CADA PLAN (Pon URLs de fotos reales)
    const PLANES = {
        basico: { 
            id: "basico", nombre: "Plan Básico (1 Canal Pequeño)", precio: "$20 USD", horas: 30, tipo: "pequenos", posts: 1,
            imagen: "https://vilmanunez.com/wp-content/uploads/2020/07/Disen%CC%83o-sin-ti%CC%81tulo.png",
            descripcion: "🚀 *PLAN BÁSICO*\n\nIdeal para empezar. Tu publicidad se enviará a *1 de nuestros canales pequeños* (menos de 100,000 seguidores).\n\n🔹 *¿Qué incluye?*\n- Publicación en 1 canal de la red.\n- Tu anuncio estará visible por *30 horas*.\n- Formato libre: Imagen/Video + Texto + Enlaces.\n\n💵 *Inversión:* $20 USD"
        },
        elite: { 
            id: "elite", nombre: "Plan Élite (1 Canal Grande)", precio: "$35 USD", horas: 30, tipo: "grandes", posts: 1,
            imagen: "https://vilmanunez.com/wp-content/uploads/2020/07/Disen%CC%83o-sin-ti%CC%81tulo.png",
            descripcion: "🔥 *PLAN ÉLITE*\n\nLlega a las masas. Tu anuncio será publicado en *1 de nuestros canales principales* (más de 100,000 seguidores).\n\n🔹 *¿Qué incluye?*\n- Publicación en 1 canal GRANDE.\n- Máxima visibilidad por *30 horas*.\n- Excelente para promocionar grupos o negocios.\n\n💵 *Inversión:* $35 USD"
        },
        combo: { 
            id: "combo", nombre: "👑 COMBO VIP (Todos los Canales)", precio: "$80 USD", horas: 48, tipo: "todos", posts: 1,
            imagen: "https://placehold.co/600x400/800080/ffffff?text=COMBO+VIP",
            descripcion: "👑 *COMBO VIP*\n\nDominación total. Tu publicidad se disparará en *TODOS nuestros canales simultáneamente* (Pequeños y Grandes).\n\n🔹 *¿Qué incluye?*\n- Publicación en TODOS los canales de la red.\n- Duración extendida: visible por *48 horas*.\n- Máximo impacto y alcance masivo garantizado.\n\n💵 *Inversión:* $80 USD"
        },
        mensual: { 
            id: "mensual", nombre: "💎 PLAN MENSUAL (1 Mes)", precio: "$150 USD", horas: 720, tipo: "todos", posts: 15, // Te da 15 posts al mes
            imagen: "https://placehold.co/600x400/000000/ffd700?text=PLAN+MENSUAL",
            descripcion: "💎 *PLAN MENSUAL PRO*\n\nLa mejor inversión para creadores constantes. Acceso al *COMBO VIP* durante todo el mes.\n\n🔹 *¿Qué incluye?*\n- Acceso a TODOS los canales.\n- 15 Publicaciones disponibles (Recomendado 1 cada 2 días).\n- Mayor rentabilidad a largo plazo.\n\n💵 *Inversión:* $150 USD / Mes"
        }
    };

    const METODOS_PAGO = `💳 *MÉTODOS DE PAGO DISPONIBLES*\n\n` +
        `🟡 *BINANCE PAY*\nPay ID: \`123456789\`\nCorreo: \`tuemail@binance.com\`\n\n` +
        `🔵 *PAYPAL*\nEnlace: \`paypal.me/TuUsuario\`\n\n` +
        `⚠️ *INSTRUCCIONES:*\nUna vez realizado el pago, **envíame por aquí mismo la FOTO/CAPTURA del comprobante**.\nTu anuncio será habilitado inmediatamente tras la verificación.`;

    const adState = {};

    // =====================================================================
    // 1. DASHBOARD PRINCIPAL Y BOTONES
    // =====================================================================
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const data = query.data;
        const msgId = query.message.message_id;

        // --- ABRIR DASHBOARD ---
        if (data === 'ads_open_dashboard' || data === 'ads_back_main') {
            const user = await mongoDb.collection('ad_users').findOne({ userId: chatId });
            
            let statusText = "❌ Sin Plan Activo";
            let planType = "Ninguno";
            
            if (user && user.postsDisponibles > 0) {
                statusText = `✅ Tienes ${user.postsDisponibles} publicación(es) disponible(s)`;
                planType = PLANES[user.planCode]?.nombre || "Desconocido";
            }

            const dashboardMsg = `📊 *PANEL DE ANUNCIANTES PRO*\n\n👤 *Usuario:* ${query.from.first_name}\n📈 *Estado:* ${statusText}\n💎 *Plan Actual:* ${planType}\n\nLlega a más de 300,000 personas reales en nuestra red.`;

            // Limpieza visual: si venimos de un detalle (foto), borramos la foto. Si no, editamos el texto.
            if (query.message.photo) {
                bot.deleteMessage(chatId, msgId).catch(()=>{});
                bot.sendMessage(chatId, dashboardMsg, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🛒 Ver Planes y Precios', callback_data: 'ads_view_plans' }],
                            [{ text: '🚀 Enviar Mi Publicidad', callback_data: 'ads_create_post' }]
                        ]
                    }
                });
            } else {
                bot.editMessageText(dashboardMsg, {
                    chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🛒 Ver Planes y Precios', callback_data: 'ads_view_plans' }],
                            [{ text: '🚀 Enviar Mi Publicidad', callback_data: 'ads_create_post' }]
                        ]
                    }
                });
            }
            bot.answerCallbackQuery(query.id);
            return;
        }

        // --- LISTA DE PLANES ---
        if (data === 'ads_view_plans') {
            const textPlanes = `🔥 *SELECCIONA TU PAQUETE PUBLICITARIO*\n\nPresiona un plan para ver los detalles, qué incluye y los enlaces de ejemplo:`;

            bot.editMessageText(textPlanes, {
                chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🟢 Básico (${PLANES.basico.precio})`, callback_data: 'ads_detail_basico' }],
                        [{ text: `🟠 Élite (${PLANES.elite.precio})`, callback_data: 'ads_detail_elite' }],
                        [{ text: `👑 VIP (${PLANES.combo.precio})`, callback_data: 'ads_detail_combo' }],
                        [{ text: `💎 MENSUAL PRO (${PLANES.mensual.precio})`, callback_data: 'ads_detail_mensual' }],
                        [{ text: '⬅️ Volver', callback_data: 'ads_back_main' }]
                    ]
                }
            });
            return;
        }

        // --- VER DETALLE DE UN PLAN (Muestra Foto + Detalles) ---
        if (data.startsWith('ads_detail_')) {
            const planCode = data.replace('ads_detail_', '');
            const plan = PLANES[planCode];

            // Limpiamos el texto anterior para mandar la foto bien estructurada
            bot.deleteMessage(chatId, msgId).catch(()=>{});
            
            bot.sendPhoto(chatId, plan.imagen, {
                caption: plan.descripcion,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💳 Pagar Ahora', callback_data: `ads_pay_${planCode}` }],
                        [{ text: '📞 Hablar con un Asesor', callback_data: `ads_advisor_${planCode}` }],
                        [{ text: '⬅️ Volver a los planes', callback_data: 'ads_view_plans' }]
                    ]
                }
            });
            return;
        }

        // --- PAGAR AHORA ---
        if (data.startsWith('ads_pay_')) {
            const planSeleccionado = data.replace('ads_pay_', '');
            adState[chatId] = { step: 'awaiting_receipt', plan: planSeleccionado };

            bot.deleteMessage(chatId, msgId).catch(()=>{});
            bot.sendMessage(chatId, METODOS_PAGO, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'ads_back_main' }]] }
            });
            return;
        }

        // --- HABLAR CON UN ASESOR (CHAT Y ACTIVACIÓN DIRECTA) ---
        if (data.startsWith('ads_advisor_')) {
            const planCode = data.replace('ads_advisor_', '');
            const plan = PLANES[planCode];

            bot.answerCallbackQuery(query.id, { text: "Contactando asesor..." });
            
            bot.deleteMessage(chatId, msgId).catch(()=>{});
            bot.sendMessage(chatId, `✅ *He notificado al administrador* que estás interesado en el *${plan.nombre}*.\n\nTe contactará pronto a tu chat privado. Si llegan a un acuerdo de pago o descuento, él activará tu plan directamente desde el sistema.`, { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Volver al Panel', callback_data: 'ads_back_main' }]] }
            });

            // Mensaje que te llega a ti (El ADMIN)
            const userLink = query.from.username ? `https://t.me/${query.from.username}` : `tg://user?id=${query.from.id}`;
            const adminMsg = `🔔 *NUEVO CLIENTE INTERESADO*\n\n👤 Usuario: ${query.from.first_name}\n📦 Plan de interés: *${plan.nombre}*\n\nSi hablas con él y te transfiere o llegan a un acuerdo, presiona el botón de abajo para activarle el plan manualmente sin pedirle foto del recibo.`;

            bot.sendMessage(ADMIN_CHAT_ID, adminMsg, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💬 Hablar con el Usuario', url: userLink }],
                        [{ text: `✅ Activarle ${plan.nombre} Ahora`, callback_data: `admin_ad_direct_approve_${chatId}_${planCode}` }]
                    ]
                }
            });
            return;
        }

        // =====================================================================
        // 2. LÓGICA DEL ADMINISTRADOR (TÚ)
        // =====================================================================
        
        // --- APROBAR PAGO CON FOTO DE RECIBO ---
        if (data.startsWith('admin_ad_approve_') || data.startsWith('admin_ad_reject_')) {
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
                    { $set: { planCode: planCode, postsDisponibles: PLANES[planCode].posts, lastUpdate: Date.now() } },
                    { upsert: true }
                );

                bot.sendMessage(userId, `🎉 *¡PAGO APROBADO!*\n\nTu plan *${PLANES[planCode].nombre}* está activo.\nPresiona /start y entra al "📢 Panel de Publicidad" para publicar.`, { parse_mode: 'Markdown' });
                bot.editMessageCaption(`✅ *PAGO APROBADO*\nPlan: ${PLANES[planCode].nombre}\nUsuario ID: ${userId}`, { chat_id: ADMIN_CHAT_ID, message_id: msgId, parse_mode: 'Markdown' });
            }
            return;
        }

        // --- APROBAR DIRECTAMENTE TRAS HABLAR CON EL ASESOR (SIN FOTO) ---
        if (data.startsWith('admin_ad_direct_approve_')) {
            const parts = data.split('_');
            const userId = parseInt(parts[4]);
            const planCode = parts[5];

            await mongoDb.collection('ad_users').updateOne(
                { userId: userId },
                { $set: { planCode: planCode, postsDisponibles: PLANES[planCode].posts, lastUpdate: Date.now() } },
                { upsert: true }
            );

            bot.sendMessage(userId, `🎉 *¡TU PLAN HA SIDO ACTIVADO POR EL ASESOR!*\n\nTu plan *${PLANES[planCode].nombre}* está listo para usarse.\nTienes ${PLANES[planCode].posts} publicación(es) disponible(s).\n\nEscribe /start, entra al Panel de Publicidad y elige "🚀 Enviar Mi Publicidad".`, { parse_mode: 'Markdown' });
            
            bot.editMessageText(`✅ *PLAN ACTIVADO MANUALMENTE*\nSe le otorgó el plan ${PLANES[planCode].nombre} al usuario.`, { chat_id: ADMIN_CHAT_ID, message_id: msgId, parse_mode: 'Markdown' });
            return;
        }

        // =====================================================================
        // 3. ENVÍO DE LA PUBLICIDAD (USUARIO)
        // =====================================================================
        
        if (data === 'ads_create_post') {
            const user = await mongoDb.collection('ad_users').findOne({ userId: chatId });
            if (!user || user.postsDisponibles <= 0) {
                bot.answerCallbackQuery(query.id, { text: "⚠️ No tienes un plan activo o ya usaste tu publicación.", show_alert: true });
                return;
            }

            adState[chatId] = { step: 'awaiting_ad_content', planCode: user.planCode };
            bot.deleteMessage(chatId, msgId).catch(()=>{});
            bot.sendMessage(chatId, "📝 *¡Excelente!*\n\nEnvíame el contenido exacto de tu anuncio.\nPuedes enviar una foto con texto, un video, o solo texto.\n\n_Lo que envíes ahora será publicado tal cual en los canales._", { parse_mode: 'Markdown' });
            bot.answerCallbackQuery(query.id);
        }

        if (data === 'ads_publish_confirm') {
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
                if (!channel.id) continue;
                try {
                    const result = await bot.copyMessage(channel.id, chatId, state.msgIdToCopy);
                    publishedMessages.push({ channelId: channel.id, messageId: result.message_id });
                    linkText += `👉 [Ver en ${channel.name}](${channel.link})\n`;
                    publishSuccess = true;
                } catch (err) {
                    console.error(`Error copiando a canal ${channel.name}:`, err.message);
                }
            }

            if (publishSuccess) {
                const deleteAt = Date.now() + (planInfo.horas * 60 * 60 * 1000);
                await mongoDb.collection('active_ads').insertOne({
                    userId: chatId, planCode: state.planCode, deleteAt: deleteAt, publishedMessages: publishedMessages
                });

                await mongoDb.collection('ad_users').updateOne(
                    { userId: chatId }, { $inc: { postsDisponibles: -1 } }
                );

                bot.sendMessage(chatId, `✅ *¡PUBLICACIÓN EXITOSA!*\n\nTu anuncio estará visible durante ${planInfo.horas} horas y luego se eliminará automáticamente.\n\n${linkText}`, { parse_mode: 'Markdown', disable_web_page_preview: true });
            } else {
                bot.sendMessage(chatId, `❌ Hubo un error al publicar. Verifica que el bot sea administrador en los canales y avisa al dueño.`);
            }

            delete adState[chatId]; 
        }
    });

    // =====================================================================
    // 4. RECEPCIÓN DE MENSAJES (FOTOS, COMPROBANTES, ETC)
    // =====================================================================
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const state = adState[chatId];

        if (!state) return;

        // --- Recibiendo comprobante de pago ---
        if (state.step === 'awaiting_receipt') {
            if (!msg.photo && !msg.document) {
                bot.sendMessage(chatId, "⚠️ Debes enviar una *FOTO* o archivo de tu comprobante.", { parse_mode: 'Markdown' });
                return;
            }

            const planCode = state.plan;
            delete adState[chatId]; 

            bot.sendMessage(chatId, "⏳ Comprobante enviado al administrador. Se revisará en breve.\nSi todo está correcto, te avisaremos por aquí.");

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

        // --- Recibiendo contenido del anuncio ---
        else if (state.step === 'awaiting_ad_content') {
            if (msg.text && msg.text.startsWith('/')) return; 

            adState[chatId].msgIdToCopy = msg.message_id;
            adState[chatId].step = 'confirm_publish';

            bot.sendMessage(chatId, "👀 **Revisa arriba.**\n¿Ese es el anuncio final que deseas publicar en los canales?", {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ SÍ, PUBLICAR AHORA', callback_data: 'ads_publish_confirm' }],
                        [{ text: '🔄 No, volver a enviar', callback_data: 'ads_create_post' }],
                        [{ text: '❌ Cancelar', callback_data: 'ads_open_dashboard' }]
                    ]
                },
                reply_to_message_id: msg.message_id 
            });
        }
    });

    // =====================================================================
    // ⚙️ CRON JOB: BORRADO AUTOMÁTICO (Cada 30 min)
    // =====================================================================
    setInterval(async () => {
        try {
            const now = Date.now();
            const expiredAds = await mongoDb.collection('active_ads').find({ deleteAt: { $lte: now } }).toArray();

            for (const ad of expiredAds) {
                for (const msgData of ad.publishedMessages) {
                    try { await bot.deleteMessage(msgData.channelId, msgData.messageId); } catch (err) {}
                }
                await mongoDb.collection('active_ads').deleteOne({ _id: ad._id });
                bot.sendMessage(ad.userId, "⏱ *Tu anuncio ha completado su tiempo contratado y ha sido retirado automáticamente.* ¡Gracias por preferirnos!", { parse_mode: 'Markdown' }).catch(()=>{});
            }
        } catch (error) { console.error("Error Cron Ads:", error); }
    }, 30 * 60 * 1000); 
}

module.exports = initializePublicAds;
