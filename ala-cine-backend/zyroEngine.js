const axios = require('axios');

module.exports = function(app, getDb, cache, TMDB_API_KEY) {
    app.get('/api/zyro-search', async (req, res) => {
        const { query } = req.query;
        if (!query) return res.status(400).json({ error: "Falta el parámetro 'query'" });

        // 1. SISTEMA DE CACHÉ (Evita saturar TMDB y tu Base de Datos)
        const cacheKey = `zyro_search_${query.toLowerCase().trim()}`;
        const cachedResult = cache.get(cacheKey);
        
        if (cachedResult) {
            console.log(`[ZYRO] Sirviendo desde caché: ${query}`);
            return res.json(cachedResult);
        }

        try {
            // 2. BUSCAR EN TMDB (Para obtener datos oficiales y póster)
            const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(query)}`);
            const results = tmdbRes.data.results;
            
            if (!results || results.length === 0) {
                return res.json({ metadata: null, enlaces: [] });
            }

            // Filtramos para asegurar que es peli o serie
            const bestMatch = results.find(r => r.media_type === 'movie' || r.media_type === 'tv') || results[0];
            const tmdbId = bestMatch.id;
            const mediaType = bestMatch.media_type || 'movie';
            const tituloOficial = bestMatch.title || bestMatch.name;

            let enlacesFinales = [];

            // 3. BUSCAR EN TU MONGODB (Tus enlaces personalizados / Cuevana, etc.)
            const db = getDb(); // Obtenemos la conexión a la base de datos
            if (db) {
                // Busca en una nueva colección que crearemos para Zyro
                const customLinks = await db.collection('zyro_custom_links').find({
                    $or: [
                        { tmdb_id: tmdbId }, // Busca por ID exacto
                        { titulo_pelicula: { $regex: new RegExp(query, "i") } } // O busca por similitud de nombre
                    ]
                }).toArray();

                customLinks.forEach(link => {
                    enlacesFinales.push({
                        sitioWeb: link.sitioWeb,         // Ej: "latino-cine.net"
                        titulo: link.titulo,             // Ej: "[Doblado Latino] Batman"
                        descripcion: link.descripcion,
                        calidad: link.calidad,           // Ej: "HD", "1080p"
                        urlDestino: link.urlDestino,     // El link a la web donde está el reproductor
                        categoria: link.categoria        // Ej: "Comunidad" o "Doblado Latino"
                    });
                });
            }

            // 4. OBTENER PROVEEDORES OFICIALES (Netflix, Amazon, etc.)
            const providersRes = await axios.get(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/watch/providers?api_key=${TMDB_API_KEY}`);
            // Busca disponibilidad en Ecuador, USA o España
            const ecProviders = providersRes.data.results.EC || providersRes.data.results.US || providersRes.data.results.ES || {}; 
            
            if (ecProviders.flatrate) {
                ecProviders.flatrate.forEach(provider => {
                    // Transforma "Prime Video" a "primevideo.com" visualmente para la app
                    const domain = provider.provider_name.toLowerCase().replace(/\s+/g, '') + ".com";
                    
                    enlacesFinales.push({
                        sitioWeb: domain,
                        titulo: `Ver en ${provider.provider_name}`,
                        descripcion: `Disponible oficialmente en ${provider.provider_name}. Requiere suscripción activa.`,
                        calidad: "Premium",
                        urlDestino: ecProviders.link || `https://www.google.com/search?q=${encodeURIComponent(tituloOficial)}+en+${provider.provider_name}`,
                        categoria: "Fuentes Oficiales"
                    });
                });
            }

            // 5. EMPAQUETAR Y ENVIAR RESPUESTA A LA APP ANDROID
            const respuestaFinal = {
                metadata: {
                    tmdb_id: tmdbId,
                    titulo: tituloOficial,
                    poster: bestMatch.poster_path ? `https://image.tmdb.org/t/p/w500${bestMatch.poster_path}` : null,
                    tipo: mediaType,
                    descripcion: bestMatch.overview
                },
                enlaces: enlacesFinales
            };

            // Guardar en caché por 1 hora (3600 segundos) para que tu base de datos descanse
            cache.set(cacheKey, respuestaFinal, 3600);

            res.json(respuestaFinal);

        } catch (error) {
            console.error("[ZYRO] Error procesando búsqueda:", error);
            res.status(500).json({ error: "Error interno del servidor ZYRO" });
        }
    });
};
