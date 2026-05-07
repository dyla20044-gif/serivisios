const axios = require('axios');
const cheerio = require('cheerio'); // Motor de Scraping para búsquedas universales

module.exports = function(app, getDb, cache, TMDB_API_KEY) {
    
    // =========================================================================
    // 1. ENDPOINT DE LA BARRA DE BÚSQUEDA (Búsqueda por texto del usuario)
    // =========================================================================
    app.get('/api/zyro-search', async (req, res) => {
        const { query } = req.query;
        if (!query) return res.status(400).json({ error: "Falta el parámetro 'query'" });

        // SISTEMA DE CACHÉ
        const cacheKey = `zyro_universal_${query.toLowerCase().trim()}`;
        const cachedResult = cache.get(cacheKey);
        
        if (cachedResult) {
            console.log(`[ZYRO] Sirviendo BÚSQUEDA desde caché: ${query}`);
            return res.json(cachedResult);
        }

        // ... (Aquí va toda tu lógica original de zyro-search que ya tenías)
        // Para no hacer el bloque inmenso, asume que aquí está tu código exacto de la barra de búsqueda que vimos antes.
        try {
            // (Tu lógica de TMDB, Mongo, Providers, Scraping)
            // ...
            // Simulando la respuesta final para estructura:
            const respuestaFinal = { metadata: {}, sugerencias: [], enlaces: [] };
            cache.set(cacheKey, respuestaFinal, 3600);
            res.json(respuestaFinal);
        } catch (error) {
            res.status(500).json({ metadata: null, sugerencias: [], enlaces: [] });
        }
    });


    // =========================================================================
    // 2. NUEVO ENDPOINT: AUTO-BÚSQUEDA AL ENTRAR A UNA PELÍCULA (Búsqueda por ID)
    // =========================================================================
    app.get('/api/zyro-details', async (req, res) => {
        const { tmdbId, mediaType } = req.query; // mediaType = 'movie' o 'tv'
        
        if (!tmdbId) return res.status(400).json({ error: "Se requiere tmdbId" });
        const type = mediaType || 'movie';

        // 1. EL CACHÉ: Protege tu servidor y la web. Guardamos por 2 horas (7200 segs)
        const cacheKey = `zyro_details_${type}_${tmdbId}`;
        const cachedResult = cache.get(cacheKey);
        
        if (cachedResult) {
            console.log(`[ZYRO AUTO-SEARCH] Sirviendo detalles exactos desde CACHÉ para ID: ${tmdbId}`);
            return res.json(cachedResult);
        }

        console.log(`[ZYRO AUTO-SEARCH] Buscando en la web para nuevo ID: ${tmdbId}`);

        try {
            let metadata = null;
            let enlacesFinales = [];
            let tituloOficial = "";

            // 2. BUSCAR INFO EXACTA EN TMDB
            try {
                const tmdbRes = await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-MX`);
                const data = tmdbRes.data;
                tituloOficial = data.title || data.name;

                metadata = {
                    tmdb_id: tmdbId,
                    titulo: tituloOficial,
                    poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
                    tipo: type,
                    descripcion: data.overview || "Sin sinopsis disponible."
                };
            } catch (tmdbError) {
                return res.status(404).json({ error: "No se encontró metadata en TMDB para este ID." });
            }

            // 3. BUSCAR EN TU MONGODB (Enlaces de tus Uploaders Admin)
            const db = getDb();
            if (db) {
                try {
                    const customLinks = await db.collection('zyro_custom_links').find({ tmdb_id: parseInt(tmdbId) }).toArray();
                    customLinks.forEach(link => {
                        enlacesFinales.push({
                            sitioWeb: link.sitioWeb,
                            titulo: link.titulo,
                            descripcion: link.descripcion,
                            calidad: link.calidad,
                            urlDestino: link.urlDestino,
                            categoria: link.categoria || "Comunidad",
                            favicon: `https://www.google.com/s2/favicons?domain=${link.sitioWeb}&sz=64`
                        });
                    });
                } catch(dbErr) {
                    console.error("[ZYRO] Error en DB:", dbErr.message);
                }
            }

            // 4. PROVEEDORES OFICIALES (Netflix, Disney+, etc)
            try {
                const providersRes = await axios.get(`https://api.themoviedb.org/3/${type}/${tmdbId}/watch/providers?api_key=${TMDB_API_KEY}`);
                const regionInfo = providersRes.data.results.EC || providersRes.data.results.US || providersRes.data.results.ES || {}; 
                
                if (regionInfo.flatrate) {
                    regionInfo.flatrate.forEach(provider => {
                        const domain = provider.provider_name.toLowerCase().replace(/\s+/g, '') + ".com";
                        enlacesFinales.push({
                            sitioWeb: domain,
                            titulo: `Ver en ${provider.provider_name}`,
                            descripcion: `Disponible oficialmente.`,
                            calidad: "Premium",
                            urlDestino: regionInfo.link || `https://www.google.com/search?q=${encodeURIComponent(tituloOficial)}+en+${provider.provider_name}`,
                            categoria: "Oficial",
                            favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
                        });
                    });
                }
            } catch (e) {}

            // 5. EL SCRAPING EN LA WEB (Búsqueda invisible con el título oficial)
            try {
                const userAgents = [
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
                ];
                const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

                // Buscamos algo específico, ej: "Deadpool y Wolverine ver online"
                const searchString = `${tituloOficial} ver online`; 

                const scraperRes = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchString)}`, {
                    headers: { 'User-Agent': randomUA },
                    timeout: 10000 
                });

                const $ = cheerio.load(scraperRes.data);
                
                $('.result').each((index, element) => {
                    if (index >= 8) return false; // Traemos solo los 8 mejores para no saturar

                    const rawTitle = $(element).find('.result__title a').text().trim();
                    const rawUrl = $(element).find('.result__title a').attr('href');
                    const snippet = $(element).find('.result__snippet').text().trim();

                    if (rawTitle && rawUrl) {
                        let cleanUrl = rawUrl;
                        if (rawUrl.includes('uddg=')) {
                            try { cleanUrl = decodeURIComponent(new URL(`https:${rawUrl}`).searchParams.get('uddg')); } catch (e) {}
                        }

                        if (!cleanUrl.startsWith('http')) return true;

                        let dominio = 'Web';
                        try { dominio = new URL(cleanUrl).hostname.replace('www.', ''); } catch (e) {}

                        enlacesFinales.push({
                            sitioWeb: dominio,
                            titulo: rawTitle,
                            descripcion: snippet,
                            calidad: 'Web',
                            urlDestino: cleanUrl,
                            categoria: 'Exploración de Red',
                            favicon: `https://www.google.com/s2/favicons?domain=${dominio}&sz=64`
                        });
                    }
                });
            } catch (scrapeError) {
                console.log(`[ZYRO AUTO-SEARCH] Scraping falló para "${tituloOficial}"`, scrapeError.message);
            }

            // 6. RESPUESTA FINAL Y GUARDADO EN CACHÉ
            const respuestaFinal = {
                metadata: metadata,
                enlaces: enlacesFinales
            };

            // Guarda en RAM por 2 horas (7200 segundos)
            cache.set(cacheKey, respuestaFinal, 7200);

            res.json(respuestaFinal);

        } catch (error) {
            console.error("[ZYRO AUTO-SEARCH] Error crítico:", error);
            res.status(500).json({ error: "Error procesando los detalles." });
        }
    });
};
