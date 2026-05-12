const NodeCache = require('node-cache');

// Caché exclusivo para el feed en vivo (60 segundos) para no saturar MongoDB
const liveCache = new NodeCache({ stdTTL: 60, checkperiod: 120 }); 

module.exports = function(app, ctx) {
    const { getMongoDb } = ctx;

    // Inyectamos este caché en el contexto global por si el Bot necesita limpiarlo
    if (!ctx.caches) ctx.caches = {};
    ctx.caches.liveCache = liveCache;

    // Endpoint que consume la aplicación móvil (feed.js)
    app.get('/api/system-feed', async (req, res) => {
        try {
            // 1. Revisar si tenemos la respuesta en caché
            const cachedFeed = liveCache.get('current_live_feed');
            if (cachedFeed) {
                return res.status(200).json(cachedFeed);
            }

            const mongoDb = getMongoDb();
            if (!mongoDb) {
                // Fallback de seguridad: si no hay BD, se apaga el módulo en la app
                return res.status(200).json({ config: { isActive: false } });
            }

            // 2. Buscar la configuración en MongoDB Atlas
            // Usaremos un documento único con el ID 'main_feed'
            const liveData = await mongoDb.collection('live_feed_config').findOne({ _id: 'main_feed' });

            if (liveData) {
                // Eliminamos el _id propio de Mongo para mandar un JSON limpio al frontend
                delete liveData._id;
                
                // Guardamos en caché y respondemos
                liveCache.set('current_live_feed', liveData);
                return res.status(200).json(liveData);
            } else {
                // 3. Estado por defecto si aún no has guardado nada desde el Bot
                const defaultState = { config: { isActive: false } };
                return res.status(200).json(defaultState);
            }
        } catch (error) {
            console.error("Error obteniendo el system-feed:", error);
            // Si hay un error, apagamos el sistema dinámico por seguridad
            res.status(200).json({ config: { isActive: false } });
        }
    });
};
