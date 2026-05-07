const axios = require('axios');
const cheerio = require('cheerio'); // Añadido para el Web Scraping

module.exports = function(app, getDb, cache, TMDB_API_KEY) {
    app.get('/api/zyro-search', async (req, res) => {
        const { query } = req.query;
        if (!query) return res.status(400).json({ error: "Falta el parámetro 'query'" });

        // 1. SISTEMA DE CACHÉ (Evita saturar TMDB, la Web y tu Base de Datos)
        const cacheKey = `zyro_search_${query.toLowerCase().trim()}`;
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

            // 2. BUSCAR EN TMDB (Para obtener datos oficiales y póster)
            try {
                const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=es-ES&query=${encodeURIComponent(query)}`);
                const results = tmdbRes.data.results;

                if (results && results.length > 0) {
                    const bestMatch = results.find(r => r.media_type === 'movie' || r.media_type === 'tv') || results[0];
                    tmdbId = bestMatch.id;
                    mediaType = bestMatch.media_type || 'movie';
                    tituloOficial = bestMatch.title || bestMatch.name;

                    metadata = {
                        tmdb_id: tmdbId,
                        titulo: tituloOficial,
                        poster: bestMatch.poster_path ? `https://image.tmdb.org/t/p/w500${bestMatch.poster_path}` : null,
                        tipo: mediaType,
                        descripcion: bestMatch.overview
                    };
                }
            } catch (tmdbError) {
                console.error("[ZYRO] TMDB falló o no respondió a tiempo:", tmdbError.message);
            }

            // Si TMDB no encuentra nada, creamos un metadata genérico para la App
            if (!metadata) {
                metadata = {
                    tmdb_id: null,
                    titulo: query,
                    poster: null,
                    tipo: 'web_search',
                    descripcion: `Resultados universales en la red para: "${query}"`
                };
            }

            // 3. BUSCAR EN TU MONGODB (Tus enlaces personalizados)
            const db = getDb();
            if (db) {
                // Preparamos la query para Mongo. Buscamos por regex siempre, y por ID solo si TMDB lo encontró
                const dbQuery = { 
                    $or: [ { titulo_pelicula: { $regex: new RegExp(query, "i") } } ] 
                };
                if (tmdbId) {
                    dbQuery.$or.push({ tmdb_id: tmdbId });
                }

                const customLinks = await db.collection('zyro_custom_links').find(dbQuery).toArray();

                customLinks.forEach(link => {
                    enlacesFinales.push({
                        sitioWeb: link.sitioWeb,
                        titulo: link.titulo,
                        descripcion: link.descripcion,
                        calidad: link.calidad,
                        urlDestino: link.urlDestino,
                        categoria: link.categoria
                    });
                });
            }

            // 4. OBTENER PROVEEDORES OFICIALES (Netflix, Amazon, etc.) - Solo si hay TMDB ID
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
                                descripcion: `Disponible oficialmente en ${provider.provider_name}. Requiere suscripción activa.`,
                                calidad: "Premium",
                                urlDestino: ecProviders.link || `https://www.google.com/search?q=${encodeURIComponent(tituloOficial)}+en+${provider.provider_name}`,
                                categoria: "Fuentes Oficiales"
                            });
                        });
                    }
                } catch (providerError) {
                    console.error("[ZYRO] Error obteniendo proveedores:", providerError.message);
                }
            }

            // 5. SCRAPING UNIVERSAL DE LA RED (DuckDuckGo HTML) - Fallback o Complemento
            // Siempre se ejecuta para asegurar que la app reciba contenido variado.
            try {
                // Añadimos headers de un navegador real para evitar bloqueos por bot
                const scraperRes = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' pelicula serie completa')}`, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
                    },
                    timeout: 6000 // Máximo 6 segundos para no colgar la API
                });

                const $ = cheerio.load(scraperRes.data);
                
                // Recorremos los resultados de búsqueda
                $('.result').each((index, element) => {
                    if (index >= 10) return false; // Limitamos a los 10 mejores resultados para no saturar la App Android

                    const rawTitle = $(element).find('.result__title a').text().trim();
                    const rawUrl = $(element).find('.result__title a').attr('href');
                    const snippet = $(element).find('.result__snippet').text().trim();

                    if (rawTitle && rawUrl) {
                        // DuckDuckGo oculta las URLs reales bajo un parámetro "uddg". Procedemos a limpiarlo:
                        let cleanUrl = rawUrl;
                        if (rawUrl.includes('uddg=')) {
                            try {
                                const urlObj = new URL(rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl);
                                const uddgParam = urlObj.searchParams.get('uddg');
                                if (uddgParam) {
                                    cleanUrl = decodeURIComponent(uddgParam);
                                }
                            } catch (e) {
                                // Fallback por si falla el parseo de la URL
                            }
                        }

                        // Extraemos el dominio principal para mostrar en la UI de Android
                        let dominio = 'Desconocido';
                        try {
                            dominio = new URL(cleanUrl).hostname.replace('www.', '');
                        } catch (e) {}

                        // Evitar inyectar resultados de IMDB o Wikipedia si buscamos enlaces de streaming
                        if (!dominio.includes('wikipedia.org') && !dominio.includes('imdb.com')) {
                            enlacesFinales.push({
                                sitioWeb: dominio,
                                titulo: rawTitle,
                                descripcion: snippet || 'Resultado encontrado en la web abierta.',
                                calidad: 'Web',
                                urlDestino: cleanUrl,
                                categoria: 'Resultados de la Red'
                            });
                        }
                    }
                });
            } catch (scrapeError) {
                console.log(`[ZYRO] El scraping web fue bloqueado o tardó mucho para "${query}":`, scrapeError.message);
                // No lanzamos el error, permitimos que el código continúe con lo que haya encontrado en TMDB/Mongo
            }

            // 6. EMPAQUETAR Y ENVIAR RESPUESTA A LA APP ANDROID
            const respuestaFinal = {
                metadata: metadata,
                enlaces: enlacesFinales
            };

            // Guardar en caché por 1 hora (3600 segundos) para mitigar peticiones web repetitivas y proteger el servidor
            cache.set(cacheKey, respuestaFinal, 3600);

            res.json(respuestaFinal);

        } catch (error) {
            console.error("[ZYRO] Error crítico procesando búsqueda:", error);
            res.status(500).json({ error: "Error interno del servidor ZYRO" });
        }
    });
};
