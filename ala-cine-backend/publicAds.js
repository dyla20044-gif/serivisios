const fs = require('fs');

// Función de pausa (Delay) para evitar spam en Telegram
const delay = ms => new Promise(res => setTimeout(res, ms));

function initializePublicAds(bot, mongoDb, ADMIN_CHAT_ID) {

    // ✏️ IMÁGENES DE INTERFAZ (Reemplaza con tus links PNG/JPG si deseas)
    const IMG_DASHBOARD = 'https://marketing4ecommerce.mx/wp-content/uploads/2022/12/Plantilla-3-Tops-1.jpeg';
    const IMG_CANALES = 'https://nuteco.b-cdn.net/wp-content/uploads/2021/12/telegram-anuncios.jpg';

    // =====================================================================
    // ✏️ CONFIGURACIÓN DE CANALES (Enlazado a variables de entorno de Render)
    // =====================================================================
    // El filtro ".filter(c => c.id)" evita que el bot se rompa si agregas un canal 
    // aquí pero olvidas crear la variable en Render.
    
    const CANALES = {
        pequenos: [
            { id: process.env.CH_PEQ_1, link: 'https://t.me/tu_enlace1', name: 'Canal Pelis (60k)' },
            { id: process.env.CH_PEQ_2, link: 'https://t.me/tu_enlace2', name: 'Canal Anime (45k)' },
            { id: process.env.CH_PEQ_3, link: 'https://t.me/tu_enlace3', name: 'Canal Memes (30k)' },
    
        ].filter(c => c.id), // <- Filtro de seguridad vital

        grandes: [
            { id: process.env.CH_GRA_1, link: 'https://t.me/+dpOprbZD6fFjMjhh', name: 'Canal Principal (120k)' },
            { id: process.env.CH_GRA_2, link: 'https://t.me/+C8xLlSwkqSc3ZGU5', name: 'Canal Series Premium (100k)' },
            
            // ➕ ¿CÓMO AGREGAR MÁS CANALES GRANDES?
            // Sigue el mismo proceso que arriba, pero usando variables como CH_GRA_3, CH_GRA_4, etc.
            
            // { id: process.env.CH_GRA_3, link: 'https://t.me/tu_enlace_g3', name: 'Canal Vip (90k)' },
            // { id: process.env.CH_GRA_4, link: 'https://t.me/tu_enlace_g4', name: 'Canal Extra Vip (85k)' },
        ].filter(c => c.id) // <- Filtro de seguridad vital
    };

    // ✏️ CONFIGURACIÓN DE PLANES
    const PLANES = {
        basico_1: { 
            id: "basico_1", nombre: "Básico (1 Canal Peq.)", precio: "$20 USD", horas: 30, tipo: "pequenos_single", posts: 1, refrescos: 1,
            imagen: "https://i.ibb.co/p6f15vKC/Gemini-Generated-Image-h1ttpuh1ttpuh1tt.png",
            descripcion: "🚀 *PLAN BÁSICO*\n\nElige *1 canal pequeño* de nuestra red.\n\n🔹 *¿Qué incluye?*\n- Publicación en 1 canal a tu elección.\n- Duración: *30 horas*.\n- 🔄 *1 Refresco* (Puedes republicarlo para subirlo de posición).\n\n💵 *Inversión:* $20 USD"
        },
        basico_todos: { 
            id: "basico_todos", nombre: "Mega Básico (Todos Peq.)", precio: "$30 USD", horas: 30, tipo: "pequenos_all", posts: 1, refrescos: 1,
            imagen: "https://i.ibb.co/p6f15vKC/Gemini-Generated-Image-h1ttpuh1ttpuh1tt.png",
            descripcion: "🔥 *MEGA BÁSICO*\n\nTu anuncio en *TODOS nuestros canales pequeños*.\n\n🔹 *¿Qué incluye?*\n- Publicación masiva en canales < 60k.\n- Duración: *30 horas*.\n- 🔄 *1 Refresco* disponible.\n\n💵 *Inversión:* $30 USD"
        },
        elite: { 
            id: "elite", nombre: "Plan Élite (1 Canal Grande)", precio: "$35 USD", horas: 30, tipo: "grandes_single", posts: 1, refrescos: 1,
            imagen: "https://i.ibb.co/p6f15vKC/Gemini-Generated-Image-h1ttpuh1ttpuh1tt.png",
            descripcion: "💎 *PLAN ÉLITE*\n\nLlega a las masas. Elige *1 canal principal*.\n\n🔹 *¿Qué incluye?*\n- Publicación en 1 canal GRANDE.\n- Máxima visibilidad por *30 horas*.\n- 🔄 *1 Refresco*.\n\n💵 *Inversión:* $35 USD"
        },
        combo: { 
            id: "combo", nombre: "👑 COMBO VIP (Todos)", precio: "$80 USD", horas: 48, tipo: "todos", posts: 1, refrescos: 2,
            imagen: "https://i.ibb.co/bR32xHpw/Gemini-Generated-Image-qrqbqeqrqbqeqrqb.png",
            descripcion: "👑 *COMBO VIP*\n\nDominación total. Publicación en *TODOS los canales (Grandes y Pequeños)*.\n\n🔹 *¿Qué incluye?*\n- Duración extendida: *48 horas*.\n- 🔄 *2 Refrescos* estratégicos.\n\n💵 *Inversión:* $80 USD"
        },
        mensual: { 
            id: "mensual", nombre: "🏆 MENSUAL PRO", precio: "$150 USD", horas: 48, tipo: "todos", posts: 15, refrescos: 0, 
            imagen: "https://i.ibb.co/bR32xHpw/Gemini-Generated-Image-qrqbqeqrqbqeqrqb.png",
            descripcion: "🏆 *PLAN MENSUAL PRO*\n\nPara creadores constantes. \n\n🔹 *¿Qué incluye?*\n- *15 Publicaciones* disponibles al mes para TODOS los canales.\n- Cada publicación dura 48 horas.\n\n💵 *Inversión:* $150 USD / Mes"
        }
    };

    const METODOS_PAGO = `💳 *MÉTODOS DE PAGO DISPONIBLES*\n\n` +
        `🟡 *BINANCE PAY*\nPay ID: \`853699772\`\nUSDT TRC20: \`TPBbBjmtedKKst42MZCGbqNx4BhpuHDTHb\`\n\n` +
        `🔵 *PAYPAL*\nEnlace: \`no disponible\`\n\n` +
        `⚠️ *INSTRUCCIONES:*\nUna vez realizado el pago, **envíame por aquí mismo la FOTO/CAPTURA del comprobante**.`;

    const adState = {};

    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const data = query.data;
        const msgId = query.message.message_id;
        const isAdmin = chatId.toString() === ADMIN_CHAT_ID.toString();

        // ==========================================
        // 1. DASHBOARD PRINCIPAL
        // ==========================================
        if (data === 'ads_open_dashboard' || data === 'ads_back_main') {
            const user = await mongoDb.collection('ad_users').findOne({ userId: chatId });
            const activeAd = await mongoDb.collection('active_ads').findOne({ userId: chatId });
            
            let statusText = "❌ Sin Plan Activo";
            let planType = "Ninguno";
            let buttons = [];

            if (activeAd) {
                statusText = `🟢 Anuncio en circulación`;
                planType = PLANES[activeAd.planCode]?.nombre || "Desconocido";
                buttons.push([{ text: '📊 Ver Estado de mi Anuncio', callback_data: 'ads_ad_status' }]);
                
                if (activeAd.refrescos > 0) {
                    buttons.push([{ text: `🔄 Refrescar Anuncio (${activeAd.refrescos} disp.)`, callback_data: 'ads_ask_refresh' }]);
                }

                if (user && user.postsDisponibles > 0) {
                    buttons.push([{ text: `📝 Te quedan ${user.postsDisponibles} posts (Mensual)`, callback_data: 'noop' }]);
                }
            } else if (user && user.postsDisponibles > 0) {
                statusText = `✅ Tienes ${user.postsDisponibles} publicación(es) disponible(s)`;
                planType = PLANES[user.planCode]?.nombre || "Desconocido";
                buttons.push([{ text: '🚀 Lanzar Mi Publicidad Ahora', callback_data: 'ads_create_post' }]);
                buttons.push([{ text: '🔄 Comprar otro Plan', callback_data: 'ads_view_plans' }]); 
            } else {
                buttons.push([{ text: '🛒 Ver Planes y Precios', callback_data: 'ads_view_plans' }]);
            }

            buttons.push([{ text: '📢 Ver Nuestra Red de Canales', callback_data: 'ads_view_channels' }]);

            if (isAdmin) {
                buttons.push([{ text: '⚙️ Modo Administrador (Usuarios Activos)', callback_data: 'admin_view_active_users' }]);
            }

            const dashboardMsg = `📊 *CENTRO DE ANUNCIANTES PRO*\n\n👤 *Usuario:* ${query.from.first_name}\n📈 *Estado:* ${statusText}\n💎 *Plan Actual:* ${planType}\n\nBienvenido a la mejor red de publicidad. ¿Qué deseas hacer?`;

            bot.deleteMessage(chatId, msgId).catch(()=>{});
            bot.sendPhoto(chatId, IMG_DASHBOARD, {
                caption: dashboardMsg,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });
            bot.answerCallbackQuery(query.id);
            return;
        }

        // ==========================================
        // 2. VER CANALES
        // ==========================================
        if (data === 'ads_view_channels') {
            let msgCanales = `🌍 *NUESTRA RED DE CANALES*\n\n*🔥 CANALES GRANDES*\n`;
            if (CANALES.grandes.length === 0) msgCanales += `_Aún no hay canales configurados_\n`;
            CANALES.grandes.forEach(c => msgCanales += `▪️ [${c.name}](${c.link})\n`);
            
            msgCanales += `\n*🚀 CANALES PEQUEÑOS*\n`;
            if (CANALES.pequenos.length === 0) msgCanales += `_Aún no hay canales configurados_\n`;
            CANALES.pequenos.forEach(c => msgCanales += `▪️ [${c.name}](${c.link})\n`);

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

        // ==========================================
        // 3. ESTADO DEL ANUNCIO Y REFRESCO (BUMP)
        // ==========================================
        if (data === 'ads_ad_status') {
            const activeAd = await mongoDb.collection('active_ads').findOne({ userId: chatId });
            if (!activeAd) return bot.answerCallbackQuery(query.id, { text: "No tienes anuncios activos.", show_alert: true });

            const now = Date.now();
            const totalTime = activeAd.deleteAt - activeAd.createdAt;
            const elapsedTime = now - activeAd.createdAt;
            let percent = Math.max(0, Math.min(100, Math.floor((elapsedTime / totalTime) * 100)));

            const filledBlocks = Math.round(percent / 10);
            const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(10 - filledBlocks);

            const timeLeftMs = activeAd.deleteAt - now;
            const hoursLeft = Math.floor(timeLeftMs / (1000 * 60 * 60));
            const minutesLeft = Math.floor((timeLeftMs % (1000 * 60 * 60)) / (1000 * 60));

            let linkText = "";
            activeAd.publishedMessages.forEach((msg, index) => {
                linkText += `🔗 [Ver Anuncio ${index + 1}](https://t.me/c/${msg.channelId.toString().replace('-100', '')}/${msg.messageId})\n`;
            });

            const statusMsg = `📡 *ESTADO DE TU CAMPAÑA*\n\n📦 *Plan:* ${PLANES[activeAd.planCode].nombre}\n⏱ *Progreso:* ${percent}%\n[${progressBar}]\n\n⏳ *Tiempo Restante:* ${hoursLeft} hrs y ${minutesLeft} min\n🔄 *Refrescos Disp:* ${activeAd.refrescos}\n\n*Tus Enlaces:*\n${linkText}`;

            bot.deleteMessage(chatId, msgId).catch(()=>{});
            bot.sendMessage(chatId, statusMsg, {
                parse_mode: 'Markdown', disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Actualizar Progreso', callback_data: 'ads_ad_status' }],
                        [{ text: '⬅️ Volver al Panel', callback_data: 'ads_back_main' }]
                    ]
                }
            });
            bot.answerCallbackQuery(query.id);
            return;
        }

        if (data === 'ads_ask_refresh') {
            const msg = `⚠️ *¿QUIERES REFRESCAR TU ANUNCIO?*\n\nAl hacer esto, borraremos tu anuncio actual y lo publicaremos como *NUEVO* para que quede al final del canal y todos lo vean.\n\n💡 *Consejo:* Te recomendamos esperar a "horas pico" (tarde/noche) para usar tu refresco.\n\n¿Deseas gastar 1 refresco ahora?`;
            bot.editMessageCaption(msg, { 
                chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ SÍ, Refrescar Ahora', callback_data: 'ads_do_refresh' }],
                        [{ text: '⏳ Mejor espero', callback_data: 'ads_back_main' }]
                    ]
                }
            }).catch(()=>{});
            return;
        }

        if (data === 'ads_do_refresh') {
            const activeAd = await mongoDb.collection('active_ads').findOne({ userId: chatId });
            if (!activeAd || activeAd.refrescos <= 0) return bot.answerCallbackQuery(query.id, { text: "No tienes refrescos disponibles.", show_alert: true });

            bot.editMessageCaption("🔄 Refrescando tu anuncio en la red, por favor espera...", { chat_id: chatId, message_id: msgId });

            let newPublishedMessages = [];
            let publishSuccess = false;

            for (const msgData of activeAd.publishedMessages) {
                try {
                    await bot.deleteMessage(msgData.channelId, msgData.messageId).catch(()=>{});
                    const result = await bot.copyMessage(msgData.channelId, chatId, activeAd.originalMsgId);
                    newPublishedMessages.push({ channelId: msgData.channelId, messageId: result.message_id });
                    publishSuccess = true;
                    await delay(4000); 
                } catch (err) { console.error("Error al refrescar:", err.message); }
            }

            if (publishSuccess) {
                await mongoDb.collection('active_ads').updateOne(
                    { _id: activeAd._id },
                    { $set: { publishedMessages: newPublishedMessages }, $inc: { refrescos: -1 } }
                );
                bot.deleteMessage(chatId, msgId).catch(()=>{});
                bot.sendMessage(chatId, "✨ *¡ANUNCIO REFRESCADO!*\n\nTu publicidad vuelve a estar en la cima de atención.", {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '📊 Ver Estado', callback_data: 'ads_ad_status' }]] }
                });
            } else {
                bot.sendMessage(chatId, "❌ Error al refrescar. Contacta soporte.");
            }
            return;
        }

        // ==========================================
        // 4. PLANES Y PAGOS
        // ==========================================
        if (data === 'ads_view_plans') {
            const textPlanes = `🔥 *SELECCIONA TU PAQUETE PUBLICITARIO*\n\nPresiona un plan para ver detalles:`;
            bot.deleteMessage(chatId, msgId).catch(()=>{});
            bot.sendMessage(chatId, textPlanes, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🟢 Básico 1 Canal (${PLANES.basico_1.precio})`, callback_data: 'ads_detail_basico_1' }],
                        [{ text: `🟢 Mega Básico Todos (${PLANES.basico_todos.precio})`, callback_data: 'ads_detail_basico_todos' }],
                        [{ text: `🟠 Élite 1 Grande (${PLANES.elite.precio})`, callback_data: 'ads_detail_elite' }],
                        [{ text: `👑 VIP Todos (${PLANES.combo.precio})`, callback_data: 'ads_detail_combo' }],
                        [{ text: `🏆 MENSUAL PRO (${PLANES.mensual.precio})`, callback_data: 'ads_detail_mensual' }],
                        [{ text: '⬅️ Volver', callback_data: 'ads_back_main' }]
                    ]
                }
            });
            return;
        }

        if (data.startsWith('ads_detail_')) {
            const planCode = data.replace('ads_detail_', '');
            const plan = PLANES[planCode];
            bot.deleteMessage(chatId, msgId).catch(()=>{});
            bot.sendPhoto(chatId, plan.imagen, {
                caption: plan.descripcion, parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💳 Pagar Ahora', callback_data: `ads_pay_${planCode}` }],
                        [{ text: '⬅️ Volver', callback_data: 'ads_view_plans' }]
                    ]
                }
            });
            return;
        }

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

        // ==========================================
        // 5. PUBLICAR ANUNCIO Y SELECCIÓN DE CANAL
        // ==========================================
        if (data === 'ads_create_post') {
            const user = await mongoDb.collection('ad_users').findOne({ userId: chatId });
            const activeAd = await mongoDb.collection('active_ads').findOne({ userId: chatId });

            if (activeAd) return bot.answerCallbackQuery(query.id, { text: "⚠️ Ya tienes un anuncio corriendo.", show_alert: true });
            if (!user || user.postsDisponibles <= 0) return bot.answerCallbackQuery(query.id, { text: "⚠️ No tienes un plan activo.", show_alert: true });

            const planInfo = PLANES[user.planCode];
            adState[chatId] = { step: 'awaiting_ad_content', planCode: user.planCode };

            if (planInfo.tipo === 'pequenos_single' || planInfo.tipo === 'grandes_single') {
                adState[chatId].step = 'awaiting_channel_selection';
                const canalesDisponibles = planInfo.tipo === 'pequenos_single' ? CANALES.pequenos : CANALES.grandes;
                
                if (canalesDisponibles.length === 0) {
                    return bot.answerCallbackQuery(query.id, { text: "⚠️ No hay canales configurados para este plan.", show_alert: true });
                }

                let botonesCanales = [];
                canalesDisponibles.forEach((c, index) => {
                    botonesCanales.push([{ text: `📌 ${c.name}`, callback_data: `ads_select_ch_${planInfo.tipo}_${index}` }]);
                });
                botonesCanales.push([{ text: '❌ Cancelar', callback_data: 'ads_back_main' }]);

                bot.deleteMessage(chatId, msgId).catch(()=>{});
                bot.sendMessage(chatId, "🎯 *ELIGE TU CANAL*\n\nTu plan te permite publicar en 1 canal. Selecciona en cuál de estos deseas aparecer:", {
                    parse_mode: 'Markdown', reply_markup: { inline_keyboard: botonesCanales }
                });
            } else {
                bot.deleteMessage(chatId, msgId).catch(()=>{});
                bot.sendMessage(chatId, "📝 *¡Prepara tu anuncio!*\n\nEnvíame el contenido exacto (Foto/Video + Texto).\n\n_Lo que envíes será reenviado tal cual a la red._", { 
                    parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'ads_back_main' }]] }
                });
            }
            bot.answerCallbackQuery(query.id);
            return;
        }

        if (data.startsWith('ads_select_ch_')) {
            const parts = data.split('_');
            const tipo = parts[3] + "_" + parts[4]; 
            const index = parseInt(parts[5]);

            const canalSeleccionado = tipo === 'pequenos_single' ? CANALES.pequenos[index] : CANALES.grandes[index];
            adState[chatId].targetChannelId = canalSeleccionado.id;
            adState[chatId].step = 'awaiting_ad_content';

            bot.deleteMessage(chatId, msgId).catch(()=>{});
            bot.sendMessage(chatId, `✅ *Canal Seleccionado:* ${canalSeleccionado.name}\n\n📝 Ahora envíame el contenido exacto de tu anuncio (Foto/Video + Texto).`, {
                parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Cancelar', callback_data: 'ads_back_main' }]] }
            });
            return;
        }

        if (data === 'ads_publish_confirm') {
            const state = adState[chatId];
            if (!state || !state.msgIdToCopy) return;

            bot.editMessageText("🚀 Disparando tu anuncio... Esto puede tomar unos segundos.", { chat_id: chatId, message_id: msgId });

            const planInfo = PLANES[state.planCode];
            let targetChannels = [];
            
            if (state.targetChannelId) {
                targetChannels = [{ id: state.targetChannelId }]; 
            } else if (planInfo.tipo === 'pequenos_all') {
                targetChannels = CANALES.pequenos;
            } else if (planInfo.tipo === 'todos') {
                targetChannels = [...CANALES.pequenos, ...CANALES.grandes];
            }

            let publishedMessages = [];
            let publishSuccess = false;

            for (const channel of targetChannels) {
                if (!channel.id) continue;
                try {
                    const result = await bot.copyMessage(channel.id, chatId, state.msgIdToCopy);
                    publishedMessages.push({ channelId: channel.id, messageId: result.message_id });
                    publishSuccess = true;
                    if (targetChannels.length > 1) await delay(4000); 
                } catch (err) { console.error(`Error copiando a ${channel.id}:`, err.message); }
            }

            if (publishSuccess) {
                const now = Date.now();
                const deleteAt = now + (planInfo.horas * 60 * 60 * 1000);
                
                await mongoDb.collection('active_ads').insertOne({
                    userId: chatId, planCode: state.planCode, createdAt: now, deleteAt: deleteAt, 
                    publishedMessages: publishedMessages, refrescos: planInfo.refrescos, originalMsgId: state.msgIdToCopy
                });

                await mongoDb.collection('ad_users').updateOne(
                    { userId: chatId }, { $inc: { postsDisponibles: -1 } }
                );

                bot.deleteMessage(chatId, msgId).catch(()=>{});
                bot.sendMessage(chatId, `✅ *¡LANZAMIENTO EXITOSO!*\n\nTu anuncio ya está visible. Usa el panel para ver el tiempo restante o usar tus refrescos.`, { 
                    parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📊 Ir al Panel', callback_data: 'ads_open_dashboard' }]] }
                });
            } else {
                bot.sendMessage(chatId, `❌ Hubo un error al publicar. Verifica que el bot sea administrador en los canales.`);
            }
            delete adState[chatId]; 
            return;
        }

        // ==========================================
        // 6. MÓDULO ADMINISTRADOR (PAGOS Y CANCELACIONES)
        // ==========================================
        if (isAdmin && data.startsWith('admin_ad_approve_') || data.startsWith('admin_ad_reject_')) {
            const parts = data.split('_');
            const action = parts[2]; 
            const userId = parseInt(parts[3]);
            const planCode = parts.slice(4).join('_'); 
            
            if (action === 'reject') {
                bot.sendMessage(userId, "❌ *Tu comprobante ha sido rechazado.* Contacta al soporte.", { parse_mode: 'Markdown' });
                bot.editMessageCaption("❌ *PAGO RECHAZADO*", { chat_id: ADMIN_CHAT_ID, message_id: msgId, parse_mode: 'Markdown' });
            } 
            else if (action === 'approve') {
                await mongoDb.collection('ad_users').updateOne(
                    { userId: userId },
                    { $set: { planCode: planCode, postsDisponibles: PLANES[planCode].posts, lastUpdate: Date.now() } },
                    { upsert: true }
                );
                bot.sendMessage(userId, `🎉 *¡PAGO APROBADO!*\n\nTu plan *${PLANES[planCode].nombre}* está activo.`, { 
                    parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: 'Ir al Panel', callback_data: 'ads_open_dashboard' }]] }
                });
                bot.editMessageCaption(`✅ *PAGO APROBADO*\nPlan: ${PLANES[planCode].nombre}`, { chat_id: ADMIN_CHAT_ID, message_id: msgId, parse_mode: 'Markdown' });
            }
            return;
        }

        if (isAdmin && data === 'admin_view_active_users') {
            const actives = await mongoDb.collection('active_ads').find({}).toArray();
            if (actives.length === 0) return bot.answerCallbackQuery(query.id, { text: "No hay anuncios corriendo ahora.", show_alert: true });

            let adminMsg = "🛡 *PANEL ADMIN: ANUNCIOS ACTIVOS*\n\nSelecciona un usuario para cancelar su anuncio y borrarlo de los canales:\n";
            let botonesAdmin = [];

            actives.forEach(ad => {
                botonesAdmin.push([{ text: `❌ Eliminar Ad de ID: ${ad.userId}`, callback_data: `admin_force_cancel_${ad.userId}` }]);
            });
            botonesAdmin.push([{ text: '⬅️ Volver', callback_data: 'ads_open_dashboard' }]);

            bot.editMessageCaption(adminMsg, { chat_id: ADMIN_CHAT_ID, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: botonesAdmin } }).catch(()=>{});
            return;
        }

        if (isAdmin && data.startsWith('admin_force_cancel_')) {
            const targetUserId = parseInt(data.replace('admin_force_cancel_', ''));
            const activeAd = await mongoDb.collection('active_ads').findOne({ userId: targetUserId });

            if (activeAd) {
                for (const msgData of activeAd.publishedMessages) {
                    try { await bot.deleteMessage(msgData.channelId, msgData.messageId); } catch(e){}
                }
                await mongoDb.collection('active_ads').deleteOne({ userId: targetUserId });
                
                bot.answerCallbackQuery(query.id, { text: "Anuncio eliminado correctamente.", show_alert: true });
                bot.sendMessage(targetUserId, "🚫 *TU ANUNCIO FUE CANCELADO* por el administrador.", { parse_mode: 'Markdown' });
                bot.editMessageCaption("Anuncio eliminado. Cierra este mensaje.", { chat_id: ADMIN_CHAT_ID, message_id: msgId }).catch(()=>{});
            }
            return;
        }
    });

    // ==========================================
    // 7. RECEPCIÓN DE MENSAJES (FOTOS/COMPROBANTES)
    // ==========================================
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const state = adState[chatId];
        if (!state) return;

        if (state.step === 'awaiting_receipt') {
            if (!msg.photo && !msg.document) return bot.sendMessage(chatId, "⚠️ Debes enviar una *FOTO* o archivo de tu comprobante.", { parse_mode: 'Markdown' });

            const planCode = state.plan;
            delete adState[chatId]; 

            bot.sendMessage(chatId, "⏳ Comprobante en revisión. Te notificaremos pronto.");
            const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;
            
            bot.sendPhoto(ADMIN_CHAT_ID, fileId, {
                caption: `💰 *NUEVO PAGO*\n\nUsuario: ${msg.from.first_name}\nID: ${chatId}\nPlan: *${PLANES[planCode].nombre}*`,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [ { text: '✅ Aprobar', callback_data: `admin_ad_approve_${chatId}_${planCode}` }, { text: '❌ Rechazar', callback_data: `admin_ad_reject_${chatId}_${planCode}` } ]
                    ]
                }
            });
        }
        else if (state.step === 'awaiting_ad_content') {
            if (msg.text && msg.text.startsWith('/')) return; 

            adState[chatId].msgIdToCopy = msg.message_id;
            adState[chatId].step = 'confirm_publish';

            bot.sendMessage(chatId, "👀 **Revisa tu anuncio arriba.**\n¿Confirmas que deseas enviarlo?", {
                parse_mode: 'Markdown', reply_to_message_id: msg.message_id,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ SÍ, PUBLICAR AHORA', callback_data: 'ads_publish_confirm' }],
                        [{ text: '🔄 Enviar otra cosa', callback_data: 'ads_create_post' }],
                        [{ text: '❌ Cancelar', callback_data: 'ads_open_dashboard' }]
                    ]
                }
            });
        }
    });

    // ==========================================
    // ⚙️ CRON JOB: BORRADO AUTOMÁTICO (Cada 15 min)
    // ==========================================
    setInterval(async () => {
        try {
            const now = Date.now();
            const expiredAds = await mongoDb.collection('active_ads').find({ deleteAt: { $lte: now } }).toArray();

            for (const ad of expiredAds) {
                for (const msgData of ad.publishedMessages) {
                    try { await bot.deleteMessage(msgData.channelId, msgData.messageId); } catch (err) {}
                }
                await mongoDb.collection('active_ads').deleteOne({ _id: ad._id });
                bot.sendMessage(ad.userId, "⏱ *Tu anuncio ha finalizado y fue retirado de la red.* ¡Gracias por tu confianza!", { 
                    parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: 'Renovar Plan', callback_data: 'ads_open_dashboard' }]]}
                }).catch(()=>{});
            }
        } catch (error) { console.error("Error Cron Ads:", error); }
    }, 15 * 60 * 1000); 
}

module.exports = initializePublicAds;
