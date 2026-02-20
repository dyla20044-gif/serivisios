const fs = require('fs');

function initializePublicAds(bot, mongoDb, ADMIN_CHAT_ID) {

    // ✏️ IMÁGENES DE INTERFAZ (Reemplaza con tus links PNG/JPG)
    const IMG_DASHBOARD = 'https://placehold.co/800x400/1e1e1e/ffffff?text=PANEL+DE+PUBLICIDAD';
    const IMG_CANALES = 'https://placehold.co/800x400/0044cc/ffffff?text=NUESTRA+RED+DE+CANALES';

    const CANALES = {
        pequenos: [
            { id: process.env.CH_PEQ_1, link: 'https://t.me/TuCanalPeq1', name: 'Canal Random (60k)' }
        ],
        grandes: [
            { id: process.env.CH_GRA_1, link: 'https://t.me/TuCanalGra1', name: 'Canal Cine (120k)' },
            { id: process.env.CH_GRA_2, link: 'https://t.me/TuCanalGra2', name: 'Canal Series (100k)' }
        ]
    };

    const PLANES = {
        basico: { 
            id: "basico", nombre: "Plan Básico (1 Canal Peq.)", precio: "$20 USD", horas: 30, tipo: "pequenos", posts: 1,
            imagen: "https://placehold.co/600x400/2ecc71/ffffff?text=PLAN+BASICO",
            descripcion: "🚀 *PLAN BÁSICO*\n\nIdeal para empezar. Tu publicidad se enviará a *1 de nuestros canales pequeños*.\n\n🔹 *¿Qué incluye?*\n- Publicación en 1 canal de la red.\n- Tu anuncio estará visible por *30 horas*.\n- Formato libre: Imagen/Video + Texto + Enlaces.\n\n💵 *Inversión:* $20 USD"
        },
        elite: { 
            id: "elite", nombre: "Plan Élite (1 Canal Grande)", precio: "$35 USD", horas: 30, tipo: "grandes", posts: 1,
            imagen: "https://placehold.co/600x400/e67e22/ffffff?text=PLAN+ELITE",
            descripcion: "🔥 *PLAN ÉLITE*\n\nLlega a las masas. Tu anuncio será publicado en *1 de nuestros canales principales*.\n\n🔹 *¿Qué incluye?*\n- Publicación en 1 canal GRANDE.\n- Máxima visibilidad por *30 horas*.\n- Excelente para promocionar grupos o negocios.\n\n💵 *Inversión:* $35 USD"
        },
        combo: { 
            id: "combo", nombre: "👑 COMBO VIP (Todos)", precio: "$80 USD", horas: 48, tipo: "todos", posts: 1,
            imagen: "https://placehold.co/600x400/8e44ad/ffffff?text=COMBO+VIP",
            descripcion: "👑 *COMBO VIP*\n\nDominación total. Tu publicidad se disparará en *TODOS nuestros canales simultáneamente*.\n\n🔹 *¿Qué incluye?*\n- Publicación en TODOS los canales de la red.\n- Duración extendida: visible por *48 horas*.\n- Máximo impacto garantizado.\n\n💵 *Inversión:* $80 USD"
        },
        mensual: { 
            id: "mensual", nombre: "💎 PLAN MENSUAL PRO", precio: "$150 USD", horas: 48, tipo: "todos", posts: 15, 
            imagen: "https://placehold.co/600x400/f1c40f/000000?text=PLAN+MENSUAL",
            descripcion: "💎 *PLAN MENSUAL PRO*\n\nLa mejor inversión para creadores constantes. \n\n🔹 *¿Qué incluye?*\n- Acceso a TODOS los canales (Pequeños y Grandes).\n- *15 Publicaciones* disponibles al mes.\n- Cada publicación dura 48 horas.\n\n💵 *Inversión:* $150 USD / Mes"
        }
    };

    const METODOS_PAGO = `💳 *MÉTODOS DE PAGO DISPONIBLES*\n\n` +
        `🟡 *BINANCE PAY*\nPay ID: \`123456789\`\nCorreo: \`tuemail@binance.com\`\n\n` +
        `🔵 *PAYPAL*\nEnlace: \`paypal.me/TuUsuario\`\n\n` +
        `⚠️ *INSTRUCCIONES:*\nUna vez realizado el pago, **envíame por aquí mismo la FOTO/CAPTURA del comprobante**.`;

    const adState = {};
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const data = query.data;
        const msgId = query.message.message_id;-
        if (data === 'ads_open_dashboard' || data === 'ads_back_main') {
            const user = await mongoDb.collection('ad_users').findOne({ userId: chatId });
            const activeAd = await mongoDb.collection('active_ads').findOne({ userId: chatId });
            
            let statusText = "❌ Sin Plan Activo";
            let planType = "Ninguno";
            let buttons = [];

            // Lógica dinámica de botones según el estado del usuario
            if (activeAd) {
                statusText = `🟢 Anuncio en circulación`;
                planType = PLANES[activeAd.planCode]?.nombre || "Desconocido";
                buttons.push([{ text: '📊 Ver Estado de mi Anuncio', callback_data: 'ads_ad_status' }]);
                if (user && user.postsDisponibles > 0) {
                    buttons.push([{ text: `📝 Te quedan ${user.postsDisponibles} posts (Plan Mensual)`, callback_data: 'noop' }]);
                }
            } else if (user && user.postsDisponibles > 0) {
                statusText = `✅ Tienes ${user.postsDisponibles} publicación(es) disponible(s)`;
                planType = PLANES[user.planCode]?.nombre || "Desconocido";
                buttons.push([{ text: '🚀 Lanzar Mi Publicidad Ahora', callback_data: 'ads_create_post' }]);
                // Damos la opción de renovar o cambiar de plan si lo desean
                buttons.push([{ text: '🔄 Comprar otro Plan', callback_data: 'ads_view_plans' }]); 
            } else {
                buttons.push([{ text: '🛒 Ver Planes y Precios', callback_data: 'ads_view_plans' }]);
            }

            buttons.push([{ text: '📢 Ver Nuestra Red de Canales', callback_data: 'ads_view_channels' }]);

            const dashboardMsg = `📊 *CENTRO DE ANUNCIANTES PRO*\n\n👤 *Usuario:* ${query.from.first_name}\n📈 *Estado:* ${statusText}\n💎 *Plan Actual:* ${planType}\n\nLlega a miles de personas reales al instante. ¿Qué deseas hacer?`;

            bot.deleteMessage(chatId, msgId).catch(()=>{});
            bot.sendPhoto(chatId, IMG_DASHBOARD, {
                caption: dashboardMsg,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });
            bot.answerCallbackQuery(query.id);
            return;
        }

        // --- VER CANALES DISPONIBLES ---
        if (data === 'ads_view_channels') {
            let msgCanales = `🌍 *NUESTRA RED DE CANALES*\n\nAquí tienes el listado de las comunidades donde tu anuncio será visto:\n\n*🔥 CANALES GRANDES (Planes Élite/VIP/Mensual)*\n`;
            CANALES.grandes.forEach(c => msgCanales += `▪️ [${c.name}](${c.link})\n`);
            
            msgCanales += `\n*🚀 CANALES PEQUEÑOS (Planes Básico/VIP/Mensual)*\n`;
            CANALES.pequenos.forEach(c => msgCanales += `▪️ [${c.name}](${c.link})\n`);

            msgCanales += `\n_Todos nuestros canales cuentan con público 100% real y activo._`;

            bot.deleteMessage(chatId, msgId).catch(()=>{});
            bot.sendPhoto(chatId, IMG_CANALES, {
                caption: msgCanales,
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: [[{ text: '⬅️ Volver al Panel', callback_data: 'ads_back_main' }]]
                }
            });
            return;
        }

        // --- ESTADO DEL ANUNCIO (BARRA DE PROGRESO) ---
        if (data === 'ads_ad_status') {
            const activeAd = await mongoDb.collection('active_ads').findOne({ userId: chatId });
            
            if (!activeAd) {
                bot.answerCallbackQuery(query.id, { text: "No tienes ningún anuncio activo en este momento.", show_alert: true });
                return;
            }

            const now = Date.now();
            const totalTime = activeAd.deleteAt - activeAd.createdAt;
            const elapsedTime = now - activeAd.createdAt;
            
            let percent = Math.floor((elapsedTime / totalTime) * 100);
            if (percent > 100) percent = 100;
            if (percent < 0) percent = 0;

            // Crear la barra de progreso (10 bloques)
            const filledBlocks = Math.round(percent / 10);
            const emptyBlocks = 10 - filledBlocks;
            const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);

            // Calcular tiempo restante
            const timeLeftMs = activeAd.deleteAt - now;
            const hoursLeft = Math.floor(timeLeftMs / (1000 * 60 * 60));
            const minutesLeft = Math.floor((timeLeftMs % (1000 * 60 * 60)) / (1000 * 60));

            let linkText = "";
            activeAd.publishedMessages.forEach((msg, index) => {
                linkText += `🔗 [Ver Anuncio ${index + 1}](https://t.me/c/${msg.channelId.toString().replace('-100', '')}/${msg.messageId})\n`;
            });

            const statusMsg = `📡 *ESTADO DE TU CAMPAÑA*\n\n` +
                              `📦 *Plan:* ${PLANES[activeAd.planCode].nombre}\n` +
                              `⏱ *Progreso:* ${percent}%\n` +
                              `[${progressBar}]\n\n` +
                              `⏳ *Tiempo Restante:* ${hoursLeft} hrs y ${minutesLeft} min\n\n` +
                              `*Enlaces directos:*\n${linkText}`;

            // Si se actualiza, editamos para no parpadear la pantalla, si viene de otro lado, enviamos nuevo.
            bot.deleteMessage(chatId, msgId).catch(()=>{});
            bot.sendMessage(chatId, statusMsg, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Actualizar Estado', callback_data: 'ads_ad_status' }],
                        [{ text: '⬅️ Volver al Panel', callback_data: 'ads_back_main' }]
                    ]
                }
            });
            bot.answerCallbackQuery(query.id);
            return;
        }

        // --- LISTA DE PLANES ---
        if (data === 'ads_view_plans') {
            const textPlanes = `🔥 *SELECCIONA TU PAQUETE PUBLICITARIO*\n\nPresiona un plan para ver los detalles:`;
            bot.deleteMessage(chatId, msgId).catch(()=>{});
            bot.sendMessage(chatId, textPlanes, {
                parse_mode: 'Markdown',
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

        // --- VER DETALLE DE UN PLAN ---
        if (data.startsWith('ads_detail_')) {
            const planCode = data.replace('ads_detail_', '');
            const plan = PLANES[planCode];

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

        // --- HABLAR CON UN ASESOR ---
        if (data.startsWith('ads_advisor_')) {
            const planCode = data.replace('ads_advisor_', '');
            const plan = PLANES[planCode];

            bot.answerCallbackQuery(query.id, { text: "Contactando asesor..." });
            
            bot.deleteMessage(chatId, msgId).catch(()=>{});
            bot.sendMessage(chatId, `✅ *He notificado al administrador* que estás interesado en el *${plan.nombre}*.\n\nTe contactará pronto a tu chat privado.`, { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '⬅️ Volver al Panel', callback_data: 'ads_back_main' }]] }
            });

            const userLink = query.from.username ? `https://t.me/${query.from.username}` : `tg://user?id=${query.from.id}`;
            const adminMsg = `🔔 *NUEVO CLIENTE INTERESADO*\n\n👤 Usuario: ${query.from.first_name}\n📦 Plan: *${plan.nombre}*\n\nPresiona el botón para activarle el plan manualmente si ya te pagó.`;

            bot.sendMessage(ADMIN_CHAT_ID, adminMsg, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💬 Hablar con el Usuario', url: userLink }],
                        [{ text: `✅ Activarle ${plan.nombre}`, callback_data: `admin_ad_direct_approve_${chatId}_${planCode}` }]
                    ]
                }
            });
            return;
        }

        // =====================================================================
        // 2. LÓGICA DEL ADMINISTRADOR
        // =====================================================================
        
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

                bot.sendMessage(userId, `🎉 *¡PAGO APROBADO!*\n\nTu plan *${PLANES[planCode].nombre}* está activo.\nEntra al Panel de Publicidad para lanzar tu anuncio.`, { 
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: 'Ir al Panel', callback_data: 'ads_open_dashboard' }]] }
                });
                bot.editMessageCaption(`✅ *PAGO APROBADO*\nPlan: ${PLANES[planCode].nombre}`, { chat_id: ADMIN_CHAT_ID, message_id: msgId, parse_mode: 'Markdown' });
            }
            return;
        }

        if (data.startsWith('admin_ad_direct_approve_')) {
            const parts = data.split('_');
            const userId = parseInt(parts[4]);
            const planCode = parts[5];

            await mongoDb.collection('ad_users').updateOne(
                { userId: userId },
                { $set: { planCode: planCode, postsDisponibles: PLANES[planCode].posts, lastUpdate: Date.now() } },
                { upsert: true }
            );

            bot.sendMessage(userId, `🎉 *¡TU PLAN HA SIDO ACTIVADO!*\n\nTu plan *${PLANES[planCode].nombre}* está listo para usarse.`, { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: 'Ir al Panel', callback_data: 'ads_open_dashboard' }]] }
            });
            bot.editMessageText(`✅ *PLAN ACTIVADO MANUALMENTE*\nSe le otorgó el plan ${PLANES[planCode].nombre}.`, { chat_id: ADMIN_CHAT_ID, message_id: msgId, parse_mode: 'Markdown' });
            return;
        }
        
        if (data === 'ads_create_post') {
            const user = await mongoDb.collection('ad_users').findOne({ userId: chatId });
            const activeAd = await mongoDb.collection('active_ads').findOne({ userId: chatId });

            if (activeAd) {
                bot.answerCallbackQuery(query.id, { text: "⚠️ Ya tienes un anuncio corriendo. Espera a que termine.", show_alert: true });
                return;
            }

            if (!user || user.postsDisponibles <= 0) {
                bot.answerCallbackQuery(query.id, { text: "⚠️ No tienes un plan activo.", show_alert: true });
                return;
            }

            adState[chatId] = { step: 'awaiting_ad_content', planCode: user.planCode };
            bot.deleteMessage(chatId, msgId).catch(()=>{});
            bot.sendMessage(chatId, "📝 *¡Prepara tu anuncio!*\n\nEnvíame el contenido exacto (Foto + Texto, Video, o solo Texto).\n\n_Lo que envíes ahora será reenviado tal cual a nuestra red._", { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'ads_back_main' }]] }
            });
            bot.answerCallbackQuery(query.id);
        }

        if (data === 'ads_publish_confirm') {
            const state = adState[chatId];
            if (!state || !state.msgIdToCopy) return;

            bot.editMessageText("🚀 Disparando tu anuncio a la red, por favor espera...", { chat_id: chatId, message_id: msgId });

            const planInfo = PLANES[state.planCode];
            let targetChannels = [];
            
            if (planInfo.tipo === 'pequenos') targetChannels = CANALES.pequenos;
            else if (planInfo.tipo === 'grandes') targetChannels = [CANALES.grandes[0]]; 
            else if (planInfo.tipo === 'todos') targetChannels = [...CANALES.pequenos, ...CANALES.grandes];

            let publishedMessages = [];
            let publishSuccess = false;

            for (const channel of targetChannels) {
                if (!channel.id) continue;
                try {
                    const result = await bot.copyMessage(channel.id, chatId, state.msgIdToCopy);
                    publishedMessages.push({ channelId: channel.id, messageId: result.message_id });
                    publishSuccess = true;
                } catch (err) {
                    console.error(`Error copiando a canal ${channel.name}:`, err.message);
                }
            }

            if (publishSuccess) {
                const now = Date.now();
                const deleteAt = now + (planInfo.horas * 60 * 60 * 1000);
                
                // Guardamos el createdAt para poder calcular la barra de progreso
                await mongoDb.collection('active_ads').insertOne({
                    userId: chatId, planCode: state.planCode, createdAt: now, deleteAt: deleteAt, publishedMessages: publishedMessages
                });

                await mongoDb.collection('ad_users').updateOne(
                    { userId: chatId }, { $inc: { postsDisponibles: -1 } }
                );

                bot.deleteMessage(chatId, msgId).catch(()=>{});
                bot.sendMessage(chatId, `✅ *¡LANZAMIENTO EXITOSO!*\n\nTu anuncio ya está visible. Puedes monitorear el tiempo restante desde el Panel.`, { 
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '📊 Ver Estado', callback_data: 'ads_ad_status' }]] }
                });
            } else {
                bot.sendMessage(chatId, `❌ Hubo un error al publicar. Avisa al soporte.`);
            }

            delete adState[chatId]; 
        }
    });
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const state = adState[chatId];

        if (!state) return;

        if (state.step === 'awaiting_receipt') {
            if (!msg.photo && !msg.document) {
                bot.sendMessage(chatId, "⚠️ Debes enviar una *FOTO* o archivo de tu comprobante.", { parse_mode: 'Markdown' });
                return;
            }

            const planCode = state.plan;
            delete adState[chatId]; 

            bot.sendMessage(chatId, "⏳ Comprobante en revisión. Te notificaremos pronto.");

            const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;
            bot.sendPhoto(ADMIN_CHAT_ID, fileId, {
                caption: `💰 *PAGO RECIBIDO*\n\nUsuario: ${msg.from.first_name}\nID: ${chatId}\nPlan: *${PLANES[planCode].nombre}*`,
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

        else if (state.step === 'awaiting_ad_content') {
            if (msg.text && msg.text.startsWith('/')) return; 

            adState[chatId].msgIdToCopy = msg.message_id;
            adState[chatId].step = 'confirm_publish';

            bot.sendMessage(chatId, "👀 **Revisa tu anuncio arriba.**\n¿Confirmas que deseas enviarlo a la red?", {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ SÍ, PUBLICAR AHORA', callback_data: 'ads_publish_confirm' }],
                        [{ text: '🔄 Enviar de nuevo', callback_data: 'ads_create_post' }],
                        [{ text: '❌ Cancelar', callback_data: 'ads_open_dashboard' }]
                    ]
                },
                reply_to_message_id: msg.message_id 
            });
        }
    });
    setInterval(async () => {
        try {
            const now = Date.now();
            const expiredAds = await mongoDb.collection('active_ads').find({ deleteAt: { $lte: now } }).toArray();

            for (const ad of expiredAds) {
                for (const msgData of ad.publishedMessages) {
                    try { await bot.deleteMessage(msgData.channelId, msgData.messageId); } catch (err) {}
                }
                await mongoDb.collection('active_ads').deleteOne({ _id: ad._id });
                bot.sendMessage(ad.userId, "⏱ *Tu anuncio ha finalizado.* La publicación fue retirada de los canales automáticamente.\n\n¡Gracias por tu confianza, te esperamos de vuelta!", { 
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: 'Renovar Plan', callback_data: 'ads_open_dashboard' }]]}
                }).catch(()=>{});
            }
        } catch (error) { console.error("Error Cron Ads:", error); }
    }, 15 * 60 * 1000); // Revisión cada 15 minutos para ser más precisos
}

module.exports = initializePublicAds;
