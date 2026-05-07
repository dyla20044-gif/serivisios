const axios = require('axios');
const cheerio = require('cheerio'); // Motor de Scraping para búsquedas universales

module.exports = function(app, getDb, cache, TMDB_API_KEY) {
    app.get('/api/zyro-search', async (req, res) => {
        const { query } = req.query;
        if (!query) return res.status(400).json({ error: "Falta el parámetro 'query'" });

        // 1. SISTEMA DE CACHÉ (Evita saturar la web, TMDB y tu Base de Datos)
        const cacheKey = `zyro_universal_${query.toLowerCase().trim()}`;
        const cachedResult = cache.get(cacheKey);
        
        if (cachedResult) {
            console.log(`[ZYRO] Sirviendo desde caché: ${query}`);
            return res.json(cachedResult);
        }

        try {
            let metadata = null;
            let enlacesFinales = [];
            let tmdbId = null;
            let mediaType = 'movie';
            let tituloOficial = query;

            // 2. BUSCAR EN TMDB (Solo para detectar si es Película o Serie)
            try {
                const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(query)}`);
                const results = tmdbRes.data.results;

                if (results && results.length > 0) {
                    // Solo tomamos el resultado si TMDB está SEGURO de que es una peli o serie
                    const bestMatch = results.find(r => r.media_type === 'movie' || r.media_type === 'tv');
                    
                    if (bestMatch) {
                        tmdbId = bestMatch.id;
                        mediaType = bestMatch.media_type || 'movie';
                        tituloOficial = bestMatch.title || bestMatch.name;

                        metadata = {
                            tmdb_id: tmdbId,
                            titulo: tituloOficial,
                            poster: bestMatch.poster_path ? `https://image.tmdb.org/t/p/w500${bestMatch.poster_path}` : null,
                            tipo: mediaType,
                            descripcion: bestMatch.overview || "Sin sinopsis disponible."
                        };
                    }
                }
            } catch (tmdbError) {
                console.log("[ZYRO] TMDB no detectó película/serie o falló:", tmdbError.message);
            }

            // 3. METADATA GENÉRICO (Para búsquedas como "Facebook", "Noticias", etc.)
            if (!metadata) {
                metadata = {
                    tmdb_id: null,
                    titulo: query,
                    poster: null, 
                    tipo: 'web_search',
                    descripcion: `Resultados universales de la red para: "${query}"`
                };
            }

            // 4. BUSCAR EN TU MONGODB (Solo buscará si es una película/serie que tengas guardada)
            const db = getDb();
            if (db) {
                const dbQuery = { 
                    $or: [ { titulo_pelicula: { $regex: new RegExp(query, "i") } } ] 
                };
                if (tmdbId) {
                    dbQuery.$or.push({ tmdb_id: tmdbId });
                }

                try {
                    const customLinks = await db.collection('zyro_custom_links').find(dbQuery).toArray();
                    customLinks.forEach(link => {
                        enlacesFinales.push({
                            sitioWeb: link.sitioWeb,
                            titulo: link.titulo,
                            descripcion: link.descripcion,
                            calidad: link.calidad,
                            urlDestino: link.urlDestino,
                            categoria: link.categoria || "Comunidad"
                        });
                    });
                } catch(dbErr) {
                    console.error("[ZYRO] Error en la base de datos:", dbErr.message);
                }
            }

            // 5. PROVEEDORES OFICIALES (Solo si es película/serie con TMDB ID)
            if (tmdbId) {
                try {
                    const providersRes = await axios.get(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/watch/providers?api_key=${TMDB_API_KEY}`);
                    const ecProviders = providersRes.data.results.EC || providersRes.data.results.US || providersRes.data.results.ES || {}; 
                    
                    if (ecProviders.flatrate) {
                        ecProviders.flatrate.forEach(provider => {
                            const domain = provider.provider_name.toLowerCase().replace(/\s+/g, '') + ".com";
                            enlacesFinales.push({
                                sitioWeb: domain,
                                titulo: `Ver en ${provider.provider_name}`,
                                descripcion: `Disponible oficialmente en ${provider.provider_name}.`,
                                calidad: "Premium",
                                urlDestino: ecProviders.link || `https://www.google.com/search?q=${encodeURIComponent(tituloOficial)}+en+${provider.provider_name}`,
                                categoria: "Fuentes Oficiales"
                            });
                        });
                    }
                } catch (providerError) {
                    console.log("[ZYRO] Error obteniendo proveedores:", providerError.message);
                }
            }

            // 6. EL BUSCADOR UNIVERSAL (Scraping Inteligente sin filtros ocultos)
            try {
                // Buscamos EXACTAMENTE lo que el usuario escribió (Ej: "Facebook login")
                const scraperRes = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
                    },
                    timeout: 8000 // 8 segundos para asegurar que la web responda
                });

                const $ = cheerio.load(scraperRes.data);
                
                // Extraemos hasta 15 resultados para dar buena variedad de navegación
                $('.result').each((index, element) => {
                    if (index >= 15) return false; 

                    const rawTitle = $(element).find('.result__title a').text().trim();
                    const rawUrl = $(element).find('.result__title a').attr('href');
                    const snippet = $(element).find('.result__snippet').text().trim();

                    if (rawTitle && rawUrl) {
                        // Limpiar la URL de protección (Desencriptar el uddg de DuckDuckGo)
                        let cleanUrl = rawUrl;
                        if (rawUrl.includes('uddg=')) {
                            try {
                                const urlObj = new URL(rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl);
                                const uddgParam = urlObj.searchParams.get('uddg');
                                if (uddgParam) {
                                    cleanUrl = decodeURIComponent(uddgParam);
                                }
                            } catch (e) {
                                // Fallback silencioso
                            }
                        }

                        // Extraer el dominio para que se vea limpio en la UI de Android
                        let dominio = 'Web';
                        try {
                            dominio = new URL(cleanUrl).hostname.replace('www.', '');
                        } catch (e) {}

                        // Insertamos CUALQUIER resultado web
                        enlacesFinales.push({
                            sitioWeb: dominio,
                            titulo: rawTitle,
                            descripcion: snippet || 'Resultado de la web abierta.',
                            calidad: 'Web',
                            urlDestino: cleanUrl,
                            categoria: 'Navegación'
                        });
                    }
                });
            } catch (scrapeError) {
                console.log(`[ZYRO] El scraping web falló para "${query}":`, scrapeError.message);
            }

            // 7. EMPAQUETAR Y ENVIAR A ANDROID
            const respuestaFinal = {
                metadata: metadata,
                enlaces: enlacesFinales
            };

            // Guardar en caché por 1 hora
            cache.set(cacheKey, respuestaFinal, 3600);

            res.json(respuestaFinal);

        } catch (error) {
            console.error("[ZYRO] Error crítico procesando búsqueda:", error);
            res.status(500).json({ error: "Error interno del servidor ZYRO" });
        }
    });
};
