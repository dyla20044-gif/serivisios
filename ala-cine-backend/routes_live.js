const NodeCache = require('node-cache');

// Caché para no saturar MongoDB con la consulta principal
const liveCache = new NodeCache({ stdTTL: 60, checkperiod: 120 }); 

// --- MAGIA EN RAM (Escudo de Base de Datos) ---
// Aquí se guardarán las vistas de forma temporal. 
// Si el servidor se reinicia, vuelven a su base. ¡No tocan MongoDB!
const liveViewers = {
    hero: 120, // Base inicial para el evento principal
    secondary: {} // Se llenará dinámicamente con los IDs de las tarjetas secundarias
};

module.exports = function(app, ctx) {
    const { getMongoDb } = ctx;

    if (!ctx.caches) ctx.caches = {};
    ctx.caches.liveCache = liveCache;

    app.get('/api/system-feed', async (req, res) => {
        try {
            let liveData = liveCache.get('current_live_feed');
            
            if (!liveData) {
                const mongoDb = getMongoDb();
                if (!mongoDb) return res.status(200).json({ config: { isActive: false } });
                
                liveData = await mongoDb.collection('live_feed_config').findOne({ _id: 'main_feed' });
                if (liveData) {
                    delete liveData._id;
                    liveCache.set('current_live_feed', liveData);
                } else {
                    return res.status(200).json({ config: { isActive: false } });
                }
            }

            // Inyectamos las vistas desde la RAM antes de enviar el JSON a la App
            const responseData = JSON.parse(JSON.stringify(liveData)); 
            
            if (responseData.heroEvent) {
                // Suma un pequeño número aleatorio simulando tráfico orgánico
                const organicBoost = Math.floor(Math.random() * 4); 
                liveViewers.hero += organicBoost;
                responseData.heroEvent.viewers = liveViewers.hero;
            }
            
            if (responseData.secondaryEvents && responseData.secondaryEvents.length > 0) {
                responseData.secondaryEvents = responseData.secondaryEvents.map(ev => {
                    const organicBoost = Math.floor(Math.random() * 2);
                    if (!liveViewers.secondary[ev.id]) liveViewers.secondary[ev.id] = 45; // Base inicial para secundarios
                    liveViewers.secondary[ev.id] += organicBoost;
                    ev.viewers = liveViewers.secondary[ev.id];
                    return ev;
                });
            }

            return res.status(200).json(responseData);
        } catch (error) {
            console.error("Error obteniendo el system-feed:", error);
            res.status(200).json({ config: { isActive: false } });
        }
    });

    // --- ENDPOINT ESCUDO ---
    // Recibe los clics de la App y los suma a la RAM sin tocar la Base de Datos
    app.get('/api/update-news-metrics', (req, res) => {
        const { id } = req.query;
        
        if (!id) {
            liveViewers.hero += 1;
        } else {
            if (!liveViewers.secondary[id]) liveViewers.secondary[id] = 45;
            liveViewers.secondary[id] += 1;
        }
        
        // Responder un 200 vacío e instantáneo para que la App no se quede cargando
        res.status(200).send();
    });
};
